const LANE_COUNT = 3;
const ROAD_WIDTH_RATIO = 0.62; // road occupies the middle 62% of canvas width
const PLAYER_Y_RATIO = 0.8;
const PLAYER_WIDTH = 42;
const PLAYER_HEIGHT = 74;
const CAR_WIDTH = 42;
const CAR_HEIGHT = 74;
const HITBOX_SHRINK = 0.8; // hitboxes are a bit smaller than the drawn car — forgiving, standard practice
const LANE_CHANGE_SPEED = 900; // px/s the car eases toward its target lane at
const BASE_SPEED = 260;
const MAX_SPEED = 760;
const ACCEL_PER_SEC = 6.5;
const WAVE_GAP_MIN = 0.95;
const WAVE_GAP_MAX = 1.55;
const DANGER_WINDOW = 85; // px — sharing a lane with a car this close counts as having been in real danger
const CLOSE_CALL_BONUS = 25;
const TREE_SPACING_MIN = 140;
const TREE_SPACING_MAX = 260;
const SPEED_LINE_COUNT = 14;
const BEST_KEY = "fireBox.highwayDodge.best.v1";

const CAR_COLORS = ["#facc15", "#fb923c", "#f8fafc", "#60a5fa", "#a78bfa", "#4ade80"];
const TREE_SRCS = [
  "Asset/kenney_background-elements/PNG/Flat/tree01.png",
  "Asset/kenney_background-elements/PNG/Flat/tree02.png",
  "Asset/kenney_background-elements/PNG/Flat/tree03.png",
  "Asset/kenney_background-elements/PNG/Flat/tree04.png",
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

export function createCarDodgeGame({ canvas, ctx }) {
  const treeSprites = TREE_SRCS.map(loadSprite);

  let best = loadBest();
  let isNewBest = false;
  let gameOver = true;

  let playerLane = 1;
  let playerX = 0;
  let playerY = 0;

  let cars = [];
  let trees = [];
  let speedLines = [];
  let floaters = [];

  let elapsed = 0;
  let score = 0;
  let closeCalls = 0;
  let waveTimer = 0;
  let nextTreeY = 0;

  window.addEventListener("keydown", (e) => {
    if (gameOver || e.repeat) return;
    if (e.code === "ArrowLeft" || e.code === "KeyA") {
      playerLane = Math.max(0, playerLane - 1);
      e.preventDefault();
    }
    if (e.code === "ArrowRight" || e.code === "KeyD") {
      playerLane = Math.min(LANE_COUNT - 1, playerLane + 1);
      e.preventDefault();
    }
  });

  function roadLeft() {
    return canvas.width * (1 - ROAD_WIDTH_RATIO) / 2;
  }

  function roadWidth() {
    return canvas.width * ROAD_WIDTH_RATIO;
  }

  function laneCenterX(lane) {
    const w = roadWidth() / LANE_COUNT;
    return roadLeft() + w * (lane + 0.5);
  }

  function currentSpeed() {
    return Math.min(MAX_SPEED, BASE_SPEED + elapsed * ACCEL_PER_SEC);
  }

  function spawnWave() {
    const laneCount = LANE_COUNT;
    const blockCount = 1 + Math.floor(Math.random() * (laneCount - 1)); // never blocks every lane
    const lanes = Array.from({ length: laneCount }, (_, i) => i);
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    const chosen = lanes.slice(0, blockCount);
    for (const lane of chosen) {
      cars.push({
        lane,
        x: laneCenterX(lane),
        y: -CAR_HEIGHT,
        color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
        everThreatened: false,
        closeCallDone: false,
      });
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

  function reset() {
    playerLane = 1;
    playerX = laneCenterX(playerLane);
    playerY = canvas.height * PLAYER_Y_RATIO;
    cars = [];
    trees = [];
    speedLines = [];
    floaters = [];
    elapsed = 0;
    score = 0;
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
  }

  function playerHitbox() {
    const w = PLAYER_WIDTH * HITBOX_SHRINK;
    const h = PLAYER_HEIGHT * HITBOX_SHRINK;
    return { cx: playerX, cy: playerY, w, h };
  }

  function carHitbox(car) {
    const w = CAR_WIDTH * HITBOX_SHRINK;
    const h = CAR_HEIGHT * HITBOX_SHRINK;
    return { cx: car.x, cy: car.y, w, h };
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

    for (const t of trees) t.y += speed * dtSec;
    trees = trees.filter((t) => t.y < canvas.height + 100);
    fillTreesUpTo(canvas.height + 100);

    for (const s of speedLines) s.y += speed * s.speedMult * dtSec;
    speedLines = speedLines.filter((s) => s.y - s.len < canvas.height + 20);
    if (Math.random() < dtSec * (SPEED_LINE_COUNT / 2)) spawnSpeedLine();

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

    const pBox = playerHitbox();
    for (const car of cars) {
      const cBox = carHitbox(car);
      if (boxGap(pBox, cBox) <= 0) {
        endGame();
        return;
      }
      if (!car.everThreatened && car.lane === playerLane && Math.abs(car.y - playerY) < DANGER_WINDOW) {
        car.everThreatened = true;
      }
      if (car.everThreatened && !car.closeCallDone && car.y > playerY + PLAYER_HEIGHT / 2) {
        car.closeCallDone = true;
        closeCalls += 1;
        score += CLOSE_CALL_BONUS;
        addFloater(playerX, playerY - 50, "Close Call!", "#fbbf24");
      }
    }
  }

  function drawCar(x, y, w, h, bodyColor, windowColor) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, h * 0.42, w * 0.55, h * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h * 0.32);
    ctx.quadraticCurveTo(-w / 2, -h / 2, 0, -h / 2);
    ctx.quadraticCurveTo(w / 2, -h / 2, w / 2, -h * 0.32);
    ctx.lineTo(w / 2, h * 0.38);
    ctx.quadraticCurveTo(w / 2, h / 2, 0, h / 2);
    ctx.quadraticCurveTo(-w / 2, h / 2, -w / 2, h * 0.38);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = windowColor;
    ctx.fillRect(-w * 0.34, -h * 0.34, w * 0.68, h * 0.24);
    ctx.fillRect(-w * 0.34, h * 0.02, w * 0.68, h * 0.2);

    ctx.fillStyle = "#fef9c3";
    ctx.fillRect(-w * 0.4, -h * 0.5, w * 0.16, h * 0.06);
    ctx.fillRect(w * 0.24, -h * 0.5, w * 0.16, h * 0.06);
    ctx.fillStyle = "#7f1d1d";
    ctx.fillRect(-w * 0.4, h * 0.44, w * 0.16, h * 0.06);
    ctx.fillRect(w * 0.24, h * 0.44, w * 0.16, h * 0.06);

    ctx.restore();
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

    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const s of speedLines) {
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x, s.y - s.len);
      ctx.stroke();
    }

    for (const car of cars) {
      drawCar(car.x, car.y, CAR_WIDTH, CAR_HEIGHT, car.color, "#0f172a");
    }

    drawCar(playerX, playerY, PLAYER_WIDTH, PLAYER_HEIGHT, "#ef4444", "#0f172a");

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
    return { left: `🏁 ${Math.floor(score)}   😰 ${closeCalls}`, right: `🏆 ${best}` };
  }

  function getOverResult() {
    return {
      title: "Crashed!",
      message: isNewBest
        ? `Score: ${Math.floor(score)} — New Best!  •  ${closeCalls} close calls`
        : `Score: ${Math.floor(score)} (Best: ${best})  •  ${closeCalls} close calls`,
    };
  }

  return {
    id: "highway-dodge",
    title: "Highway Dodge",
    thumbnail: null,
    description: "Weave through traffic at full speed. Arrow keys or A/D to switch lanes — the closer the call, the more it's worth.",
    reset,
    update,
    draw,
    isOver,
    getHud,
    getOverResult,
  };
}
