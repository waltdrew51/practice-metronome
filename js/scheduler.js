/**
 * Lookahead scheduler. Click times are absolute positions on the audio
 * clock: anchorTime + (beat - anchorBeat) * secondsPerBeat.
 * A timer only asks "what is due?"; it does not fire the clicks.
 * Tempo changes retarget the anchor so the current beat position stays put.
 */

import { clampTempo, expandPattern, normalizeConfig } from "./pattern.js";

export function createScheduler(config, startTime = 0) {
  const cfg = normalizeConfig(config);
  if (!cfg) throw new Error("Invalid pattern");
  return {
    events: expandPattern(cfg),
    beatsPerBar: cfg.beatsPerBar,
    loopBeats: cfg.beatsPerBar * cfg.bars.length,
    nextIdx: 0,
    loopCount: 0,
    anchorTime: startTime,
    anchorBeat: 0,
    secPerBeat: 60 / cfg.tempo,
    tempo: cfg.tempo,
  };
}

export function currentBeat(state, now) {
  return state.anchorBeat + (now - state.anchorTime) / state.secPerBeat;
}

export function beatToTime(state, beat) {
  return state.anchorTime + (beat - state.anchorBeat) * state.secPerBeat;
}

function eventAbsBeat(state, loop, index) {
  const event = state.events[index];
  return loop * state.loopBeats + event.bar * state.beatsPerBar + event.pos;
}

/**
 * Point the cursor at the first event strictly after `beatNow`.
 * An event we are sitting on has already been sounded, so it is not replayed.
 */
export function seekNext(state, beatNow) {
  if (!state.events.length || !(state.loopBeats > 0)) return;
  const target = beatNow + 1e-6;
  let loop = Math.floor(target / state.loopBeats);
  let posInLoop = target - loop * state.loopBeats;
  if (loop < 0 || posInLoop < 0) {
    loop = 0;
    posInLoop = 0;
  }
  for (let i = 0; i < state.events.length; i += 1) {
    const eventPos = state.events[i].bar * state.beatsPerBar + state.events[i].pos;
    if (eventPos >= posInLoop - 1e-12) {
      state.loopCount = loop;
      state.nextIdx = i;
      return;
    }
  }
  state.loopCount = loop + 1;
  state.nextIdx = 0;
}

export function retargetTempo(state, tempo, now) {
  const nextTempo = clampTempo(tempo);
  if (Number.isFinite(now)) {
    const beat = currentBeat(state, now);
    state.anchorBeat = beat;
    state.anchorTime = now;
    state.tempo = nextTempo;
    state.secPerBeat = 60 / nextTempo;
    seekNext(state, beat);
  } else {
    state.tempo = nextTempo;
    state.secPerBeat = 60 / nextTempo;
  }
  return state.tempo;
}

export function replacePattern(state, config, now) {
  const cfg = normalizeConfig(config);
  if (!cfg) throw new Error("Invalid pattern");
  const beat = Number.isFinite(now) ? currentBeat(state, now) : 0;
  state.events = expandPattern(cfg);
  state.beatsPerBar = cfg.beatsPerBar;
  state.loopBeats = cfg.beatsPerBar * cfg.bars.length;
  state.tempo = cfg.tempo;
  state.secPerBeat = 60 / cfg.tempo;
  if (Number.isFinite(now)) {
    state.anchorBeat = beat;
    state.anchorTime = now;
    seekNext(state, beat);
  } else {
    state.anchorBeat = 0;
    state.anchorTime = 0;
    state.nextIdx = 0;
    state.loopCount = 0;
  }
}

function advance(state) {
  state.nextIdx += 1;
  if (state.nextIdx >= state.events.length) {
    state.nextIdx = 0;
    state.loopCount += 1;
  }
}

/**
 * Events whose audio time is inside (now - late, now + lookahead].
 * Events older than `late` are skipped. A gap of many bars jumps forward
 * a whole loop at a time so waking from the background does not burst.
 */
export function takeDueEvents(state, now, lookahead = 0.2, late = 0.05) {
  const due = [];
  if (!state.events.length || !(state.secPerBeat > 0) || !Number.isFinite(now)) return due;
  const horizon = now + lookahead;
  let safety = 0;
  while (safety < 200000) {
    safety += 1;
    const absBeat = eventAbsBeat(state, state.loopCount, state.nextIdx);
    const time = beatToTime(state, absBeat);
    if (time < now - late) {
      const beatsLate = (now - late - time) / state.secPerBeat;
      if (beatsLate > state.loopBeats) {
        const skipLoops = Math.floor(beatsLate / state.loopBeats);
        if (skipLoops > 0 && Number.isFinite(skipLoops)) {
          state.loopCount += skipLoops;
          continue;
        }
      }
      advance(state);
      continue;
    }
    if (time > horizon) break;
    const event = state.events[state.nextIdx];
    due.push({ ...event, time, absBeat });
    advance(state);
  }
  return due;
}
