import {
  PoseLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";
import { createCatchGame } from "./catchGame.js?v=10";
import { createFighterGame } from "./fighterGame.js?v=11";
import { createPersonSegmenter } from "./segmentation.js?v=3";
import { signUp, signIn, signOut, getCurrentUser, fetchCountry } from "./auth.js?v=1";
import { TURNSTILE_SITE_KEY } from "./config.js?v=1";
import { createFlappyGame } from "./flappyGame.js?v=2";
import { createSnakeGame } from "./snakeGame.js?v=2";
import { createWhackGame } from "./whackGame.js?v=1";
import { createSnakeArenaGame } from "./snakeArenaGame.js?v=1";
import { createBrickGame } from "./brickGame.js?v=1";
import { createRunnerGame } from "./runnerGame.js?v=1";

const video = document.getElementById("webcam");
const canvas = document.getElementById("output");
const ctx = canvas.getContext("2d");
const threeCanvas = document.getElementById("three-canvas");
const fxCanvas = document.getElementById("fx-canvas");
const fxCtx = fxCanvas.getContext("2d");
const hud = document.getElementById("hud");
const hudLeft = document.getElementById("hudLeft");
const hudRight = document.getElementById("hudRight");
const pauseBtn = document.getElementById("pauseBtn");
const overlay = document.getElementById("overlay");

let poseLandmarker = null;
let lastVideoTime = -1;
let lastFrameTime = 0;
let latestLandmarks = null;

let currentStream = null;
let availableCameras = [];
let activeDeviceId = null;
let selectedBgTheme = "arena";
const personSegmenter = createPersonSegmenter();

const BG_THEMES = [
  { value: "arena", label: "Fighting Arena" },
  { value: "desert", label: "Desert" },
  { value: "city", label: "City" },
  { value: "battlefield", label: "Battlefield" },
];

function bgSelectRowHtml() {
  return `
    <div class="selectRow">
      <label for="bgSelect">Fist Fighter background:</label>
      <select id="bgSelect">
        ${BG_THEMES.map((t) => `<option value="${t.value}">${t.label}</option>`).join("")}
      </select>
    </div>
  `;
}

function wireBgSelect() {
  const bgSelect = document.getElementById("bgSelect");
  if (!bgSelect) return;
  bgSelect.value = selectedBgTheme;
  bgSelect.addEventListener("change", (e) => {
    selectedBgTheme = e.target.value;
  });
}

let screen = "loading"; // loading | auth | hub | menu | normalMenu | lobby | playing | paused | gameover
let activeGame = null;
let currentUser = null;
let turnstileWidgetId = null;
let modelsReady = false;
let predictLoopStarted = false;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function waitForTurnstile(cb, attempts = 0) {
  if (window.turnstile) {
    cb();
  } else if (attempts < 100) {
    setTimeout(() => waitForTurnstile(cb, attempts + 1), 100);
  }
}
const games = [
  createCatchGame({ canvas, ctx, video }),
  createFighterGame({ canvas, ctx, video, threeCanvas, fxCanvas, fxCtx }),
];
function getPlayerName() {
  return currentUser?.user_metadata?.name || currentUser?.email || "Guest";
}

const normalGames = [
  createFlappyGame({ canvas, ctx }),
  createSnakeGame({ canvas, ctx }),
  createWhackGame({ canvas, ctx }),
  createSnakeArenaGame({ canvas, ctx, getPlayerName }),
  createBrickGame({ canvas, ctx }),
  createRunnerGame({ canvas, ctx }),
];

function setScreen(next) {
  screen = next;
  hud.classList.toggle("hidden", screen !== "playing");
}

async function setupCamera(deviceId) {
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
  }

  const videoConstraints = { width: 960, height: 540 };
  if (deviceId) videoConstraints.deviceId = { exact: deviceId };

  const stream = await navigator.mediaDevices.getUserMedia({
    video: videoConstraints,
    audio: false,
  });
  currentStream = stream;
  video.srcObject = stream;
  await new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      resolve();
    };
  });
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  threeCanvas.width = canvas.width;
  threeCanvas.height = canvas.height;
  fxCanvas.width = canvas.width;
  fxCanvas.height = canvas.height;
}

