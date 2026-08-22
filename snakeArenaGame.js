import {
  createRoomChannel,
  subscribeRoom,
  closeRoom,
  countPresence,
  generateRoomCode,
  findAvailableRoom,
  registerPublicRoom,
  heartbeatRoom,
  removeRoom,
} from "./multiplayer.js?v=2";
import { hudClearance } from "./utils.js?v=5";

const ARENA_RADIUS = 1500;
const SPEED = 180; // px/s
const MAX_TURN_RATE = 4.0; // rad/s, mouse steering
const KEY_TURN_RATE = 4.0; // rad/s, keyboard steering
const SEGMENT_SPACING = 6;
const BASE_LENGTH_SEGMENTS = 20;
const MAX_BODY_SEGMENTS = 350; // visual/collision body length cap — independent of the height stat, which is uncapped
const BODY_GROWTH_RATE = 0.08; // how many extra rendered segments per point of height, before the cap
const GROWTH_PER_FOOD_HEIGHT = 15;
const COLLISION_RADIUS = 14;
const EAT_RADIUS = 16;
const STEP_BROADCAST_INTERVAL = 80; // ms
const FOOD_SYNC_INTERVAL = 2000; // ms
const TARGET_FOOD_COUNT = 180;
const JOIN_TIMEOUT_MS = 45000;
const HOST_LEFT_NOTICE_MS = 5000;
const ONLINE_ARENA_CAPACITY = 8;
const ROOM_HEARTBEAT_INTERVAL = 6000; // ms

const TARGET_BOT_COUNT = 19; // + the player = 20 snakes in the arena
const BOT_RESPAWN_DELAY = 4; // seconds
const BOT_SENSE_RADIUS = 400;
const BOT_NAMES = [
  "Wiggly", "Zippy", "Muncher", "Blitz", "Scales", "Turbo", "Slinky", "Rex", "Noodle", "Fang",
  "Coily", "Viper", "Python", "Dash", "Nibbles", "Sly", "Twister", "Boa", "Whip",
];

function bodyLengthFor(height) {
  return Math.min(MAX_BODY_SEGMENTS, BASE_LENGTH_SEGMENTS + height * BODY_GROWTH_RATE);
}

function formatHeight(n) {
  const v = Math.floor(n || 0);
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

const SNAKE_COLORS = ["#4ade80", "#60a5fa", "#f472b6", "#fbbf24", "#c084fc", "#f87171", "#2dd4bf", "#fb923c"];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return hash;
}

function colorForId(id) {
  return SNAKE_COLORS[hashString(id) % SNAKE_COLORS.length];
}

function startPositionForId(id) {
  const angle = (hashString(`${id}-pos`) % 360) * (Math.PI / 180);
  const radius = ARENA_RADIUS * 0.35;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, angle };
}

function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turnToward(current, target, maxDelta) {
  const diff = angleDiff(current, target);
  const clamped = Math.max(-maxDelta, Math.min(maxDelta, diff));
  return current + clamped;
}

