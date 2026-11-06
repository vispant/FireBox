// Nova Strike -- an original first-person sci-fi arena shooter. Real 3D via
// Three.js (same pinned version already used by fighter3d.js), rendered into
// the shared threeCanvas layer. Original robot enemy designs, original
// arena, no third-party IP referenced.
//
// Design mirrors Blaster Rush's proven "auto-fire" core loop (see
// blasterGame.js) but in first person: instead of auto-firing at the nearest
// enemy anywhere on screen, the gun auto-fires at the nearest enemy within a
// forward-facing cone -- so aiming (via mouse-look / touch-look) is still
// the actual skill, it's just assisted rather than needing pixel-precise
// hitscan clicks. This keeps mouse+keyboard and touch controls identical in
// what they ask of the player: move, and look toward threats.

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js";
import { EffectComposer } from "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/postprocessing/OutputPass.js";
import { getRenderScale } from "./renderScale.js?v=1";

const SAVE_KEY = "fireBox.novaStrike.save.v1";
const BEST_SCORE_KEY = "fireBox.novaStrike.bestScore.v1";
const MAX_UPGRADE_LEVEL = 3;

const ARENA_RADIUS = 22;
const PLAYER_EYE_HEIGHT = 1.7;
const PLAYER_SPEED = 7.2;
const PLAYER_ACCEL = 46;
const PLAYER_RADIUS = 0.6;
const PLAYER_MAX_LIVES = 3;
const INVINCIBLE_DURATION = 1.1;

const FIRE_RANGE = 27;
const WAVE_DURATION = 18;
const MOUSE_SENSITIVITY = 0.0022;
const TOUCH_LOOK_SENSITIVITY = 0.0052;
const PITCH_LIMIT = Math.PI / 2 - 0.05;

const ENEMY_TYPES = {
  drone: { radius: 0.45, hp: 1, speed: 3.3, points: 10, coinChance: 0.5, color: 0x38bdf8, eye: 0xe0f7ff, hoverSpeed: 3.4 },
  sentry: { radius: 0.62, hp: 2, speed: 2.3, points: 20, coinChance: 0.6, color: 0xfbbf24, eye: 0xfff3d6, hoverSpeed: 2.1 },
  titan: { radius: 0.95, hp: 4, speed: 1.35, points: 40, coinChance: 0.9, color: 0xa855f7, eye: 0xf3e8ff, hoverSpeed: 1.4 },
};

function loadSaveData() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { coins: 0, rapidFireLevel: 0, extraLifeLevel: 0, wideScanLevel: 0 };
    const parsed = JSON.parse(raw);
    return {
      coins: parsed.coins || 0,
      rapidFireLevel: parsed.rapidFireLevel || 0,
      extraLifeLevel: parsed.extraLifeLevel || 0,
      wideScanLevel: parsed.wideScanLevel || 0,
    };
  } catch {
    return { coins: 0, rapidFireLevel: 0, extraLifeLevel: 0, wideScanLevel: 0 };
  }
}
function writeSaveData(saveData) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
  } catch {}
}
function upgradeCost(level) {
  return 30 + level * 35;
}
function rand(min, max) {
  return min + Math.random() * (max - min);
}

