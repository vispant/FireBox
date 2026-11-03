// Blaster Rush — a mini top-down arena shooter. Original character/enemy
// designs (simple procedural shapes, no third-party IP referenced), built
// after a request for "a mini gun game" in the spirit of chaotic internet
// meme-shooter videos, without copying any specific show's characters.
//
// Core loop: move to dodge, your blaster auto-fires at the nearest enemy in
// range -- so the only skill is positioning, which also makes this work
// identically on touch (drag to move) and desktop (WASD/arrows).

const ARENA_MARGIN = 20;
const PLAYER_RADIUS = 22;
const PLAYER_SPEED = 280;
const PLAYER_ACCEL = 1800;
const PLAYER_MAX_LIVES = 3;
const INVINCIBLE_DURATION = 1.1;

const FIRE_RANGE = 420;
const BULLET_SPEED = 560;
const BULLET_RADIUS = 5;
const MAX_UPGRADE_LEVEL = 3;

const WAVE_DURATION = 18; // seconds per wave before difficulty ramps again

const SAVE_KEY = "fireBox.blasterRush.save.v1";
const BEST_SCORE_KEY = "fireBox.blasterRush.bestScore.v1";

const ENEMY_TYPES = {
  grunt: { radius: 16, hp: 1, speed: 100, color: "#f87171", points: 10, coinChance: 0.5 },
  scout: { radius: 12, hp: 1, speed: 165, color: "#facc15", points: 15, coinChance: 0.45 },
  brute: { radius: 27, hp: 3, speed: 58, color: "#a855f7", points: 30, coinChance: 0.85 },
};

function loadSaveData() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { coins: 0, rapidFireLevel: 0, extraLifeLevel: 0 };
    const parsed = JSON.parse(raw);
    return {
      coins: parsed.coins || 0,
      rapidFireLevel: parsed.rapidFireLevel || 0,
      extraLifeLevel: parsed.extraLifeLevel || 0,
    };
  } catch {
    return { coins: 0, rapidFireLevel: 0, extraLifeLevel: 0 };
  }
}
function writeSaveData(saveData) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
  } catch {}
}
function upgradeCost(level) {
  return 25 + level * 30;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}
function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