async function refreshCameraList(preferredDeviceId) {
  const devices = await navigator.mediaDevices.enumerateDevices();
  availableCameras = devices.filter((d) => d.kind === "videoinput");

  let selected = preferredDeviceId;
  if (!selected) {
    const logitech = availableCameras.find((c) => /logitech/i.test(c.label));
    selected = logitech ? logitech.deviceId : availableCameras[0]?.deviceId;
  }
  activeDeviceId = selected;
  return selected;
}

async function setupPoseLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
  );
  const modelAssetPath =
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

  try {
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate: "GPU" },
      runningMode: "VIDEO",
      numPoses: 1,
    });
  } catch (err) {
    console.warn("GPU delegate unavailable, falling back to CPU.", err);
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate: "CPU" },
      runningMode: "VIDEO",
      numPoses: 1,
    });
  }
}

function drawCameraBackground() {
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function updateHud() {
  const info = activeGame.getHud();
  hudLeft.textContent = info.left;
  hudRight.textContent = info.right;
}

function predict() {
  if (poseLandmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = poseLandmarker.detectForVideo(video, performance.now());
    latestLandmarks = result.landmarks && result.landmarks[0] ? result.landmarks[0] : null;
  }

  const now = performance.now();
  const dt = lastFrameTime ? now - lastFrameTime : 16;
  lastFrameTime = now;

  if (video.readyState >= 2) {
    if (activeGame && activeGame.drawBackground && screen !== "menu" && screen !== "loading") {
      let cutout = null;
      if (activeGame.needsPersonCutout && personSegmenter.isReady()) {
        personSegmenter.update(video, performance.now());
        cutout = personSegmenter.getPersonCutout(video, canvas.width, canvas.height);
      }
      activeGame.drawBackground(video, cutout, selectedBgTheme);
    } else {
      drawCameraBackground();
    }
  }

  if (screen === "playing" && activeGame) {
    activeGame.update(dt, latestLandmarks);
    if (activeGame.draw3D) activeGame.draw3D();
    activeGame.draw(latestLandmarks);
    updateHud();
    if (activeGame.isOver()) {
      setScreen("gameover");
      overlay.classList.remove("hidden");
      renderGameOver(activeGame.getOverResult());
    }
  } else if (screen === "paused" && activeGame) {
    if (activeGame.draw3D) activeGame.draw3D();
    activeGame.draw(latestLandmarks);
  }

  requestAnimationFrame(predict);
}

function populateCameraSelect(selectEl) {
  selectEl.innerHTML = "";
  availableCameras.forEach((cam, i) => {
    const opt = document.createElement("option");
    opt.value = cam.deviceId;
    opt.textContent = cam.label || `Camera ${i + 1}`;
    selectEl.appendChild(opt);
  });
  if (activeDeviceId) selectEl.value = activeDeviceId;
}

function renderAuth(mode = "signup") {
  const turnstileConfigured = TURNSTILE_SITE_KEY && TURNSTILE_SITE_KEY !== "REPLACE_WITH_TURNSTILE_SITE_KEY";

  overlay.innerHTML = `
    <h1>FireBox</h1>
    <p>Sign up to save your progress and get on the leaderboard — or jump straight in as a guest.</p>
    <form id="authForm" class="auth-form">
      ${mode === "signup" ? `<input type="text" id="authName" placeholder="Your name" required />` : ""}
      <input type="email" id="authEmail" placeholder="Email" required />
      <input type="password" id="authPassword" placeholder="Password" required minlength="6" />
      ${turnstileConfigured ? `<div id="turnstileBox" class="turnstile-box"></div>` : ""}
      <button type="submit">${mode === "signup" ? "Sign Up" : "Sign In"}</button>
    </form>
    <button class="auth-toggle" type="button" data-action="auth-mode" data-mode="${
      mode === "signup" ? "signin" : "signup"
    }">${mode === "signup" ? "Already have an account? Sign In" : "New here? Sign Up"}</button>
    <button class="secondary" data-action="continue-guest">Continue as Guest</button>
    <p id="authStatus"></p>
  `;

  let captchaToken = null;
  if (turnstileConfigured) {
    waitForTurnstile(() => {
      turnstileWidgetId = window.turnstile.render("#turnstileBox", {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => {
          captchaToken = token;
        },
        "expired-callback": () => {
          captchaToken = null;
        },
      });
    });
  }

  const form = document.getElementById("authForm");
  const statusEl = document.getElementById("authStatus");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (turnstileConfigured && !captchaToken) {
      statusEl.textContent = "Please complete the verification check.";
      statusEl.style.color = "#ef4444";
      return;
    }
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    statusEl.style.color = "#94a3b8";
    statusEl.textContent = mode === "signup" ? "Creating account..." : "Signing in...";
    try {
      if (mode === "signup") {
        const name = document.getElementById("authName").value.trim();
        const country = await fetchCountry();
        const result = await signUp({ email, password, name, captchaToken, country });
        if (!result.session) {
          statusEl.style.color = "#4ade80";
          statusEl.textContent = "Account created! Check your email to confirm, then sign in.";
          renderAuth("signin");
          return;
        }
        currentUser = result.user;
      } else {
        const result = await signIn({ email, password, captchaToken });
        currentUser = result.user;
      }
      showHub();
    } catch (err) {
      statusEl.style.color = "#ef4444";
      statusEl.textContent = err.message || "Something went wrong.";
      if (window.turnstile && turnstileWidgetId != null) window.turnstile.reset(turnstileWidgetId);
      captchaToken = null;
    }
  });
}

