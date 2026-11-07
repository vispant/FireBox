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

    camera.x = clamp(player.x + player.w / 2 - canvas.width / 2, 0, Math.max(0, zone.width - canvas.width));
    camera.y = clamp(player.y - canvas.height * 0.55, 0, Math.max(0, zone.height - canvas.height));
  }

  function playerHurtbox() {
    return { x: player.x, y: player.y, w: player.w, h: player.h };
  }
  function damagePlayer(amount) {
    if (player.invincibleTimer > 0) return;
    player.hp -= amount;
    player.invincibleTimer = 1.0;
    spawnParticles(player.x + player.w / 2, player.y + player.h / 2, "#f87171", 8, 100);
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

  function resolveMeleeHit(hitbox) {
    for (const e of zoneRuntime.enemies) {
      if (!e.alive || e.hitCooldown > 0) continue;
      if (aabbOverlap(hitbox, { x: e.x - 16, y: e.y - 16, w: 32, h: 32 })) {
        e.hp -= 1;
        e.hitCooldown = 0.3;
        spawnParticles(e.x, e.y, "#60a5fa", 6, 90);
        if (e.hp <= 0) {
          e.alive = false;
          saveData.biomass += 5;
        }
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
    if (b.hitsLanded % 3 === 1) showConceptBanner("foodWeb");
    if (b.hp <= 0) winBossFight();
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
          if (e.alive && e.hitCooldown <= 0 && Math.hypot(p.x - e.x, p.y - e.y) < 18 + p.r) {
            e.hp -= 1;
            e.hitCooldown = 0.3;
            if (e.hp <= 0) {
              e.alive = false;
              saveData.biomass += 5;
            }
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
      if (b.telegraph.timer <= 0) executeBossAttack(b, boss, b.telegraph.attack);
    } else {
      b.attackCooldown -= dt;
      if (b.attackCooldown <= 0) {
        const atk = boss.attacks[Math.floor(rand(0, boss.attacks.length))];
        b.telegraph = { attack: atk, timer: atk.telegraphMs / 1000 };
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

  function executeBossAttack(b, boss, atk) {
    b.telegraph = null;
    b.attackCooldown = rand(1.4, 2.0);
    if (atk.type === "projectile") {
      const ang = Math.atan2(player.y - b.y, player.x - b.x);
      projectiles.push({ owner: "boss", x: b.x, y: b.y, vx: Math.cos(ang) * atk.speed, vy: Math.sin(ang) * atk.speed, r: 10, life: 3 });
    } else if (atk.type === "melee") {
      const dir = player.x < b.x ? -1 : 1;
      b.meleeZone = { timer: 0.3, rect: { x: dir > 0 ? b.x : b.x - atk.range, y: b.y - 40, w: atk.range, h: 80 } };
    } else if (atk.type === "ground") {
      b.groundZone = { timer: 0.35, rect: { x: player.x - atk.width / 2, y: ZONES[currentZoneId].bossArena.y - 40, w: atk.width, h: 60 } };
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
    return [x - camera.x, y - camera.y];
  }

  function drawBackground(zone) {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, zone.palette.sky[0]);
    g.addColorStop(1, zone.palette.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    for (let i = 0; i < 6; i++) {
      const wx = (i * 420 - camera.x * 0.3) % (canvas.width + 400) - 200;
      ctx.beginPath();
      ctx.moveTo(wx, canvas.height - 500);
      ctx.lineTo(wx + 60, canvas.height - 150);
      ctx.lineTo(wx - 60, canvas.height - 150);
      ctx.fill();
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
      ctx.fillStyle = "#94a3b8";
      ctx.beginPath();
      ctx.arc(sx, sy, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1e293b";
      ctx.beginPath();
      ctx.arc(sx - 5, sy - 2, 3, 0, Math.PI * 2);
      ctx.arc(sx + 5, sy - 2, 3, 0, Math.PI * 2);
      ctx.fill();
    }
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

  function drawPlayer() {
    const [sx, sy] = worldToScreen(player.x, player.y);
    const blink = player.invincibleTimer > 0 && Math.floor(player.invincibleTimer * 14) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = blink ? 0.4 : 1;
    const cx = sx + player.w / 2;
    const cy = sy + player.h / 2;
    ctx.fillStyle = "#22c55e";
    ctx.beginPath();
    ctx.ellipse(cx, cy + 4, player.w / 2, player.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#166534";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#bef264";
    const earDir = player.facing;
    ctx.beginPath();
    ctx.moveTo(cx - 6 * earDir, sy - 2);
    ctx.lineTo(cx - 2 * earDir, sy - 16);
    ctx.lineTo(cx + 2 * earDir, sy - 2);
    ctx.fill();
    ctx.fillStyle = "#052e16";
    ctx.beginPath();
    ctx.arc(cx + player.facing * 5, cy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBoss() {
    if (!bossFight) return;
    const b = bossFight;
    const [sx, sy] = worldToScreen(b.x, b.y);
    const boss = BOSSES[b.bossId];
    const t = b.hp / b.maxHp;
    ctx.save();
    const grad = ctx.createRadialGradient(sx, sy, 10, sx, sy, 55);
    grad.addColorStop(0, "#38bdf8");
    grad.addColorStop(1, "#0369a1");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 50 + Math.sin(b.bob * 2) * 4, 60, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#e0f2fe";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#f0f9ff";
    ctx.beginPath();
    ctx.arc(sx - 14, sy - 18, 6, 0, Math.PI * 2);
    ctx.arc(sx + 14, sy - 18, 6, 0, Math.PI * 2);
    ctx.fill();
    if (b.telegraph) {
      ctx.strokeStyle = `rgba(255,255,255,${0.5 + Math.sin(performance.now() / 60) * 0.4})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(sx, sy, 70, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (b.meleeZone) {
      const r = b.meleeZone.rect;
      const [rx, ry] = worldToScreen(r.x, r.y);
      ctx.fillStyle = "rgba(248,113,113,0.35)";
      ctx.fillRect(rx, ry, r.w, r.h);
    }
    if (b.groundZone) {
      const r = b.groundZone.rect;
      const [rx, ry] = worldToScreen(r.x, r.y);
      ctx.fillStyle = "rgba(248,113,113,0.35)";
      ctx.fillRect(rx, ry, r.w, r.h);
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
    drawGround(zone);
    drawGateHints(zone);
    drawFlowers();
    drawCritters();
    drawEnemies();
    drawProjectiles();
    drawPlayer();
    drawParticles();
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
      drawGround(zone);
      drawBoss();
      drawProjectiles();
      drawPlayer();
      drawParticles();
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
