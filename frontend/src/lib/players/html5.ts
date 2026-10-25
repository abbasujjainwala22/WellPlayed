import type { Media } from "../types";
import type { PlayerAdapter, UserAction } from "./types";

export class Html5Adapter implements PlayerAdapter {
  readonly video = document.createElement("video");
  private cb: (a: UserAction) => void = () => {};
  private mute = 0; // timestamp until which events are our own doing
  private hls: { destroy(): void; latency?: number; bandwidthEstimate?: number; config?: { maxBufferLength: number } } | null = null;
  private waiting = false;

  constructor(container: HTMLElement) {
    this.video.controls = false; // WellPlayed draws its own synced controls
    this.video.playsInline = true;
    this.video.style.cssText = "width:100%;height:100%;background:var(--stage-bg, #000)";
    container.appendChild(this.video);
    const v = this.video;
    v.addEventListener("play", () => this.user("play"));
    // reaching the end fires "pause" before "ended"; that is not the host pausing, and forwarding it would beat
    // the "queue:ended" report so the room never learns the video finished
    v.addEventListener("pause", () => !v.ended && this.user("pause"));
    v.addEventListener("seeked", () => this.user("seek"));
    v.addEventListener("waiting", () => (this.waiting = true));
    v.addEventListener("playing", () => (this.waiting = false));
  }

  private user(action: UserAction["action"]): void {
    if (Date.now() < this.mute) return;
    this.cb({ action, at: this.video.currentTime });
  }

  private silenced<T>(fn: () => T, ms = 700): T {
    this.mute = Date.now() + ms;
    return fn();
  }

  async load(media: Media): Promise<void> {
    this.hls?.destroy();
    this.hls = null;
    if (media.kind === "hls" && !this.video.canPlayType("application/vnd.apple.mpegurl")) {
      const { default: Hls } = await import("hls.js");
      if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(media.url);
        hls.attachMedia(this.video);
        this.hls = hls;
        return;
      }
    }
    this.video.src = media.url;
  }

  async play(): Promise<boolean> {
    try {
      await this.silenced(() => this.video.play());
      return true;
    } catch {
      return false;
    }
  }
  pause(): void {
    this.silenced(() => this.video.pause());
  }
  seek(s: number): void {
    this.silenced(() => (this.video.currentTime = s));
  }
  setRate(r: number): void {
    this.video.playbackRate = r;
  }
  getTime(): number {
    return this.video.currentTime;
  }
  isPlaying(): boolean {
    return !this.video.paused && !this.video.ended;
  }
  isBuffering(): boolean {
    return this.waiting;
  }
  duration(): number {
    return Number.isFinite(this.video.duration) ? this.video.duration : 0;
  }
  bufferedAhead(): number {
    const v = this.video;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.currentTime >= v.buffered.start(i) && v.currentTime <= v.buffered.end(i)) {
        return v.buffered.end(i) - v.currentTime;
      }
    }
    return 0;
  }
  bandwidthKbps(): number | null {
    const b = this.hls?.bandwidthEstimate;
    if (b && Number.isFinite(b)) return Math.round(b / 1000);
    const dl = (navigator as Navigator & { connection?: { downlink?: number } }).connection?.downlink;
    return dl ? Math.round(dl * 1000) : null;
  }
  boost(seconds: number): void {
    this.video.preload = "auto";
    if (this.hls?.config) this.hls.config.maxBufferLength = Math.max(this.hls.config.maxBufferLength, seconds);
  }
  liveLatency(): number | null {
    const l = this.hls?.latency;
    return typeof l === "number" && Number.isFinite(l) ? l : null;
  }
  onUserAction(cb: (a: UserAction) => void): void {
    this.cb = cb;
  }
  onEnded(cb: () => void): void {
    this.video.addEventListener("ended", cb);
  }
  onError(cb: (message: string) => void): void {
    this.video.addEventListener("error", () =>
      cb("This video couldn’t be loaded. Check that the link points straight at a video file (.mp4, .webm) or an HLS stream (.m3u8)."),
    );
  }
  destroy(): void {
    this.hls?.destroy();
    this.video.remove();
  }
}
