import type { Session } from "./types";

/** Backend origin when the web app is hosted elsewhere (e.g. https://api.example.com). Empty means same origin. */
export const API_BASE: string = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

/**
 * An API failure that keeps the HTTP status, so callers can tell "ended" (410) from "full" (403), plus the
 * server's machine-readable `code` (e.g. "room_full") and the request id people can quote when reporting it.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
  }

  /** Short reference for support, e.g. "3f9a2c1b". */
  get ref(): string | undefined {
    return this.requestId?.slice(0, 8);
  }
}

/** A message for people to read, with the short reference id when there is one. */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return e instanceof ApiError && e.ref ? `${msg} (ref ${e.ref})` : msg;
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    });
  } catch {
    throw new ApiError("We couldn’t reach WellPlayed. Check your connection and try again.", 0, "network_error");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const fallback =
      res.status === 429
        ? "You're doing that too often. Please wait a moment."
        : res.status >= 500
          ? "Something went wrong on our side. Please try again."
          : `Request failed (${res.status})`;
    const requestId = (typeof body.requestId === "string" && body.requestId) || res.headers.get("X-Request-Id") || undefined;
    throw new ApiError(typeof body.detail === "string" ? body.detail : fallback, res.status, body.code, requestId);
  }
  return res.json() as Promise<T>;
}

/* ───────── Member session (tab-scoped) ─────────
 * The session token lives in sessionStorage: it survives a refresh, but each tab is its own member, leaving in
 * one tab doesn't knock out another, and the token doesn't linger on a shared computer once the tab is closed.
 * The "recent rooms" list in localStorage (lib/settings) keeps only the code, room name and your display name. */

const key = (code: string) => `wp:session:${normalizeCode(code)}`;
const memory = new Map<string, Session>(); // for when sessionStorage is blocked

/** Room codes as the server sees them: upper case, letters and digits only. */
export function normalizeCode(code: string): string {
  return (code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function saveSession(s: Session): void {
  memory.set(key(s.code), s);
  try {
    sessionStorage.setItem(key(s.code), JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
  clearJoinKey(s.code);
}

export function clearSession(code: string): void {
  memory.delete(key(code));
  try {
    sessionStorage.removeItem(key(code));
    localStorage.removeItem(key(code)); // sessions saved before they became tab-scoped
  } catch {
    /* storage unavailable */
  }
}

export function loadSession(code: string): Session | null {
  const k = key(code);
  try {
    const raw = sessionStorage.getItem(k);
    if (raw) return JSON.parse(raw) as Session;
    // one-time move of a session saved by an older version, so an open party survives the update
    const legacy = localStorage.getItem(k);
    if (legacy) {
      localStorage.removeItem(k);
      sessionStorage.setItem(k, legacy);
      return JSON.parse(legacy) as Session;
    }
  } catch {
    /* storage unavailable, or a corrupt entry */
  }
  return memory.get(k) ?? null;
}

/** A random key per tab and room, kept until the join succeeds, so a retried join returns the same seat. */
export function joinKey(code: string): string {
  const k = `wp:join-key:${normalizeCode(code)}`;
  try {
    const saved = sessionStorage.getItem(k);
    if (saved) return saved;
  } catch {
    /* storage unavailable */
  }
  const fresh = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    sessionStorage.setItem(k, fresh);
  } catch {
    /* storage unavailable: the key still covers retries within this page */
  }
  return fresh;
}

function clearJoinKey(code: string): void {
  try {
    sessionStorage.removeItem(`wp:join-key:${normalizeCode(code)}`);
  } catch {
    /* storage unavailable */
  }
}

export const LANGUAGES: Record<string, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  hi: "हिन्दी",
  ml: "മലയാളം",
  ar: "العربية",
  zh: "中文",
  ja: "日本語",
};

const LANG_KEY = "wp:language";

/** The language chosen in Settings, else the browser's (if supported), else English. */
export function preferredLanguage(): string {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && saved in LANGUAGES) return saved;
  } catch {
    /* storage unavailable */
  }
  const l = navigator.language.slice(0, 2);
  return l in LANGUAGES ? l : "en";
}

export function setPreferredLanguage(lang: string): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* storage unavailable */
  }
}
