// Ember Ante — an original poker-scoring roguelike for FireBox.
//
// Not a canvas game: it doesn't use the shared reset/update/draw loop at
// all. Instead it's a self-contained DOM app (same idea as a shop screen,
// just for its whole lifetime) mounted into #overlay by main.js's
// playAppGame(), mirroring how Sovereign Chess takes over #overlay with an
// iframe. See mount() at the bottom.

const SAVE_KEY = "fireBox.emberAnte.save.v1";
const MAX_EMBERS = 5;
const FINAL_ANTE = 8;

const SUITS = [
  { id: "hearts", symbol: "♥", color: "red" },
  { id: "diamonds", symbol: "♦", color: "red" },
  { id: "clubs", symbol: "♣", color: "black" },
  { id: "spades", symbol: "♠", color: "black" },
];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; // 11=J 12=Q 13=K 14=A

function rankLabel(r) {
  return r === 14 ? "A" : r === 13 ? "K" : r === 12 ? "Q" : r === 11 ? "J" : String(r);
}
function rankChipValue(r) {
  return r === 14 ? 11 : r >= 11 ? 10 : r;
}
function cardId(card) {
  return `${card.suit.id}-${card.rank}`;
}
function freshDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ suit, rank, id: `${suit.id}-${rank}` });
  }
  return deck;
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------- Hand evaluation ----------------

const HAND_TYPES = {
  "high-card": { name: "High Card", baseChips: 5, baseMult: 1 },
  pair: { name: "Pair", baseChips: 10, baseMult: 2 },
  "two-pair": { name: "Two Pair", baseChips: 20, baseMult: 2 },
  "three-kind": { name: "Three of a Kind", baseChips: 30, baseMult: 3 },
  straight: { name: "Straight", baseChips: 30, baseMult: 4 },
  flush: { name: "Flush", baseChips: 35, baseMult: 4 },
  "full-house": { name: "Full House", baseChips: 40, baseMult: 4 },
  "four-kind": { name: "Four of a Kind", baseChips: 60, baseMult: 7 },
  "straight-flush": { name: "Straight Flush", baseChips: 100, baseMult: 8 },
};

function evaluateHand(cards) {
  const counts = {};
  for (const c of cards) counts[c.rank] = (counts[c.rank] || 0) + 1;
  const groups = Object.values(counts).sort((a, b) => b - a);
  const allSameSuit = cards.length === 5 && cards.every((c) => c.suit.id === cards[0].suit.id);

  let isStraight = false;
  if (cards.length === 5 && new Set(cards.map((c) => c.rank)).size === 5) {
    const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);
    isStraight = ranks[4] - ranks[0] === 4;
    if (!isStraight) {
      // Ace-low straight: A,2,3,4,5
      const lowAce = ranks.map((r) => (r === 14 ? 1 : r)).sort((a, b) => a - b);
      isStraight = lowAce[4] - lowAce[0] === 4 && new Set(lowAce).size === 5;
    }
  }

  let type;
  if (isStraight && allSameSuit) type = "straight-flush";
  else if (groups[0] === 4) type = "four-kind";
  else if (groups[0] === 3 && groups[1] === 2) type = "full-house";
  else if (allSameSuit) type = "flush";
  else if (isStraight) type = "straight";
  else if (groups[0] === 3) type = "three-kind";
  else if (groups[0] === 2 && groups[1] === 2) type = "two-pair";
  else if (groups[0] === 2) type = "pair";
  else type = "high-card";

  return { type, ...HAND_TYPES[type] };
}
function cardChipSum(cards) {
  return cards.reduce((sum, c) => sum + rankChipValue(c.rank), 0);
}

// ---------------- Embers (the Joker-equivalent modifier cards) ----------------

