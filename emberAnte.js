// Ember Ante — an original poker-scoring roguelike for FireBox.
//
// Not a canvas game: it doesn't use the shared reset/update/draw loop at
// all. Instead it's a self-contained DOM app (same idea as a shop screen,
// just for its whole lifetime) mounted into #overlay by main.js's
// playAppGame(), mirroring how Sovereign Chess takes over #overlay with an
// iframe. See mount() at the bottom.

const SAVE_KEY = "fireBox.emberAnte.save.v1";
const ACTIVE_RUN_KEY = "fireBox.emberAnte.activeRun.v1";
const FINAL_ANTE = 8;
const PACK_COST = 6;

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
  { id: "deuces-wild", name: "Deuces Wild", icon: "2️⃣", cost: 5, desc: "+3 Mult per 2 played", onScore: (ctx) => { const n = ctx.cards.filter((c) => c.rank === 2).length; return n ? { chips: ctx.chips, mult: ctx.mult + 3 * n } : null; } },
  { id: "tenfold", name: "Tenfold", icon: "🔟", cost: 5, desc: "+2 Chips per 10 played", onScore: (ctx) => { const n = ctx.cards.filter((c) => c.rank === 10).length; return n ? { chips: ctx.chips + 2 * n, mult: ctx.mult } : null; } },
  { id: "minimalist", name: "Minimalist", icon: "🎯", cost: 6, desc: "+8 Mult if you play exactly 1 card", onScore: (ctx) => (ctx.cards.length === 1 ? { chips: ctx.chips, mult: ctx.mult + 8 } : null) },
  { id: "full-spread", name: "Full Spread", icon: "🖐️", cost: 6, desc: "+15 Chips if you play exactly 5 cards", onScore: (ctx) => (ctx.cards.length === 5 ? { chips: ctx.chips + 15, mult: ctx.mult } : null) },
  { id: "even-steven", name: "Even Steven", icon: "🔷", cost: 6, desc: "+2 Mult per even-rank card played", onScore: (ctx) => { const n = ctx.cards.filter((c) => c.rank % 2 === 0).length; return n ? { chips: ctx.chips, mult: ctx.mult + 2 * n } : null; } },
  { id: "odd-fire", name: "Odd Fire", icon: "🔶", cost: 5, desc: "+2 Chips per odd-rank card played", onScore: (ctx) => { const n = ctx.cards.filter((c) => c.rank % 2 === 1).length; return n ? { chips: ctx.chips + 2 * n, mult: ctx.mult } : null; } },
  { id: "double-down", name: "Double Down", icon: "🎰", cost: 8, desc: "10% chance to double this hand's score", onScore: (ctx) => (Math.random() < 0.1 ? { chips: ctx.chips, mult: ctx.mult * 2 } : null) },
  { id: "interest", name: "Interest", icon: "💹", cost: 9, desc: "+1 coin per 5 coins held when you clear a round (max +5)", onRoundClear: (run) => Math.min(5, Math.floor(run.coins / 5)) },
  { id: "discard-rebate", name: "Discard Rebate", icon: "🔄", cost: 6, desc: "+1 coin each time you discard", onDiscard: () => 1 },
  { id: "last-stand", name: "Last Stand", icon: "🛡️", cost: 8, desc: "+15 Mult on your last hand this round", onScore: (ctx) => (ctx.run.handsLeft === 1 ? { chips: ctx.chips, mult: ctx.mult + 15 } : null) },
  { id: "opening-act", name: "Opening Act", icon: "🎬", cost: 8, desc: "+10 Mult on your first hand this round", onScore: (ctx) => (ctx.run.handsPlayedThisRound === 0 ? { chips: ctx.chips, mult: ctx.mult + 10 } : null) },
  { id: "flat-rate", name: "Flat Rate", icon: "➕", cost: 6, desc: "+50 Chips, always", onScore: (ctx) => ({ chips: ctx.chips + 50, mult: ctx.mult }) },
  { id: "multiplier-core", name: "Multiplier Core", icon: "✖️", cost: 9, desc: "×1.2 Mult, always", onScore: (ctx) => ({ chips: ctx.chips, mult: ctx.mult * 1.2 }) },
  { id: "heart-throb", name: "Heart Throb", icon: "💗", cost: 5, desc: "+5 Chips per Heart played", onScore: (ctx) => { const n = ctx.cards.filter((c) => c.suit.id === "hearts").length; return n ? { chips: ctx.chips + 5 * n, mult: ctx.mult } : null; } },
  { id: "diamond-mine", name: "Diamond Mine", icon: "💎", cost: 6, desc: "+1 Mult per Diamond played", onScore: (ctx) => { const n = ctx.cards.filter((c) => c.suit.id === "diamonds").length; return n ? { chips: ctx.chips, mult: ctx.mult + n } : null; } },
  { id: "clubhouse", name: "Clubhouse", icon: "♣️", cost: 5, desc: "+2 Chips per Club played", onScore: (ctx) => { const n = ctx.cards.filter((c) => c.suit.id === "clubs").length; return n ? { chips: ctx.chips + 2 * n, mult: ctx.mult } : null; } },
  { id: "spade-strike", name: "Spade Strike", icon: "♠️", cost: 6, desc: "+1 Mult per Spade played", onScore: (ctx) => { const n = ctx.cards.filter((c) => c.suit.id === "spades").length; return n ? { chips: ctx.chips, mult: ctx.mult + n } : null; } },
];
function emberById(id) {
  return EMBERS.find((e) => e.id === id);
}

