/**
 * Practice metronome UI.
 * Audio clicks are queued on the Web Audio clock. The lights follow
 * requestAnimationFrame compared against AudioContext time, not a timer.
 */

import { createAudioEngine } from "./audio.js";
import {
  BEATS_MAX,
  BEATS_MIN,
  BARS_MAX,
  BARS_MIN,
  BUILTIN_ID,
  SIGNATURES,
  SUBDIVISION_LABEL,
  SUBDIVISION_META,
  accentName,
  beatStartOf,
  cleanName,
  clampTempo,
  clampVolume,
  cycleAccent,
  cycleSubdivision,
  normalizeConfig,
  pairWithNext,
  resizeBars,
  sameMusic,
  setMeter,
  signatureLabel,
  spanOf,
  splitPair,
  straightBar,
  straightConfig,
} from "./pattern.js";
import { createLibrary, loadSession, saveSession } from "./presets.js";
import { createScheduler, replacePattern, retargetTempo, takeDueEvents } from "./scheduler.js";

const LOOKAHEAD_VISIBLE = 0.2;
const LOOKAHEAD_HIDDEN = 1.2;
const LATE = 0.05;

const storage = window.localStorage;
const library = createLibrary(storage);
const audio = createAudioEngine();

const $ = (id) => document.getElementById(id);

const els = {
  barNum: $("barNum"),
  sigLabel: $("sigLabel"),
  beatNum: $("beatNum"),
  lamps: $("lamps"),
  subs: $("subs"),
  subLabel: $("subLabel"),
  bpm: $("bpm"),
  bpmBtn: $("bpmBtn"),
  playState: $("playState"),
  strip: $("strip"),
  toggle: $("toggle"),
  tempo: $("tempo"),
  tempoDec: $("tempoDec"),
  tempoInc: $("tempoInc"),
  tap: $("tap"),
  tapStatus: $("tapStatus"),
  volume: $("volume"),
  volLabel: $("volLabel"),
  wakeNote: $("wakeNote"),
  message: $("message"),
  sigChips: $("sigChips"),
  beatsDec: $("beatsDec"),
  beatsInc: $("beatsInc"),
  beatsValue: $("beatsValue"),
  barsDec: $("barsDec"),
  barsInc: $("barsInc"),
  barsValue: $("barsValue"),
  unit4: $("unit4"),
  unit8: $("unit8"),
  pattern: $("pattern"),
  newStraight: $("newStraight"),
  dirtyLabel: $("dirtyLabel"),
  presetName: $("presetName"),
  saveBtn: $("saveBtn"),
  saveAsBtn: $("saveAsBtn"),
  renameBtn: $("renameBtn"),
  deleteBtn: $("deleteBtn"),
  presetList: $("presetList"),
  offline: $("offline"),
  installHint: $("installHint"),
  live: $("live"),
  storageWarning: $("storageWarning"),
};

let config = null;
let presetId = null;
let running = false;
let scheduler = null;
let visualEvents = [];
let timer = 0;
let raf = 0;
let wakeLock = null;
let sessionTimer = 0;
let deleteArmed = false;
let contextWatch = null;
const taps = [];

const shown = {
  bar: -1,
  beat: -1,
  slotKey: "",
  pending: null,
  editorBar: "",
  editorSlot: "",
  editorPending: null,
};

function init() {
  const session = loadSession(storage);
  if (session) {
    config = session.config;
    presetId = library.get(session.presetId) ? session.presetId : null;
  } else {
    const builtin = library.get(BUILTIN_ID);
    config = normalizeConfig(builtin);
    presetId = BUILTIN_ID;
  }
  const active = presetId ? library.get(presetId) : null;
  els.presetName.value = (session && session.name) || (active ? active.name : "My pattern");
  bind();
  renderChips();
  renderEditor();
  renderPresets();
  syncControls();
  showIdle();
  audio.setVolume(config.volume / 100);
  registerServiceWorker();
  updateInstallHint();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", onVisibility);
  window.addEventListener("focus", onVisibility);
  window.addEventListener("pagehide", flushSession);
  if (!library.persistent) els.storageWarning.hidden = false;
  document.body.classList.remove("is-booting");
}

