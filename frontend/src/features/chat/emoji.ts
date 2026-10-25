/**
 * Emoji data for the chat picker.
 *
 * emoji-data.json is a compact copy of Emojibase (emojibase-data 16.0.3, MIT), generated once by
 * scripts/gen-emoji-data.mjs and committed. It ships as a separate hashed asset that is only
 * fetched the first time someone opens the picker, so it never weighs down the main bundle.
 */

import dataUrl from "./emoji-data.json?url";

/** [emoji, label, group, extra search tags, skin tones: 1 = derivable, or the five toned forms] */
type Row = [string, string, number, string, (1 | string[])?];

export interface Emoji {
  emoji: string;
  label: string;
  group: number;
  search: string;
  skins?: 1 | string[];
}

export const GROUPS = [
  "Smileys & emotion",
  "People & body",
  "Animals & nature",
  "Food & drink",
  "Activities",
  "Travel & places",
  "Objects",
  "Symbols",
  "Flags",
] as const;

export const TONES = ["Default", "Light", "Medium-light", "Medium", "Medium-dark", "Dark"] as const;

let loading: Promise<Emoji[]> | null = null;

export function loadEmoji(): Promise<Emoji[]> {
  loading ??= fetch(dataUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`emoji data ${r.status}`);
      return r.json() as Promise<Row[]>;
    })
    .then((rows) =>
      rows.map(([emoji, label, group, tags, skins]) => ({
        emoji,
        label,
        group,
        search: `${label} ${tags}`.toLowerCase(),
        skins,
      })),
    )
    .catch((err) => {
      loading = null; // let a retry try again
      throw err;
    });
  return loading;
}

/** The emoji in a skin tone (1-5), or as-is when it has no tones. */
export function withTone(e: Emoji, tone: number): string {
  if (!tone || !e.skins) return e.emoji;
  if (Array.isArray(e.skins)) return e.skins[tone - 1] ?? e.emoji;
  const cps = [...e.emoji];
  const mod = String.fromCodePoint(0x1f3fa + tone);
  if (cps[1] === "️") cps[1] = mod;
  else cps.splice(1, 0, mod);
  return cps.join("");
}

/* ───────── Recents and skin tone, remembered on this device ───────── */

const RECENT_KEY = "wp:emoji-recent";
const TONE_KEY = "wp:emoji-tone";
const RECENT_MAX = 32;

export function getRecent(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Remember the base emoji (tone applied at render), most recent first. */
export function pushRecent(base: string): string[] {
  const next = [base, ...getRecent().filter((x) => x !== base)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  return next;
}

export function getTone(): number {
  try {
    const t = Number(localStorage.getItem(TONE_KEY));
    return Number.isInteger(t) && t >= 0 && t <= 5 ? t : 0;
  } catch {
    return 0;
  }
}

export function saveTone(t: number): void {
  try {
    localStorage.setItem(TONE_KEY, String(t));
  } catch {
    /* storage unavailable */
  }
}