// ---------------- Vouchers (one-time permanent upgrades for the run) ----------------

const VOUCHERS = [
  { id: "deep-pockets", name: "Deep Pockets", icon: "👛", cost: 10, desc: "+1 max Ember slot, this run", apply: (run) => { run.maxEmbers += 1; } },
  { id: "clearance-sale", name: "Clearance Sale", icon: "🏷️", cost: 10, desc: "Shop prices -20%, this run", apply: (run) => { run.discount *= 0.8; } },
  { id: "quick-draw", name: "Quick Draw", icon: "✋", cost: 10, desc: "+1 card in your hand, this run", apply: (run) => { run.handSize += 1; } },
  { id: "bankroll", name: "Bankroll", icon: "💰", cost: 6, desc: "Gain 15 coins immediately", apply: (run) => { run.coins += 15; } },
  { id: "steady-hand", name: "Steady Hand", icon: "🤲", cost: 9, desc: "+1 discard per round, this run", apply: (run) => { run.discardsPerRound += 1; } },
  { id: "wide-market", name: "Wide Market", icon: "🛒", cost: 11, desc: "+1 Ember offer in the shop, this run", apply: (run) => { run.shopEmberSlots += 1; } },
  { id: "overflow", name: "Overflow", icon: "🪣", cost: 11, desc: "+1 hand per round, this run", apply: (run) => { run.handsPerRound += 1; } },
  { id: "loan-shark", name: "Loan Shark", icon: "🦈", cost: 3, desc: "Gain 25 coins now, but shop prices +10% this run", apply: (run) => { run.coins += 25; run.discount *= 1.1; } },
  { id: "golden-touch", name: "Golden Touch", icon: "✨", cost: 12, desc: "+1 coin every hand you play, this run", apply: () => {} },
  { id: "trade-routes", name: "Trade Routes", icon: "🚢", cost: 8, desc: "Card removal costs half, this run", apply: () => {} },
  { id: "vault", name: "Vault", icon: "🔒", cost: 9, desc: "Gain 25 coins immediately", apply: (run) => { run.coins += 25; } },
  { id: "lucky-charm", name: "Lucky Charm", icon: "🍀", cost: 12, desc: "Spark Packs cost just 1 coin, this run", apply: () => {} },
];
function voucherById(id) {
  return VOUCHERS.find((v) => v.id === id);
}

// ---------------- Boss rounds (round 3 of every Ante gets a twist) ----------------