function bind() {
  els.toggle.addEventListener("click", toggle);
  els.bpmBtn.addEventListener("click", () => {
    els.tempo.focus();
    els.tempo.select();
  });
  els.tempo.addEventListener("input", onTempoInput);
  els.tempo.addEventListener("change", onTempoCommit);
  els.volume.addEventListener("input", () => setVolume(els.volume.value));
  els.tap.addEventListener("click", onTapTempo);
  els.beatsDec.addEventListener("click", () => applyMeter(config.beatsPerBar - 1, config.beatUnit));
  els.beatsInc.addEventListener("click", () => applyMeter(config.beatsPerBar + 1, config.beatUnit));
  els.barsDec.addEventListener("click", () => applyBarCount(config.bars.length - 1));
  els.barsInc.addEventListener("click", () => applyBarCount(config.bars.length + 1));
  els.unit4.addEventListener("click", () => applyMeter(config.beatsPerBar, 4));
  els.unit8.addEventListener("click", () => applyMeter(config.beatsPerBar, 8));
  els.newStraight.addEventListener("click", newStraight);
  els.saveBtn.addEventListener("click", savePreset);
  els.saveAsBtn.addEventListener("click", saveAsNew);
  els.renameBtn.addEventListener("click", renamePreset);
  els.deleteBtn.addEventListener("click", deletePreset);
  els.pattern.addEventListener("click", onPatternClick);
  els.presetList.addEventListener("click", onPresetClick);
  bindHold(els.tempoDec, (ticks) => setTempo(config.tempo - (ticks > 10 ? 5 : 1)));
  bindHold(els.tempoInc, (ticks) => setTempo(config.tempo + (ticks > 10 ? 5 : 1)));
  window.addEventListener("keydown", onKeydown);
}

function bindHold(button, step) {
  let delay = 0;
  let repeat = 0;
  let ticks = 0;
  let suppressClick = false;
  const clearTimers = () => {
    ticks = 0;
    clearTimeout(delay);
    clearInterval(repeat);
    delay = 0;
    repeat = 0;
  };
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    try { button.setPointerCapture(event.pointerId); } catch { /* pointer already released */ }
    clearTimers();
    suppressClick = true;
    ticks = 1;
    step(ticks);
    delay = setTimeout(() => {
      repeat = setInterval(() => {
        ticks += 1;
        step(ticks);
      }, 55);
    }, 320);
  });
  button.addEventListener("pointerup", () => {
    clearTimers();
    setTimeout(() => { suppressClick = false; }, 0);
  });
  button.addEventListener("pointercancel", clearTimers);
  button.addEventListener("click", () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    step(1);
  });
}

function onKeydown(event) {
  if (event.repeat) return;
  const typing = event.target instanceof HTMLElement && event.target.closest("input, textarea, select");
  if (event.code === "Space" && !typing) {
    event.preventDefault();
    toggle();
  } else if (!typing && event.key === "ArrowUp") {
    event.preventDefault();
    setTempo(config.tempo + (event.shiftKey ? 5 : 1));
  } else if (!typing && event.key === "ArrowDown") {
    event.preventDefault();
    setTempo(config.tempo - (event.shiftKey ? 5 : 1));
  }
}

function onTempoInput() {
  const raw = els.tempo.value.trim();
  if (raw === "") return;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 20 || value > 300) return;
  setTempo(value);
}

function onTempoCommit() {
  const tempo = clampTempo(els.tempo.value);
  els.tempo.value = String(tempo);
  setTempo(tempo);
}

