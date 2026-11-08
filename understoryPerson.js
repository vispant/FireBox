// Understory -- the player: a young watershed ranger.
//
// A procedurally drawn human (Canvas 2D only) with real adult proportions: a
// profile face, tied-back hair that streams behind her/him, a hooded green
// field jacket, trousers, laced boots, a small pack with a bedroll, a trailing
// scarf, and a seed-lantern swinging from the belt that is the character's own
// light. Limbs are continuous shaded forms (cloth taper, knee/elbow wrinkles)
// driven by two-bone IK; feet are plantigrade with heel-strike/toe-off pitch;
// the whole pose -- idle breathing and weight shift, run cycle, jump, fall,
// landing crouch, vine-whip lash, spore cast, half-kneel revive, hurt recoil,
// seated rest -- is a pure function of the inputs, so one renderer serves
// gameplay, title and cutscene.
//
// Local space: +x = facing direction, y down, origin = ground point under the
// pelvis. Standing height is ~93 units; `scale` converts units to pixels.

import { TAU, clamp, lerp, easeOutCubic, seededRand } from "./understoryArt.js?v=2";
import { ik2, smoothThrough, organicLimb, makePal, leaf } from "./understoryRig.js?v=1";

// ---- proportions ----------------------------------------------------------
const THIGH = 22.5;
const SHIN = 20.2;
const ARM_U = 15.4;
const ARM_F = 14.0;
const AH = 4.6; // ankle height above the ground
const TORSO = 29.5;
const HS = 0.97; // head scale

// ---- palettes -----------------------------------------------------------------
const SKIN = makePal("#d9a47c", { rim: 0.5, soft: 0.65 });
const SKIN_FAR = makePal("#b9825f", { rim: 0.22, soft: 0.5 });
const JACKET = makePal("#31603f", { rim: 0.36, soft: 0.34, shadow: [0.9, 1.7] });
const JACKET_FAR = makePal("#22432d", { rim: 0.12, soft: 0.25 });
const PANTS = makePal("#6b5a45", { rim: 0.3, soft: 0.3, shadow: [0.8, 1.4] });
const PANTS_FAR = makePal("#473b2e", { rim: 0.1, soft: 0.22 });
const BOOT = makePal("#3c291d", { rim: 0.42, soft: 0.6, shadow: [0.8, 1.2] });
const BOOT_FAR = makePal("#281b13", { rim: 0.12, soft: 0.45 });
const LIGHT = [0.35, -0.9];

function smoothstep(a, b, x) {
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
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
function profile(u, keys) {
  for (let i = 0; i < keys.length - 1; i++) {
    const [u0, v0] = keys[i];
    const [u1, v1] = keys[i + 1];
    if (u <= u1) {
      const k = clamp((u - u0) / (u1 - u0 || 1), 0, 1);
      return lerp(v0, v1, (1 - Math.cos(k * Math.PI)) / 2);
    }
  }
  return keys[keys.length - 1][1];
}
// A ribbon (scarf, ponytail, whip) along a centreline with a width per point.
function ribbonPath(pts, widths) {
  const n = pts.length;
  const L = [];
  const R = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    L.push([pts[i][0] - ty * widths[i], pts[i][1] + tx * widths[i]]);
    R.push([pts[i][0] + ty * widths[i], pts[i][1] - tx * widths[i]]);
  }
  const p = new Path2D();
  smoothThrough(p, L, true);
  smoothThrough(p, R.slice().reverse(), false);
  p.closePath();
  return p;
}

// ---- face + hair (head-local space: origin = skull centre, +x = forward) ------
const FACE_PTS = [
  [-3.4, 5.2], [-5.4, 2.4], [-6.0, -1.6], [-4.4, -5.2], [-0.6, -6.6], [3.0, -5.8], [5.0, -3.2], [5.5, -1.4],
  [5.3, -0.4], [6.0, 0.8], [7.5, 2.5], [6.2, 3.1], [5.9, 3.7], [6.2, 4.3], [5.6, 4.8], [6.0, 5.4], [5.4, 6.0],
  [5.6, 7.2], [4.2, 7.8], [1.4, 7.1], [-1.2, 5.9],
];
const HAIR_PTS = [
  [5.3, -3.4], [4.4, -5.8], [1.4, -7.5], [-2.8, -7.3], [-5.9, -4.6], [-7.1, -0.8], [-6.5, 3.2], [-4.7, 5.2],
  [-3.7, 3.0], [-2.8, 0.4], [-1.5, -2.6], [1.2, -3.5], [3.6, -3.1],
];