const BOSSES = [
  { id: "the-clock", name: "The Clock", icon: "⏰", desc: "No discards this round" },
  { id: "the-squeeze", name: "The Squeeze", icon: "🤏", desc: "-1 hand this round" },
  { id: "the-needle", name: "The Needle", icon: "📍", desc: "Only 1 hand, but the target is 40% lower" },
  { id: "the-frost", name: "The Frost", icon: "❄️", desc: "-2 cards in your hand this round" },
  { id: "the-giant", name: "The Giant", icon: "🗻", desc: "Target is 50% higher, but the reward doubles" },
  { id: "the-toll", name: "The Toll", icon: "💰", desc: "Costs 5 coins to enter this round" },
];
function bossById(id) {
  return BOSSES.find((b) => b.id === id);
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

// ---------------- Active-run persistence (so quitting mid-run is resumable) ----------------

function serializeCard(c) {
  return { suitId: c.suit.id, rank: c.rank, id: c.id };
}
function deserializeCard(c) {
  return { suit: SUITS.find((s) => s.id === c.suitId), rank: c.rank, id: c.id };
}
function saveActiveRun(run) {
  try {
    const data = {
      ...run,
      deck: run.deck.map(serializeCard),
      drawPile: run.drawPile.map(serializeCard),
      discardPile: run.discardPile.map(serializeCard),
      hand: run.hand.map(serializeCard),
    };
    localStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(data));
  } catch {}
}
function loadActiveRun() {
  try {
    const raw = localStorage.getItem(ACTIVE_RUN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      ...data,
      deck: data.deck.map(deserializeCard),
      drawPile: data.drawPile.map(deserializeCard),
      discardPile: data.discardPile.map(deserializeCard),
      hand: data.hand.map(deserializeCard),
    };
  } catch {
    return null;
  }
}
function clearActiveRun() {
  try {
    localStorage.removeItem(ACTIVE_RUN_KEY);
  } catch {}
}

// ---------------- Round economy ----------------

