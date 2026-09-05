import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Integration tests against a real server process (isolated port + DB, never
// the dev/production ones) for Solitaire's two REST endpoints. Solitaire has
// no opponent to synchronize with, so unlike test/server.test.js there's no
// WebSocket involved at all here — just plain fetch calls.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, '..', 'server.js');
const TEST_DB = path.join(__dirname, 'tmp-solitaire-server-test.db');
const PORT = 39872;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess;

async function waitForReady(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/solitaire/stats`);
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
    setTimeout(resolve, 2000);
  });
  fs.rmSync(TEST_DB, { force: true });
});

function postResult(body) {
  return fetch(`${BASE_URL}/api/solitaire/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}
function getStats() {
  return fetch(`${BASE_URL}/api/solitaire/stats`).then((r) => r.json());
}

test('the logic module is served read-only as a plain ES module', async () => {
  const res = await fetch(`${BASE_URL}/games/solitaire/logic.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  const body = await res.text();
  assert.match(body, /export function newGame/);
});

test('a first daily submission is accepted and shows up in stats', async () => {
  const result = await postResult({
    name: 'Alice', mode: 'daily', seed: '2026-01-01', won: true, cardsHome: 52, moves: 120, elapsedSeconds: 400,
  });
  assert.deepEqual(result, { ok: true, accepted: true });

  const stats = await getStats();
  const row = stats.daily.find((r) => r.name === 'Alice' && r.seed === '2026-01-01');
  assert.ok(row);
  assert.equal(row.won, 1);
  assert.equal(row.cardsHome, 52);
});

test('a second submission for the same name/mode/seed is rejected, not overwritten', async () => {
  await postResult({
    name: 'Bob', mode: 'daily', seed: '2026-01-02', won: false, cardsHome: 10, moves: 5, elapsedSeconds: 20,
  });
  const second = await postResult({
    name: 'Bob', mode: 'daily', seed: '2026-01-02', won: true, cardsHome: 52, moves: 200, elapsedSeconds: 999,
  });
  assert.equal(second.accepted, false);

  const stats = await getStats();
  const row = stats.daily.find((r) => r.name === 'Bob' && r.seed === '2026-01-02');
  assert.equal(row.cardsHome, 10); // the first submission stands, not the second attempt
});

test('free-play submissions never collide since each game gets its own seed', async () => {
  await postResult({
    name: 'Carol', mode: 'free', seed: 'free-1', won: true, cardsHome: 52, moves: 90, elapsedSeconds: 300,
  });
  await postResult({
    name: 'Carol', mode: 'free', seed: 'free-2', won: false, cardsHome: 30, moves: 40, elapsedSeconds: 150,
  });
  const stats = await getStats();
  const row = stats.freePlay.find((p) => p.name === 'Carol');
  assert.equal(row.gamesPlayed, 2);
  assert.equal(row.wins, 1);
});

test('a result missing a required field is rejected with 400', async () => {
  const res = await fetch(`${BASE_URL}/api/solitaire/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Dave', mode: 'free' }), // no seed
  });
  assert.equal(res.status, 400);
});

test('the daily seed is resolved once and then cached for repeat calls on the same date', async () => {
  const first = await fetch(`${BASE_URL}/api/solitaire/daily-seed?date=2030-06-15`).then((r) => r.json());
  assert.ok(first.seed);
  const second = await fetch(`${BASE_URL}/api/solitaire/daily-seed?date=2030-06-15`).then((r) => r.json());
  assert.equal(second.seed, first.seed);
}, { timeout: 120000 }); // worst case tries several candidates against the solver; almost always resolves in well under a second

test('a malformed date is rejected with 400', async () => {
  const res = await fetch(`${BASE_URL}/api/solitaire/daily-seed?date=not-a-date`);
  assert.equal(res.status, 400);
});
