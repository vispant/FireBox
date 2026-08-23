const COLS = 3;
const ROWS = 3;
const HOLE_RADIUS = 55;
const SESSION_SECONDS = 30;
const SPAWN_INTERVAL_START = 0.9;
const SPAWN_INTERVAL_END = 0.45;
const VISIBLE_START = 0.9;
const VISIBLE_END = 0.55;
const COINS_PER_HIT = 10;
const BEST_KEY = "fireBox.whack.best.v1";

const CRITTER_SRCS = [
  "Asset/kenney_animal-pack/PNG/Round/hippo.png",
  "Asset/kenney_animal-pack/PNG/Round/pig.png",
  "Asset/kenney_animal-pack/PNG/Round/monkey.png",
  "Asset/kenney_animal-pack/PNG/Round/panda.png",
  "Asset/kenney_animal-pack/PNG/Round/rabbit.png",
  "Asset/kenney_animal-pack/PNG/Round/giraffe.png",
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

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

export function createWhackGame({ canvas, ctx }) {
  const critterSprites = CRITTER_SRCS.map(loadSprite);

  let holes = [];
  let floaters = [];
  let coins = 0;
  let best = loadBest();
  let timeLeft = SESSION_SECONDS;
  let spawnTimer = 0.5;
  let gameOver = true;
  let isNewBest = false;

  function computeHoles() {
    const marginX = canvas.width * 0.18;
    const marginY = canvas.height * 0.22;
    const usableW = canvas.width - marginX * 2;
    const usableH = canvas.height - marginY * 2;
    const list = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        list.push({
          x: marginX + (usableW * (c + 0.5)) / COLS,
          y: marginY + (usableH * (r + 0.5)) / ROWS,
          active: false,
          timer: 0,
          critter: 0,
        });
      }
    }
    return list;
  }

  function toCanvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.max(rect.width / canvas.width, rect.height / canvas.height);
    const offsetX = (rect.width - canvas.width * scale) / 2;
    const offsetY = (rect.height - canvas.height * scale) / 2;
    return {
      x: (clientX - rect.left - offsetX) / scale,
      y: (clientY - rect.top - offsetY) / scale,
    };
  }

  function handleClick(clientX, clientY) {
    if (gameOver) return;
    const { x, y } = toCanvasCoords(clientX, clientY);
    for (const hole of holes) {
      const dx = x - hole.x;
      const dy = y - hole.y;
      if (dx * dx + dy * dy <= HOLE_RADIUS * HOLE_RADIUS && hole.active) {
        hole.active = false;
        coins += COINS_PER_HIT;
        floaters.push({ x: hole.x, y: hole.y, life: 0.6, maxLife: 0.6 });
        return;
      }
    }
  }

  canvas.addEventListener("pointerdown", (e) => handleClick(e.clientX, e.clientY));

  function reset() {
    holes = computeHoles();
    floaters = [];
    coins = 0;
    timeLeft = SESSION_SECONDS;
    spawnTimer = 0.5;
    gameOver = false;
    isNewBest = false;
  }

  function endGame() {
    gameOver = true;
    isNewBest = coins > best;
    if (isNewBest) {
      best = coins;
      saveBest(best);
    }
  }

  function activateRandomMole(duration) {
    const idle = holes.filter((h) => !h.active);
    if (idle.length === 0) return;
    const hole = idle[Math.floor(Math.random() * idle.length)];
    hole.active = true;
    hole.timer = duration;
    hole.critter = Math.floor(Math.random() * critterSprites.length);
  }

  function update(dt) {
    if (gameOver) return;
    const dtSec = dt / 1000;
    timeLeft -= dtSec;
    if (timeLeft <= 0) {
      timeLeft = 0;
      endGame();
      return;
    }

    const progress = 1 - timeLeft / SESSION_SECONDS;
    const spawnInterval = lerp(SPAWN_INTERVAL_START, SPAWN_INTERVAL_END, progress);
    const visibleDuration = lerp(VISIBLE_START, VISIBLE_END, progress);

    spawnTimer -= dtSec;
    if (spawnTimer <= 0) {
      spawnTimer = spawnInterval;
      activateRandomMole(visibleDuration);
    }

    for (const hole of holes) {
      if (hole.active) {
        hole.timer -= dtSec;
        if (hole.timer <= 0) hole.active = false;
      }
    }

    floaters = floaters.filter((f) => {
      f.life -= dtSec;
      f.y -= 40 * dtSec;
      return f.life > 0;
    });
  }

  function draw() {
    ctx.fillStyle = "#166534";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const hole of holes) {
      ctx.fillStyle = "#3f2d1d";
      ctx.beginPath();
      ctx.ellipse(hole.x, hole.y + 10, HOLE_RADIUS, HOLE_RADIUS * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();

      if (hole.active) {
        const sprite = critterSprites[hole.critter];
        if (sprite.loaded) {
          const s = HOLE_RADIUS * 1.5;
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(hole.x, hole.y + 10, HOLE_RADIUS, HOLE_RADIUS * 0.55, 0, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(sprite.img, hole.x - s / 2, hole.y - s * 0.72, s, s);
          ctx.restore();
        } else {
          ctx.fillStyle = "#92400e";
          ctx.beginPath();
          ctx.ellipse(hole.x, hole.y - 8, HOLE_RADIUS * 0.6, HOLE_RADIUS * 0.7, 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "#0f172a";
          ctx.beginPath();
          ctx.arc(hole.x - 12, hole.y - 15, 4, 0, Math.PI * 2);
          ctx.arc(hole.x + 12, hole.y - 15, 4, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "#f472b6";
          ctx.beginPath();
          ctx.arc(hole.x, hole.y - 2, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const f of floaters) {
      ctx.fillStyle = `rgba(250, 204, 21, ${Math.max(0, f.life / f.maxLife)})`;
      ctx.fillText("+10", f.x, f.y);
    }
  }

  function isOver() {
    return gameOver;
  }

  function getHud() {
    return { left: `🪙 ${coins}`, right: `⏱ ${Math.ceil(timeLeft)}s` };
  }

  function getOverResult() {
    return {
      title: "Time's Up!",
      message: isNewBest ? `You earned ${coins} coins — New Best!` : `You earned ${coins} coins (Best: ${best})`,
    };
  }

  return {
    id: "whack",
    title: "Whack-a-Mole",
    thumbnail: null,
    description: "Click the moles before they duck back down. 30 seconds on the clock, coins for every hit.",
    reset,
    update,
    draw,
    isOver,
    getHud,
    getOverResult,
  };
}
