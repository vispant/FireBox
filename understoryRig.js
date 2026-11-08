// Understory -- shared rigging helpers: two-bone IK and shaded organic limbs.
//
// Used by the player (understoryPerson.js) and the wildlife
// (understoryCreatures.js). A limb is one continuous silhouette through its
// joints (muscle/cloth taper, optional bulge) shaded like a cylinder that
// follows the bends: shadowed far edge, lit near edge, specular core, rim
// light, and optional surface ridges -- all clipped to the silhouette.

import { clamp, lerp, seededRand, hexToRgb } from "./understoryArt.js?v=2";

const LIGHT = [0.35, -0.9];

// Build a shading palette for organicLimb from one base colour. Options:
// ridge > 0 adds bark/fur-like surface ridges (0 = smooth cloth or skin),
// soft scales the highlight strength, shadow = [dx, dy] adds a soft contact
// shadow under the limb, rim is the rim-light alpha.
const palCache = new Map();
export function makePal(hex, o = {}) {
  const rim = o.rim ?? 0.45;
  const ridge = o.ridge ?? 0;
  const soft = o.soft ?? 1;
  const shadow = o.shadow ?? null;
  const key = hex + '|' + rim + '|' + ridge + '|' + soft + '|' + (shadow ? shadow.join(',') : '');
  let p = palCache.get(key);
  if (!p) {
    const [r, g, b] = hexToRgb(hex);
    const d = ((r * 0.3) | 0) + ',' + ((g * 0.27) | 0) + ',' + ((b * 0.26) | 0);
    const l = ((r + (255 - r) * 0.55) | 0) + ',' + ((g + (255 - g) * 0.5) | 0) + ',' + ((b + (255 - b) * 0.42) | 0);
    p = {
      mid: hex,
      lo1: 'rgba(' + d + ',0.55)',
      lo2: 'rgba(' + d + ',0.42)',
      hi1: 'rgba(' + l + ',' + 0.4 * soft + ')',
      hi2: 'rgba(' + l + ',' + 0.26 * soft + ')',
      rim: 'rgba(' + l + ',' + rim + ')',
      ridge: ridge > 0 ? 'rgba(' + d + ',' + ridge + ')' : null,
      ridgeHi: ridge > 0 ? 'rgba(' + l + ',' + ridge * 0.45 + ')' : null,
      shadow,
    };
    palCache.set(key, p);
  }
  return p;
}

// Two-bone IK. Returns the middle joint for a chain root->target with segment
// lengths l1,l2. dir=+1 bends toward +x (knee), -1 toward -x (elbow).
export function ik2(x0, y0, tx, ty, l1, l2, dir) {
  const dx = tx - x0;
  const dy = ty - y0;
  const d = clamp(Math.hypot(dx, dy), Math.abs(l1 - l2) + 0.05, l1 + l2 - 0.05);
  const a = Math.atan2(dy, dx);
  const A = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const ang = a - dir * A;
  return [x0 + Math.cos(ang) * l1, y0 + Math.sin(ang) * l1];
}

// smooth open curve through points via quadratic midpoints
export function smoothThrough(path, pts, moveFirst) {
  if (moveFirst) path.moveTo(pts[0][0], pts[0][1]);
  else path.lineTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    path.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  path.lineTo(last[0], last[1]);
}

