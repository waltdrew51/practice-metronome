/**
 * Musical pattern model. Pure data: no DOM and no audio clock.
 * A bar is a list of slots. Each slot is one beat, except `qtriplet`,
 * which is a quarter-note triplet: 3 evenly spaced clicks across 2 beats.
 * Accent levels: 2 accent, 1 normal, 0 soft.
 */

export const TEMPO_MIN = 20;
export const TEMPO_MAX = 300;
export const BEATS_MIN = 1;
export const BEATS_MAX = 12;
export const BARS_MIN = 1;
export const BARS_MAX = 12;

export const BUILTIN_ID = "builtin-quarter-triplet-loop";

export const SUBDIVISION_ORDER = ["quarter", "eighth", "triplet", "sixteenth"];

/** Accent → normal → soft → accent. */
export const ACCENT_RING = [2, 1, 0];

export const SUBDIVISION_META = {
  quarter: { num: "1", name: "Quarter", caption: "1 click" },
  eighth: { num: "2", name: "Eighths", caption: "2 clicks" },
  triplet: { num: "3", name: "Triplet", caption: "3 per beat" },
  sixteenth: { num: "4", name: "Sixteenths", caption: "4 per beat" },
  qtriplet: { num: "3∶2", name: "2-beat triplet", caption: "3 clicks across 2 beats" },
};

export const SUBDIVISION_LABEL = {
  quarter: "Quarter notes",
  eighth: "Eighth notes",
  triplet: "Triplet",
  sixteenth: "Sixteenth notes",
  qtriplet: "Quarter-note triplet",
};

export const SIGNATURES = [
  { label: "2/4", beats: 2, unit: 4 },
  { label: "3/4", beats: 3, unit: 4 },
  { label: "4/4", beats: 4, unit: 4 },
  { label: "5/4", beats: 5, unit: 4 },
  { label: "3/8", beats: 3, unit: 8 },
  { label: "6/8", beats: 6, unit: 8 },
  { label: "7/8", beats: 7, unit: 8 },
  { label: "9/8", beats: 9, unit: 8 },
  { label: "12/8", beats: 12, unit: 8 },
];

export function clampTempo(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 80;
  return Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, Math.round(n)));
}

export function clampVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 70;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export function clampBeats(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 4;
  return Math.min(BEATS_MAX, Math.max(BEATS_MIN, n));
}

export function clampBars(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 4;
  return Math.min(BARS_MAX, Math.max(BARS_MIN, n));
}

export function normalizeBeatUnit(value) {
  return Number(value) === 8 ? 8 : 4;
}

export function clickCount(subdivision) {
  switch (subdivision) {
    case "quarter":
      return 1;
    case "eighth":
      return 2;
    case "triplet":
      return 3;
    case "sixteenth":
      return 4;
    case "qtriplet":
      return 3;
    default:
      return 0;
  }
}

export function spanOf(subdivision) {
  return subdivision === "qtriplet" ? 2 : 1;
}

/** Click offsets in beats from the start of the slot. */
export function clickOffsets(subdivision) {
  switch (subdivision) {
    case "quarter":
      return [0];
    case "eighth":
      return [0, 0.5];
    case "triplet":
      return [0, 1 / 3, 2 / 3];
    case "sixteenth":
      return [0, 0.25, 0.5, 0.75];
    case "qtriplet":
      return [0, 2 / 3, 4 / 3];
    default:
      return [];
  }
}

export function normalizeAccent(value) {
  const n = Number(value);
  if (n === 0 || n === 2) return n;
  return 1;
}

export function nextAccent(value) {
  const current = normalizeAccent(value);
  const index = ACCENT_RING.indexOf(current);
  return ACCENT_RING[(index + 1) % ACCENT_RING.length];
}

export function makeSlot(subdivision, accentFirst = false) {
  const count = clickCount(subdivision);
  if (!count) throw new Error("Unknown subdivision: " + subdivision);
  const accents = [];
  for (let i = 0; i < count; i += 1) accents.push(accentFirst && i === 0 ? 2 : 1);
  return { subdivision, accents };
}

