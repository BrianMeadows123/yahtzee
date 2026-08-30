import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATEGORIES } from './games/yahtzee/scoring.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'yahtzee.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finished_at TEXT NOT NULL,
    winner_seat INTEGER
  );
  CREATE TABLE IF NOT EXISTS game_players (
    game_id INTEGER NOT NULL REFERENCES games(id),
    seat INTEGER NOT NULL,
    name TEXT NOT NULL,
    total INTEGER NOT NULL,
    upper_subtotal INTEGER NOT NULL,
    upper_bonus INTEGER NOT NULL,
    yahtzee_bonus INTEGER NOT NULL,
    PRIMARY KEY (game_id, seat)
  );
  CREATE TABLE IF NOT EXISTS game_categories (
    game_id INTEGER NOT NULL REFERENCES games(id),
    seat INTEGER NOT NULL,
    category TEXT NOT NULL,
    score INTEGER NOT NULL,
    PRIMARY KEY (game_id, seat, category)
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    token TEXT PRIMARY KEY,
    subscription TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// Push subscriptions are keyed by the seat token (the stable per-device
// identity already used for reconnection), not seat number — a seat's
// occupant can change day to day, but a browser's own subscription shouldn't.
export function saveSubscription(token, subscription) {
  db.prepare(`
    INSERT INTO push_subscriptions (token, subscription, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET subscription = excluded.subscription, updated_at = excluded.updated_at
  `).run(token, JSON.stringify(subscription), new Date().toISOString());
}

export function getSubscription(token) {
  const row = db.prepare('SELECT subscription FROM push_subscriptions WHERE token = ?').get(token);
  return row ? JSON.parse(row.subscription) : null;
}

export function removeSubscription(token) {
  db.prepare('DELETE FROM push_subscriptions WHERE token = ?').run(token);
}

// Records a just-finished game (both scorecards complete) for history/stats.
// Grouping by player NAME (not seat) elsewhere lets stats follow a person
// across games even though seats are just "whoever connected first."
export function recordGame(game, summaries) {
  const insertGame = db.prepare('INSERT INTO games (finished_at, winner_seat) VALUES (?, ?)');
  const insertPlayer = db.prepare(`
    INSERT INTO game_players (game_id, seat, name, total, upper_subtotal, upper_bonus, yahtzee_bonus)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertCategory = db.prepare(`
    INSERT INTO game_categories (game_id, seat, category, score) VALUES (?, ?, ?, ?)
  `);

  const { lastInsertRowid: gameId } = insertGame.run(new Date().toISOString(), game.winner);
  game.players.forEach((player, seat) => {
    const summary = summaries[seat];
    insertPlayer.run(gameId, seat, player.name, summary.total, summary.upperSubtotal, summary.upperBonus, summary.yahtzeeBonus);
    for (const category of CATEGORIES) {
      insertCategory.run(gameId, seat, category, player.scorecard[category] ?? 0);
    }
  });
}

export function getStats() {
  const players = db.prepare(`
    SELECT
      name,
      COUNT(*) AS gamesPlayed,
      AVG(total) AS avgTotal,
      SUM(CASE WHEN g.winner_seat = gp.seat THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN g.winner_seat IS NULL THEN 1 ELSE 0 END) AS ties,
      SUM(CASE WHEN g.winner_seat IS NOT NULL AND g.winner_seat != gp.seat THEN 1 ELSE 0 END) AS losses,
      SUM(CASE WHEN upper_bonus > 0 THEN 1 ELSE 0 END) AS upperBonusCount,
      SUM(CASE WHEN yahtzee_bonus > 0 THEN 1 ELSE 0 END) AS yahtzeeBonusCount
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    GROUP BY name
    ORDER BY gamesPlayed DESC
  `).all();

  const categoryAverages = db.prepare(`
    SELECT gp.name AS name, gc.category AS category, AVG(gc.score) AS avgScore
    FROM game_categories gc
    JOIN game_players gp ON gp.game_id = gc.game_id AND gp.seat = gc.seat
    GROUP BY gp.name, gc.category
  `).all();

  const trend = db.prepare(`
    SELECT g.id AS gameId, g.finished_at AS finishedAt, gp.name AS name, gp.total AS total
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    ORDER BY g.id ASC
  `).all();

  const recentGames = db.prepare(`
    SELECT g.id AS gameId, g.finished_at AS finishedAt, g.winner_seat AS winnerSeat,
           gp.seat AS seat, gp.name AS name, gp.total AS total
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    ORDER BY g.id DESC, gp.seat ASC
    LIMIT 40
  `).all();

  return { players, categoryAverages, trend, recentGames };
}

export function closeDb() {
  db.close();
}
