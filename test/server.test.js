import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Integration tests against a real server process (spawned on an isolated port
// and DB, never the dev/production ones) exercising the actual WebSocket
// protocol — seat claiming, turn flow, reconnection, and persistence — none of
// which the pure game-logic tests touch.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, '..', 'server.js');
const TEST_DB = path.join(__dirname, 'tmp-server-test.db');
const PORT = 39871;
const BASE_URL = `http://localhost:${PORT}`;

function wsUrl(room) {
  return `ws://localhost:${PORT}/${room ? `?room=${room}` : ''}`;
}

let serverProcess;

async function waitForReady(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/stats`); // a stable API route, not a static file that may not exist
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server did not become ready in time');
}

test.before(async () => {
  fs.rmSync(TEST_DB, { force: true });
  serverProcess = spawn('node', [SERVER_PATH], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: TEST_DB },
    stdio: 'ignore',
  });
  await waitForReady();
});

test.after(async () => {
  serverProcess.kill('SIGTERM');
  await new Promise((resolve) => {
    serverProcess.once('exit', resolve);
    setTimeout(resolve, 2000); // don't hang the test run if it misbehaves
  });
  fs.rmSync(TEST_DB, { force: true });
});

function connect(room) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(room));
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

// Queues every message a socket receives (in arrival order) so tests can
// `await next()` regardless of whether the message already arrived — avoids
// races with broadcasts triggered by OTHER clients' actions.
function trackMessages(ws) {
  const queue = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (waiters.length) waiters.shift()(msg);
    else queue.push(msg);
  });
  return {
    next: () => new Promise((resolve) => {
      if (queue.length) resolve(queue.shift());
      else waiters.push(resolve);
    }),
  };
}

function send(ws, payload) {
  ws.send(JSON.stringify(payload));
}

async function connectTracked(room) {
  const ws = await connect(room);
  return { ws, q: trackMessages(ws) };
}

// Connects two clients and drains every handshake message each of them
// receives — including the extra broadcast the FIRST client gets when the
// SECOND one joins — so both queues start the test empty and in sync.
async function seatedPair(room) {
  const a = await connectTracked(room);
  await a.q.next(); // welcome
  await a.q.next(); // state: seated alone
  const b = await connectTracked(room);
  await a.q.next(); // state: b joining broadcasts to a too
  await b.q.next(); // welcome
  await b.q.next(); // state: seated
  return [a, b];
}

test('two connections auto-claim seats 0 and 1; a third is a spectator', async () => {
  const [a, b] = await seatedPair();
  try {
    const c = await connectTracked();
    await c.q.next(); // welcome
    const stateC = await c.q.next();
    assert.equal(stateC.you.seat, null);
    assert.equal(stateC.you.spectator, true);
    c.ws.close();
  } finally {
    a.ws.close(); b.ws.close();
  }
});

test('acting out of turn is rejected with an error', async () => {
  const [a, b] = await seatedPair();
  try {
    send(b.ws, { type: 'roll' }); // seat 1, but seat 0 goes first
    const msg = await b.q.next();
    assert.equal(msg.type, 'error');
  } finally {
    a.ws.close(); b.ws.close();
  }
});

test('a full turn: roll, hold, reroll, score — turn advances to the other seat', async () => {
  const [a, b] = await seatedPair();
  try {
    send(a.ws, { type: 'roll' });
    let state = await a.q.next();
    assert.equal(state.game.turnStarted, true);
    assert.equal(state.game.rollsRemaining, 2);

    send(a.ws, { type: 'toggleHold', dieIndex: 0 });
    state = await a.q.next();
    assert.equal(state.game.held[0], true);
    const heldValue = state.game.dice[0];

    send(a.ws, { type: 'roll' });
    state = await a.q.next();
    assert.equal(state.game.rollsRemaining, 1);
    assert.equal(state.game.dice[0], heldValue); // held die didn't reroll

    const category = Object.keys(state.scoreOptions)[0];
    send(a.ws, { type: 'score', category });
    state = await a.q.next();
    assert.equal(state.game.currentPlayer, 1); // turn advanced
    assert.notEqual(state.game.players[0].scorecard[category], null);
  } finally {
    a.ws.close(); b.ws.close();
  }
});

test('a dropped connection\'s seat is reclaimed by a new client once both seats show full', async () => {
  const [a, b] = await seatedPair();
  let c;
  try {
    a.ws.close();
    await new Promise((r) => setTimeout(r, 200)); // let the server process the close

    c = await connectTracked();
    await c.q.next(); // welcome
    const stateC = await c.q.next();
    assert.equal(stateC.you.seat, 0); // stole A's stale seat
    assert.equal(stateC.you.spectator, false);
  } finally {
    c?.ws.close(); b.ws.close();
  }
});

test('reinit clears both seats and starts a fresh game', async () => {
  const [a, b] = await seatedPair();
  try {
    send(a.ws, { type: 'reinit' });
    const state = await a.q.next();
    assert.equal(state.game.phase, 'playing');
    assert.equal(state.game.players[0].scorecard.chance, null);
    assert.equal(state.you.seat, 0); // reinit triggerer gets a seat back immediately
  } finally {
    a.ws.close(); b.ws.close();
  }
});

test('a finished game is persisted and shows up in /api/stats', async () => {
  const [a, b] = await seatedPair();
  try {
    send(a.ws, { type: 'reinit' }); // clean slate for this test
    await a.q.next(); // a: reseated at 0
    await b.q.next(); // b: bumped to spectator by the reset

    send(b.ws, { type: 'claimSeat' });
    await b.q.next(); // b: reseated at 1
    await a.q.next(); // a: sees b rejoin

    const clients = [a, b];
    let current = 0;
    let state;
    // Every action broadcasts to BOTH clients, so both queues must be drained
    // on every step — otherwise whichever client isn't acting accumulates
    // stale messages that desync it the moment it becomes their turn.
    for (let round = 0; round < 40; round++) { // 26 turns expected; generous cap against infinite loop
      const client = clients[current];
      const other = clients[1 - current];
      send(client.ws, { type: 'roll' });
      [state] = await Promise.all([client.q.next(), other.q.next()]);
      const category = Object.keys(state.scoreOptions)[0];
      send(client.ws, { type: 'score', category });
      [state] = await Promise.all([client.q.next(), other.q.next()]);
      if (state.game.phase === 'finished') break;
      current = state.game.currentPlayer;
    }
    assert.equal(state.game.phase, 'finished');

    const stats = await fetch(`${BASE_URL}/api/stats`).then((r) => r.json());
    assert.ok(stats.players.length >= 2);
    assert.ok(stats.recentGames.length >= 2); // one row per player for the finished game
  } finally {
    a.ws.close(); b.ws.close();
  }
});

// --- Connect Four room: mostly protocol/routing checks — the win-detection
// logic itself is covered exhaustively in test/games/connectFour.logic.test.js.

test('connectFour and yahtzee are independent rooms — same names, different seats', async () => {
  const [a, b] = await seatedPair('connectFour');
  try {
    send(a.ws, { type: 'drop', column: 3 });
    const [state] = await Promise.all([a.q.next(), b.q.next()]);
    assert.equal(state.game.board[5][3], 0); // dropped to the bottom row
    assert.equal(state.game.currentPlayer, 1);
  } finally {
    a.ws.close(); b.ws.close();
  }
});

test('connectFour: acting out of turn is rejected', async () => {
  const [a, b] = await seatedPair('connectFour');
  try {
    send(a.ws, { type: 'reinit' }); // guarantee it's seat 0's turn, regardless of prior tests' board state
    await a.q.next(); await b.q.next();
    send(b.ws, { type: 'claimSeat' });
    await Promise.all([a.q.next(), b.q.next()]);

    send(b.ws, { type: 'drop', column: 0 }); // seat 1, but seat 0 goes first
    const msg = await b.q.next();
    assert.equal(msg.type, 'error');
  } finally {
    a.ws.close(); b.ws.close();
  }
});

test('connectFour: a full game (vertical win) reaches phase finished', async () => {
  const [a, b] = await seatedPair('connectFour');
  try {
    send(a.ws, { type: 'reinit' }); // clean board for this test
    await a.q.next(); await b.q.next();
    send(b.ws, { type: 'claimSeat' });
    await Promise.all([a.q.next(), b.q.next()]);

    const clients = [a, b];
    let state;
    // Player 0 stacks column 0 four times; player 1 plays column 1 in between
    // (irrelevant to the win) so turn order stays legal throughout.
    const moves = [[0, 0], [1, 1], [0, 0], [1, 1], [0, 0], [1, 1], [0, 0]];
    for (const [seat, column] of moves) {
      const client = clients[seat];
      const other = clients[1 - seat];
      send(client.ws, { type: 'drop', column });
      [state] = await Promise.all([client.q.next(), other.q.next()]);
      if (state.game.phase === 'finished') break;
    }
    assert.equal(state.game.phase, 'finished');
    assert.equal(state.game.winner, 0);
  } finally {
    a.ws.close(); b.ws.close();
  }
});
