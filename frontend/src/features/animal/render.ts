import type { AnimalId } from "./animals";
import { type DrawFx, drawAnimal, type Geometry, neutralGeometry } from "./draw";
import { type FacePoints, P } from "./points";

type Pt = { x: number; y: number };
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Size the canvas backing store to its box (capped at 2x DPR). Returns CSS pixel size. */
export function fitCanvas(canvas: HTMLCanvasElement): { w: number; h: number; dpr: number } {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  return { w, h, dpr };
}

/**
 * Draw an animal over a tile whose <video> uses object-fit: cover. `points` are normalized to the
 * video frame. The canvas is mirrored by CSS for the local tile, just like the video, so the
 * drawing works in plain (unmirrored) frame coordinates. `pop` scales the animal in on arrival.
 */
export function renderFace(
  canvas: HTMLCanvasElement,
  video: { videoWidth: number; videoHeight: number },
  points: FacePoints,
  animal: AnimalId,
  fx: DrawFx & { pop: number },
): void {
  const c = canvas.getContext("2d");
  if (!c) return;
  const { w, h, dpr } = fitCanvas(canvas);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || !w || !h) return;
  const scale = Math.max(w / vw, h / vh);
  const ox = (w - vw * scale) / 2;
  const oy = (h - vh * scale) / 2;
  const at = (i: number): Pt => ({ x: points[i * 2] * vw * scale + ox, y: points[i * 2 + 1] * vh * scale + oy });

  const eL = mid(at(P.eyeLOut), at(P.eyeLIn));
  const eR = mid(at(P.eyeROut), at(P.eyeRIn));
  const d = dist(eL, eR);
  if (d < 4) return;
  const o = mid(eL, eR);
  const roll = Math.atan2(eR.y - eL.y, eR.x - eL.x);
  const cos = Math.cos(-roll);
  const sin = Math.sin(-roll);
  const local = (p: Pt): Pt => ({ x: (p.x - o.x) * cos - (p.y - o.y) * sin, y: (p.x - o.x) * sin + (p.y - o.y) * cos });

  const lipTop = at(P.lipTop);
  const lipBottom = at(P.lipBottom);
  const g: Geometry = {
    u: d / 100,
    eyeL: local(eL),
    eyeR: local(eR),
    eyeW: (dist(at(P.eyeLOut), at(P.eyeLIn)) + dist(at(P.eyeROut), at(P.eyeRIn))) / 4,
    nose: local(at(P.nose)),
    mouth: local(mid(lipTop, lipBottom)),
    mouthW: dist(at(P.mouthL), at(P.mouthR)) / 2,
    open: Math.min(1, Math.max(0, (dist(lipTop, lipBottom) / d - 0.04) * 3)),
    left: local(at(P.cheekL)).x,
    right: local(at(P.cheekR)).x,
    top: local(at(P.forehead)).y,
    chin: local(at(P.chin)).y,
  };
  c.translate(o.x, o.y);
  c.rotate(roll);
  if (fx.pop < 1) {
    const k = 0.6 + 0.4 * fx.pop;
    c.translate(g.nose.x, g.nose.y);
    c.scale(k, k);
    c.translate(-g.nose.x, -g.nose.y);
  }
  drawAnimal(c, animal, g, fx);
}

const ICON_FIT: Partial<Record<AnimalId, { size: number; cy: number }>> = {
  bunny: { size: 500, cy: -75 },
  lion: { size: 430, cy: 22 },
};

/** A front-facing animal centred in the canvas, for the picker. */
export function renderIcon(canvas: HTMLCanvasElement, animal: AnimalId): void {
  const c = canvas.getContext("2d");
  if (!c) return;
  const { w, h, dpr } = fitCanvas(canvas);
  const g = neutralGeometry();
  const fit = ICON_FIT[animal] ?? { size: 380, cy: -8 }; // height and centre of the drawing, in face units
  const k = Math.min(w, h) / fit.size;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  c.translate(w / 2, h / 2 - fit.cy * k);
  c.scale(k, k);
  drawAnimal(c, animal, g, { wiggle: 0, preview: true });
}
