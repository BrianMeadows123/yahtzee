import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  newGame as newYahtzeeGame, roll, toggleHold, scoreCategory, getScoreOptions, summarize,
} from './games/yahtzee/gameState.js';
import { newGame as newConnectFourGame, dropPiece } from './games/connectFour/logic.js';
import { newGame as newBattleshipGame, placeFleet, fire, isSunk } from './games/battleship/logic.js';
import { newGame as newCheckersGame, move as moveCheckersPiece } from './games/checkers/logic.js';
import {
  recordGame, getStats, closeDb, saveSubscription, getSubscription, removeSubscription,
} from './db.js';
import { publicKey as vapidPublicKey, sendPush } from './push.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;
const DEFAULT_NAMES = ['Player 1', 'Player 2'];

// --- Rooms --------------------------------------------------------------------
// Each game gets its own independent room (seats, connections, game state) so
// switching what you're playing never loses progress on the other game, and
// "who's Player 1" is scoped per-game rather than global.
const ROOM_FACTORIES = {
  yahtzee: () => newYahtzeeGame(DEFAULT_NAMES),
  connectFour: () => newConnectFourGame(DEFAULT_NAMES),
  battleship: () => newBattleshipGame(DEFAULT_NAMES),
  checkers: () => newCheckersGame(DEFAULT_NAMES),
};

function createRoom(gameType) {
  return {
    gameType,
    game: ROOM_FACTORIES[gameType](),
    seats: [null, null], // seats[i] = token | null
    connections: new Map(), // ws -> { token }
  };
}

const rooms = {
  yahtzee: createRoom('yahtzee'),
  connectFour: createRoom('connectFour'),
  battleship: createRoom('battleship'),
  checkers: createRoom('checkers'),
};

function seatForToken(room, token) {
  return room.seats.indexOf(token);
}

function seatHasLiveConnection(room, seatIndex) {
  const seatToken = room.seats[seatIndex];
  if (!seatToken) return false;
  for (const conn of room.connections.values()) {
    if (conn.token === seatToken) return true;
  }
  return false;
}

// Claims an open seat for `token`. If both seats are taken but one belongs to
// a token with no currently-connected client (e.g. they closed the tab), that
// stale seat is handed to the new token instead — so a dropped connection
// doesn't permanently squat a seat, while an active player never gets bumped.
function claimOpenSeat(room, token) {
  const existing = seatForToken(room, token);
  if (existing !== -1) return existing;
  let target = room.seats.indexOf(null);
  if (target === -1) {
    target = room.seats.findIndex((_, i) => !seatHasLiveConnection(room, i));
  }
  if (target === -1) return -1;
  room.seats[target] = token;
  return target;
}

function resetRoom(room) {
  room.seats = [null, null];
  room.game = ROOM_FACTORIES[room.gameType]();
}

async function notifyTurn(room, title) {
  const token = room.seats[room.game.currentPlayer];
  if (!token) return;
  const subscription = getSubscription(token);
  if (!subscription) return;
  const name = room.game.players[room.game.currentPlayer].name;
  const ok = await sendPush(subscription, { title, body: `Your turn, ${name}!` });
  if (!ok) removeSubscription(token);
}

// --- Per-game client-state shaping ---------------------------------------------
function yahtzeeClientState(game) {
  return {
    game: {
      players: game.players.map((p) => ({
        name: p.name, scorecard: p.scorecard, summary: summarize(p.scorecard),
      })),
      currentPlayer: game.currentPlayer,
      dice: game.dice,
      held: game.held,
      rollsRemaining: game.rollsRemaining,
      turnStarted: game.turnStarted,
      phase: game.phase,
      winner: game.winner,
      log: game.log.slice(-5),
    },
    scoreOptions: getScoreOptions(game),
  };
}

function connectFourClientState(game) {
  return {
    game: {
      players: game.players.map((p) => ({ name: p.name })),
      board: game.board,
      currentPlayer: game.currentPlayer,
      phase: game.phase,
      winner: game.winner,
      winningCells: game.winningCells,
    },
  };
}

