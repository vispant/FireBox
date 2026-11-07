// Understory -- a Hollow-Knight-style exploration/restoration game about a
// single Pacific coastal temperate rainforest watershed. Pure Canvas 2D (no
// WebGL/Three.js) specifically so it stays light on weak hardware like a
// Chromebook. Content (species, concepts, zone/boss data) lives in
// understoryContent.js on purpose -- this file is the engine only.
//
// main.js's predict() loop calls update(dt)/draw() every frame while
// screen === "playing" and polls isOver() -- the instant isOver() is true,
// main.js force-ends the session with its own generic DOM game-over card.
// That means isOver() must only ever fire for a true win or the rare
// full-collapse safety valve (see endBossAttempt()) -- an ordinary boss-fight
// loss is handled entirely inside this file's own state, never isOver().

import { CONCEPTS, SPECIES, ATTACK_CONCEPTS, ZONES, ZONE_ORDER, BOSSES, JOURNAL_SECTIONS, ALL_ZONES_AUTHORED, CANONICAL_DISASTER_ZONE_IDS } from "./understoryContent.js?v=1";

const SAVE_KEY = "fireBox.understory.save.v1";

const GRAVITY = 1600;
const MOVE_SPEED = 230;
const MOVE_ACCEL = 2200;
const JUMP_VELOCITY = -520;
const MAX_FALL = 900;
const PLAYER_W = 26;
const PLAYER_H = 38;
const REVIVE_RANGE = 70;
const REVIVE_HOLD_TIME = 0.6;
const GROWTH_DURATION = 4;
const SCAN_RANGE = 90;
const MAX_UPGRADE_LEVEL = 3;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function rand(min, max) {
  return min + Math.random() * (max - min);
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerpColor(a, b, t) {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bch = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bch})`;
}
function aabbOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function circleOverlap(x1, y1, r1, x2, y2, r2) {
  return Math.hypot(x1 - x2, y1 - y2) < r1 + r2;
}
// Deterministic per-index "randomness" for background variation (tree shape,
// size) that must look the same every frame -- real Math.random() would
// make foliage flicker between different shapes each draw call.
function seededRand(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function defaultSave() {
  return {
    version: 1,
    completedTutorial: false,
    abilities: { gillStep: false, rootGrip: false, dewCall: false, downdraftDash: false, emberWard: false, magmaCarapace: false, steadyRoots: false },
    upgradeLevels: { maxVitality: 0, rootReach: 0, sporeRadius: 0 },
    biomass: 0,
    ecosystemVitality: 10,
    lastCheckpoint: { zoneId: "oldGrowth", x: 120, y: 420 },
    zones: Object.fromEntries(ZONE_ORDER.map((id) => [id, { visited: false, bossDefeated: false, bossDamageCarry: 0, flowersRevived: [] }])),
    completedGame: false,
  };
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw);
    const base = defaultSave();
    return {
      ...base,
      ...parsed,
      abilities: { ...base.abilities, ...(parsed.abilities || {}) },
      upgradeLevels: { ...base.upgradeLevels, ...(parsed.upgradeLevels || {}) },
      zones: Object.fromEntries(ZONE_ORDER.map((id) => [id, { ...base.zones[id], ...((parsed.zones || {})[id] || {}) }])),
    };
  } catch {
    return defaultSave();
  }
}

function upgradeCost(level) {
  return 50 + level * 40;
}

export function createUnderstoryGame({ canvas, ctx }) {
  let saveData = loadSave();
  const isTouchDevice = (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || navigator.maxTouchPoints > 0;

  // Pre-baked once (not per frame) grain texture for a subtle atmosphere
  // overlay -- generating noise per pixel every frame would be a real cost,
  // but a single small tile turned into a repeating pattern is free to draw.
  let grainPattern = null;
  (function buildGrainPattern() {
    const size = 128;
    const off = document.createElement("canvas");
    off.width = size;
    off.height = size;
    const octx = off.getContext("2d");
    const img = octx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(Math.random() * 255);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    grainPattern = ctx.createPattern(off, "repeat");
  })();
  let vignetteCache = { w: 0, h: 0, gradient: null };
  function getVignette() {
    if (vignetteCache.w !== canvas.width || vignetteCache.h !== canvas.height) {
      const g = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.25, canvas.width / 2, canvas.height / 2, canvas.height * 0.78);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.58)");
      vignetteCache = { w: canvas.width, h: canvas.height, gradient: g };
    }
    return vignetteCache.gradient;
  }

  let phase = "title";
  let gameOver = true; // mirrors other games' convention; true until reset() starts a session
  let prevKeysSnapshot = {};

  const keys = { left: false, right: false, jump: false, down: false };
  const pressed = { melee: false, ranged: false, revive: false, scan: false, journal: false, any: false };

  let player = null;
  let camera = { x: 0, y: 0 };
  let currentZoneId = "oldGrowth";
  let zoneRuntime = {}; // per-zone transient state: flowers[], enemies[], critters[]
  let particles = [];
  let bannerQueue = [];
  let bannerSeenCount = {};
  let meleeCooldown = 0;
  let rangedCooldown = 0;
  let projectiles = []; // player + boss projectiles share one array, tagged by `owner`
  let journalOpen = false;
  let journalPage = 0;
  let tutorialFlags = { moved: false, jumped: false, attacked: false, revived: false };
  let titleBlink = 0;
  let endingTimer = 0;

  let bossFight = null; // set when phase enters "boss-fight"
  let cutscene = null; // set when phase enters "boss-defeat-cutscene"
  let retreatTimer = 0;
  let activeBossLine = null;

  // ---------------- juice: hit-stop, screen shake, swing trail, flashes ----------------
  let hitStopTimer = 0;
  let shakeTime = 0;
  let shakeDuration = 0.001; // avoid /0; real values set by triggerShake
  let shakeMag = 0;
  let frameShakeX = 0;
  let frameShakeY = 0;
  let meleeSwing = null; // { timer, duration, facing, originX, originY, reach }
  let impactFlashes = []; // { x, y, r, life, max, color } -- localized "hit landed" flash
  let bossDeathFlash = 0;
  let ambientParticles = [];

  function triggerHitStop(seconds) {
    hitStopTimer = Math.max(hitStopTimer, seconds);
  }
  function triggerShake(mag, duration) {
    shakeMag = Math.max(shakeMag, mag);
    shakeTime = duration;
    shakeDuration = duration;
  }
  function spawnImpactFlash(x, y, r, color) {
    impactFlashes.push({ x, y, r, life: 0.18, max: 0.18, color });
  }

  // ---------------- input ----------------
  function keyFor(code) {
    if (code === "KeyA" || code === "ArrowLeft") return "left";
    if (code === "KeyD" || code === "ArrowRight") return "right";
    if (code === "Space" || code === "KeyW" || code === "ArrowUp") return "jump";
    if (code === "KeyS" || code === "ArrowDown") return "down";
    return null;
  }
  window.addEventListener("keydown", (e) => {
    if (gameOver) return;
    const k = keyFor(e.code);
    if (k) keys[k] = true;
    if (e.code === "KeyK") pressed.melee = true;
    if (e.code === "KeyL") pressed.ranged = true;
    if (e.code === "KeyR") pressed.revive = true;
    if (e.code === "KeyF") pressed.scan = true;
    if (e.code === "KeyJ") pressed.journal = true;
    pressed.any = true;
  });
  window.addEventListener("keyup", (e) => {
    const k = keyFor(e.code);
    if (k) keys[k] = false;
    if (e.code === "KeyR") pressed.revive = false;
  });

  let touchMove = null;
  let touchButtons = [];
  function layoutTouchButtons() {
    if (!isTouchDevice) {
      touchButtons = [];
      return;
    }
    const s = Math.min(canvas.width, canvas.height) * 0.11;
    const m = s * 0.35;
    touchButtons = [
      { id: "jump", x: canvas.width - s * 2.2, y: canvas.height - s * 1.3, r: s },
      { id: "melee", x: canvas.width - s * 0.9, y: canvas.height - s * 1.3, r: s * 0.85 },
      { id: "revive", x: canvas.width - s * 1.6, y: canvas.height - s * 2.7, r: s * 0.75 },
    ];
    void m;
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (gameOver) return;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const px = (e.clientX - rect.left) * scale;
    const py = (e.clientY - rect.top) * scale;
    for (const b of touchButtons) {
      if (Math.hypot(px - b.x, py - b.y) < b.r) {
        if (b.id === "jump") keys.jump = true;
        if (b.id === "melee") pressed.melee = true;
        if (b.id === "revive") pressed.revive = true;
        return;
      }
    }
    if (px < canvas.width * 0.5) {
      touchMove = { id: e.pointerId, startX: px };
    }
    pressed.any = true;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!touchMove || e.pointerId !== touchMove.id) return;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const px = (e.clientX - rect.left) * scale;
    const dx = px - touchMove.startX;
    keys.left = dx < -12;
    keys.right = dx > 12;
  });
  function releaseTouch(e) {
    if (touchMove && e.pointerId === touchMove.id) {
      touchMove = null;
      keys.left = false;
      keys.right = false;
    }
    keys.jump = false;
    pressed.revive = false;
  }
  window.addEventListener("pointerup", releaseTouch);
  window.addEventListener("pointercancel", releaseTouch);

  // ---------------- concept banners ----------------
  function showConceptBanner(conceptId) {
    const c = CONCEPTS[conceptId];
    if (!c) return;
    bannerSeenCount[conceptId] = (bannerSeenCount[conceptId] || 0) + 1;
    if (bannerSeenCount[conceptId] > 5 && Math.random() < 0.6) return;
    if (bannerQueue.length && bannerQueue[bannerQueue.length - 1].conceptId === conceptId && bannerQueue[bannerQueue.length - 1].life > 1.6) return;
    if (bannerQueue.length >= 3) bannerQueue.shift();
    let text = c.short;
    if (text.length > 100) text = text.slice(0, 97) + "...";
    bannerQueue.push({ conceptId, text, life: 2.4, max: 2.4 });
  }

  // ---------------- zone management ----------------
  function spawnParticles(x, y, color, count, spread = 140) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(spread * 0.3, spread);
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0.6, max: 0.6, color, r: rand(2, 4) });
    }
  }

  // Ambient drifting motes/spores -- small, cheap (~20 on screen), continuous
  // atmosphere independent of combat. A fixed pool recycled when a particle
  // drifts off the current viewport, so it always reads as "always present
  // near the player" without tracking the whole (much larger) zone.
  const AMBIENT_COUNT = 20;
  function makeAmbientParticle(firstSpawn) {
    return {
      x: camera.x + rand(-100, canvas.width + 100),
      y: firstSpawn ? camera.y + rand(canvas.height * 0.1, canvas.height * 0.8) : camera.y + canvas.height + rand(0, 40),
      phase: rand(0, Math.PI * 2),
      speed: rand(6, 16),
      size: rand(1.3, 2.8),
      driftAmp: rand(10, 28),
    };
  }
  function initAmbientParticles() {
    ambientParticles = [];
    for (let i = 0; i < AMBIENT_COUNT; i++) ambientParticles.push(makeAmbientParticle(true));
  }
  function updateAmbientParticles(dt) {
    if (phase !== "explore" && phase !== "explore-tutorial" && phase !== "boss-fight") return;
    for (const p of ambientParticles) {
      p.phase += dt * 0.8;
      p.y -= p.speed * dt;
      if (p.y < camera.y - 40 || p.x < camera.x - 150 || p.x > camera.x + canvas.width + 150) {
        Object.assign(p, makeAmbientParticle(false));
      }
    }
  }
  function drawAmbientParticles(zone) {
    ctx.fillStyle = zone.palette.living;
    for (const p of ambientParticles) {
      const dx = Math.sin(p.phase) * p.driftAmp;
      const [sx, sy] = worldToScreen(p.x + dx, p.y);
      if (sx < -20 || sx > canvas.width + 20) continue;
      ctx.globalAlpha = 0.3 + Math.sin(p.phase * 2) * 0.15;
      ctx.beginPath();
      ctx.arc(sx, sy, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function enterZone(zoneId, spawnOverride) {
    const zone = ZONES[zoneId];
    currentZoneId = zoneId;
    const zs = saveData.zones[zoneId];
    zs.visited = true;
    const flowers = zone.flowers.map((f) => {
      const revived = zs.flowersRevived.includes(f.id);
      return { ...f, maxRadius: f.maxRadius || 220, revived, radius: revived ? f.maxRadius || 220 : 0, growStart: revived ? -999 : 0, holdTimer: 0 };
    });
    const enemies = (zone.enemies || []).map((e) => ({ ...e, hp: 2, alive: true, vx: 0, dir: 1, hitCooldown: 0 }));
    zoneRuntime = { flowers, enemies, critters: zone.critters ? zone.critters.map((c) => ({ ...c })) : [] };
    const sp = spawnOverride || zone.spawn;
    player.x = sp.x;
    player.y = sp.y;
    player.vx = 0;
    player.vy = 0;
    camera.x = sp.x;
    camera.y = sp.y;
    initAmbientParticles();
    projectiles = [];
    bossFight = null;
    cutscene = null;
    phase = "explore";
  }

  function activeGrowthSources() {
    const sources = zoneRuntime.flowers.filter((f) => f.revived).map((f) => ({ x: f.x, y: f.y, radius: f.radius }));
    if (bossFight && bossFight.zoneId === currentZoneId) {
      const zone = ZONES[currentZoneId];
      sources.push({ x: zone.bossArena.entryX + 150, y: zone.bossArena.y, radius: bossFight.restorationRadius });
    }
    return sources;
  }

  // ---------------- player physics ----------------
  function resolveAxis(entity, axis, rects) {
    for (const r of rects) {
      if (!aabbOverlap(entity, r)) continue;
      if (axis === "x") {
        if (entity.vx > 0) entity.x = r.x - entity.w;
        else if (entity.vx < 0) entity.x = r.x + r.w;
        entity.vx = 0;
      } else {
        if (entity.vy > 0) {
          entity.y = r.y - entity.h;
          entity.vy = 0;
          entity.onGround = true;
        } else if (entity.vy < 0) {
          entity.y = r.y + r.h;
          entity.vy = 0;
        }
      }
    }
  }

  function updatePlayerPhysics(dt, zone) {
    let targetVx = 0;
    if (keys.left) targetVx -= MOVE_SPEED;
    if (keys.right) targetVx += MOVE_SPEED;
    player.vx += Math.sign(targetVx - player.vx) * Math.min(Math.abs(targetVx - player.vx), MOVE_ACCEL * dt);
    if (targetVx !== 0 && Math.abs(player.vx) > 20) tutorialFlags.moved = true;
    if (targetVx !== 0) player.facing = targetVx > 0 ? 1 : -1;

    if (keys.jump && player.onGround) {
      player.vy = JUMP_VELOCITY;
      player.onGround = false;
      tutorialFlags.jumped = true;
    }
    player.vy = Math.min(MAX_FALL, player.vy + GRAVITY * dt);

    player.onGround = false;
    player.x += player.vx * dt;
    resolveAxis(player, "x", zone.ground);
    player.y += player.vy * dt;
    resolveAxis(player, "y", zone.ground);

    player.x = clamp(player.x, 0, zone.width - player.w);
    if (player.y > zone.height + 200) {
      player.x = zone.spawn.x;
      player.y = zone.spawn.y;
      player.vy = 0;
      player.hp = Math.max(1, player.hp - 1);
    }

    // Lerp toward the clamped target instead of snapping straight to it --
    // cheap, frame-rate-independent smoothing that makes movement (and
    // especially screen-shake-era hits) read as less jittery.
    const targetCamX = clamp(player.x + player.w / 2 - canvas.width / 2, 0, Math.max(0, zone.width - canvas.width));
    const targetCamY = clamp(player.y - canvas.height * 0.55, 0, Math.max(0, zone.height - canvas.height));
    const camLerp = Math.min(1, 10 * dt);
    camera.x += (targetCamX - camera.x) * camLerp;
    camera.y += (targetCamY - camera.y) * camLerp;
  }

  function playerHurtbox() {
    return { x: player.x, y: player.y, w: player.w, h: player.h };
  }
  function damagePlayer(amount) {
    if (player.invincibleTimer > 0) return;
    player.hp -= amount;
    player.invincibleTimer = 1.0;
    spawnParticles(player.x + player.w / 2, player.y + player.h / 2, "#f87171", 8, 100);
    spawnImpactFlash(player.x + player.w / 2, player.y + player.h / 2, 50, "#f87171");
    triggerHitStop(0.09);
    triggerShake(13, 0.28);
  }

  // ---------------- flowers ----------------
  function updateFlowers(dt) {
    let nearFlower = null;
    for (const f of zoneRuntime.flowers) {
      if (f.revived) {
        if (f.radius < f.maxRadius) {
          const t = clamp((performance.now() / 1000 - f.growStart) / GROWTH_DURATION, 0, 1);
          f.radius = f.maxRadius * (1 - Math.pow(1 - t, 3));
        }
        continue;
      }
      const d = Math.hypot(player.x + player.w / 2 - f.x, player.y + player.h - f.y);
      if (d < REVIVE_RANGE) nearFlower = f;
    }
    if (nearFlower && pressed.revive) {
      nearFlower.holdTimer += dt;
      if (nearFlower.holdTimer >= REVIVE_HOLD_TIME) {
        nearFlower.revived = true;
        nearFlower.growStart = performance.now() / 1000;
        tutorialFlags.revived = true;
        const zs = saveData.zones[currentZoneId];
        if (!zs.flowersRevived.includes(nearFlower.id)) zs.flowersRevived.push(nearFlower.id);
        spawnParticles(nearFlower.x, nearFlower.y - 10, "#bef264", 16, 90);
        showConceptBanner(ATTACK_CONCEPTS.reviveFlower);
        persistSave();
      }
    } else if (nearFlower) {
      nearFlower.holdTimer = 0;
    }
    zoneRuntime.nearFlower = nearFlower;
  }

  // ---------------- combat: melee/ranged vs enemies, critters (scan) ----------------
  function updateCombat(dt) {
    meleeCooldown = Math.max(0, meleeCooldown - dt);
    rangedCooldown = Math.max(0, rangedCooldown - dt);

    if (pressed.melee && meleeCooldown <= 0) {
      meleeCooldown = 0.35;
      pressed.melee = false;
      tutorialFlags.attacked = true;
      const reach = 42 + saveData.upgradeLevels.rootReach * 10;
      const hitbox = { x: player.facing > 0 ? player.x + player.w : player.x - reach, y: player.y - 6, w: reach, h: player.h + 12 };
      spawnParticles(player.x + player.w / 2 + player.facing * 20, player.y + player.h / 2, "#4ade80", 5, 70);
      // A visible swing arc -- previously the melee attack had zero visual
      // representation beyond particles appearing at whatever it hit, which
      // never showed the player its own swing's shape or range.
      meleeSwing = { timer: 0.14, duration: 0.14, facing: player.facing, reach };
      showConceptBanner(ATTACK_CONCEPTS.tendrilWhip);
      resolveMeleeHit(hitbox);
    }
    if (pressed.ranged && rangedCooldown <= 0) {
      rangedCooldown = 0.6;
      pressed.ranged = false;
      const r = 6 + saveData.upgradeLevels.sporeRadius * 1.5;
      projectiles.push({ owner: "player", x: player.x + player.w / 2, y: player.y + player.h / 2, vx: player.facing * 420, vy: 0, r, life: 1.4 });
      showConceptBanner(ATTACK_CONCEPTS.sporeBurst);
    }
    if (pressed.scan) {
      pressed.scan = false;
      let nearest = null;
      let nd = SCAN_RANGE;
      for (const c of zoneRuntime.critters) {
        const d = Math.hypot(player.x - c.x, player.y - c.y);
        if (d < nd) {
          nd = d;
          nearest = c;
        }
      }
      if (nearest) {
        const sp = SPECIES.find((s) => s.id === nearest.speciesId);
        if (sp) showConceptBanner(sp.conceptIds[0]);
      }
    }
  }

  function killEnemy(e) {
    e.dying = true;
    e.dyingTimer = 0.22;
    saveData.biomass += 5;
  }

  function resolveMeleeHit(hitbox) {
    for (const e of zoneRuntime.enemies) {
      if (!e.alive || e.dying || e.hitCooldown > 0) continue;
      if (aabbOverlap(hitbox, { x: e.x - 16, y: e.y - 16, w: 32, h: 32 })) {
        e.hp -= 1;
        e.hitCooldown = 0.3;
        spawnParticles(e.x, e.y, "#60a5fa", 6, 90);
        spawnImpactFlash(e.x, e.y, 26, "#93c5fd");
        triggerHitStop(0.05);
        if (e.hp <= 0) killEnemy(e);
      }
    }
    if (bossFight && bossFight.hp > 0) {
      const b = bossFight;
      if (aabbOverlap(hitbox, { x: b.x - 38, y: b.y - 38, w: 76, h: 76 }) && b.hitCooldown <= 0) {
        landBossHit();
      }
    }
  }

  function landBossHit() {
    const b = bossFight;
    b.hp -= 1;
    b.hitCooldown = 0.25;
    b.hitsLanded += 1;
    b.restorationRadius = Math.min(280, (b.hitsLanded / b.maxHp) * 280);
    spawnParticles(b.x, b.y, "#7dd3fc", 10, 140);
    spawnImpactFlash(b.x, b.y, 55, "#e0f2fe");
    triggerHitStop(0.08);
    triggerShake(7, 0.22);
    if (b.hitsLanded % 3 === 1) showConceptBanner("foodWeb");
    if (b.hp <= 0) {
      bossDeathFlash = 1;
      triggerHitStop(0.12);
      triggerShake(16, 0.4);
      winBossFight();
    }
  }

  function updateProjectiles(dt, zone) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      let gone = p.life <= 0 || p.x < camera.x - 60 || p.x > camera.x + canvas.width + 60;
      if (!gone && p.owner === "player") {
        if (bossFight && bossFight.hp > 0 && bossFight.hitCooldown <= 0 && Math.hypot(p.x - bossFight.x, p.y - bossFight.y) < 40 + p.r) {
          landBossHit();
          gone = true;
        }
        for (const e of zoneRuntime.enemies) {
          if (e.alive && !e.dying && e.hitCooldown <= 0 && Math.hypot(p.x - e.x, p.y - e.y) < 18 + p.r) {
            e.hp -= 1;
            e.hitCooldown = 0.3;
            spawnImpactFlash(e.x, e.y, 26, "#93c5fd");
            if (e.hp <= 0) killEnemy(e);
            gone = true;
            break;
          }
        }
      } else if (!gone && p.owner === "boss") {
        if (player.invincibleTimer <= 0 && aabbOverlap({ x: p.x - p.r, y: p.y - p.r, w: p.r * 2, h: p.r * 2 }, playerHurtbox())) {
          damagePlayer(1);
          gone = true;
        }
      }
      if (gone) projectiles.splice(i, 1);
    }
    void zone;
  }

  function updateEnemies(dt) {
    for (const e of zoneRuntime.enemies) {
      if (!e.alive) continue;
      if (e.dying) {
        e.dyingTimer -= dt;
        if (e.dyingTimer <= 0) e.alive = false;
        continue;
      }
      e.hitCooldown = Math.max(0, e.hitCooldown - dt);
      e.x += Math.sin(performance.now() / 600 + e.x) * 12 * dt;
      if (player.invincibleTimer <= 0 && Math.hypot(player.x + player.w / 2 - e.x, player.y + player.h / 2 - e.y) < 24) {
        damagePlayer(1);
      }
    }
  }

  // ---------------- boss fight ----------------
  function enterBossIntro() {
    const zone = ZONES[currentZoneId];
    const boss = BOSSES[zone.bossId];
    activeBossLine = { text: boss.introLine, timer: 2.2 };
    phase = "boss-intro";
  }

  function startBossFight() {
    const zone = ZONES[currentZoneId];
    const boss = BOSSES[zone.bossId];
    const carry = saveData.zones[zone.id].bossDamageCarry || 0;
    const startHp = Math.max(1, Math.round(boss.maxHp * (1 - carry)));
    bossFight = {
      bossId: boss.id,
      zoneId: zone.id,
      x: zone.bossArena.entryX + 150,
      y: zone.bossArena.y - 10,
      maxHp: boss.maxHp,
      hp: startHp,
      hitsLanded: Math.round(boss.maxHp * carry),
      hitCooldown: 0,
      attackCooldown: 1.6,
      telegraph: null,
      restorationRadius: carry * 280,
      bob: 0,
      spinePhase: 0,
    };
    player.x = zone.bossArena.entryX + 40;
    player.y = zone.bossArena.y - player.h;
    player.hp = player.maxHp;
    phase = "boss-fight";
  }

  function updateBossFight(dt) {
    const b = bossFight;
    const zone = ZONES[currentZoneId];
    const boss = BOSSES[b.bossId];
    b.hitCooldown = Math.max(0, b.hitCooldown - dt);
    b.bob += dt;
    b.spinePhase += dt * 2.2; // independent rate from bob -- shared phases read as mechanical, not organic
    b.y = zone.bossArena.y - 10 + Math.sin(b.bob * 1.6) * 8;

    // The player must still be able to move, dodge and attack during a boss
    // fight -- these are normally only called from the explore-phase
    // dispatch, so they're called explicitly here too.
    updatePlayerPhysics(dt, zone);
    if (player.x < zone.bossArena.x) player.x = zone.bossArena.x; // can't just walk out of the arena mid-fight
    updateCombat(dt);

    if (player.hp <= 0) {
      endBossAttempt(false);
      return;
    }

    if (b.telegraph) {
      b.telegraph.timer -= dt;
      if (b.telegraph.timer <= 0) {
        executeBossAttack(b, boss, b.telegraph.attack, b.telegraph.preview);
        b.telegraph = null;
      }
    } else {
      b.attackCooldown -= dt;
      if (b.attackCooldown <= 0) {
        const atk = boss.attacks[Math.floor(rand(0, boss.attacks.length))];
        const duration = atk.telegraphMs / 1000;
        // The danger zone/aim direction is frozen at the moment the
        // telegraph starts and reused when the attack actually executes --
        // so the warning shown to the player always matches where the hit
        // will really land, and the telegraph can show it early instead of
        // only revealing the danger zone the instant it becomes live.
        b.telegraph = { attack: atk, timer: duration, duration, preview: computeAttackPreview(b, atk) };
      }
    }

    updateProjectiles(dt, zone);
    if (b.meleeZone) {
      b.meleeZone.timer -= dt;
      if (b.meleeZone.timer > 0) {
        if (player.invincibleTimer <= 0 && aabbOverlap(b.meleeZone.rect, playerHurtbox())) damagePlayer(1);
      } else b.meleeZone = null;
    }
    if (b.groundZone) {
      b.groundZone.timer -= dt;
      if (b.groundZone.timer > 0) {
        if (player.invincibleTimer <= 0 && aabbOverlap(b.groundZone.rect, playerHurtbox())) damagePlayer(1);
      } else b.groundZone = null;
    }
  }

  // Color-codes by attack type (not shared per-boss) so a returning player
  // learns the language once -- cyan always means "incoming shot," amber
  // always means "stand back," red always means "get off this ground" --
  // rather than every boss's telegraph looking identical.
  const TELEGRAPH_COLORS = { projectile: "#38bdf8", melee: "#fb923c", ground: "#f87171" };

  function computeAttackPreview(b, atk) {
    if (atk.type === "projectile") {
      return { type: "projectile", angle: Math.atan2(player.y - b.y, player.x - b.x) };
    }
    if (atk.type === "melee") {
      const dir = player.x < b.x ? -1 : 1;
      return { type: "melee", rect: { x: dir > 0 ? b.x : b.x - atk.range, y: b.y - 40, w: atk.range, h: 80 } };
    }
    if (atk.type === "ground") {
      return { type: "ground", rect: { x: player.x - atk.width / 2, y: ZONES[currentZoneId].bossArena.y - 40, w: atk.width, h: 60 } };
    }
    return null;
  }

  function executeBossAttack(b, boss, atk, preview) {
    b.attackCooldown = rand(1.4, 2.0);
    if (atk.type === "projectile") {
      const ang = preview ? preview.angle : Math.atan2(player.y - b.y, player.x - b.x);
      projectiles.push({ owner: "boss", x: b.x, y: b.y, vx: Math.cos(ang) * atk.speed, vy: Math.sin(ang) * atk.speed, r: 10, life: 3 });
    } else if (atk.type === "melee") {
      const dir = player.x < b.x ? -1 : 1;
      b.meleeZone = { timer: 0.3, rect: (preview && preview.rect) || { x: dir > 0 ? b.x : b.x - atk.range, y: b.y - 40, w: atk.range, h: 80 } };
    } else if (atk.type === "ground") {
      b.groundZone = { timer: 0.35, rect: (preview && preview.rect) || { x: player.x - atk.width / 2, y: ZONES[currentZoneId].bossArena.y - 40, w: atk.width, h: 60 } };
    }
  }

  function winBossFight() {
    const zone = ZONES[currentZoneId];
    const boss = BOSSES[zone.bossId];
    saveData.zones[zone.id].bossDefeated = true;
    saveData.zones[zone.id].bossDamageCarry = 1;
    saveData.abilities[boss.unlockAbility] = true;
    saveData.biomass += 60;
    persistSave();
    activeBossLine = { text: boss.defeatLine, timer: 3 };
    cutscene = { timer: 0, duration: 2.6, zoneId: zone.id, fromPalette: boss.restorationFrom, toPalette: boss.restorationTo };
    phase = "boss-defeat-cutscene";
  }

  function endBossAttempt(won) {
    if (won) return;
    const zone = ZONES[currentZoneId];
    const boss = BOSSES[zone.bossId];
    const zs = saveData.zones[zone.id];
    const attemptRatio = (bossFight.hitsLanded / boss.maxHp) * 0.6;
    const improved = attemptRatio > zs.bossDamageCarry;
    zs.bossDamageCarry = Math.max(zs.bossDamageCarry, attemptRatio);
    if (!improved) saveData.ecosystemVitality = Math.max(0, saveData.ecosystemVitality - 1);
    persistSave();
    retreatTimer = 1.8;
    bossFight = null;
    projectiles = [];
    if (saveData.ecosystemVitality <= 0) {
      phase = "collapse";
      gameOverPending = true;
      return;
    }
    phase = "boss-retreat";
  }
  let gameOverPending = false;

  // ---------------- cutscene ----------------
  function updateCutscene(dt) {
    cutscene.timer += dt;
    if (cutscene.timer >= cutscene.duration) {
      const zone = ZONES[cutscene.zoneId];
      enterZone(zone.id, { x: zone.bossArena.entryX + 40, y: zone.bossArena.y - player.h });
      checkEnding();
    }
  }

  function checkEnding() {
    // Hard-gated on ALL_ZONES_AUTHORED (see understoryContent.js) so that
    // clearing whichever zones happen to exist in this build can never be
    // mistaken for finishing the real 8-zone game -- this previously fired
    // the full "you won" ending after just the one zone built so far.
    if (!ALL_ZONES_AUTHORED) return;
    const allDefeated = CANONICAL_DISASTER_ZONE_IDS.every((id) => saveData.zones[id] && saveData.zones[id].bossDefeated);
    if (allDefeated) {
      saveData.completedGame = true;
      persistSave();
    }
  }

  // ---------------- save ----------------
  function persistSave() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
    } catch {}
  }

  // ---------------- lifecycle ----------------
  function reset() {
    saveData = loadSave();
    player = { x: 120, y: 420, w: PLAYER_W, h: PLAYER_H, vx: 0, vy: 0, onGround: false, facing: 1, hp: 3 + saveData.upgradeLevels.maxVitality, maxHp: 3 + saveData.upgradeLevels.maxVitality, invincibleTimer: 0 };
    particles = [];
    bannerQueue = [];
    projectiles = [];
    bossFight = null;
    cutscene = null;
    journalOpen = false;
    retreatTimer = 0;
    activeBossLine = null;
    gameOverPending = false;
    titleBlink = 0;
    endingTimer = 0;
    tutorialFlags = { moved: false, jumped: false, attacked: false, revived: false };
    keys.left = keys.right = keys.jump = keys.down = false;
    layoutTouchButtons();
    gameOver = false;
    phase = "title";
  }

  function startSession() {
    if (saveData.completedTutorial) {
      enterZone(saveData.lastCheckpoint.zoneId || "oldGrowth");
    } else {
      enterZone("oldGrowth");
      phase = "explore-tutorial";
    }
  }

  // ---------------- update ----------------
  function update(dtMs) {
    if (gameOver) return;
    const dt = Math.min(dtMs / 1000, 0.05);
    layoutTouchButtons();

    // Hit-stop: a landed hit briefly freezes the whole frame (physics,
    // timers, AI) before resuming -- the classic cheap "impact" trick. Kept
    // short (40-120ms) on purpose so it reads as weight, not lag.
    if (hitStopTimer > 0) {
      hitStopTimer -= dt;
      return;
    }

    if (shakeTime > 0) {
      shakeTime -= dt;
      const mag = shakeMag * Math.max(0, shakeTime / shakeDuration);
      frameShakeX = (Math.random() * 2 - 1) * mag;
      frameShakeY = (Math.random() * 2 - 1) * mag;
    } else {
      frameShakeX = 0;
      frameShakeY = 0;
    }
    impactFlashes = impactFlashes.filter((f) => (f.life -= dt) > 0);
    if (bossDeathFlash > 0) bossDeathFlash = Math.max(0, bossDeathFlash - dt * 3);
    if (meleeSwing) {
      meleeSwing.timer -= dt;
      if (meleeSwing.timer <= 0) meleeSwing = null;
    }
    updateAmbientParticles(dt);

    if (bannerQueue.length) {
      bannerQueue = bannerQueue.filter((b) => (b.life -= dt) > 0);
    }
    particles = particles.filter((p) => {
      p.life -= dt;
      p.vy += 260 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      return p.life > 0;
    });

    if (phase === "title") {
      // Deliberately checked before the journal toggle below: J is also a
      // normal keydown, so pressed.journal and pressed.any can both be true
      // on the very same frame (e.g. J is the player's first keypress). If
      // the journal toggle ran first, journalOpen's early-return would run
      // on every later frame too, before this block ever gets a chance to
      // call startSession() -- permanently stuck on the title screen.
      pressed.journal = false;
      titleBlink += dt;
      if (pressed.any) {
        pressed.any = false;
        startSession();
      }
      return;
    }

    if (pressed.journal && phase !== "boss-fight" && phase !== "boss-defeat-cutscene") {
      journalOpen = !journalOpen;
      pressed.journal = false;
    }
    if (journalOpen) return;

    if (player) player.invincibleTimer = Math.max(0, player.invincibleTimer - dt);

    if (phase === "explore" || phase === "explore-tutorial") {
      const zone = ZONES[currentZoneId];
      updatePlayerPhysics(dt, zone);
      updateFlowers(dt);
      updateCombat(dt);
      updateEnemies(dt);
      updateProjectiles(dt, zone);
      if (phase === "explore-tutorial" && tutorialFlags.moved && tutorialFlags.jumped && tutorialFlags.attacked && tutorialFlags.revived) {
        saveData.completedTutorial = true;
        persistSave();
        phase = "explore";
      }
      for (const gate of zone.gates || []) {
        const d = Math.hypot(player.x - gate.x, player.y - gate.y);
        if (d < 50) {
          if (gate.locked) continue;
          const target = ZONES[gate.toZone];
          if (!target) continue;
          saveData.lastCheckpoint = { zoneId: target.id, x: target.spawn.x, y: target.spawn.y };
          persistSave();
          enterZone(target.id);
          return;
        }
      }
      if (zone.bossArena && !saveData.zones[zone.id].bossDefeated) {
        if (player.x > zone.bossArena.entryX - 10 && player.x < zone.bossArena.entryX + zone.bossArena.w) {
          enterBossIntro();
        }
      }
    } else if (phase === "boss-intro") {
      activeBossLine.timer -= dt;
      if (activeBossLine.timer <= 0 || pressed.any) {
        pressed.any = false;
        activeBossLine = null;
        startBossFight();
      }
    } else if (phase === "boss-fight") {
      updateBossFight(dt);
    } else if (phase === "boss-retreat") {
      retreatTimer -= dt;
      if (retreatTimer <= 0) {
        const zone = ZONES[currentZoneId];
        enterZone(zone.id, { x: zone.bossArena.entryX - 120, y: zone.spawn.y });
      }
    } else if (phase === "boss-defeat-cutscene") {
      if (activeBossLine) {
        activeBossLine.timer -= dt;
        if (activeBossLine.timer <= 0) activeBossLine = null;
      }
      updateCutscene(dt);
    } else if (phase === "collapse" || phase === "ending") {
      endingTimer += dt;
    }
    pressed.any = false;
  }

  // ---------------- draw: world ----------------
  function worldToScreen(x, y) {
    return [x - camera.x + frameShakeX, y - camera.y + frameShakeY];
  }

  const TREE_ARCHETYPES = ["pine", "rounded", "bushy", "snag"];
  function drawTreeShape(archetype, x, baseY, height, width, color) {
    if (archetype === "snag") {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, width * 0.12);
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.lineTo(x, baseY - height);
      ctx.moveTo(x, baseY - height * 0.6);
      ctx.lineTo(x + width * 0.3, baseY - height * 0.8);
      ctx.moveTo(x, baseY - height * 0.4);
      ctx.lineTo(x - width * 0.25, baseY - height * 0.55);
      ctx.stroke();
      return;
    }
    ctx.fillStyle = color;
    if (archetype === "pine") {
      ctx.beginPath();
      ctx.moveTo(x, baseY - height);
      ctx.lineTo(x + width / 2, baseY);
      ctx.lineTo(x - width / 2, baseY);
      ctx.fill();
    } else if (archetype === "rounded") {
      ctx.beginPath();
      ctx.moveTo(x - width / 2, baseY);
      ctx.quadraticCurveTo(x - width / 2, baseY - height, x, baseY - height);
      ctx.quadraticCurveTo(x + width / 2, baseY - height, x + width / 2, baseY);
      ctx.closePath();
      ctx.fill();
    } else {
      // bushy: a few overlapping canopy clumps
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(x + (i - 1) * width * 0.3, baseY - height * (0.4 + i * 0.18), width * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillRect(x - width * 0.06, baseY - 4, width * 0.12, 10);
  }

  // Three parallax layers, each with seeded (stable, non-flickering) shape
  // variation and tinted toward the sky's horizon color the farther back it
  // sits -- the color-matching is what reads as atmospheric depth, far more
  // than scroll speed alone did when every layer was identical flat triangles.
  const PARALLAX_LAYERS = [
    { scroll: 0.15, baseWidth: 90, baseHeight: 260, yFrac: 0.78, fogMix: 0.55, alpha: 0.72 },
    { scroll: 0.3, baseWidth: 70, baseHeight: 190, yFrac: 0.82, fogMix: 0.28, alpha: 0.88 },
    { scroll: 0.5, baseWidth: 55, baseHeight: 140, yFrac: 0.86, fogMix: 0.08, alpha: 1 },
  ];
  function drawBackground(zone) {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, zone.palette.sky[0]);
    g.addColorStop(1, zone.palette.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const horizonColor = zone.palette.sky[1];
    PARALLAX_LAYERS.forEach((layer, li) => {
      const spacing = layer.baseWidth * 2.2;
      const offset = (camera.x * layer.scroll) % spacing;
      const treesNeeded = Math.ceil(canvas.width / spacing) + 2;
      const tintedColor = lerpColor("#04110a", horizonColor, layer.fogMix);
      const baseY = canvas.height * layer.yFrac;
      ctx.globalAlpha = layer.alpha;
      for (let i = -1; i <= treesNeeded; i++) {
        const worldSlot = Math.floor((camera.x * layer.scroll + i * spacing) / spacing);
        const seed = li * 10000 + worldSlot;
        const x = i * spacing - offset;
        const archetype = TREE_ARCHETYPES[Math.floor(seededRand(seed) * TREE_ARCHETYPES.length)];
        const wVar = 0.7 + seededRand(seed + 50) * 0.6;
        const hVar = 0.7 + seededRand(seed + 90) * 0.6;
        drawTreeShape(archetype, x, baseY, layer.baseHeight * hVar, layer.baseWidth * wVar, tintedColor);
      }
    });
    ctx.globalAlpha = 1;
  }

  // Full-frame post-process-style overlay: vignette, a warm/cool color
  // grade tied to how restored the current zone is (the withered->living
  // narrative should affect the whole scene, not just the ground), and a
  // faint pre-baked grain texture. Cheap: cached gradient/pattern objects,
  // no per-pixel work at runtime.
  function drawAtmosphereOverlay(zone) {
    const zs = saveData.zones[currentZoneId];
    const restoration = zone ? 0.5 * (zs.bossDefeated ? 1 : 0) + 0.5 * (zs.flowersRevived.length / Math.max(1, zone.flowers.length)) : 0;

    ctx.fillStyle = getVignette();
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = restoration > 0.5 ? `rgba(255,200,120,${0.04 + restoration * 0.07})` : `rgba(40,60,90,${0.12 - restoration * 0.1})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    if (grainPattern) {
      ctx.save();
      ctx.globalAlpha = 0.045;
      ctx.fillStyle = grainPattern;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
  }

  function drawGround(zone) {
    const sources = activeGrowthSources();
    for (const r of zone.ground) {
      const [sx, sy] = worldToScreen(r.x, r.y);
      if (sx + r.w < -20 || sx > canvas.width + 20) continue;
      const SEG = 44;
      for (let off = 0; off < r.w; off += SEG) {
        const segW = Math.min(SEG, r.w - off);
        const wx = r.x + off + segW / 2;
        let aliveness = 0;
        for (const src of sources) {
          const d = Math.hypot(wx - src.x, r.y - src.y);
          const a = clamp((src.radius - d) / 70, 0, 1);
          if (a > aliveness) aliveness = a;
        }
        ctx.fillStyle = lerpColor(zone.palette.withered, zone.palette.living, aliveness);
        ctx.fillRect(sx + off, sy, segW + 1, r.h);
        if (aliveness > 0.35) {
          ctx.fillStyle = `rgba(180,230,160,${0.15 + aliveness * 0.2})`;
          ctx.fillRect(sx + off, sy, segW + 1, 4);
        }
      }
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.strokeRect(sx, sy, r.w, r.h);
    }
  }

  function drawFlowers() {
    for (const f of zoneRuntime.flowers) {
      const [sx, sy] = worldToScreen(f.x, f.y);
      if (sx < -40 || sx > canvas.width + 40) continue;
      if (f.revived && f.radius > 4) {
        const grad = ctx.createRadialGradient(sx, sy - 30, 2, sx, sy - 30, f.radius);
        grad.addColorStop(0, "rgba(190,242,100,0.35)");
        grad.addColorStop(1, "rgba(190,242,100,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sx, sy - 30, f.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = f.revived ? "#4ade80" : "#1c1917";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(sx + (f.revived ? 4 : -6), sy - 20, sx, sy - 34);
      ctx.stroke();
      ctx.fillStyle = f.revived ? "#bef264" : "#0c0a09";
      ctx.beginPath();
      ctx.arc(sx, sy - 36, 7, 0, Math.PI * 2);
      ctx.fill();
      if (zoneRuntime.nearFlower === f && !f.revived) {
        ctx.fillStyle = "#fef08a";
        ctx.font = "13px system-ui, sans-serif";
        ctx.textAlign = "center";
        const pct = Math.round((f.holdTimer / REVIVE_HOLD_TIME) * 100);
        ctx.fillText(pct > 0 ? `Reviving... ${pct}%` : "Hold R to revive", sx, sy - 50);
      }
    }
  }

  function drawEnemies() {
    for (const e of zoneRuntime.enemies) {
      if (!e.alive) continue;
      const [sx, sy] = worldToScreen(e.x, e.y);
      ctx.save();
      if (e.dying) {
        // Brief scale-up-then-fade instead of vanishing instantly on death.
        const t = 1 - e.dyingTimer / 0.22;
        ctx.globalAlpha = Math.max(0, 1 - t);
        ctx.translate(sx, sy);
        ctx.scale(1 + t * 0.4, 1 + t * 0.4);
        ctx.translate(-sx, -sy);
      }
      ctx.fillStyle = "#94a3b8";
      ctx.beginPath();
      ctx.arc(sx, sy, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1e293b";
      ctx.beginPath();
      ctx.arc(sx - 5, sy - 2, 3, 0, Math.PI * 2);
      ctx.arc(sx + 5, sy - 2, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawMeleeSwing() {
    if (!meleeSwing) return;
    const t = 1 - meleeSwing.timer / meleeSwing.duration;
    const [sx, sy] = worldToScreen(player.x + player.w / 2, player.y + player.h / 2 - 4);
    const facing = meleeSwing.facing;
    const innerR = player.w / 2 + 2;
    const outerR = innerR + meleeSwing.reach;
    const baseAngle = facing > 0 ? -0.9 : Math.PI - 0.9 + Math.PI * 0.2;
    const sweep = 1.8;
    const a0 = facing > 0 ? -sweep / 2 : Math.PI - sweep / 2;
    const a1 = a0 + sweep * Math.min(1, t * 1.6);
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - t) * 0.8;
    const grad = ctx.createRadialGradient(sx, sy, innerR, sx, sy, outerR);
    grad.addColorStop(0, "rgba(190,242,100,0)");
    grad.addColorStop(0.7, "rgba(190,242,100,0.55)");
    grad.addColorStop(1, "rgba(74,222,128,0.15)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, outerR, a0, a1);
    ctx.arc(sx, sy, innerR, a1, a0, true);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    void baseAngle;
  }

  function drawImpactFlashes() {
    for (const f of impactFlashes) {
      const [sx, sy] = worldToScreen(f.x, f.y);
      const t = f.life / f.max;
      ctx.globalAlpha = t * 0.6;
      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, f.r * (1 + (1 - t) * 0.5));
      grad.addColorStop(0, f.color);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy, f.r * (1 + (1 - t) * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawCritters() {
    for (const c of zoneRuntime.critters) {
      const [sx, sy] = worldToScreen(c.x, c.y);
      ctx.fillStyle = "#d6c7a1";
      ctx.beginPath();
      ctx.ellipse(sx, sy, 20, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawProjectiles() {
    for (const p of projectiles) {
      const [sx, sy] = worldToScreen(p.x, p.y);
      ctx.fillStyle = p.owner === "player" ? "#4ade80" : "#f87171";
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(sx, sy, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const [sx, sy] = worldToScreen(p.x, p.y);
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(sx, sy, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Separate head/body shapes (each with its own stroke) read as one joined
  // creature rather than an undifferentiated blob -- the visible seam acts
  // as a "neck." An asymmetric twin-leaf hood (one tall, one short, both
  // leaning the way the player faces) gives the silhouette a directional
  // "tell" the way a single symmetric shape never does.
  function drawPlayer() {
    const [sx, sy] = worldToScreen(player.x, player.y);
    const blink = player.invincibleTimer > 0 && Math.floor(player.invincibleTimer * 14) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = blink ? 0.4 : 1;
    const cx = sx + player.w / 2;
    const bodyCy = sy + player.h * 0.68;
    const headCy = sy + player.h * 0.3;
    const bodyRx = player.w / 2;
    const bodyRy = player.h * 0.34;
    const headR = player.w * 0.44;
    const facing = player.facing;

    ctx.fillStyle = "#166534";
    ctx.beginPath();
    ctx.ellipse(cx, bodyCy, bodyRx, bodyRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#0a3d1f";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#22c55e";
    ctx.beginPath();
    ctx.arc(cx, headCy, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#bef264";
    ctx.beginPath();
    ctx.moveTo(cx + facing * 3, headCy - headR * 0.6);
    ctx.quadraticCurveTo(cx + facing * 9, headCy - headR * 1.8, cx + facing * 3, headCy - headR * 2.2);
    ctx.quadraticCurveTo(cx - facing * 1, headCy - headR * 1.5, cx - facing * 1, headCy - headR * 0.6);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - facing * 7, headCy - headR * 0.5);
    ctx.quadraticCurveTo(cx - facing * 11, headCy - headR, cx - facing * 7, headCy - headR * 1.2);
    ctx.quadraticCurveTo(cx - facing * 4, headCy - headR * 0.8, cx - facing * 4, headCy - headR * 0.5);
    ctx.fill();

    ctx.fillStyle = "#052e16";
    ctx.beginPath();
    ctx.arc(cx + facing * headR * 0.4, headCy + 1, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Deluge is built as a segmented serpentine body (overlapping circles
  // along a sine-wave spine, tapering from a wide chest to a thin tail)
  // plus a distinct teardrop head with asymmetric eyes, instead of one
  // static ellipse -- a water dragon should read as sinuous, not blob-like.
  function drawBoss() {
    if (!bossFight) return;
    const b = bossFight;
    const boss = BOSSES[b.bossId];
    const t = b.hp / b.maxHp;
    const facing = player.x < b.x ? -1 : 1;
    ctx.save();

    const segCount = 6;
    for (let i = segCount - 1; i >= 0; i--) {
      const tSeg = i / (segCount - 1); // 0 = head/chest, 1 = tail tip
      const dist = tSeg * 86;
      const wave = Math.sin(b.spinePhase - tSeg * 2.4) * 22;
      const segX = b.x - facing * dist;
      const segY = b.y + wave;
      const [ssx, ssy] = worldToScreen(segX, segY);
      const r = 20 + (1 - tSeg) * 26;
      const grad = ctx.createRadialGradient(ssx - 6, ssy - 8, 3, ssx, ssy, r);
      grad.addColorStop(0, "#7dd3fc");
      grad.addColorStop(1, "#0369a1");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ssx, ssy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#e0f2fe";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const [hsx, hsy] = worldToScreen(b.x, b.y);
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.moveTo(hsx - facing * 34, hsy - 24);
    ctx.quadraticCurveTo(hsx + facing * 30, hsy - 20, hsx + facing * 46, hsy);
    ctx.quadraticCurveTo(hsx + facing * 30, hsy + 20, hsx - facing * 34, hsy + 24);
    ctx.quadraticCurveTo(hsx - facing * 42, hsy, hsx - facing * 34, hsy - 24);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#e0f2fe";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Asymmetric eyes -- one larger "main" eye with a pupil, one smaller --
    // a perfectly symmetric pair reads as inert; this reads as alert/alive.
    ctx.fillStyle = "#f0f9ff";
    ctx.beginPath();
    ctx.arc(hsx + facing * 12, hsy - 10, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#082f49";
    ctx.beginPath();
    ctx.arc(hsx + facing * 14, hsy - 10, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#bae6fd";
    ctx.beginPath();
    ctx.arc(hsx + facing * 4, hsy + 7, 4, 0, Math.PI * 2);
    ctx.fill();

    // Translucent "wet" highlight streaks along the body.
    ctx.strokeStyle = "rgba(224,242,254,0.5)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 2; i++) {
      const tSeg = 0.25 + i * 0.35;
      const dist = tSeg * 86;
      const wave = Math.sin(b.spinePhase - tSeg * 2.4) * 22;
      const [ssx, ssy] = worldToScreen(b.x - facing * dist, b.y + wave);
      ctx.beginPath();
      ctx.arc(ssx, ssy - 10, 14, Math.PI * 1.1, Math.PI * 1.7);
      ctx.stroke();
    }

    // Telegraph: color-coded by attack type (see TELEGRAPH_COLORS), and
    // shows the real danger zone / aim line during the whole warning
    // window -- not just once the attack goes live -- with intensity
    // ramping up as it's about to fire.
    if (b.telegraph) {
      const color = TELEGRAPH_COLORS[b.telegraph.attack.type] || "#ffffff";
      const urgency = 1 - b.telegraph.timer / b.telegraph.duration;
      const pulse = 0.45 + urgency * 0.4 + Math.sin(performance.now() / (100 - urgency * 55)) * 0.2;
      ctx.strokeStyle = color;
      ctx.globalAlpha = Math.max(0.3, Math.min(1, pulse));
      ctx.lineWidth = 3 + urgency * 3;
      ctx.beginPath();
      ctx.arc(hsx, hsy, 64, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      const preview = b.telegraph.preview;
      if (preview && preview.rect) {
        const [rx, ry] = worldToScreen(preview.rect.x, preview.rect.y);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.16 + urgency * 0.22;
        ctx.fillRect(rx, ry, preview.rect.w, preview.rect.h);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(rx, ry, preview.rect.w, preview.rect.h);
      } else if (preview && preview.type === "projectile") {
        const [lx1, ly1] = worldToScreen(b.x, b.y);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.25 + urgency * 0.35;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 8]);
        ctx.beginPath();
        ctx.moveTo(lx1, ly1);
        ctx.lineTo(lx1 + Math.cos(preview.angle) * 420, ly1 + Math.sin(preview.angle) * 420);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

    if (b.meleeZone) {
      const r = b.meleeZone.rect;
      const [rx, ry] = worldToScreen(r.x, r.y);
      ctx.fillStyle = TELEGRAPH_COLORS.melee;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(rx, ry, r.w, r.h);
      ctx.globalAlpha = 1;
    }
    if (b.groundZone) {
      const r = b.groundZone.rect;
      const [rx, ry] = worldToScreen(r.x, r.y);
      ctx.fillStyle = TELEGRAPH_COLORS.ground;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(rx, ry, r.w, r.h);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // boss HP bar
    const barW = Math.min(420, canvas.width * 0.6);
    const bx = canvas.width / 2 - barW / 2;
    ctx.fillStyle = "rgba(15,23,42,0.75)";
    ctx.fillRect(bx, 16, barW, 16);
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(bx + 2, 18, (barW - 4) * Math.max(0, t), 12);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(boss.name, canvas.width / 2, 12);
  }

  function drawGateHints(zone) {
    for (const gate of zone.gates || []) {
      const [sx, sy] = worldToScreen(gate.x, gate.y);
      if (sx < -60 || sx > canvas.width + 60) continue;
      ctx.fillStyle = gate.locked ? "rgba(100,80,60,0.6)" : "rgba(125,211,252,0.35)";
      ctx.fillRect(sx - 18, sy - 70, 36, 90);
      if (gate.locked) {
        ctx.fillStyle = "#fbbf24";
        ctx.font = "12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Sealed", sx, sy - 80);
      }
    }
  }

  function drawExplore() {
    const zone = ZONES[currentZoneId];
    drawBackground(zone);
    drawAmbientParticles(zone);
    drawGround(zone);
    drawGateHints(zone);
    drawFlowers();
    drawCritters();
    drawEnemies();
    drawProjectiles();
    drawPlayer();
    drawMeleeSwing();
    drawParticles();
    drawImpactFlashes();
    drawAtmosphereOverlay(zone);
    drawTouchButtons();
    if (phase === "explore-tutorial") drawTutorialHints();
  }

  function drawTutorialHints() {
    const lines = [];
    if (!tutorialFlags.moved) lines.push("Press A / D to move");
    else if (!tutorialFlags.jumped) lines.push("Press Space to jump");
    else if (!tutorialFlags.attacked) lines.push("Press K to attack");
    else if (!tutorialFlags.revived) lines.push("Find the withered flower and hold R");
    if (!lines.length) return;
    ctx.fillStyle = "rgba(15,23,42,0.75)";
    const w = 320;
    ctx.fillRect(canvas.width / 2 - w / 2, 56, w, 36);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(lines[0], canvas.width / 2, 79);
  }

  function drawTouchButtons() {
    for (const b of touchButtons) {
      ctx.fillStyle = "rgba(15,23,42,0.5)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(226,232,240,0.5)";
      ctx.stroke();
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(b.id === "jump" ? "JUMP" : b.id === "melee" ? "HIT" : "R", b.x, b.y + 4);
    }
  }

  function drawBanner() {
    if (!bannerQueue.length) return;
    const b = bannerQueue[bannerQueue.length - 1];
    const alpha = b.life > b.max - 0.3 ? (b.max - b.life) / 0.3 : b.life < 0.4 ? b.life / 0.4 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = "rgba(10,16,10,0.78)";
    ctx.fillRect(0, canvas.height - 54, canvas.width, 54);
    ctx.fillStyle = "#bef264";
    ctx.font = "bold 16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(b.text, canvas.width / 2, canvas.height - 22);
    ctx.restore();
  }

  function drawTitle() {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, "#0d1b12");
    g.addColorStop(1, "#040806");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    for (let i = 0; i < 8; i++) {
      const x = ((i * 190 + titleBlink * 6) % (canvas.width + 300)) - 150;
      ctx.beginPath();
      ctx.moveTo(x, canvas.height);
      ctx.lineTo(x + 70, canvas.height - 380 - (i % 3) * 40);
      ctx.lineTo(x - 70, canvas.height);
      ctx.fill();
    }
    ctx.fillStyle = "#bef264";
    ctx.font = "bold 64px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(190,242,100,0.5)";
    ctx.shadowBlur = 24;
    ctx.fillText("Understory", canvas.width / 2, canvas.height / 2 - 40);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#94a3b8";
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText("Restore the Driftmoss Watershed", canvas.width / 2, canvas.height / 2 + 2);
    if (Math.sin(titleBlink * 3) > -0.2) {
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "16px system-ui, sans-serif";
      ctx.fillText("Press any key or tap to begin", canvas.width / 2, canvas.height / 2 + 60);
    }
  }

  function drawBossIntro() {
    const zone = ZONES[currentZoneId];
    drawBackground(zone);
    drawGround(zone);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, canvas.height / 2 - 60, canvas.width, 110);
    ctx.fillStyle = "#fbbf24";
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(BOSSES[zone.bossId].name, canvas.width / 2, canvas.height / 2 - 18);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "15px system-ui, sans-serif";
    wrapText(activeBossLine.text, canvas.width / 2, canvas.height / 2 + 14, canvas.width * 0.7, 20);
  }

  function wrapText(text, cx, y, maxWidth, lineHeight) {
    const words = text.split(" ");
    let line = "";
    const lines = [];
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    lines.forEach((l, i) => ctx.fillText(l, cx, y + i * lineHeight));
  }

  function drawBossRetreat() {
    const zone = ZONES[currentZoneId];
    drawBackground(zone);
    drawGround(zone);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, canvas.height / 2 - 40, canvas.width, 80);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("You retreat -- but the ground remembers what you already saved.", canvas.width / 2, canvas.height / 2 + 6);
  }

  function drawCutscene() {
    const zone = ZONES[currentZoneId];
    const t = cutscene.timer / cutscene.duration;
    drawBackground(zone);
    drawGround(zone);
    drawPlayer();

    if (bossDeathFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${bossDeathFlash * 0.85})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const clockCx = canvas.width / 2;
    const clockEnterT = clamp(t / 0.3, 0, 1);
    const clockY = -200 + (canvas.height * 0.28 + 200) * (1 - Math.pow(1 - clockEnterT, 3));
    const wipeT = clamp((t - 0.25) / 0.55, 0, 1);
    const maxR = Math.hypot(canvas.width, canvas.height);

    if (wipeT > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(clockCx, clockY, wipeT * maxR, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = cutscene.toPalette;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawAftermath(zone);
      ctx.restore();
    }

    if (t < 0.85) {
      ctx.save();
      ctx.translate(clockCx, clockY);
      ctx.fillStyle = "#1c1917";
      ctx.beginPath();
      ctx.arc(0, 0, 46, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fde68a";
      ctx.lineWidth = 4;
      ctx.stroke();
      const spin = performance.now() / 70;
      ctx.strokeStyle = "#fde68a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(spin) * 32, Math.sin(spin) * 32);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(spin * 3.4) * 20, Math.sin(spin * 3.4) * 20);
      ctx.stroke();
      ctx.restore();
    }

    if (activeBossLine) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, canvas.height - 70, canvas.width, 60);
      ctx.fillStyle = "#bef264";
      ctx.font = "16px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(activeBossLine.text, canvas.width / 2, canvas.height - 36);
    }
  }

  function drawAftermath(zone) {
    ctx.fillStyle = zone.palette.living;
    ctx.fillRect(0, canvas.height * 0.6, canvas.width, canvas.height * 0.4);
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    for (let i = 0; i < 5; i++) {
      const x = (i / 5) * canvas.width + 60;
      ctx.beginPath();
      ctx.moveTo(x, canvas.height * 0.62);
      ctx.lineTo(x + 40, canvas.height * 0.3);
      ctx.lineTo(x - 40, canvas.height * 0.62);
      ctx.fill();
    }
    ctx.fillStyle = "#166534";
    ctx.beginPath();
    ctx.ellipse(canvas.width * 0.3, canvas.height * 0.66, 30, 16, 0, 0, Math.PI * 2);
    ctx.ellipse(canvas.width * 0.78, canvas.height * 0.7, 24, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#22c55e";
    ctx.beginPath();
    ctx.ellipse(canvas.width * 0.22, canvas.height * 0.72, 22, 16, 0, 0, Math.PI * 2);
    ctx.fill();

    // A simple deer silhouette and a bird, standing in off to the sides --
    // "many plants and animals" is part of the requested aftermath beat,
    // not just restored terrain.
    ctx.fillStyle = "rgba(90,70,50,0.8)";
    const dx = canvas.width * 0.82;
    const dy = canvas.height * 0.68;
    ctx.beginPath();
    ctx.ellipse(dx, dy, 16, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(dx - 6, dy + 6, 3, 10);
    ctx.fillRect(dx + 6, dy + 6, 3, 10);
    ctx.beginPath();
    ctx.moveTo(dx + 12, dy - 6);
    ctx.lineTo(dx + 20, dy - 16);
    ctx.lineTo(dx + 16, dy - 4);
    ctx.fill();

    ctx.fillStyle = "rgba(40,40,40,0.75)";
    const bx = canvas.width * 0.14;
    const by = canvas.height * 0.58;
    ctx.beginPath();
    ctx.ellipse(bx, by, 8, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bx - 8, by - 2);
    ctx.lineTo(bx - 16, by - 8);
    ctx.lineTo(bx - 6, by - 4);
    ctx.fill();

    // The player, seated among the restored growth -- the pose the clock
    // wipe is building toward.
    const px = canvas.width / 2;
    const py = canvas.height * 0.78;
    ctx.fillStyle = "#22c55e";
    ctx.beginPath();
    ctx.ellipse(px - 14, py + 8, 13, 7, 0.3, 0, Math.PI * 2);
    ctx.ellipse(px + 14, py + 8, 13, 7, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(px, py - 6, 20, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#166534";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#bef264";
    ctx.beginPath();
    ctx.moveTo(px - 4, py - 26);
    ctx.lineTo(px, py - 40);
    ctx.lineTo(px + 4, py - 26);
    ctx.fill();
    ctx.fillStyle = "#052e16";
    ctx.beginPath();
    ctx.arc(px + 6, py - 8, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawJournal() {
    ctx.fillStyle = "rgba(5,10,8,0.97)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const section = JOURNAL_SECTIONS[journalPage % JOURNAL_SECTIONS.length];
    // Starts below y=100 on purpose: main.js's own DOM #hud bar (zone name,
    // pause button, vitality/biomass) always renders on top of this canvas
    // and occupies roughly the top 90px, regardless of what this draws.
    ctx.fillStyle = "#bef264";
    ctx.font = "bold 24px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`📖 ${section.title}`, canvas.width / 2, 128);
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`${(journalPage % JOURNAL_SECTIONS.length) + 1}/${JOURNAL_SECTIONS.length} -- [ / ] to page, J to close`, canvas.width / 2, 150);
    let y = 190;
    ctx.textAlign = "left";
    for (const id of section.conceptIds) {
      const c = CONCEPTS[id];
      if (!c) continue;
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 16px system-ui, sans-serif";
      ctx.fillText(c.term, 60, y);
      y += 22;
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "14px system-ui, sans-serif";
      const words = c.long.split(" ");
      let line = "";
      for (const w of words) {
        const test = line ? line + " " + w : w;
        if (ctx.measureText(test).width > canvas.width - 120 && line) {
          ctx.fillText(line, 60, y);
          y += 19;
          line = w;
        } else line = test;
      }
      if (line) {
        ctx.fillText(line, 60, y);
        y += 19;
      }
      y += 12;
      if (y > canvas.height - 40) break;
    }
  }
  window.addEventListener("keydown", (e) => {
    if (!journalOpen) return;
    if (e.code === "BracketRight") journalPage = (journalPage + 1) % JOURNAL_SECTIONS.length;
    if (e.code === "BracketLeft") journalPage = (journalPage - 1 + JOURNAL_SECTIONS.length) % JOURNAL_SECTIONS.length;
  });

  function drawCollapse() {
    ctx.fillStyle = "#050806";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "20px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("The watershed falls silent...", canvas.width / 2, canvas.height / 2);
  }

  function draw() {
    if (gameOver) return;
    if (phase === "title") {
      drawTitle();
      return;
    }
    if (phase === "explore" || phase === "explore-tutorial") drawExplore();
    else if (phase === "boss-intro") drawBossIntro();
    else if (phase === "boss-fight") {
      const zone = ZONES[currentZoneId];
      drawBackground(zone);
      drawAmbientParticles(zone);
      drawGround(zone);
      drawBoss();
      drawProjectiles();
      drawPlayer();
      drawMeleeSwing();
      drawParticles();
      drawImpactFlashes();
      drawAtmosphereOverlay(zone);
      drawTouchButtons();
    } else if (phase === "boss-retreat") drawBossRetreat();
    else if (phase === "boss-defeat-cutscene") drawCutscene();
    else if (phase === "collapse") drawCollapse();
    else drawExplore();

    if (phase !== "boss-defeat-cutscene") drawBanner(); // the cutscene already shows the boss's defeat line in that same screen region
    if (journalOpen) drawJournal();

    // player HUD hearts drawn by main.js via getHud(); nothing else to overlay here.
  }

  // ---------------- interface ----------------
  function isOver() {
    return saveData.completedGame || gameOverPending;
  }

  function getHud() {
    const zone = ZONES[currentZoneId];
    const zs = saveData.zones[currentZoneId];
    const pct = zone ? Math.round(50 * (zs.bossDefeated ? 1 : 0) + 50 * (zs.flowersRevived.length / zone.flowers.length)) : 0;
    const hp = player ? player.hp : 0;
    const maxHp = player ? player.maxHp : 3;
    return {
      left: zone ? `${zone.name} · Restoration ${pct}%` : "Understory",
      right: `${"🍃".repeat(Math.max(0, hp))}${"🤎".repeat(Math.max(0, maxHp - hp))} 🍄${saveData.biomass}`,
    };
  }

  function getOverResult() {
    if (saveData.completedGame) {
      return { title: "The Watershed Breathes Again", message: "Every zone restored. The Driftmoss Watershed thrives once more." };
    }
    return { title: "The Watershed Falls Silent", message: "Vitality exhausted after repeated setbacks. Your progress is saved -- try again." };
  }

  function getPauseInfo() {
    const options = [];
    if (saveData.upgradeLevels.maxVitality < MAX_UPGRADE_LEVEL) {
      options.push({ id: "max-vitality", label: `Deep Roots (Lv.${saveData.upgradeLevels.maxVitality})`, cost: upgradeCost(saveData.upgradeLevels.maxVitality) });
    }
    if (saveData.upgradeLevels.rootReach < MAX_UPGRADE_LEVEL) {
      options.push({ id: "root-reach", label: `Root Reach (Lv.${saveData.upgradeLevels.rootReach})`, cost: upgradeCost(saveData.upgradeLevels.rootReach) });
    }
    if (saveData.upgradeLevels.sporeRadius < MAX_UPGRADE_LEVEL) {
      options.push({ id: "spore-radius", label: `Spore Radius (Lv.${saveData.upgradeLevels.sporeRadius})`, cost: upgradeCost(saveData.upgradeLevels.sporeRadius) });
    }
    return { coins: saveData.biomass, options };
  }

  function applyUpgrade(id) {
    const key = { "max-vitality": "maxVitality", "root-reach": "rootReach", "spore-radius": "sporeRadius" }[id];
    if (!key || saveData.upgradeLevels[key] >= MAX_UPGRADE_LEVEL) return false;
    const cost = upgradeCost(saveData.upgradeLevels[key]);
    if (saveData.biomass < cost) return false;
    saveData.biomass -= cost;
    saveData.upgradeLevels[key] += 1;
    if (key === "maxVitality" && player) {
      player.maxHp += 1;
      player.hp += 1;
    }
    persistSave();
    return true;
  }

  function save() {
    if (player) {
      saveData.lastCheckpoint = { zoneId: currentZoneId, x: ZONES[currentZoneId] ? ZONES[currentZoneId].spawn.x : 120, y: ZONES[currentZoneId] ? ZONES[currentZoneId].spawn.y : 420 };
    }
    persistSave();
  }

  void prevKeysSnapshot;

  return {
    id: "understory",
    title: "Understory",
    thumbnail: null,
    description: "Restore a withered rainforest watershed, fend off eight disasters, and learn how the ecosystem actually works.",
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
