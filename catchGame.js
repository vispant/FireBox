import { POSE, toCanvasCoords } from "./utils.js?v=5";

const HAND_RADIUS = 26;
const HAND_SPRITE_SRC = "Asset/hands.png";
const VISIBILITY_MIN = 0.4; // ignore a tracked point if the model isn't confident it's in frame
const COUNTDOWN_SECONDS = 3;

function loadSprite(src) {
  const img = new Image();
  const sprite = { img, loaded: false };
  img.onload = () => {
    sprite.loaded = true;
  };
  img.src = src;
  return sprite;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// The uploaded hand icon (Asset/hands.png) tracking each wrist. It's a single
// forward-facing hand, so the right side is horizontally mirrored to get a
// matching opposite hand instead of needing two separate images. A colored
// glow behind it (not a recolor of the icon itself, which would muddy its
// flat fill color) keeps left vs right easy to tell apart at a glance.
function drawHandSprite(ctx, sprite, x, y, side) {
  const baseColor = side === "left" ? "#60a5fa" : "#fb923c";
  const size = HAND_RADIUS * 2.5;
  const aspect = sprite.img.naturalHeight / sprite.img.naturalWidth;
  const w = size;
  const h = size * aspect;

  ctx.save();
  ctx.translate(x, y);
  if (side === "right") ctx.scale(-1, 1);

  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.85);
  glow.addColorStop(0, hexToRgba(baseColor, 0.35));
  glow.addColorStop(1, hexToRgba(baseColor, 0));
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.85, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  ctx.drawImage(sprite.img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

// Drawn cartoon glove/mitt fallback, used only if the hand sprite hasn't
// finished loading yet. Left/right get different colors so the two tracked
// hands stay easy to tell apart at a glance.
function drawHandGlove(ctx, x, y, side) {
  const baseColor = side === "left" ? "#60a5fa" : "#fb923c";
  const highlightColor = side === "left" ? "#dbeafe" : "#ffedd5";
  const shadeColor = side === "left" ? "#1d4ed8" : "#c2410c";
  const thumbSign = side === "left" ? -1 : 1;

  ctx.save();
  ctx.translate(x, y);

  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, HAND_RADIUS * 1.8);
  glow.addColorStop(0, hexToRgba(baseColor, 0.35));
  glow.addColorStop(1, hexToRgba(baseColor, 0));
  ctx.beginPath();
  ctx.arc(0, 0, HAND_RADIUS * 1.8, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  // thumb, drawn under the palm so the pair reads as a mitten silhouette
  const thumbX = thumbSign * HAND_RADIUS * 0.75;
  const thumbY = HAND_RADIUS * 0.15;
  ctx.beginPath();
  ctx.ellipse(thumbX, thumbY, HAND_RADIUS * 0.42, HAND_RADIUS * 0.3, thumbSign * 0.5, 0, Math.PI * 2);
  ctx.fillStyle = shadeColor;
  ctx.fill();

  const palmGrad = ctx.createRadialGradient(-HAND_RADIUS * 0.3, -HAND_RADIUS * 0.35, HAND_RADIUS * 0.15, 0, 0, HAND_RADIUS);
  palmGrad.addColorStop(0, highlightColor);
  palmGrad.addColorStop(0.55, baseColor);
  palmGrad.addColorStop(1, shadeColor);
  ctx.beginPath();
  ctx.arc(0, 0, HAND_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = palmGrad;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(-HAND_RADIUS * 0.32, -HAND_RADIUS * 0.32, HAND_RADIUS * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fill();

  ctx.restore();
}
const CATCHES_PER_LEVEL = 5;

function playSound(audio) {
  try {
    audio.currentTime = 0;
    audio.play().catch((err) => console.warn("Sound effect failed to play:", audio.src, err));
  } catch (err) {
    console.warn("Sound effect failed to play:", audio.src, err);
  }
}

export function createCatchGame({ canvas, ctx }) {
  const handSprite = loadSprite(HAND_SPRITE_SRC);

  const sfxPop = new Audio("balloon_pop.mp3");
  const sfxExplosion = new Audio("explosion_bomb.mp3");
  const sfxGameOver = new Audio("game_over.mp3");
  sfxPop.volume = 0.7;
  sfxExplosion.volume = 0.7;
  sfxGameOver.volume = 0.8;

  // Browsers only allow audio to autoplay if it's tied to a real click, and
  // catch/hit sounds fire later from inside the game loop, which doesn't
  // count. This unlocks both sounds the instant the player clicks Start.
  function primeAudio() {
    for (const audio of [sfxPop, sfxExplosion, sfxGameOver]) {
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

  let score, lives, level, objects, particles, floaters, spawnTimer, spawnInterval, shake, clouds;
  let handsReady, countdown;

  function reset() {
    score = 0;
    lives = 3;
    level = 1;
    objects = [];
    particles = [];
    floaters = [];
    spawnTimer = 0;
    spawnInterval = 1100;
    shake = 0;
    handsReady = false;
    countdown = 0;

    clouds = [];
    for (let i = 0; i < 6; i++) {
      clouds.push({
        x: Math.random() * canvas.width,
        y: 40 + Math.random() * (canvas.height * 0.35),
        scale: 0.6 + Math.random() * 0.8,
        speed: 0.15 + Math.random() * 0.25,
      });
    }
  }
  reset();

  function spawnObject() {
    const bombChance = Math.min(0.55, 0.25 + (level - 1) * 0.03);
    const isBomb = Math.random() < bombChance;
    const sizeShrink = Math.min(6, (level - 1) * 0.8);
    const speedBonus = (level - 1) * 0.35;
    objects.push({
      x: Math.random() * (canvas.width - 60) + 30,
      y: -30,
      vy: 2.2 + Math.random() * 1.5 + score * 0.02 + speedBonus,
      r: (isBomb ? 22 : 26) - sizeShrink,
      type: isBomb ? "bomb" : "orb",
      hit: false,
    });
  }

  function spawnBurst(x, y, color, count = 10) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const speed = 2 + Math.random() * 2;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: 3 + Math.random() * 2,
        color,
        life: 24,
        maxLife: 24,
      });
    }
  }

  function addFloater(x, y, text, color, big) {
    floaters.push({ x, y, text, color, big, life: 40, maxLife: 40 });
  }

  function handsVisible(landmarks) {
    if (!landmarks) return false;
    const isVisible = (l) => !!l && (l.visibility === undefined || l.visibility > VISIBILITY_MIN);
    return isVisible(landmarks[POSE.LEFT_WRIST]) && isVisible(landmarks[POSE.RIGHT_WRIST]);
  }

  function update(dt, landmarks) {
    // Gate the very start of a round on actually seeing both hands, so the
    // player isn't blindsided by balloons/bombs before they've even stepped
    // into frame. Only checked once per round -- handsReady stays true for
    // the rest of it even if a hand briefly leaves frame mid-game.
    if (!handsReady) {
      if (handsVisible(landmarks)) {
        handsReady = true;
        countdown = COUNTDOWN_SECONDS;
      }
      return;
    }
    if (countdown > 0) {
      countdown = Math.max(0, countdown - Math.min(dt, 50) / 1000);
      return;
    }

    spawnTimer += dt;
    if (spawnTimer > spawnInterval) {
      spawnTimer = 0;
      const minInterval = Math.max(220, 450 - (level - 1) * 20);
      spawnInterval = Math.max(minInterval, spawnInterval - 6);
      spawnObject();
    }

    shake = Math.max(0, shake - dt * 0.05);

    for (const c of clouds) {
      c.x += c.speed;
      if (c.x > canvas.width + 80) c.x = -80;
    }

    const hands = [];
    if (landmarks) {
      hands.push(toCanvasCoords(landmarks[POSE.LEFT_WRIST], canvas.width, canvas.height));
      hands.push(toCanvasCoords(landmarks[POSE.RIGHT_WRIST], canvas.width, canvas.height));
    }

    for (const obj of objects) {
      if (obj.hit) continue;
      obj.y += obj.vy;

      for (const hand of hands) {
        const dx = hand.x - obj.x;
        const dy = hand.y - obj.y;
        if (Math.hypot(dx, dy) < obj.r + HAND_RADIUS) {
          obj.hit = true;
          if (obj.type === "orb") {
            score += 1;
            spawnBurst(obj.x, obj.y, "#4ade80");
            addFloater(obj.x, obj.y - 10, "+1", "#4ade80");
            playSound(sfxPop);

            const newLevel = Math.floor(score / CATCHES_PER_LEVEL) + 1;
            if (newLevel > level) {
              level = newLevel;
              addFloater(canvas.width / 2, canvas.height * 0.35, `LEVEL ${level}!`, "#4ade80", true);
              shake = Math.max(shake, 10);
            }
          } else {
            lives -= 1;
            spawnBurst(obj.x, obj.y, "#ef4444");
            addFloater(obj.x, obj.y - 10, "-1 LIFE", "#ef4444");
            shake = Math.max(shake, 8);
            playSound(sfxExplosion);
            if (lives <= 0) playSound(sfxGameOver);
          }
          break;
        }
      }

      if (!obj.hit && obj.y - obj.r > canvas.height) {
        obj.hit = true;
      }
    }
    objects = objects.filter((o) => !o.hit);

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
  }

  function drawCloud(x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.arc(26, -8, 26, 0, Math.PI * 2);
    ctx.arc(52, 0, 20, 0, Math.PI * 2);
    ctx.arc(26, 10, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBackground() {
    const w = canvas.width;
    const h = canvas.height;

    const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
    skyGrad.addColorStop(0, "#38bdf8");
    skyGrad.addColorStop(1, "#bae6fd");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h);

    for (const c of clouds) {
      drawCloud(c.x, c.y, c.scale);
    }

    // No live camera feed / person cutout drawn here on purpose — the tracked
    // gloves (see drawHandGlove) are meant to stand in for the player's hands
    // instead of showing the player themselves.

    const spot = ctx.createRadialGradient(w / 2, h * 0.5, h * 0.6, w / 2, h * 0.5, h * 0.9);
    spot.addColorStop(0, "rgba(0,0,0,0)");
    spot.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, w, h);
  }

  function drawOrb(obj) {
    ctx.save();
    ctx.translate(obj.x, obj.y);

    // string + knot, so this reads as an actual balloon instead of a plain ball
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, obj.r * 1.05);
    ctx.quadraticCurveTo(obj.r * 0.4, obj.r * 1.5, 0, obj.r * 1.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-obj.r * 0.12, obj.r * 0.92);
    ctx.lineTo(obj.r * 0.12, obj.r * 0.92);
    ctx.lineTo(0, obj.r * 1.12);
    ctx.closePath();
    ctx.fillStyle = "#15803d";
    ctx.fill();

    // body — slightly taller than wide, like a real balloon
    const grad = ctx.createRadialGradient(-obj.r * 0.3, -obj.r * 0.35, obj.r * 0.1, 0, 0, obj.r);
    grad.addColorStop(0, "#dcfce7");
    grad.addColorStop(0.5, "#4ade80");
    grad.addColorStop(1, "#15803d");
    ctx.beginPath();
    ctx.ellipse(0, 0, obj.r * 0.92, obj.r * 1.08, 0, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(-obj.r * 0.32, -obj.r * 0.38, obj.r * 0.18, obj.r * 0.26, -0.4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fill();

    ctx.restore();
  }

  function drawBomb(obj) {
    ctx.save();
    ctx.translate(obj.x, obj.y);

    // fuse
    ctx.strokeStyle = "#78716c";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -obj.r);
    ctx.quadraticCurveTo(obj.r * 0.3, -obj.r * 1.3, obj.r * 0.15, -obj.r * 1.55);
    ctx.stroke();

    // glowing spark at the fuse tip
    const sparkGlow = ctx.createRadialGradient(obj.r * 0.15, -obj.r * 1.55, 0, obj.r * 0.15, -obj.r * 1.55, 10);
    sparkGlow.addColorStop(0, "rgba(253, 224, 71, 0.9)");
    sparkGlow.addColorStop(1, "rgba(253, 224, 71, 0)");
    ctx.beginPath();
    ctx.arc(obj.r * 0.15, -obj.r * 1.55, 10, 0, Math.PI * 2);
    ctx.fillStyle = sparkGlow;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(obj.r * 0.15, -obj.r * 1.55, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "#fde047";
    ctx.fill();

    // dark bomb body with a red danger rim, instead of a plain red ball
    const grad = ctx.createRadialGradient(-obj.r * 0.3, -obj.r * 0.3, obj.r * 0.1, 0, 0, obj.r);
    grad.addColorStop(0, "#57534e");
    grad.addColorStop(0.6, "#292524");
    grad.addColorStop(1, "#0c0a09");
    ctx.beginPath();
    ctx.arc(0, 0, obj.r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(-obj.r * 0.32, -obj.r * 0.32, obj.r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fill();

    ctx.restore();
  }

  function drawHandsNeededOverlay() {
    ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textAlign = "center";
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.fillText("✋ Move back from the camera", canvas.width / 2, canvas.height / 2 - 16);
    ctx.fillText("so both hands are visible", canvas.width / 2, canvas.height / 2 + 20);

    ctx.font = "16px system-ui, sans-serif";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText("The game starts automatically once we can see them", canvas.width / 2, canvas.height / 2 + 54);
  }

  function drawCountdownOverlay() {
    ctx.fillStyle = "rgba(15, 23, 42, 0.35)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textAlign = "center";
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 120px system-ui, sans-serif";
    ctx.fillText(String(Math.ceil(countdown)), canvas.width / 2, canvas.height / 2 + 40);

    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.fillText("Get ready!", canvas.width / 2, canvas.height / 2 + 100);
  }

  function draw(landmarks) {
    if (!handsReady) {
      drawHandsNeededOverlay();
      return;
    }

    ctx.save();
    if (shake > 0.5) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    if (landmarks) {
      for (const [idx, side] of [[POSE.LEFT_WRIST, "left"], [POSE.RIGHT_WRIST, "right"]]) {
        const p = toCanvasCoords(landmarks[idx], canvas.width, canvas.height);
        if (handSprite.loaded) drawHandSprite(ctx, handSprite, p.x, p.y, side);
        else drawHandGlove(ctx, p.x, p.y, side);
      }
    }

    for (const obj of objects) {
      if (obj.type === "orb") drawOrb(obj);
      else drawBomb(obj);
    }

    for (const p of particles) {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    for (const f of floaters) {
      ctx.globalAlpha = Math.min(1, f.life / 15);
      ctx.fillStyle = f.color;
      ctx.font = f.big ? "bold 34px system-ui, sans-serif" : "bold 20px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    if (countdown > 0) {
      drawCountdownOverlay();
    }
  }

  function isOver() {
    return lives <= 0;
  }

  function getHud() {
    return {
      left: `⭐ ${score}   ⚡ Lv.${level}`,
      right: "❤".repeat(Math.max(lives, 0)) || "💔",
    };
  }

  function getOverResult() {
    return {
      title: "Game Over",
      message: `Final score: ${score} (Level ${level}). Pick a game to play again.`,
    };
  }

  return {
    id: "catch",
    title: "Catch & Dodge",
    thumbnail: "catch-dodge-thumb.jpg",
    description: "Catch green balloons, dodge red bombs with your hands. Gets harder every 5 catches.",
    reset,
    update,
    draw,
    drawBackground,
    primeAudio,
    isOver,
    getHud,
    getOverResult,
  };
}
