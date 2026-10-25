/**
 * Vector animal faces. Everything is drawn in a face-aligned frame: the origin is between the
 * eyes, x runs from the image-left eye to the other one, and `u` is a hundredth of the eye
 * distance, so the drawings scale with the face. The face's own landmarks (cheeks, forehead,
 * chin, nose, mouth) place every part, which makes the animal follow head turns and an open mouth.
 */
import type { AnimalId } from "./animals";

export interface Geometry {
  u: number;
  eyeL: { x: number; y: number };
  eyeR: { x: number; y: number };
  /** Half the width of one eye. */
  eyeW: number;
  nose: { x: number; y: number };
  mouth: { x: number; y: number };
  /** Half the mouth width. */
  mouthW: number;
  /** 0 closed … 1 wide open. */
  open: number;
  left: number;
  right: number;
  top: number;
  chin: number;
}

export interface DrawFx {
  /** Small ear wiggle phase in radians; 0 when motion is reduced. */
  wiggle: number;
  /** Fill the eye holes with cartoon eyes (pickers and previews have no real eyes behind). */
  preview?: boolean;
}

type C = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

const ell = (c: C, x: number, y: number, rx: number, ry: number, fill: string, rot = 0) => {
  c.beginPath();
  c.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), rot, 0, TAU);
  c.fillStyle = fill;
  c.fill();
};

const poly = (c: C, pts: [number, number][], fill: string) => {
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.fillStyle = fill;
  c.fill();
};

const line = (c: C, color: string, width: number, path: (c: C) => void) => {
  c.beginPath();
  path(c);
  c.strokeStyle = color;
  c.lineWidth = width;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.stroke();
};

interface Head {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  at: (a: number, k?: number) => [number, number];
}

function headOf(g: Geometry, widen = 1): Head {
  const h = g.chin - g.top;
  const cx = (g.left + g.right) / 2;
  const cy = g.top + h * 0.47;
  const rx = ((g.right - g.left) / 2) * 1.08 * widen;
  const ry = h * 0.6;
  return { cx, cy, rx, ry, at: (a, k = 1) => [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k] };
}

const UP = -Math.PI / 2;

/* ───────── shared parts ───────── */

function pointyEars(c: C, H: Head, fur: string, inner: string, wiggle: number, tip?: string) {
  for (const s of [-1, 1]) {
    const a = wiggle * 0.05 * s;
    const b1 = H.at(UP + s * 0.22);
    const b2 = H.at(UP + s * 1.0);
    const t: [number, number] = [H.cx + s * H.rx * (0.82 + a), H.cy - H.ry * 1.42];
    poly(c, [b1, t, b2], fur);
    const mid = (p: [number, number], k: number): [number, number] => [p[0] + (t[0] - p[0]) * k, p[1] + (t[1] - p[1]) * k];
    poly(c, [mid(b1, 0.22), mid(t, 0.12), mid(b2, 0.3)], inner);
    if (tip) poly(c, [mid(b1, 0.7), t, mid(b2, 0.7)], tip);
  }
}

function roundEars(c: C, H: Head, fur: string, inner: string, wiggle: number, k = 1) {
  for (const s of [-1, 1]) {
    const x = H.cx + s * H.rx * 0.74;
    const y = H.cy - H.ry * (0.86 + wiggle * 0.015 * s);
    ell(c, x, y, H.rx * 0.3 * k, H.rx * 0.3 * k, fur);
    ell(c, x, y + H.rx * 0.03, H.rx * 0.17 * k, H.rx * 0.17 * k, inner);
  }
}

/** Real eyes show through these. */
function eyeHoles(c: C, g: Geometry, k = 1) {
  const rx = g.eyeW * 1.4 * k;
  const ry = g.eyeW * 0.95 * k;
  c.save();
  c.globalCompositeOperation = "destination-out";
  ell(c, g.eyeL.x, g.eyeL.y, rx, ry, "#000");
  ell(c, g.eyeR.x, g.eyeR.y, rx, ry, "#000");
  c.restore();
}

