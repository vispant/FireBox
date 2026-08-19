import { POSE, toCanvasCoords, drawFaceEmoji } from "./utils.js?v=4";
import {
  createFighter3D,
  HEAD_TOP_OFFSET,
  FEET_OFFSET,
  HEAD_CENTER_OFFSET,
  HEAD_RADIUS,
} from "./fighter3d.js?v=3";

// Tune these if strikes feel unresponsive (too high) or trigger accidentally (too low).
const STRIKE_SPEED_THRESHOLD = 28; // px moved between detected frames to count as a hit
const STRIKE_COOLDOWN_MS = 250;
const HIT_RADIUS_PAD = 30;
const VISIBILITY_MIN = 0.4; // ignore a tracked point if the model isn't confident it's in frame

const REGEN_INTERVAL_MS = 1500;
const REGEN_FRACTION = 0.1; // 10% of max health per interval

const SCALE = 1.25; // kept for background-layer sizing
const HEIGHT_SCALE = 1.18;
const s = (v) => v * SCALE;
const sy = (v) => v * SCALE * HEIGHT_SCALE;

const ARMY_SIZE = 5; // grunts that spawn together per stage, before the boss
const ARMY_WEAKNESS = 0.85; // army is (1 - this) = 15% weaker than the player
const BOSS_DAMAGE_MULT = 1.65; // boss deals 65% more damage than the player
const BOSS_HEALTH_MULT = 0.85; // boss has 15% less max health than the player
const CHASE_SPEED = 0.025; // how eagerly enemies close in on the player's tracked position
const FLOOR_LINE_MARGIN = 60; // px up from the very bottom edge where the floor line sits
const HEAD_KICK_BONUS = 25; // bonus coins for landing a kick specifically on the head
const HEAD_HIT_PAD = 14; // forgiving extra radius around the head hitbox

// Every time the player buys a health or damage upgrade, all NPCs (army AND boss)
// drop to 65% weaker than the player for their next 15 kills.
const WEAKENED_KILL_WINDOW = 15;
const WEAKENED_MULT = 0.35;
const GRUNT_NAMES = ["Grunt", "Footsoldier", "Scout", "Recruit", "Cadet", "Raider"];
const BOSS_NAMES = ["Warlord", "Juggernaut", "Colossus", "Doombringer", "Iron Champion", "Reaper King"];

// "outfit" still tags each grunt with a different archetype (used by the 3D layer
// for size/color variation) even though full costume geometry isn't modeled in 3D yet.
const OUTFITS = ["soldier", "knight", "tribal", "mercenary", "ninja"];

const UNIFORM_COLORS = ["#4b5320", "#6b5b3e", "#5a6b47", "#3f3f46", "#78716c", "#57534e", "#4a4a52", "#6d4c41"];
const GEAR_COLORS = ["#1c1917", "#292524", "#44403c", "#3f3f46", "#27272a"];
const SKIN_TONES = ["#f2c9a1", "#e0ac69", "#c68642", "#8d5524", "#5c3a21"];
const HAIR_COLORS = ["#1c1917", "#3f2e1e", "#6b4423", "#94795d", "#78716c"];
const ACCESSORIES = ["headband", "shades", "mohawk", "chain", "cape", "spikes"];

const SAVE_KEY = "nexPlaygroundMini.fighter.save.v1";

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return typeof data === "object" && data !== null ? data : null;
  } catch {
    return null;
  }
}

function writeSave(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // storage unavailable (private browsing, quota, etc.) - progress just won't persist
  }
}

function upgradeCost(timesBought) {
  return 50 + timesBought * 35;
}

function pickDifferent(palette, exclude) {
  if (palette.length <= 1) return palette[0];
  let choice;
  do {
    choice = palette[Math.floor(Math.random() * palette.length)];
  } while (choice === exclude);
  return choice;
}

function pickRandom(palette) {
  return palette[Math.floor(Math.random() * palette.length)];
}

function isVisible(landmark) {
  return !!landmark && (landmark.visibility === undefined || landmark.visibility > VISIBILITY_MIN);
}

function playSound(audio) {
  try {
    audio.currentTime = 0;
    audio.play().catch((err) => console.warn("Sound effect failed to play:", audio.src, err));
  } catch (err) {
    console.warn("Sound effect failed to play:", audio.src, err);
  }
}

