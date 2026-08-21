const GRAVITY = 1600; // px/s^2
const FLAP_VELOCITY = -430; // px/s
const BIRD_RADIUS = 18;
const PIPE_WIDTH = 72;
const PIPE_GAP = 175;
const PIPE_SPACING = 280;
const BASE_PIPE_SPEED = 230; // px/s
const BEST_KEY = "fireBox.flappy.best.v1";

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

export function createFlappyGame({ canvas, ctx }) {
  let birdX = canvas.width * 0.28;
  let birdY = canvas.height / 2;
  let velocity = 0;
  let pipes = [];
  let score = 0;
  let best = loadBest();
  let gameOver = true;
  let isNewBest = false;
  let flapQueued = false;
  let spawnTimer = 0;

  function requestFlap() {
    if (!gameOver) flapQueued = true;
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      requestFlap();
    }
  });
  canvas.addEventListener("pointerdown", requestFlap);

  function spawnPipe() {
    const margin = 60;
    const gapCenter = margin + Math.random() * (canvas.height - margin * 2 - PIPE_GAP) + PIPE_GAP / 2;
    pipes.push({ x: canvas.width + PIPE_WIDTH, gapCenter, passed: false });
  }

  function reset() {
    birdX = canvas.width * 0.28;
    birdY = canvas.height / 2;
    velocity = 0;
    pipes = [];
    score = 0;
    gameOver = false;
    isNewBest = false;
    flapQueued = false;
    spawnTimer = 0;
    spawnPipe();
  }

  function endGame() {
    gameOver = true;
    isNewBest = score > best;
    if (isNewBest) {
      best = score;
      saveBest(best);
    }
  }

  function update(dt) {
    if (gameOver) return;
    const dtSec = Math.min(dt, 50) / 1000;

    if (flapQueued) {
      velocity = FLAP_VELOCITY;
      flapQueued = false;
    }

    velocity += GRAVITY * dtSec;
    birdY += velocity * dtSec;

    const speed = BASE_PIPE_SPEED + Math.min(score * 4, 160);

    spawnTimer += speed * dtSec;
    if (spawnTimer >= PIPE_SPACING) {
      spawnTimer = 0;
      spawnPipe();
    }

    for (const pipe of pipes) {
      pipe.x -= speed * dtSec;
      if (!pipe.passed && pipe.x + PIPE_WIDTH < birdX) {
        pipe.passed = true;
        score += 1;
      }
    }
    pipes = pipes.filter((p) => p.x > -PIPE_WIDTH);

    if (birdY - BIRD_RADIUS < 0 || birdY + BIRD_RADIUS > canvas.height) {
      endGame();
      return;
    }

    for (const pipe of pipes) {
      const withinX = birdX + BIRD_RADIUS > pipe.x && birdX - BIRD_RADIUS < pipe.x + PIPE_WIDTH;
      if (!withinX) continue;
      const gapTop = pipe.gapCenter - PIPE_GAP / 2;
      const gapBottom = pipe.gapCenter + PIPE_GAP / 2;
      if (birdY - BIRD_RADIUS < gapTop || birdY + BIRD_RADIUS > gapBottom) {
        endGame();
        return;
      }
    }
  }

  function draw() {
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, "#7dd3fc");
    grad.addColorStop(1, "#bae6fd");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#22c55e";
    for (const pipe of pipes) {
      const gapTop = pipe.gapCenter - PIPE_GAP / 2;
      const gapBottom = pipe.gapCenter + PIPE_GAP / 2;
      ctx.fillRect(pipe.x, 0, PIPE_WIDTH, gapTop);
      ctx.fillRect(pipe.x, gapBottom, PIPE_WIDTH, canvas.height - gapBottom);
    }

    ctx.save();
    ctx.translate(birdX, birdY);
    ctx.rotate(Math.max(-0.5, Math.min(0.9, velocity / 600)));
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc(6, -4, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function isOver() {
    return gameOver;
  }

  function getHud() {
    return { left: `⭐ ${score}`, right: `🏆 ${best}` };
  }

  function getOverResult() {
    return {
      title: "Game Over",
      message: isNewBest ? `Score: ${score} — New Best!` : `Score: ${score} (Best: ${best})`,
    };
  }

  return {
    id: "flappy",
    title: "Sky Dodger",
    thumbnail: null,
    description: "Tap space or click to fly through the gaps. How far can you go?",
    reset,
    update,
    draw,
    isOver,
    getHud,
    getOverResult,
  };
}
