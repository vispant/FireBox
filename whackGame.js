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
  let sparks = [];
  let stunned = []; // critters just whacked: dizzy for a beat, sinking back down
  let rings = [];
  let mallet = { x: 0, y: 0, visible: false, swing: 0 };
  let coins = 0;
  let best = loadBest();
  let timeLeft = SESSION_SECONDS;
  let spawnTimer = 0.5;
  let gameOver = true;
  let isNewBest = false;

  function computeHoles() {
    let marginX = canvas.width * 0.18;
    const minSpacing = HOLE_RADIUS * 2.75; // keeps neighbouring dirt mounds from overlapping on narrow (phone) canvases
    if ((canvas.width - marginX * 2) / COLS < minSpacing) marginX = Math.max(8, (canvas.width - minSpacing * COLS) / 2);
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
          age: 0,
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
    mallet.x = x;
    mallet.y = y;
    mallet.visible = true;
    mallet.swing = 1;
    for (const hole of holes) {
      const dx = x - hole.x;
      const dy = y - hole.y;
      if (dx * dx + dy * dy <= HOLE_RADIUS * HOLE_RADIUS && hole.active) {
        hole.active = false;
        stunned.push({ x: hole.x, y: hole.y + 10, critter: hole.critter, t: 0 });
        rings.push({ x: hole.x, y: hole.y - 4, t: 0 });
        coins += COINS_PER_HIT;
        floaters.push({ x: hole.x, y: hole.y - 20, life: 0.7, maxLife: 0.7 });
        for (let i = 0; i < 10; i++) {
          const a = (Math.PI * 2 * i) / 10 + Math.random() * 0.4;
          const sp = 90 + Math.random() * 120;
          sparks.push({ x: hole.x, y: hole.y - 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0.45, maxLife: 0.45, r: 3 + Math.random() * 3 });
        }
        return;
      }
    }
  }

  canvas.addEventListener("pointermove", (e) => {
    if (gameOver) return;
    const p = toCanvasCoords(e.clientX, e.clientY);
    mallet.x = p.x;
    mallet.y = p.y;
    mallet.visible = true;
  });
  canvas.addEventListener("pointerdown", (e) => handleClick(e.clientX, e.clientY));

  function reset() {
    holes = computeHoles();
    floaters = [];
    sparks = [];
    stunned = [];
    rings = [];
    mallet.swing = 0;
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
    hole.age = 0;
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
        hole.age += dtSec;
        hole.timer -= dtSec;
        if (hole.timer <= 0) hole.active = false;
      }
    }

    floaters = floaters.filter((f) => {
      f.life -= dtSec;
      f.y -= 40 * dtSec;
      return f.life > 0;
    });
    for (const st of stunned) st.t += dtSec;
    stunned = stunned.filter((st) => st.t < 0.42);
    for (const r of rings) r.t += dtSec;
    rings = rings.filter((r) => r.t < 0.35);
    mallet.swing = Math.max(0, mallet.swing - dtSec * 5);
    sparks = sparks.filter((p) => {
      p.life -= dtSec;
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.vy += 380 * dtSec;
      return p.life > 0;
    });
  }

  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  // deterministic pseudo-random so the lawn doesn't shimmer frame to frame
  function rand01(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function drawLawn() {
    const w = canvas.width;
    const h = canvas.height;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#1d7a3f");
    grad.addColorStop(1, "#0f5a2c");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // mown stripes
    const stripes = 12;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.05)";
      ctx.fillRect((w / stripes) * i, 0, w / stripes, h);
    }

    // grass tufts and tiny flowers
    for (let i = 0; i < 90; i++) {
      const x = rand01(i * 3.1) * w;
      const y = rand01(i * 7.7 + 1) * h;
      ctx.strokeStyle = i % 3 === 0 ? "rgba(134,239,172,0.28)" : "rgba(4,60,28,0.35)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x - 6, y - 8);
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - 11);
      ctx.moveTo(x + 4, y);
      ctx.lineTo(x + 6, y - 8);
      ctx.stroke();
    }
    const flowerColors = ["#fde047", "#f9a8d4", "#ffffff", "#fdba74"];
    for (let i = 0; i < 26; i++) {
      const x = rand01(i * 5.3 + 40) * w;
      const y = rand01(i * 9.1 + 90) * h;
      ctx.fillStyle = flowerColors[i % flowerColors.length];
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // soft vignette
    const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.95);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  function drawHole(hole) {
    const hx = hole.x;
    const cy = hole.y + 10;
    const rx = HOLE_RADIUS;
    const ry = HOLE_RADIUS * 0.55;

    // ground shadow + dirt mound
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(hx, cy + 10, rx * 1.4, ry * 1.25, 0, 0, Math.PI * 2);
    ctx.fill();

    const mound = ctx.createRadialGradient(hx, cy - 6, rx * 0.4, hx, cy + 4, rx * 1.4);
    mound.addColorStop(0, "#9a6a3a");
    mound.addColorStop(0.7, "#7a4f28");
    mound.addColorStop(1, "#5a3818");
    ctx.fillStyle = mound;
    ctx.beginPath();
    ctx.ellipse(hx, cy + 4, rx * 1.3, ry * 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,220,170,0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(hx, cy + 2, rx * 1.3, ry * 1.2, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();

    // the hole itself, with depth
    const pit = ctx.createRadialGradient(hx, cy - 4, 2, hx, cy, rx);
    pit.addColorStop(0, "#0a0603");
    pit.addColorStop(0.65, "#1c1109");
    pit.addColorStop(1, "#3a2614");
    ctx.fillStyle = pit;
    ctx.beginPath();
    ctx.ellipse(hx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    if (hole.active) {
      const sprite = critterSprites[hole.critter];
      const rise = easeOutBack(Math.min(1, hole.age / 0.14));
      const sink = Math.min(1, Math.max(0, hole.timer / 0.12));
      const lift = Math.min(rise, sink);
      const s = HOLE_RADIUS * 1.6;
      const hidden = (1 - lift) * s * 0.95;

      ctx.save();
      // everything above the hole's centre line, plus the hole opening itself
      ctx.beginPath();
      ctx.rect(hx - rx * 2, cy - 400, rx * 4, 400);
      ctx.ellipse(hx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      if (sprite.loaded) {
        ctx.drawImage(sprite.img, hx - s / 2, cy - s * 0.78 + hidden, s, s);
      } else {
        ctx.fillStyle = "#92400e";
        ctx.beginPath();
        ctx.ellipse(hx, cy - 14 + hidden, rx * 0.6, rx * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // front lip of the hole drawn over the critter so it really pops *out of* the ground
    ctx.lineCap = "round";
    ctx.strokeStyle = "#6b4423";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.ellipse(hx, cy, rx, ry, 0, 0.05 * Math.PI, 0.95 * Math.PI);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,225,180,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(hx, cy + 2, rx, ry, 0, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.stroke();
    // a few grass blades poking over the front lip
    ctx.strokeStyle = "#22a04f";
    ctx.lineWidth = 2;
    for (let i = -3; i <= 3; i++) {
      const bx = hx + i * (rx / 3.4);
      const by = cy + ry * Math.sqrt(Math.max(0, 1 - Math.pow((i * (rx / 3.4)) / rx, 2))) + 3;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + (i % 2 ? 3 : -3), by - 8 - (Math.abs(i) % 3) * 2);
      ctx.stroke();
    }
  }

  function draw() {
    drawLawn();

    // back rows first so lower holes overlap upper ones naturally
    for (const hole of holes) drawHole(hole);

    // whacked critters: squashed, dizzy stars circling, sinking back into the hole
    for (const st of stunned) {
      const sprite = critterSprites[st.critter];
      const rx = HOLE_RADIUS;
      const ry = HOLE_RADIUS * 0.55;
      const sink = Math.min(1, st.t / 0.42);
      const s = HOLE_RADIUS * 1.6;
      ctx.save();
      ctx.beginPath();
      ctx.rect(st.x - rx * 2, st.y - 400, rx * 4, 400);
      ctx.ellipse(st.x, st.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      if (sprite.loaded) {
        const squash = 0.72 + 0.28 * sink;
        ctx.translate(st.x, st.y - s * 0.78 + sink * s * 0.95 + s);
        ctx.scale(1.25 - 0.25 * sink, squash);
        ctx.drawImage(sprite.img, -s / 2, -s, s, s);
      }
      ctx.restore();
      if (sink < 0.85) {
        for (let k = 0; k < 3; k++) {
          const a = st.t * 12 + (Math.PI * 2 * k) / 3;
          const sx = st.x + Math.cos(a) * 26;
          const sy = st.y - s * 0.72 + Math.sin(a) * 8;
          ctx.fillStyle = "#fde047";
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(a);
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const ang = (Math.PI * 2 * i) / 5 - Math.PI / 2;
            ctx.lineTo(Math.cos(ang) * 6, Math.sin(ang) * 6);
            ctx.lineTo(Math.cos(ang + Math.PI / 5) * 2.6, Math.sin(ang + Math.PI / 5) * 2.6);
          }
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    }

    for (const r of rings) {
      const a = 1 - r.t / 0.35;
      ctx.strokeStyle = `rgba(255,255,255,${a * 0.8})`;
      ctx.lineWidth = 4 * a + 1;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, 20 + r.t * 130, 12 + r.t * 80, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const p of sparks) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = "#fde047";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (mallet.visible && !gameOver) {
      const sw = mallet.swing;
      const angle = -0.6 + sw * 1.0; // raised at rest, swings through on a click
      ctx.save();
      ctx.translate(mallet.x, mallet.y);
      ctx.rotate(angle);
      // handle
      const wood = ctx.createLinearGradient(-6, 0, 6, 0);
      wood.addColorStop(0, "#b7793a");
      wood.addColorStop(0.5, "#d9a066");
      wood.addColorStop(1, "#8a5a2b");
      ctx.fillStyle = wood;
      ctx.beginPath();
      ctx.roundRect(-6, 14, 12, 76, 5);
      ctx.fill();
      // head
      const head = ctx.createLinearGradient(-30, 0, 30, 0);
      head.addColorStop(0, "#9a6a3a");
      head.addColorStop(0.5, "#e2ad72");
      head.addColorStop(1, "#7d4f24");
      ctx.fillStyle = head;
      ctx.strokeStyle = "rgba(60,30,10,0.85)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(-30, -20, 60, 40, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#4b5563";
      ctx.fillRect(-30, -10, 60, 5);
      ctx.fillRect(-30, 4, 60, 5);
      ctx.restore();
    }

    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    for (const f of floaters) {
      const a = Math.max(0, f.life / f.maxLife);
      ctx.lineWidth = 5;
      ctx.strokeStyle = `rgba(60, 30, 0, ${a})`;
      ctx.strokeText("+10", f.x, f.y);
      ctx.fillStyle = `rgba(253, 224, 71, ${a})`;
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
    thumbnail: "Asset/whack_a_mole_Thumbnail.jpg",
    description: "Click the moles before they duck back down. 30 seconds on the clock, coins for every hit.",
    reset,
    update,
    draw,
    isOver,
    getHud,
    getOverResult,
  };
}