function onTapTempo() {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
  taps.push(now);
  if (taps.length > 5) taps.shift();
  if (taps.length < 2) {
    els.tapStatus.textContent = "Tap the beat again";
    return;
  }
  let sum = 0;
  for (let i = 1; i < taps.length; i += 1) sum += taps[i] - taps[i - 1];
  const tempo = clampTempo(60000 / (sum / (taps.length - 1)));
  els.tempo.value = String(tempo);
  setTempo(tempo);
  els.tapStatus.textContent = "Tap tempo " + tempo + " BPM";
}

function commit(next, flags = {}) {
  const normalized = normalizeConfig(next);
  if (!normalized) {
    setMessage("That pattern could not be applied.");
    return;
  }
  disarmDelete();
  config = normalized;
  if (flags.patternChanged) invalidateDisplay();
  if (running && scheduler && (flags.patternChanged || flags.tempoChanged)) {
    const now = audio.currentTime();
    if (flags.patternChanged) replacePattern(scheduler, config, now);
    else retargetTempo(scheduler, config.tempo, now);
    audio.cancelFrom(now);
    visualEvents = visualEvents.filter((event) => event.time <= now);
    schedule();
  }
  syncControls();
  if (flags.patternChanged) renderEditor();
  updateDirty();
  if (!running && flags.patternChanged) showIdle();
  scheduleSession();
}

function setTempo(tempo) {
  const next = clampTempo(tempo);
  if (next === config.tempo) {
    if (document.activeElement !== els.tempo) els.tempo.value = String(next);
    syncControls();
    return;
  }
  commit({ ...config, tempo: next }, { tempoChanged: true });
}

function setVolume(volume) {
  config = { ...config, volume: clampVolume(volume) };
  audio.setVolume(config.volume / 100);
  syncVolume();
  updateDirty();
  scheduleSession();
}

function applyMeter(beats, unit) {
  const meter = setMeter(config.bars, beats, unit);
  commit(
    {
      ...config,
      beatsPerBar: meter.beatsPerBar,
      beatUnit: meter.beatUnit,
      bars: meter.bars,
    },
    { patternChanged: true },
  );
}

function applyBarCount(count) {
  commit(
    { ...config, bars: resizeBars(config.bars, count, config.beatsPerBar) },
    { patternChanged: true },
  );
}

function newStraight() {
  presetId = null;
  els.presetName.value = "Straight 4/4";
  commit(
    straightConfig({ tempo: config.tempo, volume: config.volume, beats: 4, unit: 4, bars: 4 }),
    { patternChanged: true },
  );
  renderPresets();
  setMessage("Straight 4/4 is on screen. Save it if you want to keep it.");
}

function onPatternClick(event) {
  const button = event.target.closest("button");
  if (!button || !els.pattern.contains(button)) return;
  const barIndex = Number(button.dataset.bar);
  const slotIndex = Number(button.dataset.slot);
  const action = button.dataset.action;
  const bars = config.bars.map((bar) => bar.map((slot) => ({
    subdivision: slot.subdivision,
    accents: slot.accents.slice(),
  })));
  if (!bars[barIndex]) return;
  if (action === "cycle-sub") {
    const slot = bars[barIndex][slotIndex];
    bars[barIndex] = slot && slot.subdivision === "qtriplet"
      ? splitPair(bars[barIndex], slotIndex)
      : cycleSubdivision(bars[barIndex], slotIndex);
  }
  else if (action === "pair-next") bars[barIndex] = pairWithNext(bars[barIndex], slotIndex);
  else if (action === "split-pair") bars[barIndex] = splitPair(bars[barIndex], slotIndex);
  else if (action === "cycle-accent") {
    bars[barIndex] = cycleAccent(bars[barIndex], slotIndex, Number(button.dataset.click));
  } else if (action === "reset-bar") bars[barIndex] = straightBar(config.beatsPerBar, true);
  else return;
  commit({ ...config, bars }, { patternChanged: true });
}

function toggle() {
  if (running) stop();
  else start();
}

