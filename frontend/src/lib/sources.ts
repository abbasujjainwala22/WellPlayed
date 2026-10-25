/**
 * Client-side check of a pasted link, for instant feedback. The server runs the same rules again
 * (backend/app/sources.py) and has the final say.
 */
import type { MediaKind } from "./types";

const MEDIA_EXT = /\.(mp4|m4v|webm|ogv|ogg|mov|mkv|mp3|m4a|aac|wav|flac|opus)$/i;
const HLS_EXT = /\.m3u8$/i;
const PAGE_EXT = /\.(html?|php|aspx?|jsp|cgi)$/i;
const YT_HOSTS = ["youtube.com", "youtu.be", "youtube-nocookie.com"];
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Streaming services that don't let other sites embed or control their player. */
const PROVIDERS: Record<string, string> = {
  "netflix.com": "Netflix",
  "disneyplus.com": "Disney+",
  "primevideo.com": "Prime Video",
  "tubitv.com": "Tubi",
  "plex.tv": "Plex",
  "max.com": "Max",
  "hbomax.com": "Max",
  "hulu.com": "Hulu",
  "paramountplus.com": "Paramount+",
  "peacocktv.com": "Peacock",
  "crunchyroll.com": "Crunchyroll",
  "stan.com.au": "Stan",
  "binge.com.au": "Binge",
  "iview.abc.net.au": "ABC iview",
  "sbs.com.au": "SBS On Demand",
  "tv.apple.com": "Apple TV+",
};

const on = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export type SourceCheck =
  | { ok: true }
  | { ok: false; message: string }
  | { ok: false; external: true; provider: string; url: string; message: string };

export function providerFor(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (on(host, "amazon.com") || on(host, "amazon.co.uk")) return /\/(gp\/)?video/.test(u.pathname) ? "Prime Video" : null;
  return Object.entries(PROVIDERS).find(([d]) => on(host, d))?.[1] ?? null;
}

export function externalMessage(provider: string): string {
  return `${provider} doesn’t let other sites embed or control its player, so it can’t play in the shared player.`;
}

/** explicit: the user picked the source type by hand, so an extension-less file link is allowed. */
export function checkSource(kind: MediaKind, input: string, explicit = false): SourceCheck {
  const url = input.trim();
  if (!url) return { ok: false, message: "Paste a link first." };
  if (url.length > 2000) return { ok: false, message: "That link is too long." };
  if (kind === "external") return { ok: true };
  if (kind === "youtube" && /^[\w-]{11}$/.test(url)) return { ok: true };

  const provider = providerFor(url);
  if (provider && kind !== "youtube") return { ok: false, external: true, provider, url, message: externalMessage(provider) };

  const relative = !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("//");
  if (relative && kind !== "youtube") return checkPath(kind, url.split(/[?#]/)[0], explicit); // a file on this server
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, message: "Paste a full https:// link." };
  }
  if (u.username || u.password) return { ok: false, message: "Links with a username or password in them aren’t allowed." };
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, message: "Only https:// links are supported." };
  if (u.protocol === "http:" && !LOOPBACK.has(host) && u.host !== location.host)
    return { ok: false, message: "Only secure https:// links are supported." };
  const isYt = YT_HOSTS.some((d) => on(host, d));
  if (kind === "youtube")
    return isYt ? { ok: true } : { ok: false, message: "That isn’t a YouTube link. Copy the link from the video’s Share button." };
  if (isYt) return { ok: false, message: "That’s a YouTube link. Choose YouTube (or Auto-detect) as the source type." };
  return checkPath(kind, u.pathname, explicit);
}

function checkPath(kind: MediaKind, path: string, explicit: boolean): SourceCheck {
  const last = path.split("/").pop() ?? "";
  if (kind === "hls") return HLS_EXT.test(path) || explicit ? { ok: true } : { ok: false, message: "HLS streams need a link ending in .m3u8." };
  if (MEDIA_EXT.test(path) || HLS_EXT.test(path)) return { ok: true };
  if (PAGE_EXT.test(last) || !last || (!explicit && !last.includes(".")))
    return { ok: false, message: "That’s a web page, not a video file. Use a YouTube link or a direct link to a video (.mp4, .webm, .m3u8)." };
  if (!explicit) return { ok: false, message: "That link doesn’t point at a video file this player can open (.mp4, .webm, .mov, .m3u8)." };
  return { ok: true };
}