function eyeRims(c: C, g: Geometry, color: string, width: number, k = 1) {
  for (const e of [g.eyeL, g.eyeR]) {
    line(c, color, width, (p) => p.ellipse(e.x, e.y, g.eyeW * 1.4 * k + width / 2, g.eyeW * 0.95 * k + width / 2, 0, 0, TAU));
  }
}

function previewEyes(c: C, g: Geometry, k = 1) {
  for (const e of [g.eyeL, g.eyeR]) {
    ell(c, e.x, e.y, g.eyeW * 1.2 * k, g.eyeW * 0.85 * k, "#fff");
    ell(c, e.x, e.y, g.eyeW * 0.55 * k, g.eyeW * 0.6 * k, "#1d1d24");
    ell(c, e.x + g.eyeW * 0.2 * k, e.y - g.eyeW * 0.25 * k, g.eyeW * 0.18 * k, g.eyeW * 0.18 * k, "#fff");
  }
}

/** Mouth that opens with the person's mouth. */
function mouth(c: C, g: Geometry, ink: string, k = 1) {
  const { u, open } = g;
  const mx = g.mouth.x;
  const my = g.mouth.y;
  const w = Math.max(g.mouthW * 0.75, 16 * u) * k;
  if (open > 0.12) {
    const h = (6 + open * 30) * u;
    ell(c, mx, my + h * 0.2, w * 0.8, h, "#3a1420");
    ell(c, mx, my + h * 0.75, w * 0.55, h * 0.45, "#ef7f95");
  } else {
    line(c, ink, 3.2 * u, (p) => {
      p.moveTo(mx - w, my - 3 * u);
      p.quadraticCurveTo(mx - w / 2, my + 8 * u, mx, my);
      p.quadraticCurveTo(mx + w / 2, my + 8 * u, mx + w, my - 3 * u);
    });
  }
}

/** Two puffy cheeks under the nose, the nose itself and the mouth. */
function muzzle(c: C, g: Geometry, o: { fill: string; nose: string; ink: string; size?: number; noseSize?: number }) {
  const { u } = g;
  const k = o.size ?? 1;
  const nx = g.nose.x;
  const ny = g.nose.y;
  const my = ny + (g.mouth.y - ny) * 0.45;
  const r = 28 * u * k;
  ell(c, nx - r * 0.75, my, r, r * 0.82, o.fill);
  ell(c, nx + r * 0.75, my, r, r * 0.82, o.fill);
  ell(c, g.mouth.x, g.mouth.y + 4 * u, r * 0.9, r * 0.75 + g.open * 22 * u, o.fill);
  line(c, o.ink, 3 * u, (p) => {
    p.moveTo(nx, ny + 6 * u);
    p.lineTo(g.mouth.x, g.mouth.y - 4 * u);
  });
  mouth(c, g, o.ink);
  const ns = o.noseSize ?? 1;
  c.beginPath();
  c.moveTo(nx - 15 * u * ns, ny - 7 * u * ns);
  c.quadraticCurveTo(nx, ny - 13 * u * ns, nx + 15 * u * ns, ny - 7 * u * ns);
  c.quadraticCurveTo(nx + 4 * u * ns, ny + 12 * u * ns, nx, ny + 12 * u * ns);
  c.quadraticCurveTo(nx - 4 * u * ns, ny + 12 * u * ns, nx - 15 * u * ns, ny - 7 * u * ns);
  c.fillStyle = o.nose;
  c.fill();
  ell(c, nx - 5 * u * ns, ny - 5 * u * ns, 4 * u * ns, 2.5 * u * ns, "rgba(255,255,255,0.55)");
}

function whiskers(c: C, g: Geometry, color: string) {
  const { u } = g;
  const y = g.nose.y + (g.mouth.y - g.nose.y) * 0.45;
  for (const s of [-1, 1]) {
    for (let i = -1; i <= 1; i++) {
      line(c, color, 2 * u, (p) => {
        p.moveTo(g.nose.x + s * 40 * u, y + i * 7 * u);
        p.quadraticCurveTo(g.nose.x + s * 75 * u, y + i * 11 * u - 4 * u, g.nose.x + s * 105 * u, y + i * 17 * u);
      });
    }
  }
}

