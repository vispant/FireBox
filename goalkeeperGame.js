import { POSE, toCanvasCoords } from "./utils.js?v=5";

const HAND_SPRITE_SRC = "Asset/hands.png";
const SHOOTER_SRC = {
  idle: "Asset/kenney_platformer-characters/PNG/Player/Poses/player_idle.png",
  kick: "Asset/kenney_platformer-characters/PNG/Player/Poses/player_kick.png",
};

const VISIBILITY_MIN = 0.4; // ignore a tracked point if the model isn't confident it's in frame
const COUNTDOWN_SECONDS = 3;

const LIVES = 3;
const SHOTS_PER_LEVEL = 3; // every 3 shots faced, the next tier gets harder
const WINDUP_MS = 650; // shooter winds up before the ball is struck
const RESULT_MS = 850; // pause after a save/goal before the next shot
const BASE_FLIGHT_MS = 1150; // how long a level-1 shot takes to arrive
const FLIGHT_MS_PER_LEVEL = 95; // faster each level (less reaction time)
const MIN_FLIGHT_MS = 430; // never gets unfairly instant
const SAVE_RADIUS = 46; // how close a tracked hand must get to the ball to save it
const HAND_ICON_SIZE = 70;

function loadSprite(src) {
  const img = new Image();
  const sprite = { img, loaded: false };
  img.onload = () => {
    sprite.loaded = true;
  };
  img.src = src;
  return sprite;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// A single hand icon (Asset/hands.png, real goalkeeper gloves would both be
// the same color) mirrored for the right side so only one image is needed,
// same trick already used in catchGame.js.
function drawHandSprite(ctx, sprite, x, y, side) {
  const baseColor = "#4ade80";
  const w = HAND_ICON_SIZE;
  const aspect = sprite.img.naturalHeight / sprite.img.naturalWidth;
  const h = w * aspect;

  ctx.save();
  ctx.translate(x, y);
  if (side === "right") ctx.scale(-1, 1);

  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.9);
  glow.addColorStop(0, hexToRgba(baseColor, 0.3));
  glow.addColorStop(1, hexToRgba(baseColor, 0));
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.9, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  ctx.drawImage(sprite.img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

// Fallback glove (drawn, not the sprite) for the brief window before the
// image loads -- same pattern as catchGame.js's drawHandGlove.
function drawHandFallback(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  const grad = ctx.createRadialGradient(-10, -10, 4, 0, 0, 32);
  grad.addColorStop(0, "#bbf7d0");
  grad.addColorStop(1, "#16a34a");
  ctx.beginPath();
  ctx.arc(0, 0, 32, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

// Tracked hand position mapped 1:1 to the canvas (no amplification -- diving
// motions are already big and this keeps the save feel grounded/precise).
function getHandPoint(landmarks, idx, canvasWidth, canvasHeight) {
  return toCanvasCoords(landmarks[idx], canvasWidth, canvasHeight);
}

export function createGoalkeeperGame({ canvas, ctx }) {
  const handSprite = loadSprite(HAND_SPRITE_SRC);
  const shooterSprites = {
    idle: loadSprite(SHOOTER_SRC.idle),
    kick: loadSprite(SHOOTER_SRC.kick),
  };

  const sfxPop = new Audio("balloon_pop.mp3");
  const sfxExplosion = new Audio("explosion_bomb.mp3");
  const sfxGameOver = new Audio("game_over.mp3");
  sfxPop.volume = 0.7;
  sfxExplosion.volume = 0.7;
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
    for (const audio of [sfxPop, sfxExplosion, sfxGameOver]) {
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

  let score, lives, level, shotsThisLevel, handsReady, countdown;
  let phase, phaseTimer, ball, zoneIndex, lastZoneIndex, particles, floaters, shake;

  function goalRect() {
    const w = canvas.width * 0.7;
    const h = canvas.height * 0.34;
    const x = (canvas.width - w) / 2;
    const y = canvas.height * 0.4;
    return { x, y, w, h };
  }

  function zonesX() {
    const g = goalRect();
    return [g.x + g.w * 0.16, g.x + g.w * 0.5, g.x + g.w * 0.84];
  }

  function goalLineY() {
    const g = goalRect();
    return g.y + g.h * 0.68;
  }

  function shooterPos() {
    return { x: canvas.width / 2, y: canvas.height * 0.16 };
  }

  function currentFlightMs() {
    return Math.max(MIN_FLIGHT_MS, BASE_FLIGHT_MS - (level - 1) * FLIGHT_MS_PER_LEVEL);
  }

  function reset() {
    score = 0;
    lives = LIVES;
    level = 1;
    shotsThisLevel = 0;
    handsReady = false;
    countdown = 0;
    particles = [];
    floaters = [];
    shake = 0;
    lastZoneIndex = -1;
    ball = null;
    startWindup();
  }

  function startWindup() {
    phase = "windup";
    phaseTimer = WINDUP_MS;
    let next = Math.floor(Math.random() * 3);
    if (next === lastZoneIndex && Math.random() < 0.7) next = (next + 1 + Math.floor(Math.random() * 2)) % 3;
    zoneIndex = next;
    lastZoneIndex = next;
    ball = null;
  }

  function startFlight() {
    phase = "flying";
    phaseTimer = currentFlightMs();
    const start = shooterPos();
    const zones = zonesX();
    ball = {
      startX: start.x,
      startY: start.y,
      endX: zones[zoneIndex],
      endY: goalLineY(),
      x: start.x,
      y: start.y,
      r: 7,
    };
  }

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

  function resolveShot(wasSaved) {
    phase = "result";
    phaseTimer = RESULT_MS;
    if (wasSaved) {
      score += 1;
      spawnBurst(ball.x, ball.y, "#4ade80");
      addFloater(ball.x, ball.y - 30, "SAVED!", "#4ade80", true);
      playSound(sfxPop);
    } else {
      lives -= 1;
      spawnBurst(ball.endX, ball.endY, "#ef4444");
      addFloater(canvas.width / 2, canvas.height * 0.32, "GOAL!", "#ef4444", true);
      shake = Math.max(shake, 12);
      playSound(sfxExplosion);
      if (lives <= 0) playSound(sfxGameOver);
    }
    shotsThisLevel += 1;
    if (shotsThisLevel >= SHOTS_PER_LEVEL) {
      shotsThisLevel = 0;
      level += 1;
    }
  }

  function handsVisible(landmarks) {
    if (!landmarks) return false;
    const isVisible = (l) => !!l && (l.visibility === undefined || l.visibility > VISIBILITY_MIN);
    return isVisible(landmarks[POSE.LEFT_WRIST]) && isVisible(landmarks[POSE.RIGHT_WRIST]);
  }

  function update(dt, landmarks) {
    if (!handsReady) {
      if (handsVisible(landmarks)) {
        handsReady = true;
        countdown = COUNTDOWN_SECONDS;
      }
      return;
    }
    if (countdown > 0) {
      countdown = Math.max(0, countdown - Math.min(dt, 50) / 1000);
      return;
    }
    if (lives <= 0) return;

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

    if (phase === "windup") {
      phaseTimer -= stepDt;
      if (phaseTimer <= 0) startFlight();
      return;
    }

    if (phase === "flying") {
      phaseTimer -= stepDt;
      const total = currentFlightMs();
      const t = Math.max(0, Math.min(1, 1 - phaseTimer / total));
      ball.x = ball.startX + (ball.endX - ball.startX) * t;
      ball.y = ball.startY + (ball.endY - ball.startY) * t;
      ball.r = 7 + 17 * t;

      if (landmarks) {
        for (const idx of [POSE.LEFT_WRIST, POSE.RIGHT_WRIST]) {
          const h = getHandPoint(landmarks, idx, canvas.width, canvas.height);
          if (Math.hypot(h.x - ball.x, h.y - ball.y) < SAVE_RADIUS + ball.r) {
            resolveShot(true);
            return;
          }
        }
      }

      if (phaseTimer <= 0) resolveShot(false);
      return;
    }

    if (phase === "result") {
      phaseTimer -= stepDt;
      if (phaseTimer <= 0 && lives > 0) startWindup();
      return;
    }
  }

  function drawGoal() {
    const g = goalRect();
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 8;
    ctx.strokeRect(g.x, g.y, g.w, g.h);

    ctx.strokeStyle = "rgba(248,250,252,0.35)";
    ctx.lineWidth = 1.5;
    const cols = 10;
    const rows = 6;
    for (let i = 1; i < cols; i++) {
      const x = g.x + (g.w * i) / cols;
      ctx.beginPath();
      ctx.moveTo(x, g.y);
      ctx.lineTo(x, g.y + g.h);
      ctx.stroke();
    }
    for (let i = 1; i < rows; i++) {
      const y = g.y + (g.h * i) / rows;
      ctx.beginPath();
      ctx.moveTo(g.x, y);
      ctx.lineTo(g.x + g.w, y);
      ctx.stroke();
    }
  }

  function drawPitch() {
    const w = canvas.width;
    const h = canvas.height;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#166534");
    grad.addColorStop(1, "#22c55e");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)";
      ctx.fillRect(0, (h / 6) * i, w, h / 6);
    }

    const g = goalRect();
    const boxW = g.w * 1.35;
    const boxH = g.h * 1.55;
    ctx.strokeRect((w - boxW) / 2, g.y, boxW, boxH);

    drawGoal();
  }

  function drawShooter() {
    const pos = shooterPos();
    const sprite = phase === "windup" && phaseTimer < 260 ? shooterSprites.kick : shooterSprites.idle;
    if (!sprite.loaded) return;
    const h = canvas.height * 0.22;
    const w = h * (sprite.img.naturalWidth / sprite.img.naturalHeight);
    ctx.drawImage(sprite.img, pos.x - w / 2, pos.y - h * 0.15, w, h);
  }

  function drawBall() {
    if (!ball || phase === "windup") return;
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, ball.r * 0.9, ball.r * 0.8, ball.r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#f8fafc";
    ctx.beginPath();
    ctx.arc(0, 0, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = Math.max(1, ball.r * 0.08);
    ctx.stroke();

    ctx.fillStyle = "#1e293b";
    ctx.beginPath();
    ctx.arc(0, 0, ball.r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 5; i++) {
      const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * ball.r * 0.55, Math.sin(a) * ball.r * 0.55, ball.r * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
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
    ctx.fillText("The game starts automatically once we can see them", canvas.width / 2, canvas.height / 2 + 54);
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

  function drawBackground() {
    drawPitch();
  }

  function draw(landmarks) {
    if (!handsReady) {
      drawHandsNeededOverlay();
      return;
    }

    ctx.save();
    if (shake > 0.5) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    drawShooter();
    drawBall();

    if (landmarks) {
      for (const [idx, side] of [
        [POSE.LEFT_WRIST, "left"],
        [POSE.RIGHT_WRIST, "right"],
      ]) {
        const p = getHandPoint(landmarks, idx, canvas.width, canvas.height);
        if (handSprite.loaded) drawHandSprite(ctx, handSprite, p.x, p.y, side);
        else drawHandFallback(ctx, p.x, p.y);
      }
    }

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

    ctx.restore();

    if (countdown > 0) {
      drawCountdownOverlay();
    }
  }

  function isOver() {
    return lives <= 0;
  }

  function getHud() {
    return {
      left: `🧤 Saves: ${score}   ⚡ Lv.${level}`,
      right: "❤".repeat(Math.max(lives, 0)) || "💔",
    };
  }

  function getOverResult() {
    return {
      title: "Full Time!",
      message: `You made ${score} save${score === 1 ? "" : "s"} and reached Level ${level}. Pick a game to play again.`,
    };
  }

  return {
    id: "goalkeeper",
    title: "Shot Stopper",
    thumbnail: null,
    description: "You're the goalkeeper — reach with your hands to save every shot. Gets faster every 3 shots.",
    reset,
    update,
    draw,
    drawBackground,
    primeAudio,
    isOver,
    getHud,
    getOverResult,
  };
}