export function createFighterGame({ canvas, ctx, video, threeCanvas, fxCanvas, fxCtx }) {
  const fighter3d = createFighter3D(threeCanvas);

  const sfxUserHit = new Audio("user_hit.mp3");
  const sfxNpcHit = new Audio("npc_hit.mp3");
  const sfxGameOver = new Audio("game_over.mp3");
  sfxUserHit.volume = 0.7;
  sfxNpcHit.volume = 0.7;
  sfxGameOver.volume = 0.8;

  // Browsers only allow audio to autoplay if it's tied to a real click. Sound
  // effects fire later from deep inside the game loop, which doesn't count —
  // so this "unlocks" all three the instant the player clicks Start, by
  // playing and immediately pausing each one within that real click.
  function primeAudio() {
    for (const audio of [sfxUserHit, sfxNpcHit, sfxGameOver]) {
      const playPromise = audio.play();
      if (playPromise && playPromise.then) {
        playPromise
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
          })
          .catch((err) => console.warn("Could not unlock audio for", audio.src, err));
      }
    }
  }

  // Directly tests whether a sound can actually play, triggered by a real click
  // (this button click itself), independent of any game state or timing.
  // Reports success/failure on-screen via the callback instead of the console.
  function testSound(onResult) {
    const audio = sfxUserHit;
    audio.currentTime = 0;
    let playPromise;
    try {
      playPromise = audio.play();
    } catch (err) {
      onResult(false, `Could not even attempt playback: ${err.name} — ${err.message}`);
      return;
    }
    if (playPromise && playPromise.then) {
      playPromise
        .then(() => onResult(true, "Sound is playing now (user_hit.mp3) — did you hear it?"))
        .catch((err) => onResult(false, `Blocked: ${err.name} — ${err.message}`));
    } else {
      onResult(true, "Playback started (older browser, no confirmation available).");
    }
  }

  let player,
    opponents,
    hands,
    feet,
    particles,
    floaters,
    shake,
    over,
    lastResult,
    smoke,
    lastAttackerName,
    hitFlashScreen,
    explosionTimer,
    explosionFlash,
    explosionX,
    explosionY,
    frameShakeX,
    frameShakeY;

  // Chest-center y that puts a character's feet exactly on the floor line drawn
  // in the fx overlay. Recomputed from canvas.height each call so it stays
  // correct if the camera resolution ever changes.
  function groundBaselineY() {
    return canvas.height - FLOOR_LINE_MARGIN - FEET_OFFSET;
  }

  function baseEnemy(x, y) {
    return {
      x,
      y,
      r: s(76),
      bob: Math.random() * Math.PI * 2,
      attackTimer: Math.random() * 700,
      phase: "idle", // idle | telegraph | strike | recover | dying
      phaseTimer: 0,
      attackType: null, // "punch" | "kick"
      attackSide: "left",
      hitFlash: 0,
      lookOffset: 0,
    };
  }

  function spawnGrunt(index, prevUniform, prevAccessory) {
    const chaseOffsetX = (index - (ARMY_SIZE - 1) / 2) * s(95);
    const x = canvas.width / 2 + chaseOffsetX;
    const yBase = index % 2 === 0 ? 0 : s(14);
    const y = groundBaselineY() + yBase;
    const weakMult = player.easyKillsRemaining > 0 ? WEAKENED_MULT : ARMY_WEAKNESS;
    const health = Math.max(15, Math.round(player.maxHealth * weakMult));
    const damage = Math.max(1, Math.round(player.damage * weakMult));
    return {
      ...baseEnemy(x, y),
      name: `${GRUNT_NAMES[index % GRUNT_NAMES.length]} ${index + 1}`,
      isBoss: false,
      outfit: OUTFITS[index % OUTFITS.length],
      maxHealth: health,
      health,
      damage,
      chaseOffsetX,
      yBase,
      attackInterval: Math.max(1800, 2800 - player.stage * 60),
      uniformColor: pickDifferent(UNIFORM_COLORS, prevUniform),
      gearColor: pickRandom(GEAR_COLORS),
      skinTone: pickRandom(SKIN_TONES),
      hairColor: pickRandom(HAIR_COLORS),
      accessory: pickDifferent(ACCESSORIES, prevAccessory),
    };
  }

  function spawnBoss(prevUniform) {
    const x = canvas.width / 2;
    const y = groundBaselineY();
    const weakened = player.easyKillsRemaining > 0;
    const health = Math.max(20, Math.round(player.maxHealth * (weakened ? WEAKENED_MULT : BOSS_HEALTH_MULT)));
    const damage = Math.max(4, Math.round(player.damage * (weakened ? WEAKENED_MULT : BOSS_DAMAGE_MULT)));
    return {
      ...baseEnemy(x, y),
      name: `${BOSS_NAMES[(player.stage - 1) % BOSS_NAMES.length]} — Stage ${player.stage} Boss`,
      isBoss: true,
      outfit: "commander",
      maxHealth: health,
      health,
      damage,
      chaseOffsetX: 0,
      yBase: 0,
      attackInterval: 1600,
      uniformColor: pickDifferent(UNIFORM_COLORS, prevUniform),
      gearColor: "#facc15",
      skinTone: pickRandom(SKIN_TONES),
      hairColor: pickRandom(HAIR_COLORS),
      accessory: "crown",
    };
  }

  function spawnWave() {
    if (player.waveIndex === 0) {
      let prevUniform = null;
      let prevAccessory = null;
      const list = [];
      for (let i = 0; i < ARMY_SIZE; i++) {
        const g = spawnGrunt(i, prevUniform, prevAccessory);
        prevUniform = g.uniformColor;
        prevAccessory = g.accessory;
        list.push(g);
      }
      opponents = list;
    } else {
      opponents = [spawnBoss(null)];
    }
  }

  function save() {
    writeSave({
      maxHealth: player.maxHealth,
      damage: player.damage,
      level: player.level,
      coins: player.coins,
      kills: player.kills,
      healthUpgrades: player.healthUpgrades,
      damageUpgrades: player.damageUpgrades,
      stage: player.stage,
      waveIndex: player.waveIndex,
      easyKillsRemaining: player.easyKillsRemaining,
    });
  }

  function resetProgress() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // storage unavailable - nothing to clear
    }
    reset();
  }

  function reset() {
    const saved = loadSave();
    // Older saves tracked a per-grunt index (0..ARMY_SIZE); collapse that to the new
    // binary "army phase" (0) vs "boss phase" (1) so returning players don't get
    // dropped straight into a boss fight by surprise.
    const rawWave = saved?.waveIndex ?? 0;
    player = {
      maxHealth: saved?.maxHealth ?? 100,
      damage: saved?.damage ?? 10,
      level: saved?.level ?? 1,
      coins: saved?.coins ?? 0,
      kills: saved?.kills ?? 0,
      healthUpgrades: saved?.healthUpgrades ?? 0,
      damageUpgrades: saved?.damageUpgrades ?? 0,
      stage: saved?.stage ?? 1,
      waveIndex: rawWave >= ARMY_SIZE ? 1 : 0,
      easyKillsRemaining: saved?.easyKillsRemaining ?? 0,
      regenTimer: 0,
    };
    player.health = player.maxHealth;

    hands = {
      left: { pos: null, cooldown: 0 },
      right: { pos: null, cooldown: 0 },
    };
    feet = {
      left: { pos: null, cooldown: 0 },
      right: { pos: null, cooldown: 0 },
    };
    particles = [];
    floaters = [];
    shake = 0;
    over = false;
    lastResult = null;
    lastAttackerName = "the army";
    hitFlashScreen = 0;
    frameShakeX = 0;
    frameShakeY = 0;

    spawnWave();

    smoke = [];
    for (let i = 0; i < 10; i++) {
      smoke.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height * 0.4,
        r: 50 + Math.random() * 90,
        a: 0.06 + Math.random() * 0.09,
      });
    }
    explosionTimer = 1500 + Math.random() * 2000;
    explosionFlash = 0;
    explosionX = 0;
    explosionY = 0;
  }
  reset();

  window.addEventListener("beforeunload", () => {
    if (player) save();
  });

  function addFloater(x, y, text, color) {
    floaters.push({ x, y, text, color, life: 50, maxLife: 50 });
  }

  function spawnHitSpark(x, y, count = 12) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const speed = 2 + Math.random() * 3;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: 2 + Math.random() * 3,
        color: Math.random() < 0.5 ? "#fbbf24" : "#fde68a",
        life: 22 + Math.random() * 10,
        maxLife: 32,
      });
    }
  }

  // Health hits 0 -> the body topples over for a beat before it's actually removed
  // and rewards are handed out, so kills read as an impact instead of a pop.
  function beginDeath(target) {
    if (target.phase === "dying") return;
    target.phase = "dying";
    target.dyingTimer = 700;
    target.fallSide = Math.random() < 0.5 ? -1 : 1;
    spawnHitSpark(target.x, target.y, 30);
  }

  function finishKill(target) {
    const wasBoss = target.isBoss;
    const coinsEarned = wasBoss ? 500 : 100;
    player.coins += coinsEarned;
    player.level += 1;
    player.kills += 1;
    if (player.easyKillsRemaining > 0) player.easyKillsRemaining -= 1;

    addFloater(target.x, target.y - 40, `+${coinsEarned} coins`, "#facc15");
    addFloater(target.x, target.y - 70, wasBoss ? "STAGE CLEARED!" : "DEFEATED!", "#4ade80");

    opponents = opponents.filter((o) => o !== target);

    if (wasBoss) {
      player.stage += 1;
      player.waveIndex = 0;
      save();
      spawnWave();
    } else if (opponents.length === 0) {
      player.waveIndex = 1;
      save();
      spawnWave();
    } else {
      save();
    }
  }

  function processStrike(limb, pos, isKick) {
    const prev = limb.pos;
    limb.pos = pos;
    if (limb.cooldown > 0) return;
    if (!prev) return;

    const speed = Math.hypot(pos.x - prev.x, pos.y - prev.y);
    if (speed < STRIKE_SPEED_THRESHOLD) return;

    let target = null;
    let bestDist = Infinity;
    for (const o of opponents) {
      if (o.phase === "dying") continue;
      const dist = Math.hypot(pos.x - o.x, pos.y - o.y);
      if (dist <= o.r + HIT_RADIUS_PAD && dist < bestDist) {
        target = o;
        bestDist = dist;
      }
    }
    if (!target) return;

    limb.cooldown = STRIKE_COOLDOWN_MS;
    target.health -= player.damage;
    target.hitFlash = 150;
    spawnHitSpark(pos.x, pos.y, 10);
    addFloater(pos.x, pos.y - 20, `-${player.damage}`, "#fbbf24");
    shake = Math.max(shake, 8);
    playSound(sfxUserHit);

    if (isKick) {
      const headY = target.y - HEAD_CENTER_OFFSET;
      const headDist = Math.hypot(pos.x - target.x, pos.y - headY);
      if (headDist <= HEAD_RADIUS + HEAD_HIT_PAD) {
        player.coins += HEAD_KICK_BONUS;
        addFloater(pos.x, pos.y - 40, `+${HEAD_KICK_BONUS} HEAD KICK!`, "#facc15");
      }
    }

    if (target.health <= 0) beginDeath(target);
  }

  function trackLimb(limb, landmark, pos, isKick) {
    if (!isVisible(landmark)) {
      limb.pos = null;
      return;
    }
    processStrike(limb, pos, isKick);
  }

  function updateSingleOpponent(o, dt, blocking, playerX) {
    if (o.phase === "dying") {
      o.dyingTimer -= dt;
      if (o.dyingTimer <= 0) finishKill(o);
      return;
    }

    o.bob += dt * 0.002;
    o.y = groundBaselineY() + o.yBase + Math.sin(o.bob) * 8;
    o.hitFlash = Math.max(0, o.hitFlash - dt);

    const desiredLook = Math.max(-1, Math.min(1, (playerX - o.x) / 220));
    o.lookOffset += (desiredLook - o.lookOffset) * Math.min(1, dt / 250);

    if (o.phase === "idle") {
      const targetX = Math.min(canvas.width - 70, Math.max(70, playerX + o.chaseOffsetX));
      o.x += (targetX - o.x) * CHASE_SPEED;

      o.attackTimer += dt;
      if (o.attackTimer > o.attackInterval) {
        o.attackTimer = 0;
        o.phase = "telegraph";
        o.phaseTimer = 550;
        o.attackType = Math.random() < 0.5 ? "punch" : "kick";
        o.attackSide = Math.random() < 0.5 ? "left" : "right";
        o.kickHeight = Math.random() < 0.3 ? "head" : "chest";
      }
    } else if (o.phase === "telegraph") {
      o.phaseTimer -= dt;
      if (o.phaseTimer <= 0) {
        if (blocking) {
          addFloater(canvas.width / 2, canvas.height - 120, "BLOCKED!", "#60a5fa");
        } else {
          player.health -= o.damage;
          lastAttackerName = o.name;
          addFloater(canvas.width / 2, canvas.height - 120, `-${o.damage}`, "#ef4444");
          shake = Math.max(shake, 14);
          hitFlashScreen = 1;
          playSound(sfxNpcHit);
        }
        o.phase = "strike";
        o.phaseTimer = 260;
      }
    } else if (o.phase === "strike") {
      o.phaseTimer -= dt;
      if (o.phaseTimer <= 0) {
        o.phase = "recover";
        o.phaseTimer = 300;
      }
    } else if (o.phase === "recover") {
      o.phaseTimer -= dt;
      if (o.phaseTimer <= 0) {
        o.phase = "idle";
        o.attackType = null;
      }
    }
  }

  function update(dt, landmarks) {
    if (over) return;

    player.regenTimer += dt;
    if (player.regenTimer >= REGEN_INTERVAL_MS) {
      player.regenTimer -= REGEN_INTERVAL_MS;
      if (player.health < player.maxHealth) {
        const healAmt = Math.round(player.maxHealth * REGEN_FRACTION);
        player.health = Math.min(player.maxHealth, player.health + healAmt);
        addFloater(canvas.width / 2, canvas.height - 60, `+${healAmt}`, "#4ade80");
      }
    }

    hands.left.cooldown = Math.max(0, hands.left.cooldown - dt);
    hands.right.cooldown = Math.max(0, hands.right.cooldown - dt);
    feet.left.cooldown = Math.max(0, feet.left.cooldown - dt);
    feet.right.cooldown = Math.max(0, feet.right.cooldown - dt);
    shake = Math.max(0, shake - dt * 0.05);
    hitFlashScreen = Math.max(0, hitFlashScreen - dt * 0.003);

    explosionTimer -= dt;
    if (explosionTimer <= 0) {
      explosionFlash = 1;
      explosionX = 100 + Math.random() * (canvas.width - 200);
      explosionY = canvas.height * 0.15 + Math.random() * canvas.height * 0.15;
      explosionTimer = 3500 + Math.random() * 4500;
    }
    explosionFlash = Math.max(0, explosionFlash - dt * 0.0012);

    let blocking = false;
    let playerX = canvas.width / 2;
    if (landmarks) {
      const lwL = landmarks[POSE.LEFT_WRIST];
      const rwL = landmarks[POSE.RIGHT_WRIST];
      const laL = landmarks[POSE.LEFT_ANKLE];
      const raL = landmarks[POSE.RIGHT_ANKLE];
      const noseL = landmarks[POSE.NOSE];

      const lw = toCanvasCoords(lwL, canvas.width, canvas.height);
      const rw = toCanvasCoords(rwL, canvas.width, canvas.height);
      const la = toCanvasCoords(laL, canvas.width, canvas.height);
      const ra = toCanvasCoords(raL, canvas.width, canvas.height);
      const ls = toCanvasCoords(landmarks[POSE.LEFT_SHOULDER], canvas.width, canvas.height);
      const rs = toCanvasCoords(landmarks[POSE.RIGHT_SHOULDER], canvas.width, canvas.height);
      blocking = lw.y < ls.y && rw.y < rs.y;

      if (isVisible(noseL)) {
        playerX = toCanvasCoords(noseL, canvas.width, canvas.height).x;
      }

      trackLimb(hands.left, lwL, lw, false);
      trackLimb(hands.right, rwL, rw, false);
      trackLimb(feet.left, laL, la, true);
      trackLimb(feet.right, raL, ra, true);
    } else {
      hands.left.pos = null;
      hands.right.pos = null;
      feet.left.pos = null;
      feet.right.pos = null;
    }

    for (const o of opponents) {
      updateSingleOpponent(o, dt, blocking, playerX);
    }

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 1;
    }
    particles = particles.filter((p) => p.life > 0);

    for (const f of floaters) {
      f.y -= 0.6;
      f.life -= 1;
    }
    floaters = floaters.filter((f) => f.life > 0);

    if (player.health <= 0) {
      player.health = 0;
      over = true;
      save();
      playSound(sfxGameOver);
      const phaseLabel = player.waveIndex === 1 ? "the boss fight" : "the army";
      lastResult = {
        title: "Knocked Out",
        message: `${lastAttackerName} finished you off during ${phaseLabel} at Stage ${player.stage}, with ${player.coins} coins. Your progress is saved — pick Fist Fighter again to pick up where you left off.`,
      };
    }
  }

  function drawSandbags(x, baseY, dir) {
    ctx.fillStyle = "#a8a29e";
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 3 - row; i++) {
        const bx = x + dir * (i * 22 + row * 11);
        const by = baseY - row * 16;
        ctx.beginPath();
        ctx.roundRect(bx - 18, by - 14, 36, 16, 6);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  function drawBattlefieldScene(w, h) {
    ctx.fillStyle = "#1c1917";
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "rgba(87, 65, 47, 0.35)";
    ctx.fillRect(0, 0, w, h);

    for (const p of smoke) {
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      grad.addColorStop(0, `rgba(120,113,108,${p.a})`);
      grad.addColorStop(1, "rgba(120,113,108,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (explosionFlash > 0) {
      const grad = ctx.createRadialGradient(explosionX, explosionY, 0, explosionX, explosionY, 140);
      grad.addColorStop(0, `rgba(251,146,60,${explosionFlash * 0.55})`);
      grad.addColorStop(1, "rgba(251,146,60,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(explosionX, explosionY, 140, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = "rgba(41,37,36,0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.05);
    for (let x = 0; x <= w; x += 26) {
      ctx.lineTo(x, h * 0.05 + Math.sin(x * 0.35) * 4);
    }
    ctx.stroke();
    for (let x = 12; x < w; x += 26) {
      const yy = h * 0.05 + Math.sin(x * 0.35) * 4;
      ctx.beginPath();
      ctx.moveTo(x - 5, yy - 5);
      ctx.lineTo(x + 5, yy + 5);
      ctx.moveTo(x + 5, yy - 5);
      ctx.lineTo(x - 5, yy + 5);
      ctx.stroke();
    }

    drawSandbags(20, h * 0.99, 1);
    drawSandbags(w - 20, h * 0.99, -1);

    ctx.strokeStyle = "rgba(28,25,23,0.45)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const cx = (w / 6) * i + 25;
      ctx.beginPath();
      ctx.moveTo(cx, h);
      ctx.lineTo(cx + 9, h - 16);
      ctx.lineTo(cx - 5, h - 28);
      ctx.stroke();
    }
  }

  function drawArenaScene(w, h) {
    const horizon = h * 0.42;
    const wallGrad = ctx.createLinearGradient(0, 0, 0, horizon);
    wallGrad.addColorStop(0, "#451a03");
    wallGrad.addColorStop(1, "#7c2d12");
    ctx.fillStyle = wallGrad;
    ctx.fillRect(0, 0, w, horizon);

    ctx.fillStyle = "#57534e";
    ctx.fillRect(0, 0, w * 0.08, horizon);
    ctx.fillRect(w * 0.92, 0, w * 0.08, horizon);
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, w * 0.08, horizon);
    ctx.strokeRect(w * 0.92, 0, w * 0.08, horizon);

    for (const tx of [w * 0.04, w * 0.96]) {
      const ty = horizon * 0.4;
      const glow = ctx.createRadialGradient(tx, ty, 0, tx, ty, 40);
      glow.addColorStop(0, "rgba(251,146,60,0.9)");
      glow.addColorStop(1, "rgba(251,146,60,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(tx, ty, 40, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#b91c1c";
    ctx.fillRect(w * 0.2, 0, 26, horizon * 0.7);
    ctx.fillRect(w * 0.76, 0, 26, horizon * 0.7);

    const floorGrad = ctx.createLinearGradient(0, horizon, 0, h);
    floorGrad.addColorStop(0, "#d6b58c");
    floorGrad.addColorStop(1, "#8a6d4b");
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, horizon, w, h - horizon);

    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.88, w * 0.42, h * 0.12, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawDesertScene(w, h) {
    const horizon = h * 0.5;
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizon);
    skyGrad.addColorStop(0, "#7c3aed");
    skyGrad.addColorStop(0.55, "#f97316");
    skyGrad.addColorStop(1, "#fde68a");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, horizon);

    const sunY = horizon * 0.8;
    const sunGlow = ctx.createRadialGradient(w * 0.5, sunY, 0, w * 0.5, sunY, 90);
    sunGlow.addColorStop(0, "rgba(254,240,138,0.95)");
    sunGlow.addColorStop(1, "rgba(254,240,138,0)");
    ctx.fillStyle = sunGlow;
    ctx.beginPath();
    ctx.arc(w * 0.5, sunY, 90, 0, Math.PI * 2);
    ctx.fill();

    const duneLayers = [
      { color: "#c2833f", topOffset: 0 },
      { color: "#a8672f", topOffset: 40 },
      { color: "#8a5223", topOffset: 90 },
    ];
    for (const layer of duneLayers) {
      const dy = horizon + layer.topOffset;
      ctx.beginPath();
      ctx.moveTo(0, dy + 30);
      ctx.quadraticCurveTo(w * 0.25, dy - 25, w * 0.5, dy + 5);
      ctx.quadraticCurveTo(w * 0.75, dy + 25, w, dy - 15);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = layer.color;
      ctx.fill();
    }
  }

  function drawCityScene(w, h) {
    const horizon = h * 0.62;
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizon);
    skyGrad.addColorStop(0, "#0f172a");
    skyGrad.addColorStop(1, "#334155");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, horizon);

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    for (let i = 0; i < 40; i++) {
      const sx = (i * 97) % w;
      const sy = (i * 53) % (horizon * 0.6);
      ctx.beginPath();
      ctx.arc(sx, sy, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    let bx = 0;
    let seed = 0;
    while (bx < w) {
      const bw = 40 + (seed % 5) * 12;
      const bh = 60 + (seed % 7) * 22;
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(bx, horizon - bh, bw, bh);
      ctx.fillStyle = "rgba(250,204,21,0.6)";
      for (let wy = horizon - bh + 8; wy < horizon - 6; wy += 14) {
        for (let wx = bx + 5; wx < bx + bw - 5; wx += 12) {
          if ((seed + wx + wy) % 3 === 0) {
            ctx.fillRect(wx, wy, 5, 7);
          }
        }
      }
      bx += bw + 4;
      seed++;
    }

    const floorGrad = ctx.createLinearGradient(0, horizon, 0, h);
    floorGrad.addColorStop(0, "#334155");
    floorGrad.addColorStop(1, "#0f172a");
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, horizon, w, h - horizon);

    ctx.strokeStyle = "rgba(250,204,21,0.5)";
    ctx.lineWidth = 4;
    ctx.setLineDash([20, 16]);
    ctx.beginPath();
    ctx.moveTo(0, h * 0.85);
    ctx.lineTo(w, h * 0.85);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draws the chosen scene first, then composites just the player on top of it
  // (via the segmentation cutout) instead of their real room. Falls back to a
  // dimmed full camera view if segmentation isn't available yet or failed to load.
  function drawBackground(video, personCutout, theme) {
    const w = canvas.width;
    const h = canvas.height;

    if (theme === "desert") drawDesertScene(w, h);
    else if (theme === "city") drawCityScene(w, h);
    else if (theme === "battlefield") drawBattlefieldScene(w, h);
    else drawArenaScene(w, h);

    if (personCutout) {
      ctx.drawImage(personCutout, 0, 0, w, h);
    } else if (video && video.readyState >= 2) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
    }

    const spot = ctx.createRadialGradient(w / 2, h * 0.5, h * 0.58, w / 2, h * 0.5, h * 0.9);
    spot.addColorStop(0, "rgba(0,0,0,0)");
    spot.addColorStop(1, "rgba(0,0,0,0.32)");
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, w, h);
  }

  // Renders the 3D character layer (separate transparent canvas, stacked above
  // the background and below the fx overlay). Computes this frame's screen-shake
  // once so the 3D layer and the fx overlay below shake in lockstep.
  function draw3D() {
    frameShakeX = shake > 0.5 ? (Math.random() - 0.5) * shake : 0;
    frameShakeY = shake > 0.5 ? (Math.random() - 0.5) * shake : 0;
    fighter3d.render(opponents, canvas.width, canvas.height, frameShakeX, frameShakeY);
  }

  // fx overlay: name/health bars, hand/foot tracking indicators, particles,
  // floating text, and the player's HP bar. Drawn on its own transparent
  // canvas above the 3D layer so text and sparks never get hidden behind a body.
  function draw(landmarks) {
    const fx = fxCtx;
    fx.clearRect(0, 0, canvas.width, canvas.height);

    fx.save();
    if (shake > 0.5) fx.translate(frameShakeX, frameShakeY);

    for (const o of opponents) {
      if (o.phase === "dying") continue;
      const barW = o.isBoss ? 240 : 150;
      const barH = 14;
      const bx = o.x - barW / 2;
      const by = o.y - HEAD_TOP_OFFSET - 34;
      fx.textAlign = "center";
      fx.fillStyle = o.isBoss ? "#fbbf24" : "#fff";
      fx.font = `bold ${o.isBoss ? 18 : 14}px system-ui, sans-serif`;
      fx.fillText(o.isBoss ? `★ ${o.name} ★` : o.name, o.x, by - 8);

      fx.fillStyle = "rgba(15,23,42,0.7)";
      fx.fillRect(bx, by, barW, barH);
      fx.fillStyle = "#ef4444";
      fx.fillRect(bx, by, barW * Math.max(0, o.health / o.maxHealth), barH);
      fx.strokeStyle = "rgba(255,255,255,0.5)";
      fx.lineWidth = 1;
      fx.strokeRect(bx, by, barW, barH);

      if (o.phase === "telegraph") {
        fx.fillStyle = "#fbbf24";
        fx.font = "bold 16px system-ui, sans-serif";
        const label =
          o.attackType === "kick" ? (o.kickHeight === "head" ? "HIGH KICK!" : "KICK!") : "PUNCH!";
        fx.fillText(label, o.x, by - (o.isBoss ? 30 : 26));
      }
    }

    for (const hand of [hands.left, hands.right]) {
      if (!hand.pos) continue;
      fx.beginPath();
      fx.arc(hand.pos.x, hand.pos.y, 24, 0, Math.PI * 2);
      fx.fillStyle = hand.cooldown > 0 ? "rgba(96,165,250,0.25)" : "rgba(96,165,250,0.45)";
      fx.fill();
      fx.lineWidth = 3;
      fx.strokeStyle = "#60a5fa";
      fx.stroke();
    }

    for (const foot of [feet.left, feet.right]) {
      if (!foot.pos) continue;
      fx.beginPath();
      fx.arc(foot.pos.x, foot.pos.y, 22, 0, Math.PI * 2);
      fx.fillStyle = foot.cooldown > 0 ? "rgba(74,222,128,0.25)" : "rgba(74,222,128,0.45)";
      fx.fill();
      fx.lineWidth = 3;
      fx.strokeStyle = "#4ade80";
      fx.stroke();
    }

    for (const p of particles) {
      fx.globalAlpha = p.life / p.maxLife;
      fx.beginPath();
      fx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      fx.fillStyle = p.color;
      fx.fill();
      fx.globalAlpha = 1;
    }

    for (const f of floaters) {
      fx.globalAlpha = Math.min(1, f.life / 20);
      fx.fillStyle = f.color;
      fx.font = "bold 20px system-ui, sans-serif";
      fx.textAlign = "center";
      fx.fillText(f.text, f.x, f.y);
      fx.globalAlpha = 1;
    }

    fx.restore();

    if (hitFlashScreen > 0) {
      fx.fillStyle = `rgba(239,68,68,${hitFlashScreen * 0.35})`;
      fx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const pw = canvas.width * 0.5;
    const ph = 20;
    const px = (canvas.width - pw) / 2;
    const py = canvas.height - 40;
    fx.fillStyle = "rgba(15,23,42,0.7)";
    fx.fillRect(px, py, pw, ph);
    fx.fillStyle = "#4ade80";
    fx.fillRect(px, py, pw * Math.max(0, player.health / player.maxHealth), ph);
    fx.strokeStyle = "rgba(255,255,255,0.5)";
    fx.strokeRect(px, py, pw, ph);
    fx.fillStyle = "#fff";
    fx.textAlign = "center";
    fx.font = "bold 14px system-ui, sans-serif";
    fx.fillText(`HP ${Math.ceil(player.health)}/${player.maxHealth}`, canvas.width / 2, py + 15);

    // Temporary calibration aid: marks where characters' feet are pinned to
    // (groundBaselineY() is derived from this same line). Ask to remove once
    // floor position is confirmed correct.
    const floorY = canvas.height - FLOOR_LINE_MARGIN;
    fx.strokeStyle = "#ef4444";
    fx.lineWidth = 2;
    fx.beginPath();
    fx.moveTo(0, floorY);
    fx.lineTo(canvas.width, floorY);
    fx.stroke();

    drawFaceEmoji(fx, landmarks, canvas.width, canvas.height);
  }

  function isOver() {
    return over;
  }

  function getOverResult() {
    return lastResult;
  }

  function getHud() {
    const waveLabel = player.waveIndex === 1 ? "BOSS FIGHT" : `Army ${opponents.length} left`;
    const weakTag = player.easyKillsRemaining > 0 ? `  ⚡ ${player.easyKillsRemaining} left` : "";
    return {
      left: `🪙 ${player.coins}   ⚡ Lv.${player.level}   🏟️ Stage ${player.stage} · ${waveLabel}${weakTag}`,
      right: `💥 ${player.damage}`,
    };
  }

  function getPauseInfo() {
    return {
      coins: player.coins,
      options: [
        {
          id: "health",
          label: "Upgrade Max Health +20",
          cost: upgradeCost(player.healthUpgrades),
        },
        {
          id: "damage",
          label: "Upgrade Damage +4",
          cost: upgradeCost(player.damageUpgrades),
        },
      ],
    };
  }

  function applyUpgrade(id) {
    if (id === "health") {
      const cost = upgradeCost(player.healthUpgrades);
      if (player.coins < cost) return false;
      player.coins -= cost;
      player.healthUpgrades += 1;
      player.maxHealth += 20;
      player.health = Math.min(player.maxHealth, player.health + 20);
      player.easyKillsRemaining = WEAKENED_KILL_WINDOW;
      save();
      return true;
    }
    if (id === "damage") {
      const cost = upgradeCost(player.damageUpgrades);
      if (player.coins < cost) return false;
      player.coins -= cost;
      player.damageUpgrades += 1;
      player.damage += 4;
      player.easyKillsRemaining = WEAKENED_KILL_WINDOW;
      save();
      return true;
    }
    return false;
  }

  return {
    id: "fighter",
    title: "Fist Fighter",
    thumbnail: "fist-fighter-thumb.png",
    description:
      "Punch and kick your way through an army and a boss, tracked live by your camera. Earn coins, upgrade your stats, and pick your own battle scene.",
    reset,
    update,
    draw,
    draw3D,
    drawBackground,
    needsPersonCutout: true,
    isOver,
    getHud,
    getOverResult,
    getPauseInfo,
    applyUpgrade,
    save,
    resetProgress,
    primeAudio,
    testSound,
  };
}