function showAuth() {
  setScreen("auth");
  overlay.classList.remove("hidden");
  threeCanvas.classList.add("hidden");
  fxCanvas.classList.add("hidden");
  renderAuth("signup");
}

function renderHub() {
  overlay.innerHTML = `
    <h1>FireBox</h1>
    ${
      currentUser
        ? `<div class="selectRow"><span>Signed in as ${escapeHtml(
            currentUser.user_metadata?.name || currentUser.email
          )}</span><button class="auth-toggle" type="button" data-action="sign-out">Sign Out</button></div>`
        : ""
    }
    <p>Choose a category to get started.</p>
    <div class="game-grid">
      <button class="game-card" data-action="open-camera-games">
        <div class="card-body">
          <strong>📷 Camera Games</strong>
          <span>Motion-tracking games that use your webcam. We'll only ask for camera access once you open this.</span>
        </div>
      </button>
      <button class="game-card" data-action="open-normal-games">
        <div class="card-body">
          <strong>🕹️ Normal Games</strong>
          <span>Classic games you play with your keyboard or mouse — no camera needed.</span>
        </div>
      </button>
    </div>
  `;
}

function showHub() {
  setScreen("hub");
  overlay.classList.remove("hidden");
  threeCanvas.classList.add("hidden");
  fxCanvas.classList.add("hidden");
  renderHub();
}

function ensurePredictLoop() {
  if (!predictLoopStarted) {
    predictLoopStarted = true;
    requestAnimationFrame(predict);
  }
}

async function startCameraGames() {
  setScreen("loading");
  overlay.innerHTML = `<h1>Camera Games</h1><p id="status">Requesting camera access...</p>`;
  try {
    if (!currentStream) {
      await setupCamera();
      const preferred = await refreshCameraList(activeDeviceId);
      if (preferred) await setupCamera(preferred);
    }

    if (!modelsReady) {
      document.getElementById("status").textContent = "Loading pose model...";
      await setupPoseLandmarker();

      document.getElementById("status").textContent = "Loading background removal...";
      try {
        await personSegmenter.init();
      } catch (err) {
        console.warn("Person segmentation unavailable, backgrounds will use the plain camera view instead.", err);
      }
      modelsReady = true;
    }

    ensurePredictLoop();
    showMenu();
  } catch (err) {
    console.error(err);
    overlay.innerHTML = `<h1>Camera Games</h1><p>Could not start camera or model: ${err.message} (check camera permissions, that no other app is using the camera, and that you're on http://localhost or https).</p><button class="secondary" data-action="back-to-hub">Back</button>`;
  }
}

