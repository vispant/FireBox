import { POSE, toCanvasCoords, drawFaceEmoji } from "./utils.js?v=5";

const HAND_RADIUS = 26;
const CATCHES_PER_LEVEL = 5;

function playSound(audio) {
  try {
    audio.currentTime = 0;
    audio.play().catch((err) => console.warn("Sound effect failed to play:", audio.src, err));
  } catch (err) {
    console.warn("Sound effect failed to play:", audio.src, err);
  }
}

export function createCatchGame({ canvas, ctx, video }) {
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

  function update(dt, landmarks) {
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

  function drawBackground(bgVideo, personCutout) {
    const w = canvas.width;
    const h = canvas.height;
    const activeVideo = bgVideo || video;

    const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
    skyGrad.addColorStop(0, "#38bdf8");
    skyGrad.addColorStop(1, "#bae6fd");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h);

    for (const c of clouds) {
      drawCloud(c.x, c.y, c.scale);
    }

    if (personCutout) {
      ctx.drawImage(personCutout, 0, 0, w, h);
    } else if (activeVideo && activeVideo.readyState >= 2) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(activeVideo, 0, 0, w, h);
      ctx.restore();
    }

    const spot = ctx.createRadialGradient(w / 2, h * 0.5, h * 0.6, w / 2, h * 0.5, h * 0.9);
    spot.addColorStop(0, "rgba(0,0,0,0)");
    spot.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, w, h);
  }

  function drawOrb(obj) {
    const grad = ctx.createRadialGradient(
      obj.x - obj.r * 0.3,
      obj.y - obj.r * 0.3,
      obj.r * 0.1,
      obj.x,
      obj.y,
      obj.r
    );
    grad.addColorStop(0, "#dcfce7");
    grad.addColorStop(0.5, "#4ade80");
    grad.addColorStop(1, "#15803d");
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, obj.r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(obj.x - obj.r * 0.35, obj.y - obj.r * 0.35, obj.r * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fill();
  }

  function drawBomb(obj) {
    ctx.strokeStyle = "#78716c";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(obj.x, obj.y - obj.r);
    ctx.quadraticCurveTo(obj.x + obj.r * 0.3, obj.y - obj.r * 1.3, obj.x + obj.r * 0.15, obj.y - obj.r * 1.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(obj.x + obj.r * 0.15, obj.y - obj.r * 1.55, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#fbbf24";
    ctx.fill();

    const grad = ctx.createRadialGradient(
      obj.x - obj.r * 0.3,
      obj.y - obj.r * 0.3,
      obj.r * 0.1,
      obj.x,
      obj.y,
      obj.r
    );
    grad.addColorStop(0, "#fca5a5");
    grad.addColorStop(1, "#7f1d1d");
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, obj.r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function draw(landmarks) {
    ctx.save();
    if (shake > 0.5) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    if (landmarks) {
      for (const idx of [POSE.LEFT_WRIST, POSE.RIGHT_WRIST]) {
        const p = toCanvasCoords(landmarks[idx], canvas.width, canvas.height);
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, HAND_RADIUS);
        glow.addColorStop(0, "rgba(191,219,254,0.55)");
        glow.addColorStop(1, "rgba(96,165,250,0.15)");
        ctx.beginPath();
        ctx.arc(p.x, p.y, HAND_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#60a5fa";
        ctx.stroke();
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

    drawFaceEmoji(ctx, landmarks, canvas.width, canvas.height);
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
    needsPersonCutout: true,
    primeAudio,
    isOver,
    getHud,
    getOverResult,
  };
}
