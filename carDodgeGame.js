const LANE_COUNT = 3;
const ROAD_WIDTH_RATIO = 0.42; // narrower road -> tighter lanes relative to car size
const PLAYER_Y_RATIO = 0.8;
const PLAYER_WIDTH = 56;
const PLAYER_HEIGHT = 96;
const CAR_WIDTH = 56;
const CAR_HEIGHT = 96;
const HITBOX_SHRINK = 0.8; // hitboxes are a bit smaller than the drawn car — forgiving, standard practice
const LANE_CHANGE_SPEED = 900; // px/s the car eases toward its target lane at
const BASE_SPEED = 260;
const MAX_SPEED = 760; // ceiling for the passive speed ramp — boost can exceed this
const ACCEL_PER_SEC = 6.5;
const BOOST_MULT = 1.6;
const WAVE_GAP_MIN = 0.95;
const WAVE_GAP_MAX = 1.55;
const DANGER_WINDOW = 105; // px, longitudinal — a car this close counts as having been in real danger
const DANGER_LATERAL_RANGE = 90; // px, lateral — roughly a lane's width either side of the player
const CLOSE_CALL_BONUS = 25;
const COIN_RADIUS = 9;
const COIN_VALUE = 10;
const COIN_CHANCE_PER_WAVE = 0.6;
const TREE_SPACING_MIN = 140;
const TREE_SPACING_MAX = 260;
const SPEED_LINE_COUNT = 14;
const BEST_KEY = "fireBox.highwayDodge.best.v1";
const SAVE_KEY = "fireBox.highwayDodge.save.v1";

const TREE_SRCS = [
  "Asset/kenney_background-elements/PNG/Flat/tree01.png",
  "Asset/kenney_background-elements/PNG/Flat/tree02.png",
  "Asset/kenney_background-elements/PNG/Flat/tree03.png",
  "Asset/kenney_background-elements/PNG/Flat/tree04.png",
];
const COIN_SRC = "Asset/kenney_jumper-pack/PNG/HUD/coin_gold.png";

// Ten cars — real top-down sprites from the Kenney Racing Pack (5 colors x 2
// sizes x 5 shape variants gives plenty of genuinely distinct combinations).
// hitboxScale lets a couple of cars (Titan, Hauler) feel appropriately bulky
// to actually dodge around, matching their names.
const CAR_CATALOG = [
  { id: "cruiser", name: "Cruiser", price: 0, color: "red", size: "normal", shape: 1, hitboxScale: 1.0 },
  { id: "bolt", name: "Bolt", price: 120, color: "yellow", size: "small", shape: 2, hitboxScale: 0.8 },
  { id: "titan", name: "Titan", price: 180, color: "blue", size: "normal", shape: 3, hitboxScale: 1.18 },
  { id: "peanut", name: "Peanut", price: 90, color: "green", size: "small", shape: 1, hitboxScale: 0.78 },
  { id: "reaper", name: "Reaper", price: 260, color: "black", size: "normal", shape: 5, hitboxScale: 1.02 },
  { id: "cab", name: "Cab", price: 140, color: "yellow", size: "normal", shape: 1, hitboxScale: 1.0 },
  { id: "justice", name: "Justice", price: 220, color: "blue", size: "small", shape: 5, hitboxScale: 0.85 },
  { id: "breeze", name: "Breeze", price: 200, color: "green", size: "normal", shape: 4, hitboxScale: 0.96 },
  { id: "hauler", name: "Hauler", price: 160, color: "black", size: "normal", shape: 3, hitboxScale: 1.2 },
  { id: "vortex", name: "Vortex", price: 320, color: "red", size: "small", shape: 2, hitboxScale: 0.88 },
];

function carSpriteSrc(car) {
  const sizePart = car.size === "small" ? "_small" : "";
  return `Asset/highway_dodger/PNG/Cars/car_${car.color}${sizePart}_${car.shape}.png`;
}

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