export function cloneSlot(slot) {
  return { subdivision: slot.subdivision, accents: slot.accents.slice() };
}

export function cloneBar(bar) {
  return bar.map(cloneSlot);
}

export function straightBar(beats, accentDownbeat = true) {
  const count = clampBeats(beats);
  const bar = [];
  for (let i = 0; i < count; i += 1) bar.push(makeSlot("quarter", accentDownbeat && i === 0));
  return bar;
}

export function spanSum(bar) {
  let sum = 0;
  for (const slot of bar) sum += spanOf(slot.subdivision);
  return sum;
}

export function beatStartOf(bar, slotIndex) {
  let beat = 0;
  for (let i = 0; i < slotIndex; i += 1) beat += spanOf(bar[i].subdivision);
  return beat;
}

export function cycleSubdivision(bar, index) {
  const next = cloneBar(bar);
  const slot = next[index];
  if (!slot || slot.subdivision === "qtriplet") return next;
  const orderIndex = SUBDIVISION_ORDER.indexOf(slot.subdivision);
  const subdivision = SUBDIVISION_ORDER[(orderIndex + 1) % SUBDIVISION_ORDER.length];
  const replacement = makeSlot(subdivision, false);
  replacement.accents[0] = normalizeAccent(slot.accents[0]);
  next[index] = replacement;
  return next;
}

export function pairWithNext(bar, index) {
  const next = cloneBar(bar);
  const slot = next[index];
  const following = next[index + 1];
  if (!slot || !following) return next;
  if (slot.subdivision === "qtriplet" || following.subdivision === "qtriplet") return next;
  const paired = makeSlot("qtriplet", false);
  paired.accents[0] = normalizeAccent(slot.accents[0]);
  next.splice(index, 2, paired);
  return next;
}

export function splitPair(bar, index) {
  const next = cloneBar(bar);
  const slot = next[index];
  if (!slot || slot.subdivision !== "qtriplet") return next;
  const first = makeSlot("quarter", false);
  first.accents[0] = normalizeAccent(slot.accents[0]);
  next.splice(index, 1, first, makeSlot("quarter", false));
  return next;
}

export function cycleAccent(bar, slotIndex, clickIndex) {
  const next = cloneBar(bar);
  const slot = next[slotIndex];
  if (!slot || clickIndex < 0 || clickIndex >= slot.accents.length) return next;
  slot.accents[clickIndex] = nextAccent(slot.accents[clickIndex]);
  return next;
}

export function resizeBeats(bar, beats) {
  const target = clampBeats(beats);
  const next = cloneBar(bar);
  while (spanSum(next) < target) next.push(makeSlot("quarter", false));
  while (spanSum(next) > target) {
    const lastSpan = spanOf(next[next.length - 1].subdivision);
    if (spanSum(next) - lastSpan >= target) {
      next.pop();
    } else {
      next.pop();
      while (spanSum(next) < target) next.push(makeSlot("quarter", false));
    }
  }
  return next;
}

export function resizeBars(bars, count, beatsPerBar) {
  const target = clampBars(count);
  const beats = clampBeats(beatsPerBar);
  const next = bars.map((bar) => resizeBeats(bar, beats));
  while (next.length < target) next.push(straightBar(beats, true));
  while (next.length > target) next.pop();
  return next;
}

export function setMeter(bars, beatsPerBar, beatUnit) {
  const beats = clampBeats(beatsPerBar);
  return {
    bars: bars.map((bar) => resizeBeats(bar, beats)),
    beatsPerBar: beats,
    beatUnit: normalizeBeatUnit(beatUnit),
  };
}

function slotFromUnknown(input) {
  if (!input || typeof input !== "object") return null;
  const subdivision = input.subdivision;
  const count = clickCount(subdivision);
  if (!count) return null;
  if (!Array.isArray(input.accents) || input.accents.length !== count) return null;
  return {
    subdivision,
    accents: input.accents.map(normalizeAccent),
  };
}

