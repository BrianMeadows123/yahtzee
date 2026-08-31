// Pure Checkers (American/English draughts) logic. No I/O, no seat/socket
// concerns — mirrors the separation used in games/yahtzee/, games/connectFour/,
// and games/battleship/.
//
// Rules implemented (the parts most quick clones get wrong):
//  - Captures are mandatory: if any capture is available for the player on
//    move, only capturing moves are legal — quiet moves are not offered.
//  - A multi-jump chain is mandatory: if the piece that just captured has a
//    further capture available, the SAME piece must keep capturing before
//    the turn passes to the other player.
//  - A piece that kings (reaches the far row) on a capturing move stops
//    there — it does not continue the chain in the same turn, even if a
//    further capture would otherwise be available.
//  - A player with no legal moves (no pieces, or every piece blocked) loses
//    — unlike chess, a stalemate is a loss, not a draw.

export const SIZE = 8;

export function isDark(r, c) {
  return (r + c) % 2 === 1;
}

export function newGame(playerNames = ['Player 1', 'Player 2']) {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (isDark(r, c)) board[r][c] = { player: 0, king: false };
    }
  }
  for (let r = SIZE - 3; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (isDark(r, c)) board[r][c] = { player: 1, king: false };
    }
  }
  return {
    phase: 'playing', // 'playing' | 'finished'
    board,
    players: playerNames.map((name) => ({ name })),
    currentPlayer: 0,
    mustContinueFrom: null, // [r, c] while mid multi-jump; restricts moves to that piece
    winner: null,
  };
}

function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}
function pieceDirections(piece) {
  if (piece.king) return [-1, 1];
  return piece.player === 0 ? [1] : [-1];
}

function captureMovesFrom(board, r, c) {
  const piece = board[r][c];
  const moves = [];
  for (const dr of pieceDirections(piece)) {
    for (const dc of [-1, 1]) {
      const midR = r + dr;
      const midC = c + dc;
      const toR = r + 2 * dr;
      const toC = c + 2 * dc;
      if (!inBounds(toR, toC)) continue;
      const mid = board[midR]?.[midC];
      if (mid && mid.player !== piece.player && board[toR][toC] === null) {
        moves.push({ from: [r, c], to: [toR, toC], captured: [midR, midC] });
      }
    }
  }
  return moves;
}
function simpleMovesFrom(board, r, c) {
  const piece = board[r][c];
  const moves = [];
  for (const dr of pieceDirections(piece)) {
    for (const dc of [-1, 1]) {
      const toR = r + dr;
      const toC = c + dc;
      if (inBounds(toR, toC) && board[toR][toC] === null) {
        moves.push({ from: [r, c], to: [toR, toC], captured: null });
      }
    }
  }
  return moves;
}
function allMovesOfKind(board, player, movesFrom) {
  const moves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const piece = board[r][c];
      if (piece && piece.player === player) moves.push(...movesFrom(board, r, c));
    }
  }
  return moves;
}

// All legal moves for `player` given the current game state, with the
// mandatory-capture and mandatory-chain-continuation rules applied.
export function legalMoves(game, player) {
  if (game.mustContinueFrom) {
    const [r, c] = game.mustContinueFrom;
    return captureMovesFrom(game.board, r, c);
  }
  const captures = allMovesOfKind(game.board, player, captureMovesFrom);
  if (captures.length > 0) return captures;
  return allMovesOfKind(game.board, player, simpleMovesFrom);
}

export function move(game, seat, fromR, fromC, toR, toC) {
  if (game.phase !== 'playing') throw new Error('Game is already finished');
  if (game.mustContinueFrom) {
    const [mr, mc] = game.mustContinueFrom;
    if (fromR !== mr || fromC !== mc) throw new Error('Must continue capturing with the same piece');
  }
  const piece = game.board[fromR]?.[fromC];
  if (!piece || piece.player !== seat) throw new Error('No piece of yours at that square');

  const legal = legalMoves(game, seat)
    .find((m) => m.from[0] === fromR && m.from[1] === fromC && m.to[0] === toR && m.to[1] === toC);
  if (!legal) throw new Error('Illegal move');

  game.board[fromR][fromC] = null;
  game.board[toR][toC] = piece;
  if (legal.captured) {
    const [cr, cc] = legal.captured;
    game.board[cr][cc] = null;
  }

  const kingRow = piece.player === 0 ? SIZE - 1 : 0;
  const justKinged = toR === kingRow && !piece.king;
  if (justKinged) piece.king = true;

  if (legal.captured && !justKinged && captureMovesFrom(game.board, toR, toC).length > 0) {
    game.mustContinueFrom = [toR, toC];
    return { captured: true, chainContinues: true, kinged: justKinged };
  }

  game.mustContinueFrom = null;
  game.currentPlayer = 1 - seat;
  if (legalMoves(game, game.currentPlayer).length === 0) {
    game.phase = 'finished';
    game.winner = seat;
  }
  return { captured: !!legal.captured, chainContinues: false, kinged: justKinged };
}
