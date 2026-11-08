// Understory -- wildlife, enemies and the Flood Dragon.
//
// Procedural Canvas 2D drawings of the watershed's real species (Roosevelt
// elk, cougar, black bear, bald eagle on a snag, banana slug on a nurse log),
// the silt wisp enemy and Deluge, the flood dragon boss. Quadrupeds share one
// rig -- outline, IK legs, neck, head, fur strokes, idle animation (breathing,
// grazing, ear twitch, tail flick, blink) -- so each species is a spec plus a
// head. Everything is a pure function of its inputs; local space is feet at
// y=0 and +x = facing direction.

import { TAU, clamp, lerp, easeOutCubic, seededRand, hexToRgb, mixRgb, drawContactShadow } from "./understoryArt.js?v=2";
import { organicLimb, ik2, leaf, smoothThrough } from "./understoryRig.js?v=1";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const palCache = new Map();
function pal(hex, rim = 0.45, ridge = 0.3, soft = 1) {
  const key = hex + rim + ridge + soft;
  let p = palCache.get(key);
  if (!p) {
    const [r, g, b] = hexToRgb(hex);
    const d = `${(r * 0.27) | 0},${(g * 0.25) | 0},${(b * 0.23) | 0}`;
    const l = `${(r + (255 - r) * 0.55) | 0},${(g + (255 - g) * 0.5) | 0},${(b + (255 - b) * 0.42) | 0}`;
    p = { mid: hex, lo1: `rgba(${d},0.55)`, lo2: `rgba(${d},0.42)`, hi1: `rgba(${l},${0.4 * soft})`, hi2: `rgba(${l},${0.26 * soft})`, rim: `rgba(${l},${rim})`, ridge: `rgba(${d},${ridge})`, ridgeHi: `rgba(${l},${ridge * 0.45})` };
    palCache.set(key, p);
  }
  return p;
}
function toHex(c) {
  return "#" + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");
}
function smoothClosed(path, pts) {
  const n = pts.length;
  path.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    path.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  path.closePath();
}
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function tapered(ctx, pts, w0, w1, col, hiCol) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    ctx.strokeStyle = col;
    ctx.lineWidth = lerp(w0, w1, i / n);
    ctx.beginPath();
    ctx.moveTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
    ctx.stroke();
  }
  if (hiCol) {
    ctx.strokeStyle = hiCol;
    for (let i = 0; i < n; i++) {
      ctx.lineWidth = Math.max(0.5, lerp(w0, w1, i / n) * 0.3);
      ctx.beginPath();
      ctx.moveTo(pts[i][0] - 0.5, pts[i][1] - 0.5);
      ctx.lineTo(pts[i + 1][0] - 0.5, pts[i + 1][1] - 0.5);
      ctx.stroke();
    }
  }
}
function furStrokes(ctx, x0, y0, x1, y1, count, seed, dark, light, len = 3.2) {
  ctx.lineWidth = 0.8;
  ctx.lineCap = "round";
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass === 0 ? dark : light;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = x0 + seededRand(seed + i * 1.37 + pass * 91) * (x1 - x0);
      const y = y0 + seededRand(seed + i * 2.71 + pass * 57) * (y1 - y0);
      const a = 0.25 + (seededRand(seed + i * 5.3) - 0.5) * 0.5;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    }
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// elk antlers (head-local, rooted just above the skull; sweep back, tines forward)
// ---------------------------------------------------------------------------
const ELK_BEAM = [[0, 0], [-6, -12], [-16, -20], [-30, -25], [-44, -25], [-56, -19]];
const ELK_TINES = [
  [[-1, -2], [8, -12], [12, -23]],
  [[-6, -12], [4, -22], [6, -33]],
  [[-16, -20], [-8, -32], [-6, -43]],
  [[-30, -25], [-24, -38], [-24, -50]],
  [[-44, -25], [-42, -36], [-45, -45]],
];
function elkAntler(ctx, ox, oy, k, sway, far) {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(k, k);
  ctx.rotate(sway);
  const base = far ? "#7d6c4a" : "#a99669";
  const hi = far ? "rgba(214,200,160,0.35)" : "rgba(246,236,204,0.7)";
  tapered(ctx, ELK_BEAM, 4.4, 1.8, base, hi);
  for (const tn of ELK_TINES) tapered(ctx, tn, 3.0, 0.9, base, hi);
  if (!far) {
    ctx.strokeStyle = "rgba(58,42,24,0.4)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-3, -8);
    ctx.lineTo(-9, -15);
    ctx.moveTo(-22, -22);
    ctx.lineTo(-28, -24);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// quadruped species specs
// ---------------------------------------------------------------------------
const SPEC = {
  elk: {
    L: 70, H: 32, legH: 40, neckLen: 31, neckW: [10.5, 6.5], neckStart: 0.34,
    body: "#936a41", bodyHi: "#bd9462", bodyLo: "#5e4126", belly: "rgba(214,190,146,0.55)", neckC: "#58402a", legC: "#4a3727", legTop: "#876140",
    fUp: 27, fLo: 27, hUp: 28, hLo: 28, fRad: [7.6, 5.0, 3.3, 2.7], hRad: [10.4, 6.4, 3.6, 2.8], hock: [-6, -15], hoof: "#1e140d",
  },
  cougar: {
    L: 64, H: 22, legH: 20, neckLen: 15, neckW: [8.4, 6.6], neckStart: 0.36,
    body: "#c49358", bodyHi: "#e2bb82", bodyLo: "#85592f", belly: "rgba(244,228,190,0.7)", neckC: "#bd8d52", legC: "#b88850", legTop: "#c49358",
    fUp: 18, fLo: 16, hUp: 19, hLo: 17, fRad: [7.6, 5.6, 4.2, 3.6], hRad: [10, 6.6, 4.2, 3.6], hock: [-5, -8], hoof: "#6a4a2a",
  },
  bear: {
    L: 64, H: 32, legH: 20, neckLen: 13, neckW: [12.5, 10], neckStart: 0.34,
    body: "#2c2420", bodyHi: "#54463d", bodyLo: "#120d0b", belly: "rgba(80,66,56,0.4)", neckC: "#2a221e", legC: "#241d19", legTop: "#2c2420",
    fUp: 22, fLo: 20, hUp: 22, hLo: 20, fRad: [10, 7.6, 6.2, 5.4], hRad: [12, 8.4, 6.2, 5.4], hock: [-5, -8], hoof: "#d8cdb6",
  },
};
const HEAD_PTS = {
  elk: [[-3, -6], [4, -9], [12, -7], [20, -4], [27, -1], [29.5, 2], [27, 5.2], [20, 6.4], [12, 8.4], [4, 10], [-2, 8], [-5, 2]],
  cougar: [[-4, -8], [2, -10], [8, -9], [13, -5], [17, -1], [17.8, 2], [15, 5], [11, 6.5], [6, 9], [-1, 10], [-6, 5], [-6, -1]],
  bear: [[-4, -9], [3, -12], [10, -10], [17, -5], [23, -1], [25.5, 3], [22, 6.4], [16, 7.8], [10, 10], [2, 12], [-5, 9], [-7, 2]],
};

function grazeAmount(t, seed, alert) {
  const ph = (t * 0.11 + seed * 0.37) % 1;
  const g = smoothstep(0.2, 0.3, ph) * (1 - smoothstep(0.62, 0.72, ph));
  return g * (1 - alert);
}

function drawQuadHead(ctx, kind, sp, o) {
  const { t, seed, alert, blink } = o;
  const pts = HEAD_PTS[kind];
  const path = new Path2D();
  smoothClosed(path, pts);
  const twitch = Math.sin(t * 0.8 + seed * 3) > 0.96 ? 1 : 0;
  const earPoint = alert * 0.35;

  // far ear first
  if (kind === "elk") {
    leaf(ctx, -1, -7, -10 - twitch * 3 + earPoint * 5, -17 + earPoint * 3, 3.6, "#3e2c1d", "#5a4230", null);
    elkAntler(ctx, 0, -8, 0.88, o.sway * 0.8, true);
  } else if (kind === "cougar") {
    ctx.fillStyle = "#2a1c13";
    ctx.beginPath();
    ctx.arc(-3, -11, 3.6, 0, TAU);
    ctx.fill();
  } else {
    ctx.fillStyle = "#1d1613";
    ctx.beginPath();
    ctx.arc(-3, -12, 4.2, 0, TAU);
    ctx.fill();
  }

  const g = ctx.createLinearGradient(0, -10, 0, 12);
  if (kind === "elk") {
    g.addColorStop(0, "#5f4430");
    g.addColorStop(0.55, "#6f5035");
    g.addColorStop(1, "#98764f");
  } else if (kind === "cougar") {
    g.addColorStop(0, "#c8975c");
    g.addColorStop(0.6, "#bb8a50");
    g.addColorStop(1, "#8e6335");
  } else {
    g.addColorStop(0, "#463a32");
    g.addColorStop(0.6, "#2c2420");
    g.addColorStop(1, "#1a1411");
  }
  ctx.fillStyle = g;
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  if (!o.lite) furStrokes(ctx, -6, -10, 28, 12, 30, seed + 3, "rgba(20,12,6,0.28)", "rgba(240,220,170,0.14)", 2.6);
  if (kind === "cougar") {
    const mg = ctx.createRadialGradient(13.5, 3.2, 1, 13.5, 3.2, 7);
    mg.addColorStop(0, "rgba(246,238,216,0.95)");
    mg.addColorStop(1, "rgba(246,238,216,0)");
    ctx.fillStyle = mg;
    ctx.fillRect(5, -2, 16, 14);
    ctx.strokeStyle = "rgba(38,24,14,0.7)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(10, -1.5);
    ctx.quadraticCurveTo(11, 3, 14, 4.6);
    ctx.stroke();
  } else if (kind === "bear") {
    const mg = ctx.createRadialGradient(18, 3.2, 1, 18, 3.2, 10);
    mg.addColorStop(0, "rgba(150,116,80,0.95)");
    mg.addColorStop(0.7, "rgba(138,104,70,0.7)");
    mg.addColorStop(1, "rgba(138,104,70,0)");
    ctx.fillStyle = mg;
    ctx.fillRect(7, -5, 22, 18);
  } else {
    const mg = ctx.createRadialGradient(24, 2.6, 1, 24, 2.6, 8);
    mg.addColorStop(0, "rgba(168,140,104,0.6)");
    mg.addColorStop(1, "rgba(168,140,104,0)");
    ctx.fillStyle = mg;
    ctx.fillRect(14, -5, 18, 16);
  }
  const sg = ctx.createLinearGradient(0, 4, 0, 12);
  sg.addColorStop(0, "rgba(0,0,0,0)");
  sg.addColorStop(1, "rgba(0,0,0,0.3)");
  ctx.fillStyle = sg;
  ctx.fillRect(-8, 4, 40, 9);
  ctx.restore();

  // nose, nostril, mouth
  const noseX = kind === "elk" ? 28 : kind === "cougar" ? 17 : 24.4;
  const noseY = kind === "elk" ? 0.6 : kind === "cougar" ? 0.6 : 1.2;
  ctx.fillStyle = kind === "cougar" ? "#5a3a2a" : "#15100c";
  ctx.beginPath();
  ctx.ellipse(noseX, noseY, kind === "elk" ? 2.6 : 2.2, kind === "elk" ? 2.4 : 1.8, 0.3, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.arc(noseX - 0.6, noseY - 0.7, 0.55, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(18,10,6,0.6)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  if (kind === "elk") {
    ctx.moveTo(28, 4.4);
    ctx.quadraticCurveTo(24, 6, 18.5, 5.4);
  } else if (kind === "cougar") {
    ctx.moveTo(15.4, 4.6);
    ctx.quadraticCurveTo(12, 6.4, 8.6, 5.6);
  } else {
    ctx.moveTo(22.6, 5.6);
    ctx.quadraticCurveTo(18, 7.4, 13, 6.6);
  }
  ctx.stroke();
  if (kind === "cougar") {
    ctx.strokeStyle = "rgba(246,238,216,0.7)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let i = -1; i <= 1; i++) {
      ctx.moveTo(13.5, 3.4 + i * 0.8);
      ctx.lineTo(21 + Math.abs(i), 2 + i * 3);
    }
    ctx.stroke();
  }

  // eye
  const ex = kind === "elk" ? 10 : kind === "cougar" ? 7.4 : 9.6;
  const ey = kind === "elk" ? -3.4 : kind === "cougar" ? -3.6 : -4.4;
  const er = kind === "bear" ? 1.5 : kind === "cougar" ? 2.4 : 2.0;
  ctx.fillStyle = "rgba(10,5,2,0.45)";
  ctx.beginPath();
  ctx.ellipse(ex, ey + 0.2, er * 1.7, er * 1.35, -0.15, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.translate(ex, ey);
  ctx.scale(1, Math.max(0.1, 1 - blink));
  if (kind === "cougar") {
    const ig = ctx.createRadialGradient(0, 0, 0.2, 0, 0, er);
    ig.addColorStop(0, "#fff3a0");
    ig.addColorStop(0.6, "#e5b52e");
    ig.addColorStop(1, "#8a5a10");
    ctx.fillStyle = ig;
    ctx.beginPath();
    ctx.ellipse(0, 0, er, er * 0.92, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#120a04";
    ctx.beginPath();
    ctx.ellipse(0.2, 0, 0.55, er * 0.85, 0, 0, TAU);
    ctx.fill();
  } else {
    ctx.fillStyle = kind === "elk" ? "#1f130a" : "#1b100a";
    ctx.beginPath();
    ctx.ellipse(0, 0, er, er * 0.85, 0, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(-0.5, -0.6, 0.55, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(14,8,4,0.7)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(ex - er * 1.2, ey - er * 0.9);
  ctx.quadraticCurveTo(ex, ey - er * 1.9, ex + er * 1.5, ey - er * 0.7);
  ctx.stroke();

  // near ear (+ antler for elk)
  if (kind === "elk") {
    leaf(ctx, -2, -7, -13 - twitch * 3 + earPoint * 6, -15.5 + twitch * 2 + earPoint * 3, 4.2, "#5a4230", "#8c6c4a", "rgba(26,16,8,0.5)");
    leaf(ctx, -3, -7.4, -10 - twitch * 2 + earPoint * 4, -12.5 + earPoint * 2, 2, "#c9a98a", "#e6cdb2", null);
    elkAntler(ctx, -1, -8, 0.96, o.sway, false);
  } else if (kind === "cougar") {
    ctx.fillStyle = "#32231a";
    ctx.beginPath();
    ctx.arc(0, -10.8, 4.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#d9a89a";
    ctx.beginPath();
    ctx.arc(0.6, -10.6, 2.2, 0, TAU);
    ctx.fill();
  } else {
    ctx.fillStyle = "#241a16";
    ctx.beginPath();
    ctx.arc(0, -12, 4.8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#6a5040";
    ctx.beginPath();
    ctx.arc(0.6, -11.8, 2.6, 0, TAU);
    ctx.fill();
  }
}

function drawQuadruped(ctx, kind, o) {
  const sp = SPEC[kind];
  const { L, H, legH } = sp;
  const { t, seed, alert } = o;
  const br = 1 + 0.012 * Math.sin(t * 1.7 + seed);
  const blinkP = (t + seed * 1.3) % 4.2;
  const blink = blinkP < 0.13 ? Math.sin((blinkP / 0.13) * Math.PI) : 0;

  let graze;
  if (kind === "elk") graze = grazeAmount(t, seed, alert);
  else if (kind === "bear") graze = clamp(0.4 + 0.14 * Math.sin(t * 0.9 + seed), 0, 1) * (1 - alert * 0.5);
  else graze = 0.35 * (1 - alert);

  const neckBase = [sp.neckStart * L, -legH - H * 0.84];
  let neckAng;
  let headAng;
  if (kind === "elk") {
    neckAng = lerp(1.0, -0.8, graze);
    headAng = lerp(0.55, 1.1, graze);
  } else if (kind === "cougar") {
    neckAng = lerp(0.42, -0.35, graze);
    headAng = lerp(0.12, 0.5, graze);
  } else {
    neckAng = lerp(0.55, -0.55, graze);
    headAng = lerp(0.3, 0.95, graze);
  }
  neckAng += alert * 0.1;
  const headBase = [neckBase[0] + Math.cos(neckAng) * sp.neckLen, neckBase[1] - Math.sin(neckAng) * sp.neckLen];
  const sway = Math.sin(t * 0.9 + seed) * 0.03;

  drawContactShadow(ctx, 0, 0, L * 0.72, 0.5);

  // --- legs ---
  const yb = -legH;
  const frontTop = [0.3 * L, yb - H * 0.32];
  const hindTop = [-0.34 * L, yb - H * 0.4];
  const frontToes = { near: [0.3 * L + 4, 0], far: [0.3 * L - 6, 0] };
  const hindToes = { near: [-0.34 * L + 3, 0], far: [-0.34 * L - 8, 0] };
  const mk = (far) => (far ? 0.82 : 1);
  const shade = (hex, far) => {
    if (!far) return hex;
    const c = hexToRgb(hex);
    return toHex([c[0] * 0.72, c[1] * 0.72, c[2] * 0.72]);
  };
  const foot = (toe, far) => {
    ctx.fillStyle = shade(sp.hoof, far);
    ctx.beginPath();
    if (kind === "elk") {
      ctx.moveTo(toe[0] - 2.4, toe[1] - 4);
      ctx.lineTo(toe[0] + 3.2, toe[1]);
      ctx.lineTo(toe[0] - 2.8, toe[1]);
      ctx.closePath();
    } else {
      ctx.ellipse(toe[0] + 1.5, toe[1] - 1.6, kind === "bear" ? 6.4 : 5.2, kind === "bear" ? 3.4 : 2.8, 0, 0, TAU);
    }
    ctx.fill();
    if (kind === "bear") {
      ctx.strokeStyle = "#cbbfa4";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        ctx.moveTo(toe[0] + 5 + i * 0.4, toe[1] - 2.4 + i * 1.1);
        ctx.lineTo(toe[0] + 7.4 + i * 0.4, toe[1] - 1.6 + i * 1.1);
      }
      ctx.stroke();
    }
  };
  const legPal = (far, top) => pal(shade(top ? sp.legTop : sp.legC, far), 0.22, 0.04, 0.55);
  const frontLeg = (toe, far, sd) => {
    const ankle = [toe[0] - 1.5, toe[1] - (kind === "elk" ? 11 : 6)];
    const d = Math.hypot(ankle[0] - frontTop[0], ankle[1] - frontTop[1]);
    const kne = ik2(frontTop[0], frontTop[1], ankle[0], ankle[1], d * 0.53, d * 0.53, -1);
    const r = sp.fRad.map((v) => v * mk(far));
    organicLimb(ctx, [kne, ankle, toe], [r[1], r[2], r[3]], [0.08, 0], legPal(far, false), sd + 3);
    organicLimb(ctx, [frontTop, kne], [r[0], r[1]], [0.14], legPal(far, true), sd);
    foot(toe, far);
  };
  const hindLeg = (toe, far, sd) => {
    const ankle = [toe[0] + sp.hock[0], toe[1] + sp.hock[1]];
    const d = Math.hypot(ankle[0] - hindTop[0], ankle[1] - hindTop[1]);
    const kne = ik2(hindTop[0], hindTop[1], ankle[0], ankle[1], d * 0.62, d * 0.62, 1);
    const r = sp.hRad.map((v) => v * mk(far));
    organicLimb(ctx, [ankle, toe], [r[2], r[3]], [0], legPal(far, false), sd + 3);
    organicLimb(ctx, [kne, ankle], [r[1], r[2]], [0.16], legPal(far, false), sd + 5);
    organicLimb(ctx, [hindTop, kne], [r[0], r[1]], [0.12], legPal(far, true), sd);
    foot(toe, far);
  };
  frontLeg(frontToes.far, true, 11);
  hindLeg(hindToes.far, true, 17);

  // --- neck (drawn before the body so the shoulder overlaps its base) ---
  {
    const mid = [lerp(neckBase[0], headBase[0], 0.5), lerp(neckBase[1], headBase[1], 0.5)];
    organicLimb(ctx, [neckBase, mid, headBase], [sp.neckW[0], (sp.neckW[0] + sp.neckW[1]) / 2, sp.neckW[1]], [0.04, 0.02], pal(sp.neckC, 0.28, 0.05, 0.6), seed + 5);
    if (kind === "elk") {
      // dark mane hanging from the throat
      ctx.fillStyle = "rgba(34,22,12,0.55)";
      ctx.beginPath();
      ctx.moveTo(neckBase[0] - 4, neckBase[1] + 4);
      ctx.quadraticCurveTo(mid[0] + 3, mid[1] + 9, headBase[0] - 3, headBase[1] + 6);
      ctx.lineTo(headBase[0] - 2, headBase[1] + 2);
      ctx.quadraticCurveTo(mid[0] - 2, mid[1] + 3, neckBase[0] - 6, neckBase[1] - 1);
      ctx.closePath();
      ctx.fill();
    }
  }

  // --- body ---
  const P = (fx, fy) => [fx * L, yb - fy * H * br];
  const hump = kind === "bear" ? 0.14 : 0;
  const pts = [
    P(0.3, 1.0 + hump), P(0.05, 0.95 + hump * 0.4), P(-0.28, kind === "bear" ? 0.9 : 0.97), P(-0.47, 0.82), P(-0.52, 0.5), P(-0.44, 0.1), P(-0.2, 0.0), P(0.12, -0.03), P(0.38, 0.06), P(0.5, 0.45), P(0.47, 0.85),
  ];
  const body = new Path2D();
  smoothClosed(body, pts);
  const top = yb - H * (1.1 + hump);
  const bg = ctx.createLinearGradient(0, top, 0, yb + 4);
  bg.addColorStop(0, sp.bodyHi);
  bg.addColorStop(0.42, sp.body);
  bg.addColorStop(1, sp.bodyLo);
  ctx.fillStyle = bg;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  if (!o.lite) furStrokes(ctx, -0.55 * L, top, 0.55 * L, yb + 2, Math.round(L * 0.9), seed + 9, "rgba(18,10,4,0.3)", "rgba(244,222,170,0.16)", 3.8);
  // pale belly
  const bgg = ctx.createLinearGradient(0, yb - H * 0.5, 0, yb + 3);
  bgg.addColorStop(0, "rgba(0,0,0,0)");
  bgg.addColorStop(1, sp.belly);
  ctx.fillStyle = bgg;
  ctx.fillRect(-0.6 * L, yb - H * 0.5, 1.2 * L, H * 0.6);
  if (kind === "elk") {
    const rg = ctx.createRadialGradient(-0.45 * L, yb - H * 0.55, 1, -0.45 * L, yb - H * 0.55, 15);
    rg.addColorStop(0, "rgba(232,220,190,0.95)");
    rg.addColorStop(1, "rgba(232,220,190,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(-0.6 * L, yb - H, 30, H);
  }
  if (kind === "cougar") {
    ctx.strokeStyle = "rgba(112,76,40,0.35)";
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(-0.45 * L, yb - H * 0.95);
    ctx.quadraticCurveTo(0, yb - H * 1.05, 0.3 * L, yb - H * 1.0);
    ctx.stroke();
  }
  // shoulder & haunch muscle shading
  for (const [cx, cy, rx, ry] of [[0.28 * L, yb - H * 0.5, 13, 15 * br], [-0.34 * L, yb - H * 0.5, 15, 16 * br]]) {
    const mg = ctx.createRadialGradient(cx + 3, cy - 5, 1, cx, cy, rx);
    mg.addColorStop(0, "rgba(255,230,180,0.14)");
    mg.addColorStop(0.7, "rgba(0,0,0,0)");
    mg.addColorStop(1, "rgba(0,0,0,0.16)");
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(255,238,200,0.22)";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(P(0.3, 1.0 + hump)[0], P(0.3, 1.0 + hump)[1] + 0.5);
  ctx.quadraticCurveTo(P(0.05, 0.96 + hump)[0], P(0.05, 0.96 + hump)[1] + 0.5, P(-0.28, 0.97)[0], P(-0.28, 0.97)[1] + 0.5);
  ctx.stroke();

  // --- tail ---
  if (kind === "cougar") {
    const base = [-0.5 * L, yb - H * 0.7];
    const w = Math.sin(t * 1.3 + seed) * 5 + alert * Math.sin(t * 5) * 3;
    const p1 = [base[0] - 10, base[1] + 5 + w * 0.3];
    const p2 = [base[0] - 21, base[1] + 11 + w * 0.6];
    const p3 = [base[0] - 31, base[1] + 5 + w * 0.9];
    const p4 = [base[0] - 37, base[1] - 7 + w];
    organicLimb(ctx, [base, p1, p2, p3], [6.2, 5.6, 5.2, 4.8], [0, 0, 0], pal("#bc8c52", 0.3, 0.04, 0.6), seed + 2);
    organicLimb(ctx, [p3, p4], [4.8, 4.2], [0], pal("#2a1c13", 0.2, 0.1), seed + 3);
  } else if (kind === "elk") {
    ctx.fillStyle = "#d9c9a2";
    ctx.beginPath();
    ctx.ellipse(-0.51 * L, yb - H * 0.74, 3, 5, 0.3, 0, TAU);
    ctx.fill();
  } else {
    ctx.fillStyle = "#241c18";
    ctx.beginPath();
    ctx.ellipse(-0.51 * L, yb - H * 0.66, 3, 2.6, 0, 0, TAU);
    ctx.fill();
  }

  // --- near legs ---
  frontLeg(frontToes.near, false, 21);
  hindLeg(hindToes.near, false, 27);

  // --- head ---
  ctx.save();
  ctx.translate(headBase[0], headBase[1]);
  ctx.rotate(headAng);
  drawQuadHead(ctx, kind, sp, { t, seed, alert, blink, sway, lite: o.lite });
  ctx.restore();
}

// ---------------------------------------------------------------------------
// bald eagle on a snag
// ---------------------------------------------------------------------------
function drawSnag(ctx, seed) {
  const H = 132;
  // trunk silhouette (weathered, tapering, with a broken top)
  const trunk = new Path2D();
  trunk.moveTo(-10, 0);
  trunk.bezierCurveTo(-9, -40, -7.5, -80, -5.5, -H + 4);
  trunk.lineTo(-2, -H - 4);
  trunk.lineTo(1.5, -H + 2);
  trunk.lineTo(5.5, -H - 2);
  trunk.bezierCurveTo(7.5, -80, 9, -40, 11, 0);
  trunk.closePath();
  const g = ctx.createLinearGradient(-11, 0, 12, 0);
  g.addColorStop(0, "#2f2820");
  g.addColorStop(0.45, "#6b5d4b");
  g.addColorStop(1, "#a29176");
  ctx.fillStyle = g;
  ctx.fill(trunk);
  ctx.save();
  ctx.clip(trunk);
  ctx.strokeStyle = "rgba(20,14,8,0.5)";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let i = 0; i < 9; i++) {
    const x = -8 + i * 2.1;
    ctx.moveTo(x + seededRand(seed + i) * 2, 0);
    ctx.bezierCurveTo(x - 1.5, -40, x + 1.5, -80, x + seededRand(seed + i * 3) * 2, -H);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(240,226,196,0.16)";
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const x = -3 + i * 3.2;
    ctx.moveTo(x, -10 - i * 6);
    ctx.lineTo(x + 0.6, -50 - i * 10);
  }
  ctx.stroke();
  ctx.restore();
  // gnarled perch branch on the right + a stub on the left
  tapered(ctx, [[5, -88], [18, -94], [34, -99], [50, -98]], 5.6, 2.4, "#54463a", "rgba(210,190,150,0.35)");
  tapered(ctx, [[-5, -64], [-14, -70], [-22, -69]], 3.6, 1.6, "#4a3d32", null);
  tapered(ctx, [[30, -99], [36, -108], [38, -116]], 2.2, 1.0, "#54463a", null);
  // mossy foot
  ctx.fillStyle = "rgba(96,132,56,0.7)";
  ctx.beginPath();
  ctx.ellipse(0, -1, 14, 3.4, 0, 0, TAU);
  ctx.fill();
}

function drawEagle(ctx, o) {
  const { t, seed, alert } = o;
  const blinkP = (t + seed) % 5;
  const blink = blinkP < 0.12 ? Math.sin((blinkP / 0.12) * Math.PI) : 0;
  const look = Math.sin(t * 0.5 + seed) * 0.12 - alert * 0.08;
  const shuffle = Math.sin(t * 0.37 + seed * 2) > 0.98 ? Math.sin(t * 22) * 0.04 : 0;
  ctx.save();
  // perch point (0,0) sits on the branch top
  // tail
  const tail = new Path2D();
  smoothClosed(tail, [[-5, -11], [-11, -3], [-14, 7], [-10, 13], [-3, 12], [0, 3], [1, -8]]);
  ctx.fillStyle = "#efeadb";
  ctx.fill(tail);
  ctx.strokeStyle = "rgba(120,110,90,0.35)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(-6, -4);
  ctx.lineTo(-8, 12);
  ctx.moveTo(-3, -3);
  ctx.lineTo(-4.5, 13);
  ctx.stroke();
  // legs & talons
  ctx.strokeStyle = "#e0b035";
  ctx.lineCap = "round";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(1, -9);
  ctx.lineTo(2, -1);
  ctx.moveTo(5, -9);
  ctx.lineTo(5.5, -1);
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (const bx of [2, 5.5]) {
    ctx.moveTo(bx, -1);
    ctx.lineTo(bx + 3.4, 1.4);
    ctx.moveTo(bx, -1);
    ctx.lineTo(bx - 3, 1.4);
  }
  ctx.stroke();
  // body
  ctx.save();
  ctx.rotate(shuffle);
  const body = new Path2D();
  smoothClosed(body, [[6, -37], [-4, -32], [-10, -19], [-10, -6], [-3, -1], [6, -5], [12, -16], [11, -29]]);
  const bg = ctx.createLinearGradient(-9, -30, 9, -4);
  bg.addColorStop(0, "#5a4131");
  bg.addColorStop(0.6, "#3d2b1f");
  bg.addColorStop(1, "#271a12");
  ctx.fillStyle = bg;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  furStrokes(ctx, -9, -34, 10, -3, 34, seed + 31, "rgba(12,6,2,0.4)", "rgba(220,190,150,0.2)", 3.2);
  // folded wing with layered feather scallops
  const wing = new Path2D();
  smoothClosed(wing, [[3, -32], [-6, -27], [-10, -14], [-11, -2], [-5, 3], [0, -4], [4, -14], [7, -25]]);
  ctx.fillStyle = "#2c1f16";
  ctx.fill(wing);
  ctx.strokeStyle = "rgba(210,180,140,0.32)";
  ctx.lineWidth = 0.8;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      const fx = -6 + c * 3.4 + (r % 2) * 1.6;
      const fy = -24 + r * 5.8;
      ctx.beginPath();
      ctx.arc(fx, fy, 2.2, 0.15, Math.PI - 0.15);
      ctx.stroke();
    }
  }
  const sh = ctx.createLinearGradient(0, -34, 0, -2);
  sh.addColorStop(0, "rgba(255,230,190,0.18)");
  sh.addColorStop(1, "rgba(0,0,0,0.2)");
  ctx.fillStyle = sh;
  ctx.fillRect(-12, -36, 24, 36);
  ctx.restore();
  // thigh "pantaloons"
  ctx.fillStyle = "#35261b";
  ctx.beginPath();
  ctx.ellipse(3, -9, 5.4, 4.6, 0.2, 0, TAU);
  ctx.fill();
  ctx.restore();

  // white head and neck
  ctx.save();
  ctx.translate(6.5, -35);
  ctx.rotate(look);
  const neck = new Path2D();
  smoothClosed(neck, [[-5, 4], [-4, -3], [3, -4], [6, 2], [5, 9], [-3, 9]]);
  ctx.fillStyle = "#efeadb";
  ctx.fill(neck);
  const head = new Path2D();
  head.ellipse(1, -4, 7.6, 7, 0, 0, TAU);
  const hg = ctx.createRadialGradient(-1, -7, 1, 1, -4, 9);
  hg.addColorStop(0, "#fffdf4");
  hg.addColorStop(1, "#d8d2c0");
  ctx.fillStyle = hg;
  ctx.fill(head);
  ctx.strokeStyle = "rgba(150,140,118,0.4)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    ctx.moveTo(-4 + i * 1.8, -9 + (i % 3));
    ctx.lineTo(-3 + i * 1.8, -5 + (i % 3));
  }
  ctx.stroke();
  // hooked beak + cere
  ctx.fillStyle = "#f0bf2e";
  ctx.beginPath();
  ctx.moveTo(6.4, -6);
  ctx.bezierCurveTo(12.5, -7.4, 16, -3.6, 15.6, 2);
  ctx.bezierCurveTo(15.2, 0.2, 12, -1.2, 9.4, -1);
  ctx.bezierCurveTo(8, -1, 7, -1.8, 6.4, -2.6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(120,80,10,0.55)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(8.4, -2.4);
  ctx.quadraticCurveTo(12, -2.8, 14.4, -1);
  ctx.stroke();
  ctx.fillStyle = "rgba(80,50,6,0.7)";
  ctx.beginPath();
  ctx.arc(9.2, -4.8, 0.7, 0, TAU);
  ctx.fill();
  // stern eye under a heavy brow
  ctx.fillStyle = "rgba(60,44,20,0.55)";
  ctx.beginPath();
  ctx.ellipse(3.4, -5.4, 3.2, 2.5, -0.1, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.translate(3.6, -5);
  ctx.scale(1, Math.max(0.1, 1 - blink));
  ctx.fillStyle = "#f4c64a";
  ctx.beginPath();
  ctx.arc(0, 0, 1.9, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#0e0804";
  ctx.beginPath();
  ctx.arc(0.2, 0, 0.95, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(-0.4, -0.5, 0.4, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(190,176,140,0.9)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(0.4, -7.4);
  ctx.quadraticCurveTo(4.2, -8.9, 8, -6.2);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// banana slug + nurse log
// ---------------------------------------------------------------------------
function drawNurseLog(ctx, o) {
  const { t, seed } = o;
  const Lw = 120;
  const R = 12.5;
  const body = new Path2D();
  body.moveTo(-Lw / 2, 0);
  body.bezierCurveTo(-Lw / 2 - 1, -R * 1.6, -Lw / 2 + 6, -R * 2, -Lw / 2 + 14, -R * 2.02);
  body.lineTo(Lw / 2 - 6, -R * 2 - 1);
  body.bezierCurveTo(Lw / 2 + 2, -R * 1.9, Lw / 2 + 3, -R * 0.6, Lw / 2 + 1, 0);
  body.closePath();
  const g = ctx.createLinearGradient(0, -R * 2, 0, 0);
  g.addColorStop(0, "#7c5f40");
  g.addColorStop(0.5, "#5a4128");
  g.addColorStop(1, "#2e2014");
  ctx.fillStyle = g;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  ctx.strokeStyle = "rgba(20,12,4,0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 18; i++) {
    const x = -Lw / 2 + 12 + i * 6.2 + seededRand(seed + i) * 3;
    ctx.moveTo(x, -R * 2);
    ctx.quadraticCurveTo(x + 2, -R, x - 1, 0);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(236,208,160,0.15)";
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const x = -Lw / 2 + 16 + i * 9;
    ctx.moveTo(x, -R * 2 + 1);
    ctx.lineTo(x + 3, -R * 1.2);
  }
  ctx.stroke();
  // thick moss blanket along the top, thinner down the flanks
  const mg = ctx.createLinearGradient(0, -R * 2.1, 0, -R * 1.0);
  mg.addColorStop(0, "rgba(98,148,52,0.95)");
  mg.addColorStop(1, "rgba(98,148,52,0)");
  ctx.fillStyle = mg;
  ctx.fillRect(-Lw / 2, -R * 2.1, Lw + 4, R * 1.2);
  ctx.restore();
  // moss fringe
  ctx.fillStyle = "#6fa23c";
  ctx.beginPath();
  ctx.moveTo(-Lw / 2 + 12, -R * 2);
  for (let x = -Lw / 2 + 12; x <= Lw / 2 - 4; x += 4) {
    ctx.lineTo(x, -R * 2 - 1.5 - seededRand(seed + x * 0.3) * 2.6);
    ctx.lineTo(x + 2, -R * 2 + 1.2);
  }
  ctx.lineTo(Lw / 2 - 4, -R * 2 + 2);
  ctx.closePath();
  ctx.fill();
  // cut end with growth rings
  const ex = -Lw / 2 + 1;
  const ey = -R;
  ctx.save();
  ctx.translate(ex, ey);
  ctx.scale(0.55, 1);
  const eg = ctx.createRadialGradient(0, 0, 1, 0, 0, R);
  eg.addColorStop(0, "#d8b98a");
  eg.addColorStop(1, "#a07f55");
  ctx.fillStyle = eg;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(90,60,30,0.5)";
  ctx.lineWidth = 0.8;
  for (let r = 3; r < R; r += 2.6) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
  // bracket (shelf) fungi
  for (const [fx, fy, fr, col] of [[-26, -R * 1.3, 7, "#e6c27a"], [-12, -R * 0.9, 5.4, "#d99a52"], [34, -R * 1.2, 6.6, "#ecd9a8"]]) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(fx, fy, fr, fr * 0.42, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(120,80,30,0.35)";
    ctx.beginPath();
    ctx.ellipse(fx, fy, fr, fr * 0.2, 0, 0, Math.PI);
    ctx.fill();
    ctx.strokeStyle = "rgba(120,80,30,0.45)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.ellipse(fx, fy - 0.5, fr * 0.65, fr * 0.26, 0, Math.PI, 0);
    ctx.stroke();
  }
  // seedlings growing from the log: hemlock + fern
  for (const [sx2, k] of [[10, 1], [52, 0.8], [-40, 0.7]]) {
    const sy2 = -R * 2 - 1;
    ctx.strokeStyle = "#4e7a2c";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(sx2, sy2);
    ctx.lineTo(sx2, sy2 - 11 * k);
    ctx.stroke();
    for (let b = 0; b < 4; b++) {
      const by = sy2 - 3 - b * 2.8 * k;
      const w = (4 - b * 0.7) * k;
      const sway = Math.sin(t * 1.4 + sx2 + b) * 0.5;
      leaf(ctx, sx2, by, sx2 - w * 1.4 + sway, by - 1.6, 0.9, "#3f7f35", "#8bc65a", null);
      leaf(ctx, sx2, by, sx2 + w * 1.4 + sway, by - 1.6, 0.9, "#3f7f35", "#8bc65a", null);
    }
  }
  // little mushrooms (decomposers fruiting)
  for (const [mx, c] of [[-4, "#e8dcc2"], [22, "#d9583c"], [60, "#e8dcc2"]]) {
    ctx.fillStyle = "#efe7d2";
    ctx.fillRect(mx - 0.8, -R * 2 - 5, 1.6, 5);
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(mx, -R * 2 - 5, 3.6, 2.6, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.arc(mx - 1, -R * 2 - 6.4, 0.55, 0, TAU);
    ctx.fill();
  }
  // faint glowing mycelium threads at the base
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = `rgba(214,240,190,${0.16 + 0.08 * Math.sin(t * 1.7)})`;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const x = -Lw / 2 + 8 + i * 25;
    ctx.moveTo(x, -1);
    ctx.bezierCurveTo(x + 6, 3, x + 14, -1, x + 22, 2);
  }
  ctx.stroke();
  ctx.restore();
}

function drawSlug(ctx, o) {
  const { t } = o;
  const crawl = Math.sin(t * 0.9) * 0.5 + 0.5;
  const len = 30;
  const squish = Math.sin(t * 3.1) * 0.8;
  const wave = (u) => Math.sin(u * 5 - t * 3.1) * 0.9 * (1 - u * 0.4);
  ctx.save();
  // slime trail
  ctx.strokeStyle = "rgba(236,246,214,0.18)";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-len - 22, 0.6);
  ctx.lineTo(-len + 4, 0.6);
  ctx.stroke();
  // body outline
  const top = [];
  const bot = [];
  const N = 9;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const x = -len + u * len * 1.1;
    const h = (u < 0.08 ? 3 + u * 40 : u > 0.9 ? 6 - (u - 0.9) * 40 : 7.5) + wave(u) + (u > 0.15 && u < 0.7 ? squish * 0.3 : 0);
    const taper = u < 0.12 ? 0.55 + u * 3.5 : 1;
    top.push([x, -h * taper - 0.6]);
    bot.push([x, 0.2]);
  }
  const path = new Path2D();
  smoothThrough(path, top, true);
  path.quadraticCurveTo(len * 0.1 + 6, -2, len * 0.1 + 5, 0.2);
  smoothThrough(path, bot.slice().reverse(), false);
  path.closePath();
  const g = ctx.createLinearGradient(0, -9, 0, 1);
  g.addColorStop(0, "#fbe85c");
  g.addColorStop(0.5, "#f1cb2c");
  g.addColorStop(1, "#c8921a");
  ctx.fillStyle = g;
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  // dark spots
  ctx.fillStyle = "rgba(70,40,10,0.65)";
  for (let i = 0; i < 12; i++) {
    const x = -len + 6 + seededRand(i * 3.3) * len * 0.95;
    const y = -1.5 - seededRand(i * 7.1) * 6;
    ctx.beginPath();
    ctx.ellipse(x, y, 0.8 + seededRand(i) * 1.2, 0.7 + seededRand(i + 5) * 0.8, 0, 0, TAU);
    ctx.fill();
  }
  // mantle/saddle shading + wet highlight
  const mh = ctx.createLinearGradient(0, -10, 0, -2);
  mh.addColorStop(0, "rgba(255,255,230,0.75)");
  mh.addColorStop(1, "rgba(255,255,230,0)");
  ctx.fillStyle = mh;
  ctx.fillRect(-len + 4, -10, len * 0.95, 4.4);
  ctx.restore();
  // pale foot fringe
  ctx.strokeStyle = "rgba(255,242,190,0.85)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-len, 0.4);
  ctx.lineTo(len * 0.1 + 4, 0.4);
  ctx.stroke();
  // head, eye stalks (long upper tentacles w/ eyes) + short lower tentacles
  const hx = len * 0.1 + 4;
  const sway = Math.sin(t * 1.3) * 1.4 + crawl * 0.4;
  ctx.strokeStyle = "#e4ba28";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(hx - 2, -3.8);
  ctx.quadraticCurveTo(hx + 3, -9, hx + 4 + sway, -11.5);
  ctx.moveTo(hx - 0.5, -3);
  ctx.quadraticCurveTo(hx + 6, -7, hx + 8 - sway * 0.6, -9.6);
  ctx.stroke();
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(hx + 1, -1.2);
  ctx.lineTo(hx + 4.4, -0.4);
  ctx.moveTo(hx + 0.4, -0.2);
  ctx.lineTo(hx + 3.6, 1.2);
  ctx.stroke();
  ctx.fillStyle = "#1a1008";
  ctx.beginPath();
  ctx.arc(hx + 4.2 + sway, -11.7, 1.1, 0, TAU);
  ctx.arc(hx + 8.2 - sway * 0.6, -9.8, 1.0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(hx + 3.8 + sway, -12.1, 0.35, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// public: critters
// ---------------------------------------------------------------------------
// o: { sx, sy (screen ground point), t, appear (0..1), alert (0..1), facing,
//      seed }. Wildlife materialises in a shimmer of motes as green reaches it.
export function drawCritter(ctx, kind, o) {
  const appear = clamp(o.appear ?? 1, 0, 1);
  if (appear <= 0.01) return;
  const f = (o.facing ?? 1) < 0 ? -1 : 1;
  ctx.save();
  ctx.translate(o.sx, o.sy);
  ctx.globalAlpha = easeOutCubic(appear);
  if (kind === "nurseLog") {
    drawNurseLog(ctx, { t: o.t, seed: o.seed });
  } else if (kind === "slug") {
    ctx.scale(f, 1);
    ctx.scale(1.35, 1.35);
    drawSlug(ctx, { t: o.t });
  } else if (kind === "eagle") {
    ctx.scale(f, 1);
    drawSnag(ctx, o.seed);
    ctx.translate(28, -98);
    ctx.scale(1.3, 1.3);
    drawEagle(ctx, { t: o.t, seed: o.seed, alert: o.alert || 0 });
  } else {
    ctx.scale(f, 1);
    drawQuadruped(ctx, kind, { t: o.t, seed: o.seed, alert: o.alert || 0, lite: o.lite });
  }
  ctx.restore();
  if (appear < 1) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const k = 1 - appear;
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4 + o.t * 2;
      const rr = 14 + i * 3.4;
      ctx.fillStyle = `rgba(214,255,150,${0.55 * k})`;
      ctx.beginPath();
      ctx.arc(o.sx + Math.cos(a) * rr * (0.6 + k), o.sy - 14 - (i * 5.5 + o.t * 30) % 52, 1.8, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

// Visual centre (in world px, relative to the critter's ground point) used for
// prompts and scan range.
export function critterTopY(kind) {
  switch (kind) {
    case "elk":
      return -118;
    case "cougar":
      return -56;
    case "bear":
      return -70;
    case "eagle":
      return -150;
    case "slug":
      return -22;
    case "nurseLog":
      return -48;
    default:
      return -50;
  }
}

// ---------------------------------------------------------------------------
// public: silt wisp (River Valley's minor enemy)
// ---------------------------------------------------------------------------
export function drawSiltWisp(ctx, o) {
  const { sx, sy, t, hurt = 0, dying = 0, seed = 0 } = o;
  const face = o.face >= 0 ? 1 : -1;
  ctx.save();
  ctx.translate(sx, sy);
  const bob = Math.sin(t * 2.4 + seed) * 2.4;
  ctx.translate(0, bob);
  ctx.globalAlpha = Math.max(0, 1 - dying);
  const sc = 1 + dying * 0.4;
  ctx.scale(sc, sc);
  // ground-hugging murk below it
  ctx.save();
  ctx.scale(1, 0.25);
  const sh = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
  sh.addColorStop(0, "rgba(40,28,14,0.45)");
  sh.addColorStop(1, "rgba(40,28,14,0)");
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.arc(0, 62 + 0, 22, 0, TAU);
  ctx.fill();
  ctx.restore();
  // drifting silt tail
  for (let i = 5; i >= 1; i--) {
    const k = i / 5;
    const x = -face * (6 + i * 5) + Math.sin(t * 3 + i * 0.8 + seed) * 3;
    const y = 8 + i * 4.5;
    const r = 11 * (1 - k * 0.65);
    ctx.fillStyle = `rgba(${96 - i * 8},${76 - i * 7},${52 - i * 5},${0.5 - k * 0.3})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  // body
  const g = ctx.createRadialGradient(-4, -6, 2, 0, 0, 20);
  g.addColorStop(0, "#d2bd94");
  g.addColorStop(0.45, "#8e7656");
  g.addColorStop(1, "#43321f");
  ctx.fillStyle = g;
  ctx.beginPath();
  const wob = (a) => 1 + 0.07 * Math.sin(a * 3 + t * 3 + seed) + 0.04 * Math.sin(a * 5 - t * 4);
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * TAU;
    const r = 17 * wob(a);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * 0.95;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  // swirling sediment bands inside the body
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = "rgba(52,38,22,0.4)";
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(Math.sin(t * 1.2 + i) * 3, i * 3 - 3, 8 + i * 5, t * (1.5 - i * 0.4) + i * 2, t * (1.5 - i * 0.4) + i * 2 + 1.8);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(240,226,190,0.22)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(-3, -4, 11, Math.PI * 1.05, Math.PI * 1.6);
  ctx.stroke();
  ctx.restore();
  // orbiting grit
  for (let i = 0; i < 9; i++) {
    const a = t * (1.4 + (i % 3) * 0.4) + i * 0.7 + seed;
    const r = 22 + (i % 4) * 3;
    ctx.fillStyle = i % 2 ? "rgba(120,96,64,0.9)" : "rgba(80,62,40,0.9)";
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * r, Math.sin(a) * r * 0.8, 1.2 + (i % 3) * 0.6, 1 + (i % 2) * 0.5, a, 0, TAU);
    ctx.fill();
  }
  // angry glowing eyes tracking the player
  for (const ex of [-5.2, 5.2]) {
    const ox = ex + face * 1.6;
    ctx.fillStyle = "rgba(22,12,4,0.8)";
    ctx.beginPath();
    ctx.ellipse(ox, -2, 3.4, 2.6, ex < 0 ? 0.35 : -0.35, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ffe58a";
    ctx.beginPath();
    ctx.ellipse(ox + face * 0.4, -2, 2.2, 1.5, ex < 0 ? 0.35 : -0.35, 0, TAU);
    ctx.fill();
  }
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const eg = ctx.createRadialGradient(0, -2, 1, 0, -2, 16);
  eg.addColorStop(0, "rgba(255,210,110,0.3)");
  eg.addColorStop(1, "rgba(255,190,90,0)");
  ctx.fillStyle = eg;
  ctx.beginPath();
  ctx.arc(0, -2, 16, 0, TAU);
  ctx.fill();
  if (hurt > 0) {
    ctx.fillStyle = `rgba(255,255,255,${hurt * 0.6})`;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// public: Deluge, the flood dragon
// ---------------------------------------------------------------------------
// o: { sx, sy (head, screen), facing (toward the player), phase (spine wave),
//      t, clean (0 muddy flood .. 1 clear water), open (0..1 mouth), hurt,
//      glow (telegraph colour or null) }. The body trails away from the facing.
export function drawDeluge(ctx, o) {
  const { sx, sy, t, phase } = o;
  const f = o.facing >= 0 ? 1 : -1;
  const clean = Math.round(clamp(o.clean ?? 0, 0, 1) * 10) / 10;
  const mid = mixRgb([112, 120, 92], [58, 168, 200], clean);
  const midHex = toHex(mid);
  const dark = mixRgb(mid, [10, 28, 52], 0.7);
  const light = mixRgb(mid, [214, 250, 255], 0.55);
  const bodyPal = pal(midHex, 0.5, 0);
  const N = 15;
  const spine = [];
  const radii = [];
  for (let i = 0; i <= N; i++) {
    const d = i / N;
    const dist = 22 + d * 138;
    const wave = Math.sin(phase - d * 3.1) * (4 + 26 * d);
    spine.push([sx - f * dist, sy + 6 + wave + d * 10]);
    const prof = d < 0.2 ? lerp(16, 30, d / 0.2) : 30 * Math.pow(1 - (d - 0.2) / 0.8, 0.85);
    radii.push(Math.max(3, prof * 1.2));
  }
  ctx.save();

  // splash / foam ring at the waterline
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 6; i++) {
    const d = 0.1 + i * 0.15;
    const p = spine[Math.round(d * N)];
    ctx.fillStyle = `rgba(214,244,255,${0.12 + 0.06 * Math.sin(t * 3 + i)})`;
    ctx.beginPath();
    ctx.ellipse(p[0], p[1] + radii[Math.round(d * N)] * 0.9, 24, 5, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // dorsal fins (behind the body ridge)
  for (let i = 2; i < N - 2; i += 1) {
    const p = spine[i];
    const r = radii[i];
    const q = spine[i + 1];
    const ang = Math.atan2(q[1] - p[1], q[0] - p[0]) - Math.PI / 2;
    const fl = (7 + r * 0.45) * (0.8 + 0.2 * Math.sin(t * 4 + i));
    const bx = p[0] + Math.cos(ang) * r * 0.92;
    const by = p[1] + Math.sin(ang) * r * 0.92;
    ctx.fillStyle = `rgba(${dark[0] | 0},${dark[1] | 0},${dark[2] | 0},0.85)`;
    ctx.beginPath();
    ctx.moveTo(bx - f * 6, by);
    ctx.quadraticCurveTo(bx + Math.cos(ang) * fl * 0.5 + f * 2, by + Math.sin(ang) * fl, bx + Math.cos(ang) * fl - f * 3, by + Math.sin(ang) * fl);
    ctx.quadraticCurveTo(bx + Math.cos(ang) * fl * 0.4 - f * 8, by + Math.sin(ang) * fl * 0.5, bx + f * 6, by);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(${light[0] | 0},${light[1] | 0},${light[2] | 0},0.5)`;
    ctx.beginPath();
    ctx.moveTo(bx - f * 3, by);
    ctx.lineTo(bx + Math.cos(ang) * fl * 0.9 - f * 2, by + Math.sin(ang) * fl * 0.9);
    ctx.lineTo(bx + f * 3, by);
    ctx.closePath();
    ctx.fill();
  }

  // translucent water body
  organicLimb(ctx, spine, radii, new Array(N).fill(0), bodyPal, 9);
  // scale arcs + belly + foam crests, clipped to nothing (drawn lightly on top)
  ctx.save();
  ctx.strokeStyle = `rgba(${light[0] | 0},${light[1] | 0},${light[2] | 0},0.28)`;
  ctx.lineWidth = 1;
  for (let i = 1; i < N - 1; i += 2) {
    const p = spine[i];
    const r = radii[i];
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.arc(p[0] + k * r * 0.5, p[1] + r * 0.2, r * 0.42, 0.2, Math.PI - 0.2);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = "rgba(235,250,255,0.55)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 1; i < N - 1; i++) {
    const p = spine[i];
    const r = radii[i];
    const x = p[0];
    const y = p[1] - r * 0.78;
    if (i === 1) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  // head
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(f * 1.12, 1.12);
  const open = o.open ?? 0;
  // barbels (whiskers) trailing in the current
  ctx.strokeStyle = `rgba(${light[0] | 0},${light[1] | 0},${light[2] | 0},0.7)`;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(38, 2 + sgn * 2);
    ctx.bezierCurveTo(52, 8 + sgn * 10 + Math.sin(t * 3 + sgn) * 3, 62, -4 + sgn * 14, 74, 6 + sgn * 18 + Math.sin(t * 2.2) * 4);
    ctx.stroke();
  }
  // horns (swept back)
  for (const [hx, hy, hl, hc] of [[-8, -14, 30, 0.9], [0, -16, 36, 1]]) {
    tapered(ctx, [[hx, hy], [hx - hl * 0.4, hy - hl * 0.5 - 4], [hx - hl, hy - hl * 0.55]], 5.6 * hc, 1.2, "#d7e4e8", "rgba(255,255,255,0.7)");
  }
  // lower jaw (rotates open)
  ctx.save();
  ctx.translate(2, 8);
  ctx.rotate(open * 0.42);
  const jaw = new Path2D();
  smoothClosed(jaw, [[-8, 0], [10, 4], [30, 6], [42, 3], [40, 9], [28, 14], [8, 15], [-6, 11]]);
  const jg = ctx.createLinearGradient(0, 0, 0, 16);
  jg.addColorStop(0, `rgb(${light[0] | 0},${light[1] | 0},${light[2] | 0})`);
  jg.addColorStop(1, `rgb(${mid[0] | 0},${mid[1] | 0},${mid[2] | 0})`);
  ctx.fillStyle = jg;
  ctx.fill(jaw);
  ctx.fillStyle = "#f4fbff";
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(14 + i * 6, 4.6);
    ctx.lineTo(16.6 + i * 6, -3.4 - (i % 2));
    ctx.lineTo(19 + i * 6, 4.4);
    ctx.fill();
  }
  ctx.restore();
  // mouth glow when the attack telegraphs
  if (o.glow && open > 0.05) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const gg = ctx.createRadialGradient(34, 6, 1, 34, 6, 26);
    gg.addColorStop(0, o.glow);
    gg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalAlpha = Math.min(1, open * 1.3);
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(34, 6, 26, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  // skull
  const skull = new Path2D();
  smoothClosed(skull, [[-22, -8], [-12, -18], [4, -20], [20, -16], [34, -9], [45, -1], [45, 5], [36, 7], [18, 5], [0, 8], [-16, 12], [-26, 4]]);
  const sg = ctx.createLinearGradient(0, -20, 0, 12);
  sg.addColorStop(0, `rgb(${light[0] | 0},${light[1] | 0},${light[2] | 0})`);
  sg.addColorStop(0.5, `rgb(${mid[0] | 0},${mid[1] | 0},${mid[2] | 0})`);
  sg.addColorStop(1, `rgb(${dark[0] | 0},${dark[1] | 0},${dark[2] | 0})`);
  ctx.fillStyle = sg;
  ctx.fill(skull);
  ctx.save();
  ctx.clip(skull);
  ctx.strokeStyle = `rgba(${light[0] | 0},${light[1] | 0},${light[2] | 0},0.32)`;
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(-12 + i * 8, -2 + (i % 2) * 6, 5, 0.2, Math.PI - 0.2);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.beginPath();
  ctx.ellipse(10, -13, 18, 3.4, -0.1, 0, TAU);
  ctx.fill();
  ctx.restore();
  // nostril bubbles
  ctx.fillStyle = "rgba(10,30,50,0.7)";
  ctx.beginPath();
  ctx.ellipse(41, -2, 1.8, 1.2, 0.3, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(235,250,255,0.6)";
  ctx.lineWidth = 0.9;
  for (let i = 0; i < 3; i++) {
    const u = (t * 0.8 + i * 0.33) % 1;
    ctx.beginPath();
    ctx.arc(46 + u * 8, -6 - u * 16, 1.3 + i * 0.5, 0, TAU);
    ctx.globalAlpha = 1 - u;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // eye: glowing, slit pupil, heavy brow
  ctx.fillStyle = "rgba(6,22,40,0.7)";
  ctx.beginPath();
  ctx.ellipse(18, -6.5, 8.6, 6.4, -0.2, 0, TAU);
  ctx.fill();
  const eg = ctx.createRadialGradient(18, -6.5, 0.5, 18, -6.5, 6.4);
  eg.addColorStop(0, "#ffffff");
  eg.addColorStop(0.45, "#aef2ff");
  eg.addColorStop(1, "#1a8fb8");
  ctx.fillStyle = eg;
  ctx.beginPath();
  ctx.ellipse(18, -6.5, 6.6, 5, -0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#04121e";
  ctx.beginPath();
  ctx.ellipse(19, -6.4, 1.6, 4.2, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(16, -8.6, 1.2, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = `rgba(${dark[0] | 0},${dark[1] | 0},${dark[2] | 0},0.95)`;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(8, -12.6);
  ctx.quadraticCurveTo(18, -16.6, 27, -9);
  ctx.stroke();
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const eglow = ctx.createRadialGradient(18, -6.5, 1, 18, -6.5, 20);
  eglow.addColorStop(0, "rgba(160,240,255,0.32)");
  eglow.addColorStop(1, "rgba(120,220,255,0)");
  ctx.fillStyle = eglow;
  ctx.beginPath();
  ctx.arc(18, -6.5, 20, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.restore();

  // droplets flung off the body
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 9; i++) {
    const u = (t * 0.7 + i * 0.113) % 1;
    const p = spine[2 + ((i * 3) % (N - 3))];
    ctx.fillStyle = `rgba(214,244,255,${(1 - u) * 0.8})`;
    ctx.beginPath();
    ctx.arc(p[0] + Math.sin(i * 4.1) * 14, p[1] - radii[2] - u * 36 + u * u * 30, 1.8 - u, 0, TAU);
    ctx.fill();
  }
  if ((o.hurt ?? 0) > 0) {
    const rg = ctx.createRadialGradient(sx, sy, 6, sx, sy, 90);
    rg.addColorStop(0, `rgba(255,255,255,${0.5 * o.hurt})`);
    rg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(sx, sy, 90, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}
