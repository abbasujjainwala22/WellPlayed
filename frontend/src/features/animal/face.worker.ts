/**
 * Face tracking for Animal Chaos, off the main thread. Runs MediaPipe FaceLandmarker on small
 * frames the page hands over and answers with a handful of landmark points. Frames and landmarks
 * stay on this device: nothing here talks to our server, and the only downloads are the
 * self-hosted WebAssembly runtime and the public face model.
 */
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

import { type Delegate, POINTS, type TrackerErrorKind, type WorkerIn, type WorkerOut } from "./points";

// Same model the wellbeing check uses (lib/wellbeing/engine.ts).
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

interface Scope {
  postMessage(message: WorkerOut, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<WorkerIn>) => void) | null;
}
const scope = self as unknown as Scope;

let model: FaceLandmarker | null = null;

const fail = (kind: TrackerErrorKind, message: string, err?: unknown) =>
  scope.postMessage({ type: "error", kind, message, detail: err instanceof Error ? err.message : err ? String(err) : undefined });

async function init(origin: string): Promise<void> {
  if (typeof WebAssembly !== "object") {
    return fail("unsupported", "This browser can’t run face effects (no WebAssembly). Normal video is unchanged.");
  }
  let fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
  try {
    // module worker: use MediaPipe's ES-module loader, served from our own origin (scripts/copy-mediapipe.mjs)
    fileset = await FilesetResolver.forVisionTasks(`${origin}/mediapipe/wasm`, true);
    await import(/* @vite-ignore */ fileset.wasmLoaderPath);
  } catch (e) {
    return fail("runtime", "The face-tracking runtime didn’t load. Reload the page, or try another browser.", e);
  }
  let buffer: Uint8Array;
  try {
    const res = await fetch(MODEL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buffer = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    return fail("download", "Couldn’t download the face model. Check your connection, then retry.", e);
  }
  let last: unknown;
  for (const delegate of ["GPU", "CPU"] as Delegate[]) {
    try {
      model = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: buffer, delegate },
        runningMode: "IMAGE", // frames come from several tiles in turn, so no cross-frame tracking
        numFaces: 1,
      });
      scope.postMessage({ type: "ready", delegate });
      return;
    } catch (e) {
      last = e; // no WebGL in a worker (older Safari, some headless setups): try the CPU
    }
  }
  fail("model", "The face model couldn’t start on this device. Normal video is unchanged.", last);
}

scope.onmessage = ({ data }) => {
  if (data.type === "init") {
    void init(data.origin);
    return;
  }
  const { id, bitmap } = data;
  try {
    if (!model) throw new Error("model not ready");
    const face = model.detect(bitmap).faceLandmarks[0];
    let points: Float32Array | null = null;
    if (face) {
      points = new Float32Array(POINTS.length * 2);
      POINTS.forEach((i, k) => {
        points![k * 2] = face[i].x;
        points![k * 2 + 1] = face[i].y;
      });
    }
    scope.postMessage({ type: "face", id, points }, points ? [points.buffer] : []);
  } catch (e) {
    scope.postMessage({ type: "face", id, points: null });
    fail("inference", "Face tracking stopped on this device. Normal video is unchanged.", e);
  } finally {
    bitmap.close();
  }
};