function loadSaveData() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { coins: 0, ownedCarIds: ["cruiser"], selectedCarId: "cruiser" };
    const parsed = JSON.parse(raw);
    const owned = Array.isArray(parsed.ownedCarIds) && parsed.ownedCarIds.length ? parsed.ownedCarIds : ["cruiser"];
    return {
      coins: parsed.coins || 0,
      ownedCarIds: owned,
      selectedCarId: owned.includes(parsed.selectedCarId) ? parsed.selectedCarId : owned[0],
    };
  } catch {
    return { coins: 0, ownedCarIds: ["cruiser"], selectedCarId: "cruiser" };
  }
}

function writeSaveData(saveData) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
  } catch {}
}

function carById(id) {
  return CAR_CATALOG.find((c) => c.id === id) || CAR_CATALOG[0];
}

export function createCarDodgeGame({ canvas, ctx }) {
  const carSprites = {};
  for (const car of CAR_CATALOG) carSprites[car.id] = loadSprite(carSpriteSrc(car));

  function carDrawSize(car) {
    const sprite = carSprites[car.id];
    const targetW = CAR_WIDTH * car.hitboxScale;
    let aspect = car.size === "small" ? 1.65 : 1.85; // fallback before the sprite loads
    if (sprite && sprite.loaded && sprite.img.naturalWidth) {
      aspect = sprite.img.naturalHeight / sprite.img.naturalWidth;
    }
    return { w: targetW, h: targetW * aspect };
  }

  function drawCarSprite(targetCtx, x, y, car) {
    const sprite = carSprites[car.id];
    const { w, h } = carDrawSize(car);
    targetCtx.save();
    targetCtx.translate(x, y);
    targetCtx.fillStyle = "rgba(0,0,0,0.25)";
    targetCtx.beginPath();
    targetCtx.ellipse(0, h * 0.42, w * 0.55, h * 0.14, 0, 0, Math.PI * 2);
    targetCtx.fill();
    if (sprite.loaded) {
      targetCtx.drawImage(sprite.img, -w / 2, -h / 2, w, h);
    } else {
      targetCtx.fillStyle = "#94a3b8";
      targetCtx.beginPath();
      targetCtx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      targetCtx.fill();
    }
    targetCtx.restore();
    return { w, h };
  }

  const treeSprites = TREE_SRCS.map(loadSprite);
  const coinSprite = loadSprite(COIN_SRC);

  let saveData = loadSaveData();
  let best = loadBest();
  let isNewBest = false;
  let gameOver = true;

  let playerCar = carById(saveData.selectedCarId);
  let playerLane = 1;
  let playerX = 0;
  let playerY = 0;
  let boostHeld = false;

  let cars = [];
  let trees = [];
  let speedLines = [];
  let floaters = [];
  let coins = [];

  let elapsed = 0;
  let score = 0;
  let runCoins = 0;
  let closeCalls = 0;
  let waveTimer = 0;
  let nextTreeY = 0;

  window.addEventListener("keydown", (e) => {
    if (gameOver) return;
    if (!e.repeat) {
      if (e.code === "ArrowLeft" || e.code === "KeyA") {
        playerLane = Math.max(0, playerLane - 1);
        e.preventDefault();
      }
      if (e.code === "ArrowRight" || e.code === "KeyD") {
        playerLane = Math.min(LANE_COUNT - 1, playerLane + 1);
        e.preventDefault();
      }
    }
    if (e.code === "ArrowUp" || e.code === "KeyW" || e.code === "ShiftLeft" || e.code === "ShiftRight") {
      boostHeld = true;
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowUp" || e.code === "KeyW" || e.code === "ShiftLeft" || e.code === "ShiftRight") {
      boostHeld = false;
    }
  });

  function roadLeft() {
    return (canvas.width * (1 - ROAD_WIDTH_RATIO)) / 2;
  }

  function roadWidth() {
    return canvas.width * ROAD_WIDTH_RATIO;
  }

  function laneCenterX(lane) {
    const w = roadWidth() / LANE_COUNT;
    return roadLeft() + w * (lane + 0.5);
  }

  function rampSpeed() {
    return Math.min(MAX_SPEED, BASE_SPEED + elapsed * ACCEL_PER_SEC);
  }

  function currentSpeed() {
    const ramp = rampSpeed();
    return boostHeld ? ramp * BOOST_MULT : ramp;
  }

  function spawnWave() {
    const blockCount = 1 + Math.floor(Math.random() * (LANE_COUNT - 1)); // never blocks every lane
    const lanes = Array.from({ length: LANE_COUNT }, (_, i) => i);
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    const chosen = lanes.slice(0, blockCount);
    const open = lanes.slice(blockCount);
    for (const lane of chosen) {
      const def = CAR_CATALOG[Math.floor(Math.random() * CAR_CATALOG.length)];
      cars.push({
        lane,
        x: laneCenterX(lane),
        y: -CAR_HEIGHT,
        def,
        everThreatened: false,
        closeCallDone: false,
      });
    }
    if (open.length && Math.random() < COIN_CHANCE_PER_WAVE) {
      const lane = open[Math.floor(Math.random() * open.length)];
      coins.push({ x: laneCenterX(lane), y: -CAR_HEIGHT, taken: false });
    }
  }

  function spawnTree(y) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const margin = roadLeft() * 0.55;
    const x = side < 0 ? roadLeft() - margin - Math.random() * 30 : canvas.width - roadLeft() + margin + Math.random() * 30;
    trees.push({ x, y, variant: Math.floor(Math.random() * treeSprites.length) });
  }

  function fillTreesUpTo(targetY) {
    while (nextTreeY < targetY) {
      spawnTree(nextTreeY);
      nextTreeY += TREE_SPACING_MIN + Math.random() * (TREE_SPACING_MAX - TREE_SPACING_MIN);
    }
  }

  function spawnSpeedLine() {
    speedLines.push({
      x: roadLeft() + Math.random() * roadWidth(),
      y: -20,
      len: 30 + Math.random() * 50,
      speedMult: 1.4 + Math.random() * 0.5,
    });
  }

  function addFloater(x, y, text, color) {
    floaters.push({ x, y, text, color, life: 800, maxLife: 800 });
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
    playerCar = carById(saveData.selectedCarId);
    playerLane = 1;
    playerX = laneCenterX(playerLane);
    playerY = canvas.height * PLAYER_Y_RATIO;
    boostHeld = false;
    cars = [];
    trees = [];
    speedLines = [];
    floaters = [];
    coins = [];
    elapsed = 0;
    score = 0;
    runCoins = 0;
    closeCalls = 0;
    waveTimer = 0.6;
    nextTreeY = -100;
    fillTreesUpTo(canvas.height + 100);
    isNewBest = false;
    gameOver = false;
  }

  function endGame() {
    gameOver = true;
    const finalScore = Math.floor(score);
    isNewBest = finalScore > best;
    if (isNewBest) {
      best = finalScore;
      saveBest(best);
    }
    bankRunCoins();
  }

  function playerHitbox() {
    const { w, h } = carDrawSize(playerCar);
    return { cx: playerX, cy: playerY, w: w * HITBOX_SHRINK, h: h * HITBOX_SHRINK };
  }

  function carHitbox(car) {
    const { w, h } = carDrawSize(car.def);
    return { cx: car.x, cy: car.y, w: w * HITBOX_SHRINK, h: h * HITBOX_SHRINK };
  }

  function boxGap(a, b) {
    const dx = Math.max(0, Math.abs(a.cx - b.cx) - (a.w + b.w) / 2);
    const dy = Math.max(0, Math.abs(a.cy - b.cy) - (a.h + b.h) / 2);
    return Math.hypot(dx, dy);
  }

  function update(dt) {
    if (gameOver) return;
    const dtSec = Math.min(dt, 50) / 1000;
    elapsed += dtSec;
    const speed = currentSpeed();
    score += speed * dtSec * 0.05;

    const targetX = laneCenterX(playerLane);
    const maxStep = LANE_CHANGE_SPEED * dtSec;
    const dx = targetX - playerX;
    playerX += Math.max(-maxStep, Math.min(maxStep, dx));

    for (const car of cars) car.y += speed * dtSec;
    cars = cars.filter((c) => c.y - CAR_HEIGHT < canvas.height + 40);

    for (const c of coins) c.y += speed * dtSec;
    coins = coins.filter((c) => !c.taken && c.y < canvas.height + 40);

    for (const t of trees) t.y += speed * dtSec;
    trees = trees.filter((t) => t.y < canvas.height + 100);
    fillTreesUpTo(canvas.height + 100);

    const lineMult = boostHeld ? 2.2 : 1;
    for (const s of speedLines) s.y += speed * s.speedMult * dtSec;
    speedLines = speedLines.filter((s) => s.y - s.len < canvas.height + 20);
    if (Math.random() < dtSec * (SPEED_LINE_COUNT / 2) * lineMult) spawnSpeedLine();

    for (const f of floaters) {
      f.y -= 40 * dtSec;
      f.life -= dt;
    }
    floaters = floaters.filter((f) => f.life > 0);

    waveTimer -= dtSec;
    if (waveTimer <= 0) {
      const t = Math.min(1, elapsed / 40);
      waveTimer = WAVE_GAP_MAX - t * (WAVE_GAP_MAX - WAVE_GAP_MIN) + Math.random() * 0.3;
      spawnWave();
    }

    for (const c of coins) {
      if (c.taken) continue;
      if (Math.hypot(playerX - c.x, playerY - c.y) < COIN_RADIUS + 22) {
        c.taken = true;
        runCoins += COIN_VALUE;
      }
    }

    const pBox = playerHitbox();
    for (const car of cars) {
      const cBox = carHitbox(car);
      if (boxGap(pBox, cBox) <= 0) {
        endGame();
        return;
      }
      if (!car.everThreatened && Math.abs(car.x - playerX) < DANGER_LATERAL_RANGE && Math.abs(car.y - playerY) < DANGER_WINDOW) {
        car.everThreatened = true;
      }
      if (car.everThreatened && !car.closeCallDone && car.y > playerY + PLAYER_HEIGHT / 2) {
        car.closeCallDone = true;
        closeCalls += 1;
        score += CLOSE_CALL_BONUS;
        addFloater(playerX, playerY - 60, "Close Call!", "#fbbf24");
      }
    }
  }

  function draw() {
    ctx.fillStyle = "#3f7a3f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const rl = roadLeft();
    const rw = roadWidth();
    ctx.fillStyle = "#424750";
    ctx.fillRect(rl, 0, rw, canvas.height);
    ctx.strokeStyle = "#fde68a";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(rl, 0);
    ctx.lineTo(rl, canvas.height);
    ctx.moveTo(rl + rw, 0);
    ctx.lineTo(rl + rw, canvas.height);
    ctx.stroke();

    ctx.strokeStyle = "rgba(226, 232, 240, 0.85)";
    ctx.lineWidth = 5;
    ctx.setLineDash([28, 26]);
    const dashOffset = (elapsed * currentSpeed()) % 54;
    ctx.lineDashOffset = -dashOffset;
    for (let i = 1; i < LANE_COUNT; i++) {
      const x = rl + (rw / LANE_COUNT) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const t of trees) {
      const sprite = treeSprites[t.variant];
      if (!sprite.loaded) continue;
      const w = 46;
      const h = w * (sprite.img.naturalHeight / sprite.img.naturalWidth);
      ctx.drawImage(sprite.img, t.x - w / 2, t.y - h, w, h);
    }

    ctx.strokeStyle = boostHeld ? "rgba(251, 191, 36, 0.7)" : "rgba(255,255,255,0.5)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const s of speedLines) {
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x, s.y - s.len);
      ctx.stroke();
    }

    for (const c of coins) {
      if (c.taken) continue;
      if (coinSprite.loaded) {
        const s = COIN_RADIUS * 2.4;
        ctx.drawImage(coinSprite.img, c.x - s / 2, c.y - s / 2, s, s);
      } else {
        ctx.fillStyle = "#fbbf24";
        ctx.beginPath();
        ctx.arc(c.x, c.y, COIN_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const car of cars) drawCarSprite(ctx, car.x, car.y, car.def);
    drawCarSprite(ctx, playerX, playerY, playerCar);

    ctx.textAlign = "center";
    ctx.font = "bold 22px system-ui, sans-serif";
    for (const f of floaters) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life / 300));
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }
  }

  function isOver() {
    return gameOver;
  }

  function getHud() {
    return { left: `🏁 ${Math.floor(score)}   🪙 ${runCoins}   😰 ${closeCalls}`, right: `🏆 ${best}` };
  }

  function getOverResult() {
    return {
      title: "Crashed!",
      message: isNewBest
        ? `Score: ${Math.floor(score)} — New Best!  •  +${runCoins} coins  •  ${closeCalls} close calls`
        : `Score: ${Math.floor(score)} (Best: ${best})  •  +${runCoins} coins  •  ${closeCalls} close calls`,
    };
  }

  function save() {
    bankRunCoins();
  }

  // ---------------- Garage (car shop) ----------------

  function renderShop(overlayEl, { onClose }) {
    overlayEl.innerHTML = `
      <h1>🚗 Garage</h1>
      <p>Coins: <strong id="garageCoins">${saveData.coins}</strong></p>
      <div style="max-height: 56vh; overflow-y: auto; width: 100%; display: flex; justify-content: center;">
        <div class="game-grid" id="garageGrid"></div>
      </div>
      <button class="secondary" data-shop-action="close">← Back</button>
    `;

    function renderGrid() {
      const grid = overlayEl.querySelector("#garageGrid");
      grid.innerHTML = CAR_CATALOG.map((car) => {
        const owned = saveData.ownedCarIds.includes(car.id);
        const selected = saveData.selectedCarId === car.id;
        let actionHtml;
        if (selected) {
          actionHtml = `<button disabled>Selected ✓</button>`;
        } else if (owned) {
          actionHtml = `<button data-shop-action="select" data-car-id="${car.id}">Select</button>`;
        } else {
          actionHtml = `<button data-shop-action="buy" data-car-id="${car.id}" ${saveData.coins < car.price ? "disabled" : ""}>Buy — ${car.price} coins</button>`;
        }
        return `
          <div style="width:150px;padding:14px;border-radius:12px;border:1px solid ${selected ? "#60a5fa" : "#334155"};background:#1e293b;display:flex;flex-direction:column;align-items:center;gap:10px;">
            <canvas class="carPreview" data-car-id="${car.id}" width="110" height="120" style="background:#0f172a;border-radius:8px;"></canvas>
            <strong>${car.name}</strong>
            ${actionHtml}
          </div>`;
      }).join("");

      grid.querySelectorAll(".carPreview").forEach((canvasEl) => {
        const car = carById(canvasEl.dataset.carId);
        const pctx = canvasEl.getContext("2d");
        pctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        pctx.save();
        pctx.translate(canvasEl.width / 2, canvasEl.height / 2 + 6);
        const { h } = carDrawSize(car);
        const previewScale = 78 / h;
        pctx.scale(previewScale, previewScale);
        drawCarSprite(pctx, 0, 0, car);
        pctx.restore();
      });

      grid.querySelectorAll('[data-shop-action="buy"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const car = carById(btn.dataset.carId);
          if (saveData.coins < car.price) return;
          saveData.coins -= car.price;
          saveData.ownedCarIds.push(car.id);
          saveData.selectedCarId = car.id;
          writeSaveData(saveData);
          overlayEl.querySelector("#garageCoins").textContent = saveData.coins;
          renderGrid();
        });
      });
      grid.querySelectorAll('[data-shop-action="select"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          saveData.selectedCarId = btn.dataset.carId;
          writeSaveData(saveData);
          renderGrid();
        });
      });
    }
    renderGrid();

    overlayEl.querySelector('[data-shop-action="close"]').addEventListener("click", () => {
      playerCar = carById(saveData.selectedCarId);
      onClose();
    });
  }

  return {
    id: "highway-dodge",
    title: "Highway Dodge",
    thumbnail: "Asset/highway_dodger_Thumbnail.jpg",
    description: "Weave through traffic at full speed. Arrow keys or A/D to switch lanes, hold Up/W to boost. Collect coins, dodge close calls, and buy new cars for the garage.",
    reset,
    update,
    draw,
    isOver,
    getHud,
    getOverResult,
    save,
    renderShop,
  };
}