function randPointInArena() {
  const r = Math.sqrt(Math.random()) * ARENA_RADIUS * 0.9;
  const a = Math.random() * Math.PI * 2;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

function makeOrbId() {
  return Math.random().toString(36).slice(2, 10);
}

export function createSnakeArenaGame({ canvas, ctx, getPlayerName }) {
  let mode = "online"; // "online" | "offline"
  let myId = null;
  let myName = "Guest";
  let isHost = false;
  let channel = null;
  let hostPresenceKey = null;
  let pendingOnReady = null;
  let isPublicRoom = false;
  let roomCode = null;
  let roomHeartbeatTimer = 0;

  let mySnake = null;
  let opponents = new Map(); // ownerId -> {ownerId,head,heading,segments,score,name}  (online)
  let bots = new Map(); // ownerId -> full snake state (offline)
  let presenceNames = new Map(); // ownerId -> name
  let orbs = new Map(); // id -> {x,y}
  const camera = { x: 0, y: 0 };

  let leftHeld = false;
  let rightHeld = false;
  let mouseActive = false;
  let mouseTargetHeading = 0;

  let stepBroadcastTimer = 0;
  let foodSyncTimer = 0;
  let hostLeftAt = 0;
  let dead = false;
  let deathReason = "";
  let isPlaying = false;
  let botRespawnTimer = 0;
  let botNameIndex = 0;
  let botCounter = 0;

  window.addEventListener("keydown", (e) => {
    if (!isPlaying) return;
    if (e.code === "ArrowLeft" || e.code === "KeyA") {
      leftHeld = true;
      e.preventDefault();
    }
    if (e.code === "ArrowRight" || e.code === "KeyD") {
      rightHeld = true;
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") leftHeld = false;
    if (e.code === "ArrowRight" || e.code === "KeyD") rightHeld = false;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!isPlaying || !mySnake) return;
    mouseActive = true;
    const world = screenToWorld(e.clientX, e.clientY);
    mouseTargetHeading = Math.atan2(world.y - mySnake.head.y, world.x - mySnake.head.x);
  });

  function screenToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.max(rect.width / canvas.width, rect.height / canvas.height);
    const offsetX = (rect.width - canvas.width * scale) / 2;
    const offsetY = (rect.height - canvas.height * scale) / 2;
    const canvasX = (clientX - rect.left - offsetX) / scale;
    const canvasY = (clientY - rect.top - offsetY) / scale;
    return {
      x: canvasX + camera.x - canvas.width / 2,
      y: canvasY + camera.y - canvas.height / 2,
    };
  }

  function spawnOrb() {
    const p = randPointInArena();
    orbs.set(makeOrbId(), { x: p.x, y: p.y });
  }

  function hostConsumeOrb(orbId) {
    if (orbs.delete(orbId)) spawnOrb();
  }

  function broadcastFoodSync() {
    if (!channel) return;
    const list = Array.from(orbs.entries()).map(([id, o]) => ({ id, x: o.x, y: o.y }));
    channel.send({ type: "broadcast", event: "food-sync", payload: { orbs: list } });
  }

  function absorbVictim(killer, victim) {
    killer.height += victim.height || 0;
  }

  function wireChannelHandlers() {
    channel.on("broadcast", { event: "snake-step" }, ({ payload }) => {
      if (payload.ownerId === myId) return;
      opponents.set(payload.ownerId, {
        ownerId: payload.ownerId,
        head: payload.head,
        heading: payload.heading,
        segments: payload.segments,
        height: payload.height,
        name: presenceNames.get(payload.ownerId) || "Player",
      });
    });

    channel.on("broadcast", { event: "food-sync" }, ({ payload }) => {
      if (isHost) return;
      orbs = new Map(payload.orbs.map((o) => [o.id, { x: o.x, y: o.y }]));
    });

    channel.on("broadcast", { event: "food-eaten" }, ({ payload }) => {
      if (!isHost) return;
      hostConsumeOrb(payload.orbId);
    });

    channel.on("broadcast", { event: "snake-died" }, ({ payload }) => {
      opponents.delete(payload.ownerId);
      if (payload.killerId === myId && mySnake && mySnake.alive) {
        absorbVictim(mySnake, { height: payload.height });
      }
      if (isHost && Array.isArray(payload.segments)) {
        payload.segments
          .filter((_, i) => i % 4 === 0)
          .forEach((seg) => orbs.set(makeOrbId(), { x: seg.x, y: seg.y }));
      }
    });

    channel.on("broadcast", { event: "game-start" }, () => {
      if (!isHost && pendingOnReady) {
        const cb = pendingOnReady;
        pendingOnReady = null;
        cb();
      }
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      for (const key of Object.keys(state)) {
        const meta = state[key][0];
        if (meta.isHost) hostPresenceKey = key;
        if (meta.ownerId) presenceNames.set(meta.ownerId, meta.name || "Player");
      }
      if (window.__arenaPresenceHook) window.__arenaPresenceHook();
    });

    channel.on("presence", { event: "leave" }, ({ key }) => {
      if (key === hostPresenceKey && isPlaying && !isHost) {
        hostLeftAt = performance.now();
      }
      if (window.__arenaPresenceHook) window.__arenaPresenceHook();
    });
  }

  function die(killerId, reasonText, killerSnakeForAbsorb) {
    if (!mySnake || !mySnake.alive) return;
    mySnake.alive = false;
    dead = true;
    deathReason = reasonText;
    isPlaying = false;
    if (mode === "online" && channel) {
      channel.send({
        type: "broadcast",
        event: "snake-died",
        payload: {
          ownerId: myId,
          killerId,
          segments: mySnake.segments,
          height: mySnake.height,
        },
      });
    } else if (mode === "offline" && killerSnakeForAbsorb) {
      absorbVictim(killerSnakeForAbsorb, mySnake);
    }
  }

  // Generic collision test: does `snake`'s head touch anything in `others` (a Map, excluding excludeId)?
  function checkSnakeCollisions(snake, others, excludeId) {
    if (Math.hypot(snake.head.x, snake.head.y) > ARENA_RADIUS) {
      return { type: "wall" };
    }
    for (const [id, other] of others) {
      if (id === excludeId || other.alive === false || !other.segments || other.segments.length === 0) continue;
      if (Math.hypot(snake.head.x - other.head.x, snake.head.y - other.head.y) < COLLISION_RADIUS) {
        return { type: "head", otherId: id, other };
      }
    }
    for (const [id, other] of others) {
      if (id === excludeId || other.alive === false || !other.segments) continue;
      for (const seg of other.segments) {
        if (Math.hypot(snake.head.x - seg.x, snake.head.y - seg.y) < COLLISION_RADIUS) {
          return { type: "body", otherId: id, other };
        }
      }
    }
    return null;
  }

  function advanceSnake(snake, dtSec) {
    snake.head.x += Math.cos(snake.heading) * SPEED * dtSec;
    snake.head.y += Math.sin(snake.heading) * SPEED * dtSec;
    const front = snake.segments[0];
    if (!front || Math.hypot(snake.head.x - front.x, snake.head.y - front.y) >= SEGMENT_SPACING) {
      snake.segments.unshift({ x: snake.head.x, y: snake.head.y });
    }
    const maxLen = Math.max(1, Math.ceil(bodyLengthFor(snake.height)));
    if (snake.segments.length > maxLen) snake.segments.length = maxLen;
  }

  function playerDesiredHeadingDelta(dtSec) {
    if (leftHeld) mySnake.heading -= KEY_TURN_RATE * dtSec;
    if (rightHeld) mySnake.heading += KEY_TURN_RATE * dtSec;
    if (!leftHeld && !rightHeld && mouseActive) {
      mySnake.heading = turnToward(mySnake.heading, mouseTargetHeading, MAX_TURN_RATE * dtSec);
    }
  }

  // ---------------- Online mode ----------------

  function updateOnlineTick(dt, dtSec) {
    playerDesiredHeadingDelta(dtSec);
    advanceSnake(mySnake, dtSec);
    camera.x = mySnake.head.x;
    camera.y = mySnake.head.y;

    const hit = checkSnakeCollisions(mySnake, opponents, null);
    if (hit) {
      if (hit.type === "wall") die(null, "You hit the wall!");
      else if (hit.type === "head") die(null, `Collided head-on with ${hit.other.name}!`);
      else die(hit.otherId, `Eaten by ${hit.other.name}!`);
    }
    if (!mySnake.alive) return;

    for (const [id, orb] of orbs) {
      if (Math.hypot(mySnake.head.x - orb.x, mySnake.head.y - orb.y) < EAT_RADIUS) {
        mySnake.height += GROWTH_PER_FOOD_HEIGHT;
        orbs.delete(id);
        if (isHost) {
          spawnOrb();
        } else {
          channel?.send({ type: "broadcast", event: "food-eaten", payload: { orbId: id, ownerId: myId } });
        }
        break;
      }
    }

    stepBroadcastTimer += dt;
    if (stepBroadcastTimer >= STEP_BROADCAST_INTERVAL) {
      stepBroadcastTimer = 0;
      channel?.send({
        type: "broadcast",
        event: "snake-step",
        payload: {
          ownerId: myId,
          head: mySnake.head,
          heading: mySnake.heading,
          segments: mySnake.segments,
          height: mySnake.height,
        },
      });
    }

    if (isHost) {
      foodSyncTimer += dt;
      if (foodSyncTimer >= FOOD_SYNC_INTERVAL) {
        foodSyncTimer = 0;
        broadcastFoodSync();
      }
      if (isPublicRoom && roomCode) {
        roomHeartbeatTimer += dt;
        if (roomHeartbeatTimer >= ROOM_HEARTBEAT_INTERVAL) {
          roomHeartbeatTimer = 0;
          heartbeatRoom(roomCode, countPresence(channel));
        }
      }
    }
  }

  // ---------------- Offline mode (bots) ----------------

  function spawnBot() {
    const id = `bot-${botCounter++}-${Math.random().toString(36).slice(2, 6)}`;
    const name = botNameIndex < BOT_NAMES.length ? BOT_NAMES[botNameIndex] : `${BOT_NAMES[botNameIndex % BOT_NAMES.length]} ${Math.floor(botNameIndex / BOT_NAMES.length) + 1}`;
    botNameIndex++;
    const pos = startPositionForId(id);
    bots.set(id, {
      ownerId: id,
      name,
      head: { x: pos.x, y: pos.y },
      heading: pos.angle + Math.PI,
      segments: [{ x: pos.x, y: pos.y }],
      height: Math.random() * 100,
      alive: true,
      wanderTimer: 0,
      wanderHeading: pos.angle + Math.PI,
      targetOrbId: null,
      retargetTimer: 0,
      stuckCheckTimer: 3,
      stuckCheckPos: { x: pos.x, y: pos.y },
    });
  }

  // Watchdog: whatever the exact cause, a bot that hasn't covered real ground in the
  // last few seconds is stuck (tight orbit, mutual-avoidance deadlock, or worse) —
  // force it onto a fresh heading rather than trying to out-think every possible cause.
  function applyStuckWatchdog(bot, dtSec) {
    bot.stuckCheckTimer -= dtSec;
    if (bot.stuckCheckTimer > 0) return;
    bot.stuckCheckTimer = 3;
    const moved = Math.hypot(bot.head.x - bot.stuckCheckPos.x, bot.head.y - bot.stuckCheckPos.y);
    bot.stuckCheckPos = { x: bot.head.x, y: bot.head.y };
    if (moved < 150) {
      bot.wanderHeading = Math.random() * Math.PI * 2;
      bot.wanderTimer = 2 + Math.random() * 2;
      bot.targetOrbId = null;
      bot.retargetTimer = 1.5;
      bot.heading = bot.wanderHeading;
    }
  }

  function computeBotDesiredHeading(bot, dtSec) {
    applyStuckWatchdog(bot, dtSec);

    // Wall proximity is a hard priority: return immediately so nothing below (food,
    // wander, obstacle-dodging) can fight it and drag the bot back toward the edge —
    // that tug-of-war was a second source of the "circling" bots kept getting stuck in.
    if (Math.hypot(bot.head.x, bot.head.y) > ARENA_RADIUS * 0.82) {
      return Math.atan2(-bot.head.y, -bot.head.x);
    }

    // Commit to a target orb for a short while instead of re-picking "nearest" every
    // frame — otherwise a bot sitting between two near-equidistant orbs flips its target
    // back and forth as it moves, and never actually closes in on either (visible as
    // small stable orbits / circling instead of real travel).
    bot.retargetTimer = (bot.retargetTimer || 0) - dtSec;
    const lockedTarget = bot.targetOrbId ? orbs.get(bot.targetOrbId) : null;
    if (!lockedTarget || bot.retargetTimer <= 0) {
      bot.retargetTimer = 0.6 + Math.random() * 0.4;
      let bestId = null;
      let bestDist = BOT_SENSE_RADIUS;
      for (const [id, orb] of orbs) {
        const d = Math.hypot(orb.x - bot.head.x, orb.y - bot.head.y);
        if (d < bestDist) {
          bestDist = d;
          bestId = id;
        }
      }
      bot.targetOrbId = bestId;
    }
    const target = bot.targetOrbId ? orbs.get(bot.targetOrbId) : null;

    let desired;
    if (target) {
      desired = Math.atan2(target.y - bot.head.y, target.x - bot.head.x);
    } else {
      bot.wanderTimer -= dtSec;
      if (bot.wanderTimer <= 0) {
        bot.wanderTimer = 2 + Math.random() * 2.5;
        // Pick a fresh ABSOLUTE heading, not an offset from the current one — an offset
        // recomputed every frame relative to a heading that's already chasing it creates
        // a feedback loop where the bot just spirals forever instead of going anywhere.
        bot.wanderHeading = Math.random() * Math.PI * 2;
      }
      desired = bot.wanderHeading;
    }

    // Obstacle avoidance: steer directly away from the nearest threatening segment,
    // rather than nudging by an arbitrary fixed rotation. A fixed nudge doesn't know
    // which way is actually safe, so if a threat lingers in range across frames it can
    // sustain near-max-rate turning indefinitely — a real escape vector resolves once
    // the bot has put distance between itself and the threat, instead of orbiting it.
    const lookX = bot.head.x + Math.cos(bot.heading) * 70;
    const lookY = bot.head.y + Math.sin(bot.heading) * 70;
    const everyone = allSnakesMap();
    let nearestThreatDist = 45;
    let nearestThreatSeg = null;
    for (const [id, other] of everyone) {
      if (id === bot.ownerId || other.alive === false || !other.segments) continue;
      for (const seg of other.segments) {
        const d = Math.hypot(lookX - seg.x, lookY - seg.y);
        if (d < nearestThreatDist) {
          nearestThreatDist = d;
          nearestThreatSeg = seg;
        }
      }
    }
    if (nearestThreatSeg) {
      desired = Math.atan2(bot.head.y - nearestThreatSeg.y, bot.head.x - nearestThreatSeg.x);
    }

    return desired;
  }

  function allSnakesMap() {
    const map = new Map(bots);
    if (mySnake) map.set(myId, mySnake);
    return map;
  }

  function tryEatFoodOffline(snake) {
    for (const [id, orb] of orbs) {
      if (Math.hypot(snake.head.x - orb.x, snake.head.y - orb.y) < EAT_RADIUS) {
        snake.height += GROWTH_PER_FOOD_HEIGHT;
        orbs.delete(id);
        spawnOrb();
        break;
      }
    }
  }

  function updateOfflineTick(dtSec) {
    playerDesiredHeadingDelta(dtSec);
    advanceSnake(mySnake, dtSec);
    camera.x = mySnake.head.x;
    camera.y = mySnake.head.y;

    for (const bot of bots.values()) {
      if (!bot.alive) continue;
      const desired = computeBotDesiredHeading(bot, dtSec);
      bot.heading = turnToward(bot.heading, desired, MAX_TURN_RATE * dtSec);
      advanceSnake(bot, dtSec);
    }

    tryEatFoodOffline(mySnake);
    for (const bot of bots.values()) {
      if (bot.alive) tryEatFoodOffline(bot);
    }

    const playerHit = checkSnakeCollisions(mySnake, bots, null);
    if (playerHit) {
      if (playerHit.type === "wall") die(null, "You hit the wall!");
      else if (playerHit.type === "head") die(null, `Collided head-on with ${playerHit.other.name}!`);
      else die(playerHit.otherId, `Eaten by ${playerHit.other.name}!`, playerHit.other);
    }

    const everyone = allSnakesMap();
    for (const [id, bot] of bots) {
      if (!bot.alive) continue;
      const hit = checkSnakeCollisions(bot, everyone, id);
      if (hit) {
        bot.alive = false;
        if (hit.type === "body") {
          const killer = hit.otherId === myId ? mySnake : bots.get(hit.otherId);
          if (killer && (hit.otherId !== myId || mySnake.alive)) absorbVictim(killer, bot);
        }
      }
    }

    for (const [id, bot] of bots) {
      if (!bot.alive) bots.delete(id);
    }
    botRespawnTimer -= dtSec;
    if (botRespawnTimer <= 0 && bots.size < TARGET_BOT_COUNT) {
      const deficit = TARGET_BOT_COUNT - bots.size;
      const spawnCount = deficit > 6 ? 3 : 1;
      for (let i = 0; i < spawnCount; i++) spawnBot();
      botRespawnTimer = BOT_RESPAWN_DELAY;
    }
  }

  function update(dt) {
    if (!isPlaying || !mySnake || !mySnake.alive) return;
    const dtSec = Math.min(dt, 50) / 1000;
    if (mode === "offline") {
      updateOfflineTick(dtSec);
    } else {
      updateOnlineTick(dt, dtSec);
    }
  }

  // ---------------- Rendering ----------------
  // Faces are drawn in a rotated local frame (+x = the direction the snake is
  // facing, +y = one side) so each variant is written once, in plain
  // straight-ahead coordinates, and canvas's own rotate() handles orienting it
  // to the snake's actual heading — no per-point forward/side math needed.

  function drawBlush(r) {
    ctx.fillStyle = "rgba(248, 113, 113, 0.35)";
    [-1, 1].forEach((s) => {
      ctx.beginPath();
      ctx.ellipse(r * 0.08, r * 0.75 * s, r * 0.16, r * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function faceClassic(r) {
    ctx.fillStyle = "#0f172a";
    [-1, 1].forEach((s) => {
      ctx.beginPath();
      ctx.arc(r * 0.3, r * 0.45 * s, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = r * 0.12;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(r * 0.85, -r * 0.3);
    ctx.lineTo(r * 0.85, r * 0.3);
    ctx.stroke();
  }

  function faceGoogly(r) {
    [-1, 1].forEach((s) => {
      ctx.fillStyle = "#f8fafc";
      ctx.beginPath();
      ctx.arc(r * 0.28, r * 0.5 * s, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(15,23,42,0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(r * 0.38, r * 0.5 * s + r * 0.08 * s, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = r * 0.1;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(r * 0.7, -r * 0.25);
    ctx.quadraticCurveTo(r * 0.95, 0, r * 0.7, r * 0.25);
    ctx.stroke();
  }

  function faceWink(r) {
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc(r * 0.3, -r * 0.45, r * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = r * 0.1;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(r * 0.18, r * 0.45);
    ctx.lineTo(r * 0.42, r * 0.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r * 0.65, -r * 0.28);
    ctx.quadraticCurveTo(r * 0.95, 0, r * 0.7, r * 0.32);
    ctx.stroke();
  }

  function faceTongue(r) {
    ctx.fillStyle = "#0f172a";
    [-1, 1].forEach((s) => {
      ctx.beginPath();
      ctx.arc(r * 0.3, r * 0.45 * s, r * 0.15, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = "#7f1d1d";
    ctx.beginPath();
    ctx.arc(r * 0.85, 0, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f87171";
    ctx.lineWidth = r * 0.16;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(r * 0.95, r * 0.1);
    ctx.lineTo(r * 1.5, r * 0.35);
    ctx.stroke();
  }

  function faceAngry(r) {
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = r * 0.13;
    ctx.lineCap = "round";
    [-1, 1].forEach((s) => {
      ctx.beginPath();
      ctx.moveTo(r * 0.05, r * 0.3 * s);
      ctx.lineTo(r * 0.42, r * 0.55 * s);
      ctx.stroke();
    });
    ctx.fillStyle = "#0f172a";
    [-1, 1].forEach((s) => {
      ctx.beginPath();
      ctx.arc(r * 0.38, r * 0.45 * s, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.beginPath();
    ctx.moveTo(r * 0.85, -r * 0.22);
    ctx.lineTo(r * 0.85, r * 0.22);
    ctx.stroke();
  }

  function faceSurprised(r) {
    [-1, 1].forEach((s) => {
      ctx.fillStyle = "#f8fafc";
      ctx.beginPath();
      ctx.arc(r * 0.32, r * 0.42 * s, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(r * 0.32, r * 0.42 * s, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc(r * 0.88, 0, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }

  function faceShades(r) {
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = r * 0.28;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(r * 0.3, -r * 0.5);
    ctx.lineTo(r * 0.3, r * 0.5);
    ctx.stroke();
    ctx.lineWidth = r * 0.1;
    ctx.beginPath();
    ctx.moveTo(r * 0.68, -r * 0.25);
    ctx.quadraticCurveTo(r * 0.95, 0, r * 0.7, r * 0.3);
    ctx.stroke();
  }

  function faceBuckTooth(r) {
    ctx.fillStyle = "#0f172a";
    [-1, 1].forEach((s) => {
      ctx.beginPath();
      ctx.arc(r * 0.3, r * 0.42 * s, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = "#7f1d1d";
    ctx.beginPath();
    ctx.arc(r * 0.85, 0, r * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f8fafc";
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 1;
    ctx.fillRect(r * 0.78, -r * 0.1, r * 0.14, r * 0.24);
    ctx.strokeRect(r * 0.78, -r * 0.1, r * 0.14, r * 0.24);
    ctx.fillRect(r * 0.96, -r * 0.1, r * 0.14, r * 0.24);
    ctx.strokeRect(r * 0.96, -r * 0.1, r * 0.14, r * 0.24);
  }

  const FACE_VARIANTS = [faceClassic, faceGoogly, faceWink, faceTongue, faceAngry, faceSurprised, faceShades, faceBuckTooth];

  function faceVariantForId(id) {
    return FACE_VARIANTS[hashString(`${id}-face`) % FACE_VARIANTS.length];
  }

  function drawSnakeBody(segments, color, highlight, heading, ownerId) {
    if (!segments || segments.length === 0) return;
    ctx.fillStyle = color;
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      const r = i === 0 ? 13 : 10;
      ctx.beginPath();
      ctx.arc(seg.x, seg.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const head = segments[0];
    if (typeof heading === "number") {
      ctx.save();
      ctx.translate(head.x, head.y);
      ctx.rotate(heading);
      drawBlush(13);
      faceVariantForId(ownerId || "?")(13);
      ctx.restore();
    }

    if (highlight) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 15, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawLeaderboard() {
    const entries = [];
    if (mySnake) entries.push({ name: "You", height: mySnake.height, isMe: true });
    const others = mode === "offline" ? bots : opponents;
    for (const s of others.values()) {
      if (s.alive === false) continue;
      entries.push({ name: s.name || "Player", height: s.height || 0, isMe: false });
    }
    entries.sort((a, b) => b.height - a.height);
    const top = entries.slice(0, 8);

    const panelW = 190;
    const panelX = canvas.width - panelW - 14;
    const panelY = Math.max(16, hudClearance(canvas, 90));
    const rowH = 20;
    ctx.fillStyle = "rgba(15, 23, 42, 0.78)";
    ctx.fillRect(panelX, panelY, panelW, 30 + top.length * rowH);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("LEADERBOARD", panelX + 10, panelY + 18);
    top.forEach((e, i) => {
      const y = panelY + 34 + i * rowH;
      ctx.fillStyle = e.isMe ? "#fbbf24" : "#e2e8f0";
      ctx.font = e.isMe ? "bold 13px system-ui, sans-serif" : "13px system-ui, sans-serif";
      ctx.textAlign = "left";
      const label = `${i + 1}. ${e.name}`;
      ctx.fillText(label.length > 16 ? `${label.slice(0, 15)}…` : label, panelX + 10, y);
      ctx.textAlign = "right";
      ctx.fillText(formatHeight(e.height), panelX + panelW - 10, y);
    });
  }

  function draw() {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!mySnake) return;

    ctx.save();
    ctx.translate(canvas.width / 2 - camera.x, canvas.height / 2 - camera.y);

    ctx.strokeStyle = "rgba(148, 163, 184, 0.12)";
    ctx.lineWidth = 1;
    const gridSize = 60;
    const left = camera.x - canvas.width;
    const right = camera.x + canvas.width;
    const top = camera.y - canvas.height;
    const bottom = camera.y + canvas.height;
    for (let x = Math.floor(left / gridSize) * gridSize; x < right; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    for (let y = Math.floor(top / gridSize) * gridSize; y < bottom; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "#f87171";
    ctx.lineWidth = 6;
    ctx.setLineDash([16, 12]);
    ctx.beginPath();
    ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#fbbf24";
    for (const orb of orbs.values()) {
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    const others = mode === "offline" ? bots : opponents;
    for (const s of others.values()) {
      if (s.alive === false) continue;
      drawSnakeBody(s.segments, colorForId(s.ownerId), false, s.heading, s.ownerId);
    }

    if (mySnake.alive) {
      drawSnakeBody(mySnake.segments, colorForId(myId), true, mySnake.heading, myId);
    }

    ctx.restore();

    drawLeaderboard();

    if (hostLeftAt && performance.now() - hostLeftAt < HOST_LEFT_NOTICE_MS) {
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.fillRect(canvas.width / 2 - 220, 16, 440, 40);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 16px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Host left — food has stopped spawning", canvas.width / 2, 42);
    }
  }

  function isOver() {
    return dead;
  }

  function getHud() {
    const otherCount = mode === "offline" ? bots.size : opponents.size;
    return {
      left: `📏 Height: ${formatHeight(mySnake?.height ?? 0)}`,
      right: `👥 ${otherCount + 1}`,
    };
  }

  function getOverResult() {
    return {
      title: "You Died!",
      message: `${deathReason} Final height: ${formatHeight(mySnake?.height ?? 0)}`,
    };
  }

  function reset() {
    const pos = startPositionForId(myId);
    mySnake = {
      head: { x: pos.x, y: pos.y },
      heading: pos.angle + Math.PI,
      segments: [{ x: pos.x, y: pos.y }],
      height: 0,
      alive: true,
    };
    opponents = new Map();
    bots = new Map();
    camera.x = pos.x;
    camera.y = pos.y;
    leftHeld = false;
    rightHeld = false;
    mouseActive = false;
    stepBroadcastTimer = 0;
    foodSyncTimer = 0;
    botRespawnTimer = 0;
    hostLeftAt = 0;
    dead = false;
    deathReason = "";
    isPlaying = true;

    orbs = new Map();
    for (let i = 0; i < TARGET_FOOD_COUNT; i++) spawnOrb();

    if (mode === "offline") {
      for (let i = 0; i < TARGET_BOT_COUNT; i++) spawnBot();
    } else if (isHost) {
      broadcastFoodSync();
    }
  }

  function save() {
    if (mode === "online") {
      if (mySnake && mySnake.alive && channel) {
        channel.send({
          type: "broadcast",
          event: "snake-died",
          payload: {
            ownerId: myId,
            killerId: null,
            segments: mySnake.segments,
            height: mySnake.height,
          },
        });
      }
      if (isHost && isPublicRoom && roomCode) {
        removeRoom(roomCode);
      }
      closeRoom(channel);
      channel = null;
    }
    isPlaying = false;
  }

  // ---------------- Lobby ----------------

  function renderChoiceScreen(overlayEl, onReady, onCancel) {
    overlayEl.innerHTML = `
      <h1>Snake Arena</h1>
      <p>Jump into a live public game, play privately with a friend via a code, or practice offline.</p>
      <button data-lobby-action="play-online">Play Online</button>
      <button class="secondary" data-lobby-action="create">Create Private Arena</button>
      <button class="secondary" data-lobby-action="join">Join Private Arena</button>
      <button class="secondary" data-lobby-action="offline">Play Offline (Bots)</button>
      <button class="auth-toggle" type="button" data-lobby-action="cancel">← Back</button>
    `;
    overlayEl.querySelector('[data-lobby-action="play-online"]').addEventListener("click", () => playOnline(overlayEl, onReady, onCancel));
    overlayEl.querySelector('[data-lobby-action="create"]').addEventListener("click", () => createArena(overlayEl, onReady, onCancel));
    overlayEl.querySelector('[data-lobby-action="join"]').addEventListener("click", () => renderJoinScreen(overlayEl, onReady, onCancel));
    overlayEl.querySelector('[data-lobby-action="offline"]').addEventListener("click", () => startOffline(onReady));
    overlayEl.querySelector('[data-lobby-action="cancel"]').addEventListener("click", onCancel);
  }

  async function playOnline(overlayEl, onReady, onCancel) {
    overlayEl.innerHTML = `<h1>Snake Arena</h1><p>Finding a game...</p>`;
    const code = await findAvailableRoom(ONLINE_ARENA_CAPACITY);
    if (code) {
      await joinArena(overlayEl, code, onReady, onCancel, true);
    } else {
      await createArena(overlayEl, onReady, onCancel, true, true);
    }
  }

  function startOffline(onReady) {
    mode = "offline";
    myId = crypto.randomUUID();
    myName = getPlayerName ? getPlayerName() : "Guest";
    isHost = false;
    channel = null;
    onReady();
  }

  function renderJoinScreen(overlayEl, onReady, onCancel) {
    overlayEl.innerHTML = `
      <h1>Snake Arena</h1>
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
      await joinArena(overlayEl, code, onReady, onCancel);
    });
  }

  async function createArena(overlayEl, onReady, onCancel, isPublic = false, skipWaitingRoom = false) {
    mode = "online";
    const code = generateRoomCode();
    myId = crypto.randomUUID();
    myName = getPlayerName ? getPlayerName() : "Guest";
    isHost = true;
    isPublicRoom = isPublic;
    roomCode = code;
    roomHeartbeatTimer = 0;

    overlayEl.innerHTML = `<h1>Snake Arena</h1><p>Setting up...</p>`;

    channel = createRoomChannel(code, myId);
    wireChannelHandlers();
    await subscribeRoom(channel, { ownerId: myId, name: myName, isHost: true });
    hostPresenceKey = myId;

    if (isPublic) await registerPublicRoom(code, myId);

    if (skipWaitingRoom) {
      onReady();
    } else {
      renderWaitingRoom(overlayEl, code, onReady, onCancel, true);
    }
  }

  async function joinArena(overlayEl, code, onReady, onCancel, skipWaitingRoom = false) {
    mode = "online";
    myId = crypto.randomUUID();
    myName = getPlayerName ? getPlayerName() : "Guest";
    isHost = false;
    isPublicRoom = skipWaitingRoom;
    roomCode = code;

    overlayEl.innerHTML = `<h1>Snake Arena</h1><p>Joining...</p>`;

    channel = createRoomChannel(code, myId);
    wireChannelHandlers();
    await subscribeRoom(channel, { ownerId: myId, name: myName, isHost: false });

    if (skipWaitingRoom) {
      onReady();
    } else {
      renderWaitingRoom(overlayEl, code, onReady, onCancel, false);
    }
  }

  function renderWaitingRoom(overlayEl, code, onReady, onCancel, hostRole) {
    overlayEl.innerHTML = `
      <h1>Snake Arena</h1>
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
      el.textContent = `Players: ${names.join(", ")}`;
    }
    renderPlayerList();
    window.__arenaPresenceHook = renderPlayerList;

    overlayEl.querySelector('[data-lobby-action="cancel-wait"]').addEventListener("click", () => {
      clearTimeout(timeoutId);
      window.__arenaPresenceHook = null;
      closeRoom(channel);
      channel = null;
      onCancel();
    });

    if (hostRole) {
      overlayEl.querySelector('[data-lobby-action="start"]').addEventListener("click", () => {
        clearTimeout(timeoutId);
        window.__arenaPresenceHook = null;
        channel.send({ type: "broadcast", event: "game-start", payload: {} });
        onReady();
      });
    } else {
      pendingOnReady = () => {
        clearTimeout(timeoutId);
        window.__arenaPresenceHook = null;
        onReady();
      };
    }

    const timeoutId = hostRole
      ? null
      : setTimeout(() => {
          if (countPresence(channel) < 2) {
            window.__arenaPresenceHook = null;
            closeRoom(channel);
            channel = null;
            overlayEl.innerHTML = `<h1>Snake Arena</h1><p>Nobody joined in time. Double check the code and try again.</p><button data-lobby-action="back">Back</button>`;
            overlayEl.querySelector('[data-lobby-action="back"]').addEventListener("click", () => renderChoiceScreen(overlayEl, onReady, onCancel));
          }
        }, JOIN_TIMEOUT_MS);
  }

  function renderLobby(overlayEl, { onReady, onCancel }) {
    if (isHost && isPublicRoom && roomCode) {
      removeRoom(roomCode);
    }
    closeRoom(channel);
    channel = null;
    hostPresenceKey = null;
    pendingOnReady = null;
    isPublicRoom = false;
    roomCode = null;
    roomHeartbeatTimer = 0;
    opponents = new Map();
    bots = new Map();
    presenceNames = new Map();
    orbs = new Map();
    renderChoiceScreen(overlayEl, onReady, onCancel);
  }

  return {
    id: "snake-arena",
    title: "Snake Arena",
    thumbnail: null,
    description: "Multiplayer Snake — play live with friends online, or practice offline against bots. Eat orbs, eat opponents, avoid the wall.",
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
