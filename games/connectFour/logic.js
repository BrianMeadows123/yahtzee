// Pure Connect Four logic. No I/O, no seat/socket concerns — mirrors the
// separation used in games/yahtzee/.

export const ROWS = 6;
export const COLS = 7;

export function newGame(playerNames = ['Player 1', 'Player 2']) {
  return {
    players: playerNames.map((name) => ({ name })),
    board: Array.from({ length: ROWS }, () => Array(COLS).fill(null)), // null | 0 | 1
    currentPlayer: 0,
    phase: 'playing', // 'playing' | 'finished'
    winner: null, // 0 | 1 | null (null + phase 'finished' means a draw)
    winningCells: null, // [[row, col], ...] × 4, set only when there's a winner
  };
}

function isBoardFull(board) {
  return board[0].every((cell) => cell !== null);
}

const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];

function findWin(board, row, col, player) {
  for (const [dr, dc] of DIRECTIONS) {
    const cells = [[row, col]];
    let r = row + dr; let c = col + dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
      cells.push([r, c]); r += dr; c += dc;
    }
    r = row - dr; c = col - dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
      cells.unshift([r, c]); r -= dr; c -= dc;
    }
    if (cells.length >= 4) return cells.slice(0, 4);
  }
  return null;
}

// Drops the current player's piece into `column`; it falls to the lowest
// open row. Throws on an invalid move so the server can turn that into a
// protocol error the same way it does for Yahtzee.
export function dropPiece(game, column) {
  if (game.phase !== 'playing') throw new Error('Game is finished');
  if (!Number.isInteger(column) || column < 0 || column >= COLS) throw new Error('Invalid column');

  let row = -1;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (game.board[r][column] === null) { row = r; break; }
  }
  if (row === -1) throw new Error('Column is full');

  const player = game.currentPlayer;
  game.board[row][column] = player;

  const winningCells = findWin(game.board, row, column, player);
  if (winningCells) {
    game.phase = 'finished';
    game.winner = player;
    game.winningCells = winningCells;
  } else if (isBoardFull(game.board)) {
    game.phase = 'finished';
    game.winner = null;
  } else {
    game.currentPlayer = (player + 1) % 2;
  }
  return game;
}