function start() {
  audio.setVolume(config.volume / 100);
  const unlocking = audio.unlock();
  if (unlocking && typeof unlocking.catch === "function") unlocking.catch(() => {});
  watchContext();
  scheduler = createScheduler(config, audio.currentTime() + 0.1);
  visualEvents = [];
  invalidateDisplay();
  running = true;
  els.toggle.textContent = "Stop";
  els.toggle.classList.add("is-stop");
  els.toggle.setAttribute("aria-pressed", "true");
  els.playState.textContent = "Playing";
  announce("Playing at " + config.tempo + " BPM");
  schedule();
  timerLoop();
  raf = requestAnimationFrame(frame);
  requestWakeLock();
}

function stop(reason) {
  const message = typeof reason === "string" ? reason : "";
  running = false;
  clearInterval(timer);
  timer = 0;
  cancelAnimationFrame(raf);
  raf = 0;
  audio.cancelFrom(-Infinity);
  audio.pauseSilence();
  const suspending = audio.suspend();
  if (suspending && typeof suspending.catch === "function") suspending.catch(() => {});
  visualEvents = [];
  scheduler = null;
  releaseWakeLock();
  els.toggle.textContent = "Start";
  els.toggle.classList.remove("is-stop");
  els.toggle.setAttribute("aria-pressed", "false");
  els.wakeNote.textContent = "";
  showIdle(message || "Ready");
  announce(message || "Stopped");
}

function watchContext() {
  const ctx = audio.context();
  if (!ctx || contextWatch) return;
  contextWatch = true;
  ctx.addEventListener("statechange", () => {
    if (!running) return;
    if (document.visibilityState !== "visible") return;
    if (ctx.state === "suspended" || ctx.state === "interrupted") {
      ctx.resume().then(() => {
        if (running && ctx.state !== "running") {
          stop("Sound was interrupted. Tap Start to play again.");
        }
      }).catch(() => {
        if (running) stop("Sound was interrupted. Tap Start to play again.");
      });
    }
  });
}

function timerLoop() {
  clearInterval(timer);
  timer = setInterval(schedule, document.hidden ? 250 : 25);
}

function schedule() {
  if (!running || !scheduler) return;
  const now = audio.currentTime();
  const lookahead = document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD_VISIBLE;
  const due = takeDueEvents(scheduler, now, lookahead, LATE);
  for (const event of due) {
    audio.playClick(event);
    visualEvents.push(event);
  }
  const heard = audio.heardNow();
  while (visualEvents.length && visualEvents[0].time < heard - 2) visualEvents.shift();
}

function frame() {
  if (!running) return;
  paint(audio.heardNow());
  raf = requestAnimationFrame(frame);
}

function paint(heard) {
  let current = null;
  for (const event of visualEvents) {
    if (event.time <= heard) current = event;
    else break;
  }
  if (!current) {
    const upcoming = visualEvents.find((event) => event.time > heard);
    if (upcoming) paintEvent(upcoming, true);
    return;
  }
  paintEvent(current, false);
}

function paintEvent(event, pending) {
  if (shown.bar !== event.bar) {
    els.barNum.textContent = String(event.bar + 1);
    buildLamps(event.bar);
    shown.bar = event.bar;
    shown.beat = -1;
  }
  if (shown.beat !== event.beat || shown.pending !== pending) {
    els.beatNum.textContent = String(event.beat + 1);
    els.beatNum.classList.toggle("is-downbeat", event.beat === 0);
    shown.beat = event.beat;
    shown.pending = pending;
  }
  const accents = config.bars[event.bar][event.slot].accents.join("");
  const slotKey = [event.bar, event.slot, event.kind, event.subCount, accents].join(":");
  if (shown.slotKey !== slotKey) {
    buildSubs(event);
    els.subLabel.textContent = SUBDIVISION_LABEL[event.kind] || "";
    shown.slotKey = slotKey;
  }
  els.lamps.querySelectorAll(".lamp").forEach((lamp) => {
    const on = !pending && Number(lamp.dataset.beat) === event.beat;
    lamp.classList.toggle("is-on", on);
  });
  els.subs.querySelectorAll(".sub-pip").forEach((pip) => {
    pip.classList.toggle("is-on", !pending && Number(pip.dataset.sub) === event.sub);
  });
  els.strip.classList.toggle("is-downbeat", !pending && event.beat === 0);
  els.strip.classList.toggle("is-beat", !pending && event.beat !== 0);

  const barKey = String(event.bar);
  const slotKey2 = String(event.slot);
  if (shown.editorBar !== barKey || shown.editorSlot !== slotKey2 || shown.editorPending !== pending) {
    document.querySelectorAll(".bar-card").forEach((card) => {
      card.classList.toggle("is-playing", !pending && card.dataset.bar === barKey);
    });
    document.querySelectorAll(".beat-cell").forEach((cell) => {
      const on = !pending && cell.dataset.bar === barKey && cell.dataset.slot === slotKey2;
      cell.classList.toggle("is-playing", on);
    });
    shown.editorBar = barKey;
    shown.editorSlot = slotKey2;
    shown.editorPending = pending;
  }
}