function blush(c: C, g: Geometry, color: string) {
  const { u } = g;
  ell(c, g.eyeL.x - 12 * u, g.nose.y + 4 * u, 18 * u, 11 * u, color);
  ell(c, g.eyeR.x + 12 * u, g.nose.y + 4 * u, 18 * u, 11 * u, color);
}

/* ───────── the animals ───────── */

const INK = "#2a1d1a";

function cat(c: C, g: Geometry, fx: DrawFx) {
  const H = headOf(g);
  pointyEars(c, H, "#e89b54", "#f7b8c4", fx.wiggle);
  ell(c, H.cx, H.cy, H.rx, H.ry, "#e89b54");
  const { u } = g;
  for (const dx of [-22, 0, 22]) poly(c, [[H.cx + dx * u - 7 * u, g.top - 4 * u], [H.cx + dx * u + 7 * u, g.top - 4 * u], [H.cx + dx * u, g.top + 34 * u]], "#c66f2c");
  eyeHoles(c, g);
  eyeRims(c, g, "#7a4318", 3 * g.u);
  muzzle(c, g, { fill: "#fff5ea", nose: "#e9748f", ink: INK });
  whiskers(c, g, "rgba(60,40,30,0.75)");
}

function dog(c: C, g: Geometry, fx: DrawFx) {
  const H = headOf(g);
  ell(c, H.cx, H.cy, H.rx, H.ry, "#c98f55");
  const { u } = g;
  ell(c, g.eyeR.x, g.eyeR.y, 34 * u, 30 * u, "#8a5a2e"); // eye patch
  for (const s of [-1, 1]) {
    const [x, y] = H.at(UP + s * 1.05, 1.02);
    ell(c, x + s * H.rx * 0.08, y + H.ry * 0.35, H.rx * 0.26, H.ry * 0.55, "#6e4422", s * (0.32 + fx.wiggle * 0.04));
  }
  eyeHoles(c, g);
  eyeRims(c, g, "#5a3519", 3 * u);
  muzzle(c, g, { fill: "#f6e6cf", nose: "#231a1a", ink: INK, size: 1.15, noseSize: 1.35 });
  if (g.open < 0.12) ell(c, g.mouth.x + 6 * u, g.mouth.y + 14 * u, 10 * u, 13 * u, "#ef7f95"); // tongue out
}

function fox(c: C, g: Geometry, fx: DrawFx) {
  const H = headOf(g);
  pointyEars(c, H, "#e5702a", "#fbe3cf", fx.wiggle, "#3a2a24");
  ell(c, H.cx, H.cy, H.rx, H.ry, "#e5702a");
  const { u } = g;
  const [lx, ly] = H.at(Math.PI - 0.05);
  const [rx, ry] = H.at(0.05);
  c.beginPath();
  c.moveTo(lx, ly);
  c.quadraticCurveTo(g.eyeL.x, g.eyeL.y + 30 * u, g.nose.x, g.nose.y - 18 * u);
  c.quadraticCurveTo(g.eyeR.x, g.eyeR.y + 30 * u, rx, ry);
  c.quadraticCurveTo(H.cx + H.rx * 0.6, H.cy + H.ry, H.cx, g.chin + 8 * u);
  c.quadraticCurveTo(H.cx - H.rx * 0.6, H.cy + H.ry, lx, ly);
  c.fillStyle = "#fff4e8";
  c.fill();
  eyeHoles(c, g);
  eyeRims(c, g, "#8a3d12", 3 * u);
  muzzle(c, g, { fill: "#fff4e8", nose: "#231a1a", ink: INK, size: 0.85 });
  whiskers(c, g, "rgba(60,40,30,0.6)");
}