function openNormalGames() {
  canvas.width = 960;
  canvas.height = 540;
  threeCanvas.width = canvas.width;
  threeCanvas.height = canvas.height;
  fxCanvas.width = canvas.width;
  fxCanvas.height = canvas.height;
  ensurePredictLoop();
  showNormalMenu();
}

function exitToHub() {
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
    currentStream = null;
  }
  showHub();
}

function renderMenu() {
  overlay.innerHTML = `
    <h1>Camera Games</h1>
    <button class="auth-toggle" type="button" data-action="back-to-hub">← Back</button>
    <p>Pick a game. Stand back so your whole body is in view — Fist Fighter tracks your feet too.</p>
    <div class="selectRow">
      <label for="cameraSelect">Camera:</label>
      <select id="cameraSelect"></select>
    </div>
    <div class="game-grid">
      ${games
        .map(
          (g) => `
        <button class="game-card" data-action="select-game" data-game-id="${g.id}">
          ${g.thumbnail ? `<img class="card-thumb" src="${g.thumbnail}" alt="" />` : ""}
          <div class="card-body">
            <strong>${g.title}</strong>
            <span>${g.description}</span>
          </div>
        </button>`
        )
        .join("")}
    </div>
    <button class="secondary" data-action="reset-progress">Reset Fist Fighter Progress</button>
    <button class="secondary" data-action="test-sound">🔊 Test Sound</button>
    <p id="soundStatus"></p>
  `;

  const cameraSelect = document.getElementById("cameraSelect");
  populateCameraSelect(cameraSelect);
  cameraSelect.addEventListener("change", async (e) => {
    const id = e.target.value;
    try {
      await setupCamera(id);
      activeDeviceId = id;
    } catch (err) {
      console.error(err);
    }
  });
}

function renderPauseMenu() {
  const info = activeGame.getPauseInfo ? activeGame.getPauseInfo() : null;
  overlay.innerHTML = `
    <h1>Paused</h1>
    ${
      info
        ? `<p>Coins: ${info.coins}</p>
           <div class="upgrade-list">
             ${info.options
               .map(
                 (o) => `
               <button data-action="upgrade" data-upgrade-id="${o.id}" ${
                   info.coins < o.cost ? "disabled" : ""
                 }>${o.label} — ${o.cost} coins</button>`
               )
               .join("")}
           </div>`
        : `<p>Take a breather.</p>`
    }
    ${activeGame.drawBackground ? bgSelectRowHtml() : ""}
    <button data-action="resume">Resume</button>
    <button class="secondary" data-action="quit">Quit to Menu</button>
    ${
      activeGame.resetProgress
        ? `<button class="secondary" data-action="reset-progress">Reset Fist Fighter Progress</button>`
        : ""
    }
  `;
  wireBgSelect();
}

function renderResetConfirm() {
  overlay.innerHTML = `
    <h1>Reset Progress?</h1>
    <p>This permanently deletes your Fist Fighter coins, upgrades, and stage progress. This can't be undone.</p>
    <button data-action="confirm-reset">Yes, Reset Everything</button>
    <button class="secondary" data-action="cancel-reset">Cancel</button>
  `;
}

function renderGameOver(result) {
  overlay.innerHTML = `
    <h1>${result.title}</h1>
    <p>${result.message}</p>
    <button data-action="retry">Play Again</button>
    <button class="secondary" data-action="quit">Back to Menu</button>
  `;
}

function enterPlaying() {
  setScreen("playing");
  overlay.classList.add("hidden");
  threeCanvas.classList.toggle("hidden", !activeGame.draw3D);
  fxCanvas.classList.toggle("hidden", !activeGame.draw3D);
}

function startGame(gameId) {
  activeGame = games.find((g) => g.id === gameId) || normalGames.find((g) => g.id === gameId);
  if (activeGame.primeAudio) activeGame.primeAudio();
  if (activeGame.needsLobby) {
    setScreen("lobby");
    overlay.classList.remove("hidden");
    activeGame.renderLobby(overlay, {
      onReady: () => {
        activeGame.reset();
        enterPlaying();
      },
      onCancel: backToGameList,
    });
    return;
  }
  activeGame.reset();
  enterPlaying();
}

