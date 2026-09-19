import { POSE, toCanvasCoords } from "./utils.js?v=5";
import { createRoomChannel, subscribeRoom, closeRoom, countPresence, generateRoomCode } from "./multiplayer.js?v=3";

const BALL_SRC = "Asset/football/PNG/Equipment/ball_soccer1.png";
const KEEPER_SRC = {
  ready: "Asset/kenney_platformer-characters/PNG/Player/Poses/player_duck.png",
  dive: "Asset/kenney_platformer-characters/PNG/Player/Poses/player_jump.png",
};

const VISIBILITY_MIN = 0.4;
const COUNTDOWN_SECONDS = 3;
const JOIN_TIMEOUT_MS = 45000;

const LIVES = 3;
const SHOTS_PER_LEVEL = 3;
const KICKS_PER_PLAYER = 5; // multiplayer: standard shootout length before sudden death
const WINDUP_MS = 650;
const RESULT_MS = 850;
const MISS_MS = 900; // "skied it over the bar" cutscene for a wrong answer
const BASE_FLIGHT_MS = 1150;
const FLIGHT_MS_PER_LEVEL = 95;
const MIN_FLIGHT_MS = 430;
const SAVE_RADIUS = 46;
const GLOVE_SIZE = 36;
const KICK_RESULT_TIMEOUT_MS = 4000; // shooter-side safety fallback if a kick-result message never arrives

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function loadSprite(src) {
  const img = new Image();
  const sprite = { img, loaded: false };
  img.onload = () => {
    sprite.loaded = true;
  };
  img.src = src;
  return sprite;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const MIN_GRADE = 1;
const MAX_GRADE = 8;
const DEFAULT_GRADE = 4;
const GRADE_STORAGE_KEY = "fireBox.penaltyKicks.grade.v1";

function loadStoredGrade() {
  try {
    const raw = Number(localStorage.getItem(GRADE_STORAGE_KEY));
    if (Number.isInteger(raw) && raw >= MIN_GRADE && raw <= MAX_GRADE) return raw;
  } catch {}
  return DEFAULT_GRADE;
}

function storeGrade(grade) {
  try {
    localStorage.setItem(GRADE_STORAGE_KEY, String(grade));
  } catch {}
}

// Difficulty profile per grade level -- operations and number ranges roughly
// matching typical grade-school math curricula. Multiplication/division tables
// widen with grade; division facts are always constructed to divide evenly.
function gradeProfile(grade) {
  switch (grade) {
    case 1:
      return { ops: ["+", "-"], addMax: 10 };
    case 2:
      return { ops: ["+", "-"], addMax: 20 };
    case 3:
      return { ops: ["+", "-", "×"], addMax: 100, mulA: [2, 5], mulB: [2, 10] };
    case 4:
      return { ops: ["+", "-", "×", "÷"], addMax: 100, mulA: [2, 10], mulB: [2, 10], divDivisor: [2, 10], divQuotient: [2, 10] };
    case 5:
      return { ops: ["+", "-", "×", "÷"], addMax: 1000, mulA: [2, 12], mulB: [2, 12], divDivisor: [2, 12], divQuotient: [2, 12] };
    case 6:
      return { ops: ["+", "-", "×", "÷"], addMax: 1000, mulA: [11, 20], mulB: [2, 9], divDivisor: [2, 12], divQuotient: [2, 20] };
    case 7:
      return { ops: ["+", "-", "×", "÷"], addMax: 5000, mulA: [11, 25], mulB: [11, 25], divDivisor: [2, 20], divQuotient: [2, 30] };
    default:
      return { ops: ["+", "-", "×", "÷"], addMax: 10000, mulA: [12, 30], mulB: [12, 30], divDivisor: [2, 25], divQuotient: [2, 40] };
  }
}

function generateQuestion(grade) {
  const p = gradeProfile(grade);
  const op = p.ops[Math.floor(Math.random() * p.ops.length)];
  let a, b, answer;
  if (op === "+") {
    a = randInt(1, p.addMax);
    b = randInt(1, p.addMax);
    answer = a + b;
  } else if (op === "-") {
    a = randInt(1, p.addMax);
    b = randInt(0, a);
    answer = a - b;
  } else if (op === "×") {
    a = randInt(p.mulA[0], p.mulA[1]);
    b = randInt(p.mulB[0], p.mulB[1]);
    answer = a * b;
  } else {
    const divisor = randInt(p.divDivisor[0], p.divDivisor[1]);
    const quotient = randInt(p.divQuotient[0], p.divQuotient[1]);
    a = divisor * quotient;
    b = divisor;
    answer = quotient;
  }

  const scale = Math.max(1, Math.round(answer * 0.1));
  const distractorPool = shuffle([-2 * scale, -scale, -10, -5, -2, -1, 1, 2, 5, 10, scale, 2 * scale]);
  const seen = new Set([answer]);
  const distractors = [];
  for (const off of distractorPool) {
    if (distractors.length >= 3) break;
    const cand = answer + off;
    if (cand < 0 || seen.has(cand)) continue;
    seen.add(cand);
    distractors.push(cand);
  }
  let guard = 0;
  while (distractors.length < 3 && guard < 30) {
    guard += 1;
    const cand = Math.max(0, answer + randInt(-scale * 2 - 12, scale * 2 + 12));
    if (!seen.has(cand)) {
      seen.add(cand);
      distractors.push(cand);
    }
  }

  return {
    text: `${a} ${op} ${b} = ?`,
    answer,
    choices: shuffle([answer, ...distractors]),
  };
}

function layoutQuestionButtons(canvas) {
  const btnW = Math.min(180, canvas.width * 0.22);
  const btnH = 64;
  const gapX = 24;
  const gapY = 18;
  const totalW = btnW * 2 + gapX;
  const startX = canvas.width / 2 - totalW / 2;
  const startY = canvas.height * 0.58;
  const rects = [];
  for (let i = 0; i < 4; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    rects.push({
      index: i,
      x: startX + col * (btnW + gapX),
      y: startY + row * (btnH + gapY),
      w: btnW,
      h: btnH,
    });
  }
  return rects;
}

function layoutAimTargets(canvas) {
  const zoneW = canvas.width / 3;
  const y = canvas.height * 0.7;
  const h = canvas.height * 0.12;
  return [0, 1, 2].map((i) => ({
    index: i,
    x: zoneW * i,
    y,
    w: zoneW,
    h,
    cx: zoneW * (i + 0.5),
    cy: y + h / 2,
  }));
}

// A dark padded goalkeeper glove -- duplicated from goalkeeperGame.js (this
// project's convention is to keep small per-file drawing helpers self
// contained rather than sharing a utils module for them).
function drawGlove(ctx, x, y, side) {
  const sign = side === "left" ? -1 : 1;
  const R = GLOVE_SIZE;

  ctx.save();
  ctx.translate(x, y);

  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.7);
  glow.addColorStop(0, "rgba(0,0,0,0.3)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.7, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  const cuffGrad = ctx.createLinearGradient(-R * 0.42, 0, R * 0.42, 0);
  cuffGrad.addColorStop(0, "#c2410c");
  cuffGrad.addColorStop(0.5, "#fb923c");
  cuffGrad.addColorStop(1, "#c2410c");
  ctx.fillStyle = cuffGrad;
  ctx.fillRect(-R * 0.42, R * 0.82, R * 0.84, R * 0.5);
  ctx.strokeStyle = "#7c2d12";
  ctx.lineWidth = 2;
  ctx.strokeRect(-R * 0.42, R * 0.82, R * 0.84, R * 0.5);
  ctx.strokeStyle = "rgba(124,45,18,0.6)";
  ctx.lineWidth = 1;
  for (const cy of [R * 0.95, R * 1.12]) {
    ctx.beginPath();
    ctx.moveTo(-R * 0.42, cy);
    ctx.lineTo(R * 0.42, cy);
    ctx.stroke();
  }

  const thumbX = sign * R * 0.7;
  const thumbGrad = ctx.createLinearGradient(thumbX - R * 0.3, 0, thumbX + R * 0.3, 0);
  thumbGrad.addColorStop(0, sign < 0 ? "#3f3f46" : "#18181b");
  thumbGrad.addColorStop(1, sign < 0 ? "#18181b" : "#3f3f46");
  ctx.beginPath();
  ctx.ellipse(thumbX, R * 0.08, R * 0.3, R * 0.46, sign * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = thumbGrad;
  ctx.fill();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(thumbX, R * 0.08, R * 0.3, R * 0.46, sign * 0.55, -0.3, 0.3);
  ctx.stroke();

  const palmGrad = ctx.createRadialGradient(-R * 0.2, -R * 0.3, R * 0.1, 0, 0, R);
  palmGrad.addColorStop(0, "#6b7280");
  palmGrad.addColorStop(0.55, "#3f3f46");
  palmGrad.addColorStop(1, "#101014");
  ctx.beginPath();
  ctx.ellipse(0, -R * 0.05, R * 0.76, R * 0.95, 0, 0, Math.PI * 2);
  ctx.fillStyle = palmGrad;
  ctx.fill();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -R * 0.95);
  ctx.lineTo(0, R * 0.7);
  ctx.stroke();

  for (let i = 0; i < 4; i++) {
    const fx = (-1.5 + i) * R * 0.34;
    const fLen = R * (i === 1 || i === 2 ? 0.62 : 0.5);
    const fTipY = -R * 0.7 - fLen * 0.3;
    const fGrad = ctx.createLinearGradient(fx - R * 0.15, 0, fx + R * 0.15, 0);
    fGrad.addColorStop(0, "#3f3f46");
    fGrad.addColorStop(1, "#18181b");
    ctx.beginPath();
    ctx.ellipse(fx, fTipY, R * 0.15, fLen * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = fGrad;
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(fx - R * 0.15, fTipY);
    ctx.lineTo(fx + R * 0.15, fTipY);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,255,255,0.16)";
  for (let gy = -0.4; gy <= 0.5; gy += 0.32) {
    for (let gx = -0.4; gx <= 0.4; gx += 0.32) {
      ctx.beginPath();
      ctx.arc(gx * R, gy * R, R * 0.055, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const sheen = ctx.createRadialGradient(-R * 0.32, -R * 0.55, 0, -R * 0.32, -R * 0.55, R * 0.4);
  sheen.addColorStop(0, "rgba(255,255,255,0.35)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.beginPath();
  ctx.ellipse(-R * 0.32, -R * 0.55, R * 0.38, R * 0.28, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = sheen;
  ctx.fill();

  ctx.restore();
}

function getHandPoint(landmarks, idx, canvasWidth, canvasHeight) {
  return toCanvasCoords(landmarks[idx], canvasWidth, canvasHeight);
}

export function createPenaltyKicksGame({ canvas, ctx, getPlayerName }) {
  const ballSprite = loadSprite(BALL_SRC);
  const keeperSprites = {
    ready: loadSprite(KEEPER_SRC.ready),
    dive: loadSprite(KEEPER_SRC.dive),
  };

  const sfxGoal = new Audio("balloon_pop.mp3");
  const sfxMiss = new Audio("explosion_bomb.mp3");
  const sfxGameOver = new Audio("game_over.mp3");
  sfxGoal.volume = 0.7;
  sfxMiss.volume = 0.7;
  sfxGameOver.volume = 0.8;

  function playSound(audio) {
    try {
      audio.currentTime = 0;
      audio.play().catch((err) => console.warn("Sound effect failed to play:", audio.src, err));
    } catch (err) {
      console.warn("Sound effect failed to play:", audio.src, err);
    }
  }

  function primeAudio() {
    for (const audio of [sfxGoal, sfxMiss, sfxGameOver]) {
      const playPromise = audio.play();
      if (playPromise && playPromise.then) {
        playPromise
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
          })
          .catch((err) => console.warn("Could not unlock audio for", audio.src, err));
      }
    }
  }

  // ---- shared state ----
  let mode = "offline"; // "offline" | "online" -- default so drawBackground() is safe before any lobby choice
  let isPlaying = false;
  let phase = "question";
  let phaseTimer = 0;
  let flightMs = BASE_FLIGHT_MS;
  let ball = null;
  let zoneIndex = -1;
  let question = null;
  let particles = [];
  let floaters = [];
  let shake = 0;

  // ---- single-player state ----
  let score, lives, level, shotsThisLevel;
  let aiKeeperGuess = 1;
  let pendingOutcomeScored = false;
  let pendingOutcomeReason = "goal";

  // ---- math difficulty (persists across sessions via localStorage) ----
  let selectedGrade = loadStoredGrade();

  // ---- multiplayer state ----
  let channel = null;
  let myId = null;
  let myName = "Guest";
  let isHost = false;
  let roomCode = null;
  let opponentId = null;
  let pendingOnReady = null;
  let kickNumber = 1;
  let myGoals = 0;
  let opponentGoals = 0;
  let matchOver = false;
  let matchResult = null;
  let awaitingTimer = 0;

  // ---- multiplayer keeper-role hand-tracking gate (same pattern as Shot Stopper) ----
  let handsReady = false;
  let countdown = 0;

  function myRoleForKick(n) {
    const hostShoots = n % 2 === 1;
    return isHost === hostShoots ? "shooter" : "keeper";
  }

  function isRoundBoundary(n) {
    return n % 2 === 0 && n >= KICKS_PER_PLAYER * 2;
  }

  // ---------------- geometry: shooter's point-of-view (new) ----------------

  function distantGoalRect() {
    return {
      left: canvas.width * 0.3,
      right: canvas.width * 0.7,
      top: canvas.height * 0.3,
      bottom: canvas.height * 0.58,
    };
  }

  function distantZonesX() {
    const rect = distantGoalRect();
    const w = rect.right - rect.left;
    return [rect.left + w * 0.16, rect.left + w * 0.5, rect.left + w * 0.84];
  }

  function shooterFootPos() {
    return { x: canvas.width / 2, y: canvas.height * 0.92 };
  }

  // ---------------- geometry: keeper's point-of-view (Shot Stopper, verbatim) ----------------

  function postInset() {
    return canvas.width * 0.055;
  }

  function crossbarY() {
    return canvas.height * 0.06;
  }

  function zonesX() {
    const left = postInset();
    const right = canvas.width - postInset();
    const w = right - left;
    return [left + w * 0.16, left + w * 0.5, left + w * 0.84];
  }

  function goalLineY() {
    return canvas.height * 0.82;
  }

  function keeperShooterPos() {
    return { x: canvas.width / 2, y: canvas.height * 0.36 };
  }

  function currentFlightMs() {
    return Math.max(MIN_FLIGHT_MS, BASE_FLIGHT_MS - (level - 1) * FLIGHT_MS_PER_LEVEL);
  }

  function flightMsForRound(round) {
    return Math.max(MIN_FLIGHT_MS, BASE_FLIGHT_MS - (round - 1) * FLIGHT_MS_PER_LEVEL);
  }

  // ---------------- particles/floaters (shared) ----------------

  function spawnBurst(x, y, color, count = 14) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const speed = 2 + Math.random() * 2.5;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: 3 + Math.random() * 2,
        color,
        life: 26,
        maxLife: 26,
      });
    }
  }

  function addFloater(x, y, text, color, big) {
    floaters.push({ x, y, text, color, big, life: 46, maxLife: 46 });
  }

  function drawParticlesAndFloaters() {
    for (const p of particles) {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const f of floaters) {
      ctx.globalAlpha = Math.min(1, f.life / 15);
      ctx.fillStyle = f.color;
      ctx.font = f.big ? "bold 40px system-ui, sans-serif" : "bold 20px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------- ball ----------------

  function drawBallGeneric(b) {
    if (!b) return;
    const dx = b.endX - b.startX;
    const dy = b.endY - b.startY;
    const dist = Math.hypot(dx, dy) || 1;
    const backX = -dx / dist;
    const backY = -dy / dist;
    ctx.save();
    ctx.globalAlpha = 0.28;
    const streak = ctx.createLinearGradient(b.x, b.y, b.x + backX * b.r * 4, b.y + backY * b.r * 4);
    streak.addColorStop(0, "rgba(255,255,255,0.8)");
    streak.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = streak;
    ctx.lineWidth = b.r * 0.9;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x + backX * b.r * 4, b.y + backY * b.r * 4);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, b.r * 0.9, b.r * 0.8, b.r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();

    if (ballSprite.loaded) {
      const d = b.r * 2;
      ctx.drawImage(ballSprite.img, -d / 2, -d / 2, d, d);
    } else {
      const ballGrad = ctx.createRadialGradient(-b.r * 0.35, -b.r * 0.35, b.r * 0.1, 0, 0, b.r);
      ballGrad.addColorStop(0, "#ffffff");
      ballGrad.addColorStop(0.7, "#f1f5f9");
      ballGrad.addColorStop(1, "#cbd5e1");
      ctx.beginPath();
      ctx.arc(0, 0, b.r, 0, Math.PI * 2);
      ctx.fillStyle = ballGrad;
      ctx.fill();
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = Math.max(1, b.r * 0.08);
      ctx.stroke();
    }
    ctx.restore();
  }

  function makeShooterBall() {
    const foot = shooterFootPos();
    const zones = distantZonesX();
    const rect = distantGoalRect();
    return {
      startX: foot.x,
      startY: foot.y,
      endX: zones[zoneIndex],
      endY: rect.bottom - (rect.bottom - rect.top) * 0.2,
      x: foot.x,
      y: foot.y,
      r: 22,
    };
  }

  function updateBallShooterView(t) {
    ball.x = ball.startX + (ball.endX - ball.startX) * t;
    ball.y = ball.startY + (ball.endY - ball.startY) * t;
    ball.r = 22 - 17 * t;
  }

  function makeKeeperBall(idx) {
    const start = keeperShooterPos();
    const zones = zonesX();
    return {
      startX: start.x,
      startY: start.y,
      endX: zones[idx],
      endY: goalLineY(),
      x: start.x,
      y: start.y,
      r: 7,
    };
  }

  function updateBallKeeperView(t) {
    ball.x = ball.startX + (ball.endX - ball.startX) * t;
    ball.y = ball.startY + (ball.endY - ball.startY) * t;
    ball.r = 7 + 17 * t;
  }

  // ---------------- stadium / pitch / goal (shared stadium, two pitch/goal framings) ----------------

  function drawNetPanel(x, y, w, h, darkEdge) {
    if (w <= 0 || h <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    const shade = ctx.createLinearGradient(
      darkEdge === "left" ? x + w : x,
      darkEdge === "top" ? y + h : y,
      darkEdge === "left" ? x : darkEdge === "right" ? x + w : x,
      darkEdge === "top" ? y : y + h
    );
    shade.addColorStop(0, "rgba(15,23,42,0.5)");
    shade.addColorStop(1, "rgba(15,23,42,0.78)");
    ctx.fillStyle = shade;
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    const step = 12;
    const span = w + h;
    for (let i = -span; i < span; i += step) {
      ctx.beginPath();
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i - h, y + h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i + h, y + h);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPost(x, y, w, h) {
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(x, y, w, h);
    const highlight = ctx.createLinearGradient(x, 0, x + w, 0);
    highlight.addColorStop(0, "rgba(255,255,255,0)");
    highlight.addColorStop(0.5, "rgba(255,255,255,0.9)");
    highlight.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = highlight;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(100,116,139,0.6)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }

  function drawStadium() {
    const w = canvas.width;
    const horizon = canvas.height * 0.34;

    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#7dd3fc");
    sky.addColorStop(1, "#bae6fd");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon);

    const roofTop = horizon * 0.14;
    const standsTop = horizon * 0.3;

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, roofTop, w, standsTop - roofTop);
    ctx.fillStyle = "rgba(148,163,184,0.4)";
    ctx.fillRect(0, standsTop - 3, w, 3);

    const standGrad = ctx.createLinearGradient(0, standsTop, 0, horizon);
    standGrad.addColorStop(0, "#1e293b");
    standGrad.addColorStop(1, "#0f172a");
    ctx.fillStyle = standGrad;
    ctx.fillRect(0, standsTop, w, horizon - standsTop);

    const rows = 6;
    for (let r = 0; r < rows; r++) {
      const y = standsTop + ((horizon - standsTop) * (r + 0.5)) / rows;
      const count = 58;
      const dotR = 1.6 + (rows - r) * 0.25;
      for (let i = 0; i < count; i++) {
        const x = (w / count) * (i + 0.5) + Math.sin(i * 12.9 + r * 3.1) * 3;
        const hue = (i * 47 + r * 91) % 360;
        const light = 42 + (r % 2) * 14 + ((i * 7) % 10);
        ctx.fillStyle = `hsl(${hue}, 50%, ${light}%)`;
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const fx of [w * 0.06, w * 0.94]) {
      const lampY = roofTop - 6;
      const beam = ctx.createRadialGradient(fx, lampY, 0, fx, lampY, 30);
      beam.addColorStop(0, "rgba(255,251,235,0.55)");
      beam.addColorStop(1, "rgba(255,251,235,0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.arc(fx, lampY, 30, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#94a3b8";
      ctx.fillRect(fx - 3, lampY, 6, standsTop - lampY);
      for (const [ox, oy] of [
        [-6, -8],
        [6, -8],
        [0, -12],
      ]) {
        ctx.fillStyle = "#fefce8";
        ctx.beginPath();
        ctx.arc(fx + ox, lampY + oy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const boardColors = ["#dc2626", "#2563eb", "#f59e0b", "#16a34a", "#7c3aed"];
    const segW = w / 9;
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = boardColors[i % boardColors.length];
      ctx.fillRect(i * segW, horizon - 16, segW - 2, 16);
    }

    return horizon;
  }

  // Keeper-view pitch: identical to Shot Stopper's -- a wide near edge
  // converging toward the horizon, matching "standing on the goal line".
  function drawPitchFar(horizon) {
    const w = canvas.width;
    const h = canvas.height;
    const grad = ctx.createLinearGradient(0, horizon, 0, h);
    grad.addColorStop(0, "#15803d");
    grad.addColorStop(1, "#22c55e");
    ctx.fillStyle = grad;
    ctx.fillRect(0, horizon, w, h - horizon);

    const stripes = 7;
    for (let i = 0; i < stripes; i++) {
      const tTop = i / stripes;
      const tBot = (i + 1) / stripes;
      const yTop = horizon + (h - horizon) * (tTop * tTop);
      const yBot = horizon + (h - horizon) * (tBot * tBot);
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
      ctx.fillRect(0, yTop, w, yBot - yTop);
    }

    const nearW = w * 0.82;
    const farW = w * 0.42;
    const boxTop = horizon + (h - horizon) * 0.06;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo((w - nearW) / 2, h);
    ctx.lineTo((w - farW) / 2, boxTop);
    ctx.lineTo((w + farW) / 2, boxTop);
    ctx.lineTo((w + nearW) / 2, h);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(w / 2, horizon + (h - horizon) * 0.14, w * 0.16, (h - horizon) * 0.05, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.arc(w / 2, horizon + (h - horizon) * 0.32, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Shooter-view pitch: grass fills the foreground where the shooter stands;
  // the penalty box narrows toward the small, distant goal instead of
  // widening toward the viewer.
  function drawPitchNear(horizon) {
    const w = canvas.width;
    const h = canvas.height;
    const grad = ctx.createLinearGradient(0, horizon, 0, h);
    grad.addColorStop(0, "#16a34a");
    grad.addColorStop(1, "#22c55e");
    ctx.fillStyle = grad;
    ctx.fillRect(0, horizon, w, h - horizon);

    const stripes = 9;
    for (let i = 0; i < stripes; i++) {
      const yTop = horizon + ((h - horizon) * i) / stripes;
      const yBot = horizon + ((h - horizon) * (i + 1)) / stripes;
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
      ctx.fillRect(0, yTop, w, yBot - yTop);
    }

    const rect = distantGoalRect();
    const boxFarW = (rect.right - rect.left) * 1.2;
    const boxNearW = w * 0.55;
    const boxTop = rect.bottom;
    const boxBottom = rect.bottom + (h - rect.bottom) * 0.4;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w / 2 - boxFarW / 2, boxTop);
    ctx.lineTo(w / 2 - boxNearW / 2, boxBottom);
    ctx.lineTo(w / 2 + boxNearW / 2, boxBottom);
    ctx.lineTo(w / 2 + boxFarW / 2, boxTop);
    ctx.closePath();
    ctx.stroke();

    const spot = shooterFootPos();
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.beginPath();
    ctx.arc(spot.x, spot.y - 6, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGoalFar() {
    const w = canvas.width;
    const h = canvas.height;
    const inset = postInset();
    const postW = w * 0.022;
    const barY = crossbarY();

    drawNetPanel(0, 0, w, barY, "top");
    drawNetPanel(0, barY, inset, h - barY, "left");
    drawNetPanel(w - inset, barY, inset, h - barY, "right");

    for (const px of [inset - postW / 2, w - inset + postW / 2]) {
      const shadow = ctx.createRadialGradient(px, h - 6, 0, px, h - 6, postW * 3);
      shadow.addColorStop(0, "rgba(0,0,0,0.35)");
      shadow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = shadow;
      ctx.beginPath();
      ctx.ellipse(px, h - 6, postW * 3, postW, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    drawPost(0, barY - postW, w, postW);
    drawPost(inset - postW, barY, postW, h - barY);
    drawPost(w - inset, barY, postW, h - barY);
  }

  function drawGoalNear() {
    const rect = distantGoalRect();
    const postW = Math.max(3, canvas.width * 0.008);
    const innerH = rect.bottom - rect.top;

    drawNetPanel(rect.left, rect.top, rect.right - rect.left, innerH, "top");

    const shadow = ctx.createRadialGradient(canvas.width / 2, rect.bottom + 4, 0, canvas.width / 2, rect.bottom + 4, (rect.right - rect.left) * 0.5);
    shadow.addColorStop(0, "rgba(0,0,0,0.3)");
    shadow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(canvas.width / 2, rect.bottom + 4, (rect.right - rect.left) * 0.5, postW * 2, 0, 0, Math.PI * 2);
    ctx.fill();

    drawPost(rect.left - postW, rect.top - postW, postW, innerH + postW * 2);
    drawPost(rect.right, rect.top - postW, postW, innerH + postW * 2);
    drawPost(rect.left - postW, rect.top - postW, rect.right - rect.left + postW * 2, postW);
  }

  function drawBackground() {
    const role = mode === "online" ? myRoleForKick(kickNumber) : "shooter";
    const horizon = drawStadium();
    if (role === "keeper") {
      drawPitchFar(horizon);
    } else {
      drawPitchNear(horizon);
    }
  }

  // ---------------- AI keeper (single-player only) ----------------

  function computeSaveChance(guessIdx, actualIdx, lvl) {
    if (guessIdx === actualIdx) return Math.min(0.92, 0.78 + (lvl - 1) * 0.04);
    if (guessIdx === 1 || actualIdx === 1) return Math.min(0.18, 0.1 + (lvl - 1) * 0.02);
    return 0;
  }

  function drawAiKeeper() {
    const rect = distantGoalRect();
    const zones = distantZonesX();
    let targetX = zones[1];
    let sprite = keeperSprites.ready;
    let rot = 0;
    if (phase === "flying" || phase === "result") {
      targetX = zones[aiKeeperGuess];
      sprite = aiKeeperGuess === 1 ? keeperSprites.ready : keeperSprites.dive;
      rot = aiKeeperGuess === 0 ? -0.85 : aiKeeperGuess === 2 ? 0.85 : 0;
    }
    if (!sprite.loaded) return;
    const h = (rect.bottom - rect.top) * 0.95;
    const w = h * (sprite.img.naturalWidth / sprite.img.naturalHeight);
    ctx.save();
    ctx.translate(targetX, rect.bottom - h * 0.42);
    ctx.rotate(rot);
    ctx.drawImage(sprite.img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  // ---------------- hand tracking gate (multiplayer keeper role) ----------------

  function handsVisible(landmarks) {
    if (!landmarks) return false;
    const isVisible = (l) => !!l && (l.visibility === undefined || l.visibility > VISIBILITY_MIN);
    return isVisible(landmarks[POSE.LEFT_WRIST]) && isVisible(landmarks[POSE.RIGHT_WRIST]);
  }

  function drawHandsNeededOverlay() {
    ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center";
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.fillText("🧤 Move back from the camera", canvas.width / 2, canvas.height / 2 - 16);
    ctx.fillText("so both hands are visible", canvas.width / 2, canvas.height / 2 + 20);
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText("Your turn to keep goal starts automatically once we can see them", canvas.width / 2, canvas.height / 2 + 54);
  }

  function drawCountdownOverlay() {
    ctx.fillStyle = "rgba(15, 23, 42, 0.35)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center";
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 120px system-ui, sans-serif";
    ctx.fillText(String(Math.ceil(countdown)), canvas.width / 2, canvas.height / 2 + 40);
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.fillText("Get ready to save!", canvas.width / 2, canvas.height / 2 + 100);
  }

  // ---------------- question / aim / waiting overlays ----------------

  function drawQuestionOverlay() {
    ctx.fillStyle = "rgba(15,23,42,0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center";
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.fillText("Answer to choose where you shoot:", canvas.width / 2, canvas.height * 0.4);
    ctx.font = "bold 44px system-ui, sans-serif";
    ctx.fillText(question.text, canvas.width / 2, canvas.height * 0.5);

    const rects = layoutQuestionButtons(canvas);
    ctx.font = "bold 26px system-ui, sans-serif";
    for (const r of rects) {
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 10);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 2;
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 10);
      ctx.stroke();
      ctx.fillStyle = "#f8fafc";
      ctx.fillText(String(question.choices[r.index]), r.x + r.w / 2, r.y + r.h / 2 + 9);
    }
  }

  function drawAimButtons() {
    ctx.textAlign = "center";
    const zones = layoutAimTargets(canvas);
    const labels = ["⬅ Left", "🎯 Center", "Right ➡"];
    for (const z of zones) {
      ctx.fillStyle = "rgba(15,23,42,0.5)";
      roundRectPath(ctx, z.x + 8, z.y, z.w - 16, z.h, 12);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 2;
      roundRectPath(ctx, z.x + 8, z.y, z.w - 16, z.h, 12);
      ctx.stroke();
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 22px system-ui, sans-serif";
      ctx.fillText(labels[z.index], z.cx, z.cy + 8);
    }
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText("Pick your spot!", canvas.width / 2, canvas.height * 0.66);
  }

  function drawWaitingOverlay(text) {
    ctx.fillStyle = "rgba(15,23,42,0.4)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center";
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 24px system-ui, sans-serif";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }

  function drawSkiedCutscene() {
    const t = 1 - clamp(phaseTimer, 0, MISS_MS) / MISS_MS;
    const foot = shooterFootPos();
    const y = foot.y - t * canvas.height * 0.9;
    const x = foot.x + Math.sin(t * 3) * 20;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - t * 0.6);
    if (ballSprite.loaded) {
      const d = 26 * (1 - t * 0.4);
      ctx.drawImage(ballSprite.img, x - d / 2, y - d / 2, d, d);
    }
    ctx.restore();
    ctx.textAlign = "center";
    ctx.fillStyle = "#fca5a5";
    ctx.font = "bold 34px system-ui, sans-serif";
    ctx.fillText("OVER THE BAR!", canvas.width / 2, canvas.height * 0.3);
  }

  function drawOpponentMissedOverlay() {
    ctx.fillStyle = "rgba(15,23,42,0.35)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center";
    ctx.fillStyle = "#fca5a5";
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.fillText("Your opponent got the question wrong!", canvas.width / 2, canvas.height * 0.42);
    ctx.font = "20px system-ui, sans-serif";
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText("Automatic miss — no save needed.", canvas.width / 2, canvas.height * 0.48);
  }

  function drawBraceOverlay() {
    ctx.textAlign = "center";
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 24px system-ui, sans-serif";
    ctx.fillText("They got it right — brace yourself!", canvas.width / 2, canvas.height * 0.16);
  }

  // ---------------- scenes ----------------

  function drawShooterScene() {
    drawGoalNear();
    if (mode === "offline") drawAiKeeper();
    if (ball && phase !== "windup" && phase !== "question") drawBallGeneric(ball);
    drawParticlesAndFloaters();

    if (phase === "question") drawQuestionOverlay();
    else if (phase === "skied") drawSkiedCutscene();
    else if (phase === "aim") drawAimButtons();
    else if (mode === "online" && phase === "mp-wait-keeper") drawWaitingOverlay("Waiting for your opponent to get ready...");
    else if (mode === "online" && phase === "awaiting-result") drawWaitingOverlay("Waiting for the result...");
  }

  function drawKeeperScene(landmarks) {
    if (phase === "mp-keeper-gate" && !handsReady) {
      drawHandsNeededOverlay();
      return;
    }

    if (ball && phase === "flying") drawBallGeneric(ball);

    if (landmarks) {
      for (const [idx, side] of [
        [POSE.LEFT_WRIST, "left"],
        [POSE.RIGHT_WRIST, "right"],
      ]) {
        const p = getHandPoint(landmarks, idx, canvas.width, canvas.height);
        drawGlove(ctx, p.x, p.y, side);
      }
    }

    drawParticlesAndFloaters();
    drawGoalFar();

    if (phase === "mp-keeper-gate" && countdown > 0) drawCountdownOverlay();
    else if (phase === "mp-keeper-wait-answer") drawWaitingOverlay("Your opponent is answering a question...");
    else if (phase === "skied") drawOpponentMissedOverlay();
    else if (phase === "mp-keeper-brace") drawBraceOverlay();
  }

  function draw(landmarks) {
    const role = mode === "online" ? myRoleForKick(kickNumber) : "shooter";
    if (role === "keeper") drawKeeperScene(landmarks);
    else drawShooterScene();
  }

  // ---------------- click / tap input (aim + question answers) ----------------

  function clickToCanvas(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.max(rect.width / canvas.width, rect.height / canvas.height);
    const offsetX = (rect.width - canvas.width * scale) / 2;
    const offsetY = (rect.height - canvas.height * scale) / 2;
    return {
      x: (clientX - rect.left - offsetX) / scale,
      y: (clientY - rect.top - offsetY) / scale,
    };
  }

  function handleClick(clientX, clientY) {
    if (!isPlaying) return;
    const { x, y } = clickToCanvas(clientX, clientY);
    if (phase === "question") {
      for (const r of layoutQuestionButtons(canvas)) {
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          submitAnswer(r.index);
          return;
        }
      }
    } else if (phase === "aim") {
      for (const z of layoutAimTargets(canvas)) {
        if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) {
          chooseZone(z.index);
          return;
        }
      }
    }
  }

  canvas.addEventListener("pointerdown", (e) => handleClick(e.clientX, e.clientY));

  // ---------------- single-player flow ----------------

  function startQuestion() {
    phase = "question";
    question = generateQuestion(selectedGrade);
    zoneIndex = -1;
  }

  function chooseZone(i) {
    if (phase !== "aim") return;
    zoneIndex = i;
    phase = "windup";
    phaseTimer = WINDUP_MS;
  }

  function submitAnswer(choiceIndex) {
    if (phase !== "question") return;
    const chosenValue = choiceIndex == null ? null : question.choices[choiceIndex];
    const correct = chosenValue === question.answer;

    if (mode === "online") {
      if (channel) channel.send({ type: "broadcast", event: "answer-result", payload: { kickNumber, correct } });
    }

    if (correct) {
      phase = "aim";
    } else {
      phase = "skied";
      phaseTimer = MISS_MS;
    }
  }

  function startFlightOffline() {
    phase = "flying";
    flightMs = currentFlightMs();
    phaseTimer = flightMs;
    aiKeeperGuess = Math.floor(Math.random() * 3);
    const saveChance = computeSaveChance(aiKeeperGuess, zoneIndex, level);
    pendingOutcomeScored = !(Math.random() < saveChance);
    pendingOutcomeReason = pendingOutcomeScored ? "goal" : "saved";
    ball = makeShooterBall();
  }

  function resolveOfflineOutcome(scored, reason) {
    phase = "result";
    phaseTimer = RESULT_MS;
    const pos = reason === "wrong-answer" ? { x: canvas.width / 2, y: canvas.height * 0.3 } : { x: ball.endX, y: ball.endY };
    if (scored) {
      score += 1;
      spawnBurst(pos.x, pos.y, "#4ade80");
      addFloater(pos.x, pos.y - 30, "GOAL!", "#4ade80", true);
      playSound(sfxGoal);
    } else {
      lives -= 1;
      const label = reason === "wrong-answer" ? "MISSED!" : "SAVED!";
      spawnBurst(pos.x, pos.y, "#ef4444");
      addFloater(pos.x, pos.y - 30, label, "#ef4444", true);
      shake = Math.max(shake, 10);
      playSound(sfxMiss);
      if (lives <= 0) playSound(sfxGameOver);
    }
    shotsThisLevel += 1;
    if (shotsThisLevel >= SHOTS_PER_LEVEL) {
      shotsThisLevel = 0;
      level += 1;
    }
  }

  function updateOffline(stepDt) {
    if (lives <= 0) return;

    switch (phase) {
      case "question":
        return; // untimed -- waits for the player to click an answer
      case "skied":
        phaseTimer -= stepDt;
        if (phaseTimer <= 0) resolveOfflineOutcome(false, "wrong-answer");
        return;
      case "aim":
        return;
      case "windup":
        phaseTimer -= stepDt;
        if (phaseTimer <= 0) startFlightOffline();
        return;
      case "flying": {
        phaseTimer -= stepDt;
        const t = clamp(1 - phaseTimer / flightMs, 0, 1);
        updateBallShooterView(t);
        if (phaseTimer <= 0) resolveOfflineOutcome(pendingOutcomeScored, pendingOutcomeReason);
        return;
      }
      case "result":
        phaseTimer -= stepDt;
        if (phaseTimer <= 0 && lives > 0) startQuestion();
        return;
    }
  }

  // ---------------- multiplayer flow ----------------

  function startNextKickPhaseForRole() {
    if (matchOver) return;
    handsReady = false;
    countdown = 0;
    ball = null;
    const role = myRoleForKick(kickNumber);
    phase = role === "shooter" ? "mp-wait-keeper" : "mp-keeper-gate";
  }

  function endMatch(won) {
    matchOver = true;
    matchResult = { won };
    if (channel) {
      channel.send({ type: "broadcast", event: "match-over", payload: { winnerId: won ? myId : opponentId } });
    }
  }

  function applyKickResult(payload) {
    if (mode !== "online" || matchOver) return;
    if (!payload || payload.kickNumber !== kickNumber) return; // stale or self-echo, already advanced past it

    const role = myRoleForKick(kickNumber);
    if (role === "shooter") {
      if (payload.scored) myGoals += 1;
    } else if (payload.scored) {
      opponentGoals += 1;
    }

    phase = "result";
    phaseTimer = RESULT_MS;
    const pos = payload.reason === "wrong-answer" || !ball ? { x: canvas.width / 2, y: canvas.height * 0.3 } : { x: ball.endX, y: ball.endY };
    if (payload.scored) {
      spawnBurst(pos.x, pos.y, "#4ade80");
      addFloater(pos.x, pos.y - 30, role === "shooter" ? "GOAL!" : "CONCEDED!", "#4ade80", true);
      playSound(sfxGoal);
    } else {
      const label = payload.reason === "wrong-answer" ? "MISSED!" : "SAVED!";
      spawnBurst(pos.x, pos.y, "#ef4444");
      addFloater(pos.x, pos.y - 30, label, "#ef4444", true);
      playSound(sfxMiss);
    }

    const justResolvedKick = kickNumber;
    kickNumber += 1;
    if (isRoundBoundary(justResolvedKick) && myGoals !== opponentGoals) {
      endMatch(myGoals > opponentGoals);
    }
  }

  function resolveWrongAnswerMp() {
    const payload = { kickNumber, scored: false, reason: "wrong-answer" };
    if (channel) channel.send({ type: "broadcast", event: "kick-result", payload });
    applyKickResult(payload);
  }

  function startFlightMpShooter() {
    flightMs = flightMsForRound(Math.ceil(kickNumber / 2));
    if (channel) channel.send({ type: "broadcast", event: "zone-chosen", payload: { kickNumber, zoneIndex, flightMs } });
    phase = "flying";
    phaseTimer = flightMs;
    ball = makeShooterBall();
  }

  function finalizeKeeperOutcome(saved) {
    const payload = { kickNumber, scored: !saved, reason: saved ? "saved" : "goal" };
    if (channel) channel.send({ type: "broadcast", event: "kick-result", payload });
    applyKickResult(payload);
  }

  function updateOnline(stepDt, landmarks) {
    if (matchOver) return;
    const role = myRoleForKick(kickNumber);

    if (role === "shooter") {
      switch (phase) {
        case "mp-wait-keeper":
        case "aim":
        case "question":
          return; // question is untimed -- waits for the player to click an answer
        case "skied":
          phaseTimer -= stepDt;
          if (phaseTimer <= 0) resolveWrongAnswerMp();
          return;
        case "windup":
          phaseTimer -= stepDt;
          if (phaseTimer <= 0) startFlightMpShooter();
          return;
        case "flying": {
          phaseTimer -= stepDt;
          const t = clamp(1 - phaseTimer / flightMs, 0, 1);
          updateBallShooterView(t);
          if (phaseTimer <= 0) {
            phase = "awaiting-result";
            awaitingTimer = 0;
          }
          return;
        }
        case "awaiting-result":
          awaitingTimer += stepDt;
          if (awaitingTimer > KICK_RESULT_TIMEOUT_MS) {
            applyKickResult({ kickNumber, scored: true, reason: "goal" });
          }
          return;
        case "result":
          phaseTimer -= stepDt;
          if (phaseTimer <= 0) startNextKickPhaseForRole();
          return;
      }
    } else {
      switch (phase) {
        case "mp-keeper-gate":
          if (!handsReady) {
            if (handsVisible(landmarks)) {
              handsReady = true;
              countdown = COUNTDOWN_SECONDS;
            }
            return;
          }
          if (countdown > 0) {
            countdown = Math.max(0, countdown - stepDt / 1000);
            return;
          }
          if (channel) channel.send({ type: "broadcast", event: "keeper-ready", payload: { kickNumber } });
          phase = "mp-keeper-wait-answer";
          return;
        case "mp-keeper-wait-answer":
        case "mp-keeper-brace":
          return;
        case "skied":
          phaseTimer -= stepDt;
          return;
        case "flying": {
          phaseTimer -= stepDt;
          const t = clamp(1 - phaseTimer / flightMs, 0, 1);
          updateBallKeeperView(t);
          if (landmarks) {
            for (const idx of [POSE.LEFT_WRIST, POSE.RIGHT_WRIST]) {
              const h = getHandPoint(landmarks, idx, canvas.width, canvas.height);
              if (Math.hypot(h.x - ball.x, h.y - ball.y) < SAVE_RADIUS + ball.r) {
                finalizeKeeperOutcome(true);
                return;
              }
            }
          }
          if (phaseTimer <= 0) finalizeKeeperOutcome(false);
          return;
        }
        case "result":
          phaseTimer -= stepDt;
          if (phaseTimer <= 0) startNextKickPhaseForRole();
          return;
      }
    }
  }

  function wireChannelHandlers() {
    channel.on("broadcast", { event: "keeper-ready" }, ({ payload }) => {
      if (payload.kickNumber !== kickNumber || myRoleForKick(kickNumber) !== "shooter") return;
      if (phase === "mp-wait-keeper") startQuestion();
    });

    channel.on("broadcast", { event: "answer-result" }, ({ payload }) => {
      if (payload.kickNumber !== kickNumber || myRoleForKick(kickNumber) !== "keeper") return;
      if (payload.correct) {
        phase = "mp-keeper-brace";
      } else {
        phase = "skied";
        phaseTimer = MISS_MS;
      }
    });

    channel.on("broadcast", { event: "zone-chosen" }, ({ payload }) => {
      if (payload.kickNumber !== kickNumber || myRoleForKick(kickNumber) !== "keeper") return;
      zoneIndex = payload.zoneIndex;
      flightMs = payload.flightMs;
      phase = "flying";
      phaseTimer = flightMs;
      ball = makeKeeperBall(zoneIndex);
    });

    channel.on("broadcast", { event: "kick-result" }, ({ payload }) => {
      applyKickResult(payload);
    });

    channel.on("broadcast", { event: "match-over" }, ({ payload }) => {
      if (!matchOver) {
        matchOver = true;
        matchResult = { won: payload.winnerId === myId };
      }
    });

    channel.on("broadcast", { event: "game-start" }, () => {
      if (!isHost && pendingOnReady) {
        const cb = pendingOnReady;
        pendingOnReady = null;
        cb();
      }
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      for (const key of Object.keys(state)) {
        const meta = state[key][0];
        if (meta.ownerId && meta.ownerId !== myId) opponentId = meta.ownerId;
      }
    });

    channel.on("presence", { event: "leave" }, () => {
      if (mode === "online" && isPlaying && !matchOver) {
        matchOver = true;
        matchResult = { won: true, forfeit: true };
      }
      if (window.__penaltyPresenceHook) window.__penaltyPresenceHook();
    });
  }

  // ---------------- lobby ----------------

  function renderChoiceScreen(overlayEl, onReady, onCancel) {
    const gradeOptions = [];
    for (let g = MIN_GRADE; g <= MAX_GRADE; g++) gradeOptions.push(g);
    overlayEl.innerHTML = `
      <h1>Penalty Kicks</h1>
      <p>Answer fast, aim smart, and see if the keeper can guess your corner. Play solo or challenge a friend.</p>
      <div class="selectRow">
        <label for="gradeSelect">Math question difficulty:</label>
        <select id="gradeSelect">
          ${gradeOptions.map((g) => `<option value="${g}">Grade ${g}${g === MAX_GRADE ? "+" : ""}</option>`).join("")}
        </select>
      </div>
      <button data-lobby-action="offline">Play Solo</button>
      <button class="secondary" data-lobby-action="create">Create Private Match</button>
      <button class="secondary" data-lobby-action="join">Join Private Match</button>
      <button class="auth-toggle" type="button" data-lobby-action="cancel">← Back</button>
    `;
    const gradeSelect = overlayEl.querySelector("#gradeSelect");
    gradeSelect.value = String(selectedGrade);
    gradeSelect.addEventListener("change", (e) => {
      selectedGrade = Number(e.target.value);
      storeGrade(selectedGrade);
    });
    overlayEl.querySelector('[data-lobby-action="offline"]').addEventListener("click", () => startOffline(onReady));
    overlayEl.querySelector('[data-lobby-action="create"]').addEventListener("click", () => createMatch(overlayEl, onReady, onCancel));
    overlayEl.querySelector('[data-lobby-action="join"]').addEventListener("click", () => renderJoinScreen(overlayEl, onReady, onCancel));
    overlayEl.querySelector('[data-lobby-action="cancel"]').addEventListener("click", onCancel);
  }

  function startOffline(onReady) {
    mode = "offline";
    channel = null;
    onReady();
  }

  function renderJoinScreen(overlayEl, onReady, onCancel) {
    overlayEl.innerHTML = `
      <h1>Penalty Kicks</h1>
      <form id="joinForm" class="auth-form">
        <input type="text" id="roomCodeInput" placeholder="4-digit code" maxlength="4" inputmode="numeric" required />
        <button type="submit">Join</button>
      </form>
      <button class="auth-toggle" type="button" data-lobby-action="back">← Back</button>
      <p id="joinStatus"></p>
    `;
    overlayEl.querySelector('[data-lobby-action="back"]').addEventListener("click", () => renderChoiceScreen(overlayEl, onReady, onCancel));
    overlayEl.querySelector("#joinForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = overlayEl.querySelector("#roomCodeInput").value.trim();
      if (!/^\d{4}$/.test(code)) {
        overlayEl.querySelector("#joinStatus").textContent = "Enter the 4-digit code your friend shared.";
        return;
      }
      await joinMatch(overlayEl, code, onReady, onCancel);
    });
  }

  async function createMatch(overlayEl, onReady, onCancel) {
    mode = "online";
    const code = generateRoomCode();
    myId = crypto.randomUUID();
    myName = getPlayerName ? getPlayerName() : "Guest";
    isHost = true;
    roomCode = code;

    overlayEl.innerHTML = `<h1>Penalty Kicks</h1><p>Setting up...</p>`;
    channel = createRoomChannel(code, myId, "penalty-shootout");
    wireChannelHandlers();
    await subscribeRoom(channel, { ownerId: myId, name: myName, isHost: true });
    renderWaitingRoom(overlayEl, code, onReady, onCancel, true);
  }

  async function joinMatch(overlayEl, code, onReady, onCancel) {
    mode = "online";
    myId = crypto.randomUUID();
    myName = getPlayerName ? getPlayerName() : "Guest";
    isHost = false;
    roomCode = code;

    overlayEl.innerHTML = `<h1>Penalty Kicks</h1><p>Joining...</p>`;
    channel = createRoomChannel(code, myId, "penalty-shootout");
    wireChannelHandlers();
    await subscribeRoom(channel, { ownerId: myId, name: myName, isHost: false });
    renderWaitingRoom(overlayEl, code, onReady, onCancel, false);
  }

  function renderWaitingRoom(overlayEl, code, onReady, onCancel, hostRole) {
    overlayEl.innerHTML = `
      <h1>Penalty Kicks</h1>
      <p>Room code: <span id="roomCodeValue" class="room-code">${code}</span></p>
      <div id="playerList" class="selectRow"></div>
      <p id="waitStatus">${hostRole ? "Waiting for your opponent to join..." : "Waiting for the host to start..."}</p>
      ${hostRole ? `<button data-lobby-action="start">Start Match</button>` : ""}
      <button class="secondary" data-lobby-action="cancel-wait">Cancel</button>
    `;

    function renderPlayerList() {
      const el = overlayEl.querySelector("#playerList");
      if (!el || !channel) return;
      const state = channel.presenceState();
      const names = Object.values(state).map((entries) => entries[0]?.name || "Player");
      el.textContent = `Players: ${names.join(", ")}`;
      for (const key of Object.keys(state)) {
        const meta = state[key][0];
        if (meta.ownerId && meta.ownerId !== myId) opponentId = meta.ownerId;
      }
    }
    renderPlayerList();
    window.__penaltyPresenceHook = renderPlayerList;

    overlayEl.querySelector('[data-lobby-action="cancel-wait"]').addEventListener("click", () => {
      clearTimeout(timeoutId);
      window.__penaltyPresenceHook = null;
      closeRoom(channel);
      channel = null;
      onCancel();
    });

    if (hostRole) {
      overlayEl.querySelector('[data-lobby-action="start"]').addEventListener("click", () => {
        clearTimeout(timeoutId);
        window.__penaltyPresenceHook = null;
        channel.send({ type: "broadcast", event: "game-start", payload: {} });
        onReady();
      });
    } else {
      pendingOnReady = () => {
        clearTimeout(timeoutId);
        window.__penaltyPresenceHook = null;
        onReady();
      };
    }

    const timeoutId = hostRole
      ? null
      : setTimeout(() => {
          if (countPresence(channel) < 2) {
            window.__penaltyPresenceHook = null;
            closeRoom(channel);
            channel = null;
            overlayEl.innerHTML = `<h1>Penalty Kicks</h1><p>Nobody joined in time. Double check the code and try again.</p><button data-lobby-action="back">Back</button>`;
            overlayEl.querySelector('[data-lobby-action="back"]').addEventListener("click", () => renderChoiceScreen(overlayEl, onReady, onCancel));
          }
        }, JOIN_TIMEOUT_MS);
  }

  function renderLobby(overlayEl, { onReady, onCancel }) {
    closeRoom(channel);
    channel = null;
    pendingOnReady = null;
    roomCode = null;
    opponentId = null;
    renderChoiceScreen(overlayEl, onReady, onCancel);
  }

  // ---------------- lifecycle ----------------

  function reset() {
    particles = [];
    floaters = [];
    shake = 0;
    zoneIndex = -1;
    ball = null;
    handsReady = false;
    countdown = 0;

    if (mode === "online") {
      kickNumber = 1;
      myGoals = 0;
      opponentGoals = 0;
      matchOver = false;
      matchResult = null;
      awaitingTimer = 0;
      startNextKickPhaseForRole();
    } else {
      score = 0;
      lives = LIVES;
      level = 1;
      shotsThisLevel = 0;
      startQuestion();
    }
    isPlaying = true;
  }

  function save() {
    if (mode === "online" && channel) {
      closeRoom(channel);
      channel = null;
    }
    isPlaying = false;
  }

  function update(dt, landmarks) {
    if (!isPlaying) return;
    const stepDt = Math.min(dt, 50);

    shake = Math.max(0, shake - stepDt * 0.05);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 1;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const f of floaters) {
      f.y -= 0.6;
      f.life -= 1;
    }
    floaters = floaters.filter((f) => f.life > 0);

    if (mode === "online") updateOnline(stepDt, landmarks);
    else updateOffline(stepDt);
  }

  function isOver() {
    if (mode === "online") return matchOver;
    return lives <= 0;
  }

  function getHud() {
    if (mode === "online") {
      const role = myRoleForKick(kickNumber);
      const roundLabel = kickNumber > KICKS_PER_PLAYER * 2 ? "Sudden Death" : `Kick ${Math.ceil(kickNumber / 2)}/${KICKS_PER_PLAYER}`;
      const left = role === "shooter" ? `⚽ ${roundLabel} — You're shooting!` : `🧤 ${roundLabel} — You're keeping!`;
      return { left, right: `You ${myGoals} — ${opponentGoals} Opponent` };
    }
    return {
      left: `⚽ Level ${level}   Kick ${Math.min(shotsThisLevel + 1, SHOTS_PER_LEVEL)}/${SHOTS_PER_LEVEL}`,
      right: `🥅 ${score}   ${"❤".repeat(Math.max(lives, 0)) || "💔"}`,
    };
  }

  function getOverResult() {
    if (mode === "online") {
      if (matchResult?.forfeit) {
        return {
          title: matchResult.won ? "Opponent Left" : "You Left",
          message: matchResult.won ? "Your opponent disconnected — you win by forfeit." : "You left the match.",
        };
      }
      const title = matchResult?.won ? "You Won the Shootout!" : "You Lost the Shootout";
      return { title, message: `Final score: You ${myGoals} — ${opponentGoals} Opponent.` };
    }
    return {
      title: "Full Time!",
      message: `You scored ${score} goal${score === 1 ? "" : "s"} and reached Level ${level}. Pick a game to play again.`,
    };
  }

  return {
    id: "penalty-kicks",
    title: "Penalty Kicks",
    thumbnail: null,
    description: "Answer a quick math question, then pick your spot — but the keeper still has a chance to guess right. Play solo or challenge a friend online.",
    needsLobby: true,
    renderLobby,
    reset,
    update,
    draw,
    drawBackground,
    isOver,
    getHud,
    getOverResult,
    save,
    primeAudio,
  };
}
