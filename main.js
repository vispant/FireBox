import {
  PoseLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";
import { createCatchGame } from "./catchGame.js?v=10";
import { createFighterGame } from "./fighterGame.js?v=11";
import { createPersonSegmenter } from "./segmentation.js?v=3";

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

let screen = "loading"; // loading | menu | playing | paused | gameover
let activeGame = null;
const games = [
  createCatchGame({ canvas, ctx, video }),
  createFighterGame({ canvas, ctx, video, threeCanvas, fxCanvas, fxCtx }),
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

function renderMenu() {
  overlay.innerHTML = `
    <h1>FireBox</h1>
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

function startGame(gameId) {
  activeGame = games.find((g) => g.id === gameId);
  if (activeGame.primeAudio) activeGame.primeAudio();
  activeGame.reset();
  setScreen("playing");
  overlay.classList.add("hidden");
  threeCanvas.classList.toggle("hidden", !activeGame.draw3D);
  fxCanvas.classList.toggle("hidden", !activeGame.draw3D);
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

  if (action === "select-game") {
    startGame(btn.dataset.gameId);
  } else if (action === "resume") {
    togglePause();
  } else if (action === "quit") {
    showMenu();
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
    overlay.innerHTML = `<h1>FireBox</h1><p id="status">Requesting camera access...</p>`;
    await setupCamera();
    const preferred = await refreshCameraList();
    if (preferred) await setupCamera(preferred);

    document.getElementById("status").textContent = "Loading pose model...";
    await setupPoseLandmarker();

    document.getElementById("status").textContent = "Loading background removal...";
    try {
      await personSegmenter.init();
    } catch (err) {
      console.warn("Person segmentation unavailable, backgrounds will use the plain camera view instead.", err);
    }

    showMenu();
    requestAnimationFrame(predict);
  } catch (err) {
    console.error(err);
    overlay.innerHTML = `<h1>FireBox</h1><p>Could not start camera or model: ${err.message} (check camera permissions, that no other app is using the camera, and that you're on http://localhost or https).</p>`;
  }
}

init();