// Unlike Yahtzee/Connect Four, Battleship's true state can't be shared as one
// payload — each player's ship positions must stay hidden from the other
// until sunk. So this shapes a DIFFERENT view per viewing seat: your own
// fleet is always visible, the opponent's is not (only which of their cells
// you've hit/missed, plus the full shape of any ship you've fully sunk).
function battleshipClientState(game, seat) {
  const me = seat === 0 || seat === 1 ? seat : null;
  const opponent = me === null ? null : 1 - me;

  const myShips = me !== null && game.players[me].ships
    ? game.players[me].ships.map((s) => s.cells) : [];
  const shotsAgainstMe = me !== null ? game.shotsAt[me] : [];
  const myShots = opponent !== null ? game.shotsAt[opponent] : [];
  const enemySunkShips = opponent !== null && game.players[opponent].ships
    ? game.players[opponent].ships
      .filter((ship) => isSunk(ship, game.shotsAt[opponent]))
      .map((ship) => ship.cells)
    : [];

  return {
    game: {
      phase: game.phase,
      currentPlayer: game.currentPlayer,
      winner: game.winner,
      players: game.players.map((p) => ({ name: p.name, ready: p.ready })),
      myShips,
      shotsAgainstMe,
      myShots,
      enemySunkShips,
    },
  };
}

function checkersClientState(game) {
  return {
    game: {
      players: game.players.map((p) => ({ name: p.name })),
      board: game.board,
      currentPlayer: game.currentPlayer,
      mustContinueFrom: game.mustContinueFrom,
      phase: game.phase,
      winner: game.winner,
    },
  };
}

function clientState(room, seat) {
  if (room.gameType === 'yahtzee') return yahtzeeClientState(room.game);
  if (room.gameType === 'connectFour') return connectFourClientState(room.game);
  if (room.gameType === 'checkers') return checkersClientState(room.game);
  return battleshipClientState(room.game, seat);
}

function broadcast(room) {
  for (const [ws, conn] of room.connections) {
    if (ws.readyState !== ws.OPEN) continue;
    const seat = seatForToken(room, conn.token);
    ws.send(JSON.stringify({
      type: 'state',
      ...clientState(room, seat),
      seatsTaken: room.seats.map((s) => s !== null),
      you: { seat: seat === -1 ? null : seat, spectator: seat === -1 },
    }));
  }
}

function sendError(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', message }));
}

// --- Static file serving ------------------------------------------------------
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/lobby.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(reqPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e5) req.destroy(); // guard against absurd payloads
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function handleRequest(req, res) {
  const reqPath = req.url.split('?')[0];

  if (reqPath === '/api/stats') {
    sendJson(res, 200, getStats());
    return;
  }

  if (reqPath === '/api/vapid-public-key') {
    sendJson(res, 200, { publicKey: vapidPublicKey });
    return;
  }

  if (reqPath === '/api/push/subscribe' && req.method === 'POST') {
    try {
      const { token, subscription } = await readJsonBody(req);
      if (!token || !subscription) { sendJson(res, 400, { error: 'Missing token or subscription' }); return; }
      saveSubscription(token, subscription);
      sendJson(res, 200, { ok: true });
    } catch {
      sendJson(res, 400, { error: 'Bad request' });
    }
    return;
  }

  if (reqPath === '/api/push/unsubscribe' && req.method === 'POST') {
    try {
      const { token } = await readJsonBody(req);
      if (token) removeSubscription(token);
      sendJson(res, 200, { ok: true });
    } catch {
      sendJson(res, 400, { error: 'Bad request' });
    }
    return;
  }

  serveStatic(req, res);
}

