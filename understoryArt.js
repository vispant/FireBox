// Understory -- procedural art.
//
// Pure drawing helpers: nothing in here reads or writes game state. The
// engine (understoryGame.js) decides what exists and where; this file decides
// how it looks. Canvas 2D only (gradients, bezier paths, additive light) so it
// stays light on a Chromebook: no per-pixel work, no shadowBlur in hot paths,
// and every texture-like detail (bark grain, pebbles, foliage shape) comes
// from seeded math, so it's identical every frame instead of flickering.

export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}
// Deterministic pseudo-random in [0,1) from a number -- stable per seed.
export function seededRand(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const rgbCache = new Map();
export function hexToRgb(hex) {
  let c = rgbCache.get(hex);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, c);
  }
  return c;
}
export function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
export function rgbCss(c, a = 1) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}
export function mixHex(a, b, t) {
  return rgbCss(mixRgb(hexToRgb(a), hexToRgb(b), t));
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
export function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function wrapLines(ctx, text, maxW) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// A little keyboard-key icon (x,y = top-left). Returns its width.
export function drawKeyCap(ctx, x, y, label, size = 1) {
  ctx.save();
  ctx.font = `bold ${Math.round(11 * size)}px system-ui, sans-serif`;
  const tw = ctx.measureText(label).width;
  const w = Math.max(20 * size, tw + 12 * size);
  const h = 19 * size;
  rr(ctx, x, y + 2 * size, w, h, 5 * size);
  ctx.fillStyle = "#1c2a1e";
  ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "#fbfdf6");
  g.addColorStop(1, "#cdd8c0");
  rr(ctx, x, y, w, h, 5 * size);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "#6a7a60";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#25301d";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
  ctx.restore();
  return w;
}

export function drawPanel(ctx, x, y, w, h, o = {}) {
  const radius = o.radius ?? 12;
  rr(ctx, x + 1, y + 3, w, h, radius);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, o.top ?? "rgba(22,34,24,0.9)");
  g.addColorStop(1, o.bottom ?? "rgba(10,18,12,0.92)");
  rr(ctx, x, y, w, h, radius);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = o.border ?? "rgba(190,242,120,0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Scenery: sky, stars, sun/moon, mountains, mist, parallax forest, light shafts.
// `r` is restoration 0..1 -- the whole backdrop blends from the withered
// palette (dusk-gloom, moonlit) to the restored one (golden dawn) with it.
// ---------------------------------------------------------------------------
const STARS = [];
for (let i = 0; i < 70; i++) {
  STARS.push({ x: seededRand(i * 3.1 + 0.5), y: seededRand(i * 7.7 + 1.5) * 0.5, s: 0.6 + seededRand(i * 5.3 + 2.5) * 1.3, p: seededRand(i * 2.9 + 3.5) * TAU });
}

function ridgeH(x, seedOff) {
  const n = Math.sin(x * 0.0042 + seedOff) * 0.55 + Math.sin(x * 0.0111 + seedOff * 2.3) * 0.3 + Math.sin(x * 0.0257 + seedOff * 0.7) * 0.15;
  return n * 0.5 + 0.5;
}

function fillRidge(ctx, W, H, camX, scroll, baseY, amp, colTop, colBottom, seedOff) {
  const g = ctx.createLinearGradient(0, baseY - amp, 0, baseY + 40);
  g.addColorStop(0, colTop);
  g.addColorStop(1, colBottom);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-10, H);
  for (let sx = -10; sx <= W + 10; sx += 18) {
    ctx.lineTo(sx, baseY - ridgeH(sx + camX * scroll, seedOff) * amp);
  }
  ctx.lineTo(W + 10, H);
  ctx.closePath();
  ctx.fill();
}

