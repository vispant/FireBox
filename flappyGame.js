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
  let puffs = [];
  let bgScroll = 0;
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
    puffs = [];
    bgScroll = 0;
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
      for (let i = 0; i < 4; i++) {
        puffs.push({ x: birdX - 10 - i * 4, y: birdY + 8 + Math.random() * 6, vx: -40 - Math.random() * 30, vy: 20 + Math.random() * 20, r: 4 + Math.random() * 3, life: 380, maxLife: 380 });
      }
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

    bgScroll += speed * dtSec;
    for (const p of puffs) {
      p.x += p.vx * dtSec - speed * dtSec * 0.3;
      p.y += p.vy * dtSec;
      p.life -= dtSec * 1000;
    }
    puffs = puffs.filter((p) => p.life > 0);
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

  function drawSky() {
    const w = canvas.width;
    const h = canvas.height;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#3b9df0");
    grad.addColorStop(0.55, "#8fd0fa");
    grad.addColorStop(1, "#dff3fd");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // sun with a soft halo
    const sx = w * 0.82;
    const sy = h * 0.2;
    const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, h * 0.55);
    halo.addColorStop(0, "rgba(255,244,190,0.75)");
    halo.addColorStop(0.35, "rgba(255,236,160,0.25)");
    halo.addColorStop(1, "rgba(255,236,160,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#fff7c2";
    ctx.beginPath();
    ctx.arc(sx, sy, 34, 0, Math.PI * 2);
    ctx.fill();
  }

  // Two slowly scrolling layers of distant hills along the bottom.
  function drawHills() {
    const w = canvas.width;
    const h = canvas.height;
    const layers = [
      { color: "rgba(120,170,215,0.55)", base: h * 0.84, amp: 34, freq: 0.006, speed: 0.12 },
      { color: "rgba(86,140,190,0.6)", base: h * 0.9, amp: 26, freq: 0.009, speed: 0.22 },
    ];
    for (const L of layers) {
      ctx.fillStyle = L.color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 8) {
        const y = L.base + Math.sin((x + bgScroll * L.speed) * L.freq) * L.amp + Math.sin((x + bgScroll * L.speed) * L.freq * 2.3) * (L.amp * 0.35);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
  }

  // A crisp castle tower drawn in local coordinates: the roof tip sits at (0,0)
  // and the tower extends toward +y (flip the context to hang it from the ceiling).
  function drawTower(w, length) {
    const coneH = w * 0.95;
    const ledgeH = 12;
    const bodyTop = coneH + ledgeH;

    // shaft: stone gradient with mortar courses and a highlight strip
    const shaft = ctx.createLinearGradient(0, 0, w, 0);
    shaft.addColorStop(0, "#c3ced4");
    shaft.addColorStop(0.42, "#9aa9b1");
    shaft.addColorStop(1, "#6b7d86");
    ctx.fillStyle = shaft;
    ctx.fillRect(w * 0.08, bodyTop, w * 0.84, length);
    ctx.strokeStyle = "rgba(38,54,62,0.3)";
    ctx.lineWidth = 1.5;
    for (let y = bodyTop + 22; y < bodyTop + length; y += 22) {
      ctx.beginPath();
      ctx.moveTo(w * 0.08, y);
      ctx.lineTo(w * 0.92, y);
      ctx.stroke();
      const off = (Math.round(y / 22) % 2) * (w * 0.2);
      ctx.beginPath();
      ctx.moveTo(w * 0.3 + off, y - 22);
      ctx.lineTo(w * 0.3 + off, y);
      ctx.moveTo(w * 0.62 + off * 0.5, y - 22);
      ctx.lineTo(w * 0.62 + off * 0.5, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(w * 0.12, bodyTop, w * 0.07, length);
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.fillRect(w * 0.84, bodyTop, w * 0.08, length);

    // arched window
    ctx.fillStyle = "#3a4a52";
    ctx.beginPath();
    ctx.moveTo(w * 0.4, bodyTop + 62);
    ctx.lineTo(w * 0.4, bodyTop + 38);
    ctx.arc(w * 0.5, bodyTop + 38, w * 0.1, Math.PI, 0);
    ctx.lineTo(w * 0.6, bodyTop + 62);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,220,140,0.55)";
    ctx.fillRect(w * 0.44, bodyTop + 46, w * 0.12, 14);

    // stone ledge under the roof
    const ledge = ctx.createLinearGradient(0, coneH, 0, coneH + ledgeH);
    ledge.addColorStop(0, "#d3dde2");
    ledge.addColorStop(1, "#8697a0");
    ctx.fillStyle = ledge;
    ctx.beginPath();
    ctx.roundRect(-w * 0.04, coneH, w * 1.08, ledgeH, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(38,54,62,0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // conical terracotta roof with tile rows
    const roof = ctx.createLinearGradient(0, 0, w, 0);
    roof.addColorStop(0, "#e2885e");
    roof.addColorStop(0.5, "#cf6a3f");
    roof.addColorStop(1, "#9f4a2a");
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w * 1.02, coneH);
    ctx.lineTo(-w * 0.02, coneH);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = "rgba(90,35,15,0.35)";
    ctx.lineWidth = 1.5;
    for (let y = 10; y < coneH; y += 11) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(80,30,10,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w * 1.02, coneH);
    ctx.lineTo(-w * 0.02, coneH);
    ctx.closePath();
    ctx.stroke();
    // little flag on the tip
    ctx.strokeStyle = "#5b3a24";
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, -12);
    ctx.stroke();
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.moveTo(w / 2, -12);
    ctx.lineTo(w / 2 + 12, -8);
    ctx.lineTo(w / 2, -4);
    ctx.closePath();
    ctx.fill();
  }

  function drawPipe(pipe) {
    const gapTop = pipe.gapCenter - PIPE_GAP / 2;
    const gapBottom = pipe.gapCenter + PIPE_GAP / 2;
    const w = PIPE_WIDTH;

    // lower tower: roof tip points up into the gap
    ctx.save();
    ctx.translate(pipe.x, gapBottom);
    drawTower(w, canvas.height);
    ctx.restore();

    // upper tower: hangs from the ceiling, roof tip pointing down into the gap
    ctx.save();
    ctx.translate(pipe.x, gapTop);
    ctx.scale(1, -1);
    drawTower(w, canvas.height);
    ctx.restore();
  }

  function drawBird() {
    // flap puffs trailing behind
    for (const p of puffs) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = `rgba(255,255,255,${0.55 * a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1.3 - a * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }

    // soft ground-independent shadow beneath so the bird reads against light sky
    ctx.fillStyle = "rgba(15,40,80,0.12)";
    ctx.beginPath();
    ctx.ellipse(birdX + 4, birdY + BIRD_RADIUS + 6, BIRD_RADIUS * 0.9, BIRD_RADIUS * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

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
    drawSky();
    drawHills();
    drawClouds();
    for (const pipe of pipes) drawPipe(pipe);
    drawBird();

    if (countdown > 0) {
      ctx.fillStyle = "rgba(15, 23, 42, 0.28)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.textAlign = "center";
      ctx.lineJoin = "round";
      ctx.font = "bold 120px system-ui, sans-serif";
      ctx.lineWidth = 10;
      ctx.strokeStyle = "rgba(15,23,42,0.6)";
      ctx.strokeText(String(Math.ceil(countdown)), canvas.width / 2, canvas.height / 2 + 40);
      ctx.fillStyle = "#f8fafc";
      ctx.fillText(String(Math.ceil(countdown)), canvas.width / 2, canvas.height / 2 + 40);

      ctx.font = "bold 26px system-ui, sans-serif";
      ctx.lineWidth = 6;
      ctx.strokeText("Get ready! Space or click to flap", canvas.width / 2, canvas.height / 2 + 100);
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
