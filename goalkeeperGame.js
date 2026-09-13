import { POSE, toCanvasCoords } from "./utils.js?v=5";

const SHOOTER_SRC = {
  idle: "Asset/kenney_platformer-characters/PNG/Player/Poses/player_idle.png",
  kick: "Asset/kenney_platformer-characters/PNG/Player/Poses/player_kick.png",
};
const BALL_SRC = "Asset/football/PNG/Equipment/ball_soccer1.png"; // user-provided Kenney Sports Pack

const VISIBILITY_MIN = 0.4; // ignore a tracked point if the model isn't confident it's in frame
const COUNTDOWN_SECONDS = 3;

const LIVES = 3;
const SHOTS_PER_LEVEL = 3; // every 3 shots faced, the next tier gets harder
const WINDUP_MS = 650; // shooter winds up before the ball is struck
const RESULT_MS = 850; // pause after a save/goal before the next shot
const BASE_FLIGHT_MS = 1150; // how long a level-1 shot takes to arrive
const FLIGHT_MS_PER_LEVEL = 95; // faster each level (less reaction time)
const MIN_FLIGHT_MS = 430; // never gets unfairly instant
const SAVE_RADIUS = 46; // how close a tracked hand must get to the ball to save it
const GLOVE_SIZE = 36; // half-size of the drawn glove (see drawGlove)

function loadSprite(src) {
  const img = new Image();
  const sprite = { img, loaded: false };
  img.onload = () => {
    sprite.loaded = true;
  };
  img.src = src;
  return sprite;
}