const EMBERS = [
  { id: "twin-flame", name: "Twin Flame", icon: "🔥", cost: 5, desc: "+4 Mult on a Pair", onScore: (ctx) => (ctx.handType === "pair" ? { chips: ctx.chips, mult: ctx.mult + 4 } : null) },
  { id: "triple-ember", name: "Triple Ember", icon: "🔺", cost: 6, desc: "+3 Mult on Three of a Kind", onScore: (ctx) => (ctx.handType === "three-kind" ? { chips: ctx.chips, mult: ctx.mult + 3 } : null) },
  { id: "flush-point", name: "Flush Point", icon: "💧", cost: 6, desc: "+15 Chips on a Flush", onScore: (ctx) => (ctx.handType === "flush" ? { chips: ctx.chips + 15, mult: ctx.mult } : null) },
  { id: "straight-shooter", name: "Straight Shooter", icon: "➰", cost: 6, desc: "+20 Chips on a Straight", onScore: (ctx) => (ctx.handType === "straight" ? { chips: ctx.chips + 20, mult: ctx.mult } : null) },
  { id: "full-tank", name: "Full Tank", icon: "🛢️", cost: 8, desc: "×1.5 Mult on a Full House", onScore: (ctx) => (ctx.handType === "full-house" ? { chips: ctx.chips, mult: ctx.mult * 1.5 } : null) },
  { id: "quad-core", name: "Quad Core", icon: "⚡", cost: 9, desc: "×2 Mult on Four of a Kind", onScore: (ctx) => (ctx.handType === "four-kind" ? { chips: ctx.chips, mult: ctx.mult * 2 } : null) },
  { id: "ace-high", name: "Ace High", icon: "🅰️", cost: 7, desc: "+8 Chips per Ace played", onScore: (ctx) => { const n = ctx.cards.filter((c) => c.rank === 14).length; return n ? { chips: ctx.chips + 8 * n, mult: ctx.mult } : null; } },
  { id: "face-value", name: "Face Value", icon: "👑", cost: 5, desc: "+3 Chips per face card (J/Q/K)", onScore: (ctx) => { const n = ctx.cards.filter((c) => c.rank >= 11 && c.rank <= 13).length; return n ? { chips: ctx.chips + 3 * n, mult: ctx.mult } : null; } },
  { id: "red-ember", name: "Red Ember", icon: "♥️", cost: 4, desc: "+2 Chips per red card played", onScore: (ctx) => { const n = ctx.cards.filter((c) => c.suit.color === "red").length; return n ? { chips: ctx.chips + 2 * n, mult: ctx.mult } : null; } },
  { id: "black-ember", name: "Black Ember", icon: "♠️", cost: 4, desc: "+2 Chips per black card played", onScore: (ctx) => { const n = ctx.cards.filter((c) => c.suit.color === "black").length; return n ? { chips: ctx.chips + 2 * n, mult: ctx.mult } : null; } },
  { id: "lucky-seven", name: "Lucky Seven", icon: "🍀", cost: 6, desc: "+7 Mult if your hand has a 7", onScore: (ctx) => (ctx.cards.some((c) => c.rank === 7) ? { chips: ctx.chips, mult: ctx.mult + 7 } : null) },
  { id: "high-roller", name: "High Roller", icon: "🎲", cost: 5, desc: "×2 Mult on High Card hands", onScore: (ctx) => (ctx.handType === "high-card" ? { chips: ctx.chips, mult: ctx.mult * 2 } : null) },
  { id: "momentum", name: "Momentum", icon: "📈", cost: 7, desc: "+1 Mult per hand already played this round", onScore: (ctx) => (ctx.run.handsPlayedThisRound ? { chips: ctx.chips, mult: ctx.mult + ctx.run.handsPlayedThisRound } : null) },
  { id: "economy-class", name: "Economy Class", icon: "💸", cost: 8, desc: "Shop prices reduced 15%", passive: true },
  { id: "second-chance", name: "Second Chance", icon: "🕊️", cost: 10, desc: "Once per run, survive a failed round with +1 hand", passive: true },
];
function emberById(id) {
  return EMBERS.find((e) => e.id === id);
}

