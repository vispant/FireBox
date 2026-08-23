const CELL = 30;
const BASE_INTERVAL = 150; // ms per grid step
const MIN_INTERVAL = 70;
const SPEEDUP_EVERY = 5; // food eaten
const SPEEDUP_STEP = 12; // ms faster per tier
const BEST_KEY = "fireBox.snake.best.v1";

const HEAD_SRC = "Asset/kenney_animal-pack/PNG/Round/snake.png";
const FOOD_SRC = "Asset/kenney_jumper-pack/PNG/Items/carrot.png";

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

export function createSnakeGame({ canvas, ctx }) {
  const headSprite = loadSprite(HEAD_SRC);
  const foodSprite = loadSprite(FOOD_SRC);

  let cols = 1;
  let rows = 1;
  let snake = [];
  let direction = { x: 1, y: 0 };
  let nextDirection = direction;
  let food = { x: 0, y: 0 };
  let score = 0;
  let best = loadBest();
  let gameOver = true;
  let isNewBest = false;
  let moveTimer = 0;
  let moveInterval = BASE_INTERVAL;

  window.addEventListener("keydown", (e) => {
    if (gameOver) return;
    const map = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
    };
    const d = map[e.key];
    if (!d) return;
    e.preventDefault();
    if (snake.length > 1 && d.x === -direction.x && d.y === -direction.y) return;
    nextDirection = d;
  });

  function recomputeGrid() {
    cols = Math.max(4, Math.floor(canvas.width / CELL));
    rows = Math.max(4, Math.floor(canvas.height / CELL));
  }

  function randomEmptyCell() {
    let cell;
    do {
      cell = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) };
    } while (snake.some((s) => s.x === cell.x && s.y === cell.y));
    return cell;
  }

  function reset() {
    recomputeGrid();
    const startX = Math.floor(cols / 2);
    const startY = Math.floor(rows / 2);
    snake = [
      { x: startX - 1, y: startY },
      { x: startX - 2, y: startY },
      { x: startX - 3, y: startY },
    ];
    direction = { x: 1, y: 0 };
    nextDirection = direction;
    food = randomEmptyCell();
    score = 0;
    gameOver = false;
    isNewBest = false;
    moveTimer = 0;
    moveInterval = BASE_INTERVAL;
  }

  function endGame() {
    gameOver = true;
    isNewBest = score > best;
    if (isNewBest) {
      best = score;
      saveBest(best);
    }
  }

  function step() {
    direction = nextDirection;
    const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };

    if (head.x < 0 || head.x >= cols || head.y < 0 || head.y >= rows) {
      endGame();
      return;
    }
    if (snake.some((s) => s.x === head.x && s.y === head.y)) {
      endGame();
      return;
    }

    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score += 1;
      if (score % SPEEDUP_EVERY === 0) {
        moveInterval = Math.max(MIN_INTERVAL, moveInterval - SPEEDUP_STEP);
      }
      food = randomEmptyCell();
    } else {
      snake.pop();
    }
  }

  function update(dt) {
    if (gameOver) return;
    moveTimer += dt;
    while (moveTimer >= moveInterval && !gameOver) {
      moveTimer -= moveInterval;
      step();
    }
  }

  function draw() {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(148, 163, 184, 0.08)";
    ctx.lineWidth = 1;
    for (let x = 1; x < cols; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL, 0);
      ctx.lineTo(x * CELL, rows * CELL);
      ctx.stroke();
    }
    for (let y = 1; y < rows; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL);
      ctx.lineTo(cols * CELL, y * CELL);
      ctx.stroke();
    }

    if (foodSprite.loaded) {
      const s = CELL * 0.95;
      ctx.drawImage(foodSprite.img, food.x * CELL + CELL / 2 - s / 2, food.y * CELL + CELL / 2 - s / 2, s, s);
    } else {
      ctx.fillStyle = "#f87171";
      ctx.beginPath();
      ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }

    snake.forEach((seg, i) => {
      if (i === 0) return;
      ctx.fillStyle = "#22c55e";
      const pad = 2;
      ctx.fillRect(seg.x * CELL + pad, seg.y * CELL + pad, CELL - pad * 2, CELL - pad * 2);
    });

    const head = snake[0];
    const cx = head.x * CELL + CELL / 2;
    const cy = head.y * CELL + CELL / 2;
    const fx = direction.x;
    const fy = direction.y;

    if (headSprite.loaded) {
      const angle = Math.atan2(fy, fx) - Math.PI / 2;
      const s = CELL * 1.3;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.drawImage(headSprite.img, -s / 2, -s / 2, s, s);
      ctx.restore();
    } else {
      ctx.fillStyle = "#4ade80";
      ctx.fillRect(head.x * CELL + 1, head.y * CELL + 1, CELL - 2, CELL - 2);
      const px = -fy;
      const py = fx;
      ctx.fillStyle = "#0f172a";
      [-1, 1].forEach((s) => {
        const ex = cx + fx * CELL * 0.12 + px * CELL * 0.22 * s;
        const ey = cy + fy * CELL * 0.12 + py * CELL * 0.22 * s;
        ctx.beginPath();
        ctx.arc(ex, ey, CELL * 0.09, 0, Math.PI * 2);
        ctx.fill();
      });
      const mouthX = cx + fx * CELL * 0.42;
      const mouthY = cy + fy * CELL * 0.42;
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mouthX - px * CELL * 0.15, mouthY - py * CELL * 0.15);
      ctx.lineTo(mouthX + px * CELL * 0.15, mouthY + py * CELL * 0.15);
      ctx.stroke();
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
    id: "snake",
    title: "Snake",
    thumbnail: null,
    description: "Arrow keys to steer. Eat food to grow — speeds up every 5 bites.",
    reset,
    update,
    draw,
    isOver,
    getHud,
    getOverResult,
  };
}
