import type { PlayerAdapter } from "../players";
import { COARSE_SEEK_S, type DriftAction, DRIFT_SEEK_S, driftAction, expectedPosition } from "../sync-core";
import type { Timeline } from "../types";
import type { RoomSocket } from "../socket";

export interface SyncStatus {
  driftMs: number;
  needsGesture: boolean;
  state: Timeline["state"];
  position: number;
  /** The room plays at a speed this player can't match, so it keeps catching up by seeking. */
  rateLimited?: boolean;
}

/** Keeps a local player glued to the room timeline and forwards user actions. */
export class SyncController {
  private timeline: Timeline | null = null;
  private timer?: number;
  needsGesture = false;
  canControl = false;
  onStatus: (s: SyncStatus) => void = () => {};
  /** A viewer without control tried to play, pause or seek; the loop is pulling them back. */
  onBlocked: () => void = () => {};
  private busy = false; // ticks are async (play() can take seconds); never run two at once
  private settleUntil = 0; // after a corrective seek, give the player time to rebuffer before judging drift
  private appliedRate = 1;

  constructor(
    private socket: RoomSocket,
    private player: PlayerAdapter,
  ) {
    player.onUserAction((a) => {
      if (!this.timeline) return;
      // a play while the room already plays (or pause while paused) changes nothing worth broadcasting
      if (a.action !== "seek" && (a.action === "play") === (this.timeline.state === "playing")) return;
      if (!this.canControl) return this.onBlocked(); // the loop will pull the player back
      if (a.action === "seek") this.socket.send("timeline:set", { action: "seek", to: a.at });
      else this.socket.send("timeline:set", { action: a.action, at: a.at });
    });
    this.timer = window.setInterval(() => void this.tick(), 500);
  }

  apply(t: Timeline): void {
    if (this.timeline && t.version < this.timeline.version) return; // stale
    this.timeline = t;
    void this.tick();
  }

  /** Call from a click handler to satisfy autoplay policy. */
  async unlock(): Promise<void> {
    this.needsGesture = !(await this.player.play());
    if (this.timeline?.state === "paused") this.player.pause();
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.step();
    } finally {
      this.busy = false;
    }
  }

  private async step(): Promise<void> {
    const t = this.timeline;
    if (!t || !this.socket.clock.ready) return;
    const serverNow = this.socket.clock.serverNow();
    const duration = this.player.duration();
    // never ask for a moment past the end: the room pauses there once a player reports "ended"
    const expected = duration > 0 ? Math.min(expectedPosition(t, serverNow), duration) : expectedPosition(t, serverNow);
    const actual = this.player.getTime();
    const drift = actual - expected;
    const atEnd = duration > 0 && expected >= duration - 0.5;

    if (t.state === "paused") {
      this.applyRate(t.rate);
      if (this.player.isPlaying()) this.player.pause();
      if (Math.abs(drift) > 0.25) this.player.seek(expected);
    } else if (serverNow < t.anchorServerMs) {
      // scheduled start still in the future: line up at the anchor and wait
      if (this.player.isPlaying()) this.player.pause();
      if (Math.abs(actual - t.anchorMediaS) > 0.25) this.player.seek(t.anchorMediaS);
      window.setTimeout(() => void this.tick(), Math.max(0, t.anchorServerMs - serverNow));
    } else if (atEnd) {
      // let the video finish on its own instead of seeking to the end and replaying it
    } else {
      if (!this.player.isPlaying() && !this.player.isBuffering()) {
        this.applyRate(t.rate, true); // some players (YouTube) reset their speed when a video starts
        this.player.seek(expected);
        this.settleUntil = Date.now() + 1500;
        this.needsGesture = !(await this.player.play());
      } else if (Date.now() >= this.settleUntil) {
        this.correct(driftAction(drift, expected, t.rate, this.player.coarseRate ? COARSE_SEEK_S : DRIFT_SEEK_S), t.rate);
      }
    }
    this.onStatus({
      driftMs: Math.round(drift * 1000),
      needsGesture: this.needsGesture,
      state: t.state,
      position: actual,
      rateLimited: t.rate !== 1 && this.player.supportsRate?.(t.rate) === false,
    });
  }

  /** Base speed comes from the room timeline; small nudges around it keep fine-grained players aligned. */
  private correct(a: DriftAction, base: number): void {
    if (a.kind === "seek") {
      this.player.seek(a.to);
      this.settleUntil = Date.now() + 2000;
      this.applyRate(base);
    } else this.applyRate(this.player.coarseRate ? base : a.rate);
  }

  private applyRate(rate: number, force = false): void {
    if (!force && Math.abs(rate - this.appliedRate) < 1e-3) return;
    this.player.setRate(rate);
    this.appliedRate = rate;
  }

  destroy(): void {
    window.clearInterval(this.timer);
    this.player.destroy();
  }
}
