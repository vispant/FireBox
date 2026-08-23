const GRAVITY = 1400;
const BOUNCE_VELOCITY = 650;
const HORIZONTAL_ACCEL = 1100;
const HORIZONTAL_MAX_SPEED = 340;
const HORIZONTAL_DAMPING = 3.2; // higher = stops faster once you let go
const CHARACTER_RADIUS = 26;
const PLATFORM_HEIGHT = 16;
const PLATFORM_WIDTH_BASE = 92;
const PLATFORM_WIDTH_MIN = 58;
const PLATFORM_SPACING_MIN = 68;
const PLATFORM_SPACING_MAX = 118;
const CAMERA_FOLLOW_RATIO = 0.42;
const COIN_RADIUS = 9;
const COIN_VALUE = 5;
const COIN_CHANCE = 0.35;
const MAX_UPGRADE_LEVEL = 3;
const SAFETY_BOUNCE_VELOCITY = 900;
const CLOUD_SPACING_MIN = 220;
const CLOUD_SPACING_MAX = 380;

const SAVE_KEY = "fireBox.hopper.save.v1";
const BEST_SCORE_KEY = "fireBox.hopper.bestScore.v1";
const CHARACTER_SRC = "Asset/kenney_animal-pack/PNG/Round/penguin.png";
const PLATFORM_SRC = "Asset/kenney_jumper-pack/PNG/Environment/ground_grass_small.png";
const COIN_SRC = "Asset/kenney_jumper-pack/PNG/HUD/coin_gold.png";
const HILL_FAR_SRC = "Asset/kenney_jumper-pack/PNG/Background/bg_layer3.png";
const HILL_NEAR_SRC = "Asset/kenney_jumper-pack/PNG/Background/bg_layer4.png";
const SUN_SRC = "Asset/kenney_background-elements/PNG/sun.png";
const CLOUD_SRCS = [
  "Asset/kenney_background-elements/PNG/Flat/cloud1.png",
  "Asset/kenney_background-elements/PNG/Flat/cloud3.png",
  "Asset/kenney_background-elements/PNG/Flat/cloud5.png",
  "Asset/kenney_background-elements/PNG/Flat/cloud7.png",
  "Asset/kenney_background-elements/PNG/Flat/cloud9.png",
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
    if (!raw) return { coins: 0, extraLifeLevel: 0, wideLevel: 0 };
    const parsed = JSON.parse(raw);
    return {
      coins: parsed.coins || 0,
      extraLifeLevel: parsed.extraLifeLevel || 0,
      wideLevel: parsed.wideLevel || 0,
    };
  } catch {
    return { coins: 0, extraLifeLevel: 0, wideLevel: 0 };
  }
}

function writeSaveData(saveData) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
  } catch {}
}

function upgradeCost(level) {
  return 40 + level * 45;
}