// ---------------- Save data (persistent across runs) ----------------

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { sparks: 0, bestAnte: 0, perks: {} };
    const parsed = JSON.parse(raw);
    return {
      sparks: parsed.sparks || 0,
      bestAnte: parsed.bestAnte || 0,
      perks: parsed.perks && typeof parsed.perks === "object" ? parsed.perks : {},
    };
  } catch {
    return { sparks: 0, bestAnte: 0, perks: {} };
  }
}
function writeSave(save) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {}
}

const PERKS = [
  { id: "extra-hand", name: "Extra Hand", desc: "+1 hand to play per round", cost: 12 },
  { id: "extra-discard", name: "Extra Discard", desc: "+1 discard per round", cost: 10 },
  { id: "head-start", name: "Head Start", desc: "Start each run with a random Ember equipped", cost: 15 },
];

// ---------------- Round economy ----------------

function roundTarget(ante, round) {
  return Math.round(60 * Math.pow(1.45, ante - 1) * (1 + (round - 1) * 0.35));
}
function roundReward(round, handsLeft) {
  return 4 + handsLeft * 2 + round;
}
function emberCost(run, ember) {
  const mult = run.embers.includes("economy-class") ? 0.85 : 1;
  return Math.max(1, Math.round(ember.cost * mult));
}
function removeCardCost(run) {
  const mult = run.embers.includes("economy-class") ? 0.85 : 1;
  return Math.max(1, Math.round(5 * mult));
}

function drawCards(run, n) {
  const drawn = [];
  for (let i = 0; i < n; i++) {
    if (run.drawPile.length === 0) {
      if (run.discardPile.length === 0) break;
      run.drawPile = shuffle(run.discardPile);
      run.discardPile = [];
    }
    drawn.push(run.drawPile.pop());
  }
  return drawn;
}

