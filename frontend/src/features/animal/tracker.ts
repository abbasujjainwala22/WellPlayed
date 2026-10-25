/**
 * One face model per browser tab, shared by every tile that wears an animal. A single worker
 * looks at one tile at a time, round-robin, on a ~320 px copy of the current frame. It pauses
 * while the tab is hidden and shuts down soon after the last effect goes away.
 */
import { create } from "zustand";

import type { Delegate, FacePoints, WorkerOut } from "./points";

export type TrackerStatus = "idle" | "loading" | "ready" | "error";

interface TrackerState {
  status: TrackerStatus;
  delegate: Delegate | null;
  error: string;
}

export const useTracker = create<TrackerState>(() => ({ status: "idle", delegate: null, error: "" }));

interface Watch {
  video: HTMLVideoElement;
  onFace: (points: FacePoints | null) => void;
}

const FRAME_WIDTH = 320;
const IDLE_SHUTDOWN_MS = 10_000; // keep the model warm briefly, e.g. while an effect is swapped
const STUCK_MS = 3000;

const watches = new Map<number, Watch>();
let nextId = 1;
let worker: Worker | null = null;
let ready = false;
let busySince = 0;
let cursor = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let scratch: HTMLCanvasElement | null = null;

const interval = () => ((navigator.hardwareConcurrency || 4) <= 4 ? 150 : 80);

function supported(): string {
  if (typeof Worker === "undefined" || typeof WebAssembly !== "object" || typeof createImageBitmap !== "function") {
    return "This browser can’t run face effects. Normal video is unchanged.";
  }
  return "";
}

function shutdown(): void {
  clearTimeout(timer);
  worker?.terminate();
  worker = null;
  ready = false;
  busySince = 0;
}

function fail(message: string): void {
  shutdown();
  useTracker.setState({ status: "error", error: message, delegate: null });
  watches.forEach((w) => w.onFace(null));
}

function start(): void {
  shutdown();
  const why = supported();
  if (why) return fail(why);
  useTracker.setState({ status: "loading", error: "", delegate: null });
  const w = new Worker(new URL("./face.worker.ts", import.meta.url), { type: "module", name: "animal-face" });
  worker = w;
  w.onerror = (e) => {
    console.warn("[animal] face worker failed", e.message);
    fail("Face effects couldn’t start in this browser. Normal video is unchanged.");
  };
  w.onmessage = ({ data }: MessageEvent<WorkerOut>) => {
    if (w !== worker) return;
    if (data.type === "ready") {
      ready = true;
      console.info(`[animal] face tracker ready (${data.delegate} delegate)`);
      useTracker.setState({ status: "ready", delegate: data.delegate, error: "" });
      schedule();
    } else if (data.type === "face") {
      busySince = 0;
      watches.get(data.id)?.onFace(data.points);
    } else {
      console.warn(`[animal] face tracker error (${data.kind})`, data.detail ?? "");
      fail(data.message);
    }
  };
  w.postMessage({ type: "init", origin: location.origin });
}

function visible(v: HTMLVideoElement): boolean {
  if (v.readyState < 2 || !v.videoWidth || !v.videoHeight) return false;
  const r = v.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
}

/** A small copy of the current frame, as an ImageBitmap the worker can own. */
async function grab(v: HTMLVideoElement): Promise<ImageBitmap> {
  const width = Math.min(FRAME_WIDTH, v.videoWidth);
  const height = Math.max(1, Math.round((width * v.videoHeight) / v.videoWidth));
  try {
    return await createImageBitmap(v, { resizeWidth: width, resizeHeight: height, resizeQuality: "low" });
  } catch {
    // older engines without resize options: downscale on a canvas first
    scratch ??= document.createElement("canvas");
    scratch.width = width;
    scratch.height = height;
    scratch.getContext("2d")!.drawImage(v, 0, 0, width, height);
    return createImageBitmap(scratch);
  }
}

function schedule(): void {
  clearTimeout(timer);
  if (!worker || !ready || !watches.size || document.visibilityState !== "visible") return;
  timer = setTimeout(() => void tick(), interval());
}

async function tick(): Promise<void> {
  const w = worker;
  if (w && ready && document.visibilityState === "visible") {
    if (busySince && performance.now() - busySince > STUCK_MS) busySince = 0; // a lost reply must not stall us
    const live = [...watches.entries()].filter(([, x]) => visible(x.video));
    if (!busySince && live.length) {
      const [id, watch] = live[cursor++ % live.length];
      busySince = performance.now();
      try {
        const bitmap = await grab(watch.video);
        if (w === worker && watches.has(id)) w.postMessage({ type: "frame", id, bitmap }, [bitmap]);
        else {
          bitmap.close();
          busySince = 0;
        }
      } catch {
        busySince = 0; // the frame wasn't ready (the track just changed); try again next tick
      }
    }
  }
  schedule();
}

if (typeof document !== "undefined") document.addEventListener("visibilitychange", schedule);

/** Follow the face in `video`; `onFace` gets landmark points, or null when no face is in view. */
export function watchFace(video: HTMLVideoElement, onFace: Watch["onFace"]): () => void {
  const id = nextId++;
  clearTimeout(idleTimer);
  watches.set(id, { video, onFace });
  if (!worker && useTracker.getState().status !== "error") start();
  else schedule();
  return () => {
    watches.delete(id);
    if (watches.size) return;
    clearTimeout(timer);
    idleTimer = setTimeout(() => {
      if (watches.size) return;
      shutdown();
      useTracker.setState({ status: "idle", delegate: null, error: "" });
    }, IDLE_SHUTDOWN_MS);
  };
}

/** After an error: load the model again (only if a tile still wants it). */
export function retryTracker(): void {
  useTracker.setState({ status: "idle", error: "" });
  if (watches.size) start();
}