export function createNovaStrikeGame({ canvas, threeCanvas, fxCanvas, fxCtx }) {
  let saveData = loadSaveData();
  let best = 0;
  try {
    best = Number(localStorage.getItem(BEST_SCORE_KEY)) || 0;
  } catch {}

  const isTouchDevice = (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || navigator.maxTouchPoints > 0;

  // ---- Three.js scene (built once, reused across runs) ----
  let webglOk = true;
  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
  } catch (err) {
    console.warn("WebGL unavailable, Nova Strike cannot render.", err);
    webglOk = false;
  }

  const scene = webglOk ? new THREE.Scene() : null;
  if (scene) {
    scene.background = new THREE.Color(0x060a14);
    scene.fog = new THREE.FogExp2(0x060a14, 0.045);
  }

  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
  camera.rotation.order = "YXZ";

  let composer = null;
  let bloomOk = false;
  if (webglOk) {
    try {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.38, 0.3, 0.82);
      composer.addPass(bloomPass);
      composer.addPass(new OutputPass());
      bloomOk = true;
    } catch (err) {
      console.warn("Bloom post-processing unavailable, using plain rendering.", err);
      bloomOk = false;
      composer = null;
    }
  }

  function buildArena() {
    const group = new THREE.Group();

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_RADIUS, 48),
      new THREE.MeshStandardMaterial({ color: 0x0c1322, metalness: 0.35, roughness: 0.6 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    group.add(floor);

    const ringGeo = new THREE.TorusGeometry(1, 0.025, 6, 24);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x0e7490, emissive: 0x0ea5c9, emissiveIntensity: 0.5, metalness: 0.3, roughness: 0.5 });
    for (let r = 4; r <= ARENA_RADIUS; r += 4) {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.scale.set(r, r, 1);
      ring.position.y = 0.01;
      group.add(ring);
    }

    const pillarCount = 10;
    const pillarGeo = new THREE.CylinderGeometry(0.4, 0.5, 3.4, 8);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.5, roughness: 0.45 });
    const capGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.18, 8);
    const capMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    for (let i = 0; i < pillarCount; i++) {
      const a = (Math.PI * 2 * i) / pillarCount;
      const px = Math.cos(a) * (ARENA_RADIUS + 1.6);
      const pz = Math.sin(a) * (ARENA_RADIUS + 1.6);
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(px, 1.7, pz);
      pillar.castShadow = true;
      group.add(pillar);
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(px, 3.5, pz);
      group.add(cap);
    }

    return group;
  }

  function buildEnemyMesh(type) {
    const def = ENEMY_TYPES[type];
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.35, metalness: 0.4, roughness: 0.35 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: def.eye });

    let body;
    if (type === "drone") {
      body = new THREE.Mesh(new THREE.IcosahedronGeometry(def.radius, 0), bodyMat);
    } else if (type === "sentry") {
      body = new THREE.Mesh(new THREE.CylinderGeometry(def.radius * 0.8, def.radius, def.radius * 1.9, 8), bodyMat);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(def.radius * 0.95, 0.05, 6, 16), eyeMat);
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
    } else {
      body = new THREE.Mesh(new THREE.BoxGeometry(def.radius * 1.7, def.radius * 1.7, def.radius * 1.7), bodyMat);
      const spikeGeo = new THREE.ConeGeometry(0.14, 0.4, 5);
      for (let i = 0; i < 4; i++) {
        const spike = new THREE.Mesh(spikeGeo, bodyMat);
        const sx = i < 2 ? def.radius * 0.9 : -def.radius * 0.9;
        const sz = i % 2 === 0 ? def.radius * 0.9 : -def.radius * 0.9;
        spike.position.set(sx, def.radius * 0.6, sz);
        group.add(spike);
      }
    }
    body.castShadow = true;
    group.add(body);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(def.radius * 0.22, 10, 10), eyeMat);
    eye.position.set(0, 0, def.radius * 0.95);
    group.add(eye);

    group.userData.baseY = type === "titan" ? 1.0 : 1.2;
    group.position.y = group.userData.baseY;
    return group;
  }

  // ---- weapon view-model (child of the camera) ----
  const weaponGroup = new THREE.Group();
  const weaponMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.6, roughness: 0.3 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x0f766e, emissive: 0x2dd4bf, emissiveIntensity: 0.7, metalness: 0.2, roughness: 0.4 });
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.38), weaponMat);
  gunBody.position.set(0, 0, 0);
  weaponGroup.add(gunBody);
  const gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.26, 8), weaponMat);
  gunBarrel.rotation.x = Math.PI / 2;
  gunBarrel.position.set(0, 0.01, -0.3);
  weaponGroup.add(gunBarrel);
  const gunStripe = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.018, 0.2), accentMat);
  gunStripe.position.set(0, 0.062, 0.02);
  weaponGroup.add(gunStripe);
  const muzzleTip = new THREE.Object3D();
  muzzleTip.position.set(0, 0.01, -0.46);
  weaponGroup.add(muzzleTip);
  weaponGroup.position.set(0.24, -0.2, -0.85);
  camera.add(weaponGroup);
  if (scene) scene.add(camera);

  const muzzleFlash = new THREE.PointLight(0x7dd3fc, 0, 4);
  weaponGroup.add(muzzleFlash);

  // ---- lighting ----
  if (scene) {
    scene.add(new THREE.AmbientLight(0x334155, 0.55));
    const key = new THREE.DirectionalLight(0xdbeafe, 0.9);
    key.position.set(10, 16, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -ARENA_RADIUS - 4;
    key.shadow.camera.right = ARENA_RADIUS + 4;
    key.shadow.camera.top = ARENA_RADIUS + 4;
    key.shadow.camera.bottom = -ARENA_RADIUS - 4;
    key.shadow.camera.far = 40;
    scene.add(key);
    const rim = new THREE.PointLight(0x38bdf8, 0.6, 30);
    rim.position.set(0, 6, 0);
    scene.add(rim);
    scene.add(buildArena());
  }

  const tracers = []; // { mesh, life, max }
  const shards = []; // { mesh, vel, life, max }
  const enemyGroup = scene ? new THREE.Group() : null;
  if (scene) scene.add(enemyGroup);

  // ---- player / run state ----
  let yaw = 0;
  let pitch = 0;
  let playerPos = new THREE.Vector3(0, PLAYER_EYE_HEIGHT, 10);
  let velX = 0;
  let velZ = 0;
  let lives = 1;
  let invincibleTimer = 0;
  let enemies = [];
  let fireCooldown = 0;
  let score = 0;
  let runCoins = 0;
  let wave = 1;
  let waveTimer = 0;
  let spawnTimer = 0;
  let waveBanner = 0;
  let hitFlash = 0;
  let damageFlash = 0;
  let bobTime = 0;
  let gameOver = true;
  let locked = false;

  const keys = { forward: false, back: false, left: false, right: false };
  function keyFor(code) {
    if (code === "KeyW" || code === "ArrowUp") return "forward";
    if (code === "KeyS" || code === "ArrowDown") return "back";
    if (code === "KeyA" || code === "ArrowLeft") return "left";
    if (code === "KeyD" || code === "ArrowRight") return "right";
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
  // Browsers are supposed to auto-release pointer lock when Escape is
  // pressed, but don't rely on that alone -- main.js's own Escape/P handler
  // opens the pause menu either way, and the player needs the real cursor
  // back to click anything in it. Releasing explicitly here means the pause
  // menu is always interactable the instant it opens, regardless of browser
  // quirks around the implicit unlock.
  window.addEventListener("keydown", (e) => {
    if ((e.key === "p" || e.key === "P" || e.key === "Escape") && document.pointerLockElement === canvas) {
      document.exitPointerLock();
    }
  });

  function applyLook(dYaw, dPitch) {
    yaw -= dYaw;
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch - dPitch));
  }

  document.addEventListener("mousemove", (e) => {
    if (gameOver || document.pointerLockElement !== canvas) return;
    applyLook(e.movementX * MOUSE_SENSITIVITY, e.movementY * MOUSE_SENSITIVITY);
  });
  document.addEventListener("pointerlockchange", () => {
    locked = document.pointerLockElement === canvas;
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (gameOver) return;
    if (e.pointerType === "mouse") {
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock().catch(() => {});
      }
      return;
    }
    // Touch: left half = movement joystick, right half = look drag.
    const rect = canvas.getBoundingClientRect();
    const isLeft = e.clientX - rect.left < rect.width / 2;
    const touch = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY };
    if (isLeft) touchMove = touch;
    else touchLook = touch;
  });
  let touchMove = null;
  let touchLook = null;
  canvas.addEventListener("pointermove", (e) => {
    if (gameOver) return;
    if (touchMove && e.pointerId === touchMove.id) {
      touchMove.lastX = e.clientX;
      touchMove.lastY = e.clientY;
    } else if (touchLook && e.pointerId === touchLook.id) {
      const dx = e.clientX - touchLook.lastX;
      const dy = e.clientY - touchLook.lastY;
      applyLook(dx * TOUCH_LOOK_SENSITIVITY, dy * TOUCH_LOOK_SENSITIVITY);
      touchLook.lastX = e.clientX;
      touchLook.lastY = e.clientY;
    }
  });
  function releaseTouch(e) {
    if (touchMove && e.pointerId === touchMove.id) touchMove = null;
    if (touchLook && e.pointerId === touchLook.id) touchLook = null;
  }
  window.addEventListener("pointerup", releaseTouch);
  window.addEventListener("pointercancel", releaseTouch);

  function fireConeHalfAngle() {
    return (26 + saveData.wideScanLevel * 5) * (Math.PI / 180);
  }
  function fireCooldownBase() {
    return Math.max(0.15, 0.4 - saveData.rapidFireLevel * 0.08);
  }

  function spawnEnemy() {
    const roll = Math.random();
    let type;
    if (wave >= 4 && roll < 0.2) type = "titan";
    else if (wave >= 2 && roll < 0.48) type = "sentry";
    else type = "drone";
    const def = ENEMY_TYPES[type];
    const a = rand(0, Math.PI * 2);
    const mesh = buildEnemyMesh(type);
    mesh.position.set(Math.cos(a) * ARENA_RADIUS, mesh.userData.baseY, Math.sin(a) * ARENA_RADIUS);
    enemyGroup.add(mesh);
    const speedMult = 1 + Math.min(0.75, (wave - 1) * 0.06);
    enemies.push({ type, mesh, hp: def.hp, speed: def.speed * speedMult, bob: rand(0, Math.PI * 2) });
  }

  function spawnShards(position, color, count) {
    const geo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(position);
      scene.add(mesh);
      const a = rand(0, Math.PI * 2);
      const up = rand(2, 5);
      const speed = rand(1.5, 4);
      shards.push({
        mesh,
        vel: new THREE.Vector3(Math.cos(a) * speed, up, Math.sin(a) * speed),
        life: 0.6,
        max: 0.6,
      });
    }
  }

  function fireTracer(from, to) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    dir.normalize();
    const geo = new THREE.CylinderGeometry(0.018, 0.018, len, 6, 1, true);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, len / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from);
    mesh.lookAt(to);
    scene.add(mesh);
    tracers.push({ mesh, life: 0.09, max: 0.09 });

    muzzleFlash.intensity = 3.2;
  }

  function reset() {
    yaw = 0;
    pitch = 0;
    playerPos.set(0, PLAYER_EYE_HEIGHT, 10);
    velX = 0;
    velZ = 0;
    camera.position.copy(playerPos);
    camera.rotation.set(0, 0, 0);
    lives = PLAYER_MAX_LIVES + saveData.extraLifeLevel;
    invincibleTimer = 0;
    for (const e of enemies) {
      enemyGroup.remove(e.mesh);
      e.mesh.traverse((c) => {
        if (c.geometry) c.geometry.dispose();
      });
    }
    enemies = [];
    for (const t of tracers) scene.remove(t.mesh);
    tracers.length = 0;
    for (const s of shards) scene.remove(s.mesh);
    shards.length = 0;
    fireCooldown = 0;
    score = 0;
    runCoins = 0;
    wave = 1;
    waveTimer = 0;
    spawnTimer = 0.6;
    waveBanner = 2;
    hitFlash = 0;
    damageFlash = 0;
    bobTime = 0;
    gameOver = false;
    keys.forward = keys.back = keys.left = keys.right = false;
    touchMove = null;
    touchLook = null;
  }

  function endRun() {
    gameOver = true;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    if (score > best) {
      best = score;
      try {
        localStorage.setItem(BEST_SCORE_KEY, String(best));
      } catch {}
    }
    saveData.coins += runCoins;
    writeSaveData(saveData);
  }

  function update(dt) {
    if (gameOver || !webglOk) return;
    dt = Math.min(dt / 1000, 0.05);

    camera.rotation.set(pitch, yaw, 0, "YXZ");

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3(forward.z, 0, -forward.x);

    let moveF = 0;
    let moveR = 0;
    if (touchMove) {
      const dx = touchMove.lastX - touchMove.startX;
      const dy = touchMove.lastY - touchMove.startY;
      const mag = Math.hypot(dx, dy);
      const JOY_RADIUS = 55;
      if (mag > 6) {
        const clamped = Math.min(1, mag / JOY_RADIUS);
        moveR = (dx / mag) * clamped;
        moveF = (-dy / mag) * clamped;
      }
    } else {
      if (keys.forward) moveF += 1;
      if (keys.back) moveF -= 1;
      if (keys.right) moveR += 1;
      if (keys.left) moveR -= 1;
      const mag = Math.hypot(moveF, moveR);
      if (mag > 1) {
        moveF /= mag;
        moveR /= mag;
      }
    }

    const targetVx = (forward.x * moveF + right.x * moveR) * PLAYER_SPEED;
    const targetVz = (forward.z * moveF + right.z * moveR) * PLAYER_SPEED;
    velX += Math.sign(targetVx - velX) * Math.min(Math.abs(targetVx - velX), PLAYER_ACCEL * dt);
    velZ += Math.sign(targetVz - velZ) * Math.min(Math.abs(targetVz - velZ), PLAYER_ACCEL * dt);
    playerPos.x += velX * dt;
    playerPos.z += velZ * dt;
    const distFromCenter = Math.hypot(playerPos.x, playerPos.z);
    const maxDist = ARENA_RADIUS - PLAYER_RADIUS;
    if (distFromCenter > maxDist) {
      playerPos.x = (playerPos.x / distFromCenter) * maxDist;
      playerPos.z = (playerPos.z / distFromCenter) * maxDist;
    }
    camera.position.set(playerPos.x, PLAYER_EYE_HEIGHT, playerPos.z);

    const moving = Math.hypot(velX, velZ) > 0.5;
    bobTime += dt * (moving ? 9 : 2.5);
    weaponGroup.position.y = -0.2 + (moving ? Math.sin(bobTime) * 0.015 : 0);
    weaponGroup.position.x = 0.24 + (moving ? Math.cos(bobTime * 0.5) * 0.008 : 0);

    // ---- waves ----
    waveTimer += dt;
    if (waveTimer >= WAVE_DURATION) {
      waveTimer = 0;
      wave += 1;
      waveBanner = 1.6;
    }
    if (waveBanner > 0) waveBanner -= dt;

    spawnTimer -= dt;
    const spawnInterval = Math.max(0.45, 1.4 - (wave - 1) * 0.09);
    if (spawnTimer <= 0) {
      spawnTimer = spawnInterval;
      spawnEnemy();
    }

    // ---- enemies move toward player, hover-bob ----
    const camForward = new THREE.Vector3();
    camera.getWorldDirection(camForward);
    for (const e of enemies) {
      const def = ENEMY_TYPES[e.type];
      const dx = playerPos.x - e.mesh.position.x;
      const dz = playerPos.z - e.mesh.position.z;
      const d = Math.hypot(dx, dz) || 1;
      e.mesh.position.x += (dx / d) * e.speed * dt;
      e.mesh.position.z += (dz / d) * e.speed * dt;
      e.bob += dt * def.hoverSpeed;
      e.mesh.position.y = e.mesh.userData.baseY + Math.sin(e.bob) * 0.12;
      e.mesh.lookAt(playerPos.x, e.mesh.position.y, playerPos.z);
    }

    // ---- auto-fire at nearest enemy within forward cone ----
    fireCooldown -= dt;
    if (fireCooldown <= 0 && enemies.length) {
      const coneCos = Math.cos(fireConeHalfAngle());
      let best_ = null;
      let bestD = FIRE_RANGE;
      for (const e of enemies) {
        const toEnemy = new THREE.Vector3().subVectors(e.mesh.position, camera.position);
        const d = toEnemy.length();
        if (d > FIRE_RANGE) continue;
        toEnemy.normalize();
        if (toEnemy.dot(camForward) < coneCos) continue;
        if (d < bestD) {
          bestD = d;
          best_ = e;
        }
      }
      if (best_) {
        const def = ENEMY_TYPES[best_.type];
        const muzzleWorld = new THREE.Vector3();
        muzzleTip.getWorldPosition(muzzleWorld);
        fireTracer(muzzleWorld, best_.mesh.position);
        best_.hp -= 1;
        hitFlash = 0.15;
        if (best_.hp <= 0) {
          score += def.points;
          spawnShards(best_.mesh.position, def.color, 9);
          if (Math.random() < def.coinChance) runCoins += 1;
          enemyGroup.remove(best_.mesh);
          best_.mesh.traverse((c) => {
            if (c.geometry) c.geometry.dispose();
          });
          enemies = enemies.filter((e) => e !== best_);
        } else {
          spawnShards(best_.mesh.position, def.color, 3);
        }
        fireCooldown = fireCooldownBase();
      }
    }

    // ---- player-enemy collisions ----
    if (invincibleTimer > 0) invincibleTimer -= dt;
    else {
      for (const e of enemies) {
        const def = ENEMY_TYPES[e.type];
        const dx = playerPos.x - e.mesh.position.x;
        const dz = playerPos.z - e.mesh.position.z;
        if (Math.hypot(dx, dz) < def.radius + PLAYER_RADIUS) {
          lives -= 1;
          invincibleTimer = INVINCIBLE_DURATION;
          // No 3D shard burst here on purpose: the enemy is right on top of
          // the camera at the moment of collision, so particles spawned at
          // its position render as huge close-up blobs instead of a
          // satisfying burst. The red screen flash below is the feedback.
          damageFlash = 0.4;
          enemyGroup.remove(e.mesh);
          e.mesh.traverse((c) => {
            if (c.geometry) c.geometry.dispose();
          });
          enemies = enemies.filter((o) => o !== e);
          if (lives <= 0) endRun();
          break;
        }
      }
    }

    // ---- fx timers ----
    if (hitFlash > 0) hitFlash -= dt;
    if (damageFlash > 0) damageFlash -= dt;
    if (muzzleFlash.intensity > 0) muzzleFlash.intensity = Math.max(0, muzzleFlash.intensity - dt * 22);

    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / t.max) * 0.9;
      if (t.life <= 0) {
        scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        t.mesh.material.dispose();
        tracers.splice(i, 1);
      }
    }
    for (let i = shards.length - 1; i >= 0; i--) {
      const s = shards[i];
      s.life -= dt;
      s.vel.y -= 9 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.material.opacity = Math.max(0, s.life / s.max);
      if (s.life <= 0) {
        scene.remove(s.mesh);
        s.mesh.material.dispose();
        shards.splice(i, 1);
      }
    }
  }

  let lastW = 0;
  let lastH = 0;
  let lastRatio = 0;
  function ensureSize() {
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return;
    const ratio = getRenderScale();
    if (w === lastW && h === lastH && ratio === lastRatio) return;
    lastW = w;
    lastH = h;
    lastRatio = ratio;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    if (composer) composer.setSize(w, h);
  }

  function draw3D() {
    if (!webglOk) return;
    ensureSize();
    try {
      if (bloomOk && composer) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    } catch (err) {
      console.warn("Nova Strike render fallback (bloom disabled).", err);
      bloomOk = false;
      try {
        renderer.render(scene, camera);
      } catch {}
    }
  }

  function draw() {
    const w = canvas.width;
    const h = canvas.height;
    fxCtx.clearRect(0, 0, w, h);

    if (!webglOk) {
      fxCtx.fillStyle = "#f87171";
      fxCtx.font = "bold 20px system-ui, sans-serif";
      fxCtx.textAlign = "center";
      fxCtx.fillText("3D graphics unavailable on this device.", w / 2, h / 2);
      return;
    }

    if (damageFlash > 0) {
      fxCtx.fillStyle = `rgba(248, 113, 113, ${Math.min(0.4, damageFlash)})`;
      fxCtx.fillRect(0, 0, w, h);
    }

    // crosshair
    const cx = w / 2;
    const cy = h / 2;
    const size = hitFlash > 0 ? 14 : 10;
    fxCtx.strokeStyle = hitFlash > 0 ? "#fde68a" : "rgba(224, 242, 254, 0.85)";
    fxCtx.lineWidth = 2;
    fxCtx.beginPath();
    fxCtx.moveTo(cx - size, cy);
    fxCtx.lineTo(cx - 3, cy);
    fxCtx.moveTo(cx + 3, cy);
    fxCtx.lineTo(cx + size, cy);
    fxCtx.moveTo(cx, cy - size);
    fxCtx.lineTo(cx, cy - 3);
    fxCtx.moveTo(cx, cy + 3);
    fxCtx.lineTo(cx, cy + size);
    fxCtx.stroke();

    if (!gameOver && !isTouchDevice && document.pointerLockElement !== canvas) {
      fxCtx.fillStyle = "rgba(15, 23, 42, 0.6)";
      fxCtx.fillRect(w / 2 - 160, h - 70, 320, 44);
      fxCtx.fillStyle = "#e0f2fe";
      fxCtx.font = "bold 16px system-ui, sans-serif";
      fxCtx.textAlign = "center";
      fxCtx.fillText("Click to aim • Esc to pause", w / 2, h - 43);
    }

    if (waveBanner > 0) {
      fxCtx.save();
      fxCtx.globalAlpha = Math.min(1, waveBanner);
      fxCtx.fillStyle = "#fbbf24";
      fxCtx.font = "bold 36px system-ui, sans-serif";
      fxCtx.textAlign = "center";
      fxCtx.shadowColor = "rgba(0,0,0,0.6)";
      fxCtx.shadowBlur = 10;
      fxCtx.fillText(`Wave ${wave}`, w / 2, h * 0.22);
      fxCtx.restore();
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
      title: "Core Breach!",
      message: `${isBest ? "New best! " : ""}Score: ${score} (Best: ${best}) · Wave ${wave}  •  +${runCoins} coins earned`,
    };
  }

  function getPauseInfo() {
    const options = [];
    if (saveData.rapidFireLevel < MAX_UPGRADE_LEVEL) {
      options.push({ id: "rapid-fire", label: `Rapid Fire (Lv.${saveData.rapidFireLevel})`, cost: upgradeCost(saveData.rapidFireLevel) });
    }
    if (saveData.wideScanLevel < MAX_UPGRADE_LEVEL) {
      options.push({ id: "wide-scan", label: `Wide Scan (Lv.${saveData.wideScanLevel})`, cost: upgradeCost(saveData.wideScanLevel) });
    }
    if (saveData.extraLifeLevel < MAX_UPGRADE_LEVEL) {
      options.push({ id: "extra-life", label: `Extra Life (Lv.${saveData.extraLifeLevel})`, cost: upgradeCost(saveData.extraLifeLevel) });
    }
    return { coins: saveData.coins, options };
  }

  function applyUpgrade(id) {
    const levelKey = { "rapid-fire": "rapidFireLevel", "wide-scan": "wideScanLevel", "extra-life": "extraLifeLevel" }[id];
    if (!levelKey || saveData[levelKey] >= MAX_UPGRADE_LEVEL) return false;
    const cost = upgradeCost(saveData[levelKey]);
    if (saveData.coins < cost) return false;
    saveData.coins -= cost;
    saveData[levelKey] += 1;
    writeSaveData(saveData);
    return true;
  }

  function save() {
    writeSaveData(saveData);
  }

  return {
    id: "nova-strike",
    title: "Nova Strike",
    thumbnail: null,
    description: "A 3D first-person arena shooter. Move and look to line up threats — your blaster handles the rest. Mouse-look (click to aim) or touch.",
    reset,
    update,
    draw3D,
    draw,
    isOver,
    getHud,
    getOverResult,
    getPauseInfo,
    applyUpgrade,
    save,
  };
}
