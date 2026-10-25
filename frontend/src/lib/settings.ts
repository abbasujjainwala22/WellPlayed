import { useSyncExternalStore } from "react";
import { create } from "zustand";

import type { Mode } from "./types";

/* ───────── Device settings (saved on this device only) ───────── */

export type ThemePref = "system" | "dark" | "light";

export interface DeviceSettings {
  theme: ThemePref;
  /** Turns off animations and transitions app-wide (adds `reduce-motion` on <html>). */
  reduceMotion: boolean;
  /** Camera on by default in the voice/video pre-join step. */
  joinCam: boolean;
  /** Microphone on by default in the voice/video pre-join step. */
  joinMic: boolean;
  /** Reely AI avoids spoilers unless asked otherwise. */
  aiSpoilerSafe: boolean;
  /** Soft blip for incoming chat messages from others. */
  chatSound: boolean;
  /** Reely's default personality. */
  reelyVibe: ReelyVibe;
  /** Opt-in timed prompts from Reely (after your first message, only while the chat is visible). */
  reelyTimed: boolean;
  /** Minutes between timed prompts: 3, 5 or 10. */
  reelyEvery: number;
}

export type ReelyVibe = "quiet" | "normal" | "chaotic";
export const REELY_INTERVALS = [3, 5, 10] as const;

interface SettingsStore extends DeviceSettings {
  set: (p: Partial<DeviceSettings>) => void;
}

const KEY = "wp:settings";

export const DEFAULT_SETTINGS: DeviceSettings = {
  theme: "system",
  reduceMotion: false,
  joinCam: false,
  joinMic: true,
  aiSpoilerSafe: true,
  chatSound: false,
  reelyVibe: "normal",
  reelyTimed: false,
  reelyEvery: 5,
};

/** Reely's personality used to live in its own key; carry it over once. */
function legacyReelyVibe(): unknown {
  try {
    return (JSON.parse(localStorage.getItem("wp:reely") ?? "{}") as { vibe?: unknown }).vibe;
  } catch {
    return undefined;
  }
}

function load(): DeviceSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<DeviceSettings>;
    const out = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof DeviceSettings)[]) {
      if (raw && typeof raw[k] === typeof DEFAULT_SETTINGS[k]) (out as Record<string, unknown>)[k] = raw[k];
    }
    if (!["system", "dark", "light"].includes(out.theme)) out.theme = "system";
    if (raw?.reelyVibe === undefined) out.reelyVibe = legacyReelyVibe() as ReelyVibe;
    if (!["quiet", "normal", "chaotic"].includes(out.reelyVibe)) out.reelyVibe = "normal";
    if (!(REELY_INTERVALS as readonly number[]).includes(out.reelyEvery)) out.reelyEvery = 5;
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function persist(s: DeviceSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

const pick = (s: SettingsStore): DeviceSettings => ({
  theme: s.theme,
  reduceMotion: s.reduceMotion,
  joinCam: s.joinCam,
  joinMic: s.joinMic,
  aiSpoilerSafe: s.aiSpoilerSafe,
  chatSound: s.chatSound,
  reelyVibe: s.reelyVibe,
  reelyTimed: s.reelyTimed,
  reelyEvery: s.reelyEvery,
});

export const useSettings = create<SettingsStore>((set, get) => ({
  ...load(),
  set: (p) => {
    set(p);
    persist(pick(get()));
  },
}));

/** Non-hook read for event handlers and other stores. */
export const getSettings = (): DeviceSettings => pick(useSettings.getState());

/* ───────── Theme ───────── */

const darkQuery = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null);

export function resolveTheme(theme: ThemePref): "dark" | "light" {
  if (theme !== "system") return theme;
  return darkQuery()?.matches === false ? "light" : "dark";
}

function subscribeSystem(cb: () => void) {
  const q = darkQuery();
  q?.addEventListener("change", cb);
  return () => q?.removeEventListener("change", cb);
}

/** The theme actually on screen ("system" resolved against the OS setting). */
export function useResolvedTheme(): "dark" | "light" {
  const theme = useSettings((s) => s.theme);
  const systemDark = useSyncExternalStore(subscribeSystem, () => darkQuery()?.matches !== false);
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

function apply(s: DeviceSettings): void {
  const root = document.documentElement;
  const resolved = resolveTheme(s.theme);
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  root.classList.toggle("reduce-motion", s.reduceMotion);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "light" ? "#f3f1e9" : "#151d2b");
}

let started = false;
/** Call once before the first render: applies theme + motion and keeps them in sync (OS changes, other tabs). */
export function initSettings(): void {
  apply(getSettings());
  if (started) return;
  started = true;
  useSettings.subscribe((s) => apply(pick(s)));
  subscribeSystem(() => apply(getSettings()));
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) useSettings.setState(load());
  });
}

/* ───────── Recent rooms (code + name only, never the member token) ───────── */

export interface RecentRoom {
  code: string;
  name: string;
  mode: Mode;
  at: number;
  /** The display name you used there, to prefill "Rejoin" (the session itself is per tab). */
  as?: string;
}

const RECENT_KEY = "wp:recent";
const RECENT_MAX = 6;

export function getRecent(): RecentRoom[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    if (!Array.isArray(list)) return [];
    return list
      .filter((r): r is RecentRoom => r && typeof r.code === "string" && typeof r.name === "string")
      .slice(0, RECENT_MAX)
      .map(({ code, name, mode, at, as }) => ({ code, name, mode, at: Number(at) || 0, as: typeof as === "string" ? as : undefined }));
  } catch {
    return [];
  }
}

/** The name you last used in this room on this device, if any. */
export function recentName(code: string): string | undefined {
  return getRecent().find((r) => r.code === code.toUpperCase())?.as;
}

export function addRecent(r: { code: string; name: string; mode: Mode; as?: string }): void {
  try {
    const code = r.code.toUpperCase();
    const as = r.as ?? getRecent().find((x) => x.code === code)?.as;
    const entry: RecentRoom = { code, name: r.name || "Watch party", mode: r.mode, at: Date.now(), as };
    const list = [entry, ...getRecent().filter((x) => x.code !== code)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

export function clearRecent(): void {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* storage unavailable */
  }
}
