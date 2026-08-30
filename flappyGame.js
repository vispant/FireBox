const GRAVITY = 1600; // px/s^2
const FLAP_VELOCITY = -430; // px/s
const BIRD_RADIUS = 18;
const PIPE_WIDTH = 72;
const PIPE_GAP = 175;
const PIPE_SPACING = 280;
const BASE_PIPE_SPEED = 230; // px/s
const COUNTDOWN_SECONDS = 3;
const BEST_KEY = "fireBox.flappy.best.v1";
const PIPE_CAP_OVERLAP = 0.55;
const CLOUD_SPEED = 26;

const BIRD_SRC = "Asset/kenney_animal-pack/PNG/Round/parrot.png";
const TOWER_SRC = "Asset/kenney_background-elements/PNG/tower_grey.png";
const CLOUD_SRCS = [
  "Asset/kenney_background-elements/PNG/Flat/cloud2.png",
  "Asset/kenney_background-elements/PNG/Flat/cloud5.png",
  "Asset/kenney_background-elements/PNG/Flat/cloud8.png",
];

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

export function createFlappyGame({ canvas, ctx }) {
  const birdSprite = loadSprite(BIRD_SRC);
  const towerSprite = loadSprite(TOWER_SRC);
  const cloudSprites = CLOUD_SRCS.map(loadSprite);

  let birdX = canvas.width * 0.28;
  let birdY = canvas.height / 2;
  let velocity = 0;
  let pipes = [];
  let clouds = [];
  let score = 0;
  let best = loadBest();
  let gameOver = true;
  let isNewBest = false;
  let flapQueued = false;
  let spawnTimer = 0;
  let countdown = 0;

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

  function spawnCloud(x) {
    clouds.push({
      x,
      y: 30 + Math.random() * (canvas.height * 0.5),
      variant: Math.floor(Math.random() * cloudSprites.length),
      scale: 0.7 + Math.random() * 0.6,
    });
  }

  function seedClouds() {
    clouds = [];
    let x = -40;
    while (x < canvas.width + 200) {
      spawnCloud(x);
      x += 180 + Math.random() * 220;
    }
  }

  function reset() {
    birdX = canvas.width * 0.28;
    birdY = canvas.height / 2;
    velocity = 0;
    pipes = [];
    seedClouds();
    score = 0;
    gameOver = false;
    isNewBest = false;
    flapQueued = false;
    spawnTimer = 0;
    countdown = COUNTDOWN_SECONDS;
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

    if (countdown > 0) {
      countdown = Math.max(0, countdown - dtSec);
      flapQueued = false;
      return;
    }

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

    for (const c of clouds) c.x -= CLOUD_SPEED * dtSec;
    clouds = clouds.filter((c) => c.x > -200);
    while (clouds.length === 0 || clouds[clouds.length - 1].x < canvas.width + 200) {
      const lastX = clouds.length ? clouds[clouds.length - 1].x : canvas.width;
      spawnCloud(lastX + 180 + Math.random() * 220);
    }

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

  function drawClouds() {
    for (const c of clouds) {
      const sprite = cloudSprites[c.variant];
      if (!sprite.loaded) continue;
      const w = 120 * c.scale;
      const h = w * (sprite.img.naturalHeight / sprite.img.naturalWidth);
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.drawImage(sprite.img, c.x - w / 2, c.y - h / 2, w, h);
      ctx.restore();
    }
  }

  function drawPipe(pipe) {
    const gapTop = pipe.gapCenter - PIPE_GAP / 2;
    const gapBottom = pipe.gapCenter + PIPE_GAP / 2;
    const w = PIPE_WIDTH;

    if (towerSprite.loaded) {
      const h = w * (towerSprite.img.naturalHeight / towerSprite.img.naturalWidth);
      ctx.fillStyle = "#94a3ab";

      const bottomShaftTop = gapBottom + h * PIPE_CAP_OVERLAP;
      ctx.fillRect(pipe.x, bottomShaftTop, w, canvas.height - bottomShaftTop);
      ctx.drawImage(towerSprite.img, pipe.x, gapBottom, w, h);

      const topShaftBottom = gapTop - h * PIPE_CAP_OVERLAP;
      ctx.fillRect(pipe.x, 0, w, topShaftBottom);
      ctx.save();
      ctx.translate(pipe.x, gapTop);
      ctx.scale(1, -1);
      ctx.drawImage(towerSprite.img, 0, 0, w, h);
      ctx.restore();
    } else {
      ctx.fillStyle = "#22c55e";
      ctx.fillRect(pipe.x, 0, w, gapTop);
      ctx.fillRect(pipe.x, gapBottom, w, canvas.height - gapBottom);
    }
  }

  function drawBird() {
    ctx.save();
    ctx.translate(birdX, birdY);
    ctx.rotate(Math.max(-0.5, Math.min(0.9, velocity / 600)));
    if (birdSprite.loaded) {
      const s = BIRD_RADIUS * 2.5;
      ctx.drawImage(birdSprite.img, -s / 2, -s / 2, s, s);
    } else {
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(0, 0, BIRD_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(6, -4, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw() {
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, "#7dd3fc");
    grad.addColorStop(1, "#bae6fd");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawClouds();
    for (const pipe of pipes) drawPipe(pipe);
    drawBird();

    if (countdown > 0) {
      ctx.fillStyle = "rgba(15, 23, 42, 0.35)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.textAlign = "center";
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 120px system-ui, sans-serif";
      ctx.fillText(String(Math.ceil(countdown)), canvas.width / 2, canvas.height / 2 + 40);

      ctx.font = "bold 26px system-ui, sans-serif";
      ctx.fillText("Get ready! Space or click to flap", canvas.width / 2, canvas.height / 2 + 100);
    }
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
    thumbnail: "Asset/sky_dodger_Thumbnail.jpg",
    description: "Tap space or click to fly through the gaps. How far can you go?",
    reset,
    update,
    draw,
    isOver,
    getHud,
    getOverResult,
  };
}