function drawCelestial(ctx, W, H, r, camX) {
  const cx = W * 0.74 - camX * 0.012;
  const cy = H * (0.2 - r * 0.05);
  const col = mixRgb([226, 233, 248], [255, 232, 160], r);
  const haloR = 120 + r * 100;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
  g.addColorStop(0, rgbCss(col, 0.4 + r * 0.22));
  g.addColorStop(0.3, rgbCss(col, 0.15 + r * 0.1));
  g.addColorStop(1, rgbCss(col, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = rgbCss(mixRgb([238, 242, 252], [255, 246, 208], r), 0.97);
  ctx.beginPath();
  ctx.arc(cx, cy, 19 + r * 5, 0, TAU);
  ctx.fill();
  if (r < 0.7) {
    ctx.fillStyle = `rgba(150,160,185,${(0.7 - r) * 0.35})`;
    for (const [dx, dy, cr] of [[-6, -4, 4], [5, 3, 3], [-2, 8, 2.4], [7, -7, 2]]) {
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, cr, 0, TAU);
      ctx.fill();
    }
  }
}

const TREE_LAYERS = [
  { scroll: 0.15, bw: 90, bh: 260, yFrac: 0.8, fog: 0.5, alpha: 0.78 },
  { scroll: 0.3, bw: 70, bh: 190, yFrac: 0.83, fog: 0.26, alpha: 0.9 },
  { scroll: 0.5, bw: 56, bh: 140, yFrac: 0.865, fog: 0.05, alpha: 1 },
];
// the far layers skip the blobby "bushy" shape (it read as big discs at that
// scale) and use fewer snags; snags are tinted weathered-grey, not forest green
const TREE_KINDS = ["pine", "rounded", "bushy", "snag", "pine"];
const FAR_KINDS = ["pine", "rounded", "pine", "pine", "rounded", "snag", "pine"];

function treeShape(ctx, kind, x, baseY, h, w, col, hi) {
  if (kind === "snag") {
    ctx.strokeStyle = col;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(2, w * 0.12);
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x, baseY - h);
    ctx.moveTo(x, baseY - h * 0.62);
    ctx.lineTo(x + w * 0.3, baseY - h * 0.82);
    ctx.moveTo(x, baseY - h * 0.42);
    ctx.lineTo(x - w * 0.26, baseY - h * 0.58);
    ctx.moveTo(x, baseY - h * 0.8);
    ctx.lineTo(x - w * 0.16, baseY - h * 0.95);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = col;
  ctx.fillRect(x - w * 0.055, baseY - h * 0.2, w * 0.11, h * 0.2);
  if (kind === "pine") {
    for (let k = 0; k < 3; k++) {
      const apex = baseY - h + k * h * 0.2;
      const bot = apex + h * 0.44;
      const hw = w * (0.3 + k * 0.12);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x, apex);
      ctx.lineTo(x + hw, bot);
      ctx.lineTo(x - hw, bot);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = hi;
      ctx.beginPath();
      ctx.moveTo(x, apex);
      ctx.lineTo(x + hw, bot);
      ctx.lineTo(x + hw * 0.18, bot);
      ctx.closePath();
      ctx.fill();
    }
  } else if (kind === "rounded") {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, baseY - h * 0.15);
    ctx.quadraticCurveTo(x - w / 2, baseY - h, x, baseY - h);
    ctx.quadraticCurveTo(x + w / 2, baseY - h, x + w / 2, baseY - h * 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = hi;
    ctx.beginPath();
    ctx.moveTo(x, baseY - h);
    ctx.quadraticCurveTo(x + w / 2, baseY - h, x + w / 2, baseY - h * 0.15);
    ctx.lineTo(x + w * 0.14, baseY - h * 0.15);
    ctx.quadraticCurveTo(x + w * 0.2, baseY - h * 0.62, x, baseY - h);
    ctx.fill();
  } else {
    for (let i = 0; i < 3; i++) {
      const cx = x + (i - 1) * w * 0.3;
      const cy = baseY - h * (0.45 + i * 0.17);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx, cy, w * 0.33, 0, TAU);
      ctx.fill();
      ctx.fillStyle = hi;
      ctx.beginPath();
      ctx.arc(cx + w * 0.07, cy - w * 0.07, w * 0.2, 0, TAU);
      ctx.fill();
    }
  }
}