function drawHead(ctx, o) {
  const { t, blink, flow, fall, hurt, up } = o;

  // ponytail first: it hangs behind the skull and streams with the motion
  {
    const bx = -6.3;
    const by = -1.8;
    const a0 = Math.PI * (0.6 + 0.32 * clamp(flow, 0, 1)) + fall * 0.42;
    const w = t * 2.6;
    const a1 = a0 + Math.sin(w) * 0.12;
    const a2 = a0 + 0.22 + Math.sin(w - 0.8) * 0.2;
    const a3 = a0 + 0.46 + Math.sin(w - 1.6) * 0.28;
    const p0 = [bx, by];
    const p1 = [p0[0] + Math.cos(a1) * 5.4, p0[1] + Math.sin(a1) * 5.4];
    const p2 = [p1[0] + Math.cos(a2) * 5.6, p1[1] + Math.sin(a2) * 5.6];
    const p3 = [p2[0] + Math.cos(a3) * 5.2, p2[1] + Math.sin(a3) * 5.2];
    const p4 = [p3[0] + Math.cos(a3 + 0.25) * 3.8, p3[1] + Math.sin(a3 + 0.25) * 3.8];
    const tail = ribbonPath([p0, p1, p2, p3, p4], [1.7, 2.7, 2.6, 1.8, 0.35]);
    const g = ctx.createLinearGradient(p0[0], p0[1], p4[0], p4[1]);
    g.addColorStop(0, "#3a2418");
    g.addColorStop(1, "#24140d");
    ctx.fillStyle = g;
    ctx.fill(tail);
    ctx.strokeStyle = "rgba(172,118,70,0.55)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(p0[0] - 0.3, p0[1] - 0.6);
    ctx.quadraticCurveTo(p1[0], p1[1] - 0.8, p2[0], p2[1] - 0.6);
    ctx.quadraticCurveTo(p3[0], p3[1] - 0.4, p4[0], p4[1]);
    ctx.stroke();
    ctx.strokeStyle = "rgba(16,8,4,0.5)";
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1] + 0.9);
    ctx.quadraticCurveTo(p2[0], p2[1] + 1, p3[0], p3[1] + 0.7);
    ctx.stroke();
    // the tie
    ctx.strokeStyle = "#d89a3a";
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(p0[0] - 0.4, p0[1] - 2.3);
    ctx.lineTo(p0[0] + 0.4, p0[1] + 2.3);
    ctx.stroke();
  }

  // skull + face
  const face = new Path2D();
  smoothClosed(face, FACE_PTS);
  const sg = ctx.createLinearGradient(-2, -7, 4, 8);
  sg.addColorStop(0, "#f0c6a0");
  sg.addColorStop(0.5, "#d9a47c");
  sg.addColorStop(1, "#b07a58");
  ctx.fillStyle = sg;
  ctx.fill(face);
  ctx.save();
  ctx.clip(face);
  // soft cheek warmth, brow-socket shadow, jaw/neck shadow, nose-side shade
  const cg = ctx.createRadialGradient(2.6, 3.4, 0.5, 2.6, 3.4, 4.6);
  cg.addColorStop(0, "rgba(226,128,108,0.3)");
  cg.addColorStop(1, "rgba(226,128,108,0)");
  ctx.fillStyle = cg;
  ctx.fillRect(-3, -1, 10, 10);
  const eg = ctx.createRadialGradient(3.4, -0.6, 0.4, 3.4, -0.6, 3.6);
  eg.addColorStop(0, "rgba(96,52,40,0.28)");
  eg.addColorStop(1, "rgba(96,52,40,0)");
  ctx.fillStyle = eg;
  ctx.fillRect(-1, -4, 9, 8);
  const jg = ctx.createLinearGradient(0, 4.5, 0, 8.2);
  jg.addColorStop(0, "rgba(70,36,24,0)");
  jg.addColorStop(1, "rgba(70,36,24,0.42)");
  ctx.fillStyle = jg;
  ctx.fillRect(-7, 4.5, 16, 4);
  ctx.restore();
  // rim light on the brow, nose and lips
  ctx.strokeStyle = "rgba(255,226,190,0.6)";
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.moveTo(4.4, -3.6);
  ctx.quadraticCurveTo(5.8, -1.8, 5.5, -0.6);
  ctx.quadraticCurveTo(6.4, 0.6, 7.2, 2.2);
  ctx.stroke();

  // ear
  ctx.fillStyle = "#c98f69";
  ctx.beginPath();
  ctx.ellipse(-1.5, 1.3, 1.7, 2.7, 0.18, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(110,60,42,0.55)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.ellipse(-1.4, 1.4, 0.9, 1.7, 0.18, 0.3, Math.PI * 1.6);
  ctx.stroke();

  // eyebrow, eye, nose, lips
  const eyeY = -0.2 + (up ? -0.3 : 0);
  ctx.strokeStyle = "#2c1a10";
  ctx.lineWidth = 0.95;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(1.7, eyeY - 2.3);
  ctx.quadraticCurveTo(3.8, eyeY - 3.3 - hurt * 0.4, 5.3, eyeY - 2.2 + hurt * 0.6);
  ctx.stroke();
  const open = Math.max(0.06, 1 - blink - (hurt > 0.3 ? 0.9 : 0));
  ctx.save();
  ctx.translate(3.5, eyeY);
  ctx.scale(1, open);
  ctx.fillStyle = "#f4ece2";
  ctx.beginPath();
  ctx.ellipse(0, 0, 1.75, 1.2, 0.08, 0, TAU);
  ctx.fill();
  const ig = ctx.createRadialGradient(0.45, -0.1, 0.1, 0.45, 0, 1.0);
  ig.addColorStop(0, "#7a9a4a");
  ig.addColorStop(0.6, "#4a5e2c");
  ig.addColorStop(1, "#27301a");
  ctx.fillStyle = ig;
  ctx.beginPath();
  ctx.arc(0.5, 0, 0.98, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#0e0a06";
  ctx.beginPath();
  ctx.arc(0.6, 0, 0.45, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(0.15, -0.38, 0.28, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(34,18,10,0.9)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(1.6, eyeY - 0.1);
  ctx.quadraticCurveTo(3.4, eyeY - 1.5 * open - 0.1, 5.1, eyeY - 0.2);
  ctx.stroke();
  // nostril + nose-side shade
  ctx.strokeStyle = "rgba(120,66,46,0.7)";
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.moveTo(6.4, 2.9);
  ctx.quadraticCurveTo(5.6, 2.9, 5.5, 2.4);
  ctx.stroke();
  // lips
  ctx.strokeStyle = "rgba(124,52,44,0.9)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(5.9, 4.45);
  ctx.quadraticCurveTo(4.6, 4.8 + (hurt > 0.3 ? 0.5 : 0), 3.4, 4.5);
  ctx.stroke();
  ctx.fillStyle = "rgba(190,100,88,0.5)";
  ctx.beginPath();
  ctx.ellipse(5.6, 5.0, 0.7, 0.45, 0, 0, TAU);
  ctx.fill();

  // hair over the crown and nape, with a swept fringe and highlights
  const hair = new Path2D();
  smoothClosed(hair, HAIR_PTS);
  const hg = ctx.createLinearGradient(-6, -7, 4, 3);
  hg.addColorStop(0, "#241510");
  hg.addColorStop(0.55, "#3b2418");
  hg.addColorStop(1, "#50301f");
  ctx.fillStyle = hg;
  ctx.fill(hair);
  ctx.save();
  ctx.clip(hair);
  ctx.strokeStyle = "rgba(176,122,72,0.5)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const r0 = 6.8 - i * 0.55;
    ctx.moveTo(-5.4 + i * 1.6, -2.8 - i * 0.2);
    ctx.quadraticCurveTo(-4.2 + i * 1.5, -7.2 + i * 0.45, 3.4 + i * 0.1, -5.4 + i * 0.4 - r0 * 0.0);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(14,8,4,0.55)";
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    ctx.moveTo(-6.4 + i * 1.7, 3.6 - i * 0.6);
    ctx.quadraticCurveTo(-5.2 + i * 1.5, -0.4 - i * 0.8, -3.2 + i * 1.4, -4.4 - i * 0.2);
  }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = "rgba(255,206,150,0.5)";
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.moveTo(-4.4, -6.2);
  ctx.quadraticCurveTo(-0.6, -8.0, 3.6, -5.8);
  ctx.stroke();
  // fringe strands at the hairline
  ctx.strokeStyle = "#2f1c12";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(1.2, -3.5);
  ctx.quadraticCurveTo(4.2, -3.1, 5.4, -3.5);
  ctx.moveTo(0.2, -3.7);
  ctx.quadraticCurveTo(3.0, -4.2, 4.8, -4.4);
  ctx.stroke();
}

// ---- hand: palm + jointed fingers, oriented along the forearm -----------------
function drawHand(ctx, wx, wy, dirAng, grip, spread, pal, k) {
  const ca = Math.cos(dirAng);
  const sa = Math.sin(dirAng);
  const px = wx + ca * 2.5 * k;
  const py = wy + sa * 2.5 * k;
  ctx.fillStyle = pal.mid;
  ctx.beginPath();
  ctx.ellipse(px, py, 3.2 * k, 2.6 * k, dirAng, 0, TAU);
  ctx.fill();
  const nF = 4;
  ctx.lineCap = "round";
  for (let i = 0; i < nF; i++) {
    const side = (i - 1.5) * (0.28 + spread * 0.2);
    const base = dirAng + side;
    const bx = px + Math.cos(dirAng) * 2.2 * k + Math.cos(dirAng + Math.PI / 2) * (i - 1.5) * 0.9 * k;
    const by = py + Math.sin(dirAng) * 2.2 * k + Math.sin(dirAng + Math.PI / 2) * (i - 1.5) * 0.9 * k;
    const l1 = (i === 1 || i === 2 ? 2.7 : 2.3) * k;
    const l2 = (i === 1 || i === 2 ? 2.2 : 1.8) * k;
    const curl = grip * (1.1 + i * 0.08);
    const m = [bx + Math.cos(base + curl * 0.45) * l1, by + Math.sin(base + curl * 0.45) * l1];
    const e = [m[0] + Math.cos(base + curl * 1.3) * l2, m[1] + Math.sin(base + curl * 1.3) * l2];
    ctx.strokeStyle = pal.mid;
    ctx.lineWidth = 1.35 * k;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(m[0], m[1]);
    ctx.lineTo(e[0], e[1]);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,226,196,0.35)";
    ctx.lineWidth = 0.45 * k;
    ctx.beginPath();
    ctx.moveTo(bx, by - 0.3);
    ctx.lineTo(m[0], m[1] - 0.3);
    ctx.stroke();
  }
  // thumb
  const ta = dirAng - 0.75 + grip * 0.5;
  const tb = [px + Math.cos(dirAng - 1.1) * 1.6 * k, py + Math.sin(dirAng - 1.1) * 1.6 * k];
  ctx.strokeStyle = pal.mid;
  ctx.lineWidth = 1.5 * k;
  ctx.beginPath();
  ctx.moveTo(tb[0], tb[1]);
  ctx.lineTo(tb[0] + Math.cos(ta) * 2.4 * k, tb[1] + Math.sin(ta) * 2.4 * k);
  ctx.stroke();
}

// ---- boot: shaft + plantigrade foot with heel/toe pitch -----------------------
const FOOT_PTS = [
  [-3.0, -3.6], [-3.9, 1.6], [-4.1, 3.9], [-3.3, AH + 0.1], [7.8, AH + 0.1], [10.3, 3.7], [10.9, 2.1], [9.7, 0.5],
  [6.2, -0.5], [2.8, -2.3], [2.5, -3.8],
];
function drawBoot(ctx, knee, ankle, pitch, pal, far) {
  const dx = knee[0] - ankle[0];
  const dy = knee[1] - ankle[1];
  const dl = Math.hypot(dx, dy) || 1;
  const top = [ankle[0] + (dx / dl) * 10.5, ankle[1] + (dy / dl) * 10.5];
  organicLimb(ctx, [top, ankle], [3.35, 2.9], [0], pal, 3);
  // cuff
  ctx.strokeStyle = far ? "rgba(120,92,64,0.5)" : "rgba(168,128,88,0.7)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  const nxp = -dy / dl;
  const nyp = dx / dl;
  ctx.moveTo(top[0] - nxp * 3.4, top[1] - nyp * 3.4);
  ctx.lineTo(top[0] + nxp * 3.4, top[1] + nyp * 3.4);
  ctx.stroke();
  ctx.save();
  ctx.translate(ankle[0], ankle[1]);
  ctx.rotate(pitch);
  const foot = new Path2D();
  smoothClosed(foot, FOOT_PTS);
  const g = ctx.createLinearGradient(0, -3.5, 0, AH + 0.5);
  g.addColorStop(0, far ? "#34241a" : "#5a3d2a");
  g.addColorStop(1, far ? "#1e140d" : "#2e1e14");
  ctx.fillStyle = g;
  ctx.fill(foot);
  // sole + heel block
  ctx.fillStyle = far ? "#140d08" : "#1a110b";
  ctx.beginPath();
  ctx.moveTo(-3.7, AH - 1.0);
  ctx.lineTo(10.3, AH - 1.4);
  ctx.lineTo(10.6, AH + 0.2);
  ctx.lineTo(-3.4, AH + 0.2);
  ctx.closePath();
  ctx.fill();
  if (!far) {
    // toe-cap highlight + laces
    ctx.strokeStyle = "rgba(220,170,120,0.45)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(6.4, -0.1);
    ctx.quadraticCurveTo(9.6, 0.4, 10.2, 2.4);
    ctx.stroke();
    ctx.strokeStyle = "rgba(230,214,180,0.7)";
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      ctx.moveTo(1.4 + i * 1.9, -2.1 + i * 0.55);
      ctx.lineTo(2.5 + i * 1.9, -0.9 + i * 0.55);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// ---- the person ---------------------------------------------------------------
export function drawPerson(ctx, o) {
  const S = o.scale ?? 0.58;
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
  const flow = clamp(((o.flowVx || 0) * f) / 230, -1.2, 1.2);
  const fall = onGround ? 0 : clamp(vy / 650, -1, 1);
  const breathe = Math.sin(t * 2.0);
  const shift = Math.sin(t * 0.55);

  // ---- pose ---------------------------------------------------------------
  let hipX = shift * 0.5;
  let hipY = -(AH + SHIN + THIGH) + 1.3 + breathe * 0.2;
  let lean = 0.6 + breathe * 0.15;
  let tilt = 0;
  let aN = [3.4, -AH];
  let aF = [-3.0, -AH];
  let pN = 0;
  let pF = 0;
  let hN = [1.6 + Math.sin(t * 1.2) * 0.4, 27.0 + breathe * 0.2];
  let hF = [-0.4, 27.4];
  let gripN = 0.35;
  let gripF = 0.3;
  let spreadN = 0;
  let skirt = 0;

  const footPitch = (ph) => {
    // heel-strike -> flat -> toe-off (stance), then toes-down swing -> toes-up reach
    if (Math.sin(ph) >= 0) return 0.75 * smoothstep(0.55, 1.0, (ph % TAU) / Math.PI);
    const u = (((ph % TAU) + TAU) % TAU - Math.PI) / Math.PI;
    return lerp(0.75, -0.14, smoothstep(0, 0.62, u)) * (1 - smoothstep(0.86, 1, u)) + 0;
  };

  if (sit) {
    hipX = -3;
    hipY = -5.6;
    lean = -1.5;
    tilt = -0.14;
    aN = [14, -AH];
    aF = [9, -AH];
    hN = "knee";
    hF = [4, 20];
    gripN = 0.2;
  } else if (rev > 0) {
    hipX = -1.5;
    hipY = -27.6 + Math.sin(t * 3.0) * 0.25;
    lean = 9;
    tilt = 0.16;
    aN = [15, -AH];
    aF = [-22, -3.3];
    pF = Math.PI;
    hN = [19, 16];
    hF = [4, 19];
    gripN = 0;
    spreadN = 1;
  } else if (!onGround) {
    if (vy < 0) {
      hipY = -42.5;
      lean = 3.2;
      aN = [7, -22];
      pN = 0.5;
      aF = [-8, -13];
      pF = 0.75;
      hN = [11, -9];
      hF = [-9, 3];
      gripN = 0.7;
      gripF = 0.6;
      tilt = -0.07;
    } else {
      hipY = -45;
      lean = 1.4;
      aN = [4.5, -9.5];
      pN = 0.55;
      aF = [-3, -13.5];
      pF = 0.7;
      hN = [13, 7];
      hF = [-11, 9];
      gripN = 0.2;
      gripF = 0.2;
      tilt = 0.05;
    }
  } else if (run > 0.06) {
    const stride = 10 + 8 * run;
    const lift = 8 + 6 * run;
    const cN = Math.cos(phase);
    const sN = Math.sin(phase);
    aN = [lerp(3.4, stride * cN + 1.5, run), lerp(-AH, -AH - lift * Math.max(0, -sN), run)];
    aF = [lerp(-3.0, -stride * cN + 1.5, run), lerp(-AH, -AH - lift * Math.max(0, sN), run)];
    pN = lerp(0, footPitch(phase), run);
    pF = lerp(0, footPitch(phase + Math.PI), run);
    hipY = lerp(hipY, -43.4, run) - 1.5 * run * Math.cos(2 * phase);
    lean = lerp(lean, 1 + 7.5 * run, run);
    tilt = -0.03 * run;
    hN = [lerp(hN[0], 1 - 13 * cN, run), lerp(hN[1], 17 - 5 * Math.max(0, -cN), run)];
    hF = [lerp(hF[0], 1 + 13 * cN, run), lerp(hF[1], 17 - 5 * Math.max(0, cN), run)];
    gripN = lerp(gripN, 0.75, run);
    gripF = lerp(gripF, 0.75, run);
    skirt = sN * run;
  }

  if (land > 0) {
    hipY += 8.5 * land;
    lean += 5 * land;
  }
  if (atk >= 0) {
    const e = easeOutCubic(clamp(atk, 0, 1));
    const arc = Math.sin(Math.PI * clamp(atk, 0, 1));
    lean += 5 * arc;
    hipY += 1.2 * arc;
    aN = [aN[0] + 8 * e, aN[1]];
    aF = [aF[0] - 6 * e, aF[1]];
    hN = [lerp(-14, 22, e), lerp(-13, 6, e) - arc * 7];
    gripN = 1;
    tilt += 0.08 * arc;
  }
  let flare = 0;
  if (cast >= 0) {
    const e = easeOutCubic(clamp(cast, 0, 1));
    flare = Math.sin(Math.PI * clamp(cast, 0, 1));
    lean += 3.5 * flare;
    hN = [lerp(6, 24, e), lerp(2, -2, e)];
    gripN = 0;
    spreadN = 1;
  }
  if (hurt > 0) {
    lean -= 4.5 * hurt;
    tilt -= 0.22 * hurt;
    hipY += 1.2 * hurt;
    if (hN !== "knee") hN = [hN[0] - 7 * hurt, hN[1] - 12 * hurt];
    hF = [hF[0] - 9 * hurt, hF[1] - 8 * hurt];
    gripN = Math.max(gripN, 0.8 * hurt);
  }

  const hip = [hipX, hipY];
  const shY = hipY - Math.sqrt(Math.max(1, TORSO * TORSO - lean * lean)) + breathe * 0.15;
  const sh = [hipX + lean, shY];
  const neckBase = [sh[0] + 0.8 + lean * 0.04, sh[1] - 2.2];
  const headC = [neckBase[0] + 1.5 + lean * 0.1, neckBase[1] - 8.8 * HS];
  const lanternPulse = 1 + 0.12 * Math.sin(t * 7.3) + 0.06 * Math.sin(t * 3.1) + 0.5 * rev + 0.6 * flare + (atk >= 0 ? 0.25 : 0);

  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.scale(S * f, S);
  if (o.alpha != null && o.alpha < 1) ctx.globalAlpha = Math.max(0, o.alpha);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // ---- helpers bound to this pose --------------------------------------------
  const hipJoint = (far) => [hip[0] + (far ? -0.9 : 0.9), hip[1] + 0.6];
  const legPts = (ankle, far) => {
    const hj = hipJoint(far);
    const knee = ik2(hj[0], hj[1], ankle[0], ankle[1], THIGH, SHIN, 1);
    return { hj, knee };
  };
  const drawLeg = (ankle, pitch, far, seed) => {
    const { hj, knee } = legPts(ankle, far);
    const pp = far ? PANTS_FAR : PANTS;
    organicLimb(ctx, [knee, ankle], [3.9, 2.8], [0.1], pp, seed + 4);
    drawBoot(ctx, knee, ankle, pitch, far ? BOOT_FAR : BOOT, far);
    organicLimb(ctx, [hj, knee], [5.3, 3.9], [0.12], pp, seed);
    if (!far) {
      // knee patch + wrinkles behind the knee
      ctx.fillStyle = "rgba(34,26,18,0.35)";
      ctx.beginPath();
      ctx.ellipse(knee[0] + 0.9, knee[1], 2.5, 3.1, 0.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(24,16,10,0.4)";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(knee[0] - 3.2, knee[1] - 1.4);
      ctx.quadraticCurveTo(knee[0] - 1.8, knee[1] - 0.4, knee[0] - 3.4, knee[1] + 0.8);
      ctx.moveTo(knee[0] - 3.4, knee[1] + 1.8);
      ctx.quadraticCurveTo(knee[0] - 2.0, knee[1] + 2.6, knee[0] - 3.2, knee[1] + 3.4);
      ctx.stroke();
    }
    return knee;
  };
  const shoulderJoint = (far) => [sh[0] + (far ? 1.0 : -0.8), sh[1] + (far ? 1.2 : 1.5)];
  const drawArm = (target, far, grip, spread, seed) => {
    const sj = shoulderJoint(far);
    const elbow = ik2(sj[0], sj[1], target[0], target[1], ARM_U, ARM_F, -1);
    const jp = far ? JACKET_FAR : JACKET;
    organicLimb(ctx, [sj, elbow, target], [3.6, 3.0, 2.3], [0.1, 0.14], jp, seed);
    // elbow patch + sleeve wrinkles at the bend
    if (!far) {
      ctx.fillStyle = "rgba(20,38,26,0.4)";
      ctx.beginPath();
      ctx.ellipse(elbow[0] - 0.4, elbow[1] + 0.3, 2.3, 2.9, 0.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(12,24,16,0.45)";
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      ctx.moveTo(elbow[0] + 1.2, elbow[1] - 2);
      ctx.quadraticCurveTo(elbow[0] + 2.4, elbow[1] - 0.8, elbow[0] + 1.0, elbow[1] + 0.4);
      ctx.moveTo(elbow[0] + 1.0, elbow[1] + 1.4);
      ctx.quadraticCurveTo(elbow[0] + 2.2, elbow[1] + 2.4, elbow[0] + 0.8, elbow[1] + 3.2);
      ctx.stroke();
    }
    // cuff
    const da = Math.atan2(target[1] - elbow[1], target[0] - elbow[0]);
    ctx.save();
    ctx.translate(target[0] - Math.cos(da) * 0.6, target[1] - Math.sin(da) * 0.6);
    ctx.rotate(da);
    ctx.fillStyle = far ? "#1a3523" : "#274c33";
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(-1.6, -2.7, 3.2, 5.4, 1.2) : ctx.rect(-1.6, -2.7, 3.2, 5.4);
    ctx.fill();
    ctx.restore();
    drawHand(ctx, target[0], target[1], da, grip, spread, far ? SKIN_FAR : SKIN, far ? 0.92 : 1);
    return elbow;
  };

  const resolveHand = (h, far, kneePos) => {
    if (h === "knee") return [kneePos[0] - 1.2, kneePos[1] - 3.4];
    const sj = shoulderJoint(far);
    return [sh[0] + h[0] + (sj[0] - sh[0]) * 0, sh[1] + h[1]];
  };

  // ---- far limbs first ------------------------------------------------------
  const kneeFarPre = legPts(aF, true).knee;
  drawArm(resolveHand(hF, true, kneeFarPre), true, gripF, 0, 21);
  drawLeg(aF, pF, true, 31);

  // ---- pack + scarf tail (behind the torso) ---------------------------------
  const ctrl = [hip[0] + lean * 0.3 - 1.0, hip[1] - 14.5];
  const spine = (u) => {
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    return [a * hip[0] + b * ctrl[0] + c * sh[0], a * hip[1] + b * ctrl[1] + c * sh[1]];
  };
  const spineN = (u) => {
    const p0 = spine(clamp(u - 0.02, 0, 1));
    const p1 = spine(clamp(u + 0.02, 0, 1));
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dy / l, -dx / l]; // forward normal
  };
  const FRONT_T = [[0, 5.4], [0.3, 4.6], [0.64, 6.8], [1, 4.7]];
  const BACK_T = [[0, 5.6], [0.3, 4.5], [0.64, 5.9], [1, 5.0]];

  {
    // backpack with a bedroll on top
    const a = spine(0.22);
    const b = spine(0.9);
    const an = spineN(0.22);
    const bn = spineN(0.9);
    const bt0 = profile(0.22, BACK_T);
    const bt1 = profile(0.9, BACK_T);
    const depth = 5.2;
    const p0 = [a[0] - an[0] * (bt0 + 0.4), a[1] - an[1] * (bt0 + 0.4)];
    const p1 = [a[0] - an[0] * (bt0 + depth), a[1] - an[1] * (bt0 + depth) + 1];
    const p2 = [b[0] - bn[0] * (bt1 + depth), b[1] - bn[1] * (bt1 + depth) - 0.5];
    const p3 = [b[0] - bn[0] * (bt1 + 0.4), b[1] - bn[1] * (bt1 + 0.4)];
    const pack = new Path2D();
    smoothClosed(pack, [p0, [p0[0] - 1.6, p0[1] + 2.2], p1, p2, [p3[0] - 1, p3[1] - 0.8], p3]);
    const pg = ctx.createLinearGradient(p1[0], p1[1], p0[0], p0[1]);
    pg.addColorStop(0, "#5f4a30");
    pg.addColorStop(1, "#8f7149");
    ctx.fillStyle = pg;
    ctx.fill(pack);
    ctx.strokeStyle = "rgba(30,20,10,0.55)";
    ctx.lineWidth = 0.7;
    ctx.stroke(pack);
    // flap line + buckle strap
    ctx.beginPath();
    ctx.moveTo(lerp(p1[0], p2[0], 0.12), lerp(p1[1], p2[1], 0.12));
    ctx.lineTo(lerp(p0[0], p3[0], 0.12) - 0.4, lerp(p0[1], p3[1], 0.12));
    ctx.stroke();
    ctx.fillStyle = "#c79a45";
    ctx.fillRect(lerp(p1[0], p0[0], 0.5) - 0.8, lerp(p1[1], p2[1], 0.45) - 0.6, 1.8, 1.5);
    // bedroll
    const rb = [lerp(p2[0], p3[0], 0.5) - 1.2, lerp(p2[1], p3[1], 0.5) - 1.8];
    ctx.save();
    ctx.translate(rb[0], rb[1]);
    ctx.rotate(Math.atan2(p3[1] - p2[1], p3[0] - p2[0]) + Math.PI / 2 - 0.3);
    ctx.fillStyle = "#586b44";
    ctx.beginPath();
    ctx.ellipse(0, 0, 8.4, 2.9, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(24,34,18,0.6)";
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.fillStyle = "rgba(180,210,140,0.25)";
    ctx.beginPath();
    ctx.ellipse(-0.4, -1, 6.4, 0.9, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#4b3623";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-3.4, -2.8);
    ctx.lineTo(-3.4, 2.8);
    ctx.moveTo(3.4, -2.8);
    ctx.lineTo(3.4, 2.8);
    ctx.stroke();
    ctx.restore();
  }

  // scarf tail trailing behind (cloth physics from motion)
  {
    const a0 = Math.PI * (0.58 + 0.38 * clamp(flow, 0, 1)) + fall * 0.5;
    const w = t * 3.1;
    const start = [neckBase[0] - 3.0, neckBase[1] + 1.6];
    const pts = [start];
    let cur = start;
    const segs = 6;
    for (let i = 1; i <= segs; i++) {
      const ang = a0 + (i / segs) * 0.5 + Math.sin(w - i * 0.9) * (0.1 + 0.07 * i * (0.4 + run));
      cur = [cur[0] + Math.cos(ang) * 4.4, cur[1] + Math.sin(ang) * 4.4];
      pts.push(cur);
    }
    const widths = pts.map((_, i) => 2.5 + i * 0.12 - (i === segs ? 0.4 : 0));
    const tail = ribbonPath(pts, widths);
    const g = ctx.createLinearGradient(pts[0][0], pts[0][1], pts[segs][0], pts[segs][1]);
    g.addColorStop(0, "#e09a32");
    g.addColorStop(1, "#b86a1c");
    ctx.fillStyle = g;
    ctx.fill(tail);
    ctx.save();
    ctx.clip(tail);
    ctx.fillStyle = "rgba(122,34,22,0.65)";
    for (const i of [2, 4]) {
      const p = pts[i];
      const q = pts[i + 1];
      const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
      ctx.save();
      ctx.translate(p[0], p[1]);
      ctx.rotate(ang);
      ctx.fillRect(0, -4, 1.4, 8);
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(255,214,140,0.55)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1] - 1.2);
    for (let i = 1; i <= segs; i++) ctx.lineTo(pts[i][0], pts[i][1] - 1.2);
    ctx.stroke();
    ctx.restore();
  }

  // ---- torso: hooded field jacket -------------------------------------------
  const front = [];
  const back = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    const p = spine(u);
    const nn = spineN(u);
    const hem = u < 0.15 ? 0.7 * (1 - u / 0.15) : 0; // jacket flares at the hem
    front.push([p[0] + nn[0] * (profile(u, FRONT_T) + hem), p[1] + nn[1] * (profile(u, FRONT_T) + hem)]);
    back.push([p[0] - nn[0] * (profile(u, BACK_T) + hem), p[1] - nn[1] * (profile(u, BACK_T) + hem)]);
  }
  const torso = new Path2D();
  smoothThrough(torso, front, true);
  const tf = front[front.length - 1];
  const tb = back[back.length - 1];
  torso.quadraticCurveTo((tf[0] + tb[0]) / 2 + 0.6, Math.min(tf[1], tb[1]) - 2.0, tb[0], tb[1]);
  smoothThrough(torso, back.slice().reverse(), false);
  torso.quadraticCurveTo(hip[0] - 0.4, hip[1] + 4.6, front[0][0], front[0][1]);
  torso.closePath();
  const mid = spine(0.55);
  const mn = spineN(0.55);
  const tg = ctx.createLinearGradient(mid[0] - mn[0] * 6.4, mid[1] - mn[1] * 6.4, mid[0] + mn[0] * 7.4, mid[1] + mn[1] * 7.4);
  tg.addColorStop(0, "#1f402b");
  tg.addColorStop(0.5, "#33663f");
  tg.addColorStop(1, "#4d8a58");
  ctx.fillStyle = tg;
  ctx.fill(torso);
  ctx.save();
  ctx.clip(torso);
  // belly/hem shadow + chest key-light
  const bg = ctx.createLinearGradient(0, hip[1] - 4, 0, hip[1] + 6);
  bg.addColorStop(0, "rgba(0,0,0,0)");
  bg.addColorStop(1, "rgba(0,0,0,0.38)");
  ctx.fillStyle = bg;
  ctx.fillRect(hip[0] - 12, hip[1] - 4, 24, 12);
  {
    const c = spine(0.7);
    const nn = spineN(0.7);
    const hx = c[0] + nn[0] * 3.6;
    const hy = c[1] - 1;
    const hl = ctx.createRadialGradient(hx, hy, 0.5, hx, hy, 8);
    hl.addColorStop(0, "rgba(190,240,190,0.22)");
    hl.addColorStop(1, "rgba(190,240,190,0)");
    ctx.fillStyle = hl;
    ctx.fillRect(hx - 9, hy - 9, 18, 18);
  }
  // zipper, chest pocket, drawstring, compression folds, side seam
  {
    const zs = [];
    for (let i = 1; i <= 7; i++) {
      const u = i / 8;
      const p = spine(u);
      const nn = spineN(u);
      const fo = profile(u, FRONT_T) * 0.72;
      zs.push([p[0] + nn[0] * fo, p[1] + nn[1] * fo]);
    }
    ctx.strokeStyle = "rgba(14,30,20,0.7)";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    zs.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.stroke();
    ctx.strokeStyle = "rgba(220,235,200,0.55)";
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    zs.forEach((p, i) => (i ? ctx.lineTo(p[0] + 0.3, p[1]) : ctx.moveTo(p[0] + 0.3, p[1])));
    ctx.stroke();
    // pocket flap
    const pc = spine(0.66);
    const pn = spineN(0.66);
    ctx.strokeStyle = "rgba(14,30,20,0.55)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(pc[0] + pn[0] * 1.6, pc[1] - 1.6);
    ctx.lineTo(pc[0] + pn[0] * 5.6, pc[1] - 1.4);
    ctx.lineTo(pc[0] + pn[0] * 5.6, pc[1] + 2.2);
    ctx.lineTo(pc[0] + pn[0] * 1.6, pc[1] + 2.4);
    ctx.stroke();
    // waist cinch + folds
    const wc = spine(0.3);
    const wn = spineN(0.3);
    ctx.strokeStyle = "rgba(10,24,16,0.5)";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(wc[0] - wn[0] * 6, wc[1] + 0.3);
    ctx.quadraticCurveTo(wc[0], wc[1] + 1.2, wc[0] + wn[0] * 5.6, wc[1] - 0.2);
    ctx.stroke();
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const fp = spine(0.34 + i * 0.05);
      const fn = spineN(0.34 + i * 0.05);
      ctx.moveTo(fp[0] + fn[0] * 1.5, fp[1] + 0.4);
      ctx.quadraticCurveTo(fp[0] + fn[0] * 3.6, fp[1] + 1.2, fp[0] + fn[0] * 5.2, fp[1] + 0.2);
    }
    ctx.stroke();
  }
  // belt with buckle
  {
    const bp = spine(0.1);
    const bn = spineN(0.1);
    const bf = profile(0.1, FRONT_T) + 0.4;
    const bb = profile(0.1, BACK_T) + 0.4;
    ctx.strokeStyle = "#2a1a10";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(bp[0] - bn[0] * bb, bp[1] + 0.2);
    ctx.lineTo(bp[0] + bn[0] * bf, bp[1] - 0.2);
    ctx.stroke();
    ctx.fillStyle = "#d4a64a";
    ctx.fillRect(bp[0] + bn[0] * (bf - 2.6), bp[1] - 1.7, 2.6, 3.2);
    ctx.fillStyle = "#2a1a10";
    ctx.fillRect(bp[0] + bn[0] * (bf - 1.8), bp[1] - 0.9, 1.1, 1.6);
  }
  // diagonal pack strap over the chest
  {
    const a = spine(0.9);
    const b = spine(0.34);
    const an = spineN(0.9);
    const bn = spineN(0.34);
    ctx.strokeStyle = "#5a4128";
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(a[0] + an[0] * 1.6, a[1] + 0.4);
    ctx.quadraticCurveTo((a[0] + b[0]) / 2 + an[0] * 4.6, (a[1] + b[1]) / 2, b[0] - bn[0] * 4.4, b[1] + 0.4);
    ctx.stroke();
  }
  ctx.restore();
  // rim light on the back contour
  ctx.strokeStyle = "rgba(190,226,200,0.32)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  back.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();

  // hood, bunched behind the neck
  {
    const hp0 = [neckBase[0] - 1.0, neckBase[1] + 0.8];
    const hood = new Path2D();
    smoothClosed(hood, [
      [hp0[0] + 2.2, hp0[1] - 2.2],
      [hp0[0] - 3.2, hp0[1] - 3.0],
      [hp0[0] - 6.4, hp0[1] + 0.8],
      [hp0[0] - 5.0, hp0[1] + 5.4],
      [hp0[0] - 0.6, hp0[1] + 6.4],
      [hp0[0] + 2.4, hp0[1] + 3.0],
    ]);
    const g = ctx.createLinearGradient(hp0[0] - 6, hp0[1], hp0[0] + 2, hp0[1] + 6);
    g.addColorStop(0, "#1d3a27");
    g.addColorStop(1, "#3d7449");
    ctx.fillStyle = g;
    ctx.fill(hood);
    ctx.strokeStyle = "rgba(10,24,16,0.5)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(hp0[0] - 4.4, hp0[1] + 0.6);
    ctx.quadraticCurveTo(hp0[0] - 2.2, hp0[1] + 3.0, hp0[0] - 3.4, hp0[1] + 5.4);
    ctx.moveTo(hp0[0] - 1.6, hp0[1] + 0.2);
    ctx.quadraticCurveTo(hp0[0] + 0.2, hp0[1] + 3.0, hp0[0] - 0.8, hp0[1] + 5.8);
    ctx.stroke();
  }

  // ---- near leg, lantern, then the near arm ----------------------------------
  const kneeN = drawLeg(aN, pN, false, 51);

  // seed-lantern on the belt: a pendulum, and the character's own light
  const lanternAnchor = sit ? [hip[0] + 17, -1] : [hip[0] + 2.4, hip[1] - 1.2];
  let lanternPos;
  {
    const swing = sit ? 0 : Math.sin(t * 2.1) * 0.08 - flow * 0.55 - fall * 0.2 + skirt * 0.25 + (rev > 0 ? 0.25 : 0);
    const L = sit ? 0 : 7.5;
    const lx = lanternAnchor[0] + Math.sin(swing) * L;
    const ly = lanternAnchor[1] + Math.cos(swing) * L;
    lanternPos = [lx, ly + (sit ? -6 : 4.2)];
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(sit ? 0 : swing * 0.8);
    if (!sit) {
      ctx.strokeStyle = "#5a4128";
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(Math.sin(swing) * -L, Math.cos(swing) * -L);
      ctx.lineTo(0, 0);
      ctx.stroke();
    }
    const base = sit ? -12.2 : 0;
    // brass cap, glass, base
    ctx.fillStyle = "#b9893a";
    ctx.beginPath();
    ctx.moveTo(-2.7, base + 1.4);
    ctx.lineTo(2.7, base + 1.4);
    ctx.lineTo(1.6, base - 0.6);
    ctx.lineTo(-1.6, base - 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,226,150,0.28)";
    ctx.fillRect(-2.5, base + 1.4, 5, 7.2);
    const lg = ctx.createRadialGradient(0, base + 5, 0.3, 0, base + 5, 3.8);
    lg.addColorStop(0, "#fffbe0");
    lg.addColorStop(0.4, "#ffd860");
    lg.addColorStop(1, "rgba(255,150,50,0.65)");
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.ellipse(0, base + 5, 1.7 * (0.9 + 0.1 * lanternPulse), 2.8 * (0.92 + 0.08 * lanternPulse), 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#8a6428";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-2.5, base + 1.4);
    ctx.lineTo(-2.5, base + 8.6);
    ctx.moveTo(2.5, base + 1.4);
    ctx.lineTo(2.5, base + 8.6);
    ctx.stroke();
    ctx.fillStyle = "#b9893a";
    ctx.fillRect(-2.9, base + 8.4, 5.8, 1.6);
    ctx.restore();
  }

  const handNAbs = resolveHand(hN, false, kneeN);
  drawArm(handNAbs, false, gripN, spreadN, 61);

  // ---- neck, scarf wrap, head -------------------------------------------------
  {
    const nt = [headC[0] - 2.2, headC[1] + 6.3];
    organicLimb(ctx, [neckBase, nt], [2.85, 2.55], [0.02], SKIN, 41);
    // shadow the jaw throws on the neck
    const sg = ctx.createRadialGradient(nt[0] + 1, nt[1] + 1.4, 0.5, nt[0] + 1, nt[1] + 1.4, 4.6);
    sg.addColorStop(0, "rgba(60,30,20,0.4)");
    sg.addColorStop(1, "rgba(60,30,20,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(nt[0] - 5, nt[1] - 3, 11, 9);
    // scarf wrap around the neck
    const sc = [neckBase[0] + 0.6, neckBase[1] - 0.4];
    ctx.save();
    ctx.translate(sc[0], sc[1]);
    ctx.rotate(-0.15);
    const wrap = new Path2D();
    smoothClosed(wrap, [[-4.6, -1.6], [-1.5, -3.4], [3.6, -3.0], [5.2, 0.4], [3.2, 3.4], [-1.4, 3.8], [-4.8, 1.8]]);
    const wg = ctx.createLinearGradient(-4, -3, 4, 4);
    wg.addColorStop(0, "#f0aa44");
    wg.addColorStop(1, "#b86a1c");
    ctx.fillStyle = wg;
    ctx.fill(wrap);
    ctx.strokeStyle = "rgba(122,34,22,0.6)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-2.6, -2.8);
    ctx.quadraticCurveTo(-1.8, 0.2, -3.2, 3.4);
    ctx.moveTo(1.2, -3.2);
    ctx.quadraticCurveTo(2.0, 0.2, 0.6, 3.6);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,222,150,0.6)";
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    ctx.moveTo(-3.8, -2.0);
    ctx.quadraticCurveTo(0, -4.0, 4.0, -2.4);
    ctx.stroke();
    ctx.restore();
  }
  {
    const blinkP = (t + 1.3) % 3.9;
    const blink = blinkP < 0.14 ? Math.sin((blinkP / 0.14) * Math.PI) : 0;
    ctx.save();
    ctx.translate(headC[0], headC[1]);
    ctx.rotate(tilt);
    ctx.scale(HS, HS);
    drawHead(ctx, { t, blink, flow, fall, hurt, up: tilt < -0.1 });
    ctx.restore();
  }

  // ---- vine whip, spore orb, revive glow ---------------------------------------
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  if (atk >= 0 && atk < 1 && hN !== "knee") {
    const e = clamp(atk, 0, 1);
    const arc = Math.sin(Math.PI * e);
    const ang = lerp(-2.25, 0.5, easeOutCubic(e));
    const Lw = 44 * Math.pow(arc, 0.7);
    const h0 = handNAbs;
    const tip = [h0[0] + Math.cos(ang) * Lw, h0[1] + Math.sin(ang) * Lw];
    const c1 = [h0[0] + Math.cos(ang - 0.7) * Lw * 0.55, h0[1] + Math.sin(ang - 0.7) * Lw * 0.55];
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(120,255,120,0.22)";
    ctx.lineWidth = 8 * arc + 1;
    ctx.beginPath();
    ctx.moveTo(h0[0], h0[1]);
    ctx.quadraticCurveTo(c1[0], c1[1], tip[0], tip[1]);
    ctx.stroke();
    ctx.strokeStyle = "rgba(160,245,100,0.9)";
    ctx.lineWidth = 3 * arc + 0.4;
    ctx.stroke();
    ctx.strokeStyle = "rgba(240,255,190,0.95)";
    ctx.lineWidth = 1.1 * arc + 0.2;
    ctx.stroke();
    for (const u of [0.45, 0.7, 0.95]) {
      const px = (1 - u) * (1 - u) * h0[0] + 2 * (1 - u) * u * c1[0] + u * u * tip[0];
      const py = (1 - u) * (1 - u) * h0[1] + 2 * (1 - u) * u * c1[1] + u * u * tip[1];
      leaf(ctx, px, py, px + Math.cos(ang + 1.2) * 5 * arc, py + Math.sin(ang + 1.2) * 5 * arc, 1.3 * arc, "rgba(120,230,90,0.85)", "rgba(220,255,160,0.9)", null);
    }
  }
  if ((cast >= 0 || rev > 0) && hN !== "knee") {
    const p = handNAbs;
    const ga = cast >= 0 ? 0.55 * flare + 0.18 : 0.28 + 0.5 * rev;
    const r = cast >= 0 ? 7 + 6 * flare : 8 + 4 * rev;
    const pg = ctx.createRadialGradient(p[0] + 3, p[1], 0, p[0] + 3, p[1], r);
    pg.addColorStop(0, "rgba(240,255,170," + ga + ")");
    pg.addColorStop(0.5, "rgba(150,240,100," + ga * 0.5 + ")");
    pg.addColorStop(1, "rgba(150,240,100,0)");
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(p[0] + 3, p[1], r, 0, TAU);
    ctx.fill();
  }
  // the lantern's warm halo (and a small pool on whatever it hangs over)
  {
    const r = 16 + 7 * lanternPulse;
    const hg = ctx.createRadialGradient(lanternPos[0], lanternPos[1], 1, lanternPos[0], lanternPos[1], r);
    hg.addColorStop(0, "rgba(255,206,110," + clamp(0.5 * lanternPulse * glowMul, 0, 0.85) + ")");
    hg.addColorStop(0.5, "rgba(255,160,60," + clamp(0.14 * lanternPulse * glowMul, 0, 0.4) + ")");
    hg.addColorStop(1, "rgba(255,140,40,0)");
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(lanternPos[0], lanternPos[1], r, 0, TAU);
    ctx.fill();
  }
  if (hurt > 0) {
    const rg = ctx.createRadialGradient(sh[0], hip[1] - 14, 4, sh[0], hip[1] - 14, 38);
    rg.addColorStop(0, "rgba(255,70,60," + 0.34 * hurt + ")");
    rg.addColorStop(1, "rgba(255,70,60,0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(sh[0], hip[1] - 14, 38, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  ctx.restore();
}