// A dark padded goalkeeper glove -- drawn, not a downloaded sprite, since no
// free CC0/no-attribution glove art exists that matches (see project memory:
// same conclusion reached for Catch & Dodge's hand icon search). Fingers,
// a textured grip palm, and a colored wrist cuff (a real detail on actual
// keeper gloves) read as "goalkeeper" rather than a plain hand silhouette.
function drawGlove(ctx, x, y, side) {
  const sign = side === "left" ? -1 : 1;
  const R = GLOVE_SIZE;

  ctx.save();
  ctx.translate(x, y);

  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.7);
  glow.addColorStop(0, "rgba(0,0,0,0.3)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.7, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  // wrist cuff -- positioned so it's clearly visible below the palm, not
  // mostly hidden under it (the palm ellipse's bottom edge reaches ~0.9R).
  // Bright orange, not green, so it doesn't blend into the grass behind it.
  const cuffGrad = ctx.createLinearGradient(-R * 0.42, 0, R * 0.42, 0);
  cuffGrad.addColorStop(0, "#c2410c");
  cuffGrad.addColorStop(0.5, "#fb923c");
  cuffGrad.addColorStop(1, "#c2410c");
  ctx.fillStyle = cuffGrad;
  ctx.fillRect(-R * 0.42, R * 0.82, R * 0.84, R * 0.5);
  ctx.strokeStyle = "#7c2d12";
  ctx.lineWidth = 2;
  ctx.strokeRect(-R * 0.42, R * 0.82, R * 0.84, R * 0.5);
  // a couple of stitch lines across the cuff for a real-strap look
  ctx.strokeStyle = "rgba(124,45,18,0.6)";
  ctx.lineWidth = 1;
  for (const cy of [R * 0.95, R * 1.12]) {
    ctx.beginPath();
    ctx.moveTo(-R * 0.42, cy);
    ctx.lineTo(R * 0.42, cy);
    ctx.stroke();
  }

  // thumb, drawn first so the palm overlaps its base
  const thumbX = sign * R * 0.7;
  const thumbGrad = ctx.createLinearGradient(thumbX - R * 0.3, 0, thumbX + R * 0.3, 0);
  thumbGrad.addColorStop(0, sign < 0 ? "#3f3f46" : "#18181b");
  thumbGrad.addColorStop(1, sign < 0 ? "#18181b" : "#3f3f46");
  ctx.beginPath();
  ctx.ellipse(thumbX, R * 0.08, R * 0.3, R * 0.46, sign * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = thumbGrad;
  ctx.fill();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.stroke();
  // thumb knuckle seam
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(thumbX, R * 0.08, R * 0.3, R * 0.46, sign * 0.55, -0.3, 0.3);
  ctx.stroke();

  // padded palm/back of the glove
  const palmGrad = ctx.createRadialGradient(-R * 0.2, -R * 0.3, R * 0.1, 0, 0, R);
  palmGrad.addColorStop(0, "#6b7280");
  palmGrad.addColorStop(0.55, "#3f3f46");
  palmGrad.addColorStop(1, "#101014");
  ctx.beginPath();
  ctx.ellipse(0, -R * 0.05, R * 0.76, R * 0.95, 0, 0, Math.PI * 2);
  ctx.fillStyle = palmGrad;
  ctx.fill();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // a center seam line down the back of the glove, like real stitched panels
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -R * 0.95);
  ctx.lineTo(0, R * 0.7);
  ctx.stroke();

  // four padded fingers along the top, each with its own knuckle seam
  for (let i = 0; i < 4; i++) {
    const fx = (-1.5 + i) * R * 0.34;
    const fLen = R * (i === 1 || i === 2 ? 0.62 : 0.5);
    const fTipY = -R * 0.7 - fLen * 0.3;
    const fGrad = ctx.createLinearGradient(fx - R * 0.15, 0, fx + R * 0.15, 0);
    fGrad.addColorStop(0, "#3f3f46");
    fGrad.addColorStop(1, "#18181b");
    ctx.beginPath();
    ctx.ellipse(fx, fTipY, R * 0.15, fLen * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = fGrad;
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(fx - R * 0.15, fTipY);
    ctx.lineTo(fx + R * 0.15, fTipY);
    ctx.stroke();
  }

  // grip-texture dots on the palm
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  for (let gy = -0.4; gy <= 0.5; gy += 0.32) {
    for (let gx = -0.4; gx <= 0.4; gx += 0.32) {
      ctx.beginPath();
      ctx.arc(gx * R, gy * R, R * 0.055, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // glossy highlight sheen on the padded back of the glove
  const sheen = ctx.createRadialGradient(-R * 0.32, -R * 0.55, 0, -R * 0.32, -R * 0.55, R * 0.4);
  sheen.addColorStop(0, "rgba(255,255,255,0.35)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.beginPath();
  ctx.ellipse(-R * 0.32, -R * 0.55, R * 0.38, R * 0.28, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = sheen;
  ctx.fill();

  ctx.restore();
}

// Tracked hand position mapped 1:1 to the canvas (no amplification -- diving
// motions are already big and this keeps the save feel grounded/precise).
function getHandPoint(landmarks, idx, canvasWidth, canvasHeight) {
  return toCanvasCoords(landmarks[idx], canvasWidth, canvasHeight);
}

export function createGoalkeeperGame({ canvas, ctx }) {
  const shooterSprites = {
    idle: loadSprite(SHOOTER_SRC.idle),
    kick: loadSprite(SHOOTER_SRC.kick),
  };
  const ballSprite = loadSprite(BALL_SRC);

  const sfxPop = new Audio("balloon_pop.mp3");
  const sfxExplosion = new Audio("explosion_bomb.mp3");
  const sfxGameOver = new Audio("game_over.mp3");
  sfxPop.volume = 0.7;
  sfxExplosion.volume = 0.7;
  sfxGameOver.volume = 0.8;

  function playSound(audio) {
    try {
      audio.currentTime = 0;
      audio.play().catch((err) => console.warn("Sound effect failed to play:", audio.src, err));
    } catch (err) {
      console.warn("Sound effect failed to play:", audio.src, err);
    }
  }

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

  let score, lives, level, shotsThisLevel, handsReady, countdown;
  let phase, phaseTimer, ball, zoneIndex, lastZoneIndex, particles, floaters, shake;

  // First-person "standing in the goal" framing: the posts sit near the left/
  // right screen edges and the crossbar near the top, so the whole screen
  // reads as the goal mouth instead of a small frame drawn mid-scene.
  function postInset() {
    return canvas.width * 0.055;
  }

  function crossbarY() {
    return canvas.height * 0.06;
  }

  function zonesX() {
    const left = postInset();
    const right = canvas.width - postInset();
    const w = right - left;
    return [left + w * 0.16, left + w * 0.5, left + w * 0.84];
  }

  function goalLineY() {
    return canvas.height * 0.82;
  }

  function shooterPos() {
    return { x: canvas.width / 2, y: canvas.height * 0.36 };
  }

  function currentFlightMs() {
    return Math.max(MIN_FLIGHT_MS, BASE_FLIGHT_MS - (level - 1) * FLIGHT_MS_PER_LEVEL);
  }

  function reset() {
    score = 0;
    lives = LIVES;
    level = 1;
    shotsThisLevel = 0;
    handsReady = false;
    countdown = 0;
    particles = [];
    floaters = [];
    shake = 0;
    lastZoneIndex = -1;
    ball = null;
    startWindup();
  }

  function startWindup() {
    phase = "windup";
    phaseTimer = WINDUP_MS;
    let next = Math.floor(Math.random() * 3);
    if (next === lastZoneIndex && Math.random() < 0.7) next = (next + 1 + Math.floor(Math.random() * 2)) % 3;
    zoneIndex = next;
    lastZoneIndex = next;
    ball = null;
  }

  function startFlight() {
    phase = "flying";
    phaseTimer = currentFlightMs();
    const start = shooterPos();
    const zones = zonesX();
    ball = {
      startX: start.x,
      startY: start.y,
      endX: zones[zoneIndex],
      endY: goalLineY(),
      x: start.x,
      y: start.y,
      r: 7,
    };
  }

  function spawnBurst(x, y, color, count = 14) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const speed = 2 + Math.random() * 2.5;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: 3 + Math.random() * 2,
        color,
        life: 26,
        maxLife: 26,
      });
    }
  }

  function addFloater(x, y, text, color, big) {
    floaters.push({ x, y, text, color, big, life: 46, maxLife: 46 });
  }

  function resolveShot(wasSaved) {
    phase = "result";
    phaseTimer = RESULT_MS;
    if (wasSaved) {
      score += 1;
      spawnBurst(ball.x, ball.y, "#4ade80");
      addFloater(ball.x, ball.y - 30, "SAVED!", "#4ade80", true);
      playSound(sfxPop);
    } else {
      lives -= 1;
      spawnBurst(ball.endX, ball.endY, "#ef4444");
      addFloater(canvas.width / 2, canvas.height * 0.32, "GOAL!", "#ef4444", true);
      shake = Math.max(shake, 12);
      playSound(sfxExplosion);
      if (lives <= 0) playSound(sfxGameOver);
    }
    shotsThisLevel += 1;
    if (shotsThisLevel >= SHOTS_PER_LEVEL) {
      shotsThisLevel = 0;
      level += 1;
    }
  }

  function handsVisible(landmarks) {
    if (!landmarks) return false;
    const isVisible = (l) => !!l && (l.visibility === undefined || l.visibility > VISIBILITY_MIN);
    return isVisible(landmarks[POSE.LEFT_WRIST]) && isVisible(landmarks[POSE.RIGHT_WRIST]);
  }

  function update(dt, landmarks) {
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
    if (lives <= 0) return;

    const stepDt = Math.min(dt, 50);
    shake = Math.max(0, shake - stepDt * 0.05);

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

    if (phase === "windup") {
      phaseTimer -= stepDt;
      if (phaseTimer <= 0) startFlight();
      return;
    }

    if (phase === "flying") {
      phaseTimer -= stepDt;
      const total = currentFlightMs();
      const t = Math.max(0, Math.min(1, 1 - phaseTimer / total));
      ball.x = ball.startX + (ball.endX - ball.startX) * t;
      ball.y = ball.startY + (ball.endY - ball.startY) * t;
      ball.r = 7 + 17 * t;

      if (landmarks) {
        for (const idx of [POSE.LEFT_WRIST, POSE.RIGHT_WRIST]) {
          const h = getHandPoint(landmarks, idx, canvas.width, canvas.height);
          if (Math.hypot(h.x - ball.x, h.y - ball.y) < SAVE_RADIUS + ball.r) {
            resolveShot(true);
            return;
          }
        }
      }

      if (phaseTimer <= 0) resolveShot(false);
      return;
    }

    if (phase === "result") {
      phaseTimer -= stepDt;
      if (phaseTimer <= 0 && lives > 0) startWindup();
      return;
    }
  }

  // Diagonal-crosshatch net texture, clipped to a rectangle, with a depth
  // gradient (darker toward the far/inner edge) so it doesn't read as flat.
  // Used for both the overhead net panel and the two side panels flaring
  // out past the posts.
  function drawNetPanel(x, y, w, h, darkEdge) {
    if (w <= 0 || h <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    const shade = ctx.createLinearGradient(
      darkEdge === "left" ? x + w : darkEdge === "right" ? x : x,
      darkEdge === "top" ? y + h : y,
      darkEdge === "left" ? x : darkEdge === "right" ? x + w : x,
      darkEdge === "top" ? y : y + h
    );
    shade.addColorStop(0, "rgba(15,23,42,0.5)");
    shade.addColorStop(1, "rgba(15,23,42,0.78)");
    ctx.fillStyle = shade;
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    const step = 12;
    const span = w + h;
    for (let i = -span; i < span; i += step) {
      ctx.beginPath();
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i - h, y + h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i + h, y + h);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Stadium behind the pitch: sky, a roofed stand packed with a crowd of
  // colored dots, floodlights with glow, and a segmented advertising strip.
  function drawStadium() {
    const w = canvas.width;
    const horizon = canvas.height * 0.34;

    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#7dd3fc");
    sky.addColorStop(1, "#bae6fd");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon);

    const roofTop = horizon * 0.14;
    const standsTop = horizon * 0.3;

    // roof: a dark band with a lighter underside edge, sitting above the stand
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, roofTop, w, standsTop - roofTop);
    ctx.fillStyle = "rgba(148,163,184,0.4)";
    ctx.fillRect(0, standsTop - 3, w, 3);

    // stand body, shaded darker toward the bottom (closer to pitch level)
    const standGrad = ctx.createLinearGradient(0, standsTop, 0, horizon);
    standGrad.addColorStop(0, "#1e293b");
    standGrad.addColorStop(1, "#0f172a");
    ctx.fillStyle = standGrad;
    ctx.fillRect(0, standsTop, w, horizon - standsTop);

    // crowd: more rows, varied dot size/brightness for texture depth
    const rows = 6;
    for (let r = 0; r < rows; r++) {
      const y = standsTop + ((horizon - standsTop) * (r + 0.5)) / rows;
      const count = 58;
      const dotR = 1.6 + (rows - r) * 0.25;
      for (let i = 0; i < count; i++) {
        const x = (w / count) * (i + 0.5) + Math.sin(i * 12.9 + r * 3.1) * 3;
        const hue = (i * 47 + r * 91) % 360;
        const light = 42 + (r % 2) * 14 + ((i * 7) % 10);
        ctx.fillStyle = `hsl(${hue}, 50%, ${light}%)`;
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // floodlights with a soft glow and a small bulb cluster
    for (const fx of [w * 0.06, w * 0.94]) {
      const lampY = roofTop - 6;
      const beam = ctx.createRadialGradient(fx, lampY, 0, fx, lampY, 30);
      beam.addColorStop(0, "rgba(255,251,235,0.55)");
      beam.addColorStop(1, "rgba(255,251,235,0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.arc(fx, lampY, 30, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#94a3b8";
      ctx.fillRect(fx - 3, lampY, 6, standsTop - lampY);
      for (const [ox, oy] of [[-6, -8], [6, -8], [0, -12]]) {
        ctx.fillStyle = "#fefce8";
        ctx.beginPath();
        ctx.arc(fx + ox, lampY + oy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // advertising boards: alternating colored segments, not a flat strip
    const boardColors = ["#dc2626", "#2563eb", "#f59e0b", "#16a34a", "#7c3aed"];
    const segW = w / 9;
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = boardColors[i % boardColors.length];
      ctx.fillRect(i * segW, horizon - 16, segW - 2, 16);
    }

    return horizon;
  }

  function drawPitch(horizon) {
    const w = canvas.width;
    const h = canvas.height;
    const grad = ctx.createLinearGradient(0, horizon, 0, h);
    grad.addColorStop(0, "#15803d");
    grad.addColorStop(1, "#22c55e");
    ctx.fillStyle = grad;
    ctx.fillRect(0, horizon, w, h - horizon);

    const stripes = 7;
    for (let i = 0; i < stripes; i++) {
      const tTop = i / stripes;
      const tBot = (i + 1) / stripes;
      const yTop = horizon + (h - horizon) * (tTop * tTop);
      const yBot = horizon + (h - horizon) * (tBot * tBot);
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
      ctx.fillRect(0, yTop, w, yBot - yTop);

      // short grass-blade dashes within each stripe band for texture
      ctx.strokeStyle = i % 2 === 0 ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)";
      ctx.lineWidth = 1;
      const dashCount = 14;
      for (let d = 0; d < dashCount; d++) {
        const dx = (w / dashCount) * (d + 0.5) + ((i * 37) % 17) - 8;
        const dy = yTop + (yBot - yTop) * 0.5;
        ctx.beginPath();
        ctx.moveTo(dx, dy - 3);
        ctx.lineTo(dx, dy + 3);
        ctx.stroke();
      }
    }

    // penalty box: a trapezoid converging toward the horizon (nearer edge is
    // wider, matching the "you're looking out from the goal line" framing)
    const nearW = w * 0.82;
    const farW = w * 0.42;
    const boxTop = horizon + (h - horizon) * 0.06;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo((w - nearW) / 2, h);
    ctx.lineTo((w - farW) / 2, boxTop);
    ctx.lineTo((w + farW) / 2, boxTop);
    ctx.lineTo((w + nearW) / 2, h);
    ctx.stroke();

    // center-circle arc hint, foreshortened into a flattened ellipse near the horizon
    ctx.beginPath();
    ctx.ellipse(w / 2, horizon + (h - horizon) * 0.14, w * 0.16, (h - horizon) * 0.05, 0, 0, Math.PI * 2);
    ctx.stroke();

    // penalty spot
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.arc(w / 2, horizon + (h - horizon) * 0.32, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Foreground frame: crossbar + posts with net visible above them and
  // flaring out past them on each side, so the whole screen reads as "you're
  // standing in the goal looking out" instead of a small frame mid-scene.
  function drawPost(x, y, w, h) {
    // cylindrical look: a base fill plus a lighter highlight stripe down the
    // middle, instead of a flat rectangle
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(x, y, w, h);
    const highlight = ctx.createLinearGradient(x, 0, x + w, 0);
    highlight.addColorStop(0, "rgba(255,255,255,0)");
    highlight.addColorStop(0.5, "rgba(255,255,255,0.9)");
    highlight.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = highlight;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(100,116,139,0.6)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }

  function drawGoalFrame() {
    const w = canvas.width;
    const h = canvas.height;
    const inset = postInset();
    const postW = w * 0.022;
    const barY = crossbarY();

    drawNetPanel(0, 0, w, barY, "top");
    drawNetPanel(0, barY, inset, h - barY, "left");
    drawNetPanel(w - inset, barY, inset, h - barY, "right");

    // soft ground shadow where each post meets the pitch
    for (const px of [inset - postW / 2, w - inset + postW / 2]) {
      const shadow = ctx.createRadialGradient(px, h - 6, 0, px, h - 6, postW * 3);
      shadow.addColorStop(0, "rgba(0,0,0,0.35)");
      shadow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = shadow;
      ctx.beginPath();
      ctx.ellipse(px, h - 6, postW * 3, postW, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    drawPost(0, barY - postW, w, postW);
    drawPost(inset - postW, barY, postW, h - barY);
    drawPost(w - inset, barY, postW, h - barY);
  }

  function drawShooter() {
    const pos = shooterPos();
    const sprite = phase === "windup" && phaseTimer < 260 ? shooterSprites.kick : shooterSprites.idle;
    if (!sprite.loaded) return;
    const h = canvas.height * 0.22;
    const w = h * (sprite.img.naturalWidth / sprite.img.naturalHeight);
    ctx.drawImage(sprite.img, pos.x - w / 2, pos.y - h * 0.15, w, h);
  }

  function drawBall() {
    if (!ball || phase === "windup") return;

    // a short motion streak behind the ball once it's moving fast, so the
    // flight reads as a real strike rather than a floating sprite
    const dx = ball.endX - ball.startX;
    const dy = ball.endY - ball.startY;
    const dist = Math.hypot(dx, dy) || 1;
    const backX = -dx / dist;
    const backY = -dy / dist;
    ctx.save();
    ctx.globalAlpha = 0.28;
    const streak = ctx.createLinearGradient(ball.x, ball.y, ball.x + backX * ball.r * 4, ball.y + backY * ball.r * 4);
    streak.addColorStop(0, "rgba(255,255,255,0.8)");
    streak.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = streak;
    ctx.lineWidth = ball.r * 0.9;
    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y);
    ctx.lineTo(ball.x + backX * ball.r * 4, ball.y + backY * ball.r * 4);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, ball.r * 0.9, ball.r * 0.8, ball.r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();

    if (ballSprite.loaded) {
      const d = ball.r * 2;
      ctx.drawImage(ballSprite.img, -d / 2, -d / 2, d, d);
    } else {
      // procedural fallback for the brief window before the sprite loads
      const ballGrad = ctx.createRadialGradient(-ball.r * 0.35, -ball.r * 0.35, ball.r * 0.1, 0, 0, ball.r);
      ballGrad.addColorStop(0, "#ffffff");
      ballGrad.addColorStop(0.7, "#f1f5f9");
      ballGrad.addColorStop(1, "#cbd5e1");
      ctx.beginPath();
      ctx.arc(0, 0, ball.r, 0, Math.PI * 2);
      ctx.fillStyle = ballGrad;
      ctx.fill();
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = Math.max(1, ball.r * 0.08);
      ctx.stroke();

      ctx.fillStyle = "#1e293b";
      ctx.beginPath();
      ctx.arc(0, 0, ball.r * 0.32, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 5; i++) {
        const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * ball.r * 0.55, Math.sin(a) * ball.r * 0.55, ball.r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function drawHandsNeededOverlay() {
    ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textAlign = "center";
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.fillText("🧤 Move back from the camera", canvas.width / 2, canvas.height / 2 - 16);
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
    ctx.fillText("Get ready to save!", canvas.width / 2, canvas.height / 2 + 100);
  }

  function drawBackground() {
    const horizon = drawStadium();
    drawPitch(horizon);
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

    drawShooter();
    drawBall();

    if (landmarks) {
      for (const [idx, side] of [
        [POSE.LEFT_WRIST, "left"],
        [POSE.RIGHT_WRIST, "right"],
      ]) {
        const p = getHandPoint(landmarks, idx, canvas.width, canvas.height);
        drawGlove(ctx, p.x, p.y, side);
      }
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
      ctx.font = f.big ? "bold 40px system-ui, sans-serif" : "bold 20px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }

    drawGoalFrame();

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
      left: `🏟️ Match ${level}   ⚽ Kick ${Math.min(shotsThisLevel + 1, SHOTS_PER_LEVEL)}/${SHOTS_PER_LEVEL}`,
      right: `🧤 ${score}   ${"❤".repeat(Math.max(lives, 0)) || "💔"}`,
    };
  }

  function getOverResult() {
    return {
      title: "Full Time!",
      message: `You made ${score} save${score === 1 ? "" : "s"} and reached Level ${level}. Pick a game to play again.`,
    };
  }

  return {
    id: "goalkeeper",
    title: "Shot Stopper",
    thumbnail: null,
    description: "You're the goalkeeper — reach with your hands to save every shot. Gets faster every 3 shots.",
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
