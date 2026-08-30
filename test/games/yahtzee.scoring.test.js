import test from 'node:test';
import assert from 'node:assert/strict';
import {
  naturalScore, upperBonus, grandTotal, emptyScorecard, isScorecardComplete,
} from '../../games/yahtzee/scoring.js';

test('upper section scores count only matching dice', () => {
  assert.equal(naturalScore('fours', [4, 4, 2, 4, 6]), 12);
  assert.equal(naturalScore('sixes', [1, 2, 3, 4, 5]), 0);
});

test('three of a kind sums all dice only when a triple is present', () => {
  assert.equal(naturalScore('threeOfAKind', [3, 3, 3, 5, 6]), 20);
  assert.equal(naturalScore('threeOfAKind', [3, 3, 2, 5, 6]), 0);
});

test('four of a kind sums all dice only when four match', () => {
  assert.equal(naturalScore('fourOfAKind', [2, 2, 2, 2, 6]), 14);
  assert.equal(naturalScore('fourOfAKind', [2, 2, 2, 5, 6]), 0);
  // Five of a kind also satisfies "at least four of a kind".
  assert.equal(naturalScore('fourOfAKind', [5, 5, 5, 5, 5]), 25);
});

test('full house requires exactly a 3+2 split', () => {
  assert.equal(naturalScore('fullHouse', [2, 2, 3, 3, 3]), 25);
  assert.equal(naturalScore('fullHouse', [2, 2, 2, 2, 3]), 0); // four of a kind isn't a full house
  assert.equal(naturalScore('fullHouse', [5, 5, 5, 5, 5]), 0); // five of a kind isn't a full house naturally
});

test('small straight matches any 4-in-a-row run', () => {
  assert.equal(naturalScore('smallStraight', [1, 2, 3, 4, 6]), 30);
  assert.equal(naturalScore('smallStraight', [2, 3, 4, 5, 5]), 30);
  assert.equal(naturalScore('smallStraight', [1, 2, 4, 5, 6]), 0);
});

test('large straight requires all 5 consecutive', () => {
  assert.equal(naturalScore('largeStraight', [1, 2, 3, 4, 5]), 40);
  assert.equal(naturalScore('largeStraight', [2, 3, 4, 5, 6]), 40);
  assert.equal(naturalScore('largeStraight', [1, 2, 3, 4, 4]), 0);
});

test('yahtzee scores 50 for five of a kind, 0 otherwise', () => {
  assert.equal(naturalScore('yahtzee', [6, 6, 6, 6, 6]), 50);
  assert.equal(naturalScore('yahtzee', [6, 6, 6, 6, 5]), 0);
});

test('chance is always the sum of all dice', () => {
  assert.equal(naturalScore('chance', [1, 2, 3, 4, 5]), 15);
});

test('upper bonus of 35 kicks in at 63+', () => {
  const sc = emptyScorecard();
  sc.ones = 3; sc.twos = 6; sc.threes = 9; sc.fours = 12; sc.fives = 15; sc.sixes = 18; // 63
  assert.equal(upperBonus(sc), 35);
  sc.sixes = 17; // 62
  assert.equal(upperBonus(sc), 0);
});

test('grand total combines upper+bonus+lower+yahtzee bonuses', () => {
  const sc = emptyScorecard();
  sc.ones = 3; sc.twos = 6; sc.threes = 9; sc.fours = 12; sc.fives = 15; sc.sixes = 18; // 63 -> +35 bonus
  sc.threeOfAKind = 20; sc.fourOfAKind = 0; sc.fullHouse = 25; sc.smallStraight = 30;
  sc.largeStraight = 40; sc.yahtzee = 50; sc.chance = 24;
  sc.yahtzeeBonusCount = 2;
  const expectedUpper = 63 + 35;
  const expectedLower = 20 + 0 + 25 + 30 + 40 + 50 + 24;
  const expectedBonus = 200;
  assert.equal(grandTotal(sc), expectedUpper + expectedLower + expectedBonus);
});

test('scorecard completeness detection', () => {
  const sc = emptyScorecard();
  assert.equal(isScorecardComplete(sc), false);
  for (const k of Object.keys(sc)) if (k !== 'yahtzeeBonusCount') sc[k] = 0;
  assert.equal(isScorecardComplete(sc), true);
});