export function normalizeConfig(input) {
  if (!input || typeof input !== "object") return null;
  if (!Number.isFinite(Number(input.beatsPerBar))) return null;
  const beatsPerBar = Math.round(Number(input.beatsPerBar));
  if (beatsPerBar < BEATS_MIN || beatsPerBar > BEATS_MAX) return null;
  if (!Number.isFinite(Number(input.tempo))) return null;
  const tempo = Math.round(Number(input.tempo));
  if (tempo < TEMPO_MIN || tempo > TEMPO_MAX) return null;
  if (!Number.isFinite(Number(input.volume))) return null;
  const volume = Math.round(Number(input.volume));
  if (volume < 0 || volume > 100) return null;
  const beatUnit = Number(input.beatUnit);
  if (beatUnit !== 4 && beatUnit !== 8) return null;
  if (!Array.isArray(input.bars) || input.bars.length < BARS_MIN || input.bars.length > BARS_MAX) {
    return null;
  }
  const bars = [];
  for (const rawBar of input.bars) {
    if (!Array.isArray(rawBar) || rawBar.length === 0) return null;
    const slots = [];
    for (const rawSlot of rawBar) {
      const slot = slotFromUnknown(rawSlot);
      if (!slot) return null;
      slots.push(slot);
    }
    if (spanSum(slots) !== beatsPerBar) return null;
    bars.push(slots);
  }
  return { tempo, volume, beatsPerBar, beatUnit, bars };
}

export function sameMusic(a, b) {
  const left = normalizeConfig(a);
  const right = normalizeConfig(b);
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

export function expandPattern(config) {
  const cfg = normalizeConfig(config);
  if (!cfg) throw new Error("Invalid pattern");
  const events = [];
  cfg.bars.forEach((bar, barIndex) => {
    let cursor = 0;
    bar.forEach((slot, slotIndex) => {
      const offsets = clickOffsets(slot.subdivision);
      const span = spanOf(slot.subdivision);
      offsets.forEach((offset, sub) => {
        const pos = cursor + offset;
        events.push({
          bar: barIndex,
          slot: slotIndex,
          pos,
          beat: Math.floor(pos + 1e-9),
          sub,
          subCount: offsets.length,
          accent: slot.accents[sub],
          kind: slot.subdivision,
          beatStart: cursor,
          span,
        });
      });
      cursor += span;
    });
  });
  return events;
}

export function straightConfig({ tempo = 80, volume = 70, beats = 4, unit = 4, bars = 4, accentDownbeat = true } = {}) {
  const beatsPerBar = clampBeats(beats);
  const barCount = clampBars(bars);
  const pattern = [];
  for (let i = 0; i < barCount; i += 1) pattern.push(straightBar(beatsPerBar, accentDownbeat));
  return normalizeConfig({
    tempo: clampTempo(tempo),
    volume: clampVolume(volume),
    beatsPerBar,
    beatUnit: normalizeBeatUnit(unit),
    bars: pattern,
  });
}

/** The single-file prototype: 4 bars of 4/4 at 80 BPM, volume 70. */
export function builtinConfig() {
  const bar1 = [
    makeSlot("qtriplet", true),
    makeSlot("quarter", false),
    makeSlot("quarter", false),
  ];
  const straight = straightBar(4, true);
  return {
    tempo: 80,
    volume: 70,
    beatsPerBar: 4,
    beatUnit: 4,
    bars: [bar1, cloneBar(straight), cloneBar(straight), cloneBar(straight)],
  };
}

export function builtinPreset() {
  return {
    id: BUILTIN_ID,
    name: "Quarter-triplet loop",
    builtin: true,
    blurb:
      "Bar 1 plays a quarter-note triplet across beats 1–2, then quarters on beats 3–4. Bars 2–4 are quarters. Downbeats are accented.",
    ...builtinConfig(),
  };
}

export function cleanName(name) {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 48);
}

export function signatureLabel(beats, unit) {
  const found = SIGNATURES.find((signature) => signature.beats === beats && signature.unit === unit);
  return found ? found.label : beats + "/" + unit;
}

export function accentName(level) {
  if (level === 2) return "accent";
  if (level === 0) return "soft";
  return "normal";
}
