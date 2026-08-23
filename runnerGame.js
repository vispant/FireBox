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
      playerHeight = 0;
      playerVelY = 0;
      grounded = true;
    }

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
      ctx.globalAlpha = 0.6;
      ctx.drawImage(sprite.img, m.x - w / 2, y, w, h);
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
      ctx.drawImage(hillSprite.img, x, y, tileW, tileH);
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
      ctx.drawImage(sprite.img, t.x - w / 2, y, w, h);
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

  function draw() {
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, "#8ecdf5");
    grad.addColorStop(1, "#eaf6fb");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawMountains();
    drawHills();

    ctx.fillStyle = "#8bd17a";
    ctx.fillRect(0, groundY(), canvas.width, canvas.height - groundY());
    ctx.strokeStyle = "#5fae5a";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, groundY());
    ctx.lineTo(canvas.width, groundY());
    ctx.stroke();

    drawTrees();

    for (const c of coins) {
      if (c.taken) continue;
      if (coinSprite.loaded) {
        const s = c.r * 2.4;
        ctx.drawImage(coinSprite.img, c.x - s / 2, c.y - s / 2, s, s);
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

    drawPlayer(playerHitbox());
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
    thumbnail: null,
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
