const CELL = 30;
const BASE_INTERVAL = 150; // ms per grid step
const MIN_INTERVAL = 70;
const SPEEDUP_EVERY = 5; // food eaten
const SPEEDUP_STEP = 12; // ms faster per tier
const BEST_KEY = "fireBox.snake.best.v1";

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

    ctx.fillStyle = "#f87171";
    ctx.beginPath();
    ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL * 0.38, 0, Math.PI * 2);
    ctx.fill();

    snake.forEach((seg, i) => {
      ctx.fillStyle = i === 0 ? "#4ade80" : "#22c55e";
      const pad = i === 0 ? 1 : 2;
      ctx.fillRect(seg.x * CELL + pad, seg.y * CELL + pad, CELL - pad * 2, CELL - pad * 2);
    });
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
