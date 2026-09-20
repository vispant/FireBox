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
const REACH_SAFETY = 0.78; // shrink the physics-perfect reach so it doesn't require frame-perfect steering
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

// How far sideways the character can actually travel, starting from a dead
// stop, before it falls back down through a point `spacing` above the bounce
// origin — collision only triggers while falling (see the `velY > 0` guard in
// update()), so that's the real deadline, not the moment it first rises past
// that height. Without this, spawnPlatform() picked x completely at random
// and could place two platforms further apart horizontally than any amount
// of steering could cover in the time available, making them unreachable.
function maxHorizontalReach(spacing) {
  const a = GRAVITY / 2;
  const b = -BOUNCE_VELOCITY;
  const c = spacing;
  const discriminant = b * b - 4 * a * c;
  if (discriminant <= 0) return 0; // spacing exceeds the max reachable height entirely
  const fallThroughTime = (-b + Math.sqrt(discriminant)) / (2 * a);
  const accelTime = HORIZONTAL_MAX_SPEED / HORIZONTAL_ACCEL;
  let distance;
  if (fallThroughTime <= accelTime) {
    distance = 0.5 * HORIZONTAL_ACCEL * fallThroughTime * fallThroughTime;
  } else {
    const accelDistance = 0.5 * HORIZONTAL_ACCEL * accelTime * accelTime;
    distance = accelDistance + HORIZONTAL_MAX_SPEED * (fallThroughTime - accelTime);
  }
  return distance * REACH_SAFETY;
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
  let lastPlatformCenterX = 0;
  let nextCloudTop = 0;
  let groundY = 0;
  let sunWorldY = 0;
  let score = 0;
  let runCoins = 0;
  let lives = 1;
  let gameOver = true;
  let leftHeld = false;
  let rightHeld = false;
  let fx = []; // dust puffs and coin sparkles (world coordinates)

  window.addEventListener("keydown", (e) => {
    if (gameOver) return;
    if (e.code === "ArrowLeft" || e.code === "KeyA") leftHeld = true;
    if (e.code === "ArrowRight" || e.code === "KeyD") rightHeld = true;
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") leftHeld = false;
    if (e.code === "ArrowRight" || e.code === "KeyD") rightHeld = false;
  });

  function puff(x, y) {
    for (let i = 0; i < 9; i++) {
      fx.push({ x: x + (Math.random() - 0.5) * 30, y, vx: (Math.random() - 0.5) * 150, vy: -10 - Math.random() * 50, life: 0.5, max: 0.5, r: 3 + Math.random() * 4, color: "255,255,255", g: 40 });
    }
  }

  function sparkle(x, y) {
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI * 2 * i) / 12;
      const sp = 60 + Math.random() * 90;
      fx.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5, max: 0.5, r: 2.5 + Math.random() * 2, color: "253,224,71", g: 120 });
    }
  }

  function platformWidth() {
    return Math.max(PLATFORM_WIDTH_MIN, PLATFORM_WIDTH_BASE - Math.min(score, 400) * 0.05 + saveData.wideLevel * 12);
  }

  function spawnPlatform(topY, spacing) {
    const w = platformWidth();
    const reach = maxHorizontalReach(spacing);
    const minCenter = Math.max(w / 2, lastPlatformCenterX - reach);
    const maxCenter = Math.min(canvas.width - w / 2, lastPlatformCenterX + reach);
    const centerX = minCenter >= maxCenter ? Math.max(w / 2, Math.min(canvas.width - w / 2, lastPlatformCenterX)) : minCenter + Math.random() * (maxCenter - minCenter);
    const x = centerX - w / 2;
    lastPlatformCenterX = centerX;
    platforms.push({ x, y: topY, width: w });
    if (Math.random() < COIN_CHANCE) {
      coins.push({ x: x + w / 2, y: topY - 28, taken: false });
    }
  }

  function fillPlatformsUpTo(targetTop) {
    while (nextPlatformTop > targetTop) {
      const spacing = PLATFORM_SPACING_MIN + Math.random() * (PLATFORM_SPACING_MAX - PLATFORM_SPACING_MIN);
      nextPlatformTop -= spacing;
      spawnPlatform(nextPlatformTop, spacing);
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
    lastPlatformCenterX = canvas.width / 2;
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
    fx = [];
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
          puff(charX, p.y);
          break;
        }
      }
    }

    for (const c of coins) {
      if (c.taken) continue;
      if (Math.hypot(charX - c.x, charY - c.y) < CHARACTER_RADIUS * 0.7 + COIN_RADIUS) {
        c.taken = true;
        runCoins += COIN_VALUE;
        sparkle(c.x, c.y);
      }
    }

    for (const p of fx) {
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.vy += p.g * dtSec;
      p.life -= dtSec;
    }
    fx = fx.filter((p) => p.life > 0);

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

  function rand01(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function drawStars(climbT) {
    if (climbT < 0.3) return;
    const alpha = Math.min(1, (climbT - 0.3) / 0.4);
    const t = performance.now() / 1000;
    for (let i = 0; i < 70; i++) {
      const x = rand01(i * 2.7) * canvas.width;
      const y = (((rand01(i * 6.1) * canvas.height * 1.4 - cameraY * 0.06) % (canvas.height * 1.4)) + canvas.height * 1.4) % (canvas.height * 1.4);
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * (0.7 + rand01(i) * 1.6) + i));
      ctx.fillStyle = `rgba(255,255,255,${alpha * tw * 0.85})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + rand01(i * 1.3) * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPlatform(p, y) {
    const w = p.width;
    const h = Math.max(PLATFORM_HEIGHT + 14, w * 0.36);
    // soft cast shadow underneath
    ctx.fillStyle = "rgba(20,40,80,0.18)";
    ctx.beginPath();
    ctx.ellipse(p.x + w / 2, y + h + 4, w * 0.42, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // earth body with a rounded, tapering underside
    const earth = ctx.createLinearGradient(0, y, 0, y + h);
    earth.addColorStop(0, "#c98d54");
    earth.addColorStop(1, "#8a5a30");
    ctx.fillStyle = earth;
    ctx.beginPath();
    ctx.moveTo(p.x, y + 6);
    ctx.lineTo(p.x + w, y + 6);
    ctx.quadraticCurveTo(p.x + w * 0.98, y + h * 0.8, p.x + w * 0.78, y + h);
    ctx.lineTo(p.x + w * 0.22, y + h);
    ctx.quadraticCurveTo(p.x + w * 0.02, y + h * 0.8, p.x, y + 6);
    ctx.closePath();
    ctx.fill();
    // strata lines
    ctx.strokeStyle = "rgba(90,50,20,0.28)";
    ctx.lineWidth = 2;
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(p.x + w * 0.08, y + 6 + i * (h - 6) * 0.3);
      ctx.bezierCurveTo(p.x + w * 0.35, y + 3 + i * (h - 6) * 0.3, p.x + w * 0.65, y + 9 + i * (h - 6) * 0.3, p.x + w * 0.92, y + 6 + i * (h - 6) * 0.3);
      ctx.stroke();
    }
    // grass cap with a scalloped lower edge
    const grass = ctx.createLinearGradient(0, y - 4, 0, y + 14);
    grass.addColorStop(0, "#5fe06a");
    grass.addColorStop(1, "#2fae4a");
    ctx.fillStyle = grass;
    ctx.beginPath();
    ctx.moveTo(p.x - 2, y - 2);
    ctx.lineTo(p.x + w + 2, y - 2);
    ctx.lineTo(p.x + w + 2, y + 9);
    const bumps = Math.max(4, Math.round(w / 18));
    ctx.lineTo(p.x + w, y + 9);
    for (let i = bumps; i >= 1; i--) {
      const bx = p.x + (w * i) / bumps;
      const nx = p.x + (w * (i - 1)) / bumps;
      ctx.quadraticCurveTo((bx + nx) / 2, y + 17, nx, y + 9);
    }
    ctx.lineTo(p.x - 2, y + 9);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.32)";
    ctx.fillRect(p.x + 4, y - 1, w - 8, 3);
    // tiny flowers/blades
    ctx.strokeStyle = "#1f8a3a";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < Math.floor(w / 22); i++) {
      const gx = p.x + 10 + i * 22 + rand01(p.x + i) * 6;
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.lineTo(gx - 2, y - 6);
      ctx.moveTo(gx + 3, y);
      ctx.lineTo(gx + 4, y - 7);
      ctx.stroke();
    }
  }

  function draw() {
    const climbT = Math.min(1, score / 600);
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, `rgb(${Math.round(135 - climbT * 110)}, ${Math.round(206 - climbT * 160)}, ${Math.round(250 - climbT * 100)})`);
    grad.addColorStop(1, `rgb(${Math.round(224 - climbT * 190)}, ${Math.round(242 - climbT * 210)}, ${Math.round(255 - climbT * 200)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawStars(climbT);
    drawSun();
    drawClouds();
    drawGroundScene();

    for (const p of platforms) {
      const y = p.y - cameraY;
      if (y < -80 || y > canvas.height + 80) continue;
      drawPlatform(p, y);
    }

    const spin0 = performance.now() / 300;
    for (const c of coins) {
      if (c.taken) continue;
      const y = c.y - cameraY;
      if (y < -30 || y > canvas.height + 30) continue;
      const halo = ctx.createRadialGradient(c.x, y, 0, c.x, y, COIN_RADIUS * 2.4);
      halo.addColorStop(0, "rgba(255,225,90,0.5)");
      halo.addColorStop(1, "rgba(255,225,90,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(c.x, y, COIN_RADIUS * 2.4, 0, Math.PI * 2);
      ctx.fill();
      if (coinSprite.loaded) {
        const s = COIN_RADIUS * 2.4;
        const spin = Math.max(0.3, Math.abs(Math.cos(spin0 + c.x * 0.02)));
        ctx.drawImage(coinSprite.img, c.x - (s * spin) / 2, y - s / 2, s * spin, s);
      } else {
        ctx.fillStyle = "#fbbf24";
        ctx.beginPath();
        ctx.arc(c.x, y, COIN_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const p of fx) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = `rgb(${p.color})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y - cameraY, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

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
    thumbnail: "Asset/sky_hopper_Thumbnail.jpg",
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
