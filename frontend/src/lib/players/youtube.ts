import type { Media } from "../types";
import type { PlayerAdapter, UserAction } from "./types";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_TIMEOUT_MS = 12_000;
const UNREACHABLE = "Couldn’t reach YouTube. Check your connection, or turn off an ad or content blocker for this site.";

let apiPromise: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  apiPromise ??= new Promise<void>((resolve, reject) => {
    const fail = () => {
      apiPromise = null; // let the next video try again
      reject(new Error(UNREACHABLE));
    };
    const timer = window.setTimeout(fail, API_TIMEOUT_MS);
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timer);
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => {
      window.clearTimeout(timer);
      s.remove();
      fail();
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

/** The 11-character video id from any common YouTube link (watch, youtu.be, shorts, live, embed) or a bare id. */
export function youtubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:[?&]v=|youtu\.be\/|\/embed\/|\/shorts\/|\/live\/|\/v\/)([\w-]{11})/);
  return m ? m[1] : null;
}

export const youtubeThumb = (url: string): string | null => {
  const id = youtubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
};

/** https://developers.google.com/youtube/iframe_api_reference#onError */
const ERRORS: Record<number, string> = {
  2: "That doesn’t look like a valid YouTube video link.",
  5: "This browser can’t play this YouTube video.",
  100: "This video was removed or is private.",
  101: "The owner doesn’t allow this video to be played outside YouTube. Try another video.",
  150: "The owner doesn’t allow this video to be played outside YouTube. Try another video.",
  153: "YouTube refused to play this video here. Try another video.",
};

export class YouTubeAdapter implements PlayerAdapter {
  private player: any;
  private cb: (a: UserAction) => void = () => {};
  private mute = 0;
  private lastPoll = { t: 0, at: Date.now() };
  private poll?: number;
  private endedCb: () => void = () => {};
  private errorCb: (message: string) => void = () => {};
  readonly coarseRate = true; // YouTube rounds rates to 0.25 steps, so a 1.05× nudge would be a no-op
  private buffering = false;
  private host: HTMLElement;

  constructor(container: HTMLElement) {
    this.host = document.createElement("div");
    this.host.style.cssText = "width:100%;height:100%";
    container.appendChild(this.host);
  }

  async load(media: Media): Promise<void> {
    const id = youtubeId(media.url);
    if (!id) throw new Error(ERRORS[2]);
    await loadApi();
    if (this.player) {
      this.silenced(() => this.player.cueVideoById(id));
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const slot = document.createElement("div");
      this.host.appendChild(slot);
      const timer = window.setTimeout(() => reject(new Error(UNREACHABLE)), API_TIMEOUT_MS);
      this.player = new window.YT.Player(slot, {
        width: "100%",
        height: "100%",
        videoId: id,
        playerVars: { playsinline: 1, rel: 0, origin: location.origin },
        events: {
          onReady: () => {
            window.clearTimeout(timer);
            resolve();
          },
          onStateChange: (e: { data: number }) => this.onState(e.data),
          onError: (e: { data: number }) => this.errorCb(ERRORS[e.data] ?? `YouTube couldn’t play this video (error ${e.data}).`),
        },
      });
    });
    this.poll = window.setInterval(() => this.detectSeek(), 400);
  }

  private silenced<T>(fn: () => T, ms = 900): T {
    this.mute = Date.now() + ms;
    return fn();
  }

  private prevState = -1;

  private onState(state: number): void {
    // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
    const prev = this.prevState;
    this.prevState = state;
    this.buffering = state === 3;
    if (state === 0) this.endedCb();
    if (Date.now() < this.mute) return;
    // Only paused -> playing and playing/buffering -> paused are a person's doing. Buffering -> playing after
    // our own seek, or a slow cold start, would otherwise read as "play" and fight the room's timeline.
    if (state === 1 && (prev === 2 || prev === 5 || prev === -1)) this.cb({ action: "play", at: this.getTime() });
    // YouTube can report PAUSED just before ENDED; like the HTML5 player's pause-before-ended, that is not the host
    // pausing, and forwarding it would pause the room before "queue:ended" so it never learns the video finished
    if (state === 2 && (prev === 1 || prev === 3) && !this.atEnd()) this.cb({ action: "pause", at: this.getTime() });
  }

  private atEnd(): boolean {
    const d = this.duration();
    return d > 0 && this.getTime() >= d - 0.5;
  }

  /** YouTube has no seek event: a jump that doesn't match elapsed time is a seek. */
  private detectSeek(): void {
    const now = Date.now();
    const t = this.getTime();
    const expected = this.lastPoll.t + (this.isPlaying() ? ((now - this.lastPoll.at) / 1000) * this.rate() : 0);
    if (Date.now() >= this.mute && Math.abs(t - expected) > 1.5) this.cb({ action: "seek", at: t });
    this.lastPoll = { t, at: now };
  }

  private rate(): number {
    return this.player?.getPlaybackRate?.() ?? 1;
  }

  async play(): Promise<boolean> {
    this.silenced(() => this.player.playVideo(), 2600);
    // A cold player can take a couple of seconds to start; only a player that never moves was blocked.
    for (let waited = 0; waited < 2500; waited += 100) {
      if (this.isPlaying() || this.buffering) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false; // blocked autoplay leaves the player unstarted/paused
  }
  pause(): void {
    this.silenced(() => this.player.pauseVideo());
  }
  seek(s: number): void {
    this.silenced(() => this.player.seekTo(s, true));
  }
  supportsRate(r: number): boolean {
    const rates: number[] | undefined = this.player?.getAvailablePlaybackRates?.();
    return !rates?.length || rates.some((x) => Math.abs(x - r) < 0.01);
  }
  setRate(r: number): void {
    const rates: number[] = this.player.getAvailablePlaybackRates?.() ?? [1];
    this.player.setPlaybackRate(rates.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a)));
  }
  getTime(): number {
    return this.player?.getCurrentTime?.() ?? 0;
  }
  isPlaying(): boolean {
    return this.player?.getPlayerState?.() === 1;
  }
  isBuffering(): boolean {
    return this.buffering;
  }
  duration(): number {
    return this.player?.getDuration?.() ?? 0;
  }
  bufferedAhead(): number {
    const p = this.player;
    if (!p?.getVideoLoadedFraction) return 0;
    return Math.max(0, p.getVideoLoadedFraction() * p.getDuration() - p.getCurrentTime());
  }
  bandwidthKbps(): number | null {
    const dl = (navigator as Navigator & { connection?: { downlink?: number } }).connection?.downlink;
    return dl ? Math.round(dl * 1000) : null;
  }
  onUserAction(cb: (a: UserAction) => void): void {
    this.cb = cb;
  }
  onEnded(cb: () => void): void {
    this.endedCb = cb;
  }
  onError(cb: (message: string) => void): void {
    this.errorCb = cb;
  }
  destroy(): void {
    window.clearInterval(this.poll);
    this.player?.destroy?.();
    this.host.remove();
  }
}
