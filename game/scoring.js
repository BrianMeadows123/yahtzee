// Pure scoring functions for Yahtzee. No game-state/turn logic here.

export const CATEGORIES = [
  'ones', 'twos', 'threes', 'fours', 'fives', 'sixes',
  'threeOfAKind', 'fourOfAKind', 'fullHouse',
  'smallStraight', 'largeStraight', 'yahtzee', 'chance',
];

export const UPPER_CATEGORIES = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
const UPPER_NUMBER = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };

function counts(dice) {
  const c = [0, 0, 0, 0, 0, 0, 0]; // index 1..6
  for (const d of dice) c[d]++;
  return c;
}

function sum(dice) {
  return dice.reduce((a, b) => a + b, 0);
}

export function isYahtzee(dice) {
  const c = counts(dice);
  return c.some((n) => n === 5);
}

function hasN(dice, n) {
  const c = counts(dice);
  return c.some((count) => count >= n);
}

function hasFullHouseShape(dice) {
  const c = counts(dice).filter((n) => n > 0);
  return c.length === 2 && c.includes(3) && c.includes(2);
}

function hasStraight(dice, run) {
  const present = new Set(dice);
  for (let start = 1; start <= 6 - run + 1; start++) {
    let ok = true;
    for (let i = 0; i < run; i++) {
      if (!present.has(start + i)) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

// Natural (non-joker) score for a category given a 5-die roll.
export function naturalScore(category, dice) {
  switch (category) {
    case 'ones': case 'twos': case 'threes':
    case 'fours': case 'fives': case 'sixes': {
      const n = UPPER_NUMBER[category];
      return dice.filter((d) => d === n).length * n;
    }
    case 'threeOfAKind':
      return hasN(dice, 3) ? sum(dice) : 0;
    case 'fourOfAKind':
      return hasN(dice, 4) ? sum(dice) : 0;
    case 'fullHouse':
      return hasFullHouseShape(dice) ? 25 : 0;
    case 'smallStraight':
      return hasStraight(dice, 4) ? 30 : 0;
    case 'largeStraight':
      return hasStraight(dice, 5) ? 40 : 0;
    case 'yahtzee':
      return isYahtzee(dice) ? 50 : 0;
    case 'chance':
      return sum(dice);
    default:
      throw new Error(`Unknown category: ${category}`);
  }
}

// Score for a category under "joker rules": when the roll is a Yahtzee AND
// the yahtzee box on the scorecard is already filled (used), the lower
// section boxes score their fixed value regardless of actual dice shape,
// and upper section boxes other than the matching number score 0.
export function jokerScore(category, dice) {
  if (UPPER_CATEGORIES.includes(category)) {
    return naturalScore(category, dice); // matching number scores naturally, others score 0
  }
  switch (category) {
    case 'threeOfAKind':
    case 'fourOfAKind':
    case 'chance':
      return sum(dice); // all five dice are the same value, so this equals the natural score
    case 'fullHouse':
      return 25;
    case 'smallStraight':
      return 30;
    case 'largeStraight':
      return 40;
    case 'yahtzee':
      return 50;
    default:
      throw new Error(`Unknown category: ${category}`);
  }
}

export function upperSubtotal(scorecard) {
  return UPPER_CATEGORIES.reduce((acc, cat) => acc + (scorecard[cat] ?? 0), 0);
}

export const UPPER_BONUS_THRESHOLD = 63;
export const UPPER_BONUS_AMOUNT = 35;
export const YAHTZEE_BONUS_AMOUNT = 100;

export function upperBonus(scorecard) {
  return upperSubtotal(scorecard) >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_AMOUNT : 0;
}

export function lowerSubtotal(scorecard) {
  return CATEGORIES.filter((c) => !UPPER_CATEGORIES.includes(c))
    .reduce((acc, cat) => acc + (scorecard[cat] ?? 0), 0);
}

export function grandTotal(scorecard) {
  return upperSubtotal(scorecard) + upperBonus(scorecard) + lowerSubtotal(scorecard)
    + (scorecard.yahtzeeBonusCount ?? 0) * YAHTZEE_BONUS_AMOUNT;
}

export function isScorecardComplete(scorecard) {
  return CATEGORIES.every((cat) => scorecard[cat] !== null && scorecard[cat] !== undefined);
}

export function emptyScorecard() {
  const sc = { yahtzeeBonusCount: 0 };
  for (const cat of CATEGORIES) sc[cat] = null;
  return sc;
}
