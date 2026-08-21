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

  let playerHeight = 0;
  let playerVelY = 0;
  let ducking = false;
  let grounded = true;

  let obstacles = [];
  let coins = [];
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
    obstacles = [];
    coins = [];
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

  function draw() {
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, "#1e293b");
    grad.addColorStop(1, "#0f172a");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, groundY());
    ctx.lineTo(canvas.width, groundY());
    ctx.stroke();

    ctx.fillStyle = "#fbbf24";
    for (const c of coins) {
      if (c.taken) continue;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const o of obstacles) {
      ctx.fillStyle = o.overhead ? "#f87171" : "#fb923c";
      ctx.fillRect(o.x, o.y, o.width, o.height);
    }

    const box = playerHitbox();
    const flashing = performance.now() < invincibleUntil && Math.floor(performance.now() / 100) % 2 === 0;
    ctx.fillStyle = flashing ? "rgba(74, 222, 128, 0.4)" : "#4ade80";
    ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc((box.left + box.right) / 2, box.top + 10, 4, 0, Math.PI * 2);
    ctx.fill();
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
