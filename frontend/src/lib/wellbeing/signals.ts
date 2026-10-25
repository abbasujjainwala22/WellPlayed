/** Pure, camera-free logic: turns landmarks into posture / blink / stretch signals. Unit-tested. */

export interface Pt {
  x: number;
  y: number; // normalised image coords, y grows downward
  z?: number;
  visibility?: number;
}
export type Pose = Pt[];

/** MediaPipe pose landmark indices. */
export const LM = { NOSE: 0, L_EAR: 7, R_EAR: 8, L_SHOULDER: 11, R_SHOULDER: 12, L_WRIST: 15, R_WRIST: 16, L_HIP: 23, R_HIP: 24 };

export type AvatarState = "normal" | "shrimp" | "fish" | "potato" | "animal";
export const EMOJI: Record<AvatarState, string> = { normal: "🙂", shrimp: "🦐", fish: "🐟", potato: "🥔", animal: "🐨" };

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const vis = (p?: Pt) => (p?.visibility ?? 1) > 0.5;

/** Height of the neck (shoulder line to ears) relative to shoulder width. Drops when slouching. */
export function neckRatio(p: Pose): number | null {
  const [ls, rs, le, re] = [p[LM.L_SHOULDER], p[LM.R_SHOULDER], p[LM.L_EAR], p[LM.R_EAR]];
  if (!ls || !rs || !le || !re) return null;
  const width = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  if (width < 0.05) return null;
  return ((ls.y + rs.y) / 2 - (le.y + re.y) / 2) / width;
}

export class PostureTracker {
  private samples: number[] = [];
  baseline: number | null = null;
  private since: number | null = null;
  constructor(private holdMs = 10_000, private ratio = 0.8, private calibrationSamples = 20) {}

  reset(): void {
    this.samples = [];
    this.baseline = null;
    this.since = null;
  }

  /** Returns true while the user has been slouching for at least holdMs. */
  update(p: Pose, t: number): boolean {
    const r = neckRatio(p);
    if (r === null) return false;
    if (this.baseline === null) {
      this.samples.push(r);
      if (this.samples.length >= this.calibrationSamples) this.baseline = median(this.samples);
      return false;
    }
    if (r < this.baseline * this.ratio) {
      this.since ??= t;
      return t - this.since >= this.holdMs;
    }
    this.since = null;
    return false;
  }
}

export class BlinkTracker {
  private lastBlink: number | null = null;
  private closing = false;
  private closedSince: number | null = null;
  constructor(private stareMs = 15_000, private dozeMs = 2_000) {}

  update(left: number, right: number, t: number): { staring: boolean; dozing: boolean } {
    this.lastBlink ??= t;
    const v = (left + right) / 2;
    if (v > 0.5 && !this.closing) {
      this.closing = true;
      this.lastBlink = t;
    } else if (v <= 0.5) {
      this.closing = false;
    }
    if (v > 0.6) this.closedSince ??= t;
    else this.closedSince = null;
    return {
      staring: t - this.lastBlink > this.stareMs,
      dozing: this.closedSince !== null && t - this.closedSince > this.dozeMs,
    };
  }
}

export class SittingTracker {
  private start: number | null = null;
  private absentSince: number | null = null;
  constructor(private potatoMs = 90 * 60_000, private absentMs = 60_000) {}
  update(present: boolean, t: number): boolean {
    if (present) {
      this.start ??= t;
      this.absentSince = null;
    } else {
      this.absentSince ??= t;
      if (t - this.absentSince > this.absentMs) this.start = null; // away long enough: counts as a break
    }
    return present && this.start !== null && t - this.start >= this.potatoMs;
  }
}

export class PhoneTracker {
  private since: number | null = null;
  private lastSeen = -Infinity;
  constructor(private holdMs = 3_000, private graceMs = 2_000) {}
  update(score: number, t: number): boolean {
    if (score > 0.4) {
      this.since ??= t;
      this.lastSeen = t;
    } else if (t - this.lastSeen > this.graceMs) {
      this.since = null;
    }
    return this.since !== null && t - this.since >= this.holdMs;
  }
}

export interface Flags {
  slouch: boolean;
  staring: boolean;
  potato: boolean;
  phone: boolean;
  dozing: boolean;
}

/** Highest-priority condition wins. Phone / dozing are only judged in study mode. */
export function resolveState(f: Flags, focusChecks: boolean): AvatarState {
  if (focusChecks && (f.phone || f.dozing)) return "animal";
  if (f.staring) return "fish";
  if (f.slouch) return "shrimp";
  if (f.potato) return "potato";
  return "normal";
}

export type StretchPhase = "waiting-stand" | "stretching" | "done";

/**
 * 30 s stretch: stand (or stay seated in seated mode) and raise both arms above the head
 * at least `reps` times. The clock only runs while the person is in position.
 */
export class StretchRoutine {
  phase: StretchPhase;
  reps = 0;
  elapsedMs = 0;
  private armsUp = false;
  private last: number | null = null;
  constructor(private seated: boolean, private seconds = 30, private requiredReps = 6) {
    this.phase = seated ? "stretching" : "waiting-stand";
  }

  static standing(p: Pose): boolean {
    return vis(p[LM.L_HIP]) && vis(p[LM.R_HIP]) && p[LM.L_HIP].y < 0.97 && p[LM.R_HIP].y < 0.97;
  }

  static armsRaised(p: Pose): boolean {
    const [lw, rw, le, re] = [p[LM.L_WRIST], p[LM.R_WRIST], p[LM.L_EAR], p[LM.R_EAR]];
    return !!(lw && rw && le && re) && lw.y < le.y && rw.y < re.y;
  }

  get progress(): number {
    return this.phase === "done" ? 1 : Math.min(1, this.elapsedMs / (this.seconds * 1000));
  }

  update(p: Pose, t: number): StretchPhase {
    if (this.phase === "done") return this.phase;
    const dt = this.last === null ? 0 : Math.min(1000, t - this.last);
    this.last = t;
    const inPosition = this.seated || StretchRoutine.standing(p);
    if (!inPosition) {
      this.phase = "waiting-stand";
      return this.phase;
    }
    this.phase = "stretching";
    this.elapsedMs += dt;
    const up = StretchRoutine.armsRaised(p);
    if (up && !this.armsUp) this.reps++;
    this.armsUp = up;
    if (this.elapsedMs >= this.seconds * 1000 && this.reps >= this.requiredReps) this.phase = "done";
    return this.phase;
  }
}