function computeScore(run, cards) {
  const base = evaluateHand(cards);
  let chips = base.baseChips + cardChipSum(cards);
  let mult = base.baseMult;
  for (const id of run.embers) {
    const ember = emberById(id);
    if (ember?.onScore) {
      const result = ember.onScore({ run, handType: base.type, cards, chips, mult });
      if (result) {
        chips = result.chips;
        mult = result.mult;
      }
    }
  }
  return { ...base, chips, mult, total: Math.round(chips * mult) };
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------- The game ----------------

export function createEmberAnteGame() {
  let save = loadSave();
  let run = null;

  function startRun() {
    const handsPerRound = 4 + (save.perks["extra-hand"] ? 1 : 0);
    const discardsPerRound = 3 + (save.perks["extra-discard"] ? 1 : 0);
    run = {
      ante: 1,
      round: 1,
      coins: 0,
      deck: freshDeck(),
      drawPile: [],
      discardPile: [],
      hand: [],
      selected: [],
      embers: save.perks["head-start"] ? [EMBERS[Math.floor(Math.random() * EMBERS.length)].id] : [],
      secondChanceUsed: false,
      handsPerRound,
      discardsPerRound,
      handsLeft: handsPerRound,
      discardsLeft: discardsPerRound,
      handsPlayedThisRound: 0,
      roundScore: 0,
    };
    startRound();
  }

  function startRound() {
    run.drawPile = shuffle(run.deck);
    run.discardPile = [];
    run.hand = drawCards(run, 8);
    run.selected = [];
    run.handsLeft = run.handsPerRound;
    run.discardsLeft = run.discardsPerRound;
    run.handsPlayedThisRound = 0;
    run.roundScore = 0;
    renderPlaying();
  }

  function toggleCard(index) {
    const pos = run.selected.indexOf(index);
    if (pos >= 0) run.selected.splice(pos, 1);
    else if (run.selected.length < 5) run.selected.push(index);
    renderPlaying();
  }

  function playHand() {
    if (!run.selected.length) return;
    const indices = run.selected.slice().sort((a, b) => b - a);
    const playedCards = run.selected.map((i) => run.hand[i]);
    const result = computeScore(run, playedCards);
    for (const i of indices) {
      run.discardPile.push(run.hand[i]);
      run.hand.splice(i, 1);
    }
    run.hand.push(...drawCards(run, indices.length));
    run.selected = [];
    run.roundScore += result.total;
    run.handsPlayedThisRound += 1;
    run.handsLeft -= 1;

    if (run.roundScore >= roundTarget(run.ante, run.round)) {
      const coinsEarned = roundReward(run.round, run.handsLeft);
      run.coins += coinsEarned;
      renderRoundResult(true, result, coinsEarned);
      return;
    }
    if (run.handsLeft <= 0) {
      if (run.embers.includes("second-chance") && !run.secondChanceUsed) {
        run.secondChanceUsed = true;
        run.embers = run.embers.filter((id) => id !== "second-chance");
        run.handsLeft = 1;
        renderRoundResult(false, result, 0, true);
        return;
      }
      endRun(false);
      return;
    }
    renderRoundResult(false, result, 0, false);
  }

  function discardHand() {
    if (!run.selected.length || run.discardsLeft <= 0) return;
    const indices = run.selected.slice().sort((a, b) => b - a);
    for (const i of indices) {
      run.discardPile.push(run.hand[i]);
      run.hand.splice(i, 1);
    }
    run.hand.push(...drawCards(run, indices.length));
    run.selected = [];
    run.discardsLeft -= 1;
    renderPlaying();
  }

  function advanceRound() {
    if (run.round < 3) {
      run.round += 1;
    } else if (run.ante < FINAL_ANTE) {
      run.ante += 1;
      run.round = 1;
    } else {
      endRun(true);
      return;
    }
    startRound();
  }

  function endRun(won) {
    const anteReached = run.ante;
    if (anteReached > save.bestAnte) save.bestAnte = anteReached;
    save.sparks += anteReached;
    writeSave(save);
    renderGameOver(won, anteReached, run.round);
  }

  function buyEmber(id) {
    if (run.embers.length >= MAX_EMBERS || run.embers.includes(id)) return;
    const ember = emberById(id);
    const cost = emberCost(run, ember);
    if (run.coins < cost) return;
    run.coins -= cost;
    run.embers.push(id);
    renderShop();
  }

  function removeCard(id) {
    run.deck = run.deck.filter((c) => c.id !== id);
    renderShop();
  }

  let shopOffers = [];
  function rollShopOffers() {
    const pool = EMBERS.filter((e) => !run.embers.includes(e.id));
    shopOffers = shuffle(pool).slice(0, 3).map((e) => e.id);
  }

  // ---------------- Rendering ----------------

  let root = null;

  function cardHtml(card, index, selected) {
    return `
      <button class="playing-card ${card.suit.color} ${selected ? "selected" : ""}" data-ember-action="toggle-card" data-index="${index}">
        <span class="card-rank">${rankLabel(card.rank)}</span>
        <span class="card-suit">${card.suit.symbol}</span>
      </button>`;
  }

  function emberRowHtml(embers) {
    if (!embers.length) return `<p class="ember-empty">No Embers equipped yet</p>`;
    return `<div class="ember-row">${embers
      .map((id) => {
        const e = emberById(id);
        return `<span class="ember-chip" title="${esc(e.desc)}">${e.icon} ${esc(e.name)}</span>`;
      })
      .join("")}</div>`;
  }

  function renderPlaying() {
    const target = roundTarget(run.ante, run.round);
    const selectedCards = run.selected.map((i) => run.hand[i]);
    const preview = selectedCards.length ? computeScore(run, selectedCards) : null;
    root.innerHTML = `
      <div class="ember-screen">
        <div class="ember-topbar">
          <span>Ante ${run.ante} · Round ${run.round}/3</span>
          <span>Score ${run.roundScore} / ${target}</span>
          <span>Hands ${run.handsLeft} · Discards ${run.discardsLeft}</span>
          <span>🪙 ${run.coins}</span>
          <button class="secondary" data-ember-action="exit-to-menu">← Quit Run</button>
        </div>
        ${emberRowHtml(run.embers)}
        <div class="ember-preview">${
          preview ? `${preview.name} — ${preview.chips} chips × ${preview.mult} mult = <strong>${preview.total}</strong>` : "Select up to 5 cards"
        }</div>
        <div class="hand-tray">${run.hand.map((c, i) => cardHtml(c, i, run.selected.includes(i))).join("")}</div>
        <div class="ember-actions">
          <button class="secondary" data-ember-action="discard-hand" ${!run.selected.length || !run.discardsLeft ? "disabled" : ""}>Discard</button>
          <button data-ember-action="play-hand" ${!run.selected.length ? "disabled" : ""}>Play Hand</button>
        </div>
      </div>`;
  }

  function renderRoundResult(cleared, result, coinsEarned, savedBySecondChance) {
    root.innerHTML = `
      <div class="ember-screen">
        <div class="result-card ${cleared ? "is-best" : ""}">
          <span class="result-icon">${cleared ? "🏆" : savedBySecondChance ? "🕊️" : "🔥"}</span>
          <h1>${result.name}</h1>
          <p>${result.chips} chips × ${result.mult} mult = ${result.total} points</p>
          ${cleared ? `<p>Round cleared! +${coinsEarned} coins</p>` : ""}
          ${savedBySecondChance ? `<p>Second Chance saved your run — +1 hand</p>` : ""}
        </div>
        <button data-ember-action="${cleared ? "continue-shop" : "continue-playing"}">Continue →</button>
      </div>`;
  }

  function enterShop() {
    rollShopOffers();
    renderShop();
  }

  function renderShop() {
    root.innerHTML = `
      <div class="ember-screen">
        <h1>🔥 Ember Market</h1>
        <p>Ante ${run.ante} · Round ${run.round} next &nbsp;•&nbsp; 🪙 ${run.coins} &nbsp;•&nbsp; Embers ${run.embers.length}/${MAX_EMBERS}</p>
        <div class="game-grid">
          ${shopOffers
            .map((id) => {
              const e = emberById(id);
              const cost = emberCost(run, e);
              const owned = run.embers.includes(id);
              const disabled = owned || run.coins < cost || run.embers.length >= MAX_EMBERS;
              return `
              <div class="shop-card">
                <strong>${e.icon} ${esc(e.name)}</strong>
                <span>${esc(e.desc)}</span>
                <button data-ember-action="buy-ember" data-id="${e.id}" ${disabled ? "disabled" : ""}>${owned ? "✓ Owned" : `Buy — ${cost} coins`}</button>
              </div>`;
            })
            .join("")}
        </div>
        <button class="secondary" data-ember-action="open-remove-card">🗑️ Remove a Card — ${removeCardCost(run)} coins</button>
        <button data-ember-action="leave-shop">Continue to Round →</button>
        <button class="secondary" data-ember-action="exit-to-menu">Quit Run</button>
      </div>`;
  }

  function renderRemoveCard() {
    const cost = removeCardCost(run);
    const bySuit = SUITS.map(
      (suit) => `
      <div class="hand-tray small">
        ${run.deck
          .filter((c) => c.suit.id === suit.id)
          .sort((a, b) => a.rank - b.rank)
          .map((c) => `<button class="playing-card small ${c.suit.color}" data-ember-action="confirm-remove" data-id="${c.id}" ${run.coins < cost ? "disabled" : ""}><span class="card-rank">${rankLabel(c.rank)}</span><span class="card-suit">${c.suit.symbol}</span></button>`)
          .join("")}
      </div>`
    ).join("");
    root.innerHTML = `
      <div class="ember-screen">
        <h1>Remove a Card</h1>
        <p>Pick one card to permanently remove from your deck this run — ${cost} coins.</p>
        ${bySuit}
        <button class="secondary" data-ember-action="cancel-remove">Cancel</button>
      </div>`;
  }

  function renderGameOver(won, ante, round) {
    root.innerHTML = `
      <div class="ember-screen">
        <div class="result-card ${won ? "is-best" : ""}">
          <span class="result-icon">${won ? "🏆" : "💀"}</span>
          <h1>${won ? "Run Complete!" : "Run Over"}</h1>
          <p>Reached Ante ${ante} · Round ${round} — +${ante} Sparks earned</p>
          <p>✨ Total Sparks: ${save.sparks} ${save.bestAnte ? `· Best Ante: ${save.bestAnte}` : ""}</p>
        </div>
        <button data-ember-action="start-run">Play Again</button>
        <button class="secondary" data-ember-action="exit-to-menu">Back to Menu</button>
      </div>`;
  }

  function renderIntro() {
    root.innerHTML = `
      <div class="ember-screen">
        <h1>🔥 Ember Ante</h1>
        <p>Score poker hands, equip Embers, and survive escalating Antes.</p>
        <p>✨ Sparks: ${save.sparks} ${save.bestAnte ? `· Best Ante reached: ${save.bestAnte}` : ""}</p>
        <div class="upgrade-list">
          ${PERKS.map((p) => {
            const owned = !!save.perks[p.id];
            const disabled = owned || save.sparks < p.cost;
            return `
            <button data-ember-action="buy-perk" data-id="${p.id}" ${disabled ? "disabled" : ""}>
              ${owned ? "✓ " : ""}${esc(p.name)} — ${esc(p.desc)}${owned ? "" : ` (${p.cost} ✨)`}
            </button>`;
          }).join("")}
        </div>
        <button data-ember-action="start-run">▶️ Start Run</button>
        <button class="secondary" data-ember-action="exit-to-menu">← Back</button>
      </div>`;
  }

  function buyPerk(id) {
    const perk = PERKS.find((p) => p.id === id);
    if (!perk || save.perks[id] || save.sparks < perk.cost) return;
    save.sparks -= perk.cost;
    save.perks[id] = true;
    writeSave(save);
    renderIntro();
  }

  function mount(container, { onExit }) {
    root = container;
    save = loadSave();

    function handleClick(e) {
      const btn = e.target.closest("[data-ember-action]");
      if (!btn) return;
      const action = btn.dataset.emberAction;
      if (action === "start-run") startRun();
      else if (action === "buy-perk") buyPerk(btn.dataset.id);
      else if (action === "toggle-card") toggleCard(Number(btn.dataset.index));
      else if (action === "play-hand") playHand();
      else if (action === "discard-hand") discardHand();
      else if (action === "continue-shop") enterShop();
      else if (action === "continue-playing") renderPlaying();
      else if (action === "buy-ember") buyEmber(btn.dataset.id);
      else if (action === "open-remove-card") renderRemoveCard();
      else if (action === "confirm-remove") {
        if (run.coins < removeCardCost(run)) return;
        run.coins -= removeCardCost(run);
        removeCard(btn.dataset.id);
      } else if (action === "cancel-remove") renderShop();
      else if (action === "leave-shop") advanceRound();
      else if (action === "exit-to-menu") onExit();
    }
    root.addEventListener("click", handleClick);
    renderIntro();

    return function unmount() {
      root.removeEventListener("click", handleClick);
      root = null;
    };
  }

  return {
    id: "ember-ante",
    title: "Ember Ante",
    description: "Score poker hands, equip Embers, and survive escalating Antes in this original card roguelike.",
    thumbnail: "Asset/ember_ante_Thumbnail.png",
    mount,
  };
}
