import { useEffect, useState, useSyncExternalStore } from "react";

import { api } from "../../lib/api";
import { useSettings } from "../../lib/settings";

/** A GIF or sticker as our server's GIPHY proxy returns it (the API key never reaches the browser). */
export interface GiphyItem {
  id: string;
  kind: "gif" | "sticker";
  title: string;
  w: number;
  h: number;
  url: string;
  still: string;
  preview: string;
  previewStill: string;
}

/** The attachment on a chat message; URLs are built by the server from the GIPHY id. */
export interface ChatMedia {
  provider: "giphy";
  kind: "gif" | "sticker";
  id: string;
  title: string;
  w: number;
  h: number;
  url: string;
  still: string;
}

const MEDIA_HOST = /^https:\/\/media\d*\.giphy\.com\/media\/[A-Za-z0-9]+\//;
const ID = /^[A-Za-z0-9]{1,64}$/;

/** Only ever render images from GIPHY's media CDN; anything else is dropped. */
export function safeMediaUrl(url: unknown): string {
  return typeof url === "string" && MEDIA_HOST.test(url) ? url : "";
}

export function isChatMedia(m: unknown): m is ChatMedia {
  const x = m as ChatMedia | null;
  return !!x && x.provider === "giphy" && (x.kind === "gif" || x.kind === "sticker") && ID.test(String(x.id));
}

/* ───────── Is GIPHY configured on the server? (asked once per page load) ───────── */

let status: Promise<boolean> | null = null;

export function giphyEnabled(): Promise<boolean> {
  status ??= api<{ enabled: boolean }>("/api/giphy")
    .then((r) => r.enabled === true)
    .catch(() => {
      status = null; // offline right now: ask again next time
      return false;
    });
  return status;
}

export function useGiphyEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    giphyEnabled().then((v) => live && setOn(v));
    return () => {
      live = false;
    };
  }, []);
  return on;
}

export function browseGiphy(code: string, token: string, kind: "gif" | "sticker", q: string, offset: number, signal?: AbortSignal) {
  const params = new URLSearchParams({ q, offset: String(offset) });
  return api<{ items: GiphyItem[]; next: number | null }>(`/api/rooms/${code}/giphy/${kind}?${params}`, {
    headers: { "x-member-token": token },
    signal,
  });
}

/* ───────── Reduced motion: the in-app setting or the OS preference ───────── */

const motionQuery = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null);

function subscribeMotion(cb: () => void) {
  const q = motionQuery();
  q?.addEventListener("change", cb);
  return () => q?.removeEventListener("change", cb);
}

export function useReducedMotion(): boolean {
  const app = useSettings((s) => s.reduceMotion);
  const os = useSyncExternalStore(subscribeMotion, () => motionQuery()?.matches === true);
  return app || os;
}
