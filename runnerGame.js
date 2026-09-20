const GROUND_Y_MARGIN = 90;
const PLAYER_X_RATIO = 0.22;
const PLAYER_WIDTH = 40;
const PLAYER_HEIGHT = 60;
const DUCK_HEIGHT = 30;
const GRAVITY = 2200;
const JUMP_SPEED = 750;
const BASE_SPEED = 260;
const MAX_SPEED = 620;
const ACCEL_PER_SEC = 6;
const MIN_GAP = 1.1;
const MAX_GAP = 1.9;
const COIN_VALUE = 5;
const INVINCIBLE_MS = 1200;
const MAX_UPGRADE_LEVEL = 3;

const SAVE_KEY = "fireBox.runner.save.v1";
const BEST_SCORE_KEY = "fireBox.runner.bestScore.v1";

const PLAYER_POSE_SRC = {
  walk1: "Asset/kenney_platformer-characters/PNG/Adventurer/Poses/adventurer_walk1.png",
  walk2: "Asset/kenney_platformer-characters/PNG/Adventurer/Poses/adventurer_walk2.png",
  jump: "Asset/kenney_platformer-characters/PNG/Adventurer/Poses/adventurer_jump.png",
  fall: "Asset/kenney_platformer-characters/PNG/Adventurer/Poses/adventurer_fall.png",
  duck: "Asset/kenney_platformer-characters/PNG/Adventurer/Poses/adventurer_duck.png",
  hurt: "Asset/kenney_platformer-characters/PNG/Adventurer/Poses/adventurer_hurt.png",
};
const CACTUS_SRC = "Asset/kenney_jumper-pack/PNG/Environment/cactus.png";
const SPIKE_BALL_SRC = "Asset/kenney_jumper-pack/PNG/Enemies/spikeBall1.png";
const COIN_SRC = "Asset/kenney_jumper-pack/PNG/HUD/coin_gold.png";
const HILL_SRC = "Asset/kenney_background-elements/PNG/Flat/hills1.png";
const MOUNTAIN_SRCS = [
  "Asset/kenney_background-elements/PNG/Flat/mountain1.png",
  "Asset/kenney_background-elements/PNG/Flat/mountain2.png",
  "Asset/kenney_background-elements/PNG/Flat/mountain3.png",
];
const TREE_SRCS = [
  "Asset/kenney_background-elements/PNG/Flat/tree01.png",
  "Asset/kenney_background-elements/PNG/Flat/tree03.png",
  "Asset/kenney_background-elements/PNG/Flat/tree05.png",
  "Asset/kenney_background-elements/PNG/Flat/tree07.png",
  "Asset/kenney_background-elements/PNG/Flat/tree09.png",
];

function loadSprite(src) {
  const sprite = { img: new Image(), loaded: false };
  sprite.img.onload = () => {
    sprite.loaded = true;
  };
  sprite.img.src = src;
  return sprite;
}

function loadSaveData() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { coins: 0, extraLifeLevel: 0, headStartLevel: 0 };
    const parsed = JSON.parse(raw);
    return {
      coins: parsed.coins || 0,
      extraLifeLevel: parsed.extraLifeLevel || 0,
      headStartLevel: parsed.headStartLevel || 0,
    };
  } catch {
    return { coins: 0, extraLifeLevel: 0, headStartLevel: 0 };
  }
}

function writeSaveData(saveData) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
  } catch {}
}

function upgradeCost(level) {
  return 50 + level * 50;
}

// The Kenney "Flat" scenery sprites are single pale-blue silhouettes; recolour
// them once so mountains, hills and trees read as distinct layers with depth.
const tintCache = new Map();
function tinted(sprite, color) {
  if (!sprite.loaded) return null;
  const key = sprite.img.src + color;
  let c = tintCache.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = sprite.img.naturalWidth;
    c.height = sprite.img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(sprite.img, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    tintCache.set(key, c);
  }
  return c;
}

