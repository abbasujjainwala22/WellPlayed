/**
 * The few FaceLandmarker points the drawings need, in this order. The worker sends just these
 * (normalized x, y pairs), and only to the page that asked: nothing about a face leaves the device.
 */
export const POINTS = [
  33, 133, // eye on the image's left: outer, inner corner
  263, 362, // eye on the image's right: outer, inner corner
  1, // nose tip
  13, 14, // inner upper lip, inner lower lip
  61, 291, // mouth corners
  10, // top of the forehead
  152, // chin
  234, 454, // cheek edges (image left, image right)
] as const;

export const P = {
  eyeLOut: 0,
  eyeLIn: 1,
  eyeROut: 2,
  eyeRIn: 3,
  nose: 4,
  lipTop: 5,
  lipBottom: 6,
  mouthL: 7,
  mouthR: 8,
  forehead: 9,
  chin: 10,
  cheekL: 11,
  cheekR: 12,
} as const;

/** Normalized [x0, y0, x1, y1, …] for POINTS, relative to the video frame. */
export type FacePoints = Float32Array;

export type Delegate = "GPU" | "CPU";

export type TrackerErrorKind = "unsupported" | "runtime" | "download" | "model" | "inference";

export type WorkerIn = { type: "init"; origin: string } | { type: "frame"; id: number; bitmap: ImageBitmap };

export type WorkerOut =
  | { type: "ready"; delegate: Delegate }
  | { type: "face"; id: number; points: FacePoints | null }
  | { type: "error"; kind: TrackerErrorKind; message: string; detail?: string };
