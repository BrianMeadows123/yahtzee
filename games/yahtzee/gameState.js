import { randomInt } from 'node:crypto';
import {
  CATEGORIES, UPPER_CATEGORIES, naturalScore, jokerScore, isYahtzee,
  isScorecardComplete, emptyScorecard, grandTotal, upperSubtotal, upperBonus,
  lowerSubtotal, YAHTZEE_BONUS_AMOUNT,
} from './scoring.js';

const UPPER_NUMBER = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };
const MAX_ROLLS = 3;

// Cryptographically secure and uses rejection sampling internally, so there's
// no modulo bias — each face is exactly 1/6, same as Math.random() would be,
// but without even a theoretical predictability concern.
export function rollDie() {
  return randomInt(1, 7);
}

export function newGame(playerNames = ['Player 1', 'Player 2']) {
  return {
    players: playerNames.map((name) => ({ name, scorecard: emptyScorecard() })),
    currentPlayer: 0,
    dice: [1, 1, 1, 1, 1],
    held: [false, false, false, false, false],
    rollsRemaining: MAX_ROLLS,
    turnStarted: false, // becomes true after the first roll of the turn
    phase: 'playing', // 'playing' | 'finished'
    winner: null,
    log: [],
  };
}

function otherPlayer(game) {
  return (game.currentPlayer + 1) % game.players.length;
}

export function roll(game) {
  if (game.phase !== 'playing') throw new Error('Game is finished');
  if (game.rollsRemaining <= 0) throw new Error('No rolls remaining this turn');
  game.dice = game.dice.map((d, i) => (game.turnStarted && game.held[i] ? d : rollDie()));
  game.rollsRemaining -= 1;
  game.turnStarted = true;
  return game;
}

export function toggleHold(game, dieIndex) {
  if (game.phase !== 'playing') throw new Error('Game is finished');
  if (!game.turnStarted) throw new Error('Roll before holding dice');
  if (game.rollsRemaining <= 0) throw new Error('No rolls remaining; you must score');
  game.held[dieIndex] = !game.held[dieIndex];
  return game;
}

// Returns { category: { score, forced } } for every category still open to
// the current player this turn, applying the Yahtzee joker rule.
export function getScoreOptions(game) {
  if (!game.turnStarted) return {};
  const scorecard = game.players[game.currentPlayer].scorecard;
  const dice = game.dice;
  const openCategories = CATEGORIES.filter((c) => scorecard[c] === null);

  const rolledYahtzee = isYahtzee(dice);
  const yahtzeeBoxFilled = scorecard.yahtzee !== null;
  const yahtzeeBoxWasScored50 = scorecard.yahtzee === 50;

  if (rolledYahtzee && yahtzeeBoxFilled) {
    // Joker rule applies (regardless of whether the original yahtzee scored 50 or 0).
    const matchingUpper = UPPER_CATEGORIES.find((c) => UPPER_NUMBER[c] === dice[0]);
    const upperOpenForMatch = matchingUpper && scorecard[matchingUpper] === null;

    if (upperOpenForMatch) {
      // Must use the matching upper box.
      return { [matchingUpper]: { score: jokerScore(matchingUpper, dice), forced: true } };
    }
    // Otherwise any open category may be used; lower-section boxes score
    // their joker value, other upper boxes score 0 (dice don't match them).
    const options = {};
    for (const cat of openCategories) {
      options[cat] = { score: jokerScore(cat, dice), forced: false };
    }
    return options;
  }

  const options = {};
  for (const cat of openCategories) {
    options[cat] = { score: naturalScore(cat, dice), forced: false };
  }
  return options;
}

export function scoreCategory(game, category) {
  if (game.phase !== 'playing') throw new Error('Game is finished');
  if (!game.turnStarted) throw new Error('Roll before scoring');
  const options = getScoreOptions(game);
  if (!(category in options)) throw new Error(`Category not available: ${category}`);

  const player = game.players[game.currentPlayer];
  const dice = game.dice;
  const rolledYahtzee = isYahtzee(dice);
  const awardsBonus = rolledYahtzee && player.scorecard.yahtzee === 50;

  player.scorecard[category] = options[category].score;
  if (awardsBonus) player.scorecard.yahtzeeBonusCount += 1;

  game.log.push({
    player: game.currentPlayer,
    category,
    score: options[category].score,
    bonus: awardsBonus ? YAHTZEE_BONUS_AMOUNT : 0,
    dice: [...dice],
  });

  // Advance turn.
  game.dice = [1, 1, 1, 1, 1];
  game.held = [false, false, false, false, false];
  game.rollsRemaining = MAX_ROLLS;
  game.turnStarted = false;

  if (game.players.every((p) => isScorecardComplete(p.scorecard))) {
    game.phase = 'finished';
    game.winner = computeWinner(game);
  } else {
    game.currentPlayer = otherPlayer(game);
  }

  return game;
}

export function computeWinner(game) {
  const totals = game.players.map((p) => grandTotal(p.scorecard));
  if (totals[0] === totals[1]) return null; // tie
  return totals[0] > totals[1] ? 0 : 1;
}

export function summarize(scorecard) {
  return {
    upperSubtotal: upperSubtotal(scorecard),
    upperBonus: upperBonus(scorecard),
    lowerSubtotal: lowerSubtotal(scorecard),
    yahtzeeBonus: scorecard.yahtzeeBonusCount * YAHTZEE_BONUS_AMOUNT,
    total: grandTotal(scorecard),
  };
}