export function createRunnerGame({ canvas, ctx }) {
  let saveData = loadSaveData();
  let best = 0;
  try {
    best = Number(localStorage.getItem(BEST_SCORE_KEY)) || 0;
  } catch {}

  const playerSprites = {
    walk1: loadSprite(PLAYER_POSE_SRC.walk1),
    walk2: loadSprite(PLAYER_POSE_SRC.walk2),
    jump: loadSprite(PLAYER_POSE_SRC.jump),
    fall: loadSprite(PLAYER_POSE_SRC.fall),
    duck: loadSprite(PLAYER_POSE_SRC.duck),
    hurt: loadSprite(PLAYER_POSE_SRC.hurt),
  };
  const cactusSprite = loadSprite(CACTUS_SRC);
  const spikeBallSprite = loadSprite(SPIKE_BALL_SRC);
  const coinSprite = loadSprite(COIN_SRC);
  const hillSprite = loadSprite(HILL_SRC);
  const mountainSprites = MOUNTAIN_SRCS.map(loadSprite);
  const treeSprites = TREE_SRCS.map(loadSprite);

  let playerHeight = 0;
  let playerVelY = 0;
  let ducking = false;
  let grounded = true;
  let dust = [];
  let dustTimer = 0;
  let runFrame = 0;
  let runFrameTimer = 0;

  let obstacles = [];
  let coins = [];
  let mountains = [];
  let trees = [];
  let hillScrollX = 0;
  let spawnTimer = 1;
  let elapsed = 0;
  let distanceScore = 0;
  let runCoins = 0;
  let lives = 1;
  let invincibleUntil = 0;
  let gameOver = true;

  window.addEventListener("keydown", (e) => {
    if (gameOver) return;
    if (e.code === "ArrowUp" || e.code === "Space" || e.code === "KeyW") {
      e.preventDefault();
      if (grounded) {
        playerVelY = JUMP_SPEED;
        grounded = false;
      }
    }
    if (e.code === "ArrowDown" || e.code === "KeyS") {
      ducking = true;
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowDown" || e.code === "KeyS") ducking = false;
  });

  function groundY() {
    return canvas.height - GROUND_Y_MARGIN;
  }

  function currentSpeed() {
    const rampElapsed = Math.max(0, elapsed - saveData.headStartLevel * 3);
    return Math.min(MAX_SPEED, BASE_SPEED + rampElapsed * ACCEL_PER_SEC);
  }

  function spawnObstacle() {
    const overhead = Math.random() < 0.4;
    const width = 34 + Math.random() * 20;
    const height = 50;
    obstacles.push({
      x: canvas.width + width,
      width,
      height,
      y: overhead ? groundY() - 100 : groundY() - height,
      overhead,
    });
  }

  function spawnCoin() {
    const height = Math.random() < 0.5 ? 40 : 90;
    coins.push({ x: canvas.width + 20, y: groundY() - height, r: 10, taken: false });
  }

  function spawnMountain(x) {
    mountains.push({
      x,
      variant: Math.floor(Math.random() * mountainSprites.length),
      scale: 0.7 + Math.random() * 0.6,
    });
  }

  function spawnTree(x) {
    trees.push({ x, variant: Math.floor(Math.random() * treeSprites.length) });
  }

  function seedScenery() {
    mountains = [];
    let mx = -100;
    while (mx < canvas.width + 300) {
      spawnMountain(mx);
      mx += 260 + Math.random() * 220;
    }
    trees = [];
    let tx = -60;
    while (tx < canvas.width + 200) {
      spawnTree(tx);
      tx += 140 + Math.random() * 180;
    }
    hillScrollX = 0;
  }

  function saveBestScore(value) {
    try {
      localStorage.setItem(BEST_SCORE_KEY, String(value));
    } catch {}
  }

  function reset() {
    saveData = loadSaveData();
    playerHeight = 0;
    playerVelY = 0;
    ducking = false;
    grounded = true;
    dust = [];
    dustTimer = 0;
    runFrame = 0;
    runFrameTimer = 0;
    obstacles = [];
    coins = [];
    seedScenery();
    spawnTimer = 1;
    elapsed = 0;
    distanceScore = 0;
    runCoins = 0;
    lives = 1 + saveData.extraLifeLevel;
    invincibleUntil = 0;
    gameOver = false;
  }

  function bankRunCoins() {
    if (runCoins > 0) {
      saveData.coins += runCoins;
      writeSaveData(saveData);
      runCoins = 0;
    }
  }

  function endGame() {
    gameOver = true;
    const finalScore = Math.floor(distanceScore);
    if (finalScore > best) {
      best = finalScore;
      saveBestScore(best);
    }
    bankRunCoins();
  }

  function playerHitbox() {
    const height = ducking ? DUCK_HEIGHT : PLAYER_HEIGHT;
    const feetY = groundY() - playerHeight;
    const headY = feetY - height;
    const x = canvas.width * PLAYER_X_RATIO;
    return { left: x - PLAYER_WIDTH / 2, right: x + PLAYER_WIDTH / 2, top: headY, bottom: feetY };
  }

  function update(dt) {
    if (gameOver) return;
    const dtSec = Math.min(dt, 50) / 1000;
    elapsed += dtSec;
    const speed = currentSpeed();
    distanceScore += speed * dtSec * 0.05;

    playerVelY -= GRAVITY * dtSec;
    playerHeight += playerVelY * dtSec;
    if (playerHeight <= 0) {
      if (!grounded) {
        for (let i = 0; i < 7; i++) {
          dust.push({ x: canvas.width * PLAYER_X_RATIO + (Math.random() - 0.5) * 30, y: groundY(), vx: (Math.random() - 0.5) * 120 - speed * 0.15, vy: -20 - Math.random() * 40, life: 0.45, max: 0.45, r: 3 + Math.random() * 4 });
        }
      }
      playerHeight = 0;
      playerVelY = 0;
      grounded = true;
    }

    dustTimer -= dtSec;
    if (grounded && !ducking && dustTimer <= 0) {
      dustTimer = 0.09;
      dust.push({ x: canvas.width * PLAYER_X_RATIO - 14, y: groundY(), vx: -speed * 0.25 - Math.random() * 30, vy: -10 - Math.random() * 25, life: 0.4, max: 0.4, r: 2.5 + Math.random() * 3 });
    }
    for (const d of dust) {
      d.x += d.vx * dtSec;
      d.y += d.vy * dtSec;
      d.life -= dtSec;
    }
    dust = dust.filter((d) => d.life > 0);

    if (grounded && !ducking) {
      runFrameTimer -= dtSec;
      if (runFrameTimer <= 0) {
        runFrameTimer = 0.11;
        runFrame = runFrame === 0 ? 1 : 0;
      }
    }

    spawnTimer -= dtSec;
    if (spawnTimer <= 0) {
      spawnTimer = MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP);
      spawnObstacle();
      if (Math.random() < 0.6) spawnCoin();
    }

    for (const o of obstacles) o.x -= speed * dtSec;
    obstacles = obstacles.filter((o) => o.x + o.width > -20);

    for (const c of coins) c.x -= speed * dtSec;
    coins = coins.filter((c) => c.x > -20 && !c.taken);

    const mountainSpeed = speed * 0.15;
    for (const m of mountains) m.x -= mountainSpeed * dtSec;
    mountains = mountains.filter((m) => m.x > -300);
    while (mountains.length === 0 || mountains[mountains.length - 1].x < canvas.width + 260) {
      const lastX = mountains.length ? mountains[mountains.length - 1].x : canvas.width;
      spawnMountain(lastX + 260 + Math.random() * 220);
    }

    const treeSpeed = speed * 0.85;
    for (const t of trees) t.x -= treeSpeed * dtSec;
    trees = trees.filter((t) => t.x > -150);
    while (trees.length === 0 || trees[trees.length - 1].x < canvas.width + 150) {
      const lastX = trees.length ? trees[trees.length - 1].x : canvas.width;
      spawnTree(lastX + 140 + Math.random() * 180);
    }

    hillScrollX += speed * 0.4 * dtSec;

    const box = playerHitbox();

    for (const c of coins) {
      if (c.taken) continue;
      const closestX = Math.max(box.left, Math.min(c.x, box.right));
      const closestY = Math.max(box.top, Math.min(c.y, box.bottom));
      if (Math.hypot(c.x - closestX, c.y - closestY) < c.r) {
        c.taken = true;
        runCoins += COIN_VALUE;
      }
    }

    const now = performance.now();
    if (now >= invincibleUntil) {
      for (const o of obstacles) {
        if (box.right > o.x && box.left < o.x + o.width && box.bottom > o.y && box.top < o.y + o.height) {
          lives -= 1;
          if (lives <= 0) {
            endGame();
            return;
          }
          invincibleUntil = now + INVINCIBLE_MS;
          break;
        }
      }
    }
  }

  function drawMountains() {
    for (const m of mountains) {
      const sprite = mountainSprites[m.variant];
      if (!sprite.loaded) continue;
      const w = 170 * m.scale;
      const h = w * (sprite.img.naturalHeight / sprite.img.naturalWidth);
      const y = groundY() - h + 46;
      if (m.x + w / 2 < 0 || m.x - w / 2 > canvas.width) continue;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.drawImage(tinted(sprite, m.variant % 2 ? "#86a9d6" : "#7c9fce") || sprite.img, m.x - w / 2, y, w, h);
      ctx.restore();
    }
  }

  function drawHills() {
    if (!hillSprite.loaded) return;
    const tileW = hillSprite.img.naturalWidth;
    const tileH = hillSprite.img.naturalHeight;
    const y = groundY() - tileH + 40;
    const offset = ((hillScrollX % tileW) + tileW) % tileW;
    let x = -offset;
    while (x < canvas.width) {
      ctx.drawImage(tinted(hillSprite, "#74c26e") || hillSprite.img, x, y, tileW, tileH);
      x += tileW;
    }
  }

  function drawTrees() {
    for (const t of trees) {
      const sprite = treeSprites[t.variant];
      if (!sprite.loaded) continue;
      const w = 66;
      const h = Math.min(220, w * (sprite.img.naturalHeight / sprite.img.naturalWidth));
      const y = groundY() - h + 12;
      if (t.x + w / 2 < 0 || t.x - w / 2 > canvas.width) continue;
      ctx.drawImage(tinted(sprite, t.variant % 2 ? "#2f8f4e" : "#3aa35c") || sprite.img, t.x - w / 2, y, w, h);
    }
  }

  function currentPlayerSprite() {
    if (performance.now() < invincibleUntil) return playerSprites.hurt;
    if (!grounded) return playerVelY > 0 ? playerSprites.jump : playerSprites.fall;
    if (ducking) return playerSprites.duck;
    return runFrame === 0 ? playerSprites.walk1 : playerSprites.walk2;
  }

  function drawPlayer(box) {
    const sprite = currentPlayerSprite();
    const now = performance.now();
    const invincible = now < invincibleUntil;
    const flashing = invincible && Math.floor(now / 100) % 2 === 0;
    if (sprite.loaded) {
      const drawW = 64;
      const drawH = drawW * (sprite.img.naturalHeight / sprite.img.naturalWidth);
      ctx.save();
      if (invincible) ctx.globalAlpha = flashing ? 0.4 : 1;
      ctx.drawImage(sprite.img, (box.left + box.right) / 2 - drawW / 2, box.bottom - drawH, drawW, drawH);
      ctx.restore();
    } else {
      ctx.fillStyle = flashing ? "rgba(74, 222, 128, 0.4)" : "#4ade80";
      ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc((box.left + box.right) / 2, box.top + 10, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function rand01(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  const SKY_PALETTES = [
    { top: [94, 180, 240], mid: [169, 220, 247], bot: [207, 233, 248], sun: [255, 250, 214], night: 0 }, // day
    { top: [62, 74, 150], mid: [240, 138, 106], bot: [251, 211, 141], sun: [255, 190, 130], night: 0.12 }, // dusk
    { top: [10, 16, 44], mid: [27, 42, 90], bot: [58, 74, 122], sun: [230, 236, 255], night: 0.5 }, // night
    { top: [88, 96, 170], mid: [244, 160, 150], bot: [253, 226, 170], sun: [255, 214, 160], night: 0.1 }, // dawn
  ];

  function skyState() {
    const cycle = (distanceScore / 700) % SKY_PALETTES.length;
    const i = Math.floor(cycle);
    const f = cycle - i;
    const k = f < 0.55 ? 0 : (f - 0.55) / 0.45; // hold each palette for a while, then blend to the next
    const A = SKY_PALETTES[i];
    const B = SKY_PALETTES[(i + 1) % SKY_PALETTES.length];
    const mix = (x, y) => Math.round(x + (y - x) * k);
    const col = (key) => `rgb(${mix(A[key][0], B[key][0])},${mix(A[key][1], B[key][1])},${mix(A[key][2], B[key][2])})`;
    return { top: col("top"), mid: col("mid"), bot: col("bot"), sun: col("sun"), night: A.night + (B.night - A.night) * k };
  }

  function drawSkyBackdrop() {
    const w = canvas.width;
    const h = canvas.height;
    const gy = groundY();
    const sky = skyState();
    const grad = ctx.createLinearGradient(0, 0, 0, gy);
    grad.addColorStop(0, sky.top);
    grad.addColorStop(0.6, sky.mid);
    grad.addColorStop(1, sky.bot);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // stars fade in as it gets dark
    if (sky.night > 0.15) {
      const t = performance.now() / 1000;
      const alpha = Math.min(1, (sky.night - 0.15) / 0.3);
      for (let i = 0; i < 60; i++) {
        const x = rand01(i * 3.1) * w;
        const y = rand01(i * 7.3 + 2) * gy * 0.7;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * (0.8 + rand01(i) * 1.5) + i));
        ctx.fillStyle = `rgba(255,255,255,${alpha * tw * 0.9})`;
        ctx.beginPath();
        ctx.arc(x, y, 0.9 + rand01(i * 2.2) * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // sun (or moon at night) with a halo
    const sx = w * 0.78;
    const sy = gy * 0.28 + sky.night * gy * 0.05;
    const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, gy * 0.7);
    halo.addColorStop(0, "rgba(255,246,196,0.7)");
    halo.addColorStop(0.3, "rgba(255,240,170,0.22)");
    halo.addColorStop(1, "rgba(255,240,170,0)");
    ctx.globalAlpha = 1 - sky.night * 0.9;
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, gy);
    ctx.globalAlpha = 1;
    ctx.fillStyle = sky.sun;
    ctx.beginPath();
    ctx.arc(sx, sy, 26, 0, Math.PI * 2);
    ctx.fill();
    if (sky.night > 0.3) {
      ctx.fillStyle = "rgba(20,30,70,0.35)";
      ctx.beginPath();
      ctx.arc(sx + 9, sy - 4, 22, 0, Math.PI * 2);
      ctx.fill();
    }

    // slow parallax clouds built from overlapping circles
    const drift = hillScrollX * 0.18;
    const cloudA = 0.8 - sky.night * 0.5;
    for (let i = 0; i < 6; i++) {
      const span = w + 320;
      const cx = (((rand01(i * 3.3) * span - drift * (0.6 + rand01(i) * 0.5)) % span) + span) % span - 160;
      const cy = 40 + rand01(i * 8.1) * gy * 0.42;
      const sc = 0.7 + rand01(i * 2.7) * 0.7;
      ctx.fillStyle = `rgba(255,255,255,${cloudA})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 20 * sc, 0, Math.PI * 2);
      ctx.arc(cx + 24 * sc, cy - 10 * sc, 26 * sc, 0, Math.PI * 2);
      ctx.arc(cx + 54 * sc, cy, 20 * sc, 0, Math.PI * 2);
      ctx.arc(cx + 26 * sc, cy + 6 * sc, 22 * sc, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawGround() {
    const w = canvas.width;
    const h = canvas.height;
    const gy = groundY();
    const scroll = hillScrollX / 0.4; // world scroll (hills move at 0.4x the world)

    const grass = ctx.createLinearGradient(0, gy, 0, gy + 22);
    grass.addColorStop(0, "#7ed957");
    grass.addColorStop(1, "#4fae3f");
    ctx.fillStyle = grass;
    ctx.fillRect(0, gy, w, 22);

    const dirt = ctx.createLinearGradient(0, gy + 22, 0, h);
    dirt.addColorStop(0, "#a47148");
    dirt.addColorStop(1, "#6e4626");
    ctx.fillStyle = dirt;
    ctx.fillRect(0, gy + 22, w, h - gy - 22);

    // grass fringe hanging over the dirt
    ctx.fillStyle = "#4fae3f";
    ctx.beginPath();
    ctx.moveTo(0, gy + 20);
    for (let x = 0; x <= w; x += 12) {
      ctx.lineTo(x, gy + 22 + 5 + Math.sin((x + scroll) * 0.09) * 3);
      ctx.lineTo(x + 6, gy + 20);
    }
    ctx.lineTo(w, gy + 20);
    ctx.closePath();
    ctx.fill();

    // bright edge highlight along the top of the grass
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(0, gy, w, 2);

    // scrolling grass blades on the surface
    ctx.strokeStyle = "rgba(38,120,40,0.55)";
    ctx.lineWidth = 2;
    const period = 34;
    const off = ((scroll % period) + period) % period;
    for (let x = -off; x < w + period; x += period) {
      ctx.beginPath();
      ctx.moveTo(x, gy + 1);
      ctx.lineTo(x - 3, gy - 7);
      ctx.moveTo(x + 5, gy + 1);
      ctx.lineTo(x + 6, gy - 9);
      ctx.moveTo(x + 10, gy + 1);
      ctx.lineTo(x + 13, gy - 6);
      ctx.stroke();
    }

    // pebbles and roots in the dirt, scrolling with the world
    const dirtPeriod = 90;
    const dOff = ((scroll % dirtPeriod) + dirtPeriod) % dirtPeriod;
    for (let i = -1; i < w / dirtPeriod + 2; i++) {
      const bx = i * dirtPeriod - dOff;
      const idx = i + Math.floor(scroll / dirtPeriod);
      const py = gy + 34 + rand01(idx * 1.9) * (h - gy - 50);
      ctx.fillStyle = "rgba(0,0,0,0.16)";
      ctx.beginPath();
      ctx.ellipse(bx + rand01(idx) * 60, py, 7 + rand01(idx * 3.1) * 6, 4 + rand01(idx * 5.3) * 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,230,190,0.12)";
      ctx.beginPath();
      ctx.ellipse(bx + rand01(idx) * 60 - 2, py - 1.5, 4, 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawShadow(cx, width, alpha) {
    ctx.fillStyle = `rgba(20,50,20,${alpha})`;
    ctx.beginPath();
    ctx.ellipse(cx, groundY() + 5, width / 2, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw() {
    drawSkyBackdrop();
    drawMountains();
    drawHills();
    drawGround();

    drawTrees();

    const nightAmt = skyState().night;
    if (nightAmt > 0.02) {
      ctx.fillStyle = `rgba(8,16,52,${nightAmt * 0.5})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    for (const o of obstacles) {
      if (!o.overhead) drawShadow(o.x + o.width / 2, o.width * 1.1, 0.28);
    }

    const t = performance.now() / 1000;
    for (const c of coins) {
      if (c.taken) continue;
      const halo = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r * 2.2);
      halo.addColorStop(0, "rgba(255,220,80,0.45)");
      halo.addColorStop(1, "rgba(255,220,80,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r * 2.2, 0, Math.PI * 2);
      ctx.fill();
      if (coinSprite.loaded) {
        const s = c.r * 2.4;
        const spin = Math.max(0.25, Math.abs(Math.cos(t * 3 + c.x * 0.01)));
        ctx.drawImage(coinSprite.img, c.x - (s * spin) / 2, c.y - s / 2, s * spin, s);
      } else {
        ctx.fillStyle = "#fbbf24";
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const o of obstacles) {
      const sprite = o.overhead ? spikeBallSprite : cactusSprite;
      if (sprite.loaded) {
        ctx.drawImage(sprite.img, o.x, o.y, o.width, o.height);
      } else {
        ctx.fillStyle = o.overhead ? "#f87171" : "#fb923c";
        ctx.fillRect(o.x, o.y, o.width, o.height);
      }
    }

    const box = playerHitbox();
    const lift = Math.max(0, groundY() - box.bottom);
    drawShadow((box.left + box.right) / 2, 46 * Math.max(0.5, 1 - lift / 260), Math.max(0.1, 0.32 - lift / 700));
    drawPlayer(box);

    for (const d of dust) {
      const a = Math.max(0, d.life / d.max);
      ctx.fillStyle = `rgba(226,214,190,${0.55 * a})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * (1.4 - a * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function isOver() {
    return gameOver;
  }

  function getHud() {
    return { left: `⭐ ${Math.floor(distanceScore)}   🪙 ${runCoins}`, right: "❤".repeat(Math.max(0, lives)) || "💔" };
  }

  function getOverResult() {
    const finalScore = Math.floor(distanceScore);
    return {
      title: "Game Over",
      message: `Score: ${finalScore} (Best: ${best})  •  +${runCoins} coins earned`,
    };
  }

  function getPauseInfo() {
    const options = [];
    if (saveData.extraLifeLevel < MAX_UPGRADE_LEVEL) {
      options.push({
        id: "extra-life",
        label: `Extra Life (Lv.${saveData.extraLifeLevel})`,
        cost: upgradeCost(saveData.extraLifeLevel),
      });
    }
    if (saveData.headStartLevel < MAX_UPGRADE_LEVEL) {
      options.push({
        id: "head-start",
        label: `Head Start (Lv.${saveData.headStartLevel})`,
        cost: upgradeCost(saveData.headStartLevel),
      });
    }
    return { coins: saveData.coins, options };
  }

  function applyUpgrade(id) {
    if (id === "extra-life" && saveData.extraLifeLevel < MAX_UPGRADE_LEVEL) {
      const cost = upgradeCost(saveData.extraLifeLevel);
      if (saveData.coins < cost) return false;
      saveData.coins -= cost;
      saveData.extraLifeLevel += 1;
      writeSaveData(saveData);
      return true;
    }
    if (id === "head-start" && saveData.headStartLevel < MAX_UPGRADE_LEVEL) {
      const cost = upgradeCost(saveData.headStartLevel);
      if (saveData.coins < cost) return false;
      saveData.coins -= cost;
      saveData.headStartLevel += 1;
      writeSaveData(saveData);
      return true;
    }
    return false;
  }

  function save() {
    bankRunCoins();
  }

  return {
    id: "runner",
    title: "Endless Runner",
    thumbnail: "Asset/endless_runner_Thumbnail.jpg",
    description: "Jump and duck with arrow keys. Collect coins to buy upgrades — an extra life or a slower start.",
    reset,
    update,
    draw,
    isOver,
    getHud,
    getOverResult,
    getPauseInfo,
    applyUpgrade,
    save,
  };
}
