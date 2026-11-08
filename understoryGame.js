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

import { CONCEPTS, SPECIES, ATTACK_CONCEPTS, ZONES, ZONE_ORDER, BOSSES, JOURNAL_SECTIONS, ALL_ZONES_AUTHORED, CANONICAL_DISASTER_ZONE_IDS } from "./understoryContent.js?v=2";
import { TAU, clamp, easeOutCubic, seededRand, rr as rrPath, wrapLines, drawKeyCap, drawPanel, drawBackdrop, drawPlayerLight, drawContactShadow, drawGroundBackdrop, drawGroundPiece, drawGate, drawFlower, flowerStyleIndex, mixRgb, rgbCss } from "./understoryArt.js?v=2";
import { drawPerson } from "./understoryPerson.js?v=1";
import { drawCritter, drawSiltWisp, drawDeluge, critterTopY } from "./understoryCreatures.js?v=2";

const SAVE_KEY = "fireBox.understory.save.v1";

const GRAVITY = 1600;
const MOVE_SPEED = 230;
const MOVE_ACCEL = 2200;
const JUMP_VELOCITY = -520;
const MAX_FALL = 900;
const PLAYER_W = 18; // a human silhouette is slimmer than the old spirit
const PLAYER_H = 38;
const REVIVE_RANGE = 70;
const REVIVE_HOLD_TIME = 0.6;
const GROWTH_DURATION = 4;
const BOSS_INTRO_TIME = 3.4;
const MAX_UPGRADE_LEVEL = 3;

function rand(min, max) {
  return min + Math.random() * (max - min);
}
function aabbOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
// stable per-string number (used to give each critter its own animation phase)
function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return (h % 997) / 7;
}

