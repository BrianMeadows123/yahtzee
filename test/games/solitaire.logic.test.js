import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, draw, move, legalDestinations, autoMoveToFoundation, giveUp,
  seededShuffle, computeCardsHome, SUITS, rankLabel, isRed,
} from '../../games/solitaire/logic.js';

function card(rank, suit, faceUp = true) {
  return { rank, suit, faceUp };
}

test('the same seed always deals the same shuffle', () => {
  const a = newGame('2026-09-05', 'daily');
  const b = newGame('2026-09-05', 'daily');
  assert.deepEqual(a.tableau, b.tableau);
  assert.deepEqual(a.stock, b.stock);
});

test('different seeds deal different shuffles', () => {
  const a = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'seed-a');
  const b = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'seed-b');
  assert.notDeepEqual(a, b);
});

test('a fresh deal has 7 tableau columns of 1..7 cards with only the last face up, and a 24-card face-down stock', () => {
  const game = newGame('any-seed');
  for (let col = 0; col < 7; col++) {
    assert.equal(game.tableau[col].length, col + 1);
    game.tableau[col].forEach((c, i) => {
      assert.equal(c.faceUp, i === game.tableau[col].length - 1);
    });
  }
  assert.equal(game.stock.length, 24);
  assert.ok(game.stock.every((c) => !c.faceUp));
  assert.equal(game.waste.length, 0);
  SUITS.forEach((s) => assert.equal(game.foundations[s], 0));
  assert.equal(game.cardsHome, 0);
  assert.equal(game.phase, 'playing');
  assert.equal(game.won, false);

  const allCards = [...game.tableau.flat(), ...game.stock];
  assert.equal(allCards.length, 52);
});

test('a tableau move accepts descending rank with alternating color', () => {
  const game = newGame('seed');
  game.tableau[0] = [card(6, 'S')];
  game.tableau[1] = [card(5, 'H')];
  move(game, { pile: 'tableau', col: 1 }, { pile: 'tableau', col: 0 });
  assert.deepEqual(game.tableau[0], [card(6, 'S'), card(5, 'H')]);
  assert.equal(game.tableau[1].length, 0);
  assert.equal(game.moves, 1);
});

test('a tableau move rejects same-color or wrong-rank placement', () => {
  const game = newGame('seed');
  game.tableau[0] = [card(6, 'S')];
  game.tableau[1] = [card(5, 'C')]; // same color (black) as the 6 of spades
  assert.throws(() => move(game, { pile: 'tableau', col: 1 }, { pile: 'tableau', col: 0 }), /illegal/i);

  game.tableau[1] = [card(4, 'H')]; // wrong rank (not one lower)
  assert.throws(() => move(game, { pile: 'tableau', col: 1 }, { pile: 'tableau', col: 0 }), /illegal/i);
});

test('an empty tableau column only accepts a King', () => {
  const game = newGame('seed');
  game.tableau[0] = [];
  game.tableau[1] = [card(12, 'H')]; // Queen
  assert.throws(() => move(game, { pile: 'tableau', col: 1 }, { pile: 'tableau', col: 0 }), /illegal/i);

  game.tableau[1] = [card(13, 'S')]; // King
  move(game, { pile: 'tableau', col: 1 }, { pile: 'tableau', col: 0 });
  assert.deepEqual(game.tableau[0], [card(13, 'S')]);
});

test('foundations only accept an Ace first, then ascending same suit', () => {
  const game = newGame('seed');
  game.tableau[0] = [card(2, 'H')];
  assert.throws(() => move(game, { pile: 'tableau', col: 0 }, { pile: 'foundation', suit: 'H' }), /illegal/i);

  game.tableau[0] = [card(1, 'H')];
  move(game, { pile: 'tableau', col: 0 }, { pile: 'foundation', suit: 'H' });
  assert.equal(game.foundations.H, 1);
  assert.equal(game.cardsHome, 1);

  game.tableau[0] = [card(2, 'H')];
  move(game, { pile: 'tableau', col: 0 }, { pile: 'foundation', suit: 'H' });
  assert.equal(game.foundations.H, 2);

  game.tableau[0] = [card(4, 'H')]; // skips 3
  assert.throws(() => move(game, { pile: 'tableau', col: 0 }, { pile: 'foundation', suit: 'H' }), /illegal/i);
});

test('a valid multi-card run moves together onto a matching destination', () => {
  const game = newGame('seed');
  game.tableau[0] = [card(9, 'S'), card(8, 'H'), card(7, 'S')];
  game.tableau[1] = [card(9, 'C')]; // black 9 accepts the red-8/black-7 run
  move(game, { pile: 'tableau', col: 0, index: 1 }, { pile: 'tableau', col: 1 });
  assert.deepEqual(game.tableau[1], [card(9, 'C'), card(8, 'H'), card(7, 'S')]);
  assert.deepEqual(game.tableau[0], [card(9, 'S')]);
});