function roundTarget(run) {
  let t = Math.round(60 * Math.pow(1.45, run.ante - 1) * (1 + (run.round - 1) * 0.35));
  if (run.bossEffect === "the-needle") t = Math.round(t * 0.6);
  if (run.bossEffect === "the-giant") t = Math.round(t * 1.5);
  return t;
}
function previewNextRound(run) {
  if (run.round < 3) return { ante: run.ante, round: run.round + 1 };
  if (run.ante < FINAL_ANTE) return { ante: run.ante + 1, round: 1 };
  return { ante: run.ante, round: run.round, final: true };
}
function roundReward(run) {
  let r = 4 + run.handsLeft * 2 + run.round;
  if (run.bossEffect === "the-giant") r *= 2;
  return r;
}
function priceMultiplier(run) {
  let mult = run.discount || 1;
  if (run.embers.includes("economy-class")) mult *= 0.85;
  return mult;
}
function emberCost(run, ember) {
  return Math.max(1, Math.round(ember.cost * priceMultiplier(run)));
}
function voucherCost(run, voucher) {
  return Math.max(1, Math.round(voucher.cost * priceMultiplier(run)));
}
function removeCardCost(run) {
  let mult = priceMultiplier(run);
  if (run.purchasedVouchers?.includes("trade-routes")) mult *= 0.5;
  return Math.max(1, Math.round(5 * mult));
}
function packCost(run) {
  if (run.purchasedVouchers?.includes("lucky-charm")) return 1;
  return Math.max(1, Math.round(PACK_COST * priceMultiplier(run)));
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
function sortHandInPlace(run, mode) {
  if (mode === "suit") {
    run.hand.sort((a, b) => SUITS.findIndex((s) => s.id === a.suit.id) - SUITS.findIndex((s) => s.id === b.suit.id) || b.rank - a.rank);
  } else {
    run.hand.sort((a, b) => b.rank - a.rank);
  }
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
  let sortMode = "rank";
  let shopOffers = [];
  let packChoices = null;

  function startRun() {
    const handsPerRound = 4 + (save.perks["extra-hand"] ? 1 : 0);
    const discardsPerRound = 3 + (save.perks["extra-discard"] ? 1 : 0);
    run = {
      ante: 1,
      round: 1,
      coins: 0,
      maxEmbers: 5,
      handSize: 8,
      discount: 1,
      shopEmberSlots: 3,
      deck: freshDeck(),
      drawPile: [],
      discardPile: [],
      hand: [],
      selected: [],
      embers: save.perks["head-start"] ? [EMBERS[Math.floor(Math.random() * EMBERS.length)].id] : [],
      purchasedVouchers: [],
      bossEffect: null,
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

  function resumeRun() {
    const saved = loadActiveRun();
    if (!saved) return;
    run = saved;
    renderPlaying();
  }

  function startRound() {
    run.bossEffect = run.round === 3 ? shuffle(BOSSES)[0].id : null;
    let handSize = run.handSize;
    let handsThisRound = run.handsPerRound;
    let discardsThisRound = run.discardsPerRound;
    if (run.bossEffect === "the-squeeze") handsThisRound = Math.max(2, handsThisRound - 1);
    if (run.bossEffect === "the-needle") handsThisRound = 1;
    if (run.bossEffect === "the-clock") discardsThisRound = 0;
    if (run.bossEffect === "the-frost") handSize = Math.max(5, handSize - 2);
    if (run.bossEffect === "the-toll") run.coins = Math.max(0, run.coins - 5);

    run.drawPile = shuffle(run.deck);
    run.discardPile = [];
    run.hand = drawCards(run, handSize);
    sortHandInPlace(run, sortMode);
    run.selected = [];
    run.handsLeft = handsThisRound;
    run.discardsLeft = discardsThisRound;
    run.handsPlayedThisRound = 0;
    run.roundScore = 0;
    saveActiveRun(run);
    renderPlaying();
  }

  function setSortMode(mode) {
    sortMode = mode;
    sortHandInPlace(run, sortMode);
    saveActiveRun(run);
    renderPlaying();
  }

  function toggleCard(id) {
    const pos = run.selected.indexOf(id);
    if (pos >= 0) run.selected.splice(pos, 1);
    else if (run.selected.length < 5) run.selected.push(id);
    renderPlaying();
  }

  function playHand() {
    if (!run.selected.length) return;
    const playedCards = run.hand.filter((c) => run.selected.includes(c.id));
    const result = computeScore(run, playedCards);
    run.hand = run.hand.filter((c) => !run.selected.includes(c.id));
    run.discardPile.push(...playedCards);
    run.hand.push(...drawCards(run, playedCards.length));
    sortHandInPlace(run, sortMode);
    run.selected = [];
    run.roundScore += result.total;
    run.handsPlayedThisRound += 1;
    run.handsLeft -= 1;
    if (run.purchasedVouchers?.includes("golden-touch")) run.coins += 1;

    if (run.roundScore >= roundTarget(run)) {
      let coinsEarned = roundReward(run);
      for (const id of run.embers) {
        const e = emberById(id);
        if (e?.onRoundClear) coinsEarned += e.onRoundClear(run);
      }
      run.coins += coinsEarned;
      saveActiveRun(run);
      renderRoundResult(true, result, coinsEarned);
      return;
    }
    if (run.handsLeft <= 0) {
      if (run.embers.includes("second-chance") && !run.secondChanceUsed) {
        run.secondChanceUsed = true;
        run.embers = run.embers.filter((id) => id !== "second-chance");
        run.handsLeft = 1;
        saveActiveRun(run);
        renderRoundResult(false, result, 0, true);
        return;
      }
      endRun(false);
      return;
    }
    saveActiveRun(run);
    renderRoundResult(false, result, 0, false);
  }

  function discardHand() {
    if (!run.selected.length || run.discardsLeft <= 0) return;
    const discarded = run.hand.filter((c) => run.selected.includes(c.id));
    run.hand = run.hand.filter((c) => !run.selected.includes(c.id));
    run.discardPile.push(...discarded);
    run.hand.push(...drawCards(run, discarded.length));
    sortHandInPlace(run, sortMode);
    run.selected = [];
    run.discardsLeft -= 1;
    for (const id of run.embers) {
      const e = emberById(id);
      if (e?.onDiscard) run.coins += e.onDiscard(run);
    }
    saveActiveRun(run);
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
    clearActiveRun();
    renderGameOver(won, anteReached, run.round);
  }

  function buyEmber(id) {
    if (run.embers.length >= run.maxEmbers || run.embers.includes(id)) return;
    const ember = emberById(id);
    const cost = emberCost(run, ember);
    if (run.coins < cost) return;
    run.coins -= cost;
    run.embers.push(id);
    saveActiveRun(run);
    renderShop();
  }

  function buyVoucher(id) {
    if (run.purchasedVouchers.includes(id)) return;
    const voucher = voucherById(id);
    const cost = voucherCost(run, voucher);
    if (run.coins < cost) return;
    run.coins -= cost;
    run.purchasedVouchers.push(id);
    voucher.apply(run);
    saveActiveRun(run);
    renderShop();
  }

  function buyPack() {
    const cost = packCost(run);
    if (run.coins < cost) return;
    run.coins -= cost;
    const pool = EMBERS.filter((e) => !run.embers.includes(e.id));
    packChoices = shuffle(pool).slice(0, 2).map((e) => e.id);
    saveActiveRun(run);
    renderPackOpen();
  }

  function pickPackCard(id) {
    if (run.embers.length < run.maxEmbers && !run.embers.includes(id)) {
      run.embers.push(id);
      saveActiveRun(run);
    }
    packChoices = null;
    renderShop();
  }

  function removeCard(id) {
    run.deck = run.deck.filter((c) => c.id !== id);
    saveActiveRun(run);
    renderShop();
  }

  function rollShopOffers() {
    const pool = EMBERS.filter((e) => !run.embers.includes(e.id));
    shopOffers = shuffle(pool).slice(0, run.shopEmberSlots).map((e) => e.id);
  }
  function unpurchasedVoucher() {
    const pool = VOUCHERS.filter((v) => !run.purchasedVouchers.includes(v.id));
    if (!pool.length) return null;
    return shuffle(pool)[0].id;
  }

  // ---------------- Rendering ----------------

  let root = null;
  let voucherOffer = null;

  function cardHtml(card, selected, index) {
    const delay = index != null ? ` style="animation-delay:${Math.min(index, 8) * 0.035}s"` : "";
    return `
      <button class="playing-card ${card.suit.color} ${selected ? "selected" : ""}" data-ember-action="toggle-card" data-id="${card.id}"${delay}>
        <span class="card-rank">${rankLabel(card.rank)}</span>
        <span class="card-suit">${card.suit.symbol}</span>
      </button>`;
  }

  // Reusable "card art" shop tile -- a themed gradient panel with a large
  // centered icon, used for Embers, Vouchers and Spark Packs so each one
  // reads as an illustrated card instead of a line of small text.
  function shopCardHtml({ type, icon, name, desc, badge, button }) {
    return `
      <div class="shop-card ${type}">
        <div class="card-art">
          <span class="card-art-icon">${icon}</span>
        </div>
        <strong>${esc(name)}${badge ? ` <span class="voucher-tag">${esc(badge)}</span>` : ""}</strong>
        <span>${esc(desc)}</span>
        ${button}
      </div>`;
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

  function sidebarHtml(extraStat) {
    return `
      <div class="ember-sidebar">
        <div class="ember-stat-box">
          <span class="ember-stat-label">Round Score</span>
          <span class="ember-stat-value gold">${run.roundScore}</span>
        </div>
        <div class="ember-stat-row">
          <div class="ember-stat-box small"><span class="ember-stat-label">Hands</span><span class="ember-stat-value blue">${run.handsLeft}</span></div>
          <div class="ember-stat-box small"><span class="ember-stat-label">Discards</span><span class="ember-stat-value rose">${run.discardsLeft}</span></div>
        </div>
        <div class="ember-stat-box"><span class="ember-stat-label">Coins</span><span class="ember-stat-value gold">🪙 ${run.coins}</span></div>
        <div class="ember-stat-row">
          <div class="ember-stat-box small"><span class="ember-stat-label">Ante</span><span class="ember-stat-value violet">${run.ante}/${FINAL_ANTE}</span></div>
          <div class="ember-stat-box small"><span class="ember-stat-label">Round</span><span class="ember-stat-value teal">${run.round}/3</span></div>
        </div>
        ${extraStat || ""}
        <button class="secondary" data-ember-action="exit-to-menu">← Quit Run</button>
      </div>`;
  }

  function renderPlaying() {
    const target = roundTarget(run);
    const pct = Math.min(100, Math.round((run.roundScore / target) * 100));
    const selectedCards = run.hand.filter((c) => run.selected.includes(c.id));
    const preview = selectedCards.length ? computeScore(run, selectedCards) : null;
    const deckLeft = run.drawPile.length + run.discardPile.length;
    const boss = run.bossEffect ? bossById(run.bossEffect) : null;
    root.innerHTML = `
      <div class="ember-layout">
        ${sidebarHtml()}
        <div class="ember-main">
          ${boss ? `<div class="boss-banner">${boss.icon} <strong>${esc(boss.name)}</strong><span>${esc(boss.desc)}</span></div>` : ""}
          <div class="ember-blind-card">
            <span class="ember-blind-label">Round ${run.round} of 3</span>
            <span class="ember-blind-target">Score at least <strong>${target}</strong></span>
            <div class="ember-blind-bar"><div class="ember-blind-bar-fill" style="width:${pct}%"></div></div>
          </div>
          ${emberRowHtml(run.embers)}
          <div class="ember-preview">${
            preview ? `${preview.name} — ${preview.chips} chips × ${preview.mult} mult = <strong>${preview.total}</strong>` : "Select up to 5 cards"
          }</div>
          <div class="hand-tray">${run.hand.map((c, i) => cardHtml(c, run.selected.includes(c.id), i)).join("")}</div>
          <div class="ember-subrow">
            <div class="sort-row">
              <button class="chip-toggle ${sortMode === "rank" ? "active" : ""}" data-ember-action="sort-rank">Sort: Rank</button>
              <button class="chip-toggle ${sortMode === "suit" ? "active" : ""}" data-ember-action="sort-suit">Sort: Suit</button>
            </div>
            <span class="deck-indicator">🂠 ${deckLeft}/${run.deck.length} left</span>
          </div>
          <div class="ember-actions">
            <button class="secondary" data-ember-action="discard-hand" ${!run.selected.length || !run.discardsLeft ? "disabled" : ""}>Discard</button>
            <button data-ember-action="play-hand" ${!run.selected.length ? "disabled" : ""}>Play Hand</button>
          </div>
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
    voucherOffer = unpurchasedVoucher();
    renderShop();
  }

  function renderShop() {
    const voucher = voucherOffer ? voucherById(voucherOffer) : null;
    const next = previewNextRound(run);
    root.innerHTML = `
      <div class="ember-layout">
        ${sidebarHtml(`<div class="ember-stat-box"><span class="ember-stat-label">Next</span><span class="ember-stat-value">${next.final ? "Final Boss" : `Ante ${next.ante} · R${next.round}`}</span></div>`)}
        <div class="ember-main">
          <h1>🔥 Ember Market</h1>
          <p>Embers ${run.embers.length}/${run.maxEmbers}</p>
          <div class="game-grid">
            ${shopOffers
              .map((id) => {
                const e = emberById(id);
                const cost = emberCost(run, e);
                const owned = run.embers.includes(id);
                const disabled = owned || run.coins < cost || run.embers.length >= run.maxEmbers;
                return shopCardHtml({
                  type: "ember",
                  icon: e.icon,
                  name: e.name,
                  desc: e.desc,
                  button: `<button data-ember-action="buy-ember" data-id="${e.id}" ${disabled ? "disabled" : ""}>${owned ? "✓ Owned" : `Buy — ${cost} coins`}</button>`,
                });
              })
              .join("")}
            ${shopCardHtml({
              type: "pack",
              icon: "🎁",
              name: "Spark Pack",
              desc: "Open for a choice of 2 random Embers",
              button: `<button data-ember-action="buy-pack" ${run.coins < packCost(run) ? "disabled" : ""}>Open — ${packCost(run)} coins</button>`,
            })}
            ${
              voucher
                ? shopCardHtml({
                    type: "voucher",
                    icon: voucher.icon,
                    name: voucher.name,
                    badge: "Voucher",
                    desc: voucher.desc,
                    button: `<button data-ember-action="buy-voucher" data-id="${voucher.id}" ${run.coins < voucherCost(run, voucher) ? "disabled" : ""}>Buy — ${voucherCost(run, voucher)} coins</button>`,
                  })
                : ""
            }
          </div>
          <button class="secondary" data-ember-action="open-remove-card">🗑️ Remove a Card — ${removeCardCost(run)} coins</button>
          <button data-ember-action="leave-shop">Continue to Round →</button>
        </div>
      </div>`;
  }

  function renderPackOpen() {
    root.innerHTML = `
      <div class="ember-layout">
        ${sidebarHtml()}
        <div class="ember-main">
          <h1>🎁 Spark Pack</h1>
          <p>Pick one Ember to keep.</p>
          <div class="game-grid">
            ${packChoices
              .map((id) => {
                const e = emberById(id);
                const full = run.embers.length >= run.maxEmbers;
                return shopCardHtml({
                  type: "ember",
                  icon: e.icon,
                  name: e.name,
                  desc: e.desc,
                  button: `<button data-ember-action="pick-pack-card" data-id="${e.id}" ${full ? "disabled" : ""}>${full ? "Embers full" : "Pick"}</button>`,
                });
              })
              .join("")}
          </div>
          <button class="secondary" data-ember-action="skip-pack">Skip</button>
        </div>
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
      <div class="ember-layout">
        ${sidebarHtml()}
        <div class="ember-main">
          <h1>Remove a Card</h1>
          <p>Pick one card to permanently remove from your deck this run — ${cost} coins.</p>
          ${bySuit}
          <button class="secondary" data-ember-action="cancel-remove">Cancel</button>
        </div>
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
    const activeRun = loadActiveRun();
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
        ${activeRun ? `<button data-ember-action="continue-run">↻ Continue Run — Ante ${activeRun.ante} · Round ${activeRun.round}</button>` : ""}
        <button data-ember-action="start-run">▶️ New Run</button>
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
    root.classList.add("ember-theme");
    save = loadSave();

    function handleClick(e) {
      const btn = e.target.closest("[data-ember-action]");
      if (!btn) return;
      const action = btn.dataset.emberAction;
      if (action === "start-run") startRun();
      else if (action === "continue-run") resumeRun();
      else if (action === "buy-perk") buyPerk(btn.dataset.id);
      else if (action === "toggle-card") toggleCard(btn.dataset.id);
      else if (action === "sort-rank") setSortMode("rank");
      else if (action === "sort-suit") setSortMode("suit");
      else if (action === "play-hand") playHand();
      else if (action === "discard-hand") discardHand();
      else if (action === "continue-shop") enterShop();
      else if (action === "continue-playing") renderPlaying();
      else if (action === "buy-ember") buyEmber(btn.dataset.id);
      else if (action === "buy-voucher") buyVoucher(btn.dataset.id);
      else if (action === "buy-pack") buyPack();
      else if (action === "pick-pack-card") pickPackCard(btn.dataset.id);
      else if (action === "skip-pack") {
        packChoices = null;
        renderShop();
      } else if (action === "open-remove-card") renderRemoveCard();
      else if (action === "confirm-remove") {
        if (run.coins < removeCardCost(run)) return;
        run.coins -= removeCardCost(run);
        removeCard(btn.dataset.id);
      } else if (action === "cancel-remove") renderShop();
      else if (action === "leave-shop") advanceRound();
      else if (action === "exit-to-menu") {
        if (run) saveActiveRun(run);
        onExit();
      }
    }
    root.addEventListener("click", handleClick);
    renderIntro();

    return function unmount() {
      root.removeEventListener("click", handleClick);
      root.classList.remove("ember-theme");
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