// Banner dwell: the ecology line stays on screen this long (seconds) so it can
// actually be read, then the next queued one takes over.
const BANNER_DURATION = 10;

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
    // which ecology concepts the banner has already taught (so it always shows
    // the least-seen one next) and which species the player has scanned
    conceptsSeen: {},
    speciesScanned: [],
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
      conceptsSeen: { ...(parsed.conceptsSeen || {}) },
      speciesScanned: Array.isArray(parsed.speciesScanned) ? parsed.speciesScanned : [],
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
  // Input mode is dynamic: phones/tablets (coarse primary pointer) start in touch
  // mode, but any key press switches to keyboard prompts (touchscreen Chromebooks
  // are used with the keyboard) and a real touch switches back.
  let usingTouch = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

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
  // The ecology banner: one on screen at a time, each for BANNER_DURATION
  // seconds, with a single pending slot so attacks never build a backlog.
  let bannerCurrent = null;
  let bannerPending = null;
  let worldTime = 0; // animation clock (advances only while update() runs)
  let visR = 0; // smoothed 0..1 restoration of the current zone -> scene brightness
  // Camera zoom: the world is drawn magnified so the character and wildlife read
  // clearly, scaled back toward 1x on narrow screens so the play area stays wide.
  let zoom = 1;
  // Adaptive quality: if frames stay slow the game latches into "lite" mode (no
  // light shafts, stars, cloud banks, far forest/ridge layers, butterflies, fur
  // detail or flower glow; half the plants) so a weak Chromebook keeps playing
  // smoothly. One-way per session.
  let lite = false;
  let frameEma = 16;
  let slowFrames = 0;
  function updateZoom() {
    zoom = clamp(canvas.width / 760, 1, 1.3);
  }
  let butterflies = [];
  let journalScroll = 0;
  // A jump press is remembered briefly: a tap shorter than one frame (slow
  // device) or pressed just before landing still jumps.
  let jumpBuffer = 0;
  let journalDrag = null; // drag-to-scroll inside the journal (touch / mouse)
  let journalButtons = []; // on-screen page/close buttons (touch devices), rebuilt each draw
  // procedural-animation state for the player sprite
  const pa = { runPhase: 0, landT: 0, wasGround: true, prevVy: 0, flowVx: 0, hurtT: 0, attackAnim: 0, castAnim: 0 };
  const zoneIntroShown = new Set(); // zone-intro banners already shown this session
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
    usingTouch = false;
    const k = keyFor(e.code);
    if (k) keys[k] = true;
    if (k === "jump" && !e.repeat) jumpBuffer = 0.14;
    if (e.code === "KeyK") pressed.melee = true;
    if (e.code === "KeyL") pressed.ranged = true;
    if (e.code === "KeyR") pressed.revive = true;
    if (e.code === "KeyF") pressed.scan = true;
    if (e.code === "KeyJ") pressed.journal = true;
    if (!e.repeat) pressed.any = true;
  });
  window.addEventListener("keyup", (e) => {
    const k = keyFor(e.code);
    if (k) keys[k] = false;
    if (e.code === "KeyR") pressed.revive = false;
  });
  // The character must only ever move while the player is actually holding a
  // control. A key-up that never arrives (focus lost mid-press: alt-tab, the OS
  // overview key, a browser shortcut, a pause menu) would otherwise leave the
  // character running forever, so every held input is dropped whenever focus
  // or visibility is lost, a session starts/ends, or the game was frozen.
  function releaseAllInput() {
    keys.left = keys.right = keys.jump = keys.down = false;
    pressed.melee = pressed.ranged = pressed.revive = pressed.scan = false;
    jumpBuffer = 0;
    touchMove = null;
    journalDrag = null;
    buttonPointers.clear();
  }
  window.addEventListener("blur", releaseAllInput);
  window.addEventListener("pagehide", releaseAllInput);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseAllInput();
  });

  let touchMove = null;
  // which on-screen button each active finger is holding (so lifting a finger
  // only releases ITS button -- never a key the player is holding on the keyboard)
  const buttonPointers = new Map();
  let touchButtons = [];
  function layoutTouchButtons() {
    if (!usingTouch) {
      touchButtons = [];
      return;
    }
    const W = canvas.width;
    const H = canvas.height;
    const s = clamp(Math.min(W, H) * 0.1, 34, 62);
    const m = s * 0.4;
    // right-hand cluster laid out so no two buttons overlap, plus a journal
    // button tucked under the HUD at the top-left
    touchButtons = [
      { id: "jump", x: W - m - s, y: H - m - s, r: s },
      { id: "melee", x: W - m - s * 3.15, y: H - m - s * 0.9, r: s * 0.85 },
      { id: "revive", x: W - m - s * 2.2, y: H - m - s * 2.75, r: s * 0.72 },
      { id: "scan", x: W - m - s * 4.75, y: H - m - s * 0.7, r: s * 0.62 },
      { id: "journal", x: m + s * 0.6, y: topSafe() + s * 0.6, r: s * 0.5 },
    ];
  }
  // First y (canvas px) below main.js's own DOM HUD pills, which sit on top of
  // the canvas and wrap onto extra rows on small screens.
  let hudEl = null;
  function topSafe() {
    try {
      if (!hudEl) hudEl = document.getElementById("hud");
      if (!hudEl) return 90;
      const hr = hudEl.getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();
      if (!cr.height || !hr.height) return 90;
      const bottom = (hr.bottom - cr.top) * (canvas.height / cr.height);
      return clamp(bottom + 12, 84, canvas.height * 0.5);
    } catch {
      return 90;
    }
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (gameOver) return;
    usingTouch = e.pointerType === "touch" || e.pointerType === "pen";
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const px = (e.clientX - rect.left) * scale;
    const py = (e.clientY - rect.top) * scale;
    if (journalOpen) {
      // journal: on-screen page/close buttons, or drag to scroll
      for (const jb of journalButtons) {
        if (px >= jb.x && px <= jb.x + jb.w && py >= jb.y && py <= jb.y + jb.h) {
          if (jb.id === "close") journalOpen = false;
          else {
            journalPage = (journalPage + (jb.id === "next" ? 1 : JOURNAL_PAGES - 1)) % JOURNAL_PAGES;
            journalScroll = 0;
          }
          return;
        }
      }
      journalDrag = { id: e.pointerId, y: py, scroll: journalScroll };
      return;
    }
    for (const b of touchButtons) {
      if (Math.hypot(px - b.x, py - b.y) < b.r) {
        buttonPointers.set(e.pointerId, b.id);
        if (b.id === "jump") {
          keys.jump = true;
          jumpBuffer = 0.14;
        }
        if (b.id === "melee") pressed.melee = true;
        if (b.id === "revive") pressed.revive = true;
        if (b.id === "scan") pressed.scan = true;
        if (b.id === "journal") pressed.journal = true;
        return;
      }
    }
    // Drag-to-move is a TOUCH control only. A mouse press on the left half of the
    // screen used to start it too, and if that button was released outside the
    // window the character kept steering after the pointer for good.
    const touchLike = e.pointerType === "touch" || e.pointerType === "pen";
    if (touchLike && px < canvas.width * 0.5) {
      touchMove = { id: e.pointerId, startX: px };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {}
    }
    pressed.any = true;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (journalDrag && e.pointerId === journalDrag.id) {
      const r = canvas.getBoundingClientRect();
      journalScroll = journalDrag.scroll - ((e.clientY - r.top) * (canvas.height / r.height) - journalDrag.y);
      return;
    }
    if (!touchMove || e.pointerId !== touchMove.id) return;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const px = (e.clientX - rect.left) * scale;
    const dx = px - touchMove.startX;
    keys.left = dx < -12;
    keys.right = dx > 12;
  });
  function releaseTouch(e) {
    if (journalDrag && e.pointerId === journalDrag.id) journalDrag = null;
    if (touchMove && e.pointerId === touchMove.id) {
      touchMove = null;
      keys.left = false;
      keys.right = false;
    }
    const held = buttonPointers.get(e.pointerId);
    if (held) {
      buttonPointers.delete(e.pointerId);
      if (held === "jump") keys.jump = false;
      if (held === "revive") pressed.revive = false;
    }
  }
  window.addEventListener("pointerup", releaseTouch);
  window.addEventListener("pointercancel", releaseTouch);
  canvas.addEventListener("lostpointercapture", releaseTouch);

  // ---------------- concept banners ----------------
  // One banner at a time, each held for BANNER_DURATION seconds. Requests that
  // arrive meanwhile go to a single pending slot (latest/highest priority wins)
  // so rapid attacks never build a stale backlog. Priorities: 0 zone intro,
  // 1 attack, 2 boss hit / revive, 3 deliberate scan (preempts the others).
  function truncate(text, n) {
    return text.length > n ? text.slice(0, n - 3) + "..." : text;
  }
  // Each attack owns an ordered list of concepts; show the one seen least so
  // far, so repeated attacks keep teaching new terms before any repeats.
  function pickConcept(list) {
    let best = null;
    let bestN = Infinity;
    for (const id of list) {
      if (!CONCEPTS[id]) continue;
      const n = saveData.conceptsSeen[id] || 0;
      if (n < bestN) {
        best = id;
        bestN = n;
      }
    }
    return best;
  }
  function activateBanner(b) {
    b.life = BANNER_DURATION;
    b.max = BANNER_DURATION;
    bannerCurrent = b;
    if (b.conceptId) {
      saveData.conceptsSeen[b.conceptId] = (saveData.conceptsSeen[b.conceptId] || 0) + 1;
      persistSave();
    }
  }
  function showBanner(b) {
    if (!bannerCurrent) {
      activateBanner(b);
      return;
    }
    if (b.priority >= 3 && bannerCurrent.priority < 3) {
      activateBanner(b); // the player asked for this one
      return;
    }
    if (b.conceptId && (bannerCurrent.conceptId === b.conceptId || (bannerPending && bannerPending.conceptId === b.conceptId))) return;
    if (!bannerPending || b.priority >= bannerPending.priority) bannerPending = b;
  }
  function tickBanner(dt) {
    if (!bannerCurrent) return;
    bannerCurrent.life -= dt;
    if (bannerCurrent.life <= 0) {
      bannerCurrent = null;
      if (bannerPending) {
        const nx = bannerPending;
        bannerPending = null;
        activateBanner(nx);
      }
    }
  }
  function conceptBanner(conceptId, priority) {
    const c = CONCEPTS[conceptId];
    if (!c) return;
    const [chip, accent] = CATEGORY[conceptId] || DEFAULT_CATEGORY;
    showBanner({ kind: "concept", conceptId, title: c.term, chip, accent, text: truncate(c.short, 110), priority });
  }
  function attackBanner(list, priority = 1) {
    const id = pickConcept(list);
    if (id) conceptBanner(id, priority);
  }
  function zoneIntroBanner(zone) {
    if (!zone.introConcept || zoneIntroShown.has(zone.id)) return;
    zoneIntroShown.add(zone.id);
    const c = CONCEPTS[zone.introConcept];
    if (!c) return;
    const accent = (CATEGORY[zone.introConcept] || DEFAULT_CATEGORY)[1];
    showBanner({ kind: "zone", conceptId: zone.introConcept, title: zone.name, chip: `Entering - ${c.term}`, accent, text: truncate(c.short, 110), priority: 0 });
  }
  function scanCritter(c) {
    const sp = SPECIES.find((s) => s.id === c.speciesId);
    if (!sp) return;
    const first = !saveData.speciesScanned.includes(sp.id);
    if (first) {
      saveData.speciesScanned.push(sp.id);
      saveData.biomass += 10;
      persistSave();
      spawnParticles(c.x, c.y + critterTopY(c.kind) * 0.5, "#fde68a", 14, 110);
    }
    const tags = sp.conceptIds.map((id) => CONCEPTS[id] && CONCEPTS[id].term).filter(Boolean).join("  -  ");
    showBanner({ kind: "species", title: sp.name, chip: first ? "New species scanned" : "Species scan", badge: first ? "+10 biomass" : null, accent: "#fbbf24", text: sp.line, tags, priority: 3 });
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
      x: camera.x + rand(-100, canvas.width / zoom + 100),
      y: firstSpawn ? camera.y + rand((canvas.height / zoom) * 0.1, (canvas.height / zoom) * 0.8) : camera.y + canvas.height / zoom + rand(0, 40),
      phase: rand(0, Math.PI * 2),
      speed: rand(6, 16),
      size: rand(1.3, 2.8),
      driftAmp: rand(10, 28),
    };
  }
  const BUTTERFLY_COLORS = ["#f9a8d4", "#fde68a", "#c4b5fd", "#fdba74", "#93c5fd"];
  function makeButterfly(firstSpawn) {
    return {
      x: camera.x + rand(-60, canvas.width / zoom + 60),
      y: camera.y + (canvas.height / zoom) * rand(0.35, 0.78),
      vx: rand(14, 30) * (Math.random() < 0.5 ? -1 : 1),
      phase: rand(0, TAU),
      color: BUTTERFLY_COLORS[Math.floor(rand(0, BUTTERFLY_COLORS.length))],
      first: firstSpawn,
    };
  }
  function initAmbientParticles() {
    ambientParticles = [];
    for (let i = 0; i < AMBIENT_COUNT; i++) ambientParticles.push(makeAmbientParticle(true));
    butterflies = [];
    for (let i = 0; i < 5; i++) butterflies.push(makeButterfly(true));
  }
  function updateAmbientParticles(dt) {
    if (phase !== "explore" && phase !== "explore-tutorial" && phase !== "boss-fight") return;
    for (const p of ambientParticles) {
      p.phase += dt * 0.8;
      p.y -= p.speed * dt;
      if (p.y < camera.y - 40 || p.x < camera.x - 150 || p.x > camera.x + canvas.width / zoom + 150) {
        Object.assign(p, makeAmbientParticle(false));
      }
    }
    for (const b of butterflies) {
      b.x += b.vx * dt;
      b.y += Math.sin(worldTime * 2.1 + b.phase) * 22 * dt;
      if (b.x < camera.x - 120 || b.x > camera.x + canvas.width / zoom + 120) Object.assign(b, makeButterfly(false), { x: b.vx > 0 ? camera.x - 100 : camera.x + canvas.width / zoom + 100 });
    }
  }

  function enterZone(zoneId, spawnOverride) {
    const zone = ZONES[zoneId];
    currentZoneId = zoneId;
    const zs = saveData.zones[zoneId];
    zs.visited = true;
    const flowers = zone.flowers.map((f) => {
      const revived = zs.flowersRevived.includes(f.id);
      return { ...f, maxRadius: f.maxRadius || 220, revived, radius: revived ? f.maxRadius || 220 : 0, growStart: revived ? -999 : 0, bloomAt: revived ? -999 : 0, holdTimer: 0 };
    });
    const enemies = (zone.enemies || []).map((e) => ({ ...e, hp: 2, alive: true, vx: 0, dir: 1, hitCooldown: 0 }));
    zoneRuntime = { flowers, enemies, critters: [], scanTarget: null, nearFlower: null };
    // Wildlife returns as green reaches it ("requires" = local restoration
    // threshold). Anything already restored is simply there on arrival.
    const sources = activeGrowthSources();
    zoneRuntime.critters = (zone.critters || []).map((c) => {
      const present = !c.requires || aliveAtPoint(c.x, c.y, sources) >= c.requires;
      return { ...c, appear: present ? 1 : 0, alert: 0, seedNum: hashStr(c.id) };
    });
    const sp = spawnOverride || zone.spawn;
    player.x = sp.x;
    player.y = sp.y;
    player.vx = 0;
    player.vy = 0;
    player.reviving = false;
    camera.x = sp.x;
    camera.y = sp.y;
    initAmbientParticles();
    projectiles = [];
    bossFight = null;
    cutscene = null;
    visR = restorationTarget(zone);
    phase = "explore";
    zoneIntroBanner(zone);
  }

  function activeGrowthSources() {
    const sources = zoneRuntime.flowers.filter((f) => f.revived).map((f) => ({ x: f.x, y: f.y, radius: f.radius }));
    if (bossFight && bossFight.zoneId === currentZoneId) {
      const zone = ZONES[currentZoneId];
      sources.push({ x: zone.bossArena.entryX + 150, y: zone.bossArena.y, radius: bossFight.restorationRadius });
    } else if (saveData.zones[currentZoneId] && saveData.zones[currentZoneId].bossDefeated) {
      // a beaten disaster leaves a wide, permanent swathe of recovered land
      const zone = ZONES[currentZoneId];
      if (zone.bossArena) sources.push({ x: zone.bossArena.entryX + 150, y: zone.bossArena.y, radius: 1100 });
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
    // channelling a revive roots the player in place (like a focus cast)
    if (!player.reviving) {
      if (keys.left) targetVx -= MOVE_SPEED;
      if (keys.right) targetVx += MOVE_SPEED;
    }
    player.vx += Math.sign(targetVx - player.vx) * Math.min(Math.abs(targetVx - player.vx), MOVE_ACCEL * dt);
    if (targetVx !== 0 && Math.abs(player.vx) > 20) tutorialFlags.moved = true;
    if (targetVx !== 0) player.facing = targetVx > 0 ? 1 : -1;

    jumpBuffer = Math.max(0, jumpBuffer - dt);
    if ((keys.jump || jumpBuffer > 0) && player.onGround && !player.reviving) {
      jumpBuffer = 0;
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
    const viewW = canvas.width / zoom;
    const viewH = canvas.height / zoom;
    const targetCamX = clamp(player.x + player.w / 2 - viewW / 2, 0, Math.max(0, zone.width - viewW));
    const targetCamY = clamp(player.y - viewH * 0.55, 0, Math.max(0, zone.height - viewH));
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
    pa.hurtT = 1;
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
          const t = clamp((worldTime - f.growStart) / GROWTH_DURATION, 0, 1);
          f.radius = f.maxRadius * (1 - Math.pow(1 - t, 3));
        }
        continue;
      }
      const d = Math.hypot(player.x + player.w / 2 - f.x, player.y + player.h - f.y);
      if (d < REVIVE_RANGE) nearFlower = f;
      else f.holdTimer = 0;
    }
    player.reviving = false;
    if (nearFlower && pressed.revive) {
      player.reviving = true;
      player.facing = nearFlower.x >= player.x + player.w / 2 ? 1 : -1;
      nearFlower.holdTimer += dt;
      if (nearFlower.holdTimer >= REVIVE_HOLD_TIME) {
        nearFlower.revived = true;
        nearFlower.growStart = worldTime;
        nearFlower.bloomAt = worldTime;
        tutorialFlags.revived = true;
        player.reviving = false;
        const zs = saveData.zones[currentZoneId];
        if (!zs.flowersRevived.includes(nearFlower.id)) zs.flowersRevived.push(nearFlower.id);
        spawnParticles(nearFlower.x, nearFlower.y - 24, "#bef264", 20, 110);
        spawnParticles(nearFlower.x, nearFlower.y - 24, "#fff3b0", 10, 70);
        attackBanner(ATTACK_CONCEPTS.reviveFlower, 2);
        persistSave();
      }
    } else if (nearFlower) {
      nearFlower.holdTimer = 0;
    }
    zoneRuntime.nearFlower = nearFlower;
  }

  // ---------------- wildlife: presence, attention, scan target ----------------
  const SCAN_REACH = { elk: 125, cougar: 105, bear: 105, eagle: 120, slug: 85, nurseLog: 95 };
  function updateCritters(dt) {
    const sources = activeGrowthSources();
    const pcx = player.x + player.w / 2;
    const feetY = player.y + player.h;
    let target = null;
    let best = Infinity;
    for (const c of zoneRuntime.critters) {
      const present = !c.requires || aliveAtPoint(c.x, c.y, sources) >= c.requires;
      const goal = present ? 1 : 0;
      c.appear += clamp(goal - c.appear, -dt * 0.5, dt * 0.45);
      const dx = Math.abs(pcx - c.x);
      const noticed = c.appear > 0.9 && dx < 260 && c.kind !== "nurseLog" && c.kind !== "slug";
      c.alert += ((noticed ? 1 : 0) - c.alert) * Math.min(1, dt * 3);
      if (c.alert > 0.6 && c.kind !== "eagle") c.facing = pcx >= c.x ? 1 : -1;
      if (c.appear > 0.6 && dx < (SCAN_REACH[c.kind] || 95) && Math.abs(feetY - c.y) < 75 && dx < best) {
        best = dx;
        target = c;
      }
    }
    zoneRuntime.scanTarget = target;
  }

  // ---------------- player sprite animation state ----------------
  function updatePlayerAnim(dt) {
    const speed = Math.abs(player.vx);
    if (player.onGround) pa.runPhase += speed * dt * 0.09;
    if (!pa.wasGround && player.onGround && pa.prevVy > 220) pa.landT = clamp(pa.prevVy / 700, 0.35, 1);
    pa.landT = Math.max(0, pa.landT - dt * 5.5);
    pa.wasGround = player.onGround;
    pa.prevVy = player.vy;
    pa.flowVx += (player.vx - pa.flowVx) * Math.min(1, dt * 7);
    pa.hurtT = Math.max(0, pa.hurtT - dt * 2.6);
    pa.attackAnim = Math.max(0, pa.attackAnim - dt);
    pa.castAnim = Math.max(0, pa.castAnim - dt);
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
      pa.attackAnim = 0.28;
      attackBanner(ATTACK_CONCEPTS.tendrilWhip, 1);
      resolveMeleeHit(hitbox);
    }
    if (pressed.ranged && rangedCooldown <= 0) {
      rangedCooldown = 0.6;
      pressed.ranged = false;
      const r = 6 + saveData.upgradeLevels.sporeRadius * 1.5;
      projectiles.push({ owner: "player", x: player.x + player.w / 2, y: player.y + player.h / 2, vx: player.facing * 420, vy: 0, r, life: 1.4 });
      pa.castAnim = 0.3;
      attackBanner(ATTACK_CONCEPTS.sporeBurst, 1);
    }
    if (pressed.scan) {
      pressed.scan = false;
      if (zoneRuntime.scanTarget) scanCritter(zoneRuntime.scanTarget);
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
    if (b.hitsLanded % 3 === 1) attackBanner(BOSSES[b.bossId].concepts || ["foodWeb"], 2);
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
      let gone = p.life <= 0 || p.x < camera.x - 60 || p.x > camera.x + canvas.width / zoom + 60;
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
    activeBossLine = { text: boss.introLine, timer: BOSS_INTRO_TIME };
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
    player.reviving = false;
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
    updatePlayerAnim(dt);
    player.reviving = false;
    zoneRuntime.scanTarget = null;

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
    // long enough that the restored valley (wildlife back, the ranger resting
    // among it) actually gets a few seconds on screen after the clock wipe
    activeBossLine = { text: boss.defeatLine, timer: 4.6 };
    cutscene = { timer: 0, duration: 5.2, zoneId: zone.id, fromPalette: boss.restorationFrom, toPalette: boss.restorationTo };
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
    bannerCurrent = null;
    bannerPending = null;
    zoneIntroShown.clear();
    jumpBuffer = 0;
    lite = false;
    frameEma = 16;
    slowFrames = 0;
    journalScroll = 0;
    Object.assign(pa, { runPhase: 0, landT: 0, wasGround: true, prevVy: 0, flowVx: 0, hurtT: 0, attackAnim: 0, castAnim: 0 });
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
    releaseAllInput();
    layoutTouchButtons();
    gameOver = false;
    phase = "title";
  }

  function startSession() {
    // the key/tap that dismissed the title must not also start the character walking
    releaseAllInput();
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
    // a gap this long means the game was frozen (pause menu, hidden tab): any key
    // released during it was never seen, so start clean
    if (dtMs > 1000) releaseAllInput();
    frameEma += (Math.min(dtMs, 100) - frameEma) * 0.04;
    if (!lite) {
      if (frameEma > 30) {
        if (++slowFrames > 90) lite = true;
      } else slowFrames = Math.max(0, slowFrames - 2);
    }
    updateZoom();
    layoutTouchButtons();

    // Hit-stop: a landed hit briefly freezes the whole frame (physics,
    // timers, AI) before resuming -- the classic cheap "impact" trick. Kept
    // short (40-120ms) on purpose so it reads as weight, not lag.
    if (hitStopTimer > 0) {
      hitStopTimer -= dt;
      return;
    }

    worldTime += dt;
    // the banner timer holds while the journal covers it, so no reading time is lost
    if (!journalOpen) tickBanner(dt);
    if (phase !== "title" && ZONES[currentZoneId]) {
      visR += (restorationTarget(ZONES[currentZoneId]) - visR) * Math.min(1, dt * 1.4);
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
      updateCritters(dt);
      updateCombat(dt);
      updatePlayerAnim(dt);
      updateEnemies(dt);
      updateProjectiles(dt, zone);
      if (phase === "explore-tutorial" && tutorialFlags.moved && tutorialFlags.jumped && tutorialFlags.attacked && tutorialFlags.revived) {
        saveData.completedTutorial = true;
        persistSave();
        phase = "explore";
      }
      // Gates are walked into: the player's feet must reach the gate on its own
      // ground level (the old top-left/centre test could never trigger).
      for (const gate of zone.gates || []) {
        if (Math.abs(player.x + player.w / 2 - gate.x) > 34 || Math.abs(player.y + player.h - gate.y) > 26) continue;
        if (gateIsLocked(gate)) continue;
        const target = ZONES[gate.toZone];
        if (!target) continue;
        saveData.lastCheckpoint = { zoneId: target.id, x: target.spawn.x, y: target.spawn.y };
        persistSave();
        enterZone(target.id, gate.arrive);
        return;
      }
      if (zone.bossArena && !saveData.zones[zone.id].bossDefeated) {
        if (player.x > zone.bossArena.entryX - 10 && player.x < zone.bossArena.entryX + zone.bossArena.w) {
          enterBossIntro();
        }
      }
    } else if (phase === "boss-intro") {
      activeBossLine.timer -= dt;
      // skippable only after the title card has had a moment on screen
      if (activeBossLine.timer <= 0 || (pressed.any && activeBossLine.timer < BOSS_INTRO_TIME - 1.5)) {
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

  // ======================================================================
  // draw
  // ======================================================================
  const PERSON_SCALE = 0.6;

  function worldToScreen(x, y) {
    return [x - camera.x + frameShakeX, y - camera.y + frameShakeY];
  }
  function view() {
    return { ox: -camera.x + frameShakeX, oy: -camera.y + frameShakeY, W: canvas.width / zoom, H: canvas.height / zoom, lite };
  }

  // 0 (withered, dusk) .. 1 (fully restored, golden morning) for the current
  // zone. The scene's sky, light, colour and plant life all blend with it, so
  // brightness itself is the progress bar.
  function restorationTarget(zone) {
    const zs = saveData.zones[zone.id];
    const flowers = zoneRuntime.flowers || [];
    const frac = flowers.length ? flowers.filter((f) => f.revived).length / flowers.length : 0;
    // A zone whose disaster boss is not built yet (the hub's wildfire) is fully
    // restored by its flowers alone; otherwise flowers are half and the boss half.
    if (!BOSSES[zone.bossId]) return clamp(frac, 0, 1);
    const defeated = zs.bossDefeated ? 1 : 0;
    let r = 0.5 * defeated + 0.5 * frac;
    if (bossFight && !defeated) r += 0.25 * (bossFight.hitsLanded / bossFight.maxHp);
    return clamp(r, 0, 1);
  }
  function aliveAtPoint(wx, wy, sources) {
    let a = 0;
    for (const s of sources) {
      const k = clamp((s.radius - Math.hypot(wx - s.x, wy - s.y)) / 130, 0, 1);
      if (k > a) a = k;
    }
    return a;
  }
  const groundTopCache = new Map();
  function groundTop(zone) {
    let g = groundTopCache.get(zone.id);
    if (g == null) {
      g = Math.max(...zone.ground.filter((r) => r.h >= 60).map((r) => r.y));
      groundTopCache.set(zone.id, g);
    }
    return g;
  }
  function groundYBelow(zone, x, feetY) {
    let best = null;
    for (const r of zone.ground) {
      if (x >= r.x && x <= r.x + r.w && r.y >= feetY - 3 && (best === null || r.y < best)) best = r.y;
    }
    return best;
  }

  function drawBackground(zone) {
    drawBackdrop(ctx, canvas.width / zoom, canvas.height / zoom, zone.palette, visR, camera.x, worldTime, lite);
  }

  // Finishing pass: only the zone's sunlit haze, once it has started to heal.
  // The vignette and film grain come from main.js's post shader and the CSS
  // #vignette, so repeating them here (full-screen fills) was pure cost.
  function drawAtmosphereOverlay() {
    if (visR <= 0.25) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const a = (visR - 0.25) / 0.75;
    const hg = ctx.createLinearGradient(0, 0, 0, H * 0.5);
    hg.addColorStop(0, "rgba(255,236,176," + 0.1 * a + ")");
    hg.addColorStop(1, "rgba(255,236,176,0)");
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, W, H * 0.5);
    ctx.restore();
  }

  // ---------------- lighting: the dark that life pushes back ----------------
  // The world starts in deep night. A tiny offscreen "darkness" layer is filled
  // with the night colour, then a soft hole is cut for every light (the player's
  // seed-lantern, each revived flower and its spreading glow, ember-glowing
  // withered flowers, open gates, enemies, spores, the boss) and the result is
  // scaled over the scene. As the zone heals the ambient darkness fades toward
  // zero, so the whole screen brightens -- adding life literally adds light.
  let lightCanvas = null;
  let lightCtx = null;
  const LIGHT_RES = 0.25; // soft light needs very little resolution
  function ambientDarkness(r) {
    return 0.68 * Math.pow(1 - clamp(r, 0, 1), 1.15);
  }
  // lights are in screen px: { x, y, r (radius), a (0..1 strength) }
  function applyLighting(darkA, lights, tintMix) {
    if (darkA < 0.012) return;
    const W = canvas.width;
    const H = canvas.height;
    const lw = Math.max(2, Math.ceil(W * LIGHT_RES));
    const lh = Math.max(2, Math.ceil(H * LIGHT_RES));
    if (!lightCanvas) {
      lightCanvas = document.createElement("canvas");
      lightCtx = lightCanvas.getContext("2d");
    }
    if (lightCanvas.width !== lw || lightCanvas.height !== lh) {
      lightCanvas.width = lw;
      lightCanvas.height = lh;
    }
    const c = lightCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "source-over";
    c.clearRect(0, 0, lw, lh);
    c.fillStyle = rgbCss(mixRgb([8, 15, 38], [58, 42, 54], clamp(tintMix, 0, 1)), darkA);
    c.fillRect(0, 0, lw, lh);
    c.globalCompositeOperation = "destination-out";
    for (const L of lights) {
      const x = L.x * LIGHT_RES;
      const y = L.y * LIGHT_RES;
      const r = L.r * LIGHT_RES;
      if (x + r < 0 || x - r > lw || y + r < 0 || y - r > lh) continue;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(0,0,0," + L.a + ")");
      g.addColorStop(0.5, "rgba(0,0,0," + L.a * 0.62 + ")");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    c.globalCompositeOperation = "source-over";
    ctx.drawImage(lightCanvas, 0, 0, W, H);
  }
  function worldLight(wx, wy, wr, a) {
    const [sx, sy] = worldToScreen(wx, wy);
    return { x: sx * zoom, y: sy * zoom, r: wr * zoom, a };
  }
  function gatherLights(zone, extra) {
    const L = [];
    // the player's seed-lantern, which swells while channelling a revive
    const reviving = pressed.revive && zoneRuntime.nearFlower;
    L.push(worldLight(player.x + player.w / 2, player.y + player.h * 0.55, 205 + (reviving ? 45 : 0), 1));
    for (const f of zoneRuntime.flowers) {
      if (f.revived) {
        // the green spreads and the light spreads with it
        if (f.radius > 6) L.push(worldLight(f.x, f.y - 24, f.radius * 0.95 + 55, 0.94));
      } else {
        // a withered flower keeps one faint ember, so it can be found in the dark
        L.push(worldLight(f.x + 13, f.y - 29, 52 + 6 * Math.sin(worldTime * 2.3 + f.x), 0.6));
      }
    }
    for (const e of zoneRuntime.enemies) if (e.alive && !e.dying) L.push(worldLight(e.x, e.y, 80, 0.78));
    for (const g of zone.gates || []) {
      const locked = gateIsLocked(g) || !ZONES[g.toZone];
      L.push(worldLight(g.x, g.y - 50, locked ? 70 : 140, locked ? 0.42 : 0.88));
    }
    for (const p of projectiles) L.push(worldLight(p.x, p.y, 84, 0.85));
    if (bossFight && bossFight.zoneId === currentZoneId) {
      const b = bossFight;
      const dir = player.x < b.x ? 1 : -1; // the body trails away from the player
      L.push(worldLight(b.x, b.y, 300, 0.9));
      L.push(worldLight(b.x + dir * 80, b.y + 10, 220, 0.8));
      if (b.restorationRadius > 4 && zone.bossArena) L.push(worldLight(zone.bossArena.entryX + 150, zone.bossArena.y - 30, b.restorationRadius * 0.95 + 100, 0.8));
    }
    if (extra) for (const e of extra) L.push(e);
    return L;
  }
  function lightPass(zone, extra) {
    applyLighting(ambientDarkness(visR), gatherLights(zone, extra), visR);
  }

  // Fireflies in the gloom, golden pollen once the zone is alive, plus
  // butterflies that only appear as the ecosystem recovers.
  function drawAmbient() {
    const W = canvas.width / zoom;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const c0 = [196, 222, 255];
    const c1 = [255, 236, 150];
    const col = mixRgb(c0, c1, visR);
    const pLimit = lite ? Math.min(8, ambientParticles.length) : ambientParticles.length;
    for (let pi = 0; pi < pLimit; pi++) {
      const p = ambientParticles[pi];
      const dx = Math.sin(p.phase) * p.driftAmp;
      const [sx, sy] = worldToScreen(p.x + dx, p.y);
      if (sx < -20 || sx > W + 20) continue;
      const a = 0.35 + Math.sin(p.phase * 2) * 0.2;
      const r = p.size * 3.4;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, rgbCss(col, a));
      g.addColorStop(1, rgbCss(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    if (visR > 0.4 && !lite) {
      const fade = clamp((visR - 0.4) / 0.3, 0, 1);
      for (const b of butterflies) {
        const [sx, sy] = worldToScreen(b.x, b.y);
        if (sx < -30 || sx > W + 30) continue;
        const flap = Math.abs(Math.sin(worldTime * 13 + b.phase));
        ctx.save();
        ctx.globalAlpha = fade * 0.9;
        ctx.translate(sx, sy);
        ctx.rotate(Math.sin(worldTime * 2 + b.phase) * 0.3);
        ctx.fillStyle = b.color;
        for (const sgn of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(sgn * 3.4 * flap, -1.6, 3.6 * flap + 0.6, 3.2, sgn * 0.5, 0, TAU);
          ctx.ellipse(sgn * 2.8 * flap, 2.2, 2.6 * flap + 0.5, 2.4, sgn * -0.4, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = "#2b2118";
        ctx.fillRect(-0.5, -3, 1, 6);
        ctx.restore();
      }
    }
  }

  function drawGround(zone) {
    const v = view();
    const sources = activeGrowthSources();
    const aliveAt = (wx, wy) => aliveAtPoint(wx, wy, sources);
    drawGroundBackdrop(ctx, v, groundTop(zone));
    zone.ground.forEach((r, i) => drawGroundPiece(ctx, v, r, i, aliveAt, zone.palette, worldTime));
  }

  function gateIsLocked(gate) {
    return !!gate.locked && !(gate.requires && saveData.abilities[gate.requires]);
  }
  function drawGates(zone) {
    const v = view();
    for (const gate of zone.gates || []) {
      const locked = gateIsLocked(gate) || !ZONES[gate.toZone];
      const target = ZONES[gate.toZone];
      const label = locked ? `Sealed${gate.label ? " - needs " + gate.label : ""}` : `To ${target.name}`;
      drawGate(ctx, v, gate, { t: worldTime, locked, label });
    }
  }

  function drawFlowers(zone) {
    const v = view();
    const [pcx, pcy] = worldToScreen(player.x + player.w / 2, player.y + player.h * 0.4);
    for (const f of zoneRuntime.flowers) {
      const since = worldTime - (f.bloomAt ?? -999);
      const near = zoneRuntime.nearFlower === f && !f.revived;
      drawFlower(ctx, v, f, {
        t: worldTime,
        bloom: f.revived ? clamp(since / 1.4, 0, 1) : 0,
        styleIdx: flowerStyleIndex(f.id),
        near,
        hold: f.holdTimer / REVIVE_HOLD_TIME,
        player: { x: pcx, y: pcy },
        touch: usingTouch,
        lite,
      });
    }
    void zone;
  }

  function drawCritters() {
    for (const c of zoneRuntime.critters) {
      if (c.appear <= 0.01) continue;
      const [sx, sy] = worldToScreen(c.x, c.y);
      if (sx < -240 || sx > canvas.width / zoom + 240) continue;
      drawCritter(ctx, c.kind, { sx, sy, t: worldTime, appear: c.appear, alert: c.alert, facing: c.facing, seed: c.seedNum, lite });
      if (zoneRuntime.scanTarget === c && !journalOpen) {
        const sp = SPECIES.find((s) => s.id === c.speciesId);
        const top = sy + critterTopY(c.kind) - 16;
        ctx.save();
        ctx.font = "bold 12px system-ui, sans-serif";
        const known = saveData.speciesScanned.includes(c.speciesId);
        const label = known ? sp.name : "Unknown species";
        const tw = ctx.measureText(label).width;
        const verb = usingTouch ? "Tap SCAN" : "Scan";
        const pw = tw + (usingTouch ? 96 : 74);
        const bob = Math.sin(worldTime * 3) * 1.5;
        drawPanel(ctx, sx - pw / 2, top - 28 + bob, pw, 28, { radius: 9, border: "rgba(251,191,36,0.55)" });
        const kw = usingTouch ? -8 : drawKeyCap(ctx, sx - pw / 2 + 8, top - 24 + bob, "F");
        ctx.fillStyle = "#fde68a";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(known ? label : verb, sx - pw / 2 + 14 + kw, top - 14 + bob);
        if (!known) {
          ctx.fillStyle = "rgba(253,230,138,0.65)";
          ctx.fillText(label, sx - pw / 2 + 14 + kw + (usingTouch ? 66 : 36), top - 14 + bob);
        }
        ctx.restore();
      }
    }
  }

  function drawEnemies() {
    zoneRuntime.enemies.forEach((e, i) => {
      if (!e.alive) return;
      const [sx, sy] = worldToScreen(e.x, e.y);
      if (sx < -80 || sx > canvas.width / zoom + 80) return;
      drawSiltWisp(ctx, {
        sx,
        sy,
        t: worldTime,
        seed: i * 1.7,
        hurt: e.hitCooldown > 0 ? e.hitCooldown / 0.3 : 0,
        dying: e.dying ? 1 - e.dyingTimer / 0.22 : 0,
        face: player.x + player.w / 2 < e.x ? -1 : 1,
      });
    });
  }

  function drawMeleeSwing() {
    if (!meleeSwing) return;
    const t = 1 - meleeSwing.timer / meleeSwing.duration;
    const [sx, sy] = worldToScreen(player.x + player.w / 2, player.y + player.h / 2 - 4);
    const facing = meleeSwing.facing;
    const innerR = player.w / 2 + 6;
    const outerR = innerR + meleeSwing.reach + 6;
    const sweep = 2.0;
    const a0 = facing > 0 ? -sweep / 2 : Math.PI - sweep / 2;
    const a1 = a0 + sweep * Math.min(1, t * 1.6);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = Math.max(0, 1 - t) * 0.9;
    const grad = ctx.createRadialGradient(sx, sy, innerR, sx, sy, outerR);
    grad.addColorStop(0, "rgba(190,242,100,0)");
    grad.addColorStop(0.65, "rgba(206,255,120,0.6)");
    grad.addColorStop(1, "rgba(90,230,130,0.12)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, outerR, a0, a1);
    ctx.arc(sx, sy, innerR, a1, a0, true);
    ctx.closePath();
    ctx.fill();
    // leaf flecks thrown off the whip
    ctx.fillStyle = "rgba(220,255,150,0.9)";
    for (let i = 0; i < 6; i++) {
      const a = a0 + (a1 - a0) * (i / 6);
      const rr = outerR - 4 - (i % 3) * 5;
      ctx.beginPath();
      ctx.ellipse(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr, 2.6, 1.2, a, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawImpactFlashes() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const f of impactFlashes) {
      const [sx, sy] = worldToScreen(f.x, f.y);
      const t = f.life / f.max;
      const r = f.r * (1 + (1 - t) * 0.5);
      ctx.globalAlpha = t * 0.7;
      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      grad.addColorStop(0, f.color);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawProjectiles() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of projectiles) {
      const [sx, sy] = worldToScreen(p.x, p.y);
      const mine = p.owner === "player";
      const col = mine ? "170,255,120" : "100,210,255";
      for (let i = 1; i <= 6; i++) {
        const k = i / 6;
        ctx.fillStyle = `rgba(${col},${0.3 * (1 - k)})`;
        ctx.beginPath();
        ctx.arc(sx - p.vx * 0.011 * i, sy - p.vy * 0.011 * i, p.r * (1 - k * 0.55), 0, TAU);
        ctx.fill();
      }
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, p.r * 2.6);
      g.addColorStop(0, "rgba(255,255,255,0.95)");
      g.addColorStop(0.3, `rgba(${col},0.75)`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, p.r * 2.6, 0, TAU);
      ctx.fill();
      if (mine) {
        ctx.fillStyle = "rgba(230,255,170,0.9)";
        for (let i = 0; i < 3; i++) {
          const a = worldTime * 9 + i * 2.1;
          ctx.beginPath();
          ctx.arc(sx + Math.cos(a) * p.r * 1.7, sy + Math.sin(a) * p.r * 1.7, 1.6, 0, TAU);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of particles) {
      const [sx, sy] = worldToScreen(p.x, p.y);
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(sx, sy, p.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPlayer() {
    const zone = ZONES[currentZoneId];
    const cx = player.x + player.w / 2;
    const feetY = player.y + player.h;
    const [sx, sy] = worldToScreen(cx, feetY);
    const gy = zone ? groundYBelow(zone, cx, feetY) : null;
    if (gy !== null) {
      const [, gsy] = worldToScreen(cx, gy);
      const h = Math.max(0, gy - feetY);
      drawContactShadow(ctx, sx, gsy + 1, 17 * (1 - clamp(h / 420, 0, 0.6)), 0.55 * clamp(1 - h / 170, 0.12, 1));
    }
    const blink = player.invincibleTimer > 0 && Math.floor(player.invincibleTimer * 14) % 2 === 0;
    const reviving = zoneRuntime.nearFlower && pressed.revive && phase !== "boss-fight";
    drawPerson(ctx, {
      x: sx,
      y: sy,
      facing: player.facing,
      scale: PERSON_SCALE,
      t: worldTime,
      glow: 1 + visR * 0.2,
      speed: Math.abs(player.vx) / MOVE_SPEED,
      onGround: player.onGround,
      vy: player.vy,
      runPhase: pa.runPhase,
      flowVx: pa.flowVx,
      landT: pa.landT,
      attackT: pa.attackAnim > 0 ? 1 - pa.attackAnim / 0.28 : -1,
      castT: pa.castAnim > 0 ? 1 - pa.castAnim / 0.3 : -1,
      reviveT: reviving ? clamp(zoneRuntime.nearFlower.holdTimer / REVIVE_HOLD_TIME, 0.05, 1) : 0,
      hurtT: pa.hurtT,
      alpha: blink ? 0.45 : 1,
    });
  }
  // the seed-lantern: a warm pool of colour that travels with the player
  function drawPlayerLantern() {
    const [sx, sy] = worldToScreen(player.x + player.w / 2, player.y + player.h * 0.42);
    drawPlayerLight(ctx, sx, sy, 1 + (pressed.revive && zoneRuntime.nearFlower ? 0.5 : 0), visR);
  }

  // ---------------- boss ----------------

  function drawBossBody() {
    if (!bossFight) return;
    const b = bossFight;
    const facing = player.x < b.x ? -1 : 1;
    const [hsx, hsy] = worldToScreen(b.x, b.y);
    const tele = b.telegraph;
    const urgency = tele ? 1 - tele.timer / tele.duration : 0;
    drawDeluge(ctx, {
      sx: hsx,
      sy: hsy,
      facing,
      phase: b.spinePhase,
      t: worldTime,
      clean: 1 - b.hp / b.maxHp,
      open: tele && tele.attack.type !== "ground" ? clamp(urgency * 1.6, 0, 1) : b.meleeZone ? 1 : 0,
      glow: tele ? TELEGRAPH_COLORS[tele.attack.type] : null,
      hurt: b.hitCooldown > 0 ? b.hitCooldown / 0.25 : 0,
    });
  }

  // Telegraph: color-coded by attack type, showing the real danger zone / aim
  // line for the whole warning window with intensity ramping as it fires. Drawn
  // after the lighting pass so warnings stay bright and readable in the dark.
  function drawBossFx() {
    if (!bossFight) return;
    const b = bossFight;
    const [hsx, hsy] = worldToScreen(b.x, b.y);
    const tele = b.telegraph;
    const urgency = tele ? 1 - tele.timer / tele.duration : 0;
    ctx.save();
    if (tele) {
      const color = TELEGRAPH_COLORS[tele.attack.type] || "#ffffff";
      const pulse = 0.5 + urgency * 0.4 + Math.sin(worldTime * (10 + urgency * 14)) * 0.15;
      ctx.strokeStyle = color;
      ctx.globalAlpha = clamp(pulse, 0.3, 1);
      ctx.lineWidth = 2.5 + urgency * 3;
      ctx.beginPath();
      ctx.arc(hsx, hsy, 70 + Math.sin(worldTime * 8) * 2, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      const preview = tele.preview;
      if (preview && preview.rect) {
        const [rx, ry] = worldToScreen(preview.rect.x, preview.rect.y);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.14 + urgency * 0.24;
        ctx.fillRect(rx, ry, preview.rect.w, preview.rect.h);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(rx, ry, preview.rect.w, preview.rect.h);
        ctx.setLineDash([]);
      } else if (preview && preview.type === "projectile") {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.3 + urgency * 0.4;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 8]);
        ctx.beginPath();
        ctx.moveTo(hsx, hsy);
        ctx.lineTo(hsx + Math.cos(preview.angle) * 440, hsy + Math.sin(preview.angle) * 440);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }
    for (const z of [b.meleeZone, b.groundZone]) {
      if (!z) continue;
      const [rx, ry] = worldToScreen(z.rect.x, z.rect.y);
      const isMelee = z === b.meleeZone;
      const g = ctx.createLinearGradient(0, ry, 0, ry + z.rect.h);
      const col = isMelee ? "251,146,60" : "248,113,113";
      g.addColorStop(0, `rgba(${col},0.15)`);
      g.addColorStop(1, `rgba(${col},0.6)`);
      ctx.fillStyle = g;
      ctx.fillRect(rx, ry, z.rect.w, z.rect.h);
    }
    ctx.restore();
  }

  function drawBossHud() {
    if (!bossFight) return;
    const b = bossFight;
    const boss = BOSSES[b.bossId];
    const t = clamp(b.hp / b.maxHp, 0, 1);
    const barW = Math.min(440, canvas.width * 0.62);
    const bx = canvas.width / 2 - barW / 2;
    const by = topSafe() + 26; // below main.js's own DOM HUD pills
    drawPanel(ctx, bx - 12, by - 24, barW + 24, 50, { radius: 12, border: "rgba(125,211,252,0.4)" });
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.fillStyle = "#e0f2fe";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(boss.name, canvas.width / 2, by - 7);
    rrPath(ctx, bx, by, barW, 12, 6);
    ctx.fillStyle = "rgba(2,20,36,0.8)";
    ctx.fill();
    const fw = Math.max(0, (barW - 4) * t);
    if (fw > 1) {
      const g = ctx.createLinearGradient(bx, 0, bx + barW, 0);
      g.addColorStop(0, "#38bdf8");
      g.addColorStop(1, "#7dd3fc");
      rrPath(ctx, bx + 2, by + 2, fw, 8, 4);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(bx + 6, by + 3, Math.max(0, fw - 8), 2);
    }
    ctx.strokeStyle = "rgba(2,20,36,0.7)";
    ctx.lineWidth = 1;
    for (let i = 1; i < b.maxHp; i++) {
      const x = bx + 2 + ((barW - 4) * i) / b.maxHp;
      ctx.beginPath();
      ctx.moveTo(x, by + 2);
      ctx.lineTo(x, by + 10);
      ctx.stroke();
    }
  }

  // ---------------- scene composition ----------------
  function drawWorld(zone) {
    drawBackground(zone);
    drawGround(zone);
    drawGates(zone);
    drawCritters();
    drawFlowers(zone);
  }

  function drawExplore(zone) {
    ctx.save();
    ctx.scale(zoom, zoom);
    drawWorld(zone);
    drawEnemies();
    ctx.restore();
    lightPass(zone);
    // everything below is a source of light itself, so it sits above the darkness
    ctx.save();
    ctx.scale(zoom, zoom);
    drawAmbient();
    drawPlayerLantern();
    drawPlayer();
    drawProjectiles();
    drawMeleeSwing();
    drawParticles();
    drawImpactFlashes();
    ctx.restore();
    drawAtmosphereOverlay();
    if (phase === "explore-tutorial") drawTutorialHints();
  }

  function drawBossFightScene(zone) {
    ctx.save();
    ctx.scale(zoom, zoom);
    drawWorld(zone);
    drawBossBody();
    ctx.restore();
    lightPass(zone);
    ctx.save();
    ctx.scale(zoom, zoom);
    drawAmbient();
    drawBossFx();
    drawPlayerLantern();
    drawPlayer();
    drawProjectiles();
    drawMeleeSwing();
    drawParticles();
    drawImpactFlashes();
    ctx.restore();
    drawAtmosphereOverlay();
    drawBossHud();
  }

  // ---------------- HUD-ish panels ----------------
  function drawTutorialHints() {
    let keysArr;
    let text;
    let step;
    if (!tutorialFlags.moved) {
      keysArr = ["A", "D"];
      text = "Move";
      step = 1;
    } else if (!tutorialFlags.jumped) {
      keysArr = ["Space"];
      text = "Jump";
      step = 2;
    } else if (!tutorialFlags.attacked) {
      keysArr = ["K"];
      text = "Tendril Whip - attack";
      step = 3;
    } else if (!tutorialFlags.revived) {
      keysArr = ["R"];
      text = "Hold beside the withered flower to revive it";
      step = 4;
    } else return;
    if (usingTouch) {
      keysArr = [];
      text = ["", "Drag on the left side of the screen to move", "Tap JUMP", "Tap WHIP to attack", "Hold REVIVE beside the withered flower"][step];
    }
    ctx.save();
    ctx.font = "bold 15px system-ui, sans-serif";
    const tw = ctx.measureText(text).width;
    const kwTotal = keysArr.reduce((s, k) => s + Math.max(20, ctx.measureText(k).width + 12) + 6, 0);
    const pw = tw + kwTotal + 74;
    const px = canvas.width / 2 - pw / 2;
    const py = topSafe(); // below the DOM HUD pills
    drawPanel(ctx, px, py, pw, 40, { radius: 12, border: "rgba(190,242,120,0.5)" });
    let x = px + 14;
    for (const k of keysArr) x += drawKeyCap(ctx, x, py + 9, k) + 6;
    ctx.fillStyle = "#ecfccb";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 6, py + 21);
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.fillStyle = "rgba(236,252,203,0.55)";
    ctx.textAlign = "right";
    ctx.fillText(`${step}/4`, px + pw - 12, py + 21);
    ctx.restore();
  }

  function drawTouchButtons() {
    const LABEL = { jump: "JUMP", melee: "WHIP", revive: "REVIVE", scan: "SCAN", journal: "LOG" };
    for (const b of touchButtons) {
      // Scan and Revive light up only when there is something to scan/revive.
      const contextual = b.id === "scan" || b.id === "revive";
      const ready = b.id === "scan" ? !!zoneRuntime.scanTarget : b.id === "revive" ? !!zoneRuntime.nearFlower : true;
      const pulse = ready && contextual ? 0.7 + 0.3 * Math.sin(worldTime * 6) : 1;
      ctx.save();
      ctx.globalAlpha = ready ? 1 : 0.5;
      const g = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, 2, b.x, b.y, b.r);
      g.addColorStop(0, "rgba(40,60,44,0.8)");
      g.addColorStop(1, "rgba(12,22,14,0.72)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = ready && contextual ? "rgba(253,230,138," + (0.5 + 0.4 * pulse) + ")" : "rgba(190,242,120,0.55)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#ecfccb";
      ctx.font = "bold " + Math.round(clamp(b.r * 0.27, 9, 13)) + "px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(LABEL[b.id], b.x, b.y);
      ctx.restore();
    }
  }

  // ---------------- the 10-second ecology banner ----------------
  const CATEGORY = {
    producers: ["Energy from sun", "#86efac"],
    photosynthesis: ["Energy from sun", "#86efac"],
    consumers: ["Who eats whom", "#fbbf24"],
    herbivore: ["Who eats whom", "#fbbf24"],
    carnivore: ["Who eats whom", "#fbbf24"],
    omnivore: ["Who eats whom", "#fbbf24"],
    scavenger: ["Who eats whom", "#fbbf24"],
    primaryConsumer: ["Who eats whom", "#fbbf24"],
    secondaryConsumer: ["Who eats whom", "#fbbf24"],
    tertiaryConsumer: ["Who eats whom", "#fbbf24"],
    decomposers: ["Recycling", "#fb923c"],
    detritivore: ["Recycling", "#fb923c"],
    organicMatter: ["Recycling", "#fb923c"],
    matterCycling: ["Recycling", "#fb923c"],
    foodChain: ["Food webs & energy", "#7dd3fc"],
    foodWeb: ["Food webs & energy", "#7dd3fc"],
    energyTransfer: ["Food webs & energy", "#7dd3fc"],
    limitingFactor: ["Balance", "#f0abfc"],
    competition: ["Balance", "#f0abfc"],
    sustainability: ["Balance", "#f0abfc"],
  };
  const DEFAULT_CATEGORY = ["Habitat & life", "#5eead4"];
  const ROLE_LABEL = {
    producer: "Producer",
    primaryConsumer: "Primary consumer",
    secondaryConsumer: "Secondary consumer",
    tertiaryConsumer: "Tertiary consumer",
    omnivore: "Omnivore",
    scavenger: "Scavenger",
    detritivore: "Detritivore",
    decomposer: "Decomposer",
    keystone: "Keystone species",
  };

  function drawBanner() {
    const b = bannerCurrent;
    if (!b) return;
    const W = canvas.width;
    const H = canvas.height;
    const narrow = W < 640;
    const fsBody = narrow ? 14 : 15.5;
    const lineH = Math.round(fsBody * 1.36);
    const margin = 14;
    // On touch devices keep clear of the on-canvas buttons: use the free space
    // to their left, or sit above them if the screen is too narrow for that.
    let left = margin;
    let right = W - margin;
    let bottom = H - 14;
    const cluster = touchButtons.filter((t) => t.id !== "journal");
    if (cluster.length) {
      const leftEdge = Math.min(...cluster.map((t) => t.x - t.r)) - 12;
      const topEdge = Math.min(...cluster.map((t) => t.y - t.r)) - 12;
      if (leftEdge - left >= 340) right = leftEdge;
      else bottom = Math.min(bottom, topEdge);
    }
    const panelW = Math.min(780, right - left);
    const px = left + (right - left - panelW) / 2;
    const accent = b.accent;
    const padX = 18;
    const textW = panelW - padX * 2 - 6;
    ctx.save();
    ctx.font = `${fsBody}px system-ui, sans-serif`;
    const lines = wrapLines(ctx, b.text, textW);
    const hasTags = !!b.tags;
    const panelH = 16 + 20 + lines.length * lineH + (hasTags ? 22 : 0) + 18;
    const py = bottom - panelH;
    const age = b.max - b.life;
    const aIn = clamp(age / 0.25, 0, 1);
    const aOut = clamp(b.life / 0.6, 0, 1);
    const a = Math.min(aIn, aOut);
    ctx.globalAlpha = a;
    ctx.translate(0, (1 - easeOutCubic(aIn)) * 14);
    drawPanel(ctx, px, py, panelW, panelH, { radius: 14, top: "rgba(20,34,26,0.93)", bottom: "rgba(8,16,12,0.95)", border: `${accent}66` });
    // accent bar
    rrPath(ctx, px + 8, py + 10, 4, panelH - 28, 2);
    ctx.fillStyle = accent;
    ctx.fill();
    // chip + title
    let ty = py + 28;
    ctx.font = "bold 10.5px system-ui, sans-serif";
    const chip = b.chip.toUpperCase();
    const cw = ctx.measureText(chip).width + 14;
    rrPath(ctx, px + padX, ty - 13, cw, 18, 9);
    ctx.fillStyle = `${accent}2e`;
    ctx.fill();
    ctx.strokeStyle = `${accent}88`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(chip, px + padX + 7, ty);
    ctx.font = `bold ${narrow ? 15 : 17}px system-ui, sans-serif`;
    ctx.fillStyle = "#f7fee7";
    ctx.fillText(b.title, px + padX + cw + 10, ty + 1);
    if (b.badge) {
      ctx.font = "bold 11px system-ui, sans-serif";
      const bw = ctx.measureText(b.badge).width + 14;
      rrPath(ctx, px + panelW - padX - bw, ty - 13, bw, 18, 9);
      ctx.fillStyle = "rgba(253,224,71,0.2)";
      ctx.fill();
      ctx.fillStyle = "#fde047";
      ctx.textAlign = "right";
      ctx.fillText(b.badge, px + panelW - padX - 7, ty);
      ctx.textAlign = "left";
    }
    // body
    ctx.font = `${fsBody}px system-ui, sans-serif`;
    ctx.fillStyle = "#e2efd9";
    ty += 24;
    for (const ln of lines) {
      ctx.fillText(ln, px + padX + 6, ty);
      ty += lineH;
    }
    if (hasTags) {
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = `${accent}`;
      ctx.fillText(b.tags, px + padX + 6, ty + 4);
    }
    // draining timer bar
    const barY = py + panelH - 9;
    rrPath(ctx, px + 14, barY, panelW - 28, 3, 1.5);
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fill();
    const frac = clamp(b.life / b.max, 0, 1);
    if (frac > 0.002) {
      rrPath(ctx, px + 14, barY, (panelW - 28) * frac, 3, 1.5);
      ctx.fillStyle = accent;
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------------- title ----------------
  function drawTitle() {
    const W = canvas.width;
    const H = canvas.height;
    const t = worldTime;
    const pal = ZONES.oldGrowth.palette;
    // The game opens in the dark: the withered watershed at night, with only the
    // ranger's lantern and a few fireflies cutting through it. Life (and light)
    // come back as you play.
    drawBackdrop(ctx, W, H, pal, 0.05, t * 10, t, lite);
    const gy = H * 0.84;
    const titleY = Math.max(H * 0.27, 150);
    const sc = clamp((gy - (titleY + 84)) / 96, 1.3, 4);
    const px = W * 0.5;
    const v = { ox: 0, oy: 0, W, H, lite };
    drawGroundBackdrop(ctx, v, gy);
    // a little life already follows the ranger: green only right around their feet
    drawGroundPiece(ctx, v, { x: -60, y: gy, w: W + 120, h: H - gy + 40 }, 3, (wx) => clamp((150 - Math.abs(wx - px)) / 80, 0, 1), pal, t);
    const flies = [];
    for (let i = 0; i < 22; i++) {
      flies.push({
        x: ((seededRand(i * 3.7) * W + Math.sin(t * 0.4 + i) * 40) % W + W) % W,
        y: H * (0.3 + seededRand(i * 9.1) * 0.55) + Math.sin(t * 0.9 + i * 1.3) * 14,
        a: 0.55 + 0.3 * Math.sin(t * 2 + i),
      });
    }
    const lights = [{ x: px + 3 * sc, y: gy - 38 * sc, r: 300 + 22 * Math.sin(t * 2.1), a: 1 }];
    for (let i = 0; i < 9; i++) lights.push({ x: flies[i].x, y: flies[i].y, r: 46, a: 0.7 });
    applyLighting(0.58, lights, 0.05);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const fl of flies) {
      const g = ctx.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, 9);
      g.addColorStop(0, "rgba(255,240,170," + fl.a + ")");
      g.addColorStop(1, "rgba(255,240,170,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fl.x, fl.y, 9, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    drawContactShadow(ctx, px, gy + 2, 22 * sc, 0.5);
    drawPlayerLight(ctx, px + 3 * sc, gy - 38 * sc, 1.6, 0.05);
    drawPerson(ctx, { x: px, y: gy, facing: 1, scale: sc, t, glow: 1.3, onGround: true });
    // title lockup
    const fs = Math.round(Math.min(W * 0.13, H * 0.13, 88));
    const ty = titleY;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `700 ${fs}px Georgia, "Palatino Linotype", "Times New Roman", serif`;
    ctx.shadowColor = "rgba(20,40,20,0.7)";
    ctx.shadowBlur = 18;
    const tg = ctx.createLinearGradient(0, ty - fs, 0, ty);
    tg.addColorStop(0, "#fffbe6");
    tg.addColorStop(1, "#cdeaa0");
    ctx.fillStyle = tg;
    ctx.fillText("Understory", W / 2, ty);
    ctx.shadowBlur = 0;
    // vine flourish
    const vw = Math.min(W * 0.46, 380);
    ctx.strokeStyle = "rgba(205,234,160,0.8)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(W / 2 - vw / 2, ty + 18);
    ctx.bezierCurveTo(W / 2 - vw / 4, ty + 10, W / 2 - 18, ty + 26, W / 2, ty + 18);
    ctx.bezierCurveTo(W / 2 + 18, ty + 10, W / 2 + vw / 4, ty + 26, W / 2 + vw / 2, ty + 18);
    ctx.stroke();
    ctx.fillStyle = "rgba(190,236,140,0.9)";
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(W / 2 + sx * (vw / 2 + 6), ty + 18, 7, 3, sx * -0.4, 0, TAU);
      ctx.fill();
    }
    ctx.font = `italic ${Math.round(Math.min(22, W * 0.04))}px Georgia, serif`;
    ctx.fillStyle = "#f0f9e6";
    ctx.shadowColor = "rgba(20,40,20,0.8)";
    ctx.shadowBlur = 8;
    ctx.fillText("Restore the Driftmoss Watershed", W / 2, ty + 52);
    ctx.shadowBlur = 0;
    if (Math.sin(t * 3) > -0.25) {
      ctx.font = "600 16px system-ui, sans-serif";
      ctx.fillStyle = "#fffbe6";
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 6;
      ctx.fillText(usingTouch ? "Tap to begin" : "Press any key to begin", W / 2, Math.min(H - 20, gy + (H - gy) * 0.62));
    }
    ctx.restore();
  }

  // ---------------- boss intro / retreat ----------------
  function drawLetterbox(bar) {
    ctx.fillStyle = "rgba(4,10,8,0.82)";
    ctx.fillRect(0, 0, canvas.width, bar);
    ctx.fillRect(0, canvas.height - bar, canvas.width, bar);
  }

  function drawBossIntro(zone) {
    ctx.save();
    ctx.scale(zoom, zoom);
    drawWorld(zone);
    const boss = BOSSES[zone.bossId];
    // preview the dragon rearing up in its arena
    const [hsx, hsy] = worldToScreen(zone.bossArena.entryX + 150, zone.bossArena.y - 10);
    const intro = clamp(1 - activeBossLine.timer / BOSS_INTRO_TIME, 0, 1);
    ctx.save();
    ctx.globalAlpha = easeOutCubic(clamp(intro * 2.4, 0, 1));
    drawDeluge(ctx, { sx: hsx, sy: hsy + (1 - easeOutCubic(clamp(intro * 2, 0, 1))) * 40, facing: -1, phase: worldTime * 2.2, t: worldTime, clean: 0, open: 0.2 });
    ctx.restore();
    ctx.restore();
    // the dragon brings its own cold glow into the dark arena
    const dl = worldLight(zone.bossArena.entryX + 150, zone.bossArena.y - 10, 330 * easeOutCubic(clamp(intro * 2.4, 0, 1)), 0.85);
    lightPass(zone, [dl]);
    ctx.save();
    ctx.scale(zoom, zoom);
    drawAmbient();
    drawPlayerLantern();
    drawPlayer();
    ctx.restore();
    drawAtmosphereOverlay();
    const bar = Math.round(canvas.height * 0.14) * easeOutCubic(clamp(intro * 3, 0, 1));
    drawLetterbox(bar);
    const a = easeOutCubic(clamp((intro - 0.15) * 3, 0, 1));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const cy = canvas.height * 0.5;
    ctx.fillStyle = "rgba(4,10,8,0.6)";
    ctx.fillRect(0, cy - 66, canvas.width, 130);
    ctx.font = `700 ${Math.min(34, canvas.width * 0.06)}px Georgia, serif`;
    ctx.fillStyle = "#fcd34d";
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 10;
    ctx.fillText(boss.name, canvas.width / 2, cy - 16);
    ctx.shadowBlur = 0;
    ctx.font = `italic ${Math.min(18, canvas.width * 0.034)}px Georgia, serif`;
    ctx.fillStyle = "#e7f3dc";
    const lines = wrapLines(ctx, activeBossLine.text, canvas.width * 0.72);
    lines.forEach((l, i) => ctx.fillText(l, canvas.width / 2, cy + 18 + i * 24));
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = "rgba(231,243,220,0.6)";
    ctx.fillText(`${boss.attacks.length} attacks - each is telegraphed before it lands`, canvas.width / 2, cy + 56);
    ctx.restore();
  }

  function drawBossRetreat(zone) {
    ctx.save();
    ctx.scale(zoom, zoom);
    drawWorld(zone);
    ctx.restore();
    lightPass(zone);
    ctx.save();
    ctx.scale(zoom, zoom);
    drawAmbient();
    drawPlayerLantern();
    drawPlayer();
    ctx.restore();
    drawAtmosphereOverlay();
    const a = clamp(1.8 - retreatTimer, 0, 0.7);
    ctx.fillStyle = `rgba(6,12,10,${a})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.globalAlpha = clamp((1.8 - retreatTimer) * 2, 0, 1);
    const cy = canvas.height / 2;
    drawPanel(ctx, canvas.width / 2 - Math.min(420, canvas.width * 0.42), cy - 42, Math.min(840, canvas.width * 0.84), 84, { radius: 16 });
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `italic ${Math.min(19, canvas.width * 0.036)}px Georgia, serif`;
    ctx.fillStyle = "#e7f3dc";
    ctx.fillText("You retreat - but the ground remembers what you already saved.", canvas.width / 2, cy - 4);
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillStyle = "#bef264";
    ctx.fillText("Secondary succession: recovery never restarts from bare rock.", canvas.width / 2, cy + 22);
    ctx.restore();
  }

  // ---------------- boss-defeat cutscene ----------------
  function drawClock(cx, cy, spin) {
    ctx.save();
    ctx.translate(cx, cy);
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 56);
    g.addColorStop(0, "rgba(255,236,170,0.5)");
    g.addColorStop(1, "rgba(255,236,170,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 56, 0, TAU);
    ctx.fill();
    const face = ctx.createRadialGradient(-8, -10, 4, 0, 0, 46);
    face.addColorStop(0, "#3a2c1a");
    face.addColorStop(1, "#150f08");
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(0, 0, 46, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#e8c46a";
    ctx.lineWidth = 4.5;
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,240,190,0.6)";
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 38, Math.sin(a) * 38);
      ctx.lineTo(Math.cos(a) * (i % 3 === 0 ? 31 : 34), Math.sin(a) * (i % 3 === 0 ? 31 : 34));
      ctx.stroke();
    }
    ctx.strokeStyle = "#fde68a";
    ctx.lineCap = "round";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(spin) * 31, Math.sin(spin) * 31);
    ctx.stroke();
    ctx.lineWidth = 3.6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(spin * 3.4) * 20, Math.sin(spin * 3.4) * 20);
    ctx.stroke();
    ctx.fillStyle = "#fde68a";
    ctx.beginPath();
    ctx.arc(0, 0, 3.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawCutscene(zone) {
    const t = cutscene.timer / cutscene.duration;
    const W = canvas.width;
    const H = canvas.height;
    ctx.save();
    ctx.scale(zoom, zoom);
    drawWorld(zone);
    ctx.restore();
    lightPass(zone);
    ctx.save();
    ctx.scale(zoom, zoom);
    drawAmbient();
    drawPlayerLantern();
    drawPlayer();
    ctx.restore();
    drawAtmosphereOverlay();
    if (bossDeathFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${bossDeathFlash * 0.85})`;
      ctx.fillRect(0, 0, W, H);
    }
    const clockCx = W / 2;
    const clockEnterT = clamp(t / 0.12, 0, 1);
    const clockY = -200 + (H * 0.28 + 200) * easeOutCubic(clockEnterT);
    const wipeT = clamp((t - 0.1) / 0.3, 0, 1);
    const maxR = Math.hypot(W, H);
    if (wipeT > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(clockCx, clockY, wipeT * maxR, 0, TAU);
      ctx.clip();
      drawAftermath(zone, (t - 0.1) * cutscene.duration);
      ctx.restore();
    }
    if (t < 0.36) drawClock(clockCx, clockY, worldTime * 14);
    if (activeBossLine) {
      const w = Math.min(760, W - 28);
      ctx.save();
      ctx.font = `italic ${W < 640 ? 15 : 18}px Georgia, serif`;
      const lines = wrapLines(ctx, activeBossLine.text, w - 40);
      const h = 28 + lines.length * 26;
      const x = W / 2 - w / 2;
      const y = H - h - 18;
      drawPanel(ctx, x, y, w, h, { radius: 14, border: "rgba(190,242,120,0.5)" });
      ctx.fillStyle = "#ecfccb";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      lines.forEach((l, i) => ctx.fillText(l, W / 2, y + 30 + i * 26));
      ctx.restore();
    }
  }

  // The restored valley: warm sky, full-grown plants, wildlife back in the
  // frame, the ranger resting among it all. Screen-space, so it can be drawn
  // inside the circular clock wipe.
  function drawAftermath(zone, since) {
    const W = canvas.width;
    const H = canvas.height;
    const t = worldTime;
    const pal = zone.palette;
    drawBackdrop(ctx, W, H, pal, 1, 120 + t * 6, t, lite);
    const gy = H * 0.76;
    const v = { ox: 0, oy: 0, W, H };
    drawGroundBackdrop(ctx, v, gy);
    drawGroundPiece(ctx, v, { x: -60, y: gy, w: W + 120, h: H - gy + 40 }, 5, () => 1, pal, t);
    // wildlife has returned
    const sc = clamp(H / 420, 0.8, 1.5);
    ctx.save();
    ctx.translate(W * 0.17, gy + 4);
    ctx.scale(sc, sc);
    drawCritter(ctx, "elk", { sx: 0, sy: 0, t, appear: 1, alert: 0, facing: 1, seed: 5 });
    ctx.restore();
    ctx.save();
    ctx.translate(W * 0.86, gy + 4);
    ctx.scale(sc, sc);
    drawCritter(ctx, "eagle", { sx: 0, sy: 0, t, appear: 1, alert: 0, facing: -1, seed: 2 });
    ctx.restore();
    // blooming flowers
    const vf = { ox: 0, oy: 0, W, H };
    for (const [fx, id] of [[0.34, "a1"], [0.62, "b2"], [0.72, "c3"], [0.08, "d4"]]) {
      drawFlower(ctx, vf, { x: W * fx, y: gy, revived: true, radius: 0 }, { t, bloom: clamp(since / 1.6, 0, 1), styleIdx: flowerStyleIndex(id), near: false, hold: 0, player: null });
    }
    // the ranger, resting among the restored growth with the lantern beside them
    const ps = clamp(H / 190, 1.5, 3.1);
    drawContactShadow(ctx, W * 0.5, gy + 3, 24 * ps, 0.5);
    drawPlayerLight(ctx, W * 0.5, gy - 24 * ps, 1.4, 1);
    drawPerson(ctx, { x: W * 0.5, y: gy, facing: 1, scale: ps, t, glow: 1, onGround: true, sitting: true });
    // drifting pollen & butterflies
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 24; i++) {
      const px = ((seededRand(i * 4.3) * W + t * (6 + (i % 5) * 3)) % W + W) % W;
      const py = H * (0.25 + seededRand(i * 8.7) * 0.5) + Math.sin(t + i) * 10;
      ctx.fillStyle = `rgba(255,236,160,${0.35 + 0.25 * Math.sin(t * 2 + i)})`;
      ctx.beginPath();
      ctx.arc(px, py, 1.6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    for (let i = 0; i < 4; i++) {
      const bx = W * (0.25 + i * 0.18) + Math.sin(t * 0.8 + i * 2) * 60;
      const by = gy - 90 - i * 22 + Math.sin(t * 1.3 + i) * 18;
      const flap = Math.abs(Math.sin(t * 13 + i));
      ctx.fillStyle = ["#f9a8d4", "#fde68a", "#c4b5fd", "#fdba74"][i];
      ctx.beginPath();
      ctx.ellipse(bx - 3 * flap, by, 3.2 * flap + 0.6, 3, -0.4, 0, TAU);
      ctx.ellipse(bx + 3 * flap, by, 3.2 * flap + 0.6, 3, 0.4, 0, TAU);
      ctx.fill();
    }
  }

  // ---------------- journal ----------------
  const JOURNAL_PAGES = JOURNAL_SECTIONS.length + 1; // + the Field Guide
  function journalWrapEntry(text, maxW, fs) {
    ctx.font = `${fs}px system-ui, sans-serif`;
    return wrapLines(ctx, text, maxW);
  }
  function drawJournal() {
    const W = canvas.width;
    const H = canvas.height;
    ctx.save();
    ctx.fillStyle = "#050c09";
    ctx.fillRect(0, 0, W, H);
    const page = journalPage % JOURNAL_PAGES;
    const isGuide = page === JOURNAL_SECTIONS.length;
    const section = isGuide ? null : JOURNAL_SECTIONS[page];
    // Starts below main.js's own DOM #hud bar, which always renders on top of
    // this canvas (and wraps onto extra rows on small screens).
    const top = Math.max(topSafe() - 6, 90);
    journalButtons = [];
    const margin = Math.max(18, W * 0.04);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.font = "700 26px Georgia, serif";
    ctx.fillStyle = "#d9f99d";
    ctx.fillText(isGuide ? "Field Guide" : section.title, margin, top + 24);
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillStyle = "rgba(190,242,120,0.6)";
    ctx.textAlign = "right";
    ctx.fillText(`${page + 1} / ${JOURNAL_PAGES}`, W - margin, top + 22);
    ctx.textAlign = "left";
    // footer: key hints on keyboards, page/close buttons on touch screens
    const fy = H - 18;
    const footerH = usingTouch ? 64 : 32;
    if (usingTouch) {
      const bw = Math.min(120, (W - margin * 2 - 24) / 3);
      const by = H - 54;
      for (const [id, label, bx] of [["prev", "< Prev", margin], ["close", "Close", W / 2 - bw / 2], ["next", "Next >", W - margin - bw]]) {
        drawPanel(ctx, bx, by, bw, 42, { radius: 12, border: "rgba(190,242,120,0.5)" });
        ctx.font = "bold 14px system-ui, sans-serif";
        ctx.fillStyle = "#ecfccb";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, bx + bw / 2, by + 22);
        journalButtons.push({ id, x: bx, y: by, w: bw, h: 42 });
      }
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    } else {
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "rgba(226,239,217,0.6)";
      ctx.fillText("[ / ]  or  Left / Right: turn page      Up / Down or wheel: scroll      J: close", margin, fy);
    }
    // content area (clipped + scrollable)
    const areaTop = top + 44;
    const areaH = H - footerH - areaTop;
    const cols = W >= 900 ? 2 : 1;
    const gap = 18;
    const colW = (W - margin * 2 - gap * (cols - 1)) / cols;
    const fs = W < 640 ? 13 : 14;
    const lh = Math.round(fs * 1.4);
    const items = [];
    if (isGuide) {
      for (const sp of SPECIES) {
        const known = saveData.speciesScanned.includes(sp.id);
        items.push({ term: known ? sp.name : "???", chip: known ? ROLE_LABEL[sp.role] || sp.role : "Not scanned", text: known ? sp.line : "Find this species in the watershed and " + (usingTouch ? "tap SCAN" : "press F") + " beside it to add it to your field guide.", color: known ? "#fbbf24" : "#64748b", dim: !known });
      }
    } else {
      for (const id of section.conceptIds) {
        const c = CONCEPTS[id];
        if (c) items.push({ term: c.term, chip: (CATEGORY[id] || DEFAULT_CATEGORY)[0], text: c.long, color: (CATEGORY[id] || DEFAULT_CATEGORY)[1] });
      }
    }
    const heights = items.map((it) => {
      it.lines = journalWrapEntry(it.text, colW - 34, fs);
      return 22 + 8 + it.lines.length * lh + 18;
    });
    // column-major masonry: place each card in the currently shortest column
    const colY = new Array(cols).fill(0);
    const placed = items.map((it, i) => {
      let c = 0;
      for (let k = 1; k < cols; k++) if (colY[k] < colY[c]) c = k;
      const p = { c, y: colY[c], h: heights[i] };
      colY[c] += heights[i] + 12;
      return p;
    });
    const total = Math.max(...colY) - 12;
    const maxScroll = Math.max(0, total - areaH);
    journalScroll = clamp(journalScroll, 0, maxScroll);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, areaTop, W, areaH);
    ctx.clip();
    items.forEach((it, i) => {
      const p = placed[i];
      const x = margin + p.c * (colW + gap);
      const y = areaTop + p.y - journalScroll;
      if (y > areaTop + areaH || y + p.h < areaTop) return;
      drawPanel(ctx, x, y, colW, p.h, { radius: 12, top: "rgba(20,34,26,0.9)", bottom: "rgba(11,20,15,0.92)", border: `${it.color}44` });
      rrPath(ctx, x + 8, y + 10, 3, p.h - 20, 1.5);
      ctx.fillStyle = it.color;
      ctx.fill();
      ctx.font = "bold 16px system-ui, sans-serif";
      ctx.fillStyle = it.dim ? "#94a3b8" : "#f7fee7";
      ctx.fillText(it.term, x + 20, y + 24);
      ctx.font = "bold 10.5px system-ui, sans-serif";
      const cw = ctx.measureText(it.chip.toUpperCase()).width + 12;
      rrPath(ctx, x + colW - cw - 12, y + 10, cw, 17, 8.5);
      ctx.fillStyle = `${it.color}26`;
      ctx.fill();
      ctx.fillStyle = it.color;
      ctx.textAlign = "right";
      ctx.fillText(it.chip.toUpperCase(), x + colW - 18, y + 22);
      ctx.textAlign = "left";
      ctx.font = `${fs}px system-ui, sans-serif`;
      ctx.fillStyle = it.dim ? "#7f8ea3" : "#d4e4cb";
      it.lines.forEach((ln, li) => ctx.fillText(ln, x + 20, y + 22 + 12 + (li + 1) * lh - 4));
    });
    ctx.restore();
    if (maxScroll > 0) {
      const trackH = areaH - 8;
      const th = Math.max(30, (areaH / total) * trackH);
      rrPath(ctx, W - 8, areaTop + 4 + (journalScroll / maxScroll) * (trackH - th), 4, th, 2);
      ctx.fillStyle = "rgba(190,242,120,0.45)";
      ctx.fill();
    }
    ctx.restore();
  }
  window.addEventListener("keydown", (e) => {
    if (!journalOpen) return;
    const prev = e.code === "BracketLeft" || e.code === "ArrowLeft";
    const next = e.code === "BracketRight" || e.code === "ArrowRight";
    if (next) {
      journalPage = (journalPage + 1) % JOURNAL_PAGES;
      journalScroll = 0;
    }
    if (prev) {
      journalPage = (journalPage - 1 + JOURNAL_PAGES) % JOURNAL_PAGES;
      journalScroll = 0;
    }
    if (e.code === "ArrowDown") journalScroll += 40;
    if (e.code === "ArrowUp") journalScroll -= 40;
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!journalOpen) return;
      journalScroll += e.deltaY;
      e.preventDefault();
    },
    { passive: false }
  );

  function drawCollapse() {
    const W = canvas.width;
    const H = canvas.height;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0b1410");
    g.addColorStop(1, "#050806");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = "italic 22px Georgia, serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("The watershed falls silent...", W / 2, H / 2);
  }

  function draw() {
    if (gameOver) return;
    updateZoom();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (phase === "title") {
      drawTitle();
      return;
    }
    const zone = ZONES[currentZoneId];
    if (phase === "explore" || phase === "explore-tutorial") drawExplore(zone);
    else if (phase === "boss-intro") drawBossIntro(zone);
    else if (phase === "boss-fight") drawBossFightScene(zone);
    else if (phase === "boss-retreat") drawBossRetreat(zone);
    else if (phase === "boss-defeat-cutscene") drawCutscene(zone);
    else if (phase === "collapse") drawCollapse();
    else drawExplore(zone);

    // the cutscene shows the boss's defeat line in that same screen region
    if (phase !== "boss-defeat-cutscene" && phase !== "collapse") drawBanner();
    if (phase === "explore" || phase === "explore-tutorial" || phase === "boss-fight") drawTouchButtons();
    if (journalOpen) drawJournal();
    // player HUD hearts are drawn by main.js via getHud(); nothing else to overlay here.
  }

  // ---------------- interface ----------------
  function isOver() {
    return saveData.completedGame || gameOverPending;
  }

  function getHud() {
    const zone = ZONES[currentZoneId];
    const zs = saveData.zones[currentZoneId];
    // zones whose disaster boss is not built yet are restored by flowers alone (matches the lighting)
    const frac = zone ? zs.flowersRevived.length / zone.flowers.length : 0;
    const pct = zone ? Math.round(BOSSES[zone.bossId] ? 50 * (zs.bossDefeated ? 1 : 0) + 50 * frac : 100 * frac) : 0;
    const maxHp = player ? player.maxHp : 3;
    const hp = player ? clamp(player.hp, 0, maxHp) : 0;
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
