import { describe, expect, it } from "vitest";

import { BlinkTracker, LM, PhoneTracker, PostureTracker, type Pose, resolveState, SittingTracker, StretchRoutine } from "./signals";

function pose(o: { earY?: number; wristY?: number; hipY?: number; hipVis?: number } = {}): Pose {
  const p: Pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  p[LM.L_SHOULDER] = { x: 0.4, y: 0.6, visibility: 1 };
  p[LM.R_SHOULDER] = { x: 0.6, y: 0.6, visibility: 1 };
  const ear = o.earY ?? 0.4; // upright: 0.2 above shoulders (ratio 1.0)
  p[LM.L_EAR] = { x: 0.45, y: ear, visibility: 1 };
  p[LM.R_EAR] = { x: 0.55, y: ear, visibility: 1 };
  p[LM.L_WRIST] = { x: 0.3, y: o.wristY ?? 0.9, visibility: 1 };
  p[LM.R_WRIST] = { x: 0.7, y: o.wristY ?? 0.9, visibility: 1 };
  p[LM.L_HIP] = { x: 0.43, y: o.hipY ?? 1.2, visibility: o.hipVis ?? 0.1 };
  p[LM.R_HIP] = { x: 0.57, y: o.hipY ?? 1.2, visibility: o.hipVis ?? 0.1 };
  return p;
}

describe("PostureTracker", () => {
  it("calibrates then flags sustained slouching only after the hold time", () => {
    const t = new PostureTracker(10_000, 0.8, 5);
    for (let i = 0; i < 5; i++) expect(t.update(pose(), i * 200)).toBe(false);
    expect(t.baseline).toBeCloseTo(1.0);
    expect(t.update(pose({ earY: 0.48 }), 2_000)).toBe(false); // ratio 0.6, just started
    expect(t.update(pose({ earY: 0.48 }), 11_000)).toBe(false);
    expect(t.update(pose({ earY: 0.48 }), 12_500)).toBe(true);
    expect(t.update(pose(), 13_000)).toBe(false); // sat up again
  });
});

describe("BlinkTracker", () => {
  it("flags staring after no blinks, resets on a blink, and detects dozing", () => {
    const b = new BlinkTracker(15_000, 2_000);
    expect(b.update(0, 0, 0).staring).toBe(false);
    expect(b.update(0, 0, 16_000).staring).toBe(true);
    expect(b.update(0.9, 0.9, 16_100).staring).toBe(false);
    b.update(0, 0, 16_300);
    let r = b.update(0.9, 0.9, 20_000);
    expect(r.dozing).toBe(false);
    r = b.update(0.9, 0.9, 22_500);
    expect(r.dozing).toBe(true);
  });
});

describe("Sitting and phone trackers", () => {
  it("becomes a potato after a long sit and resets after standing away", () => {
    const s = new SittingTracker(1000, 500);
    expect(s.update(true, 0)).toBe(false);
    expect(s.update(true, 1200)).toBe(true);
    expect(s.update(false, 1300)).toBe(false);
    expect(s.update(false, 2000)).toBe(false); // away longer than absentMs: counts as a break
    expect(s.update(true, 2200)).toBe(false);
    expect(s.update(true, 3300)).toBe(true);
  });
  it("needs the phone visible for a few seconds", () => {
    const p = new PhoneTracker(3000, 1000);
    expect(p.update(0.9, 0)).toBe(false);
    expect(p.update(0.9, 3100)).toBe(true);
    expect(p.update(0, 3500)).toBe(true); // within grace
    expect(p.update(0, 5000)).toBe(false);
  });
});

describe("resolveState", () => {
  const none = { slouch: false, staring: false, potato: false, phone: false, dozing: false };
  it("applies priority and mode rules", () => {
    expect(resolveState(none, false)).toBe("normal");
    expect(resolveState({ ...none, slouch: true }, false)).toBe("shrimp");
    expect(resolveState({ ...none, slouch: true, staring: true }, false)).toBe("fish");
    expect(resolveState({ ...none, potato: true }, false)).toBe("potato");
    expect(resolveState({ ...none, phone: true }, false)).toBe("normal"); // phones only matter in study mode
    expect(resolveState({ ...none, phone: true, slouch: true }, true)).toBe("animal");
  });
});

describe("StretchRoutine", () => {
  const up = pose({ wristY: 0.2, hipY: 0.8, hipVis: 0.9 });
  const down = pose({ wristY: 0.9, hipY: 0.8, hipVis: 0.9 });
  const sitting = pose();

  it("standing mode waits for the person to stand, then needs time and reps", () => {
    const r = new StretchRoutine(false, 10, 3);
    expect(r.update(sitting, 0)).toBe("waiting-stand");
    let t = 1000;
    r.update(down, t);
    for (let rep = 0; rep < 3; rep++) {
      r.update(up, (t += 1000));
      r.update(down, (t += 1000));
    }
    expect(r.reps).toBe(3);
    expect(r.phase).toBe("stretching");
    expect(r.progress).toBeLessThan(1);
    for (let i = 0; i < 6; i++) r.update(down, (t += 1000));
    expect(r.phase).toBe("done");
  });

  it("pauses the clock when the person sits down", () => {
    const r = new StretchRoutine(false, 10, 0);
    r.update(down, 0);
    r.update(down, 1000);
    const before = r.elapsedMs;
    r.update(sitting, 2000);
    r.update(sitting, 3000);
    expect(r.elapsedMs).toBe(before);
  });

  it("seated alternative never requires standing", () => {
    const r = new StretchRoutine(true, 3, 2);
    let t = 0;
    r.update(sitting, t);
    for (let i = 0; i < 2; i++) {
      r.update(pose({ wristY: 0.2 }), (t += 1000));
      r.update(pose({ wristY: 0.9 }), (t += 1000));
    }
    expect(r.update(sitting, (t += 1000))).toBe("done");
  });
});