// lite = true drops the costly decoration (stars, drifting cloud banks, the far
// forest layer, light shafts) for slow devices; the scene still reads the same.
export function drawBackdrop(ctx, W, H, pal, r, camX, t, lite = false) {
  const sky0 = mixRgb(hexToRgb(pal.sky[0]), hexToRgb(pal.skyLiving[0]), r);
  const sky1 = mixRgb(hexToRgb(pal.sky[1]), hexToRgb(pal.skyLiving[1]), r);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgbCss(sky0));
  g.addColorStop(1, rgbCss(sky1));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  if (r < 0.95 && !lite) {
    ctx.fillStyle = "#ffffff";
    for (let grp = 0; grp < 3; grp++) {
      ctx.globalAlpha = (1 - r) * 0.8 * (0.55 + 0.45 * Math.sin(t * 1.4 + grp * 2.1));
      ctx.beginPath();
      for (let i = grp; i < STARS.length; i += 3) {
        const s = STARS[i];
        const sx = (((s.x * W - camX * 0.01) % W) + W) % W;
        ctx.rect(sx, s.y * H, s.s, s.s);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawCelestial(ctx, W, H, r, camX);

  const mtn = mixRgb([84, 96, 112], [96, 158, 150], r);
  if (!lite) fillRidge(ctx, W, H, camX, 0.04, H * 0.66, 130, rgbCss(mixRgb(mtn, sky1, 0.55)), rgbCss(mixRgb(mtn, sky1, 0.8)), 1.7);
  fillRidge(ctx, W, H, camX, 0.08, H * 0.72, 100, rgbCss(mixRgb(mtn, sky1, 0.34)), rgbCss(mixRgb(mtn, sky1, 0.62)), 4.2);

  // low mist: a hazy band at the treeline plus a few big drifting clouds
  const mistY = H * 0.75;
  const haze = mixRgb(sky1, [255, 255, 255], 0.2);
  const mg = ctx.createLinearGradient(0, mistY - 60, 0, mistY + 80);
  mg.addColorStop(0, rgbCss(haze, 0));
  mg.addColorStop(0.5, rgbCss(haze, 0.32));
  mg.addColorStop(1, rgbCss(haze, 0));
  ctx.fillStyle = mg;
  ctx.fillRect(0, mistY - 60, W, 140);
  for (let i = 0; i < (lite ? 0 : 3); i++) {
    const cx = ((((i * 0.41 + t * 0.006) % 1.5) - 0.25) * W);
    const cy = mistY - 10 + i * 18;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(3.4, 0.5);
    const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, 70);
    rg.addColorStop(0, rgbCss(haze, 0.18));
    rg.addColorStop(1, rgbCss(haze, 0));
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(0, 0, 70, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  const treeBase = mixRgb(hexToRgb(pal.tree), hexToRgb(pal.treeLiving), r);
  TREE_LAYERS.forEach((layer, li) => {
    if (lite && li === 0) return;
    const spacing = layer.bw * 2.1;
    const offset = (camX * layer.scroll) % spacing;
    const count = Math.ceil(W / spacing) + 2;
    const col = mixRgb(treeBase, sky1, layer.fog);
    const baseY = H * layer.yFrac;
    const grad = ctx.createLinearGradient(0, baseY - layer.bh * 1.2, 0, baseY);
    grad.addColorStop(0, rgbCss(mixRgb(col, sky1, 0.2)));
    grad.addColorStop(1, rgbCss(col));
    const hi = rgbCss(mixRgb(col, [255, 236, 160], 0.2 + r * 0.26), 0.55);
    ctx.globalAlpha = layer.alpha;
    for (let i = -1; i <= count; i++) {
      const slot = Math.floor((camX * layer.scroll + i * spacing) / spacing);
      const seed = li * 10000 + slot;
      const x = i * spacing - offset;
      const kinds = li < 2 ? FAR_KINDS : TREE_KINDS;
      const kind = kinds[Math.floor(seededRand(seed) * kinds.length)];
      const wv = 0.72 + seededRand(seed + 50) * 0.6;
      const hv = 0.72 + seededRand(seed + 90) * 0.6;
      treeShape(ctx, kind, x, baseY, layer.bh * hv, layer.bw * wv, kind === "snag" ? rgbCss(mixRgb(col, [96, 82, 64], 0.55)) : grad, hi);
    }
  });
  ctx.globalAlpha = 1;

  // slanting light shafts through the canopy -- stronger as the world heals
  if (lite) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const shaftA = 0.05 + r * 0.075;
  for (let i = 0; i < 3; i++) {
    const x0 = W * (0.14 + i * 0.32) + Math.sin(t * 0.25 + i * 1.7) * 26 - camX * 0.03;
    const w0 = 22 + (i % 2) * 14;
    const w1 = 110 + i * 24;
    const sg = ctx.createLinearGradient(x0, 0, x0 + 90, H * 0.88);
    sg.addColorStop(0, `rgba(255,238,176,${shaftA})`);
    sg.addColorStop(1, "rgba(255,238,176,0)");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(x0 - w0 / 2, 0);
    ctx.lineTo(x0 + w0 / 2, 0);
    ctx.lineTo(x0 + 90 + w1 / 2, H * 0.88);
    ctx.lineTo(x0 + 90 - w1 / 2, H * 0.88);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// A soft warm pool of light centred on the player's glowing heartwood: the
// dark world stays dark in the distance, but a living light travels with you.
export function drawPlayerLight(ctx, sx, sy, glow, r) {
  const rad = 160 + glow * 40;
  const a = (0.24 + (1 - r) * 0.14) * clamp(glow, 0.6, 1.8);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad);
  g.addColorStop(0, `rgba(255,240,170,${a})`);
  g.addColorStop(0.45, `rgba(255,228,135,${a * 0.34})`);
  g.addColorStop(1, "rgba(255,220,120,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(sx, sy, rad, 0, TAU);
  ctx.fill();
  ctx.restore();
}

export function drawContactShadow(ctx, x, y, w, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, 0.22);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w);
  g.addColorStop(0, `rgba(10,6,2,${alpha})`);
  g.addColorStop(1, "rgba(10,6,2,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, w, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Ground: soil gradient, turf lip, strata/pebbles, plus plants that *grow*
// with local aliveness (dry tufts when withered; grass, ferns, blooms and
// mushrooms as the green spreads outward from a revived flower).
// v = { ox, oy, W, H } world->screen offsets; aliveAt(wx, wy) -> 0..1.
// ---------------------------------------------------------------------------
const PLANT_STEP = 15;
const BLOOM_COLORS = ["#f9a8d4", "#fde68a", "#c4b5fd", "#fdba74", "#93c5fd", "#fca5a5", "#f0abfc"];

function dryTuft(ctx, x, y, seed, t) {
  const h = 5 + seededRand(seed + 5) * 8;
  const sway = Math.sin(t * 1.2 + seed) * 1;
  ctx.strokeStyle = seededRand(seed + 6) > 0.5 ? "#9a8458" : "#76643f";
  ctx.lineWidth = 1.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let k = -1; k <= 1; k++) {
    ctx.moveTo(x + k * 2, y + 1);
    ctx.quadraticCurveTo(x + k * 3 + sway * 0.4, y - h * 0.6, x + k * 4.5 + sway + (seededRand(seed + k) - 0.5) * 3, y - h * (0.75 + seededRand(seed + 9 + k) * 0.3));
  }
  ctx.stroke();
}

function grassTuft(ctx, x, y, h, col, seed, t) {
  const sway = Math.sin(t * 1.7 + x * 0.045 + seed) * (0.8 + h * 0.06);
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let k = -2; k <= 2; k++) {
    const lean = k * 1.8 + (seededRand(seed + k * 3) - 0.5) * 3;
    const bh = h * (0.6 + seededRand(seed + k * 5 + 1) * 0.5) * (1 - Math.abs(k) * 0.12);
    ctx.moveTo(x + k * 1.4, y + 1);
    ctx.quadraticCurveTo(x + k * 1.6 + lean * 0.4 + sway * 0.35, y - bh * 0.6, x + lean + sway, y - bh);
  }
  ctx.stroke();
}

function fernTuft(ctx, x, y, h, col, seed, t) {
  const sway = Math.sin(t * 1.3 + x * 0.04 + seed) * 1.2;
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.7;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    const a = (k / 4 - 0.5) * 2.0;
    const len = h * (0.8 + seededRand(seed + k) * 0.35) * (1 - Math.abs(a) * 0.18);
    ctx.moveTo(x, y + 1);
    ctx.quadraticCurveTo(x + Math.sin(a) * len * 0.45, y - Math.cos(a) * len * 0.95, x + Math.sin(a) * len + sway * (0.4 + Math.abs(a)), y - Math.cos(a) * len * 0.7 + 1);
  }
  ctx.stroke();
}

function bloomPlant(ctx, x, y, h, stemCol, seed, t) {
  const sway = Math.sin(t * 1.5 + x * 0.05 + seed) * 1.2;
  const hx = x + sway;
  const hy = y - h;
  ctx.strokeStyle = stemCol;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(x, y + 1);
  ctx.quadraticCurveTo(x + sway * 0.3, y - h * 0.55, hx, hy);
  ctx.stroke();
  const pc = BLOOM_COLORS[Math.floor(seededRand(seed + 11) * BLOOM_COLORS.length)];
  ctx.fillStyle = pc;
  const pr = 2.1 + seededRand(seed + 12) * 0.8;
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + seed;
    ctx.moveTo(hx + Math.cos(a) * pr + pr * 0.9, hy + Math.sin(a) * pr);
    ctx.arc(hx + Math.cos(a) * pr, hy + Math.sin(a) * pr, pr * 0.9, 0, TAU);
  }
  ctx.fill();
  ctx.fillStyle = "#fff3b0";
  ctx.beginPath();
  ctx.arc(hx, hy, pr * 0.55, 0, TAU);
  ctx.fill();
}

function mushroom(ctx, x, y, s, seed) {
  const warm = seededRand(seed + 3) > 0.5;
  ctx.fillStyle = "#efe7d2";
  ctx.fillRect(x - s * 0.22, y - s * 0.8, s * 0.44, s * 0.8 + 1);
  ctx.fillStyle = warm ? "#d9583c" : "#c89a5b";
  ctx.beginPath();
  ctx.ellipse(x, y - s * 0.8, s * 0.75, s * 0.55, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.beginPath();
  ctx.arc(x - s * 0.25, y - s * 0.98, s * 0.11, 0, TAU);
  ctx.arc(x + s * 0.22, y - s * 1.05, s * 0.09, 0, TAU);
  ctx.fill();
}

export function drawGroundBackdrop(ctx, v, minTop) {
  const sy = minTop + v.oy + 4;
  if (sy > v.H) return;
  const g = ctx.createLinearGradient(0, sy, 0, v.H);
  g.addColorStop(0, "#2a1d12");
  g.addColorStop(1, "#0b0704");
  ctx.fillStyle = g;
  ctx.fillRect(0, sy, v.W, v.H - sy);
}

export function drawGroundPiece(ctx, v, r, ri, aliveAt, pal, t) {
  const sx = r.x + v.ox;
  const sy = r.y + v.oy;
  if (sx + r.w < -30 || sx > v.W + 30) return;
  // narrow columns so the dry->green transition reads as a soft gradient
  const SEG = 12;
  const wRgb = hexToRgb(pal.withered);
  const lRgb = hexToRgb(pal.living);
  const first = Math.max(0, Math.floor((-30 - sx) / SEG)) * SEG;
  // consecutive columns at the same (quantised) restoration level are merged
  // into one fill, so a uniformly dry or green stretch costs two rects total
  let runX = 0;
  let runW = 0;
  let runAl = -1;
  const flushRun = () => {
    if (runW <= 0) return;
    const col = mixRgb(wRgb, lRgb, runAl);
    ctx.fillStyle = rgbCss(col);
    ctx.fillRect(runX, sy, runW + 1, r.h);
    ctx.fillStyle = rgbCss(mixRgb(col, [168, 212, 112], 0.14 + runAl * 0.26));
    ctx.fillRect(runX, sy, runW + 1, 5);
  };
  for (let off = first; off < r.w && sx + off < v.W + 30; off += SEG) {
    const segW = Math.min(SEG, r.w - off);
    const al = Math.round(aliveAt(r.x + off + segW / 2, r.y) * 40) / 40;
    if (runW > 0 && al === runAl) runW += segW;
    else {
      flushRun();
      runX = sx + off;
      runW = segW;
      runAl = al;
    }
  }
  flushRun();
  // pebbles + (on dry ground) cracks, one cluster per ~44px
  const PEB = 44;
  const pfirst = Math.max(0, Math.floor((-30 - sx) / PEB)) * PEB;
  for (let off = pfirst; off < r.w && sx + off < v.W + 30; off += PEB) {
    const seed = ri * 500 + off * 0.37;
    const al = aliveAt(r.x + off + PEB / 2, r.y);
    for (let k = 0; k < 2; k++) {
      const px = sx + off + seededRand(seed + k * 3) * PEB;
      const py = sy + 12 + seededRand(seed + k * 3 + 1) * Math.max(4, r.h - 18);
      ctx.fillStyle = k === 0 ? "rgba(0,0,0,0.2)" : "rgba(255,240,200,0.1)";
      ctx.beginPath();
      ctx.ellipse(px, py, 2 + seededRand(seed + k + 7) * 4, 1.5 + seededRand(seed + k + 8) * 2.2, 0, 0, TAU);
      ctx.fill();
    }
    if (al < 0.5 && r.h >= 40 && seededRand(seed + 41) > 0.35) {
      ctx.strokeStyle = `rgba(28,16,6,${0.38 * (1 - al * 2)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      let cx = sx + off + seededRand(seed + 42) * PEB;
      let cy = sy + 4;
      ctx.moveTo(cx, cy);
      for (let q = 0; q < 4; q++) {
        cx += (seededRand(seed + 43 + q) - 0.5) * 9;
        cy += 4 + seededRand(seed + 50 + q) * 6;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
  }
  const gx0 = Math.max(sx, -30);
  const gx1 = Math.min(sx + r.w, v.W + 30);
  const dg = ctx.createLinearGradient(0, sy, 0, sy + r.h);
  dg.addColorStop(0, "rgba(255,248,220,0.1)");
  dg.addColorStop(0.12, "rgba(0,0,0,0)");
  dg.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = dg;
  ctx.fillRect(gx0, sy, gx1 - gx0, r.h);
  ctx.fillStyle = "rgba(20,12,4,0.35)";
  ctx.fillRect(gx0, sy, gx1 - gx0, 1);

  if (r.h < 40) {
    // floating ledge: roots dangling from the underside
    ctx.strokeStyle = "#4a3320";
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    const n = Math.floor(r.w / 34);
    for (let i = 0; i < n; i++) {
      const rx = sx + 10 + i * 34 + seededRand(ri * 77 + i) * 14;
      const len = 7 + seededRand(ri * 91 + i) * 12;
      const sw = Math.sin(t * 1.4 + i) * 1.6;
      ctx.moveTo(rx, sy + r.h - 1);
      ctx.quadraticCurveTo(rx + sw, sy + r.h + len * 0.5, rx + sw * 1.6, sy + r.h + len);
    }
    ctx.stroke();
  }

  // plants along the top edge
  const i0 = Math.max(0, Math.floor((-v.ox - 30 - r.x) / PLANT_STEP));
  const i1 = Math.min(Math.floor(r.w / PLANT_STEP), Math.ceil((-v.ox + v.W + 30 - r.x) / PLANT_STEP));
  for (let i = i0; i <= i1; i++) {
    if (v.lite && (i & 1)) continue; // half the plants on slow devices
    const seed = ri * 977 + i * 3.17;
    const wx = r.x + i * PLANT_STEP + (seededRand(seed + 1) - 0.5) * PLANT_STEP * 0.9;
    if (wx < r.x + 4 || wx > r.x + r.w - 4) continue;
    const al = aliveAt(wx, r.y);
    const roll = seededRand(seed + 2);
    const px = wx + v.ox;
    if (al < 0.16) {
      if (roll < 0.3) dryTuft(ctx, px, sy, seed, t);
      continue;
    }
    if (roll > 0.28 + 0.68 * al) continue;
    if (al < 0.5 && seededRand(seed + 4) < 1 - al * 2) {
      dryTuft(ctx, px, sy, seed, t);
      continue;
    }
    const grow = easeOutCubic(clamp((al - 0.12) / 0.7, 0, 1));
    const kindRoll = seededRand(seed + 3);
    const green = mixRgb([116, 142, 66], [78 + seededRand(seed + 20) * 30, 160 + seededRand(seed + 21) * 36, 70 + seededRand(seed + 22) * 30], al);
    const gc = rgbCss(green);
    if (kindRoll < 0.12 && al > 0.55) {
      bloomPlant(ctx, px, sy, (11 + seededRand(seed + 5) * 9) * grow, gc, seed, t);
    } else if (kindRoll < 0.2 && al > 0.5) {
      mushroom(ctx, px, sy + 1, (4 + seededRand(seed + 6) * 3) * grow, seed);
    } else if (kindRoll < 0.45) {
      fernTuft(ctx, px, sy, (12 + seededRand(seed + 5) * 9) * grow, gc, seed, t);
    } else {
      grassTuft(ctx, px, sy, (9 + seededRand(seed + 5) * 11) * grow, gc, seed, t);
    }
  }
}

// ---------------------------------------------------------------------------
// Gates: a wooden arch. Open = glowing portal; sealed = dark and vine-bound.
// ---------------------------------------------------------------------------
export function drawGate(ctx, v, g, o) {
  const x = g.x + v.ox;
  const y = g.y + v.oy;
  if (x < -160 || x > v.W + 160) return;
  const t = o.t;
  const H = 104;
  const half = 36;
  const cy = y - H * 0.5;
  ctx.save();
  if (!o.locked) {
    const pulse = 0.85 + Math.sin(t * 2.2) * 0.15;
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(x, cy, 6, x, cy, H * 0.95);
    halo.addColorStop(0, `rgba(150,255,225,${0.28 * pulse})`);
    halo.addColorStop(1, "rgba(100,220,210,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, cy, H * 0.95, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    const pg = ctx.createRadialGradient(x, cy, 3, x, cy, H * 0.55);
    pg.addColorStop(0, `rgba(215,255,240,${0.92 * pulse})`);
    pg.addColorStop(0.55, `rgba(96,214,200,${0.62 * pulse})`);
    pg.addColorStop(1, "rgba(60,150,170,0.25)");
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.ellipse(x, cy, half - 4, H * 0.5 - 2, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(230,255,248,0.8)";
    for (let i = 0; i < 6; i++) {
      const a = t * 1.1 + i * 1.05;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * (half - 12) * (0.4 + 0.5 * ((i * 0.37) % 1)), cy + Math.sin(a * 1.3) * (H * 0.4), 1.4, 0, TAU);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = "rgba(28,24,18,0.82)";
    ctx.beginPath();
    ctx.ellipse(x, cy, half - 4, H * 0.5 - 2, 0, 0, TAU);
    ctx.fill();
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const arc = () => {
    ctx.beginPath();
    ctx.moveTo(x - half, y);
    ctx.lineTo(x - half, y - H * 0.55);
    ctx.arc(x, y - H * 0.55, half, Math.PI, TAU);
    ctx.lineTo(x + half, y);
  };
  ctx.strokeStyle = "#2c1d12";
  ctx.lineWidth = 10;
  arc();
  ctx.stroke();
  ctx.strokeStyle = "#7a5636";
  ctx.lineWidth = 6;
  arc();
  ctx.stroke();
  ctx.strokeStyle = "rgba(220,180,120,0.5)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x - half - 1, y);
  ctx.lineTo(x - half - 1, y - H * 0.55);
  ctx.arc(x, y - H * 0.55, half + 1, Math.PI, Math.PI * 1.55);
  ctx.stroke();
  // vines + leaves climbing the posts
  ctx.strokeStyle = "#3f7a3a";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (const s of [-1, 1]) {
    ctx.moveTo(x + s * (half + 3), y);
    ctx.bezierCurveTo(x + s * (half + 9), y - H * 0.2, x + s * (half - 4), y - H * 0.35, x + s * (half + 3), y - H * 0.55);
  }
  ctx.stroke();
  ctx.fillStyle = "#68b24b";
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.ellipse(x + s * (half + 4 + (k % 2) * 4), y - 10 - k * 13, 4.2, 2, s * 0.8, 0, TAU);
      ctx.fill();
    }
  }
  if (o.locked) {
    ctx.strokeStyle = "#4d8a3c";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(x - half + 4, y - H * 0.8);
    ctx.bezierCurveTo(x - 10, y - H * 0.45, x + 10, y - H * 0.6, x + half - 4, y - H * 0.18);
    ctx.moveTo(x + half - 4, y - H * 0.82);
    ctx.bezierCurveTo(x + 10, y - H * 0.5, x - 10, y - H * 0.4, x - half + 4, y - H * 0.16);
    ctx.stroke();
    const rg = 0.5 + Math.sin(t * 2) * 0.25;
    ctx.fillStyle = `rgba(255,200,90,${rg})`;
    ctx.beginPath();
    ctx.arc(x, cy, 5, 0, TAU);
    ctx.fill();
  }
  // label (kept fully on screen while its gate is in view)
  if (x > -30 && x < v.W + 30) {
    ctx.font = "bold 12px system-ui, sans-serif";
    const label = o.label;
    const tw = ctx.measureText(label).width;
    const pw = tw + 22;
    const lx = clamp(x, pw / 2 + 8, v.W - pw / 2 - 8);
    drawPanel(ctx, lx - pw / 2, y - H - 34, pw, 24, { radius: 8, border: o.locked ? "rgba(251,191,36,0.5)" : "rgba(94,234,212,0.55)" });
    ctx.fillStyle = o.locked ? "#fcd34d" : "#99f6e4";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, lx, y - H - 22);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Flowers
// ---------------------------------------------------------------------------
const FLOWER_STYLES = [
  { petal: "#fbbf24", petal2: "#f59e0b", center: "#7c2d12" },
  { petal: "#f472b6", petal2: "#db2777", center: "#fde68a" },
  { petal: "#a78bfa", petal2: "#7c3aed", center: "#fde68a" },
  { petal: "#60a5fa", petal2: "#2563eb", center: "#fef08a" },
];
export function flowerStyleIndex(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % FLOWER_STYLES.length;
}

function petalAt(ctx, hx, hy, ang, len, wid, c0, c1) {
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(ang);
  const g = ctx.createLinearGradient(0, 0, len, 0);
  g.addColorStop(0, c1);
  g.addColorStop(1, c0);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -wid, len, 0);
  ctx.quadraticCurveTo(len * 0.5, wid, 0, 0);
  ctx.fill();
  ctx.restore();
}

// f = { x, y, revived, radius, maxRadius }; o = { t, bloom, styleIdx, near,
// hold (0..1), forceRevived, player: {x,y} (screen) | null }
export function drawFlower(ctx, v, f, o) {
  const sx = f.x + v.ox;
  const sy = f.y + v.oy;
  if (sx < -90 || sx > v.W + 90) return;
  const t = o.t;
  const alive = f.revived || o.forceRevived;
  const st = FLOWER_STYLES[o.styleIdx];
  ctx.save();
  if (alive) {
    const rad = o.forceRevived ? 200 : f.radius;
    if (rad > 4 && !o.lite) {
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(sx, sy - 30, 4, sx, sy - 30, rad);
      g.addColorStop(0, "rgba(220,255,150,0.15)");
      g.addColorStop(0.6, "rgba(190,242,110,0.05)");
      g.addColorStop(1, "rgba(190,242,100,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy - 30, rad, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    const bloom = o.bloom ?? 1;
    const grow = easeOutCubic(clamp(bloom * 1.6, 0, 1));
    const sway = Math.sin(t * 1.5 + sx * 0.02) * 2.2 * grow;
    const H = 40 * grow;
    const hx = sx + sway;
    const hy = sy - H;
    ctx.strokeStyle = "#2f7a3a";
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(sx + sway * 0.2, sy - H * 0.55, hx, hy);
    ctx.stroke();
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(sx + sway * 0.12, sy - H * (s > 0 ? 0.3 : 0.5));
      ctx.rotate(s > 0 ? -0.5 : Math.PI + 0.5);
      const lg = ctx.createLinearGradient(0, 0, 14 * grow, 0);
      lg.addColorStop(0, "#2f7a3a");
      lg.addColorStop(1, "#8fd05a");
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(7 * grow, -5 * grow, 14 * grow, 0);
      ctx.quadraticCurveTo(7 * grow, 4 * grow, 0, 0);
      ctx.fill();
      ctx.restore();
    }
    const open = easeOutCubic(clamp((bloom - 0.25) / 0.75, 0, 1));
    for (let i = 0; i < 8; i++) petalAt(ctx, hx, hy, (i / 8) * TAU + t * 0.12, 10.5 * open, 4.6 * open, st.petal2, st.petal);
    for (let i = 0; i < 6; i++) petalAt(ctx, hx, hy, (i / 6) * TAU + 0.4 - t * 0.1, 7 * open, 3.4 * open, st.petal, "#fff7d6");
    const cg = ctx.createRadialGradient(hx, hy, 0, hx, hy, 4.2);
    cg.addColorStop(0, "#fffbe0");
    cg.addColorStop(1, st.center);
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(hx, hy, 3.6 * Math.max(0.3, open), 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(255,244,170,0.5)";
    for (let i = 0; i < 5; i++) {
      const u = ((t * 0.35 + i * 0.2) % 1);
      ctx.globalAlpha = Math.sin(u * Math.PI) * 0.8;
      ctx.beginPath();
      ctx.arc(hx + Math.sin(t * 1.6 + i * 2) * 7, hy - u * 30, 1.3, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else {
    // withered: charcoal, bowed, dropping petals -- but with one faint ember
    // of life at its heart so it reads as "revivable", not just dead
    ctx.fillStyle = "#141218";
    for (const [dx, dy, rot] of [[-9, 0, 0.4], [7, 1, -0.3], [-3, 1, 0.1]]) {
      ctx.beginPath();
      ctx.ellipse(sx + dx, sy + dy - 1, 3.4, 1.5, rot, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = "#1c1a1e";
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.bezierCurveTo(sx - 3, sy - 17, sx + 1, sy - 33, sx + 12, sy - 31);
    ctx.stroke();
    ctx.strokeStyle = "rgba(120,110,140,0.35)";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(sx + 1, sy);
    ctx.bezierCurveTo(sx - 2, sy - 17, sx + 2, sy - 33, sx + 12, sy - 31);
    ctx.stroke();
    ctx.fillStyle = "#26222a";
    ctx.beginPath();
    ctx.moveTo(sx - 1, sy - 11);
    ctx.quadraticCurveTo(sx - 12, sy - 15, sx - 14, sy - 6);
    ctx.quadraticCurveTo(sx - 6, sy - 9, sx - 1, sy - 11);
    ctx.fill();
    const hx = sx + 13;
    const hy = sy - 29;
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * 0.5 + (i - 2.5) * 0.42;
      petalAt(ctx, hx, hy, a, 8.5, 3.2, "#1d1a21", "#2c2833");
    }
    ctx.fillStyle = "#15131a";
    ctx.beginPath();
    ctx.arc(hx, hy, 3.4, 0, TAU);
    ctx.fill();
    const em = 0.18 + 0.14 * Math.sin(t * 2.3 + sx);
    ctx.globalCompositeOperation = "lighter";
    const eg = ctx.createRadialGradient(hx, hy, 0, hx, hy, 11);
    eg.addColorStop(0, `rgba(255,140,70,${em + 0.1})`);
    eg.addColorStop(1, "rgba(255,140,70,0)");
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.arc(hx, hy, 11, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    const hx2 = sx + 13;
    const hy2 = sy - 29;
    if (o.near) {
      if (o.hold > 0) {
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(hx2, hy2, 18, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = "#d9f26a";
        ctx.lineWidth = 3.4;
        ctx.beginPath();
        ctx.arc(hx2, hy2, 18, -Math.PI / 2, -Math.PI / 2 + TAU * o.hold);
        ctx.stroke();
        if (o.player) {
          ctx.globalCompositeOperation = "lighter";
          for (let i = 0; i < 7; i++) {
            const u = (t * 1.5 + i / 7) % 1;
            const mx = o.player.x + (hx2 - o.player.x) * u;
            const my = o.player.y + (hy2 - o.player.y) * u - Math.sin(u * Math.PI) * 26;
            ctx.fillStyle = `rgba(220,255,140,${Math.sin(u * Math.PI) * 0.9})`;
            ctx.beginPath();
            ctx.arc(mx, my, 2.2, 0, TAU);
            ctx.fill();
          }
          ctx.globalCompositeOperation = "source-over";
        }
      } else {
        // keyboards show a key-cap; touch screens name the on-screen button
        const pw = o.touch ? 118 : 94;
        drawPanel(ctx, hx2 - pw / 2, hy2 - 54, pw, 28, { radius: 8 });
        const kw = o.touch ? -8 : drawKeyCap(ctx, hx2 - pw / 2 + 8, hy2 - 50, "R");
        ctx.font = "bold 12px system-ui, sans-serif";
        ctx.fillStyle = "#e7f6c8";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(o.touch ? "Hold REVIVE" : "Hold", hx2 - pw / 2 + 16 + kw, hy2 - 39);
      }
    }
  }
  ctx.restore();
}
