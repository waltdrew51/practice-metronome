/**
 * Web Audio clicks. Oscillators are started at a scheduled AudioContext
 * time, which is sample-accurate. The master gain is the volume slider,
 * so a volume change does not rebuild the pattern.
 *
 * Pitches and relative levels follow the original prototype:
 * accent 1500 Hz at 0.9, quarter-note triplet 1100 Hz at 0.6, other
 * normal clicks 900 Hz at 0.6. With the slider at 70% the accent level
 * matches the prototype's volume * 0.9.
 *
 * The envelope is shorter than the prototype (about 30 ms) so sixteenths
 * at fast tempos stay separate clicks.
 *
 * iOS will not start audio without a user gesture, and the silent switch
 * can mute Web Audio. A looping silent <audio> element started in the
 * same gesture switches the session toward media playback.
 */

export function clickVoice(event) {
  if (event.accent >= 2) return { freq: 1500, amp: 0.9 };
  if (event.accent <= 0) return { freq: 740, amp: 0.22 };
  if (event.kind === "qtriplet" || event.kind === "triplet") return { freq: 1100, amp: 0.6 };
  return { freq: 900, amp: 0.6 };
}

/** 0.1 s of 8-bit PCM silence. Unsigned silence is 128, not 0. */
export function silentWavBytes() {
  const samples = 800;
  const bytes = new Uint8Array(44 + samples);
  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i);
  };
  const write16 = (offset, value) => {
    bytes[offset] = value & 255;
    bytes[offset + 1] = (value >> 8) & 255;
  };
  const write32 = (offset, value) => {
    write16(offset, value & 0xffff);
    write16(offset + 2, (value >>> 16) & 0xffff);
  };
  writeString(0, "RIFF");
  write32(4, 36 + samples);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  write32(16, 16);
  write16(20, 1);
  write16(22, 1);
  write32(24, 8000);
  write32(28, 8000);
  write16(32, 1);
  write16(34, 8);
  writeString(36, "data");
  write32(40, samples);
  bytes.fill(128, 44);
  return bytes;
}

function silentWavUrl() {
  const bytes = silentWavBytes();
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return "data:audio/wav;base64," + btoa(binary);
}

export function createAudioEngine() {
  let ctx = null;
  let master = null;
  let volume = 0.7;
  let silence = null;
  /** @type {{ osc: OscillatorNode, gain: GainNode, time: number }[]} */
  let nodes = [];

  function ensure() {
    if (ctx) return ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    try {
      ctx = new AudioCtx({ latencyHint: "interactive" });
    } catch {
      ctx = new AudioCtx();
    }
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    return ctx;
  }

  function setVolume(value) {
    volume = Math.min(1, Math.max(0, Number(value) || 0));
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    try {
      master.gain.setTargetAtTime(volume, now, 0.015);
    } catch {
      master.gain.value = volume;
    }
  }

  function startSilence() {
    if (!silence) {
      silence = new Audio(silentWavUrl());
      silence.loop = true;
      silence.preload = "auto";
      silence.setAttribute("playsinline", "");
      silence.setAttribute("webkit-playsinline", "");
    }
    const pending = silence.play();
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  }

  function unlock() {
    const context = ensure();
    const pending = context.resume();
    startSilence();
    const buffer = context.createBuffer(1, 1, context.sampleRate);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    try {
      source.start(0);
    } catch {
      /* Already started or the context is closing. */
    }
    if (master) master.gain.value = volume;
    return pending;
  }

  function playClick(event) {
    if (!ctx || !master || !event || !Number.isFinite(event.time)) return;
    if (event.time < ctx.currentTime - 0.05) return;
    const voice = clickVoice(event);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(voice.freq, event.time);
    gain.gain.setValueAtTime(Math.max(voice.amp, 0.0001), event.time);
    gain.gain.exponentialRampToValueAtTime(0.001, event.time + 0.03);
    osc.connect(gain);
    gain.connect(master);
    osc.start(event.time);
    osc.stop(event.time + 0.034);
    const node = { osc, gain, time: event.time };
    nodes.push(node);
    osc.onended = () => {
      try { osc.disconnect(); } catch { /* already disconnected */ }
      try { gain.disconnect(); } catch { /* already disconnected */ }
      const index = nodes.indexOf(node);
      if (index >= 0) nodes.splice(index, 1);
    };
  }

  function cancelFrom(time) {
    const keep = [];
    for (const node of nodes) {
      if (node.time > time) {
        try { node.osc.onended = null; } catch { /* node already gone */ }
        try { node.osc.stop(0); } catch { /* not started or already stopped */ }
        try { node.osc.disconnect(); } catch { /* already disconnected */ }
        try { node.gain.disconnect(); } catch { /* already disconnected */ }
      } else if (!ctx || node.time > ctx.currentTime - 1) {
        keep.push(node);
      }
    }
    nodes = keep;
  }

  return {
    ensure,
    context: () => ctx,
    state: () => (ctx ? ctx.state : "closed"),
    currentTime() {
      return ctx ? ctx.currentTime : 0;
    },
    heardNow() {
      if (!ctx) return 0;
      const output = ctx.outputLatency;
      const extra = typeof output === "number" && output > 0 && output < 0.5 ? output : 0;
      return ctx.currentTime - extra;
    },
    setVolume,
    unlock,
    suspend() {
      if (ctx && ctx.state === "running") return ctx.suspend();
      return Promise.resolve();
    },
    resume() {
      if (!ctx) return Promise.resolve();
      return ctx.resume();
    },
    playClick,
    cancelFrom,
    pauseSilence() {
      if (silence) silence.pause();
    },
    resumeSilence() {
      if (silence && silence.paused) {
        const pending = silence.play();
        if (pending && typeof pending.catch === "function") pending.catch(() => {});
      }
    },
  };
}
