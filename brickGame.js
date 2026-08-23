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

  function draw() {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const brick of bricks) {
      if (!brick.alive) continue;
      ctx.fillStyle = brick.color;
      ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
    }

    const paddleY = canvas.height - 60;
    const paddleGrad = ctx.createLinearGradient(0, paddleY, 0, paddleY + PADDLE_HEIGHT);
    paddleGrad.addColorStop(0, "#f1f5f9");
    paddleGrad.addColorStop(1, "#94a3b8");
    ctx.fillStyle = paddleGrad;
    ctx.beginPath();
    ctx.roundRect(paddleX - PADDLE_WIDTH / 2, paddleY, PADDLE_WIDTH, PADDLE_HEIGHT, PADDLE_HEIGHT / 2);
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
    ctx.font = "bold 20px system-ui, sans-serif";
    for (const f of floaters) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life / 300));
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }

    if (!ballLaunched && !gameOver) {
      ctx.fillStyle = "rgba(15, 23, 42, 0.5)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 24px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Click to launch", canvas.width / 2, canvas.height / 2);
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
    thumbnail: null,
    description: "Move the paddle with your mouse and break every brick. Clear a level for a faster, tougher one.",
    reset,
    update,
    draw,
    isOver,
    getHud,
    getOverResult,
  };
}