function invalidateDisplay() {
  shown.bar = -1;
  shown.beat = -1;
  shown.slotKey = "";
  shown.pending = null;
  shown.editorBar = "";
  shown.editorSlot = "";
  shown.editorPending = null;
}

function showIdle(label) {
  invalidateDisplay();
  els.barNum.textContent = "1";
  els.beatNum.textContent = "1";
  els.beatNum.classList.add("is-downbeat");
  els.playState.textContent = label || "Ready";
  els.strip.classList.remove("is-downbeat", "is-beat");
  buildLamps(0);
  const first = config.bars[0][0];
  buildSubs({
    bar: 0,
    slot: 0,
    kind: first.subdivision,
    subCount: first.accents.length,
    sub: -1,
  });
  els.subLabel.textContent = SUBDIVISION_LABEL[first.subdivision] || "";
  document.querySelectorAll(".bar-card.is-playing, .beat-cell.is-playing").forEach((node) => {
    node.classList.remove("is-playing");
  });
}

function buildLamps(barIndex) {
  const bar = config.bars[barIndex];
  els.lamps.dataset.bar = String(barIndex);
  els.lamps.dataset.count = String(config.beatsPerBar);
  els.lamps.replaceChildren();
  let beat = 0;
  for (const slot of bar) {
    const span = spanOf(slot.subdivision);
    const group = document.createElement("div");
    group.className = "lamp-group" + (span === 2 ? " is-pair" : "");
    for (let i = 0; i < span; i += 1) {
      const lamp = document.createElement("div");
      lamp.className = "lamp" + (beat === 0 ? " is-downbeat" : "");
      lamp.dataset.beat = String(beat);
      group.append(lamp);
      beat += 1;
    }
    els.lamps.append(group);
  }
}

function buildSubs(event) {
  const slot = config.bars[event.bar][event.slot];
  els.subs.replaceChildren();
  slot.accents.forEach((accent, index) => {
    const pip = document.createElement("div");
    pip.className = "sub-pip " + (accent === 2 ? "is-accent" : accent === 0 ? "is-soft" : "is-normal");
    pip.dataset.sub = String(index);
    els.subs.append(pip);
  });
}

function renderChips() {
  els.sigChips.replaceChildren();
  for (const signature of SIGNATURES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = signature.label;
    button.dataset.beats = String(signature.beats);
    button.dataset.unit = String(signature.unit);
    button.addEventListener("click", () => applyMeter(signature.beats, signature.unit));
    els.sigChips.append(button);
  }
}