test('moving a face-down card is rejected', () => {
  const game = newGame('seed');
  game.tableau[0] = [card(9, 'S', false), card(7, 'H')];
  assert.throws(() => move(game, { pile: 'tableau', col: 0, index: 0 }, { pile: 'tableau', col: 1 }), /face-down/i);
});

test('grabbing a non-sequential run is rejected', () => {
  const game = newGame('seed');
  // 9-spades then 4-hearts is not a valid descending-alternating run
  game.tableau[0] = [card(9, 'S'), card(4, 'H')];
  game.tableau[1] = [card(10, 'H')];
  assert.throws(() => move(game, { pile: 'tableau', col: 0, index: 0 }, { pile: 'tableau', col: 1 }), /not a valid movable sequence/i);
});

test('moving the top card exposes and flips the next tableau card', () => {
  const game = newGame('seed');
  game.tableau[0] = [card(9, 'S', false), card(7, 'H')];
  game.tableau[1] = [card(8, 'S')];
  move(game, { pile: 'tableau', col: 0 }, { pile: 'tableau', col: 1 });
  assert.equal(game.tableau[0][0].faceUp, true);
});

test('draw moves the top of the stock to the waste, face up', () => {
  const game = newGame('seed');
  game.stock = [card(1, 'S', false), card(2, 'S', false)];
  game.waste = [];
  draw(game);
  assert.equal(game.stock.length, 1);
  assert.deepEqual(game.waste, [card(2, 'S', true)]);
});

test('drawing with an empty stock recycles the waste back into the stock', () => {
  const game = newGame('seed');
  game.stock = [];
  game.waste = [card(1, 'S'), card(2, 'S'), card(3, 'S')];
  draw(game);
  assert.equal(game.waste.length, 0);
  assert.deepEqual(game.stock, [card(3, 'S', false), card(2, 'S', false), card(1, 'S', false)]);
});

test('drawing with both stock and waste empty throws', () => {
  const game = newGame('seed');
  game.stock = [];
  game.waste = [];
  assert.throws(() => draw(game), /empty/i);
});

test('autoMoveToFoundation sends a card home when legal and throws otherwise', () => {
  const game = newGame('seed');
  game.waste = [card(1, 'D')];
  autoMoveToFoundation(game, { pile: 'waste' });
  assert.equal(game.foundations.D, 1);

  game.waste = [card(9, 'D')];
  assert.throws(() => autoMoveToFoundation(game, { pile: 'waste' }), /no legal foundation move/i);
});

test('a completed foundation (all 52 home) finishes the game as a win', () => {
  const game = newGame('seed');
  game.foundations = { S: 13, H: 13, D: 13, C: 12 };
  game.tableau[0] = [card(13, 'C')];
  move(game, { pile: 'tableau', col: 0 }, { pile: 'foundation', suit: 'C' });
  assert.equal(computeCardsHome(game.foundations), 52);
  assert.equal(game.cardsHome, 52);
  assert.equal(game.phase, 'finished');
  assert.equal(game.won, true);
});

test('giveUp finishes the game as a loss without touching cardsHome, and cannot be called twice', () => {
  const game = newGame('seed');
  game.cardsHome = 17;
  giveUp(game);
  assert.equal(game.phase, 'finished');
  assert.equal(game.won, false);
  assert.equal(game.cardsHome, 17);
  assert.throws(() => giveUp(game), /already finished/i);
});

test('no moves are legal once the game is finished', () => {
  const game = newGame('seed');
  giveUp(game);
  assert.throws(() => move(game, { pile: 'waste' }, { pile: 'foundation', suit: 'S' }), /already finished/i);
});

test('legalDestinations lists every matching tableau column plus a valid foundation', () => {
  const game = newGame('seed');
  game.waste = [card(1, 'S')];
  game.tableau = [[], [], [], [], [], [], []];
  const dests = legalDestinations(game, { pile: 'waste' });
  assert.deepEqual(dests.map((d) => d.pile), ['foundation']);
});

test('rankLabel and isRed cover the face cards and both colors', () => {
  assert.equal(rankLabel(1), 'A');
  assert.equal(rankLabel(11), 'J');
  assert.equal(rankLabel(12), 'Q');
  assert.equal(rankLabel(13), 'K');
  assert.equal(rankLabel(7), '7');
  assert.equal(isRed('H'), true);
  assert.equal(isRed('D'), true);
  assert.equal(isRed('S'), false);
  assert.equal(isRed('C'), false);
});