export function createHopperGame({ canvas, ctx }) {
  let saveData = loadSaveData();
  let best = 0;
  try {
    best = Number(localStorage.getItem(BEST_SCORE_KEY)) || 0;
  } catch {}

  const characterImg = new Image();
  let characterImgLoaded = false;
  characterImg.onload = () => {
    characterImgLoaded = true;
  };
  characterImg.src = CHARACTER_SRC;

  const platformSprite = loadSprite(PLATFORM_SRC);
  const coinSprite = loadSprite(COIN_SRC);
  const hillFarSprite = loadSprite(HILL_FAR_SRC);
  const hillNearSprite = loadSprite(HILL_NEAR_SRC);
  const sunSprite = loadSprite(SUN_SRC);
  const cloudSprites = CLOUD_SRCS.map(loadSprite);

  let charX = 0;
  let charY = 0;
  let velX = 0;
  let velY = 0;
  let facing = 1;
  let squash = 1; // visual squash/stretch factor, 1 = neutral
  let cameraY = 0;
  let platforms = [];
  let coins = [];
  let clouds = [];
  let nextPlatformTop = 0;
  let nextCloudTop = 0;
  let groundY = 0;
  let sunWorldY = 0;
  let score = 0;
  let runCoins = 0;
  let lives = 1;
  let gameOver = true;
  let leftHeld = false;
  let rightHeld = false;

  window.addEventListener("keydown", (e) => {
    if (gameOver) return;
    if (e.code === "ArrowLeft" || e.code === "KeyA") leftHeld = true;
    if (e.code === "ArrowRight" || e.code === "KeyD") rightHeld = true;
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") leftHeld = false;
    if (e.code === "ArrowRight" || e.code === "KeyD") rightHeld = false;
  });

  function platformWidth() {
    return Math.max(PLATFORM_WIDTH_MIN, PLATFORM_WIDTH_BASE - Math.min(score, 400) * 0.05 + saveData.wideLevel * 12);
  }

  function spawnPlatform(topY) {
    const w = platformWidth();
    const x = Math.random() * (canvas.width - w);
    platforms.push({ x, y: topY, width: w });
    if (Math.random() < COIN_CHANCE) {
      coins.push({ x: x + w / 2, y: topY - 28, taken: false });
    }
  }

  function fillPlatformsUpTo(targetTop) {
    while (nextPlatformTop > targetTop) {
      const spacing = PLATFORM_SPACING_MIN + Math.random() * (PLATFORM_SPACING_MAX - PLATFORM_SPACING_MIN);
      nextPlatformTop -= spacing;
      spawnPlatform(nextPlatformTop);
    }
  }

  function spawnCloud(topY) {
    clouds.push({
      x: Math.random() * canvas.width,
      y: topY,
      variant: Math.floor(Math.random() * cloudSprites.length),
      scale: 0.7 + Math.random() * 0.5,
    });
  }

  function fillCloudsUpTo(targetTop) {
    while (nextCloudTop > targetTop) {
      const spacing = CLOUD_SPACING_MIN + Math.random() * (CLOUD_SPACING_MAX - CLOUD_SPACING_MIN);
      nextCloudTop -= spacing;
      spawnCloud(nextCloudTop);
    }
  }

  function bankRunCoins() {
    if (runCoins > 0) {
      saveData.coins += runCoins;
      writeSaveData(saveData);
      runCoins = 0;
    }
  }

  function reset() {
    saveData = loadSaveData();
    charX = canvas.width / 2;
    charY = canvas.height - 120;
    velX = 0;
    velY = -BOUNCE_VELOCITY * 0.6;
    facing = 1;
    squash = 1;
    cameraY = 0;
    groundY = canvas.height - 60;
    sunWorldY = groundY - 3200;
    platforms = [{ x: canvas.width / 2 - 60, y: canvas.height - 60, width: 120 }];
    coins = [];
    nextPlatformTop = canvas.height - 60;
    fillPlatformsUpTo(-canvas.height * 1.5);
    clouds = [];
    nextCloudTop = canvas.height - 60;
    fillCloudsUpTo(-canvas.height * 1.5);
    score = 0;
    runCoins = 0;
    lives = 1 + saveData.extraLifeLevel;
    leftHeld = false;
    rightHeld = false;
    gameOver = false;
  }

  function endGame() {
    gameOver = true;
    const finalScore = Math.floor(score);
    if (finalScore > best) {
      best = finalScore;
      try {
        localStorage.setItem(BEST_SCORE_KEY, String(best));
      } catch {}
    }
    bankRunCoins();
  }

  function update(dt) {
    if (gameOver) return;
    const dtSec = Math.min(dt, 50) / 1000;

    if (leftHeld) {
      velX -= HORIZONTAL_ACCEL * dtSec;
      facing = -1;
    }
    if (rightHeld) {
      velX += HORIZONTAL_ACCEL * dtSec;
      facing = 1;
    }
    if (!leftHeld && !rightHeld) {
      velX -= velX * Math.min(1, HORIZONTAL_DAMPING * dtSec);
    }
    velX = Math.max(-HORIZONTAL_MAX_SPEED, Math.min(HORIZONTAL_MAX_SPEED, velX));

    const prevY = charY;
    velY += GRAVITY * dtSec;
    charX += velX * dtSec;
    charY += velY * dtSec;

    if (charX < -CHARACTER_RADIUS) charX = canvas.width + CHARACTER_RADIUS;
    if (charX > canvas.width + CHARACTER_RADIUS) charX = -CHARACTER_RADIUS;

    if (velY > 0) {
      for (const p of platforms) {
        const feet = charY + CHARACTER_RADIUS * 0.7;
        const prevFeet = prevY + CHARACTER_RADIUS * 0.7;
        if (
          prevFeet <= p.y &&
          feet >= p.y &&
          charX + CHARACTER_RADIUS * 0.6 > p.x &&
          charX - CHARACTER_RADIUS * 0.6 < p.x + p.width
        ) {
          velY = -BOUNCE_VELOCITY;
          squash = 1.5;
          break;
        }
      }
    }

    for (const c of coins) {
      if (c.taken) continue;
      if (Math.hypot(charX - c.x, charY - c.y) < CHARACTER_RADIUS * 0.7 + COIN_RADIUS) {
        c.taken = true;
        runCoins += COIN_VALUE;
      }
    }

    squash += (1 - squash) * Math.min(1, dtSec * 6);

    const screenY = charY - cameraY;
    const followLine = canvas.height * CAMERA_FOLLOW_RATIO;
    if (screenY < followLine) {
      cameraY -= followLine - screenY;
    }
    score = Math.max(score, Math.round((canvas.height - 60 - charY) / 10));

    fillPlatformsUpTo(cameraY - canvas.height * 0.5);
    platforms = platforms.filter((p) => p.y - cameraY < canvas.height + 200);
    coins = coins.filter((c) => !c.taken && c.y - cameraY < canvas.height + 200);

    fillCloudsUpTo(cameraY - canvas.height * 0.5);
    clouds = clouds.filter((c) => c.y - cameraY < canvas.height + 300);

    if (charY - cameraY > canvas.height + CHARACTER_RADIUS) {
      if (lives > 1) {
        lives -= 1;
        charY = cameraY + canvas.height - 80;
        velY = -SAFETY_BOUNCE_VELOCITY;
        squash = 1.6;
      } else {
        endGame();
      }
    }
  }

  function drawCharacter() {
    const screenX = charX;
    const screenY = charY - cameraY;
    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.scale(facing * (2 - squash) * 0.55, squash * 0.55);
    if (characterImgLoaded) {
      const s = CHARACTER_RADIUS * 2;
      ctx.drawImage(characterImg, -s / 2, -s / 2, s, s);
    } else {
      ctx.fillStyle = "#38bdf8";
      ctx.beginPath();
      ctx.arc(0, 0, CHARACTER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSun() {
    if (!sunSprite.loaded) return;
    const y = sunWorldY - cameraY;
    const size = 150;
    if (y < -size || y > canvas.height + size) return;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(sunSprite.img, canvas.width * 0.72 - size / 2, y - size / 2, size, size);
    ctx.restore();
  }

  function drawClouds() {
    for (const c of clouds) {
      const y = c.y - cameraY;
      if (y < -180 || y > canvas.height + 180) continue;
      const sprite = cloudSprites[c.variant];
      if (!sprite.loaded) continue;
      const w = 130 * c.scale;
      const h = w * (sprite.img.naturalHeight / sprite.img.naturalWidth);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(sprite.img, c.x - w / 2, y - h / 2, w, h);
      ctx.restore();
    }
  }

  function drawGroundScene() {
    const size = canvas.width;
    for (const sprite of [hillFarSprite, hillNearSprite]) {
      if (!sprite.loaded) continue;
      const worldTopY = sprite === hillFarSprite ? groundY - size * 0.6 : groundY - size * 0.56;
      const y = worldTopY - cameraY;
      if (y > canvas.height || y + size < 0) continue;
      ctx.drawImage(sprite.img, 0, y, size, size);
    }
  }

  function draw() {
    const climbT = Math.min(1, score / 600);
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, `rgb(${Math.round(135 - climbT * 110)}, ${Math.round(206 - climbT * 160)}, ${Math.round(250 - climbT * 100)})`);
    grad.addColorStop(1, `rgb(${Math.round(224 - climbT * 190)}, ${Math.round(242 - climbT * 210)}, ${Math.round(255 - climbT * 200)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawSun();
    drawClouds();
    drawGroundScene();

    for (const p of platforms) {
      const y = p.y - cameraY;
      if (y < -80 || y > canvas.height + 80) continue;
      if (platformSprite.loaded) {
        const h = p.width * (platformSprite.img.naturalHeight / platformSprite.img.naturalWidth);
        ctx.drawImage(platformSprite.img, p.x, y, p.width, h);
      } else {
        ctx.fillStyle = "#4ade80";
        ctx.fillRect(p.x, y, p.width, PLATFORM_HEIGHT);
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.fillRect(p.x, y, p.width, 4);
      }
    }

    for (const c of coins) {
      if (c.taken) continue;
      const y = c.y - cameraY;
      if (y < -20 || y > canvas.height + 20) continue;
      if (coinSprite.loaded) {
        const s = COIN_RADIUS * 2.4;
        ctx.drawImage(coinSprite.img, c.x - s / 2, y - s / 2, s, s);
      } else {
        ctx.fillStyle = "#fbbf24";
        ctx.beginPath();
        ctx.arc(c.x, y, COIN_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawCharacter();
  }

  function isOver() {
    return gameOver;
  }

  function getHud() {
    return { left: `⬆️ ${score}   🪙 ${runCoins}`, right: "❤".repeat(Math.max(0, lives)) || "💔" };
  }

  function getOverResult() {
    return {
      title: "You Fell!",
      message: `Height: ${score} (Best: ${best})  •  +${runCoins} coins earned`,
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
    if (saveData.wideLevel < MAX_UPGRADE_LEVEL) {
      options.push({
        id: "wide-platforms",
        label: `Wider Platforms (Lv.${saveData.wideLevel})`,
        cost: upgradeCost(saveData.wideLevel),
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
    if (id === "wide-platforms" && saveData.wideLevel < MAX_UPGRADE_LEVEL) {
      const cost = upgradeCost(saveData.wideLevel);
      if (saveData.coins < cost) return false;
      saveData.coins -= cost;
      saveData.wideLevel += 1;
      writeSaveData(saveData);
      return true;
    }
    return false;
  }

  function save() {
    bankRunCoins();
  }

  return {
    id: "hopper",
    title: "Sky Hopper",
    thumbnail: null,
    description: "Bounce as high as you can! Steer left and right to land on platforms — don't look down.",
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
