import { hudClearance } from "./utils.js?v=5";

const PADDLE_WIDTH = 120;
const PADDLE_HEIGHT = 16;
const BALL_RADIUS = 8;
const BASE_BALL_SPEED = 320;
const SPEED_PER_LEVEL = 25;
const MAX_BOUNCE_ANGLE = (60 * Math.PI) / 180;
const BRICK_ROWS = 5;
const BRICK_COLS = 9;
const BRICK_HEIGHT = 24;
const BRICK_GAP = 6;
const BRICK_TOP_MARGIN = 70;
const LIVES_START = 3;
const BEST_KEY = "fireBox.brick.best.v1";

const BRICK_COLORS = ["#f87171", "#fb923c", "#fbbf24", "#4ade80", "#60a5fa"];
const BALL_SRC = "Asset/kenney_jumper-pack/PNG/HUD/coin_gold.png";

function loadSprite(src) {
  const sprite = { img: new Image(), loaded: false };
  sprite.img.onload = () => {
    sprite.loaded = true;
  };
  sprite.img.src = src;
  return sprite;
}

function loadBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    localStorage.setItem(BEST_KEY, String(value));
  } catch {}
}

export function createBrickGame({ canvas, ctx }) {
  const ballSprite = loadSprite(BALL_SRC);

  let paddleX = canvas.width / 2;
  let ball = { x: 0, y: 0, vx: 0, vy: 0 };
  let bricks = [];
  let particles = [];
  let floaters = [];
  let trail = [];
  let score = 0;
  let best = loadBest();
  let lives = LIVES_START;
  let level = 1;
  let gameOver = true;
  let isNewBest = false;
  let ballLaunched = false;

  function toCanvasX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.max(rect.width / canvas.width, rect.height / canvas.height);
    const offsetX = (rect.width - canvas.width * scale) / 2;
    return (clientX - rect.left - offsetX) / scale;
  }

  canvas.addEventListener("pointermove", (e) => {
    if (gameOver) return;
    paddleX = Math.max(PADDLE_WIDTH / 2, Math.min(canvas.width - PADDLE_WIDTH / 2, toCanvasX(e.clientX)));
  });

  canvas.addEventListener("pointerdown", () => {
    if (!gameOver && !ballLaunched) launchBall();
  });

  function buildBricks() {
    bricks = [];
    const topMargin = Math.max(BRICK_TOP_MARGIN, hudClearance(canvas, 125));
    const brickWidth = (canvas.width - BRICK_GAP * (BRICK_COLS + 1)) / BRICK_COLS;
    for (let row = 0; row < BRICK_ROWS; row++) {
      for (let col = 0; col < BRICK_COLS; col++) {
        bricks.push({
          x: BRICK_GAP + col * (brickWidth + BRICK_GAP),
          y: topMargin + row * (BRICK_HEIGHT + BRICK_GAP),
          w: brickWidth,
          h: BRICK_HEIGHT,
          color: BRICK_COLORS[row % BRICK_COLORS.length],
          alive: true,
        });
      }
    }
  }

  function resetBallOnPaddle() {
    ball = { x: paddleX, y: canvas.height - 60 - BALL_RADIUS - 4, vx: 0, vy: 0 };
    ballLaunched = false;
    trail = [];
  }

  function launchBall() {
    const speed = BASE_BALL_SPEED + (level - 1) * SPEED_PER_LEVEL;
    const angle = (Math.random() * 40 - 20) * (Math.PI / 180);
    ball.vx = speed * Math.sin(angle);
    ball.vy = -speed * Math.cos(angle);
    ballLaunched = true;
  }

  function spawnBurst(x, y, color, count = 10) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const speed = 90 + Math.random() * 90;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: 3 + Math.random() * 2,
        color,
        life: 450,
        maxLife: 450,
      });
    }
  }

  function addFloater(x, y, text, color) {
    floaters.push({ x, y, text, color, life: 700, maxLife: 700 });
  }

  function reset() {
    paddleX = canvas.width / 2;
    buildBricks();
    resetBallOnPaddle();
    particles = [];
    floaters = [];
    score = 0;
    lives = LIVES_START;
    level = 1;
    gameOver = false;
    isNewBest = false;
  }

  function endGame() {
    gameOver = true;
    isNewBest = score > best;
    if (isNewBest) {
      best = score;
      saveBest(best);
    }
  }

  function bounceOffPaddle() {
    const hitPos = Math.max(-1, Math.min(1, (ball.x - paddleX) / (PADDLE_WIDTH / 2)));
    const angle = hitPos * MAX_BOUNCE_ANGLE;
    const speed = Math.hypot(ball.vx, ball.vy);
    ball.vx = speed * Math.sin(angle);
    ball.vy = -Math.abs(speed * Math.cos(angle));
  }

  function update(dt) {
    if (gameOver) return;
    const dtSec = Math.min(dt, 50) / 1000;

    for (const p of particles) {
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.vy += 260 * dtSec;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);

    for (const f of floaters) {
      f.y -= 40 * dtSec;
      f.life -= dt;
    }
    floaters = floaters.filter((f) => f.life > 0);

    if (!ballLaunched) {
      ball.x = paddleX;
      return;
    }

    ball.x += ball.vx * dtSec;
    ball.y += ball.vy * dtSec;
    trail.push({ x: ball.x, y: ball.y });
    if (trail.length > 9) trail.shift();

    if (ball.x - BALL_RADIUS < 0) {
      ball.x = BALL_RADIUS;
      ball.vx *= -1;
    }
    if (ball.x + BALL_RADIUS > canvas.width) {
      ball.x = canvas.width - BALL_RADIUS;
      ball.vx *= -1;
    }
    if (ball.y - BALL_RADIUS < 0) {
      ball.y = BALL_RADIUS;
      ball.vy *= -1;
    }

    const paddleTop = canvas.height - 60;
    if (
      ball.vy > 0 &&
      ball.y + BALL_RADIUS >= paddleTop &&
      ball.y + BALL_RADIUS <= paddleTop + PADDLE_HEIGHT + 14 &&
      ball.x >= paddleX - PADDLE_WIDTH / 2 &&
      ball.x <= paddleX + PADDLE_WIDTH / 2
    ) {
      ball.y = paddleTop - BALL_RADIUS;
      bounceOffPaddle();
    }

    for (const brick of bricks) {
      if (!brick.alive) continue;
      if (
        ball.x + BALL_RADIUS > brick.x &&
        ball.x - BALL_RADIUS < brick.x + brick.w &&
        ball.y + BALL_RADIUS > brick.y &&
        ball.y - BALL_RADIUS < brick.y + brick.h
      ) {
        brick.alive = false;
        ball.vy *= -1;
        score += 10;
        spawnBurst(brick.x + brick.w / 2, brick.y + brick.h / 2, brick.color, 10);
        addFloater(brick.x + brick.w / 2, brick.y + brick.h / 2, "+10", "#fbbf24");
        break;
      }
    }

    if (ball.y - BALL_RADIUS > canvas.height) {
      lives -= 1;
      if (lives <= 0) {
        endGame();
      } else {
        resetBallOnPaddle();
      }
      return;
    }

    if (bricks.every((b) => !b.alive)) {
      level += 1;
      buildBricks();
      resetBallOnPaddle();
    }
  }

  function rand01(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, (n >> 16) + amt));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    const b = Math.max(0, Math.min(255, (n & 255) + amt));
    return `rgb(${r},${g},${b})`;
  }

  function drawBackdrop() {
    const w = canvas.width;
    const h = canvas.height;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#0b1226");
    bg.addColorStop(0.55, "#101a36");
    bg.addColorStop(1, "#1b1740");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // soft nebula glows
    const glowA = ctx.createRadialGradient(w * 0.2, h * 0.25, 0, w * 0.2, h * 0.25, h * 0.6);
    glowA.addColorStop(0, "rgba(96,165,250,0.12)");
    glowA.addColorStop(1, "rgba(96,165,250,0)");
    ctx.fillStyle = glowA;
    ctx.fillRect(0, 0, w, h);
    const glowB = ctx.createRadialGradient(w * 0.85, h * 0.7, 0, w * 0.85, h * 0.7, h * 0.6);
    glowB.addColorStop(0, "rgba(244,114,182,0.10)");
    glowB.addColorStop(1, "rgba(244,114,182,0)");
    ctx.fillStyle = glowB;
    ctx.fillRect(0, 0, w, h);

    // twinkling stars
    const t = performance.now() / 1000;
    for (let i = 0; i < 70; i++) {
      const x = rand01(i * 2.3) * w;
      const y = rand01(i * 5.9 + 3) * h;
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * (0.6 + rand01(i) * 1.4) + i));
      ctx.fillStyle = `rgba(226,232,240,${0.12 + 0.35 * tw})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + rand01(i * 1.7) * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // playfield rails
    const rail = ctx.createLinearGradient(0, 0, w, 0);
    rail.addColorStop(0, "rgba(96,165,250,0.5)");
    rail.addColorStop(0.5, "rgba(167,139,250,0.35)");
    rail.addColorStop(1, "rgba(244,114,182,0.5)");
    ctx.fillStyle = rail;
    ctx.fillRect(0, 0, 3, h);
    ctx.fillRect(w - 3, 0, 3, h);
  }

  function drawBrick(brick) {
    const { x, y, w, h, color } = brick;
    const r = 5;
    // drop shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 3, w, h, r);
    ctx.fill();

    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, shade(color, 40));
    g.addColorStop(0.5, color);
    g.addColorStop(1, shade(color, -45));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();

    // glossy highlight along the top edge
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.beginPath();
    ctx.roundRect(x + 3, y + 2, w - 6, h * 0.32, 3);
    ctx.fill();

    // crisp outline
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.stroke();
  }

  function draw() {
    drawBackdrop();

    for (const brick of bricks) {
      if (brick.alive) drawBrick(brick);
    }

    // paddle: shadow, metallic body, coloured end caps, glossy top
    const paddleY = canvas.height - 60;
    const px = paddleX - PADDLE_WIDTH / 2;
    const glow = ctx.createRadialGradient(paddleX, paddleY + PADDLE_HEIGHT, 0, paddleX, paddleY + PADDLE_HEIGHT, PADDLE_WIDTH * 0.8);
    glow.addColorStop(0, "rgba(96,165,250,0.35)");
    glow.addColorStop(1, "rgba(96,165,250,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(paddleX, paddleY + PADDLE_HEIGHT, PADDLE_WIDTH * 0.8, 0, Math.PI * 2);
    ctx.fill();

    const paddleGrad = ctx.createLinearGradient(0, paddleY, 0, paddleY + PADDLE_HEIGHT);
    paddleGrad.addColorStop(0, "#f8fafc");
    paddleGrad.addColorStop(0.45, "#cbd5e1");
    paddleGrad.addColorStop(1, "#64748b");
    ctx.fillStyle = paddleGrad;
    ctx.beginPath();
    ctx.roundRect(px, paddleY, PADDLE_WIDTH, PADDLE_HEIGHT, PADDLE_HEIGHT / 2);
    ctx.fill();
    ctx.fillStyle = "#60a5fa";
    ctx.beginPath();
    ctx.roundRect(px, paddleY, 16, PADDLE_HEIGHT, PADDLE_HEIGHT / 2);
    ctx.roundRect(px + PADDLE_WIDTH - 16, paddleY, 16, PADDLE_HEIGHT, PADDLE_HEIGHT / 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    ctx.roundRect(px + 14, paddleY + 2, PADDLE_WIDTH - 28, 4, 2);
    ctx.fill();

    // ball trail + glow
    for (let i = 0; i < trail.length; i++) {
      const tp = trail[i];
      const a = (i + 1) / trail.length;
      ctx.fillStyle = `rgba(253,224,71,${0.18 * a})`;
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, BALL_RADIUS * (0.5 + 0.6 * a), 0, Math.PI * 2);
      ctx.fill();
    }
    const halo = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, BALL_RADIUS * 3);
    halo.addColorStop(0, "rgba(253,224,71,0.5)");
    halo.addColorStop(1, "rgba(253,224,71,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_RADIUS * 3, 0, Math.PI * 2);
    ctx.fill();
    if (ballSprite.loaded) {
      const s = BALL_RADIUS * 2.3;
      ctx.drawImage(ballSprite.img, ball.x - s / 2, ball.y - s / 2, s, s);
    } else {
      ctx.fillStyle = "#f8fafc";
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.textAlign = "center";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.lineJoin = "round";
    for (const f of floaters) {
      const a = Math.max(0, Math.min(1, f.life / 300));
      ctx.globalAlpha = a;
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(15,23,42,0.85)";
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }

    if (!ballLaunched && !gameOver) {
      const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 260);
      ctx.textAlign = "center";
      ctx.font = "bold 24px system-ui, sans-serif";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(15,23,42,0.85)";
      ctx.globalAlpha = pulse;
      ctx.strokeText("Click to launch", canvas.width / 2, canvas.height * 0.62);
      ctx.fillStyle = "#f8fafc";
      ctx.fillText("Click to launch", canvas.width / 2, canvas.height * 0.62);
      ctx.globalAlpha = 1;
    }
  }

  function isOver() {
    return gameOver;
  }

  function getHud() {
    return { left: `⭐ ${score}   🧱 Lv.${level}`, right: "❤".repeat(Math.max(0, lives)) || "💔" };
  }

  function getOverResult() {
    return {
      title: "Game Over",
      message: isNewBest ? `Score: ${score} — New Best!` : `Score: ${score} (Best: ${best})`,
    };
  }

  return {
    id: "brick",
    title: "Brick Breaker",
    thumbnail: "Asset/brick_breaker_Thumbnail.jpg",
    description: "Move the paddle with your mouse and break every brick. Clear a level for a faster, tougher one.",
    reset,
    update,
    draw,
    isOver,
    getHud,
    getOverResult,
  };
}