function renderEditor() {
  els.pattern.replaceChildren();
  config.bars.forEach((bar, barIndex) => {
    const card = document.createElement("article");
    card.className = "bar-card";
    card.dataset.bar = String(barIndex);

    const head = document.createElement("div");
    head.className = "bar-head";
    const title = document.createElement("h3");
    title.textContent = "Bar " + (barIndex + 1);
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "text-btn";
    reset.dataset.action = "reset-bar";
    reset.dataset.bar = String(barIndex);
    reset.textContent = "Straight quarters";
    head.append(title, reset);

    const row = document.createElement("div");
    row.className = "beat-row";
    let beat = 0;
    bar.forEach((slot, slotIndex) => {
      const span = spanOf(slot.subdivision);
      const meta = SUBDIVISION_META[slot.subdivision];
      const where = span === 2 ? "Beats " + (beat + 1) + "–" + (beat + 2) : "Beat " + (beat + 1);
      const cell = document.createElement("div");
      cell.className = "beat-cell" + (span === 2 ? " is-pair" : "");
      cell.dataset.bar = String(barIndex);
      cell.dataset.slot = String(slotIndex);

      const main = document.createElement("button");
      main.type = "button";
      main.className = "beat-main";
      main.dataset.action = "cycle-sub";
      main.dataset.bar = String(barIndex);
      main.dataset.slot = String(slotIndex);
      const mainHint = slot.subdivision === "qtriplet"
        ? "Tap to split into quarter notes."
        : "Tap to change subdivision.";
      main.setAttribute("aria-label", "Bar " + (barIndex + 1) + ", " + where + ", " + meta.name + ". " + mainHint);

      const num = document.createElement("span");
      num.className = "beat-num-sm";
      num.textContent = meta.num;
      const name = document.createElement("span");
      name.className = "beat-name";
      name.textContent = meta.name;
      const place = document.createElement("span");
      place.className = "beat-where";
      place.textContent = where;
      main.append(num, name, place);

      const pips = document.createElement("div");
      pips.className = "pip-row";
      slot.accents.forEach((accent, clickIndex) => {
        const pip = document.createElement("button");
        pip.type = "button";
        pip.className = "pip " + (accent === 2 ? "is-accent" : accent === 0 ? "is-soft" : "is-normal");
        pip.dataset.action = "cycle-accent";
        pip.dataset.bar = String(barIndex);
        pip.dataset.slot = String(slotIndex);
        pip.dataset.click = String(clickIndex);
        pip.setAttribute(
          "aria-label",
          "Bar " + (barIndex + 1) + " " + meta.name + " click " + (clickIndex + 1) + ", " + accentName(accent) + ". Tap to change accent.",
        );
        pips.append(pip);
      });

      cell.append(main, pips);
      const following = bar[slotIndex + 1];
      if (slot.subdivision === "qtriplet" || (following && following.subdivision !== "qtriplet")) {
        const pair = document.createElement("button");
        pair.type = "button";
        pair.className = "text-btn pair-btn";
        pair.dataset.bar = String(barIndex);
        pair.dataset.slot = String(slotIndex);
        if (slot.subdivision === "qtriplet") {
          pair.dataset.action = "split-pair";
          pair.textContent = "Split into quarters";
          pair.setAttribute("aria-label", "Split bar " + (barIndex + 1) + " " + where + " into quarter notes");
        } else {
          pair.dataset.action = "pair-next";
          pair.textContent = "Triplet across 2 beats";
          pair.setAttribute(
            "aria-label",
            "Replace beats " + (beat + 1) + " and " + (beat + 2) + " with a quarter-note triplet",
          );
        }
        cell.append(pair);
      }
      row.append(cell);
      beat += span;
    });

    card.append(head, row);
    els.pattern.append(card);
  });
}

function syncControls() {
  if (document.activeElement !== els.tempo) els.tempo.value = String(config.tempo);
  els.bpm.textContent = String(config.tempo);
  els.sigLabel.textContent = signatureLabel(config.beatsPerBar, config.beatUnit);
  els.beatsValue.textContent = String(config.beatsPerBar);
  els.barsValue.textContent = String(config.bars.length);
  els.beatsDec.disabled = config.beatsPerBar <= BEATS_MIN;
  els.beatsInc.disabled = config.beatsPerBar >= BEATS_MAX;
  els.barsDec.disabled = config.bars.length <= BARS_MIN;
  els.barsInc.disabled = config.bars.length >= BARS_MAX;
  els.unit4.setAttribute("aria-pressed", config.beatUnit === 4 ? "true" : "false");
  els.unit8.setAttribute("aria-pressed", config.beatUnit === 8 ? "true" : "false");
  els.sigChips.querySelectorAll(".chip").forEach((chip) => {
    const on = Number(chip.dataset.beats) === config.beatsPerBar && Number(chip.dataset.unit) === config.beatUnit;
    chip.setAttribute("aria-pressed", on ? "true" : "false");
  });
  syncVolume();
}