function bunny(c: C, g: Geometry, fx: DrawFx) {
  const H = headOf(g);
  for (const s of [-1, 1]) {
    const rot = s * (0.14 + fx.wiggle * 0.04);
    const x = H.cx + s * H.rx * 0.42;
    const y = H.cy - H.ry * 1.55;
    ell(c, x, y, H.rx * 0.22, H.ry * 0.78, "#ece7f1", rot);
    ell(c, x, y + H.ry * 0.05, H.rx * 0.11, H.ry * 0.6, "#f6b3c5", rot);
  }
  ell(c, H.cx, H.cy, H.rx, H.ry, "#ece7f1");
  blush(c, g, "rgba(246,140,170,0.45)");
  eyeHoles(c, g);
  eyeRims(c, g, "#a89cb4", 3 * g.u);
  muzzle(c, g, { fill: "#ffffff", nose: "#f07a9a", ink: INK, noseSize: 0.8 });
  const { u } = g;
  if (g.open < 0.5) {
    c.fillStyle = "#ffffff";
    c.strokeStyle = "#cfc6d6";
    c.lineWidth = 1.5 * u;
    for (const s of [-1, 1]) {
      c.beginPath();
      c.roundRect(g.mouth.x + (s < 0 ? -12 : 1) * u, g.mouth.y - 1 * u, 11 * u, 15 * u, 3 * u);
      c.fill();
      c.stroke();
    }
  }
  whiskers(c, g, "rgba(90,80,100,0.55)");
}

function panda(c: C, g: Geometry, fx: DrawFx) {
  const H = headOf(g);
  roundEars(c, H, "#1f1f26", "#1f1f26", fx.wiggle);
  ell(c, H.cx, H.cy, H.rx, H.ry, "#f7f6f1");
  const { u } = g;
  ell(c, g.eyeL.x - 4 * u, g.eyeL.y + 6 * u, 36 * u, 44 * u, "#1f1f26", 0.55);
  ell(c, g.eyeR.x + 4 * u, g.eyeR.y + 6 * u, 36 * u, 44 * u, "#1f1f26", -0.55);
  eyeHoles(c, g);
  muzzle(c, g, { fill: "#f7f6f1", nose: "#1f1f26", ink: "#1f1f26", noseSize: 1.1 });
}

function tiger(c: C, g: Geometry, fx: DrawFx) {
  const H = headOf(g);
  roundEars(c, H, "#ee8a2a", "#fff1df", fx.wiggle, 0.9);
  ell(c, H.cx, H.cy, H.rx, H.ry, "#ee8a2a");
  const { u } = g;
  ell(c, H.cx - H.rx * 0.55, g.nose.y + 18 * u, H.rx * 0.5, H.ry * 0.38, "#fff1df");
  ell(c, H.cx + H.rx * 0.55, g.nose.y + 18 * u, H.rx * 0.5, H.ry * 0.38, "#fff1df");
  const S = "#2a1d1a";
  for (const dx of [-26, 0, 26]) poly(c, [[H.cx + dx * u - 8 * u, g.top - 6 * u], [H.cx + dx * u + 8 * u, g.top - 6 * u], [H.cx + dx * u, g.top + (dx ? 26 : 42) * u]], S);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const [x, y] = H.at(s < 0 ? Math.PI - 0.5 + i * 0.32 : 0.5 - i * 0.32);
      const y2 = y + (i - 1) * 4 * u;
      poly(c, [[x, y2 - 7 * u], [x - s * 42 * u, y2], [x, y2 + 7 * u]], S);
    }
  }
  eyeHoles(c, g);
  eyeRims(c, g, S, 3 * u);
  muzzle(c, g, { fill: "#fff7ec", nose: "#e9748f", ink: INK });
  whiskers(c, g, "rgba(40,30,25,0.7)");
}

