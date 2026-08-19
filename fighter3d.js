import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js";

// Procedural humanoid rig: capsule limbs + box torso + sphere head, jointed with
// nested pivots so each limb rotates like a real bone. No downloaded assets.
//
// Coordinate convention: an opponent's game-logic position (o.x, o.y) is the
// canvas-pixel location of their chest/center (same value used for hit detection
// in fighterGame.js). The camera below is orthographic and mapped 1:1 to canvas
// pixels, so 3D world (x, y) == 2D canvas pixel (x, y) with no projection math
// needed elsewhere in the game.
export const HEAD_TOP_OFFSET = 136; // canvas px above o.y where the top of the head sits
export const FEET_OFFSET = 168; // canvas px below o.y where the feet/ground sit (matches leg chain length below)
export const HEAD_RADIUS = 24;
const HEAD_Y = -112; // local y of head center (neck raises it well clear of the torso)
export const HEAD_CENTER_OFFSET = -HEAD_Y; // canvas px above o.y where the head's center sits

// Joint rotation sign for "reaches toward the camera" vs "pulled back", now that
// bones correctly hang along +Y (down) by default: positive X-rotation swings a
// limb toward the viewer, negative pulls it back. Flip to -1 if that ever proves wrong.
const REACH_SIGN = 1;

const OUTFIT_BULK = { soldier: 1, knight: 1.14, tribal: 0.92, mercenary: 0.97, ninja: 0.94, commander: 1.2 };
const LERP = 0.25;

function colorsForOpponent(o) {
  let uniform = o.uniformColor;
  if (o.outfit === "knight" || o.outfit === "commander") uniform = "#8b8f99";
  else if (o.outfit === "ninja") uniform = "#18181b";
  else if (o.outfit === "tribal") uniform = o.skinTone;
  return { uniform, skin: o.skinTone, gear: o.gearColor };
}

function addBone(parent, offsetX, offsetY, length, radius, material) {
  const pivot = new THREE.Group();
  pivot.position.set(offsetX, offsetY, 0);
  parent.add(pivot);

  // Positive y = down (matches the canvas-pixel convention used everywhere else
  // in this game), so a bone hangs DOWN from its pivot by moving toward +y.
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), material);
  mesh.position.y = length / 2 + radius;
  pivot.add(mesh);

  const end = new THREE.Group();
  end.position.y = length + radius * 2;
  pivot.add(end);

  return { pivot, end };
}