const server = http.createServer(handleRequest);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const requestedRoom = url.searchParams.get('room');
  const roomName = requestedRoom in rooms ? requestedRoom : 'yahtzee';
  const room = rooms[roomName];
  const requestedToken = url.searchParams.get('token');
  const token = requestedToken || crypto.randomUUID();
  room.connections.set(ws, { token });

  claimOpenSeat(room, token); // auto-claim an open seat on first connect, if any
  ws.send(JSON.stringify({ type: 'welcome', token }));
  broadcast(room);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const mySeat = seatForToken(room, token); // recomputed fresh each message; seats can change

    if (msg.type === 'claimSeat') {
      if (claimOpenSeat(room, token) === -1) sendError(ws, 'No open seats.');
      broadcast(room);
      return;
    }
    if (msg.type === 'reinit') {
      resetRoom(room);
      claimOpenSeat(room, token); // whoever triggered it gets a seat back immediately
      broadcast(room);
      return;
    }
    if (msg.type === 'setName' && mySeat !== -1) {
      const name = String(msg.name || '').trim().slice(0, 24);
      if (name) room.game.players[mySeat].name = name;
      broadcast(room);
      return;
    }

    if (mySeat === -1) {
      sendError(ws, 'You are spectating; no open seats.');
      return;
    }
    // placeFleet happens during Battleship's setup phase, before there's a
    // "turn" at all — both players place independently, not in turn order.
    if (mySeat !== room.game.currentPlayer && msg.type !== 'newGame' && msg.type !== 'placeFleet') {
      sendError(ws, "It's not your turn.");
      return;
    }

    try {
      if (room.gameType === 'yahtzee') {
        if (msg.type === 'roll') {
          roll(room.game);
        } else if (msg.type === 'toggleHold') {
          toggleHold(room.game, msg.dieIndex);
        } else if (msg.type === 'score') {
          scoreCategory(room.game, msg.category);
          if (room.game.phase === 'finished') {
            recordGame(room.game, room.game.players.map((p) => summarize(p.scorecard)));
          } else {
            notifyTurn(room, 'Yahtzee'); // fire-and-forget — don't hold up the broadcast
          }
        } else if (msg.type === 'newGame') {
          room.game = newYahtzeeGame(room.game.players.map((p) => p.name));
        } else {
          sendError(ws, `Unknown message type: ${msg.type}`);
          return;
        }
      } else if (room.gameType === 'connectFour') {
        if (msg.type === 'drop') {
          dropPiece(room.game, msg.column);
          if (room.game.phase !== 'finished') notifyTurn(room, 'Connect Four');
        } else if (msg.type === 'newGame') {
          room.game = newConnectFourGame(room.game.players.map((p) => p.name));
        } else {
          sendError(ws, `Unknown message type: ${msg.type}`);
          return;
        }
      } else if (room.gameType === 'battleship') {
        if (msg.type === 'placeFleet') {
          placeFleet(room.game, mySeat, msg.ships);
          if (room.game.phase === 'playing') notifyTurn(room, 'Battleship'); // both fleets are in — game just started
        } else if (msg.type === 'fire') {
          fire(room.game, mySeat, msg.row, msg.col);
          if (room.game.phase !== 'finished') notifyTurn(room, 'Battleship');
        } else if (msg.type === 'newGame') {
          room.game = newBattleshipGame(room.game.players.map((p) => p.name));
        } else {
          sendError(ws, `Unknown message type: ${msg.type}`);
          return;
        }
      } else if (room.gameType === 'checkers') {
        if (msg.type === 'move') {
          const result = moveCheckersPiece(room.game, mySeat, msg.fromR, msg.fromC, msg.toR, msg.toC);
          // Mid multi-jump-chain, the turn hasn't actually passed yet — don't
          // push a "your turn" notification to the person still mid-move.
          if (room.game.phase !== 'finished' && !result.chainContinues) notifyTurn(room, 'Checkers');
        } else if (msg.type === 'newGame') {
          room.game = newCheckersGame(room.game.players.map((p) => p.name));
        } else {
          sendError(ws, `Unknown message type: ${msg.type}`);
          return;
        }
      }
    } catch (err) {
      sendError(ws, err.message);
      return;
    }
    broadcast(room);
  });

  ws.on('close', () => {
    room.connections.delete(ws);
    broadcast(room);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Game server running on port ${PORT}`);
  const nets = os.networkInterfaces();
  console.log('Open this on both devices (same Wi-Fi network):');
  for (const iface of Object.values(nets)) {
    for (const addr of iface || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        console.log(`  http://${addr.address}:${PORT}`);
      }
    }
  }
  console.log(`  http://localhost:${PORT} (this machine only)`);
});

function shutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down...`);
  const forceExit = setTimeout(() => process.exit(1), 3000);
  for (const room of Object.values(rooms)) {
    for (const ws of room.connections.keys()) ws.close(1001, 'Server restarting');
  }
  wss.close(() => {
    server.close(() => {
      closeDb();
      clearTimeout(forceExit);
      process.exit(0);
    });
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