function frog(c: C, g: Geometry, fx: DrawFx) {
  const H = headOf(g, 1.08);
  const { u } = g;
  const G = "#5cb547";
  for (const e of [g.eyeL, g.eyeR]) ell(c, e.x, e.y - 8 * u, g.eyeW * 2.5, g.eyeW * 2.2, G);
  ell(c, H.cx, H.cy + 10 * u, H.rx, H.ry * 0.92, G);
  ell(c, H.cx, g.mouth.y + 26 * u, H.rx * 0.7, H.ry * 0.25, "#a9dc7c");
  blush(c, g, "rgba(240,120,140,0.4)");
  eyeHoles(c, g);
  eyeRims(c, g, "#ffffff", 5 * u);
  eyeRims(c, g, "#2d6b23", 2 * u, 1.18);
  for (const s of [-1, 1]) ell(c, g.nose.x + s * 9 * u, g.nose.y, 3 * u, 2.5 * u, "#2d6b23");
  const w = Math.max(70 * u, g.mouthW * 1.6);
  if (g.open > 0.12) {
    const h = (8 + g.open * 30) * u;
    ell(c, g.mouth.x, g.mouth.y + h * 0.3, w * 0.75, h, "#3a1420");
    ell(c, g.mouth.x, g.mouth.y + h * 0.8, w * 0.4, h * 0.45, "#ef7f95");
  } else {
    line(c, "#2d6b23", 4 * u, (p) => {
      p.moveTo(g.mouth.x - w, g.mouth.y - 10 * u);
      p.quadraticCurveTo(g.mouth.x, g.mouth.y + 18 * u, g.mouth.x + w, g.mouth.y - 10 * u);
    });
  }
  void fx;
}

function raccoon(c: C, g: Geometry, fx: DrawFx) {
  const H = headOf(g);
  roundEars(c, H, "#8e8e98", "#3b3b44", fx.wiggle);
  ell(c, H.cx, H.cy, H.rx, H.ry, "#8e8e98");
  const { u } = g;
  ell(c, H.cx - H.rx * 0.32, g.eyeL.y - 34 * u, 30 * u, 12 * u, "#f4f3f0", 0.12);
  ell(c, H.cx + H.rx * 0.32, g.eyeR.y - 34 * u, 30 * u, 12 * u, "#f4f3f0", -0.12);
  const ex = (g.eyeR.x - g.eyeL.x) / 2;
  c.beginPath();
  c.moveTo(g.eyeL.x - ex - 22 * u, g.eyeL.y - 6 * u);
  c.quadraticCurveTo(0, -30 * u, g.eyeR.x + ex + 22 * u, g.eyeR.y - 6 * u);
  c.quadraticCurveTo(g.eyeR.x + 10 * u, g.eyeR.y + 40 * u, g.nose.x, g.nose.y - 20 * u);
  c.quadraticCurveTo(g.eyeL.x - 10 * u, g.eyeL.y + 40 * u, g.eyeL.x - ex - 22 * u, g.eyeL.y - 6 * u);
  c.fillStyle = "#26262d";
  c.fill();
  eyeHoles(c, g);
  muzzle(c, g, { fill: "#f4f3f0", nose: "#1c1c22", ink: INK });
  whiskers(c, g, "rgba(30,30,40,0.6)");
}

function bear(c: C, g: Geometry, fx: DrawFx) {
  const H = headOf(g);
  roundEars(c, H, "#8a5a32", "#d7a679", fx.wiggle);
  ell(c, H.cx, H.cy, H.rx, H.ry, "#8a5a32");
  eyeHoles(c, g);
  eyeRims(c, g, "#55361c", 3 * g.u);
  muzzle(c, g, { fill: "#d9ad80", nose: "#221714", ink: INK, size: 1.3, noseSize: 1.3 });
}

function lion(c: C, g: Geometry, fx: DrawFx) {
  const H = headOf(g);
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + fx.wiggle * 0.02;
    const [x, y] = H.at(a, 1.12);
    ell(c, x, y, H.rx * 0.34, H.rx * 0.34, i % 2 ? "#a4521c" : "#c46b28");
  }
  roundEars(c, H, "#f0b44f", "#c46b28", 0, 0.7);
  ell(c, H.cx, H.cy, H.rx, H.ry, "#f0b44f");
  eyeHoles(c, g);
  eyeRims(c, g, "#8a4a18", 3 * g.u);
  muzzle(c, g, { fill: "#fff0d4", nose: "#6b3b2a", ink: INK, size: 1.1 });
  const { u } = g;
  const y = g.nose.y + (g.mouth.y - g.nose.y) * 0.45;
  for (const s of [-1, 1]) for (const [dx, dy] of [[22, -4], [32, 4], [20, 10]]) ell(c, g.nose.x + s * dx * u, y + dy * u, 2.4 * u, 2.4 * u, "#8a4a18");
}