function showMenu() {
  if (activeGame && activeGame.save) activeGame.save();
  activeGame = null;
  setScreen("menu");
  overlay.classList.remove("hidden");
  threeCanvas.classList.add("hidden");
  fxCanvas.classList.add("hidden");
  renderMenu();
}

function renderNormalMenu() {
  overlay.innerHTML = `
    <h1>Normal Games</h1>
    <button class="auth-toggle" type="button" data-action="back-to-hub">← Back</button>
    <p>No camera needed — just your keyboard or mouse.</p>
    <div class="game-grid">
      ${normalGames
        .map(
          (g) => `
        <button class="game-card" data-action="select-game" data-game-id="${g.id}">
          ${g.thumbnail ? `<img class="card-thumb" src="${g.thumbnail}" alt="" />` : ""}
          <div class="card-body">
            <strong>${g.title}</strong>
            <span>${g.description}</span>
          </div>
        </button>`
        )
        .join("")}
    </div>
  `;
}

function showNormalMenu() {
  if (activeGame && activeGame.save) activeGame.save();
  activeGame = null;
  setScreen("normalMenu");
  overlay.classList.remove("hidden");
  threeCanvas.classList.add("hidden");
  fxCanvas.classList.add("hidden");
  renderNormalMenu();
}

function backToGameList() {
  const wasCameraGame = activeGame && games.includes(activeGame);
  if (wasCameraGame) {
    showMenu();
  } else {
    showNormalMenu();
  }
}

function togglePause() {
  if (screen === "playing") {
    setScreen("paused");
    overlay.classList.remove("hidden");
    renderPauseMenu();
  } else if (screen === "paused") {
    setScreen("playing");
    overlay.classList.add("hidden");
  }
}

overlay.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === "auth-mode") {
    renderAuth(btn.dataset.mode);
  } else if (action === "continue-guest") {
    showHub();
  } else if (action === "sign-out") {
    signOut().then(() => {
      currentUser = null;
      showAuth();
    });
  } else if (action === "open-camera-games") {
    startCameraGames();
  } else if (action === "open-normal-games") {
    openNormalGames();
  } else if (action === "back-to-hub") {
    exitToHub();
  } else if (action === "select-game") {
    startGame(btn.dataset.gameId);
  } else if (action === "resume") {
    togglePause();
  } else if (action === "quit") {
    backToGameList();
  } else if (action === "retry") {
    startGame(activeGame.id);
  } else if (action === "upgrade") {
    if (activeGame.applyUpgrade(btn.dataset.upgradeId)) {
      renderPauseMenu();
    }
  } else if (action === "reset-progress") {
    renderResetConfirm();
  } else if (action === "confirm-reset") {
    const fighter = games.find((g) => g.id === "fighter");
    if (fighter && fighter.resetProgress) fighter.resetProgress();
    showMenu();
  } else if (action === "cancel-reset") {
    if (screen === "paused") {
      renderPauseMenu();
    } else {
      renderMenu();
    }
  } else if (action === "test-sound") {
    const fighter = games.find((g) => g.id === "fighter");
    const statusEl = document.getElementById("soundStatus");
    if (fighter && fighter.testSound && statusEl) {
      statusEl.style.color = "#94a3b8";
      statusEl.textContent = "Testing...";
      fighter.testSound((ok, msg) => {
        statusEl.textContent = (ok ? "✅ " : "❌ ") + msg;
        statusEl.style.color = ok ? "#4ade80" : "#ef4444";
      });
    }
  }
});

pauseBtn.addEventListener("click", togglePause);
window.addEventListener("keydown", (e) => {
  if (e.key === "p" || e.key === "P" || e.key === "Escape") {
    if (screen === "playing" || screen === "paused") togglePause();
  }
});

async function init() {
  try {
    overlay.innerHTML = `<h1>FireBox</h1><p id="status">Checking sign-in...</p>`;
    currentUser = await getCurrentUser();
    if (currentUser) {
      showHub();
    } else {
      showAuth();
    }
  } catch (err) {
    console.error(err);
    overlay.innerHTML = `<h1>FireBox</h1><p>Could not start: ${err.message}</p>`;
  }
}

init();