function syncVolume() {
  if (document.activeElement !== els.volume) els.volume.value = String(config.volume);
  els.volume.setAttribute("aria-valuenow", String(config.volume));
  els.volLabel.textContent = config.volume + "%";
}

function updateDirty() {
  if (!presetId) {
    els.dirtyLabel.textContent = "Not saved yet";
    return;
  }
  const preset = library.get(presetId);
  els.dirtyLabel.textContent = preset && sameMusic(preset, config)
    ? "Matches the saved preset"
    : "Unsaved changes";
}

function renderPresets() {
  const builtin = presetId === BUILTIN_ID;
  const unsaved = !presetId;
  els.saveBtn.textContent = builtin || unsaved ? "Save a copy" : "Save";
  els.renameBtn.disabled = builtin || unsaved;
  els.deleteBtn.disabled = builtin || unsaved;
  if (!deleteArmed) els.deleteBtn.textContent = "Delete";
  updateDirty();
  els.presetList.replaceChildren();
  for (const preset of library.list()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset" + (preset.id === presetId ? " is-active" : "");
    button.dataset.action = "load-preset";
    button.dataset.id = preset.id;
    const name = document.createElement("span");
    name.className = "preset-name";
    name.textContent = preset.name;
    const meta = document.createElement("span");
    meta.className = "preset-meta";
    const bits = [
      preset.tempo + " BPM",
      signatureLabel(preset.beatsPerBar, preset.beatUnit),
      preset.bars.length + (preset.bars.length === 1 ? " bar" : " bars"),
    ];
    if (preset.builtin) bits.push("Built in");
    meta.textContent = bits.join(" · ");
    button.append(name, meta);
    if (preset.blurb) {
      const blurb = document.createElement("span");
      blurb.className = "preset-blurb";
      blurb.textContent = preset.blurb;
      button.append(blurb);
    }
    els.presetList.append(button);
  }
}

function onPresetClick(event) {
  const button = event.target.closest("button[data-action='load-preset']");
  if (!button) return;
  loadPreset(button.dataset.id);
}

function loadPreset(id) {
  const preset = library.get(id);
  if (!preset) {
    setMessage("That preset is no longer saved.");
    renderPresets();
    return;
  }
  presetId = id;
  els.presetName.value = preset.name;
  commit(preset, { patternChanged: true, tempoChanged: true });
  renderPresets();
  setMessage("Loaded “" + preset.name + "”.");
}

function savePreset() {
  const name = cleanName(els.presetName.value);
  if (!name) {
    setMessage("Name the preset before saving.");
    els.presetName.focus();
    return;
  }
  if (presetId && presetId !== BUILTIN_ID) {
    const result = library.update(presetId, config, name);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setMessage("Saved “" + name + "”.");
  } else {
    const result = library.saveNew(config, name);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    presetId = result.preset.id;
    setMessage("Saved “" + name + "”.");
  }
  renderPresets();
  scheduleSession();
}

function saveAsNew() {
  const name = cleanName(els.presetName.value);
  if (!name) {
    setMessage("Name the preset before saving.");
    els.presetName.focus();
    return;
  }
  const result = library.saveNew(config, name);
  if (!result.ok) {
    setMessage(result.error);
    return;
  }
  presetId = result.preset.id;
  setMessage("Saved “" + name + "”.");
  renderPresets();
  scheduleSession();
}

