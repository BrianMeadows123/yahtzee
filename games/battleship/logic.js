// Pure Battleship logic. No I/O, no seat/socket concerns — mirrors the
// separation used in games/yahtzee/ and games/connectFour/.
//
// Unlike Yahtzee and Connect Four, this game's true state is NOT fully
// shareable with both players (each player's ship positions are hidden from
// the other until sunk) — see server.js's battleshipClientState for the
// per-seat view shaping that this asymmetry requires.

export const SIZE = 8;
export const FLEET = [4, 3, 3, 2]; // required ship lengths, any order

export function newGame(playerNames = ['Player 1', 'Player 2']) {
  return {
    phase: 'placing', // 'placing' | 'playing' | 'finished'
    players: playerNames.map((name) => ({ name, ships: null, ready: false })),
    shotsAt: [[], []], // shotsAt[seat] = shots fired AT that seat: {row, col, hit}
    currentPlayer: 0,
    winner: null,
  };
}

function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

function validateFleet(shipsCells) {
  const lengths = shipsCells.map((cells) => cells.length).sort((a, b) => a - b);
  const expected = [...FLEET].sort((a, b) => a - b);
  if (lengths.length !== expected.length || !lengths.every((l, i) => l === expected[i])) {
    throw new Error(`Fleet must be exactly these ship lengths: ${expected.join(', ')}`);
  }

  const occupied = new Set();
  for (const cells of shipsCells) {
    const rows = cells.map(([r]) => r);
    const cols = cells.map(([, c]) => c);
    const sameRow = rows.every((r) => r === rows[0]);
    const sameCol = cols.every((c) => c === cols[0]);
    if (!sameRow && !sameCol) throw new Error('Each ship must be a straight horizontal or vertical line');

    const sorted = (sameRow ? cols : rows).slice().sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) throw new Error('Each ship must occupy contiguous cells');
    }

    for (const [r, c] of cells) {
      if (!inBounds(r, c)) throw new Error('Ship placed out of bounds');
      const key = `${r},${c}`;
      if (occupied.has(key)) throw new Error('Ships cannot overlap');
      occupied.add(key);
    }
  }
}

// Submits one player's fleet. Once both players have placed, the game moves
// to the 'playing' phase automatically.
export function placeFleet(game, seat, shipsCells) {
  if (game.phase !== 'placing') throw new Error('Placement is already finished');
  validateFleet(shipsCells);
  game.players[seat].ships = shipsCells.map((cells) => ({ cells }));
  game.players[seat].ready = true;
  if (game.players.every((p) => p.ready)) game.phase = 'playing';
  return game;
}

export function isSunk(ship, shotsAgainstOwner) {
  return ship.cells.every(([r, c]) => shotsAgainstOwner.some((s) => s.row === r && s.col === c && s.hit));
}

// Fires at the opponent's board. Doesn't check whose turn it is — same as
// Yahtzee/Connect Four, that's server.js's job before calling in here. Throws
// on an invalid shot (matching the error-becomes-a-protocol-error pattern the
// other games use); returns { hit, sunkShip } so the caller can react (e.g.
// sound choice) without
// having to re-derive it from state.
export function fire(game, seat, row, col) {
  if (game.phase !== 'playing') throw new Error('Game is not in the playing phase');
  if (!inBounds(row, col)) throw new Error('Shot is out of bounds');

  const opponent = 1 - seat;
  const shots = game.shotsAt[opponent];
  if (shots.some((s) => s.row === row && s.col === col)) throw new Error('Already fired at that cell');

  const opponentShips = game.players[opponent].ships;
  const hitShip = opponentShips.find((ship) => ship.cells.some(([r, c]) => r === row && c === col));
  const hit = !!hitShip;
  shots.push({ row, col, hit });

  const sunkShip = hit && isSunk(hitShip, shots) ? hitShip : null;

  if (opponentShips.every((ship) => isSunk(ship, shots))) {
    game.phase = 'finished';
    game.winner = seat;
  } else {
    game.currentPlayer = opponent;
  }

  return { hit, sunkShip };
}
