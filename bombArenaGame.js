import { createRoomChannel, subscribeRoom, closeRoom, countPresence, generateRoomCode } from "./multiplayer.js?v=3";
import { hudClearance } from "./utils.js?v=5";

const GRID_COLS = 15;
const GRID_ROWS = 11;
const CELL = 48; // logical unit — simulation NEVER touches canvas.width/height directly
const PLAYER_RADIUS = 16;
const PLAYER_SPEED = 112; // logical units/s
const BOMB_FUSE_MS = 2600;
const BLAST_RADIUS_BASE = 2;
const BLAST_RADIUS_MAX = 5;
const BOMB_CAPACITY_BASE = 1;
const BOMB_CAPACITY_MAX = 6;
const SPEED_MULT_MAX = 1.6;
const SPEED_MULT_STEP = 0.15;
const CRATE_FILL_RATIO = 0.6;
const SAFE_ZONE_RADIUS = 2;
const MOVE_BROADCAST_INTERVAL = 80; // ms
const JOIN_TIMEOUT_MS = 45000;
const MAX_PLAYERS = 4;
const POWERUP_DROP_CHANCE = 0.25;
const POWERUP_RADIUS = 18;
const EXPLOSION_VISUAL_MS = 500;
const DEATH_FADE_MS = 600;

const SKINS = ["adventurer", "female", "player", "soldier", "zombie"];
const SKIN_LABEL = { adventurer: "Adventurer", female: "Female", player: "Player", soldier: "Soldier", zombie: "Zombie" };
const CORNERS = [
  { x: 1, y: 1 },
  { x: GRID_COLS - 2, y: 1 },
  { x: 1, y: GRID_ROWS - 2 },
  { x: GRID_COLS - 2, y: GRID_ROWS - 2 },
];
const POWERUP_KINDS = ["bomb", "blast", "speed"];
const POWERUP_ICON = { bomb: "💣", blast: "🔥", speed: "⚡" };

function poseSrc(skin, pose) {
  const folder = SKIN_LABEL[skin];
  return `Asset/kenney_platformer-characters/PNG/${folder}/Poses/${skin}_${pose}.png`;
}

function loadSprite(src) {
  const sprite = { img: new Image(), loaded: false };
  sprite.img.onload = () => {
    sprite.loaded = true;
  };
  sprite.img.src = src;
  return sprite;
}

// Even,even interior cells (2,2 / 2,4 / 4,2 / ...) — deliberately the opposite
// parity from the four spawn corners (1,1 / 13,1 / 1,9 / 13,9, all odd,odd), or
// every player would spawn embedded inside an indestructible pillar and be
// unable to move at all.
function isPillarCell(x, y) {
  return x % 2 === 0 && y % 2 === 0;
}

function isBorderCell(x, y) {
  return x === 0 || y === 0 || x === GRID_COLS - 1 || y === GRID_ROWS - 1;
}