function buildRig(colors, bulk) {
  const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05 });
  const uniformMat = mat(colors.uniform);
  const skinMat = mat(colors.skin);
  const gearMat = mat(colors.gear);

  const fallPivot = new THREE.Group();
  fallPivot.scale.setScalar(bulk);

  const characterGroup = new THREE.Group();
  characterGroup.position.set(0, -FEET_OFFSET, 0);
  fallPivot.add(characterGroup);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(46, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, FEET_OFFSET - 4, 0);
  characterGroup.add(shadow);

  const torsoTop = -74;

  const torso = new THREE.Mesh(new THREE.BoxGeometry(56, 92, 32), uniformMat);
  torso.position.set(0, -28, 0);
  characterGroup.add(torso);

  // Neck: without this the head sits directly on the shoulders and reads as
  // a primate silhouette instead of a person. Spans torso top up to the head.
  const neckBottom = torsoTop;
  const neckTop = HEAD_Y + HEAD_RADIUS;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(7, 8, neckBottom - neckTop, 12), skinMat);
  neck.position.set(0, (neckBottom + neckTop) / 2, 0);
  characterGroup.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_RADIUS, 20, 16), skinMat);
  head.position.set(0, HEAD_Y, 0);
  characterGroup.add(head);

  const earGeo = new THREE.SphereGeometry(6, 10, 8);
  const earL = new THREE.Mesh(earGeo, skinMat);
  earL.position.set(-(HEAD_RADIUS - 3), HEAD_Y, 0);
  earL.scale.set(0.5, 1, 0.65);
  const earR = earL.clone();
  earR.position.x = HEAD_RADIUS - 3;
  characterGroup.add(earL, earR);

  const eyeGeo = new THREE.SphereGeometry(2.6, 8, 8);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1c1917 });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-8, HEAD_Y - 3, 20);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(8, HEAD_Y - 3, 20);
  characterGroup.add(eyeL, eyeR);

  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(11, 2.2, 2),
    new THREE.MeshBasicMaterial({ color: 0x8a4a3a })
  );
  mouth.position.set(0, HEAD_Y + 9, 20);
  characterGroup.add(mouth);

  const shoulderL = new THREE.Group();
  shoulderL.position.set(-32, -58, 0);
  characterGroup.add(shoulderL);
  const upperArmL = addBone(shoulderL, 0, 0, 34, 9, uniformMat);
  const lowerArmL = addBone(upperArmL.end, 0, 0, 30, 7.5, skinMat);
  const handL = new THREE.Mesh(new THREE.SphereGeometry(9, 10, 8), gearMat);
  handL.scale.set(0.85, 1.15, 0.75);
  lowerArmL.end.add(handL);

  const shoulderR = new THREE.Group();
  shoulderR.position.set(32, -58, 0);
  characterGroup.add(shoulderR);
  const upperArmR = addBone(shoulderR, 0, 0, 34, 9, uniformMat);
  const lowerArmR = addBone(upperArmR.end, 0, 0, 30, 7.5, skinMat);
  const handR = new THREE.Mesh(new THREE.SphereGeometry(9, 10, 8), gearMat);
  handR.scale.set(0.85, 1.15, 0.75);
  lowerArmR.end.add(handR);

  const hipL = new THREE.Group();
  hipL.position.set(-16, 40, 0);
  characterGroup.add(hipL);
  const upperLegL = addBone(hipL, 0, 0, 46, 11, uniformMat);
  const lowerLegL = addBone(upperLegL.end, 0, 0, 42, 9, uniformMat);
  const footL = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 30), gearMat);
  footL.position.z = 6;
  lowerLegL.end.add(footL);

  const hipR = new THREE.Group();
  hipR.position.set(16, 40, 0);
  characterGroup.add(hipR);
  const upperLegR = addBone(hipR, 0, 0, 46, 11, uniformMat);
  const lowerLegR = addBone(upperLegR.end, 0, 0, 42, 9, uniformMat);
  const footR = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 30), gearMat);
  footR.position.z = 6;
  lowerLegR.end.add(footR);

  return {
    fallPivot,
    characterGroup,
    torso,
    head,
    upperArmL: upperArmL.pivot,
    lowerArmL: lowerArmL.pivot,
    upperArmR: upperArmR.pivot,
    lowerArmR: lowerArmR.pivot,
    upperLegL: upperLegL.pivot,
    lowerLegL: lowerLegL.pivot,
    upperLegR: upperLegR.pivot,
    lowerLegR: lowerLegR.pivot,
  };
}

function lerpRotX(obj, target) {
  obj.rotation.x += (target - obj.rotation.x) * LERP;
}

function lerpRotZ(obj, target) {
  obj.rotation.z += (target - obj.rotation.z) * LERP;
}

function setGroupOpacity(group, opacity) {
  group.traverse((child) => {
    if (child.material) {
      child.material.transparent = true;
      child.material.opacity = opacity;
    }
  });
}

