import { signUp, signIn, signOut, getCurrentUser, fetchCountry, supabase } from "./auth.js?v=1";
import { TURNSTILE_SITE_KEY, SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js?v=1";
import { createEmberAnteGame } from "./emberAnte.js?v=4";

const overlay = document.getElementById("overlay");
const errorBanner = document.getElementById("errorBanner");

// Visible crash reporting: if anything throws, show it on-screen instead of
// only in the console -- some devices (managed Chromebooks especially) make
// DevTools hard or impossible to reach, so this is often the only way a real
// bug is ever diagnosable at all.
function reportError(label, err) {
  const msg = `[${label}] ${err && err.stack ? err.stack : err}`;
  console.error(msg);
  errorBanner.textContent = errorBanner.classList.contains("hidden")
    ? msg
    : errorBanner.textContent + "\n\n" + msg;
  errorBanner.classList.remove("hidden");
}
window.addEventListener("error", (e) => reportError("uncaught error", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => reportError("unhandled promise rejection", e.reason));

let screen = "loading"; // loading | auth | hub | menu
let currentUser = null;
let turnstileWidgetId = null;

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

// Full standalone web apps (built elsewhere, e.g. Google AI Studio) that run
// via <iframe> instead of any in-repo game code.
const webGames = [
  {
    id: "sovereign-chess",
    title: "Sovereign Chess",
    description: "A polished 2D chess arena with five AI bot personalities, tutorials, and an endgame trainer.",
    thumbnail: "Asset/sovereign_chess_Thumbnail.png",
    url: "https://sovereign-chess.ai.studio",
  },
];

// Built-in apps that, like webGames, mount their own DOM/CSS UI directly
// into #overlay for their whole lifetime instead of a shared canvas loop
// (see playAppGame()).
const appGames = [createEmberAnteGame()];

function setScreen(next) {
  screen = next;
  // Menu-style screens get a solid dark-blue backdrop.
  overlay.classList.toggle("solid", ["loading", "auth", "hub", "menu"].includes(next));
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
    <p>Pick a game.</p>
    <div class="game-grid">
      ${webGames
        .map(
          (g) => `
        <button class="game-card" data-action="open-web-game" data-web-id="${g.id}">
          ${g.thumbnail ? `<img class="card-thumb" src="${g.thumbnail}" alt="" />` : ""}
          <div class="card-body">
            <strong>${escapeHtml(g.title)}</strong>
            <span>${escapeHtml(g.description)}</span>
          </div>
        </button>`
        )
        .join("")}
      ${appGames
        .map(
          (g) => `
        <button class="game-card" data-action="open-app-game" data-app-id="${g.id}">
          ${g.thumbnail ? `<img class="card-thumb" src="${g.thumbnail}" alt="" />` : ""}
          <div class="card-body">
            <strong>${escapeHtml(g.title)}</strong>
            <span>${escapeHtml(g.description)}</span>
          </div>
        </button>`
        )
        .join("")}
    </div>
  `;
}

function showHub() {
  setScreen("hub");
  overlay.classList.remove("hidden");
  renderHub();
}

// Full standalone apps (e.g. Google AI Studio builds) shown in an iframe.
function playWebGame(id) {
  const webGame = webGames.find((g) => g.id === id);
  if (!webGame) return;
  beginGameSession(webGame.id);
  setScreen("menu");
  overlay.classList.remove("hidden");
  overlay.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;width:100%;max-width:1100px;">
      <button class="auth-toggle" type="button" data-action="back-to-hub">← Back</button>
      <h1 style="margin:0;font-size:1.4rem;flex:1;text-align:left;">${escapeHtml(webGame.title)}</h1>
    </div>
    <iframe
      src="${webGame.url}"
      title="${escapeHtml(webGame.title)}"
      style="width:100%;max-width:1100px;flex:1;min-height:0;border:1px solid #334155;border-radius:12px;background:#0f172a;"
      allow="fullscreen"
    ></iframe>
  `;
}

let activeAppUnmount = null;

// Built-in apps (see appGames above): mount their own DOM UI directly into
// #overlay instead of an <iframe> src.
function playAppGame(id) {
  const appGame = appGames.find((g) => g.id === id);
  if (!appGame) return;
  if (activeAppUnmount) {
    activeAppUnmount();
    activeAppUnmount = null;
  }
  beginGameSession(appGame.id);
  setScreen("menu");
  overlay.classList.remove("hidden");
  activeAppUnmount = appGame.mount(overlay, {
    onExit: () => {
      if (activeAppUnmount) {
        activeAppUnmount();
        activeAppUnmount = null;
      }
      endGameSession();
      showHub();
    },
  });
}

function exitToHub() {
  showHub();
}

let sessionRowId = null;
let sessionStartedAt = null;
const GUEST_ID_KEY = "fireBox.guestId.v1";

function getGuestId() {
  try {
    let id = localStorage.getItem(GUEST_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(GUEST_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

async function beginGameSession(gameId) {
  await endGameSession();
  sessionStartedAt = Date.now();
  try {
    const { data } = await supabase
      .from("game_sessions")
      .insert({
        user_id: currentUser?.id ?? null,
        guest_id: getGuestId(),
        game_id: gameId,
        started_at: new Date(sessionStartedAt).toISOString(),
      })
      .select("id")
      .single();
    sessionRowId = data?.id ?? null;
  } catch (err) {
    console.warn("Could not record game session start.", err);
    sessionRowId = null;
  }
}

async function endGameSession() {
  if (!sessionRowId) {
    sessionStartedAt = null;
    return;
  }
  const rowId = sessionRowId;
  const durationSeconds = Math.round((Date.now() - sessionStartedAt) / 1000);
  sessionRowId = null;
  sessionStartedAt = null;
  try {
    await supabase
      .from("game_sessions")
      .update({ ended_at: new Date().toISOString(), duration_seconds: durationSeconds })
      .eq("id", rowId);
  } catch (err) {
    console.warn("Could not record game session end.", err);
  }
}

// Covers the one real gap in session tracking: a player closing the tab,
// hitting refresh, or navigating away mid-game never runs the normal
// quit flow, so endGameSession() above never fires and the row is stuck
// with a null ended_at/duration_seconds forever. A regular fetch (or the
// supabase-js client, which uses one) can get cancelled the instant the
// page starts unloading — `keepalive: true` is the browser-native way to
// let a request survive that, so this is a plain fetch straight to the
// REST endpoint rather than going through the supabase-js client.
function endGameSessionOnUnload() {
  if (!sessionRowId) return;
  const durationSeconds = Math.round((Date.now() - sessionStartedAt) / 1000);
  const url = `${SUPABASE_URL}/rest/v1/game_sessions?id=eq.${sessionRowId}`;
  try {
    fetch(url, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ ended_at: new Date().toISOString(), duration_seconds: durationSeconds }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
  sessionRowId = null;
  sessionStartedAt = null;
}
window.addEventListener("pagehide", endGameSessionOnUnload);

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
  } else if (action === "open-web-game") {
    playWebGame(btn.dataset.webId);
  } else if (action === "open-app-game") {
    playAppGame(btn.dataset.appId);
  } else if (action === "back-to-hub") {
    exitToHub();
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
