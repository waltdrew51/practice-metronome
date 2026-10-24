/**
 * Preset library and the working session, stored in localStorage.
 * The built-in quarter-triplet loop is always taken from code, so an
 * older saved copy cannot replace it.
 */

import { BUILTIN_ID, builtinPreset, cleanName, normalizeConfig } from "./pattern.js";

export const PRESET_KEY = "metronome.presets.v1";
export const SESSION_KEY = "metronome.session.v1";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function newId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return "user-" + cryptoApi.randomUUID();
  }
  return "user-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export function createLibrary(storage) {
  let persistent = true;
  let overlay = null;

  function readRaw() {
    if (overlay !== null) return overlay || null;
    try {
      return storage.getItem(PRESET_KEY);
    } catch {
      persistent = false;
      overlay = "";
      return null;
    }
  }

  function writeRaw(value) {
    try {
      storage.setItem(PRESET_KEY, value);
      if (overlay !== null) overlay = value;
    } catch {
      persistent = false;
      overlay = value;
    }
  }

  function userRecords() {
    const raw = readRaw();
    if (!raw) return [];
    try {
      const data = JSON.parse(raw);
      const list = Array.isArray(data?.presets) ? data.presets : [];
      const records = [];
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        if (item.builtin || item.id === BUILTIN_ID) continue;
        if (typeof item.id !== "string" || !item.id) continue;
        const name = cleanName(item.name);
        const config = normalizeConfig(item);
        if (!name || !config) continue;
        records.push({ id: item.id, name, builtin: false, ...config });
      }
      return records;
    } catch {
      return [];
    }
  }

  function persist(users) {
    writeRaw(JSON.stringify({ v: 1, presets: users }));
  }

  function list() {
    return [clone(builtinPreset()), ...userRecords().map(clone)];
  }

  function get(id) {
    if (!id) return null;
    if (id === BUILTIN_ID) return clone(builtinPreset());
    const found = userRecords().find((preset) => preset.id === id);
    return found ? clone(found) : null;
  }

  function saveNew(config, name) {
    const cfg = normalizeConfig(config);
    const cleaned = cleanName(name);
    if (!cfg) return { ok: false, error: "That pattern is not valid." };
    if (!cleaned) return { ok: false, error: "Name the preset before saving." };
    const preset = { id: newId(), name: cleaned, builtin: false, ...cfg };
    const users = userRecords();
    users.unshift(preset);
    persist(users);
    return { ok: true, preset: clone(preset) };
  }

  function update(id, config, name) {
    if (id === BUILTIN_ID) {
      return {
        ok: false,
        error: "The built-in pattern stays as it shipped. Save a copy to keep your changes.",
      };
    }
    const cfg = normalizeConfig(config);
    const cleaned = cleanName(name);
    if (!cfg) return { ok: false, error: "That pattern is not valid." };
    if (!cleaned) return { ok: false, error: "Name the preset before saving." };
    const users = userRecords();
    const index = users.findIndex((preset) => preset.id === id);
    if (index < 0) return { ok: false, error: "That preset is no longer saved." };
    users[index] = { id, name: cleaned, builtin: false, ...cfg };
    persist(users);
    return { ok: true, preset: clone(users[index]) };
  }

  function rename(id, name) {
    if (id === BUILTIN_ID) {
      return { ok: false, error: "The built-in pattern cannot be renamed." };
    }
    const cleaned = cleanName(name);
    if (!cleaned) return { ok: false, error: "Enter a name." };
    const users = userRecords();
    const index = users.findIndex((preset) => preset.id === id);
    if (index < 0) return { ok: false, error: "That preset is no longer saved." };
    users[index] = { ...users[index], name: cleaned };
    persist(users);
    return { ok: true, preset: clone(users[index]) };
  }

  function remove(id) {
    if (id === BUILTIN_ID) {
      return { ok: false, error: "The built-in pattern cannot be deleted." };
    }
    const users = userRecords();
    const next = users.filter((preset) => preset.id !== id);
    if (next.length === users.length) {
      return { ok: false, error: "That preset is no longer saved." };
    }
    persist(next);
    return { ok: true };
  }

  return {
    list,
    get,
    saveNew,
    update,
    rename,
    remove,
    get persistent() {
      return persistent;
    },
  };
}

export function loadSession(storage) {
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const config = normalizeConfig(data);
    if (!config) return null;
    const presetId = typeof data.presetId === "string" ? data.presetId : null;
    const name = cleanName(data.name);
    return { config, presetId, name };
  } catch {
    return null;
  }
}

export function saveSession(storage, session) {
  const config = normalizeConfig(session?.config);
  if (!config) return false;
  const payload = {
    ...config,
    presetId: session.presetId || null,
    name: cleanName(session.name),
  };
  try {
    storage.setItem(SESSION_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}
