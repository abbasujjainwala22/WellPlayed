import { describe, expect, it } from "vitest";

import type { Timeline } from "../types";
import { COARSE_SEEK_S, ClockSync, driftAction, expectedPosition } from "./index";

const playing: Timeline = { state: "playing", anchorServerMs: 1000, anchorMediaS: 10, rate: 1, version: 1 };

describe("expectedPosition", () => {
  it("holds until the scheduled start, then advances", () => {
    expect(expectedPosition(playing, 500)).toBe(10);
    expect(expectedPosition(playing, 4000)).toBe(13);
  });
  it("is frozen when paused and respects rate", () => {
    expect(expectedPosition({ ...playing, state: "paused" }, 9999)).toBe(10);
    expect(expectedPosition({ ...playing, rate: 2 }, 2000)).toBe(12);
  });
});

describe("driftAction", () => {
  it("ignores tiny drift", () => expect(driftAction(0.05, 10, 1).kind).toBe("none"));
  it("slows down when ahead and speeds up when behind", () => {
    expect(driftAction(0.5, 10, 1)).toEqual({ kind: "rate", rate: 0.95 });
    expect(driftAction(-0.5, 10, 1)).toEqual({ kind: "rate", rate: 1.05 });
  });
  it("hard seeks on large drift", () => expect(driftAction(-3, 42, 1)).toEqual({ kind: "seek", to: 42 }));
  it("seeks sooner for players that can't nudge their rate", () =>
    expect(driftAction(0.7, 42, 1, COARSE_SEEK_S)).toEqual({ kind: "seek", to: 42 }));
});

describe("ClockSync", () => {
  it("recovers a known offset using low-RTT samples and ignores outliers", () => {
    const c = new ClockSync();
    const offset = 5000; // server is 5s ahead
    for (const rtt of [200, 40, 30, 35, 500, 32, 31]) {
      const t0 = 1000;
      const t3 = t0 + rtt;
      c.addSample(t0, t0 + rtt / 2 + offset, t3);
    }
    expect(c.ready).toBe(true);
    expect(Math.abs(c.offsetMs - offset)).toBeLessThan(1);
    expect(c.serverNow(100)).toBeCloseTo(5100);
  });
});