function penguin(c: C, g: Geometry, fx: DrawFx) {
  const H = headOf(g);
  ell(c, H.cx, H.cy - H.ry * 0.05, H.rx * 1.02, H.ry * 1.08, "#1e2531");
  const { u } = g;
  const W = "#f8f8f6";
  ell(c, g.eyeL.x - 6 * u, g.eyeL.y + 14 * u, 40 * u, 54 * u, W, 0.25);
  ell(c, g.eyeR.x + 6 * u, g.eyeR.y + 14 * u, 40 * u, 54 * u, W, -0.25);
  ell(c, H.cx, g.mouth.y + 10 * u, H.rx * 0.62, (g.chin - g.nose.y) * 0.75, W);
  blush(c, g, "rgba(246,140,170,0.45)");
  eyeHoles(c, g);
  const bx = g.nose.x;
  const by = g.nose.y - 6 * u;
  const gap = g.open * 26 * u;
  poly(c, [[bx - 22 * u, by], [bx + 22 * u, by], [bx, by + 30 * u]], "#f5a020");
  poly(c, [[bx - 16 * u, by + 26 * u + gap], [bx + 16 * u, by + 26 * u + gap], [bx, by + 42 * u + gap]], "#e08a12");
  void fx;
}

function owl(c: C, g: Geometry, fx: DrawFx) {
  const H = headOf(g);
  for (const s of [-1, 1]) {
    const b1 = H.at(UP + s * 0.5);
    const b2 = H.at(UP + s * 1.15);
    poly(c, [b1, [H.cx + s * H.rx * (1.0 + fx.wiggle * 0.03), H.cy - H.ry * 1.32], b2], "#7a5a3c");
  }
  ell(c, H.cx, H.cy, H.rx, H.ry, "#8c6a48");
  const { u } = g;
  for (const e of [g.eyeL, g.eyeR]) ell(c, e.x, e.y + 4 * u, 48 * u, 50 * u, "#e8d6b6");
  for (let i = 0; i < 6; i++) {
    const x = H.cx + (i - 2.5) * 22 * u;
    line(c, "#6a4c30", 2.5 * u, (p) => {
      p.moveTo(x - 7 * u, g.mouth.y + 28 * u + (i % 2) * 10 * u);
      p.quadraticCurveTo(x, g.mouth.y + 36 * u + (i % 2) * 10 * u, x + 7 * u, g.mouth.y + 28 * u + (i % 2) * 10 * u);
    });
  }
  eyeHoles(c, g, 1.1);
  eyeRims(c, g, "#f2a01c", 8 * u, 1.1);
  const bx = g.nose.x;
  const by = g.nose.y - 18 * u;
  poly(c, [[bx - 12 * u, by], [bx + 12 * u, by], [bx, by + 34 * u + g.open * 12 * u]], "#e8a33a");
  if (g.open > 0.15) ell(c, g.mouth.x, g.mouth.y + 8 * u, 16 * u, g.open * 22 * u, "#3a1420");
}

const DRAW: Record<AnimalId, (c: C, g: Geometry, fx: DrawFx) => void> = {
  cat, dog, fox, bunny, panda, tiger, frog, raccoon, bear, lion, penguin, owl,
};

/** Draw `id` in the face frame (origin between the eyes; see the module comment). */
export function drawAnimal(c: C, id: AnimalId, g: Geometry, fx: DrawFx): void {
  const draw = DRAW[id];
  if (!draw) return;
  c.save();
  draw(c, g, fx);
  if (fx.preview) previewEyes(c, g, id === "owl" ? 1.1 : 1);
  c.restore();
}

/** A front-facing stand-in face, for pickers and icons. */
export function neutralGeometry(): Geometry {
  return {
    u: 1,
    eyeL: { x: -50, y: 0 },
    eyeR: { x: 50, y: 0 },
    eyeW: 17,
    nose: { x: 0, y: 58 },
    mouth: { x: 0, y: 98 },
    mouthW: 28,
    open: 0,
    left: -108,
    right: 108,
    top: -92,
    chin: 150,
  };
}