// A continuous organic limb through `pts` with a half-width `radii[i]` at each
// joint and an optional muscle `bulges[i]` on the segment after joint i.
// Shaded like a cylinder that follows the bends: shadowed far edge, lit near
// edge, specular core, rim light, bark ridges -- all clipped to the silhouette.
export function organicLimb(ctx, pts, radii, bulges, pal, seed) {
  const samples = [];
  for (let i = 0; i < pts.length; i++) {
    samples.push({ x: pts[i][0], y: pts[i][1], r: radii[i] });
    if (i < pts.length - 1) {
      const u = 0.42;
      samples.push({ x: lerp(pts[i][0], pts[i + 1][0], u), y: lerp(pts[i][1], pts[i + 1][1], u), r: lerp(radii[i], radii[i + 1], u) * (1 + (bulges[i] || 0)) });
    }
  }
  const n = samples.length;
  let rSum = 0;
  for (let i = 0; i < n; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    samples[i].nx = -ty;
    samples[i].ny = tx;
    rSum += samples[i].r;
  }
  const rMean = rSum / n;
  const f0 = samples[0];
  const f1 = samples[n - 1];
  const gdx = f1.x - f0.x;
  const gdy = f1.y - f0.y;
  const gl = Math.hypot(gdx, gdy) || 1;
  const s = (-gdy / gl) * LIGHT[0] + (gdx / gl) * LIGHT[1] >= 0 ? 1 : -1; // +1: lit side is +normal

  const left = samples.map((p) => [p.x + p.nx * p.r, p.y + p.ny * p.r]);
  const right = samples.map((p) => [p.x - p.nx * p.r, p.y - p.ny * p.r]);
  const path = new Path2D();
  smoothThrough(path, left, true);
  const e = samples[n - 1];
  const angE = Math.atan2(e.ny, e.nx);
  path.arc(e.x, e.y, e.r, angE, angE - Math.PI, true);
  smoothThrough(path, right.slice().reverse(), false);
  const b0 = samples[0];
  const angB = Math.atan2(b0.ny, b0.nx);
  path.arc(b0.x, b0.y, b0.r, angB + Math.PI, angB, true);
  path.closePath();

  if (pal.shadow) {
    ctx.save();
    ctx.translate(pal.shadow[0], pal.shadow[1]);
    ctx.fillStyle = "rgba(0,0,0,0.26)";
    ctx.fill(path);
    ctx.restore();
  }
  ctx.fillStyle = pal.mid;
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  ctx.lineJoin = "round";
  const along = (off) => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p = samples[i];
      const x = p.x + p.nx * s * off * p.r;
      const y = p.y + p.ny * s * off * p.r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  ctx.strokeStyle = pal.lo1;
  ctx.lineWidth = rMean * 1.7;
  along(-1.05);
  ctx.strokeStyle = pal.lo2;
  ctx.lineWidth = rMean * 0.9;
  along(-0.95);
  ctx.strokeStyle = pal.hi1;
  ctx.lineWidth = rMean * 0.95;
  along(0.46);
  ctx.strokeStyle = pal.hi2;
  ctx.lineWidth = rMean * 0.34;
  along(0.55);
  // bark ridges: dark cracks and their lit lips, each batched into ONE stroke
  // call (pattern fills were far too slow on software-rendered canvases)
  const segs = Math.max(7, Math.round(gl / 2.5));
  for (let pass = 0; pass < (pal.ridge ? 2 : 0); pass++) {
    ctx.lineWidth = pass === 0 ? 0.9 : 0.7;
    ctx.strokeStyle = pass === 0 ? pal.ridge : pal.ridgeHi;
    ctx.beginPath();
    for (let k = 0; k < segs; k++) {
      const u = (k + 0.2 + seededRand(seed + k * 1.7) * 0.6) / segs;
      const fi = u * (n - 1);
      const i0 = Math.floor(fi);
      const i1 = Math.min(n - 1, i0 + 1);
      const q = fi - i0;
      const px = lerp(samples[i0].x, samples[i1].x, q);
      const py = lerp(samples[i0].y, samples[i1].y, q);
      const pr = lerp(samples[i0].r, samples[i1].r, q);
      const pnx = lerp(samples[i0].nx, samples[i1].nx, q);
      const pny = lerp(samples[i0].ny, samples[i1].ny, q);
      const off = (seededRand(seed * 3.1 + k) - 0.5) * 1.6 * pr + (pass ? 0.9 * s : 0);
      const tx = pny;
      const ty = -pnx;
      const h = (1.4 + seededRand(seed + k * 9.1) * 1.6) * (pass ? 0.8 : 1);
      ctx.moveTo(px + pnx * off - tx * h, py + pny * off - ty * h);
      ctx.lineTo(px + pnx * off + tx * h, py + pny * off + ty * h);
    }
    ctx.stroke();
  }
  ctx.restore();
  // rim light along the lit edge
  ctx.strokeStyle = pal.rim;
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p = samples[i];
    const x = p.x + p.nx * s * p.r * 0.9;
    const y = p.y + p.ny * s * p.r * 0.9;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function leafPath(ctx, bx, by, tx, ty, w) {
  const dx = tx - bx;
  const dy = ty - by;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const mx = bx + dx * 0.45;
  const my = by + dy * 0.45;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.quadraticCurveTo(mx + nx * w * 1.8, my + ny * w * 1.8, tx, ty);
  ctx.quadraticCurveTo(mx - nx * w * 1.8, my - ny * w * 1.8, bx, by);
  ctx.closePath();
}

// A leaf: body colour, a lighter lit half, and a midrib.
export function leaf(ctx, bx, by, tx, ty, w, base, lit, rib) {
  leafPath(ctx, bx, by, tx, ty, w);
  ctx.fillStyle = base;
  ctx.fill();
  const dx = tx - bx;
  const dy = ty - by;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const s = nx * LIGHT[0] + ny * LIGHT[1] >= 0 ? 1 : -1;
  const sx = nx * w * 0.5 * s;
  const sy = ny * w * 0.5 * s;
  leafPath(ctx, bx + dx * 0.05 + sx * 0.4, by + dy * 0.05 + sy * 0.4, tx - dx * 0.04 + sx * 0.2, ty - dy * 0.04 + sy * 0.2, w * 0.55);
  ctx.fillStyle = lit;
  ctx.fill();
  if (rib) {
    ctx.strokeStyle = rib;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(tx - dx * 0.08, ty - dy * 0.08);
    ctx.stroke();
  }
}