function renamePreset() {
  if (!presetId || presetId === BUILTIN_ID) {
    setMessage("The built-in pattern cannot be renamed. Save a copy first.");
    return;
  }
  const name = cleanName(els.presetName.value);
  const result = library.rename(presetId, name);
  if (!result.ok) {
    setMessage(result.error);
    return;
  }
  setMessage("Renamed to “" + name + "”.");
  renderPresets();
}

function deletePreset() {
  if (!presetId || presetId === BUILTIN_ID) {
    setMessage("The built-in pattern cannot be deleted.");
    return;
  }
  if (!deleteArmed) {
    deleteArmed = true;
    els.deleteBtn.textContent = "Confirm delete";
    setMessage("Tap confirm delete to remove this preset. The pattern stays on screen.");
    return;
  }
  const result = library.remove(presetId);
  deleteArmed = false;
  els.deleteBtn.textContent = "Delete";
  if (!result.ok) {
    setMessage(result.error);
    return;
  }
  presetId = null;
  setMessage("Preset deleted. This pattern is still on screen until you load another.");
  renderPresets();
  scheduleSession();
}

function disarmDelete() {
  if (!deleteArmed) return;
  deleteArmed = false;
  els.deleteBtn.textContent = "Delete";
}

function setMessage(text) {
  els.message.textContent = text;
}

function announce(text) {
  els.live.textContent = "";
  queueMicrotask(() => {
    els.live.textContent = text;
  });
}

function scheduleSession() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(flushSession, 200);
}

function flushSession() {
  saveSession(storage, { config, presetId, name: els.presetName.value });
}

async function requestWakeLock() {
  if (!running) return;
  if (!("wakeLock" in navigator)) {
    els.wakeNote.textContent = "This browser will not keep the screen awake. Wake Lock needs iPadOS 16.4 or newer.";
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
    if (running) els.wakeNote.textContent = "Screen stays awake while playing.";
  } catch {
    wakeLock = null;
    if (running) els.wakeNote.textContent = "The screen may sleep on this iPad.";
  }
}

async function releaseWakeLock() {
  const current = wakeLock;
  wakeLock = null;
  if (!current) return;
  try { await current.release(); } catch { /* already released */ }
}

async function onVisibility() {
  if (!running) return;
  if (document.visibilityState === "hidden") {
    timerLoop();
    schedule();
    return;
  }
  if (document.visibilityState !== "visible") return;
  timerLoop();
  const ctx = audio.context();
  if (ctx && ctx.state !== "running") {
    try { await ctx.resume(); } catch { /* resume can reject without a gesture */ }
  }
  if (!running) return;
  if (audio.state() !== "running") {
    stop("Sound paused while the app was away. Tap Start to play again.");
    return;
  }
  // Drop clicks queued before the interruption. A jumped audio clock would
  // otherwise play them as a burst. Phase is rebuilt from the anchor.
  const now = audio.currentTime();
  audio.cancelFrom(-Infinity);
  visualEvents = [];
  invalidateDisplay();
  retargetTempo(scheduler, config.tempo, now);
  audio.resumeSilence();
  schedule();
  requestWakeLock();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    els.offline.textContent = "Offline use needs a browser with service workers.";
    return;
  }
  navigator.serviceWorker.register("sw.js").then(() => {
    els.offline.textContent = "Ready offline after this load.";
  }).catch(() => {
    els.offline.textContent = "Offline mode did not install. Open the page over HTTPS and reload.";
  });
}

function updateInstallHint() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (standalone) {
    els.installHint.hidden = true;
    return;
  }
  const touch = navigator.maxTouchPoints > 0;
  els.installHint.hidden = false;
  els.installHint.textContent = touch
    ? "On iPad, tap Share, then Add to Home Screen. It opens full screen and keeps working offline."
    : "Install this page from the browser menu. After the first load it works offline.";
}

try {
  init();
} catch (error) {
  document.body.classList.remove("is-booting");
  const banner = $("bootError");
  if (banner) banner.hidden = false;
  console.error(error);
}