function poseRig(rig, o) {
  // Ready fighting stance: fists up near the chin, a slight forward-leg stagger,
  // instead of arms hanging fully relaxed at the sides.
  let armL = 0.2;
  let armR = 0.2;
  let elbowL = 1.4;
  let elbowR = 1.4;
  let legL = 0.02;
  let legR = 0.08;
  let kneeL = 0.08;
  let kneeR = 0.05;
  let legZL = 0;
  let legZR = 0;
  let bodyTwist = 0;

  if (o.attackType === "punch") {
    const isLeft = o.attackSide === "left";
    const side = isLeft ? -1 : 1;
    if (o.phase === "telegraph") {
      const v = -REACH_SIGN;
      if (isLeft) {
        armL = v * 1.0;
        elbowL = 1.6;
      } else {
        armR = v * 1.0;
        elbowR = 1.6;
      }
      bodyTwist = -side * 0.12; // wind up away from the punch
    } else if (o.phase === "strike" || o.phase === "recover") {
      const t = o.phase === "strike" ? 1 : 0.35;
      const v = REACH_SIGN * 1.3 * t;
      if (isLeft) {
        armL = v;
        elbowL = 0.15;
      } else {
        armR = v;
        elbowR = 0.15;
      }
      bodyTwist = side * 0.25 * t; // hips/shoulders rotate into the punch
    }
  } else if (o.attackType === "kick") {
    // Roundhouse-style kick: the leg chambers out to the side (knee up and out),
    // then sweeps across the body in an arc as it extends, with the hips
    // rotating through the kick — not a straight front-kick thrust.
    const isLeft = o.attackSide === "left";
    const side = isLeft ? -1 : 1;
    // kickHeight ("chest" by default, sometimes "head") set by fighterGame.js
    // when the attack is chosen — controls how far the hip swings the leg up.
    const highKick = o.kickHeight === "head";
    if (o.phase === "telegraph") {
      const liftMag = highKick ? 1.3 : 1.0;
      const liftX = -REACH_SIGN * liftMag;
      const sweepOutZ = -side * 0.65;
      if (isLeft) {
        legL = liftX;
        kneeL = 1.5;
        legZL = sweepOutZ;
      } else {
        legR = liftX;
        kneeR = 1.5;
        legZR = sweepOutZ;
      }
      bodyTwist = -side * 0.18; // chamber: torso winds away from the kick
    } else if (o.phase === "strike" || o.phase === "recover") {
      const t = o.phase === "strike" ? 1 : 0.35;
      const extendMag = highKick ? 2.0 : 1.5; // 1.5 rad reaches chest height, 2.0 rad reaches toward the head
      const extendX = REACH_SIGN * extendMag * t;
      const sweepAcrossZ = side * 0.4 * t;
      if (isLeft) {
        legL = extendX;
        kneeL = 0.2;
        legZL = sweepAcrossZ;
      } else {
        legR = extendX;
        kneeR = 0.2;
        legZR = sweepAcrossZ;
      }
      bodyTwist = side * 0.4 * t; // hips whip through the kick
    }
  }

  lerpRotX(rig.upperArmL, armL);
  lerpRotX(rig.lowerArmL, elbowL);
  lerpRotX(rig.upperArmR, armR);
  lerpRotX(rig.lowerArmR, elbowR);
  lerpRotX(rig.upperLegL, legL);
  lerpRotX(rig.lowerLegL, kneeL);
  lerpRotX(rig.upperLegR, legR);
  lerpRotX(rig.lowerLegR, kneeR);
  lerpRotZ(rig.upperLegL, legZL);
  lerpRotZ(rig.upperLegR, legZR);

  rig.fallPivot.position.set(o.x, o.y + FEET_OFFSET + Math.sin(o.bob) * 4, 0);
  rig.characterGroup.rotation.y = (o.lookOffset || 0) * 0.5 + bodyTwist;

  if (o.phase === "dying") {
    const fallProgress = 1 - Math.max(0, o.dyingTimer) / 700;
    rig.fallPivot.rotation.z = fallProgress * (Math.PI / 2 + 0.15) * o.fallSide;
    setGroupOpacity(rig.characterGroup, Math.max(0.15, 1 - fallProgress * 0.6));
  } else {
    rig.fallPivot.rotation.z = 0;
  }

  const flash = Math.min(1, (o.hitFlash || 0) / 150);
  rig.torso.material.emissive.setScalar(flash * 0.7);
  rig.head.material.emissive.setScalar(flash * 0.7);
}

export function createFighter3D(canvasEl) {
  let renderer = null;
  let webglOk = true;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvasEl, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  } catch (err) {
    console.warn("WebGL unavailable, 3D characters disabled:", err);
    webglOk = false;
  }

  const scene = new THREE.Scene();
  const sceneRoot = new THREE.Group();
  scene.add(sceneRoot);

  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, 1, 3000);
  camera.position.z = 1000;

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const keyLight = new THREE.DirectionalLight(0xfff4e0, 0.9);
  keyLight.position.set(150, -400, 600);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x88aaff, 0.35);
  rimLight.position.set(-200, 300, -300);
  scene.add(rimLight);

  let lastW = 0;
  let lastH = 0;
  const rigs = new Map();

  function ensureSize(width, height) {
    if (!width || !height || (width === lastW && height === lastH)) return;
    lastW = width;
    lastH = height;
    camera.left = 0;
    camera.right = width;
    camera.top = 0;
    camera.bottom = height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function disposeRig(rig) {
    rig.fallPivot.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    sceneRoot.remove(rig.fallPivot);
  }

  function render(opponents, width, height, shakeX = 0, shakeY = 0) {
    if (!webglOk) return;
    ensureSize(width, height);
    sceneRoot.position.set(shakeX, shakeY, 0);

    const live = new Set(opponents);
    for (const [o, rig] of rigs) {
      if (!live.has(o)) {
        disposeRig(rig);
        rigs.delete(o);
      }
    }

    for (const o of opponents) {
      let rig = rigs.get(o);
      if (!rig) {
        const bulk = OUTFIT_BULK[o.outfit] ?? 1;
        rig = buildRig(colorsForOpponent(o), bulk);
        sceneRoot.add(rig.fallPivot);
        rigs.set(o, rig);
      }
      poseRig(rig, o);
    }

    renderer.render(scene, camera);
  }

  return { render };
}
