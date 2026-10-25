/** Pure, dependency-free sync maths. Unit-tested in sync-core.test.ts. */
import type { Timeline } from "../types";

export const DRIFT_IGNORE_S = 0.08;
export const DRIFT_SEEK_S = 2;
export const RATE_NUDGE = 0.05;

export function expectedPosition(t: Timeline, serverNowMs: number): number {
  if (t.state !== "playing") return t.anchorMediaS;
  return t.anchorMediaS + (Math.max(0, serverNowMs - t.anchorServerMs) / 1000) * t.rate;
}

export type DriftAction =
  | { kind: "none"; rate: number }
  | { kind: "rate"; rate: number }
  | { kind: "seek"; to: number };

/** Seek threshold for players that can't nudge their rate (YouTube): small enough to keep a room together. */
export const COARSE_SEEK_S = 0.6;

/** drift = actualPosition - expectedPosition (seconds). Positive means we are ahead. */
export function driftAction(drift: number, expected: number, baseRate: number, seekAt = DRIFT_SEEK_S): DriftAction {
  const abs = Math.abs(drift);
  if (abs < DRIFT_IGNORE_S) return { kind: "none", rate: baseRate };
  if (abs >= seekAt) return { kind: "seek", to: expected };
  return { kind: "rate", rate: baseRate * (drift > 0 ? 1 - RATE_NUDGE : 1 + RATE_NUDGE) };
}

interface Sample {
  offset: number;
  rtt: number;
}

/** NTP-style estimate of (serverClock - localClock) using the lowest-RTT samples. */
export class ClockSync {
  private samples: Sample[] = [];
  offsetMs = 0;
  ready = false;

  addSample(t0: number, serverMs: number, t3: number): void {
    const rtt = t3 - t0;
    if (rtt < 0) return;
    this.samples.push({ offset: serverMs - (t0 + t3) / 2, rtt });
    if (this.samples.length > 40) this.samples.shift();
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 5);
    const offsets = best.map((s) => s.offset).sort((a, b) => a - b);
    this.offsetMs = offsets[Math.floor(offsets.length / 2)];
    this.ready = true;
  }

  serverNow(localNowMs: number = Date.now()): number {
    return localNowMs + this.offsetMs;
  }

  /** Convert a server timestamp to the local clock. */
  toLocal(serverMs: number): number {
    return serverMs - this.offsetMs;
  }
}
