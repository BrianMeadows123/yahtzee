// Pure Klondike Solitaire logic. No I/O, no seat/socket concerns — mirrors the
// separation used in games/yahtzee/, games/connectFour/, games/battleship/,
// and games/checkers/. Unlike those, this module is ALSO imported directly by
// the browser as a native ES module (see server.js's /games/* static route)
// since solitaire has no opponent to synchronize with, so it runs entirely
// client-side rather than being wired into the WebSocket room protocol.
//
// Draw-1 rules: stock deals one card at a time to the waste; when the stock
// is empty, clicking again recycles the waste back into the stock (no limit
// on recycles). Tableau columns accept a descending, alternating-color run
// (or a King onto an empty column); foundations build up by suit from Ace.
// A "score" here is `cardsHome` (0-52, how many cards have reached a
// foundation) rather than the old arcane Windows point formula — it's
// meaningful for a lost/given-up game too, not just a win.

export const SUITS = ['S', 'H', 'D', 'C'];
const RED_SUITS = new Set(['H', 'D']);

export function isRed(suit) {
  return RED_SUITS.has(suit);
}

export function rankLabel(rank) {
  if (rank === 1) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return String(rank);
}

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) deck.push({ rank, suit, faceUp: false });
  }
  return deck;
}

// xmur3 string hash -> mulberry32 PRNG. Both are small, well-known,
// public-domain generators — written from scratch since nothing in this repo
// generates a randomized layout from a seed today (Battleship's fleet
// placement is player-driven, not generated).
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic shuffle: the same seed string always produces the same deck
// order, which is what makes the daily challenge comparable between players.
export function seededShuffle(deck, seed) {
  const rand = mulberry32(xmur3(String(seed))());
  const result = deck.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function computeCardsHome(foundations) {
  return SUITS.reduce((sum, s) => sum + foundations[s], 0);
}

// seed: a string — today's date ('YYYY-MM-DD') for mode:'daily', anything
// unique (e.g. crypto.randomUUID()) for mode:'free'.
export function newGame(seed, mode = 'free') {
  const deck = seededShuffle(buildDeck(), seed);
  const tableau = [];
  let cursor = 0;
  for (let col = 0; col < 7; col++) {
    const count = col + 1;
    const cards = deck.slice(cursor, cursor + count).map((c, i) => ({ ...c, faceUp: i === count - 1 }));
    tableau.push(cards);
    cursor += count;
  }
  const stock = deck.slice(cursor).map((c) => ({ ...c, faceUp: false }));
  return {
    phase: 'playing', // 'playing' | 'finished'
    mode,
    seed,
    tableau,
    foundations: { S: 0, H: 0, D: 0, C: 0 },
    stock,
    waste: [],
    moves: 0,
    cardsHome: 0,
    won: false,
  };
}

function topOf(pile) {
  return pile.length ? pile[pile.length - 1] : null;
}

function canStackTableau(leadCard, destTop) {
  if (!destTop) return leadCard.rank === 13; // empty column only accepts a King
  return destTop.rank === leadCard.rank + 1 && isRed(destTop.suit) !== isRed(leadCard.suit);
}

function canStackFoundation(card, foundations) {
  return card.rank === foundations[card.suit] + 1;
}

// Resolves what `source` refers to right now, throwing on anything that
// isn't actually there or isn't a legally-grabbable run. Returns the ordered
// array of cards that would move (length 1 for waste/foundation sources,
// 1+ for a tableau run).
function resolveSourceCards(state, source) {
  if (source.pile === 'waste') {
    const card = topOf(state.waste);
    if (!card) throw new Error('Waste is empty');
    return [card];
  }
  if (source.pile === 'foundation') {
    const top = state.foundations[source.suit];
    if (!top) throw new Error('Foundation is empty');
    return [{ rank: top, suit: source.suit, faceUp: true }];
  }
  if (source.pile === 'tableau') {
    const column = state.tableau[source.col];
    if (!column) throw new Error('No such tableau column');
    const idx = source.index ?? column.length - 1;
    if (idx < 0 || idx >= column.length) throw new Error('No card there');
    const run = column.slice(idx);
    if (!run.every((c) => c.faceUp)) throw new Error('Cannot move a face-down card');
    for (let i = 0; i < run.length - 1; i++) {
      if (!canStackTableau(run[i + 1], run[i])) throw new Error('Not a valid movable sequence');
    }
    return run;
  }
  throw new Error('Unknown source pile');
}

// All legal destination piles for whatever `source` currently points at.
export function legalDestinations(state, source) {
  const cards = resolveSourceCards(state, source);
  const leadCard = cards[0];
  const destinations = [];
  if (cards.length === 1 && canStackFoundation(leadCard, state.foundations)) {
    destinations.push({ pile: 'foundation', suit: leadCard.suit });
  }
  for (let col = 0; col < state.tableau.length; col++) {
    if (source.pile === 'tableau' && source.col === col) continue;
    if (canStackTableau(leadCard, topOf(state.tableau[col]))) destinations.push({ pile: 'tableau', col });
  }
  return destinations;
}

function sameDest(a, b) {
  if (a.pile !== b.pile) return false;
  return a.pile === 'foundation' ? a.suit === b.suit : a.col === b.col;
}

export function move(state, source, dest) {
  if (state.phase !== 'playing') throw new Error('Game is already finished');
  const cards = resolveSourceCards(state, source);
  const legal = legalDestinations(state, source).some((d) => sameDest(d, dest));
  if (!legal) throw new Error('Illegal move');

  if (source.pile === 'waste') {
    state.waste.pop();
  } else if (source.pile === 'foundation') {
    state.foundations[source.suit] -= 1;
  } else if (source.pile === 'tableau') {
    const column = state.tableau[source.col];
    const idx = source.index ?? column.length - 1;
    column.splice(idx, column.length - idx);
    const newTop = topOf(column);
    if (newTop) newTop.faceUp = true;
  }

  if (dest.pile === 'foundation') {
    state.foundations[dest.suit] += 1;
  } else {
    state.tableau[dest.col].push(...cards);
  }

  state.moves += 1;
  state.cardsHome = computeCardsHome(state.foundations);
  if (state.cardsHome === 52) {
    state.phase = 'finished';
    state.won = true;
  }
  return { moved: cards.length };
}

export function autoMoveToFoundation(state, source) {
  const foundationDest = legalDestinations(state, source).find((d) => d.pile === 'foundation');
  if (!foundationDest) throw new Error('No legal foundation move for that card');
  return move(state, source, foundationDest);
}

export function draw(state) {
  if (state.phase !== 'playing') throw new Error('Game is already finished');
  if (state.stock.length === 0 && state.waste.length === 0) throw new Error('Stock and waste are both empty');
  if (state.stock.length === 0) {
    state.stock = state.waste.reverse().map((c) => ({ ...c, faceUp: false }));
    state.waste = [];
    return;
  }
  const card = state.stock.pop();
  card.faceUp = true;
  state.waste.push(card);
}

export function giveUp(state) {
  if (state.phase !== 'playing') throw new Error('Game is already finished');
  state.phase = 'finished';
  state.won = false;
}