function cellCenter(x, y) {
  return { x: x * CELL + CELL / 2, y: y * CELL + CELL / 2 };
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export function createBombArenaGame({ canvas, ctx, getPlayerName }) {
  const playerSprites = {};
  for (const skin of SKINS) {
    playerSprites[skin] = {
      idle: loadSprite(poseSrc(skin, "idle")),
      walk1: loadSprite(poseSrc(skin, "walk1")),
      walk2: loadSprite(poseSrc(skin, "walk2")),
      hurt: loadSprite(poseSrc(skin, "hurt")),
    };
  }
  const pillarSprite = loadSprite("Asset/kenney_jumper-pack/PNG/Environment/ground_stone_small.png");
  const crateSprite = loadSprite("Asset/kenney_jumper-pack/PNG/Environment/ground_wood_small.png");
  const flameSprite = loadSprite("Asset/kenney_jumper-pack/PNG/Particles/flame.png");

  let myId = null;
  let myName = "Guest";
  let isHost = false;
  let channel = null;
  let roomCode = null;
  let pendingOnReady = null;

  let roster = []; // ordered ownerIds for this round — assigns skin/corner/index identically everywhere
  let mySkin = SKINS[0];
  let playerNames = new Map(); // ownerId -> name

  let grid = []; // grid[y][x] = "wall" | "crate" | "empty"
  let me = null; // { x, y, facing, moving, alive, capacity, blastRadius, speedMult }
  let ghosts = new Map(); // ownerId -> { x, y, facing, moving, alive, skin, deadAt }
  let bombs = new Map(); // bombId -> { ownerId, cx, cy, placedAt, blastRadius, stillExempt }
  let bombsAt = new Map(); // "x,y" -> bombId
  let powerups = new Map(); // id -> { id, x, y, kind }
  let explosions = []; // { x, y, startedAt }
  let hostBombFuses = new Map(); // bombId -> explodeAt (host only)

  let leftHeld = false;
  let rightHeld = false;
  let upHeld = false;
  let downHeld = false;
  let bombQueued = false;

  let isPlaying = false;
  let roundOver = false;
  let winnerOwnerId = null;
  let moveBroadcastTimer = 0;
  let walkFrameTimer = 0;
  let walkFrame = 0;

  window.addEventListener("keydown", (e) => {
    if (!isPlaying) return;
    if (e.code === "ArrowLeft" || e.code === "KeyA") { leftHeld = true; e.preventDefault(); }
    if (e.code === "ArrowRight" || e.code === "KeyD") { rightHeld = true; e.preventDefault(); }
    if (e.code === "ArrowUp" || e.code === "KeyW") { upHeld = true; e.preventDefault(); }
    if (e.code === "ArrowDown" || e.code === "KeyS") { downHeld = true; e.preventDefault(); }
    if (e.code === "Space") { bombQueued = true; e.preventDefault(); }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") leftHeld = false;
    if (e.code === "ArrowRight" || e.code === "KeyD") rightHeld = false;
    if (e.code === "ArrowUp" || e.code === "KeyW") upHeld = false;
    if (e.code === "ArrowDown" || e.code === "KeyS") downHeld = false;
  });

  // ---------------- Grid ----------------

  function buildGrid(crateList) {
    const g = [];
    for (let y = 0; y < GRID_ROWS; y++) {
      const row = [];
      for (let x = 0; x < GRID_COLS; x++) {
        row.push(isBorderCell(x, y) || isPillarCell(x, y) ? "wall" : "empty");
      }
      g.push(row);
    }
    for (const c of crateList) {
      if (g[c.y] && g[c.y][c.x] === "empty") g[c.y][c.x] = "crate";
    }
    return g;
  }

  function isSafeZone(x, y) {
    return CORNERS.some((c) => Math.abs(c.x - x) + Math.abs(c.y - y) <= SAFE_ZONE_RADIUS);
  }

  function generateCrateList() {
    const list = [];
    for (let y = 1; y < GRID_ROWS - 1; y++) {
      for (let x = 1; x < GRID_COLS - 1; x++) {
        if (isPillarCell(x, y) || isSafeZone(x, y)) continue;
        if (Math.random() < CRATE_FILL_RATIO) list.push({ x, y });
      }
    }
    return list;
  }

  // ---------------- Movement / collision (logical space only) ----------------

  function isSolidForMe(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= GRID_COLS || cy >= GRID_ROWS) return true;
    const cell = grid[cy][cx];
    if (cell === "wall" || cell === "crate") return true;
    const bombId = bombsAt.get(`${cx},${cy}`);
    if (bombId) {
      const bomb = bombs.get(bombId);
      if (bomb && bomb.ownerId === myId && bomb.stillExempt) return false;
      return true;
    }
    return false;
  }

  function circleCollides(px, py, r) {
    const minX = Math.floor((px - r) / CELL);
    const maxX = Math.floor((px + r) / CELL);
    const minY = Math.floor((py - r) / CELL);
    const maxY = Math.floor((py + r) / CELL);
    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        if (!isSolidForMe(gx, gy)) continue;
        const left = gx * CELL;
        const top = gy * CELL;
        const closestX = Math.max(left, Math.min(px, left + CELL));
        const closestY = Math.max(top, Math.min(py, top + CELL));
        if (Math.hypot(px - closestX, py - closestY) < r) return true;
      }
    }
    return false;
  }

  function moveMe(dx, dy) {
    const newX = me.x + dx;
    if (!circleCollides(newX, me.y, PLAYER_RADIUS)) me.x = newX;
    const newY = me.y + dy;
    if (!circleCollides(me.x, newY, PLAYER_RADIUS)) me.y = newY;
  }

  function updateBombExemptions() {
    const myCell = { x: Math.floor(me.x / CELL), y: Math.floor(me.y / CELL) };
    for (const bomb of bombs.values()) {
      if (bomb.ownerId === myId && bomb.stillExempt && (bomb.cx !== myCell.x || bomb.cy !== myCell.y)) {
        bomb.stillExempt = false;
      }
    }
  }

  // ---------------- Bomb placement (local optimistic + broadcast) ----------------

  function myBombCount() {
    let n = 0;
    for (const b of bombs.values()) if (b.ownerId === myId) n++;
    return n;
  }

  function placeBomb() {
    if (!me || !me.alive) return;
    if (myBombCount() >= me.capacity) return;
    const cx = Math.floor(me.x / CELL);
    const cy = Math.floor(me.y / CELL);
    const key = `${cx},${cy}`;
    if (bombsAt.has(key)) return;
    const bombId = `${myId}-${makeId()}`;
    const placedAt = Date.now();
    applyBombPlace({ bombId, ownerId: myId, cx, cy, placedAt, blastRadius: me.blastRadius });
    channel?.send({ type: "broadcast", event: "bomb-place", payload: { bombId, ownerId: myId, cx, cy, placedAt, blastRadius: me.blastRadius } });
  }

  function applyBombPlace(payload) {
    if (bombs.has(payload.bombId)) return;
    bombs.set(payload.bombId, {
      ownerId: payload.ownerId,
      cx: payload.cx,
      cy: payload.cy,
      placedAt: payload.placedAt,
      blastRadius: payload.blastRadius,
      stillExempt: payload.ownerId === myId,
    });
    bombsAt.set(`${payload.cx},${payload.cy}`, payload.bombId);
    if (isHost) hostBombFuses.set(payload.bombId, payload.placedAt + BOMB_FUSE_MS);
  }

  // ---------------- Host-authoritative explosion resolution ----------------

  function hostResolveExplosion(bombId, visited, acc) {
    if (visited.has(bombId)) return;
    visited.add(bombId);
    const bomb = bombs.get(bombId);
    if (!bomb) return;
    acc.bombIds.push(bombId);
    hostBombFuses.delete(bombId);
    acc.blastCells.push({ x: bomb.cx, y: bomb.cy });

    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) {
      for (let step = 1; step <= bomb.blastRadius; step++) {
        const x = bomb.cx + dx * step;
        const y = bomb.cy + dy * step;
        if (x < 0 || y < 0 || x >= GRID_COLS || y >= GRID_ROWS) break;
        if (grid[y][x] === "wall") break;
        acc.blastCells.push({ x, y });
        const chainId = bombsAt.get(`${x},${y}`);
        if (chainId && chainId !== bombId && !visited.has(chainId)) {
          hostResolveExplosion(chainId, visited, acc);
        }
        if (grid[y][x] === "crate") {
          acc.destroyedCrates.push({ x, y });
          break;
        }
      }
    }
  }

  function hostTriggerExplosion(bombId) {
    const visited = new Set();
    const acc = { bombIds: [], blastCells: [], destroyedCrates: [] };
    hostResolveExplosion(bombId, visited, acc);

    const killedOwnerIds = [];
    const targets = new Map(ghosts);
    targets.set(myId, me);
    for (const [ownerId, p] of targets) {
      if (!p || !p.alive || killedOwnerIds.includes(ownerId)) continue;
      const pcx = Math.floor(p.x / CELL);
      const pcy = Math.floor(p.y / CELL);
      if (acc.blastCells.some((c) => c.x === pcx && c.y === pcy)) killedOwnerIds.push(ownerId);
    }

    const powerupList = [];
    for (const c of acc.destroyedCrates) {
      if (Math.random() < POWERUP_DROP_CHANCE) {
        const kind = POWERUP_KINDS[Math.floor(Math.random() * POWERUP_KINDS.length)];
        const center = cellCenter(c.x, c.y);
        powerupList.push({ id: makeId(), x: center.x, y: center.y, kind });
      }
    }

    const payload = { bombIds: acc.bombIds, blastCells: acc.blastCells, destroyedCrates: acc.destroyedCrates, killedOwnerIds, powerups: powerupList };
    // Broadcasts don't echo back to the sender — the host applies its own
    // authoritative result directly instead of waiting on its own broadcast.
    applyBombExplode(payload);
    channel?.send({ type: "broadcast", event: "bomb-explode", payload });
  }

  function applyBombExplode(payload) {
    for (const id of payload.bombIds) {
      const bomb = bombs.get(id);
      if (bomb) bombsAt.delete(`${bomb.cx},${bomb.cy}`);
      bombs.delete(id);
    }
    for (const c of payload.destroyedCrates) {
      if (grid[c.y] && grid[c.y][c.x] === "crate") grid[c.y][c.x] = "empty";
    }
    const now = performance.now();
    for (const c of payload.blastCells) explosions.push({ x: c.x, y: c.y, startedAt: now });
    for (const p of payload.powerups) powerups.set(p.id, p);
    for (const ownerId of payload.killedOwnerIds) {
      if (ownerId === myId) {
        if (me) { me.alive = false; me.deadAt = now; }
      } else {
        const g = ghosts.get(ownerId);
        if (g) { g.alive = false; g.deadAt = now; }
      }
    }
  }

  // ---------------- Powerups (self-authoritative pickup) ----------------

  function applyPowerupEffect(kind) {
    if (kind === "bomb") me.capacity = Math.min(BOMB_CAPACITY_MAX, me.capacity + 1);
    if (kind === "blast") me.blastRadius = Math.min(BLAST_RADIUS_MAX, me.blastRadius + 1);
    if (kind === "speed") me.speedMult = Math.min(SPEED_MULT_MAX, me.speedMult + SPEED_MULT_STEP);
  }

  function checkPowerupPickup() {
    if (!me.alive) return;
    for (const [id, p] of powerups) {
      if (Math.hypot(me.x - p.x, me.y - p.y) < POWERUP_RADIUS + PLAYER_RADIUS * 0.6) {
        applyPowerupEffect(p.kind);
        powerups.delete(id);
        channel?.send({ type: "broadcast", event: "powerup-taken", payload: { powerupId: id, ownerId: myId } });
        break;
      }
    }
  }

  // ---------------- Round lifecycle ----------------

  function aliveCount() {
    let n = me && me.alive ? 1 : 0;
    for (const g of ghosts.values()) if (g.alive) n++;
    return n;
  }

  function hostCheckRoundOver() {
    if (roundOver) return;
    const aliveIds = [];
    if (me && me.alive) aliveIds.push(myId);
    for (const [id, g] of ghosts) if (g.alive) aliveIds.push(id);
    if (aliveIds.length <= 1) {
      const winner = aliveIds.length === 1 ? aliveIds[0] : null;
      const payload = { winnerOwnerId: winner };
      applyRoundOver(payload);
      channel?.send({ type: "broadcast", event: "round-over", payload });
    }
  }

  function applyRoundOver(payload) {
    roundOver = true;
    winnerOwnerId = payload.winnerOwnerId;
    isPlaying = false;
  }

  function applyRoundStart(payload) {
    roster = payload.roster.slice();
    const myIndex = Math.max(0, roster.indexOf(myId));
    mySkin = SKINS[myIndex % SKINS.length];
    const corner = CORNERS[myIndex % CORNERS.length];
    const center = cellCenter(corner.x, corner.y);

    grid = buildGrid(payload.crates);
    bombs = new Map();
    bombsAt = new Map();
    powerups = new Map();
    explosions = [];
    hostBombFuses = new Map();
    ghosts = new Map();

    roster.forEach((ownerId, i) => {
      if (ownerId === myId) return;
      const c = CORNERS[i % CORNERS.length];
      const cc = cellCenter(c.x, c.y);
      ghosts.set(ownerId, {
        x: cc.x,
        y: cc.y,
        facing: 1,
        moving: false,
        alive: true,
        skin: SKINS[i % SKINS.length],
        deadAt: 0,
      });
    });

    me = {
      x: center.x,
      y: center.y,
      facing: 1,
      moving: false,
      alive: true,
      capacity: BOMB_CAPACITY_BASE,
      blastRadius: BLAST_RADIUS_BASE,
      speedMult: 1,
      deadAt: 0,
    };

    leftHeld = false;
    rightHeld = false;
    upHeld = false;
    downHeld = false;
    bombQueued = false;
    moveBroadcastTimer = 0;
    roundOver = false;
    winnerOwnerId = null;
    isPlaying = true;
  }

  // ---------------- Channel wiring ----------------

  function wireChannelHandlers() {
    channel.on("broadcast", { event: "round-start" }, ({ payload }) => {
      applyRoundStart(payload);
      if (pendingOnReady) {
        const cb = pendingOnReady;
        pendingOnReady = null;
        cb();
      }
    });
    channel.on("broadcast", { event: "bomb-place" }, ({ payload }) => applyBombPlace(payload));
    channel.on("broadcast", { event: "bomb-explode" }, ({ payload }) => applyBombExplode(payload));
    channel.on("broadcast", { event: "powerup-taken" }, ({ payload }) => powerups.delete(payload.powerupId));
    channel.on("broadcast", { event: "round-over" }, ({ payload }) => applyRoundOver(payload));
    channel.on("broadcast", { event: "player-move" }, ({ payload }) => {
      if (payload.ownerId === myId) return;
      const g = ghosts.get(payload.ownerId);
      if (!g) return;
      g.x = payload.x;
      g.y = payload.y;
      g.facing = payload.facing;
      g.moving = payload.moving;
      g.alive = payload.alive;
    });
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      for (const key of Object.keys(state)) {
        const meta = state[key][0];
        if (meta?.ownerId) playerNames.set(meta.ownerId, meta.name || "Player");
      }
      if (window.__bombPresenceHook) window.__bombPresenceHook();
    });
    channel.on("presence", { event: "leave" }, () => {
      if (window.__bombPresenceHook) window.__bombPresenceHook();
    });
  }

  // ---------------- update / draw ----------------

  function update(dt) {
    if (!isPlaying || !me) return;
    const dtSec = Math.min(dt, 50) / 1000;

    if (me.alive) {
      let dx = 0;
      let dy = 0;
      if (leftHeld) dx -= 1;
      if (rightHeld) dx += 1;
      if (upHeld) dy -= 1;
      if (downHeld) dy += 1;
      const moving = dx !== 0 || dy !== 0;
      if (moving) {
        const len = Math.hypot(dx, dy) || 1;
        const speed = PLAYER_SPEED * me.speedMult;
        moveMe((dx / len) * speed * dtSec, (dy / len) * speed * dtSec);
        if (dx > 0) me.facing = 1;
        if (dx < 0) me.facing = -1;
      }
      me.moving = moving;
      updateBombExemptions();

      if (bombQueued) {
        bombQueued = false;
        placeBomb();
      }

      checkPowerupPickup();

      walkFrameTimer -= dtSec;
      if (walkFrameTimer <= 0) {
        walkFrameTimer = 0.11;
        walkFrame = walkFrame === 0 ? 1 : 0;
      }

      moveBroadcastTimer += dt;
      if (moveBroadcastTimer >= MOVE_BROADCAST_INTERVAL) {
        moveBroadcastTimer = 0;
        channel?.send({
          type: "broadcast",
          event: "player-move",
          payload: { ownerId: myId, x: me.x, y: me.y, facing: me.facing, moving: me.moving, alive: true },
        });
      }
    }

    if (isHost) {
      const now = Date.now();
      for (const [bombId, explodeAt] of Array.from(hostBombFuses.entries())) {
        if (now >= explodeAt) hostTriggerExplosion(bombId);
      }
      hostCheckRoundOver();
    }

    explosions = explosions.filter((e) => performance.now() - e.startedAt < EXPLOSION_VISUAL_MS);
  }

  function currentPose(sprites, alive, deadAt, moving) {
    if (!alive) return sprites.hurt;
    if (moving) return walkFrame === 0 ? sprites.walk1 : sprites.walk2;
    return sprites.idle;
  }

  function drawEntity(x, y, facing, skin, alive, deadAt, moving, scale, originX, originY) {
    const sprites = playerSprites[skin];
    const pose = currentPose(sprites, alive, deadAt, moving);
    const now = performance.now();
    let alpha = 1;
    if (!alive) {
      const t = (now - deadAt) / DEATH_FADE_MS;
      if (t >= 1) return;
      alpha = 1 - t;
    }
    const sx = originX + x * scale;
    const sy = originY + y * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (pose.loaded) {
      const w = 40 * scale;
      const h = w * (pose.img.naturalHeight / pose.img.naturalWidth);
      ctx.translate(sx, sy);
      ctx.scale(facing, 1);
      ctx.drawImage(pose.img, -w / 2, -h * 0.8, w, h);
    } else {
      ctx.fillStyle = "#38bdf8";
      ctx.beginPath();
      ctx.arc(sx, sy, PLAYER_RADIUS * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw() {
    ctx.fillStyle = "#3f2d1d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!me || grid.length === 0) return;

    const topMargin = Math.max(70, hudClearance(canvas, 90));
    const scale = Math.min(canvas.width / (GRID_COLS * CELL), (canvas.height - topMargin) / (GRID_ROWS * CELL));
    const originX = (canvas.width - GRID_COLS * CELL * scale) / 2;
    const originY = topMargin + (canvas.height - topMargin - GRID_ROWS * CELL * scale) / 2;
    const cellPx = CELL * scale;

    ctx.fillStyle = "#5b4632";
    ctx.fillRect(originX, originY, GRID_COLS * cellPx, GRID_ROWS * cellPx);

    for (let y = 0; y < GRID_ROWS; y++) {
      for (let x = 0; x < GRID_COLS; x++) {
        const cell = grid[y][x];
        if (cell === "empty") continue;
        const sprite = cell === "wall" ? pillarSprite : crateSprite;
        const sx = originX + x * cellPx;
        const sy = originY + y * cellPx;
        if (sprite.loaded) {
          ctx.drawImage(sprite.img, sx, sy, cellPx, cellPx);
        } else {
          ctx.fillStyle = cell === "wall" ? "#94a3b8" : "#b45309";
          ctx.fillRect(sx + 1, sy + 1, cellPx - 2, cellPx - 2);
        }
      }
    }

    for (const p of powerups.values()) {
      const sx = originX + p.x * scale;
      const sy = originY + p.y * scale;
      ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
      ctx.beginPath();
      ctx.arc(sx, sy, POWERUP_RADIUS * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `${Math.round(20 * scale)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(POWERUP_ICON[p.kind], sx, sy + 1);
    }

    const now = Date.now();
    for (const bomb of bombs.values()) {
      const sx = originX + (bomb.cx * CELL + CELL / 2) * scale;
      const sy = originY + (bomb.cy * CELL + CELL / 2) * scale;
      const t = Math.max(0, Math.min(1, (now - bomb.placedAt) / BOMB_FUSE_MS));
      const pulse = 1 + Math.sin(t * Math.PI * 10) * 0.08 * t;
      const r = CELL * 0.32 * scale * pulse;
      ctx.fillStyle = "#1f2937";
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.arc(sx - r * 0.3, sy - r * 0.3, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = Math.max(1, 2 * scale);
      ctx.beginPath();
      ctx.moveTo(sx, sy - r);
      ctx.lineTo(sx + r * 0.4, sy - r * 1.6);
      ctx.stroke();
    }

    for (const e of explosions) {
      const t = (performance.now() - e.startedAt) / EXPLOSION_VISUAL_MS;
      const sx = originX + (e.x * CELL + CELL / 2) * scale;
      const sy = originY + (e.y * CELL + CELL / 2) * scale;
      const size = cellPx * (0.6 + t * 0.7);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t);
      if (flameSprite.loaded) {
        ctx.drawImage(flameSprite.img, sx - size / 2, sy - size / 2, size, size);
      } else {
        ctx.fillStyle = "#fb923c";
        ctx.beginPath();
        ctx.arc(sx, sy, size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    for (const [ownerId, g] of ghosts) {
      drawEntity(g.x, g.y, g.facing, g.skin, g.alive, g.deadAt, g.moving, scale, originX, originY);
    }
    drawEntity(me.x, me.y, me.facing, mySkin, me.alive, me.deadAt, me.moving, scale, originX, originY);

    if (!me.alive && !roundOver) {
      ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
      ctx.fillRect(canvas.width / 2 - 170, topMargin + 8, 340, 34);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 15px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("💀 Eliminated — spectating the rest of the round", canvas.width / 2, topMargin + 25);
    }
  }

  // Dying doesn't end your view — the host is the sole authority for bomb fuses
  // and round-over, and main.js stops calling update() once isOver() is true, so
  // ending the host's own loop on personal death would freeze the round for
  // everyone else. Instead a dead player keeps spectating (still simulating in
  // the background) until the host's round-over broadcast actually arrives.
  function isOver() {
    return roundOver;
  }

  function getHud() {
    if (me && !me.alive) return { left: "💀 Eliminated — spectating", right: `👥 ${aliveCount()}` };
    return {
      left: `💣 ${me ? me.capacity - myBombCount() : 0}   🔥 ${me?.blastRadius ?? 0}`,
      right: `👥 ${aliveCount()}`,
    };
  }

  function getOverResult() {
    if (winnerOwnerId === myId) return { title: "You Won!", message: "Last one standing!" };
    if (winnerOwnerId) return { title: `${playerNames.get(winnerOwnerId) || "Opponent"} Wins!`, message: me?.alive ? "" : "You were eliminated." };
    return { title: "Draw!", message: "Nobody made it out." };
  }

  function reset() {
    // Round setup happens in applyRoundStart, driven by the host's round-start
    // broadcast — reset() here is only reached via the lobby's onReady, after
    // that broadcast has already been applied.
  }

  function save() {
    closeRoom(channel);
    channel = null;
    isPlaying = false;
  }

  // ---------------- Lobby ----------------

  function renderChoiceScreen(overlayEl, onReady, onCancel) {
    overlayEl.innerHTML = `
      <h1>Bomb Arena</h1>
      <p>Place bombs, blow up crates and friends, last one standing wins. 2-4 players.</p>
      <button data-lobby-action="create">Create Room</button>
      <button class="secondary" data-lobby-action="join">Join Room</button>
      <button class="auth-toggle" type="button" data-lobby-action="cancel">← Back</button>
    `;
    overlayEl.querySelector('[data-lobby-action="create"]').addEventListener("click", () => createRoom(overlayEl, onReady, onCancel));
    overlayEl.querySelector('[data-lobby-action="join"]').addEventListener("click", () => renderJoinScreen(overlayEl, onReady, onCancel));
    overlayEl.querySelector('[data-lobby-action="cancel"]').addEventListener("click", onCancel);
  }

  function renderJoinScreen(overlayEl, onReady, onCancel) {
    overlayEl.innerHTML = `
      <h1>Bomb Arena</h1>
      <form id="joinForm" class="auth-form">
        <input type="text" id="roomCodeInput" placeholder="4-digit code" maxlength="4" inputmode="numeric" required />
        <button type="submit">Join</button>
      </form>
      <button class="auth-toggle" type="button" data-lobby-action="back">← Back</button>
      <p id="joinStatus"></p>
    `;
    overlayEl.querySelector('[data-lobby-action="back"]').addEventListener("click", () => renderChoiceScreen(overlayEl, onReady, onCancel));
    overlayEl.querySelector("#joinForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = overlayEl.querySelector("#roomCodeInput").value.trim();
      if (!/^\d{4}$/.test(code)) {
        overlayEl.querySelector("#joinStatus").textContent = "Enter the 4-digit code your friend shared.";
        return;
      }
      await joinRoom(overlayEl, code, onReady, onCancel);
    });
  }

  async function createRoom(overlayEl, onReady, onCancel) {
    const code = generateRoomCode();
    myId = crypto.randomUUID();
    myName = getPlayerName ? getPlayerName() : "Guest";
    isHost = true;
    roomCode = code;

    overlayEl.innerHTML = `<h1>Bomb Arena</h1><p>Setting up...</p>`;
    channel = createRoomChannel(code, myId, "bomb-arena");
    wireChannelHandlers();
    await subscribeRoom(channel, { ownerId: myId, name: myName, isHost: true });
    renderWaitingRoom(overlayEl, code, onReady, onCancel, true);
  }

  async function joinRoom(overlayEl, code, onReady, onCancel) {
    myId = crypto.randomUUID();
    myName = getPlayerName ? getPlayerName() : "Guest";
    isHost = false;
    roomCode = code;

    overlayEl.innerHTML = `<h1>Bomb Arena</h1><p>Joining...</p>`;
    channel = createRoomChannel(code, myId, "bomb-arena");
    wireChannelHandlers();
    await subscribeRoom(channel, { ownerId: myId, name: myName, isHost: false });

    if (countPresence(channel) > MAX_PLAYERS) {
      closeRoom(channel);
      channel = null;
      overlayEl.innerHTML = `<h1>Bomb Arena</h1><p>This room is full (max ${MAX_PLAYERS} players).</p><button data-lobby-action="back">Back</button>`;
      overlayEl.querySelector('[data-lobby-action="back"]').addEventListener("click", () => renderChoiceScreen(overlayEl, onReady, onCancel));
      return;
    }
    renderWaitingRoom(overlayEl, code, onReady, onCancel, false);
  }

  function renderWaitingRoom(overlayEl, code, onReady, onCancel, hostRole) {
    overlayEl.innerHTML = `
      <h1>Bomb Arena</h1>
      <p>Room code: <span id="roomCodeValue" class="room-code">${code}</span></p>
      <div id="playerList" class="selectRow"></div>
      <p id="waitStatus">${hostRole ? "Waiting for friends to join..." : "Waiting for the host to start..."}</p>
      ${hostRole ? `<button data-lobby-action="start">Start Game</button>` : ""}
      <button class="secondary" data-lobby-action="cancel-wait">Cancel</button>
    `;

    function renderPlayerList() {
      const el = overlayEl.querySelector("#playerList");
      if (!el || !channel) return;
      const state = channel.presenceState();
      const names = Object.values(state).map((entries) => entries[0]?.name || "Player");
      el.textContent = `Players (${names.length}/${MAX_PLAYERS}): ${names.join(", ")}`;
    }
    renderPlayerList();
    window.__bombPresenceHook = renderPlayerList;

    overlayEl.querySelector('[data-lobby-action="cancel-wait"]').addEventListener("click", () => {
      clearTimeout(timeoutId);
      window.__bombPresenceHook = null;
      pendingOnReady = null;
      closeRoom(channel);
      channel = null;
      onCancel();
    });

    let startedByHost = false;
    if (hostRole) {
      overlayEl.querySelector('[data-lobby-action="start"]').addEventListener("click", () => {
        if (startedByHost) return;
        startedByHost = true;
        clearTimeout(timeoutId);
        window.__bombPresenceHook = null;
        const state = channel.presenceState();
        const ids = Object.values(state).map((entries) => entries[0]?.ownerId).filter(Boolean);
        const roundRoster = ids.slice(0, MAX_PLAYERS).sort();
        const crates = generateCrateList();
        const payload = { crates, roster: roundRoster };
        // Supabase broadcasts don't echo back to the sender, so the host applies
        // its own round state directly instead of waiting on its own broadcast.
        applyRoundStart(payload);
        channel.send({ type: "broadcast", event: "round-start", payload });
        onReady();
      });
    } else {
      pendingOnReady = () => {
        clearTimeout(timeoutId);
        window.__bombPresenceHook = null;
        onReady();
      };
    }

    const timeoutId = hostRole
      ? null
      : setTimeout(() => {
          if (countPresence(channel) < 2) {
            window.__bombPresenceHook = null;
            closeRoom(channel);
            channel = null;
            overlayEl.innerHTML = `<h1>Bomb Arena</h1><p>Nobody joined in time. Double check the code and try again.</p><button data-lobby-action="back">Back</button>`;
            overlayEl.querySelector('[data-lobby-action="back"]').addEventListener("click", () => renderChoiceScreen(overlayEl, onReady, onCancel));
          }
        }, JOIN_TIMEOUT_MS);
  }

  function renderLobby(overlayEl, { onReady, onCancel }) {
    closeRoom(channel);
    channel = null;
    pendingOnReady = null;
    roster = [];
    ghosts = new Map();
    playerNames = new Map();
    me = null;
    grid = [];
    renderChoiceScreen(overlayEl, onReady, onCancel);
  }

  return {
    id: "bomb-arena",
    title: "Bomb Arena",
    thumbnail: null,
    description: "Multiplayer Bomberman-style battle — place bombs, blow up crates and friends, last one standing wins.",
    needsLobby: true,
    renderLobby,
    reset,
    update,
    draw,
    isOver,
    getHud,
    getOverResult,
    save,
  };
}
