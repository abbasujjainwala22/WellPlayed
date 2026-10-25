import type { Media } from "../types";

export interface UserAction {
  action: "play" | "pause" | "seek";
  at: number;
}

export interface PlayerAdapter {
  load(media: Media): Promise<void>;
  /** Resolves false if the browser blocked playback (autoplay policy). */
  play(): Promise<boolean>;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  getTime(): number;
  isPlaying(): boolean;
  isBuffering(): boolean;
  bufferedAhead(): number;
  duration(): number;
  /** Seconds behind the stream's live edge, when the player can tell (HLS). */
  liveLatency?(): number | null;
  /** Estimated download bandwidth in kbps, when known. */
  bandwidthKbps?(): number | null;
  /** Preload further ahead (the group is protecting its weakest connection). */
  boost?(seconds: number): void;
  /** Fires only for user-initiated changes, never for our own programmatic commands. */
  onUserAction(cb: (a: UserAction) => void): void;
  onEnded?(cb: () => void): void;
  /** Fires when the source can't be played (blocked embed, missing video, unreachable API). */
  onError?(cb: (message: string) => void): void;
  /** False when this player can't play at the given speed (e.g. a YouTube video without that rate). */
  supportsRate?(rate: number): boolean;
  /** True when the player rounds playback rates to coarse steps (YouTube), so drift must be fixed by seeking. */
  coarseRate?: boolean;
  destroy(): void;
}
