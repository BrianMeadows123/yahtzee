import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  newGame, roll, toggleHold, scoreCategory, getScoreOptions, summarize,
} from './game/gameState.js';
import { recordGame, getStats, closeDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

// --- Single shared game room -------------------------------------------------
let game = newGame(['Player 1', 'Player 2']);
let seats = [null, null]; // seats[i] = token | null
const connections = new Map(); // ws -> { token }

function seatForToken(token) {
  return seats.indexOf(token);
}

function seatHasLiveConnection(seatIndex) {
  const seatToken = seats[seatIndex];
  if (!seatToken) return false;
  for (const conn of connections.values()) {
    if (conn.token === seatToken) return true;
  }
  return false;
}

// Claims an open seat for `token`. If both seats are taken but one belongs to
// a token with no currently-connected client (e.g. they closed the tab), that
// stale seat is handed to the new token instead — so a dropped connection
// doesn't permanently squat a seat, while an active player never gets bumped.
function claimOpenSeat(token) {
  const existing = seatForToken(token);
  if (existing !== -1) return existing;
  let target = seats.indexOf(null);
  if (target === -1) {
    target = seats.findIndex((_, i) => !seatHasLiveConnection(i));
  }
  if (target === -1) return -1;
  seats[target] = token;
  return target;
}

function resetRoom() {
  seats = [null, null];
  game = newGame(['Player 1', 'Player 2']);
}

function publicState() {
  return {
    game: {
      players: game.players.map((p) => ({
        name: p.name,
        scorecard: p.scorecard,
        summary: summarize(p.scorecard),
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
    seatsTaken: seats.map((s) => s !== null),
  };
}

function broadcast() {
  const shared = publicState();
  for (const [ws, conn] of connections) {
    if (ws.readyState !== ws.OPEN) continue;
    const seat = seatForToken(conn.token);
    ws.send(JSON.stringify({
      type: 'state',
      ...shared,
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
};

function serveStatic(req, res) {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';
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

function handleRequest(req, res) {
  const reqPath = req.url.split('?')[0];
  if (reqPath === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getStats()));
    return;
  }
  serveStatic(req, res);
}

const server = http.createServer(handleRequest);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const requestedToken = url.searchParams.get('token');
  const token = requestedToken || crypto.randomUUID();
  connections.set(ws, { token });

  claimOpenSeat(token); // auto-claim an open seat on first connect, if any
  const seat = seatForToken(token);
  ws.send(JSON.stringify({ type: 'welcome', token }));
  broadcast();

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const mySeat = seatForToken(token); // recomputed fresh each message; seats can change

    if (msg.type === 'claimSeat') {
      if (claimOpenSeat(token) === -1) sendError(ws, 'No open seats.');
      broadcast();
      return;
    }
    if (msg.type === 'reinit') {
      resetRoom();
      claimOpenSeat(token); // whoever triggered it gets a seat back immediately
      broadcast();
      return;
    }
    if (msg.type === 'setName' && mySeat !== -1) {
      const name = String(msg.name || '').trim().slice(0, 24);
      if (name) game.players[mySeat].name = name;
      broadcast();
      return;
    }

    if (mySeat === -1) {
      sendError(ws, 'You are spectating; no open seats.');
      return;
    }
    if (mySeat !== game.currentPlayer && msg.type !== 'newGame') {
      sendError(ws, "It's not your turn.");
      return;
    }

    try {
      if (msg.type === 'roll') {
        roll(game);
      } else if (msg.type === 'toggleHold') {
        toggleHold(game, msg.dieIndex);
      } else if (msg.type === 'score') {
        scoreCategory(game, msg.category);
        if (game.phase === 'finished') {
          recordGame(game, game.players.map((p) => summarize(p.scorecard)));
        }
      } else if (msg.type === 'newGame') {
        game = newGame(game.players.map((p) => p.name));
      } else {
        sendError(ws, `Unknown message type: ${msg.type}`);
        return;
      }
    } catch (err) {
      sendError(ws, err.message);
      return;
    }
    broadcast();
  });

  ws.on('close', () => {
    connections.delete(ws);
    broadcast();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Yahtzee server running on port ${PORT}`);
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
  for (const ws of connections.keys()) ws.close(1001, 'Server restarting');
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
