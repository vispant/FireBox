// Understory -- the Sylvan, the player's forest spirit.
//
// A procedurally drawn, anatomically proportioned creature (Canvas 2D only):
// a slender, bark-skinned figure with deer-like digitigrade legs, a swept
// antler crown, leaf ears, a moss mantle and a leaf cloak that streams behind
// it, and a glowing heartwood core in its chest that lights the body from
// within. Limbs are continuous organic forms (muscle taper, bulging thigh and
// calf, narrow hock) driven by two-bone IK so knees and elbows bend the way
// real joints do; every surface is shaded for one warm key light with a cool
// rim, bark ridges and moss; and the pose -- idle breathing, run cycle, jump,
// fall, landing squash, melee lunge, spore cast, kneeling revive, hurt recoil,
// seated rest -- is a pure function of the inputs, so the same renderer serves
// gameplay, title and cutscene.
//
// Local space: +x = facing direction, y down, origin = ground point under the
// pelvis. Standing height is ~88 units; `scale` converts units to pixels.

import { TAU, clamp, lerp, easeOutCubic, seededRand } from "./understoryArt.js?v=1";

const LIGHT = [0.35, -0.9];

const NEAR = {
  mid: "#6c4b2c",
  lo1: "rgba(30,17,8,0.55)",
  lo2: "rgba(22,11,4,0.42)",
  hi1: "rgba(196,154,96,0.55)",
  hi2: "rgba(244,220,168,0.3)",
  rim: "rgba(246,228,178,0.62)",
  ridge: "rgba(18,10,4,0.36)",
  ridgeHi: "rgba(236,206,150,0.22)",
  shadow: [0.9, 1.8],
};
const FAR = {
  mid: "#3a291a",
  lo1: "rgba(12,7,3,0.55)",
  lo2: "rgba(8,4,2,0.4)",
  hi1: "rgba(122,94,60,0.42)",
  hi2: "rgba(176,146,104,0.22)",
  rim: "rgba(205,195,155,0.2)",
  ridge: "rgba(8,4,2,0.4)",
  ridgeHi: "rgba(150,120,80,0.12)",
};

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------
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
  for (let pass = 0; pass < 2; pass++) {
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

function profile(u, keys) {
  // piecewise cosine interpolation of [u, value] control pairs
  for (let i = 0; i < keys.length - 1; i++) {
    const [u0, v0] = keys[i];
    const [u1, v1] = keys[i + 1];
    if (u <= u1) {
      const k = (u - u0) / (u1 - u0 || 1);
      const e = (1 - Math.cos(clamp(k, 0, 1) * Math.PI)) / 2;
      return lerp(v0, v1, e);
    }
  }
  return keys[keys.length - 1][1];
}
const FRONT_T = [[0, 6.6], [0.3, 5.2], [0.68, 8.8], [1, 6.4]];
const BACK_T = [[0, 6.4], [0.3, 5.0], [0.68, 6.6], [1, 7.4]];

// ---------------------------------------------------------------------------
// antlers
// ---------------------------------------------------------------------------
function antler(ctx, ox, oy, ang0, L, sway, base, hi, seed, showBuds, t) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  let x = ox;
  let y = oy;
  let ang = ang0 + sway;
  const segs = 4;
  const tips = [];
  for (let i = 0; i < segs; i++) {
    const segLen = (L / segs) * (1.08 - i * 0.05);
    const w = lerp(3.0, 1.2, i / segs);
    const nx = x + Math.cos(ang) * segLen;
    const ny = y + Math.sin(ang) * segLen;
    ctx.strokeStyle = base;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    ctx.strokeStyle = hi;
    ctx.lineWidth = Math.max(0.5, w * 0.34);
    ctx.beginPath();
    ctx.moveTo(x - 0.4, y - 0.4);
    ctx.lineTo(nx - 0.4, ny - 0.4);
    ctx.stroke();
    if (i >= 1) {
      const tAng = ang + 0.95 + seededRand(seed + i * 5) * 0.3 + sway * 0.6;
      const tLen = segLen * (1.25 - i * 0.12);
      const tx = nx + Math.cos(tAng) * tLen;
      const ty = ny + Math.sin(tAng) * tLen;
      ctx.strokeStyle = base;
      ctx.lineWidth = w * 0.8;
      ctx.beginPath();
      ctx.moveTo(nx - Math.cos(ang) * segLen * 0.3, ny - Math.sin(ang) * segLen * 0.3);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.strokeStyle = hi;
      ctx.lineWidth = Math.max(0.4, w * 0.27);
      ctx.beginPath();
      ctx.moveTo(nx - 0.3, ny - 0.3);
      ctx.lineTo(tx - 0.3, ty - 0.3);
      ctx.stroke();
      tips.push([tx, ty, tAng]);
    }
    x = nx;
    y = ny;
    ang += 0.24;
  }
  tips.push([x, y, ang]);
  if (showBuds) {
    for (let i = 0; i < tips.length; i++) {
      const [tx, ty, ta] = tips[i];
      const lg = 3 + seededRand(seed + i * 7) * 1.5;
      leaf(ctx, tx, ty, tx + Math.cos(ta - 0.5) * lg * 1.6, ty + Math.sin(ta - 0.5) * lg * 1.6, lg * 0.5, "#4e9a3a", "#9ed95e", null);
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < tips.length; i++) {
      const [tx, ty] = tips[i];
      ctx.fillStyle = `rgba(255,240,150,${0.35 + 0.25 * Math.sin(t * 2.4 + i * 1.9)})`;
      ctx.beginPath();
      ctx.arc(tx, ty, 1.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// head: drawn in head-local space (origin = skull centre, +x = snout)
// ---------------------------------------------------------------------------
function drawHead(ctx, o) {
  const { t, blink, sway, lookUp } = o;
  const twitch = Math.sin(t * 0.9) > 0.97 ? 0.35 : 0;
  // far ear + far antler (behind the skull, darker)
  leaf(ctx, -1, -6, -8 - twitch * 6, -15 + twitch * 2, 3.2, "#2b3a1f", "#456332", null);
  antler(ctx, 0.6, -8, -1.45, 19, sway * 0.7, "#46321f", "#6a4f35", 11, false, t);

  const head = new Path2D();
  head.moveTo(-7, 0);
  head.bezierCurveTo(-8.2, -8, 2, -10.2, 6, -6.6);
  head.bezierCurveTo(9, -4.7, 13, -2.3, 17, 1.2);
  head.bezierCurveTo(18.3, 3.3, 16.4, 5.7, 13, 6.1);
  head.bezierCurveTo(9.6, 6.3, 8, 7.5, 4, 8.5);
  head.bezierCurveTo(-1, 10, -6.6, 7, -7, 0);
  head.closePath();
  const g = ctx.createLinearGradient(0, -10, 2, 10);
  g.addColorStop(0, "#b48c5a");
  g.addColorStop(0.5, "#7d5a36");
  g.addColorStop(1, "#4a3220");
  ctx.fillStyle = g;
  ctx.fill(head);
  ctx.save();
  ctx.clip(head);
  // fine fur/bark texture on the skull
  ctx.strokeStyle = "rgba(24,14,6,0.3)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const px = -6 + i * 2;
    const py = -6.5 + seededRand(i * 2.3) * 12;
    ctx.moveTo(px, py);
    ctx.lineTo(px + 2.4, py + 0.9);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(244,222,170,0.18)";
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const px = -4 + i * 2.6;
    const py = -7 + seededRand(i * 5.3) * 6;
    ctx.moveTo(px, py);
    ctx.lineTo(px + 2.2, py + 0.7);
  }
  ctx.stroke();
  // cream muzzle
  const mg = ctx.createRadialGradient(14, 2.8, 0.5, 14, 2.8, 7.2);
  mg.addColorStop(0, "rgba(238,224,182,0.85)");
  mg.addColorStop(1, "rgba(238,224,182,0)");
  ctx.fillStyle = mg;
  ctx.fillRect(5, -3, 16, 12);
  // under-jaw shadow
  const sg = ctx.createLinearGradient(0, 4, 0, 10);
  sg.addColorStop(0, "rgba(10,5,2,0)");
  sg.addColorStop(1, "rgba(10,5,2,0.4)");
  ctx.fillStyle = sg;
  ctx.fillRect(-8, 4, 28, 7);
  ctx.restore();
  ctx.strokeStyle = "rgba(246,230,184,0.55)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-4.4, -7.6);
  ctx.bezierCurveTo(-1, -9.7, 3.4, -9, 6, -6.6);
  ctx.bezierCurveTo(9, -4.7, 13, -2.4, 16.4, 0.7);
  ctx.stroke();
  // nose + mouth
  ctx.fillStyle = "#18100a";
  ctx.beginPath();
  ctx.ellipse(16.9, 1.3, 1.9, 1.5, 0.35, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.arc(16.4, 0.6, 0.45, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(22,12,6,0.65)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(16, 3.4);
  ctx.quadraticCurveTo(12, 5.6, 8.4, 5.2);
  ctx.stroke();

  // eye socket, amber iris, slit pupil, catchlight, lid
  const ex = 5.4;
  const ey = -2.6 + (lookUp ? -0.4 : 0);
  ctx.fillStyle = "rgba(14,7,3,0.55)";
  ctx.beginPath();
  ctx.ellipse(ex, ey + 0.2, 4.1, 3.2, -0.15, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.translate(ex, ey);
  ctx.scale(1, Math.max(0.08, 1 - blink));
  const ig = ctx.createRadialGradient(0.3, -0.3, 0.2, 0, 0, 3.2);
  ig.addColorStop(0, "#fff7c4");
  ig.addColorStop(0.4, "#ffc94a");
  ig.addColorStop(1, "#b9621c");
  ctx.fillStyle = ig;
  ctx.beginPath();
  ctx.ellipse(0, 0, 3.3, 2.7, -0.1, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#1e0f06";
  ctx.beginPath();
  ctx.ellipse(0.5, 0, 1.0, 2.2, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(-0.7, -1.1, 0.75, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(20,10,4,0.85)";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(1.6, ey - 2.1);
  ctx.quadraticCurveTo(5.6, ey - 3.6, 8.8, ey - 0.9);
  ctx.stroke();
  ctx.strokeStyle = "rgba(34,20,10,0.8)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(1.2, ey - 3.9);
  ctx.quadraticCurveTo(5.4, ey - 5.8, 9.4, ey - 3.4);
  ctx.stroke();

  // moss beard under the jaw
  for (let i = 0; i < 4; i++) {
    const bx = 2 + i * 2.4;
    const by = 8.2 - i * 0.35;
    leaf(ctx, bx, by, bx - 1.4 + Math.sin(t * 1.4 + i) * 0.6, by + 5.4 - i * 0.5, 1.3, "#4c7a2c", "#8dbd52", null);
  }

  // near ear + near antler
  leaf(ctx, -3.4, -6.6, -14.5 - twitch * 6, -14 + twitch * 2.5, 3.9, "#5d7a35", "#a9cf6c", "rgba(30,50,16,0.7)");
  leaf(ctx, -4.4, -6.6, -11.4 - twitch * 4, -11.6 + twitch * 2, 1.9, "#d9a98a", "#f0cdb0", null);
  antler(ctx, -3.2, -8.4, -1.98, 21, sway, "#5d432b", "#b09064", 4, true, t);
}

// ---------------------------------------------------------------------------
// the whole creature
// ---------------------------------------------------------------------------
export function drawSylvan(ctx, o) {
  const S = o.scale ?? 0.6;
  const f = o.facing < 0 ? -1 : 1;
  const t = o.t || 0;
  const glowMul = o.glow ?? 1;
  const run = clamp(o.speed || 0, 0, 1);
  const onGround = o.onGround !== false;
  const sit = !!o.sitting;
  const atk = o.attackT ?? -1;
  const cast = o.castT ?? -1;
  const rev = o.reviveT ?? 0;
  const hurt = o.hurtT ?? 0;
  const land = o.landT ?? 0;
  const vy = o.vy || 0;
  const phase = o.runPhase || 0;
  const flowLocal = clamp(((o.flowVx || 0) * f) / 230, -1.2, 1.2);
  const breathe = Math.sin(t * 2.1);

  // ---- pose -------------------------------------------------------------
  let hipX = 0;
  let hipY = -40 + breathe * 0.3;
  let lean = 1.4 + breathe * 0.25;
  let headTilt = 0.02;
  let tN = [5, 0];
  let tF = [-5, 0];
  let footDx = -6;
  let footDy = -11;
  let hN = null; // hand targets relative to the shoulder
  let hF = null;
  let skirtSwing = 0;

  const sway = clamp(-flowLocal * 0.1 - (vy / 900) * 0.12, -0.22, 0.22);

  if (sit) {
    hipX = -4;
    hipY = -9 + breathe * 0.2;
    lean = 5.5 + breathe * 0.3;
    headTilt = -0.16;
    tN = [20, 0];
    tF = [14, 0];
    footDx = -9;
    footDy = -2;
    hN = "knee";
    hF = [4, 22];
  } else if (rev > 0) {
    hipY = -29 + Math.sin(t * 3.2) * 0.35;
    lean = 9;
    headTilt = 0.18;
    tN = [10, 0];
    tF = [-6, 0];
    hN = [20, 16];
    hF = [3, 21];
  } else if (!onGround) {
    if (vy < 0) {
      hipY = -37;
      lean = 3;
      tN = [9, -16];
      tF = [-7, -9];
      hN = [10, -7];
      hF = [-8, 3];
      headTilt = -0.08;
    } else {
      hipY = -43;
      lean = 1;
      tN = [5, -3];
      tF = [-5, -6];
      hN = [12, 8];
      hF = [-11, 9];
      headTilt = 0.06;
    }
  } else if (run > 0.06) {
    const stride = 12 + 6 * run;
    const lift = 8.5 + 3 * run;
    const cN = Math.cos(phase);
    const sN = Math.sin(phase);
    const cF = -cN;
    const sF = -sN;
    const idleN = [5, 0];
    const idleF = [-5, 0];
    tN = [lerp(idleN[0], stride * cN + 2, run), lerp(idleN[1], -lift * Math.max(0, -sN), run)];
    tF = [lerp(idleF[0], stride * cF + 2, run), lerp(idleF[1], -lift * Math.max(0, -sF), run)];
    hipY = -40.5 - run * 1.4 - 2.0 * Math.cos(2 * phase) * run + breathe * 0.3 * (1 - run);
    lean = lerp(1.4, 2 + 5.5 * run, run);
    headTilt = -0.02 - run * 0.05;
    hN = [lerp(-3.5, 3 - 10 * cN, run), lerp(26, 20 - 5 * Math.max(0, -cN), run)];
    hF = [lerp(-3, 3 - 10 * cF, run), lerp(26.5, 20 - 5 * Math.max(0, -cF), run)];
    skirtSwing = sN * run * 0.5;
  } else {
    hN = [-3.5 + Math.sin(t * 1.3) * 0.6, 26];
    hF = [-1, 26.5];
  }

  if (land > 0) {
    hipY += 6 * land;
    lean += 4 * land;
  }
  if (atk >= 0) {
    const e = easeOutCubic(clamp(atk, 0, 1));
    const arc = Math.sin(Math.PI * clamp(atk, 0, 1));
    lean += 6 * arc;
    hipY += 1.6 * arc;
    tN = [tN[0] + 9 * e, tN[1]];
    tF = [tF[0] - 6 * e, tF[1]];
    hN = [lerp(-15, 26, e), lerp(-12, 7, e) - arc * 8];
    headTilt += 0.1 * arc;
  }
  let castFlare = 0;
  if (cast >= 0) {
    const e = easeOutCubic(clamp(cast, 0, 1));
    castFlare = Math.sin(Math.PI * clamp(cast, 0, 1));
    lean += 4 * castFlare;
    hN = [lerp(6, 25, e), lerp(2, -3, e)];
  }
  if (hurt > 0) {
    lean -= 5 * hurt;
    headTilt -= 0.26 * hurt;
    hipY += 1.5 * hurt;
    hN = [(hN && hN !== "knee" ? hN[0] : 3) - 7 * hurt, (hN && hN !== "knee" ? hN[1] : 26) - 12 * hurt];
    hF = [-10 * hurt - 3, 14 - 8 * hurt];
  }

  const hip = [hipX, hipY];
  const sh = [hipX + lean, hipY - 27];
  const pulse = 1 + 0.16 * Math.sin(t * 2.7) + 0.5 * rev + 0.9 * castFlare + 0.3 * (atk >= 0 ? 1 : 0);

  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.scale(S * f, S);
  if (o.alpha != null && o.alpha < 1) ctx.globalAlpha = Math.max(0, o.alpha);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // ---- cloak (behind everything) -----------------------------------------
  {
    const ax = sh[0] - 3.5;
    const ay = sh[1] + 1.5;
    const backAmt = clamp(0.25 + flowLocal * 0.55 + (sit ? -0.1 : 0), -0.1, 0.9);
    const fall = onGround ? 0 : clamp(vy / 650, -1, 1);
    const n = 8;
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        let ang = lerp(1.6, 2.7, backAmt) + (u - 0.5) * (layer ? 0.5 : 0.62) + (layer ? 0.1 : -0.04);
        ang += fall * 0.5 + Math.sin(t * 2.3 + i * 0.75 + layer) * (0.05 + 0.06 * run);
        const L = ((layer ? 17 : 22) * (0.78 + 0.22 * Math.sin(u * Math.PI)) + 3 * u) * (1 + 0.15 * backAmt);
        const bx = ax - u * 2 + (layer ? 0.8 : 0);
        const by = ay + u * 8 * (sit ? 0.5 : 1);
        const tx = bx + Math.cos(ang) * L;
        const ty = by + Math.sin(ang) * L;
        if (layer === 0) leaf(ctx, bx, by, tx, ty, 5.2, "#1d4524", "#2c6431", "rgba(10,30,12,0.6)");
        else leaf(ctx, bx, by, tx, ty, 4.3, i % 3 === 1 ? "#6f8f33" : "#3d8538", i % 3 === 1 ? "#c4d86a" : "#8cc95a", "rgba(20,50,16,0.5)");
      }
    }
  }

  // ---- limb builders ---------------------------------------------------------
  const drawArm = (target, pal, seed, k, rootDx) => {
    const rx = sh[0] + rootDx;
    const ry = sh[1] + 1.4;
    const [ex, ey] = ik2(rx, ry, target[0], target[1], 15, 15.5, -1);
    organicLimb(ctx, [[rx, ry], [ex, ey], target], [4.3 * k, 3.1 * k, 2.1 * k], [0.14, 0.2], pal, seed);
    {
      const da = Math.atan2(target[1] - ey, target[0] - ex);
      const dark = pal === FAR ? "#24170e" : "#4a321e";
      const tip = pal === FAR ? "#4a3522" : "#a98353";
      ctx.lineCap = "round";
      for (let q = 0; q < 4; q++) {
        const a = da + (q - 1.5) * 0.34 + Math.sin(t * 1.7 + q) * 0.04;
        const l1 = (q === 0 ? 2.6 : 3.4) * k;
        const l2 = (q === 0 ? 2 : 2.8) * k;
        const mx = target[0] + Math.cos(a) * l1;
        const my = target[1] + Math.sin(a) * l1;
        const ex2 = mx + Math.cos(a + 0.5) * l2;
        const ey2 = my + Math.sin(a + 0.5) * l2;
        ctx.strokeStyle = dark;
        ctx.lineWidth = 1.25 * k;
        ctx.beginPath();
        ctx.moveTo(target[0], target[1]);
        ctx.lineTo(mx, my);
        ctx.lineTo(ex2, ey2);
        ctx.stroke();
        ctx.strokeStyle = tip;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(ex2, ey2);
        ctx.stroke();
      }
    }
    return [ex, ey];
  };
  const drawLeg = (toe, pal, seed, k) => {
    const ax = toe[0] + footDx;
    const ay = toe[1] + footDy;
    const [kx, ky] = ik2(hip[0], hip[1], ax, ay, 19.5, 20.5, 1);
    organicLimb(ctx, [hip, [kx, ky], [ax, ay], toe], [5.7 * k, 3.7 * k, 2.4 * k, 1.8 * k], [0.14, 0.26, 0.02], pal, seed);
    ctx.fillStyle = pal === FAR ? "#120b06" : "#1e130b";
    ctx.beginPath();
    ctx.moveTo(toe[0] - 1.9, toe[1] - 1.7);
    ctx.lineTo(toe[0] + 3.9, toe[1] + 0.2);
    ctx.lineTo(toe[0] - 1.7, toe[1] + 0.4);
    ctx.closePath();
    ctx.fill();
    return [kx, ky];
  };

  // ---- far arm + far leg --------------------------------------------------
  if (hF) drawArm([sh[0] + hF[0], sh[1] + hF[1]], FAR, 21, 0.95, 1.4);
  drawLeg(tF, FAR, 31, 0.97);

  // ---- torso ---------------------------------------------------------------
  const ctrl = [hip[0] + lean * 0.25 - 1.6, hip[1] - 13.5];
  const spine = (u) => {
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    return [a * hip[0] + b * ctrl[0] + c * sh[0], a * hip[1] + b * ctrl[1] + c * sh[1]];
  };
  const spineN = (u) => {
    const e = 0.02;
    const p0 = spine(clamp(u - e, 0, 1));
    const p1 = spine(clamp(u + e, 0, 1));
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dy / l, -dx / l]; // forward-pointing normal (+x when the spine goes up)
  };
  const front = [];
  const back = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    const p = spine(u);
    const nn = spineN(u);
    const ft = profile(u, FRONT_T);
    const bt = profile(u, BACK_T);
    front.push([p[0] + nn[0] * ft, p[1] + nn[1] * ft]);
    back.push([p[0] - nn[0] * bt, p[1] - nn[1] * bt]);
  }
  const torso = new Path2D();
  smoothThrough(torso, front, true);
  const topF = front[front.length - 1];
  const topB = back[back.length - 1];
  torso.quadraticCurveTo((topF[0] + topB[0]) / 2 + 1.2, Math.min(topF[1], topB[1]) - 3.2, topB[0], topB[1]);
  smoothThrough(torso, back.slice().reverse(), false);
  torso.quadraticCurveTo(hip[0], hip[1] + 4.4, front[0][0], front[0][1]);
  torso.closePath();
  const mid = spine(0.55);
  const mn = spineN(0.55);
  const tg = ctx.createLinearGradient(mid[0] - mn[0] * 8, mid[1] - mn[1] * 8, mid[0] + mn[0] * 9.5, mid[1] + mn[1] * 9.5);
  tg.addColorStop(0, "#2a1c11");
  tg.addColorStop(0.5, "#5b4027");
  tg.addColorStop(1, "#98703f");
  ctx.fillStyle = tg;
  ctx.fill(torso);

  const corePos = (() => {
    const p = spine(0.6);
    const nn = spineN(0.6);
    return [p[0] + nn[0] * 2.4, p[1] + nn[1] * 2.4];
  })();

  ctx.save();
  ctx.clip(torso);
  // bark fissures following the spine, each with a lit lip
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? "rgba(18,10,4,0.46)" : "rgba(236,204,150,0.16)";
    ctx.lineWidth = pass === 0 ? 1 : 0.8;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const side = -0.9 + k * 0.25 + pass * 0.07;
      const u0 = 0.06 + seededRand(k * 1.3) * 0.25;
      const u1 = Math.min(0.98, u0 + 0.28 + seededRand(k * 2.9) * 0.35);
      for (let sIdx = 0; sIdx <= 4; sIdx++) {
        const u = lerp(u0, u1, sIdx / 4);
        const p = spine(u);
        const nn = spineN(u);
        const w = side > 0 ? profile(u, FRONT_T) : profile(u, BACK_T);
        const x = p[0] + nn[0] * side * w * 0.84 + Math.sin(u * 14 + k) * 0.5;
        const y = p[1] + nn[1] * side * w * 0.84;
        if (sIdx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
  // lichen / moss patches
  for (let k = 0; k < 5; k++) {
    const u = 0.15 + seededRand(k * 4.1) * 0.8;
    const p = spine(u);
    const nn = spineN(u);
    const side = (seededRand(k * 6.7) - 0.5) * 1.5;
    ctx.fillStyle = k % 2 ? "rgba(122,168,70,0.55)" : "rgba(160,196,92,0.42)";
    ctx.beginPath();
    ctx.ellipse(p[0] + nn[0] * side * 6, p[1] + nn[1] * side * 6, 2.3 + seededRand(k) * 1.8, 1.4 + seededRand(k + 3) * 1.1, seededRand(k * 8) * 3, 0, TAU);
    ctx.fill();
  }
  // chest highlight (key light) and belly shadow
  {
    const c = spine(0.68);
    const nn = spineN(0.68);
    const hx = c[0] + nn[0] * 4;
    const hy = c[1] - 1;
    const hg = ctx.createRadialGradient(hx, hy, 0.5, hx, hy, 8);
    hg.addColorStop(0, "rgba(255,226,170,0.2)");
    hg.addColorStop(1, "rgba(255,226,170,0)");
    ctx.fillStyle = hg;
    ctx.fillRect(hx - 9, hy - 9, 18, 18);
  }
  const sg = ctx.createLinearGradient(0, hip[1] - 4, 0, hip[1] + 6);
  sg.addColorStop(0, "rgba(0,0,0,0)");
  sg.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = sg;
  ctx.fillRect(hip[0] - 14, hip[1] - 4, 28, 12);
  // warm light spilling from the heartwood
  ctx.globalCompositeOperation = "lighter";
  const cg = ctx.createRadialGradient(corePos[0], corePos[1], 1, corePos[0], corePos[1], 13);
  cg.addColorStop(0, `rgba(255,165,70,${clamp(0.3 * pulse * glowMul, 0, 0.6)})`);
  cg.addColorStop(1, "rgba(255,120,30,0)");
  ctx.fillStyle = cg;
  ctx.fillRect(corePos[0] - 14, corePos[1] - 14, 28, 28);
  ctx.restore();
  // torso rim light on the back edge
  ctx.strokeStyle = "rgba(190,215,200,0.3)";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  back.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();
  // woven vine sash, back-shoulder to front-hip
  {
    const a = spine(0.92);
    const b = spine(0.1);
    const an = spineN(0.92);
    const bn = spineN(0.1);
    const ax = a[0] - an[0] * 6.6;
    const ay = a[1] - an[1] * 6.6;
    const bx = b[0] + bn[0] * 5.6;
    const by = b[1] + bn[1] * 5.6;
    ctx.save();
    ctx.clip(torso);
    ctx.strokeStyle = "#2f4a22";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo((ax + bx) / 2 + 1.8, (ay + by) / 2 - 0.6, bx, by);
    ctx.stroke();
    ctx.strokeStyle = "rgba(150,200,90,0.55)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(ax - 0.4, ay - 0.6);
    ctx.quadraticCurveTo((ax + bx) / 2 + 1.4, (ay + by) / 2 - 1.3, bx - 0.4, by - 0.6);
    ctx.stroke();
    ctx.restore();
  }

  // ---- heartwood core: a glowing seed cradled in a hollow of the chest ----
  {
    const [cx, cy] = corePos;
    ctx.fillStyle = "#1a0f08";
    ctx.beginPath();
    ctx.ellipse(cx, cy, 4.6, 6.2, 0.08, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(130,92,50,0.9)";
    ctx.lineWidth = 1;
    ctx.stroke();
    const cgr = ctx.createRadialGradient(cx - 0.4, cy - 0.8, 0.3, cx, cy, 4.6);
    cgr.addColorStop(0, "#fffbe0");
    cgr.addColorStop(0.35, "#ffd35c");
    cgr.addColorStop(0.8, "#ff8a2e");
    cgr.addColorStop(1, "#b0420f");
    ctx.fillStyle = cgr;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 3.2 * (0.9 + 0.1 * pulse), 4.7 * (0.9 + 0.1 * pulse), 0.08, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.ellipse(cx - 1, cy - 1.8, 0.9, 1.5, -0.3, 0, TAU);
    ctx.fill();
  }

  // ---- neck ------------------------------------------------------------------
  const headC = [sh[0] + 6.2 + lean * 0.14, sh[1] - 13.2];
  {
    const nb = [sh[0] + 0.8, sh[1] - 0.6];
    const nt = [headC[0] - 3.4, headC[1] + 5.4];
    const nm = [lerp(nb[0], nt[0], 0.5) + 0.6, lerp(nb[1], nt[1], 0.5)];
    organicLimb(ctx, [nb, nm, nt], [5.5, 4.4, 4.1], [0.05, 0.02], NEAR, 41);
  }

  // ---- near leg (+ knee tuft) -----------------------------------------------
  const nearKnee = drawLeg(tN, NEAR, 51, 1);
  for (let i = 0; i < 3; i++) {
    const a = -2.4 + i * 0.5 + Math.sin(t * 2.1 + i) * 0.06;
    leaf(ctx, nearKnee[0] + 0.5, nearKnee[1] - 0.5, nearKnee[0] + 0.5 + Math.cos(a) * 6.2, nearKnee[1] - 0.5 + Math.sin(a) * 6.2, 1.3, "#4b8a33", "#9ccf5f", null);
  }

  // ---- hip shadow + leaf skirt ----------------------------------------------
  {
    const ag = ctx.createRadialGradient(hip[0], hip[1] + 4, 1, hip[0], hip[1] + 4, 12);
    ag.addColorStop(0, "rgba(0,0,0,0.35)");
    ag.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = ag;
    ctx.fillRect(hip[0] - 13, hip[1] - 8, 26, 26);
    const sk = 7;
    for (let i = 0; i < sk; i++) {
      const u = i / (sk - 1);
      const bx = hip[0] - 6 + u * 12;
      const by = hip[1] - 1.5 + Math.abs(u - 0.5) * 1.6;
      const swing = Math.sin(t * 2 + i) * 0.1 + skirtSwing * (u - 0.5 + 0.4);
      const a = Math.PI / 2 + (u - 0.5) * 0.7 + swing - flowLocal * 0.25;
      const L = 12.5 + 3 * Math.sin(u * 3.1 + 0.4);
      const tx = bx + Math.cos(a) * L;
      const ty = by + Math.sin(a) * L * (sit ? 0.6 : 1);
      leaf(ctx, bx, by, tx, ty, 3.1, i % 3 === 0 ? "#6e8c2c" : "#3a7a35", i % 3 === 0 ? "#b5cf5a" : "#7fc656", "rgba(20,44,14,0.55)");
    }
    ctx.strokeStyle = "#47311d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hip[0] - 7.4, hip[1] - 1.7);
    ctx.quadraticCurveTo(hip[0], hip[1] + 1.4, hip[0] + 7.6, hip[1] - 1.7);
    ctx.stroke();
  }

  // ---- shoulder mantle (moss + leaves around the collar) --------------------
  {
    const mx = sh[0] - 0.5;
    const my = sh[1] + 0.5;
    for (let i = 0; i < 6; i++) {
      const u = i / 5;
      const a = lerp(-0.5, 2.9, u) + Math.sin(t * 1.6 + i * 1.1) * 0.05 - flowLocal * 0.2;
      const L = 8.5 + 3.5 * Math.sin(u * Math.PI);
      const bx = mx + (u - 0.5) * 3;
      const by = my - 2;
      leaf(ctx, bx, by, bx + Math.cos(a) * L, by + Math.sin(a) * L * 0.8 + 1.5, 2.9, i % 2 ? "#4f8c35" : "#3a7430", i % 2 ? "#a6d466" : "#7fbd55", "rgba(20,44,14,0.5)");
    }
  }

  // ---- head group ----------------------------------------------------------
  {
    const blinkPeriod = 3.7;
    const bt = (t % blinkPeriod) / 0.14;
    const blink = bt < 1 ? Math.sin(bt * Math.PI) : 0;
    // soft shadow the chin casts on the collar
    const cs = ctx.createRadialGradient(headC[0] - 1, headC[1] + 8, 1, headC[0] - 1, headC[1] + 8, 9);
    cs.addColorStop(0, "rgba(0,0,0,0.3)");
    cs.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = cs;
    ctx.fillRect(headC[0] - 11, headC[1] - 1, 22, 20);
    ctx.save();
    ctx.translate(headC[0], headC[1]);
    ctx.rotate(headTilt);
    ctx.scale(0.88, 0.88);
    drawHead(ctx, { t, blink, sway, lookUp: headTilt < -0.1 });
    ctx.restore();
  }

  // ---- near arm -------------------------------------------------------------
  {
    let target;
    if (hN === "knee") target = [nearKnee[0] - 1, nearKnee[1] - 3.2];
    else target = [sh[0] + hN[0], sh[1] + hN[1]];
    drawArm(target, NEAR, 61, 1, -2.8);
    // a vine-leaf blade grows from the palm while attacking
    if (atk >= 0 && atk < 1) {
      const e = clamp(atk, 0, 1);
      const arc = Math.sin(Math.PI * e);
      const ang = lerp(-1.9, 0.9, easeOutCubic(e));
      leaf(ctx, target[0], target[1], target[0] + Math.cos(ang) * 22 * arc, target[1] + Math.sin(ang) * 22 * arc, 2.6 * arc + 0.1, "#58b043", "#d6f58a", null);
    }
    if (cast >= 0 || rev > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const pg = ctx.createRadialGradient(target[0], target[1], 0, target[0], target[1], 11);
      const ga = cast >= 0 ? 0.5 * castFlare + 0.15 : 0.25 + 0.45 * rev;
      pg.addColorStop(0, `rgba(210,255,140,${ga})`);
      pg.addColorStop(1, "rgba(160,240,100,0)");
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(target[0], target[1], 11, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---- additive light: heartwood halo, eye glow, hurt flash ----------------
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  {
    const [cx, cy] = corePos;
    const r = 24 + 8 * pulse;
    const hg = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
    hg.addColorStop(0, `rgba(255,190,90,${clamp(0.34 * pulse * glowMul, 0, 0.7)})`);
    hg.addColorStop(0.5, `rgba(255,150,50,${clamp(0.1 * pulse * glowMul, 0, 0.35)})`);
    hg.addColorStop(1, "rgba(255,120,30,0)");
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
  }
  {
    const ca = Math.cos(headTilt);
    const sa = Math.sin(headTilt);
    const ex = headC[0] + (5.4 * ca + 2.6 * sa) * 0.88;
    const ey = headC[1] + (5.4 * sa - 2.6 * ca) * 0.88;
    const eg = ctx.createRadialGradient(ex, ey, 0, ex, ey, 7);
    eg.addColorStop(0, "rgba(255,210,100,0.36)");
    eg.addColorStop(1, "rgba(255,190,80,0)");
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.arc(ex, ey, 7, 0, TAU);
    ctx.fill();
  }
  if (hurt > 0) {
    const rg = ctx.createRadialGradient(sh[0], hip[1] - 14, 4, sh[0], hip[1] - 14, 36);
    rg.addColorStop(0, `rgba(255,70,60,${0.34 * hurt})`);
    rg.addColorStop(1, "rgba(255,70,60,0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(sh[0], hip[1] - 14, 36, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  ctx.restore();
}
