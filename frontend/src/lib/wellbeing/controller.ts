import { WellbeingEngine, type Frame } from "./engine";
import {
  type AvatarState,
  BlinkTracker,
  type Flags,
  PhoneTracker,
  PostureTracker,
  resolveState,
  SittingTracker,
  StretchRoutine,
} from "./signals";

export interface WellbeingStatus {
  running: boolean;
  loading: boolean;
  error: string;
  state: AvatarState;
  flags: Flags;
  calibrated: boolean;
  stretch: { phase: string; progress: number; reps: number } | null;
}

const NO_FLAGS: Flags = { slouch: false, staring: false, potato: false, phone: false, dozing: false };

/** Glue between camera frames (or simulated signals), the trackers and the group. */
export class WellbeingController {
  private engine: WellbeingEngine | null = null;
  private posture = new PostureTracker();
  private blink = new BlinkTracker();
  private sitting = new SittingTracker();
  private phone = new PhoneTracker();
  private routine: StretchRoutine | null = null;
  private forced: Partial<Flags> = {};
  private lastSent: AvatarState = "normal";
  status: WellbeingStatus = { running: false, loading: false, error: "", state: "normal", flags: NO_FLAGS, calibrated: false, stretch: null };

  constructor(
    private send: (state: AvatarState) => void,
    private notify: (s: WellbeingStatus) => void,
    private opts: { focusChecks: boolean; onStretchDone: () => void },
  ) {}

  async startCamera(): Promise<void> {
    this.update({ loading: true, error: "" });
    this.engine = new WellbeingEngine((f) => this.onFrame(f), 6, this.opts.focusChecks);
    try {
      await this.engine.start();
      this.update({ running: true, loading: false });
    } catch (e) {
      this.engine?.stop();
      this.engine = null;
      this.update({ loading: false, error: `Camera/model unavailable: ${(e as Error).message}. You can still use the simulator.` });
    }
  }

  stopCamera(): void {
    this.engine?.stop();
    this.engine = null;
    this.posture.reset();
    this.update({ running: false, calibrated: false });
  }

  recalibrate(): void {
    this.posture.reset();
    this.update({ calibrated: false });
  }

  /** Force signals on/off without a camera (demo & testing). */
  simulate(flag: keyof Flags, on: boolean): void {
    this.forced[flag] = on;
    this.evaluate({ ...this.status.flags, ...this.forced });
  }

  beginStretch(seated: boolean, seconds: number): void {
    this.routine = new StretchRoutine(seated, seconds);
    this.update({ stretch: { phase: this.routine.phase, progress: 0, reps: 0 } });
  }

  endStretch(): void {
    this.routine = null;
    this.update({ stretch: null });
  }

  private onFrame(f: Frame): void {
    const flags: Flags = { ...NO_FLAGS };
    if (f.pose) {
      flags.slouch = this.posture.update(f.pose, f.t);
      if (this.routine) {
        const phase = this.routine.update(f.pose, f.t);
        this.update({ stretch: { phase, progress: this.routine.progress, reps: this.routine.reps } });
        if (phase === "done") {
          this.routine = null;
          this.opts.onStretchDone();
        }
      }
    }
    flags.potato = this.sitting.update(!!f.pose, f.t);
    if (f.blink) Object.assign(flags, this.blink.update(f.blink.left, f.blink.right, f.t));
    flags.phone = this.phone.update(f.phoneScore, f.t);
    this.evaluate({ ...flags, ...this.forced });
    if (this.status.calibrated !== (this.posture.baseline !== null)) this.update({ calibrated: this.posture.baseline !== null });
  }

  private evaluate(flags: Flags): void {
    const state = resolveState(flags, this.opts.focusChecks);
    this.update({ flags, state });
    if (state !== this.lastSent) {
      this.lastSent = state;
      this.send(state);
    }
  }

  private update(patch: Partial<WellbeingStatus>): void {
    this.status = { ...this.status, ...patch };
    this.notify(this.status);
  }
}