export function createBlasterRushGame({ canvas, ctx }) {
  let saveData = loadSaveData();
  let best = 0;
  try {
    best = Number(localStorage.getItem(BEST_SCORE_KEY)) || 0;
  } catch {}

  let player = { x: 0, y: 0, vx: 0, vy: 0, facing: 0 };
  let lives = 1;
  let invincibleTimer = 0;
  let bullets = [];
  let enemies = [];
  let particles = [];
  let fireCooldown = 0;
  let score = 0;
  let runCoins = 0;
  let wave = 1;
  let waveTimer = 0;
  let spawnTimer = 0;
  let waveBanner = 0;
  let gameOver = true;

  const keys = { up: false, down: false, left: false, right: false };
  function keyFor(code) {
    if (code === "ArrowUp" || code === "KeyW") return "up";
    if (code === "ArrowDown" || code === "KeyS") return "down";
    if (code === "ArrowLeft" || code === "KeyA") return "left";
    if (code === "ArrowRight" || code === "KeyD") return "right";
    return null;
  }
  window.addEventListener("keydown", (e) => {
    if (gameOver) return;
    const k = keyFor(e.code);
    if (k) keys[k] = true;
  });
  window.addEventListener("keyup", (e) => {
    const k = keyFor(e.code);
    if (k) keys[k] = false;
  });

  // Touch/mouse: hold anywhere to move the player toward that point,
  // continuously tracked while held -- works as a drag-to-move control on
  // phones and a simple click-and-hold on desktop, no virtual joystick UI needed.
  let pointerActive = false;
  let pointerTarget = null;
  function setPointerTarget(e) {
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    pointerTarget = { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (gameOver) return;
    pointerActive = true;
    setPointerTarget(e);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pointerActive) setPointerTarget(e);
  });
  window.addEventListener("pointerup", () => {
    pointerActive = false;
  });
  window.addEventListener("pointercancel", () => {
    pointerActive = false;
  });

  function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(60, 220);
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.45,
        max: 0.45,
        r: rand(2, 4),
        color,
      });
    }
  }

  function fireCooldownBase() {
    return Math.max(0.14, 0.42 - saveData.rapidFireLevel * 0.09);
  }

  function spawnEnemy() {
    const typeRoll = Math.random();
    let type;
    if (wave >= 4 && typeRoll < 0.22) type = "brute";
    else if (wave >= 2 && typeRoll < 0.5) type = "scout";
    else type = "grunt";
    const def = ENEMY_TYPES[type];

    const w = canvas.width;
    const h = canvas.height;
    const edge = Math.floor(rand(0, 4));
    let x, y;
    if (edge === 0) {
      x = rand(0, w);
      y = -def.radius;
    } else if (edge === 1) {
      x = w + def.radius;
      y = rand(0, h);
    } else if (edge === 2) {
      x = rand(0, w);
      y = h + def.radius;
    } else {
      x = -def.radius;
      y = rand(0, h);
    }
    const speedMult = 1 + Math.min(0.8, (wave - 1) * 0.07);
    enemies.push({ type, x, y, hp: def.hp, maxHp: def.hp, speed: def.speed * speedMult, wobble: rand(0, Math.PI * 2) });
  }

  function reset() {
    player.x = canvas.width / 2;
    player.y = canvas.height / 2;
    player.vx = 0;
    player.vy = 0;
    player.facing = -Math.PI / 2;
    lives = PLAYER_MAX_LIVES + saveData.extraLifeLevel;
    invincibleTimer = 0;
    bullets = [];
    enemies = [];
    particles = [];
    fireCooldown = 0;
    score = 0;
    runCoins = 0;
    wave = 1;
    waveTimer = 0;
    spawnTimer = 0.6;
    waveBanner = 2;
    gameOver = false;
    pointerActive = false;
    pointerTarget = null;
    keys.up = keys.down = keys.left = keys.right = false;
  }

  function update(dt) {
    if (gameOver) return;
    dt = Math.min(dt / 1000, 0.05);

    // ---- movement ----
    let targetVx = 0;
    let targetVy = 0;
    const keyboardActive = keys.up || keys.down || keys.left || keys.right;
    if (keyboardActive) {
      if (keys.up) targetVy -= 1;
      if (keys.down) targetVy += 1;
      if (keys.left) targetVx -= 1;
      if (keys.right) targetVx += 1;
      const len = Math.hypot(targetVx, targetVy) || 1;
      targetVx = (targetVx / len) * PLAYER_SPEED;
      targetVy = (targetVy / len) * PLAYER_SPEED;
    } else if (pointerActive && pointerTarget) {
      const dx = pointerTarget.x - player.x;
      const dy = pointerTarget.y - player.y;
      const d = Math.hypot(dx, dy);
      if (d > 6) {
        targetVx = (dx / d) * PLAYER_SPEED;
        targetVy = (dy / d) * PLAYER_SPEED;
      }
    }
    player.vx += Math.sign(targetVx - player.vx) * Math.min(Math.abs(targetVx - player.vx), PLAYER_ACCEL * dt);
    player.vy += Math.sign(targetVy - player.vy) * Math.min(Math.abs(targetVy - player.vy), PLAYER_ACCEL * dt);
    player.x = Math.max(ARENA_MARGIN + PLAYER_RADIUS, Math.min(canvas.width - ARENA_MARGIN - PLAYER_RADIUS, player.x + player.vx * dt));
    player.y = Math.max(ARENA_MARGIN + PLAYER_RADIUS, Math.min(canvas.height - ARENA_MARGIN - PLAYER_RADIUS, player.y + player.vy * dt));
    if (Math.hypot(player.vx, player.vy) > 10) player.facing = Math.atan2(player.vy, player.vx);

    // ---- waves ----
    waveTimer += dt;
    if (waveTimer >= WAVE_DURATION) {
      waveTimer = 0;
      wave += 1;
      waveBanner = 1.6;
    }
    if (waveBanner > 0) waveBanner -= dt;

    spawnTimer -= dt;
    const spawnInterval = Math.max(0.4, 1.35 - (wave - 1) * 0.09);
    if (spawnTimer <= 0) {
      spawnTimer = spawnInterval;
      spawnEnemy();
    }

    // ---- auto-fire at nearest enemy in range ----
    fireCooldown -= dt;
    if (fireCooldown <= 0 && enemies.length) {
      let nearest = null;
      let nearestD = FIRE_RANGE;
      for (const e of enemies) {
        const d = dist(player.x, player.y, e.x, e.y);
        if (d < nearestD) {
          nearestD = d;
          nearest = e;
        }
      }
      if (nearest) {
        const ang = Math.atan2(nearest.y - player.y, nearest.x - player.x);
        player.facing = ang;
        bullets.push({ x: player.x, y: player.y, vx: Math.cos(ang) * BULLET_SPEED, vy: Math.sin(ang) * BULLET_SPEED });
        fireCooldown = fireCooldownBase();
      }
    }

    // ---- bullets ----
    bullets = bullets.filter((b) => {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      return b.x > -20 && b.x < canvas.width + 20 && b.y > -20 && b.y < canvas.height + 20;
    });

    // ---- enemies ----
    for (const e of enemies) {
      const ang = Math.atan2(player.y - e.y, player.x - e.x);
      e.wobble += dt * 4;
      const wob = e.type === "scout" ? Math.sin(e.wobble) * 0.6 : 0;
      e.x += Math.cos(ang + wob) * e.speed * dt;
      e.y += Math.sin(ang + wob) * e.speed * dt;
    }

    // bullet-enemy collisions
    for (const b of bullets) {
      for (const e of enemies) {
        if (e.hp <= 0) continue;
        const def = ENEMY_TYPES[e.type];
        if (dist(b.x, b.y, e.x, e.y) < def.radius + BULLET_RADIUS) {
          e.hp -= 1;
          b.x = -999;
          b.y = -999;
          if (e.hp <= 0) {
            score += def.points;
            spawnParticles(e.x, e.y, def.color, 10);
            if (Math.random() < def.coinChance) {
              runCoins += 1;
            }
          } else {
            spawnParticles(e.x, e.y, def.color, 3);
          }
          break;
        }
      }
    }
    bullets = bullets.filter((b) => b.x > -500);
    enemies = enemies.filter((e) => e.hp > 0);

    // player-enemy collisions
    if (invincibleTimer > 0) invincibleTimer -= dt;
    else {
      for (const e of enemies) {
        const def = ENEMY_TYPES[e.type];
        if (dist(player.x, player.y, e.x, e.y) < def.radius + PLAYER_RADIUS) {
          lives -= 1;
          invincibleTimer = INVINCIBLE_DURATION;
          spawnParticles(player.x, player.y, "#60a5fa", 14);
          e.hp = 0;
          if (lives <= 0) {
            gameOver = true;
            if (score > best) {
              best = score;
              try {
                localStorage.setItem(BEST_SCORE_KEY, String(best));
              } catch {}
            }
            saveData.coins += runCoins;
            writeSaveData(saveData);
          }
          break;
        }
      }
      enemies = enemies.filter((e) => e.hp > 0);
    }

    // particles
    particles = particles.filter((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.life -= dt;
      return p.life > 0;
    });
  }

  function drawArenaBackground() {
    ctx.fillStyle = "#0b1222";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(96, 165, 250, 0.08)";
    ctx.lineWidth = 1;
    const step = 48;
    for (let x = 0; x <= canvas.width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(96, 165, 250, 0.35)";
    ctx.lineWidth = 3;
    ctx.strokeRect(ARENA_MARGIN, ARENA_MARGIN, canvas.width - ARENA_MARGIN * 2, canvas.height - ARENA_MARGIN * 2);
  }

  function drawPlayer() {
    const blink = invincibleTimer > 0 && Math.floor(invincibleTimer * 12) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = blink ? 0.35 : 1;
    ctx.translate(player.x, player.y);

    // gun barrel, pointing toward the current aim/facing direction
    ctx.save();
    ctx.rotate(player.facing);
    ctx.fillStyle = "#94a3b8";
    ctx.fillRect(PLAYER_RADIUS - 6, -5, 20, 10);
    ctx.restore();

    // body
    const bodyGrad = ctx.createRadialGradient(-6, -6, 4, 0, 0, PLAYER_RADIUS);
    bodyGrad.addColorStop(0, "#7dd3fc");
    bodyGrad.addColorStop(1, "#0ea5e9");
    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = "#0c4a6e";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // visor
    ctx.fillStyle = "#0c4a6e";
    ctx.beginPath();
    ctx.ellipse(0, -2, 11, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e0f2fe";
    ctx.beginPath();
    ctx.ellipse(-3, -3, 3.5, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawEnemy(e) {
    const def = ENEMY_TYPES[e.type];
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = def.color;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (e.type === "scout") {
      ctx.moveTo(0, -def.radius);
      ctx.lineTo(def.radius * 0.85, def.radius * 0.7);
      ctx.lineTo(-def.radius * 0.85, def.radius * 0.7);
      ctx.closePath();
    } else if (e.type === "brute") {
      const r = def.radius;
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI * 2 * i) / 8;
        const rr = i % 2 === 0 ? r : r * 0.72;
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else {
      ctx.arc(0, 0, def.radius, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();

    // eyes
    ctx.fillStyle = "#1e1b2e";
    ctx.beginPath();
    ctx.arc(-def.radius * 0.32, -2, def.radius * 0.14, 0, Math.PI * 2);
    ctx.arc(def.radius * 0.32, -2, def.radius * 0.14, 0, Math.PI * 2);
    ctx.fill();

    if (e.maxHp > 1) {
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(-def.radius, -def.radius - 10, def.radius * 2, 4);
      ctx.fillStyle = "#4ade80";
      ctx.fillRect(-def.radius, -def.radius - 10, (def.radius * 2 * e.hp) / e.maxHp, 4);
    }
    ctx.restore();
  }

  function draw() {
    drawArenaBackground();

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const b of bullets) {
      ctx.fillStyle = "#fde68a";
      ctx.shadowColor = "#fbbf24";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(b.x, b.y, BULLET_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    for (const e of enemies) drawEnemy(e);
    drawPlayer();

    if (waveBanner > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, waveBanner);
      ctx.fillStyle = "#fbbf24";
      ctx.font = "bold 36px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 10;
      ctx.fillText(`Wave ${wave}`, canvas.width / 2, canvas.height * 0.3);
      ctx.restore();
    }
  }

  function isOver() {
    return gameOver;
  }

  function getHud() {
    return { left: `💥 ${score}   🪙 ${runCoins}`, right: "❤".repeat(Math.max(0, lives)) || "💔" };
  }

  function getOverResult() {
    const isBest = score >= best && score > 0;
    return {
      title: "Overwhelmed!",
      message: `${isBest ? "New best! " : ""}Score: ${score} (Best: ${best}) · Wave ${wave}  •  +${runCoins} coins earned`,
    };
  }

  function getPauseInfo() {
    const options = [];
    if (saveData.rapidFireLevel < MAX_UPGRADE_LEVEL) {
      options.push({
        id: "rapid-fire",
        label: `Rapid Fire (Lv.${saveData.rapidFireLevel})`,
        cost: upgradeCost(saveData.rapidFireLevel),
      });
    }
    if (saveData.extraLifeLevel < MAX_UPGRADE_LEVEL) {
      options.push({
        id: "extra-life",
        label: `Extra Life (Lv.${saveData.extraLifeLevel})`,
        cost: upgradeCost(saveData.extraLifeLevel),
      });
    }
    return { coins: saveData.coins, options };
  }

  function applyUpgrade(id) {
    if (id === "rapid-fire" && saveData.rapidFireLevel < MAX_UPGRADE_LEVEL) {
      const cost = upgradeCost(saveData.rapidFireLevel);
      if (saveData.coins < cost) return false;
      saveData.coins -= cost;
      saveData.rapidFireLevel += 1;
      writeSaveData(saveData);
      return true;
    }
    if (id === "extra-life" && saveData.extraLifeLevel < MAX_UPGRADE_LEVEL) {
      const cost = upgradeCost(saveData.extraLifeLevel);
      if (saveData.coins < cost) return false;
      saveData.coins -= cost;
      saveData.extraLifeLevel += 1;
      writeSaveData(saveData);
      return true;
    }
    return false;
  }

  function save() {
    writeSaveData(saveData);
  }

  return {
    id: "blaster",
    title: "Blaster Rush",
    thumbnail: null,
    description: "Dodge and auto-blast endless waves of bots in this mini twin-stick shooter. Just move — your gun does the rest.",
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
