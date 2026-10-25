import type { Media, MediaKind } from "../types";
import { Html5Adapter } from "./html5";
import type { PlayerAdapter } from "./types";
import { YouTubeAdapter } from "./youtube";

export type { PlayerAdapter, UserAction } from "./types";

export function createAdapter(kind: MediaKind, container: HTMLElement): PlayerAdapter | null {
  if (kind === "youtube") return new YouTubeAdapter(container);
  if (kind === "html5" || kind === "hls") return new Html5Adapter(container);
  return null; // "external": played in the viewer's own tab via the browser extension
}

/** The title to show. Until the server has looked up a YouTube title, don't show the raw link. */
export function mediaTitle(media: Pick<Media, "kind" | "url" | "title">): string {
  return media.kind === "youtube" && media.title === media.url ? "YouTube video" : media.title;
}

export function guessMedia(url: string): Pick<Media, "kind" | "url"> {
  if (/youtu\.?be/.test(url) || /^[\w-]{11}$/.test(url.trim())) return { kind: "youtube", url };
  if (/\.m3u8(\?|$)/.test(url)) return { kind: "hls", url };
  return { kind: "html5", url };
}
