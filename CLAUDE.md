# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm start          # node server.js, listens on :3000 by default (PORT env var to override)
npm test           # node --test — recursively discovers test/**/*.test.js
```

Run a single test file directly, e.g. `node --test test/games/connectFour.logic.test.js`. Note: `node --test` with **no path argument** is required for recursive discovery — `node --test test/` (a directory) and `node --test test/*.test.js` (a non-recursive glob) both fail to find files nested under `test/games/`.

## CRITICAL: this app is live in daily use — never touch the real server carelessly

This isn't a toy repo. It's self-hosted for the owner and his girlfriend to actually play together in real time over Tailscale, as a `systemd --user` service (`yahtzee.service`, port 3000, state in `data/yahtzee.db`). Before any interactive/browser testing:

- **Always spin up an isolated instance on a different port with its own DB**, e.g.:
  `PORT=3099 DB_PATH=/tmp/.../qa.db VAPID_KEYS_PATH=/tmp/.../qa-vapid.json node server.js`
- **Never** connect to port 3000 or write to `data/yahtzee.db` for testing purposes.
- Restarting `yahtzee.service` (`systemctl --user restart yahtzee.service`) drops active connections and resets any **in-progress** game (games only persist once finished) — only do this when it's actually safe, and only when a *backend* file changed. Static files under `public/` are read fresh on every request, so pushing HTML/CSS/JS/asset changes needs no restart.
- A restart **is** required after editing `server.js`, `db.js`, `push.js`, or anything under `games/`.

## Architecture

### Rooms: one independent room per game
`server.js` runs every game as its own **independent room** (`rooms.yahtzee`, `rooms.connectFour`), each with its own `seats` (2-slot token array), `connections` (`Map<ws, {token}>`), and `game` state object. A WebSocket client selects its room via `?room=yahtzee` or `?room=connectFour` on the connection URL (defaults to `yahtzee`). Consequences worth knowing:
- Switching games never loses progress on the other — they're fully separate.
- "Who is seat 0" is scoped per room, not global.
- Seat-claiming/reconnect logic (`claimOpenSeat`, `seatHasLiveConnection`) is generic and shared by all rooms: a dropped connection's seat is reclaimed by a new token only once *both* seats appear full and the stale one has no live socket — an active player is never bumped.

### Per-game logic modules: pure, no I/O
Each game lives in `games/<name>/` as pure functions with zero knowledge of sockets, seats, or persistence (`games/yahtzee/gameState.js` + `scoring.js`, `games/connectFour/logic.js`). `server.js` is the only place that wires a game's functions into the WebSocket protocol, via a `room.gameType === '...'` branch in the message handler. This separation is what keeps `test/games/*.test.js` fast and independent of any server/socket setup.

To add a new game (Battleship is next — see TODO.md): write `games/<name>/logic.js` as pure state functions, add a `ROOM_FACTORIES` entry + a client-state shaper in `server.js`, add a message-type branch in the WS handler, and build `public/<name>.html` + `public/<name>.js` following the existing per-page client pattern below. Persistence/stats are opt-in per game — Connect Four intentionally has none yet.

### Client: static multi-page, no framework or bundler
Each page is a plain HTML file + matching JS file — `lobby.html`/`lobby.js`, `yahtzee.html` + `client.js`, `connect-four.html`/`connect-four.js`, `stats.html`/`stats.js` — all sharing `public/style.css`. There's real duplication across these JS files (theme toggle, the push-notification subscribe flow, service worker registration): that's deliberate per-page independence, not an oversight. Only extract a shared module if a third near-identical copy makes it obviously worth the coupling.

- WS protocol: connect to `/?room=<name>&token=<token>`. Server sends `{type:'welcome', token}` once, then `{type:'state', game, you:{seat, spectator}, seatsTaken, ...}` on every change (`scoreOptions` is Yahtzee-only). Client → server messages are `{type: 'roll'|'toggleHold'|'score'|...}` (Yahtzee) or `{type: 'drop', column}` (Connect Four), plus the shared `newGame`/`reinit`/`claimSeat`/`setName`.
- `token` persists in localStorage per game (`yahtzee-token`, `connectfour-token`) and round-trips on reconnect so a dropped connection can reclaim its seat.
- `yahtzee-theme` (light/dark) is shared across every page/game on purpose.

### Persistence & push (db.js, push.js)
- SQLite via `node:sqlite` (no dependency), file at `data/yahtzee.db` (gitignored — runtime data, not source). Only Yahtzee writes to it (`recordGame` on finish); `/api/stats` and `/stats.html` are Yahtzee-only.
- Push uses `web-push` + a VAPID keypair auto-generated on first run into `data/vapid-keys.json` (gitignored — the private key must stay secret). Subscriptions are stored keyed by seat **token**, not seat number, and are shared infra: any room can call `notifyTurn(room, title)` to push whoever's turn it now is.

### Design system (public/style.css)
Retro 1950s board-game-box look — deliberately not the paper-and-pencil aesthetic the project started with. Key tokens: `--panel`/`--ink` (card surface/text), `--mustard`/`--rust`/`--teal`/`--avocado` (accents), `--felt-dark` (table background, theme-aware). Alfa Slab One for headlines only; Poppins for everything else. Hard offset box-shadows (no blur) + thick borders instead of soft shadows. Visual weight is deliberately tiered — primary actions (Roll, an armed "Confirm?", the active player's card) get bold borders/shadows; secondary/passive elements (the scoreboard strip, the inactive player's card, an available-but-unarmed score button) stay flatter and quieter. `--chart-1`/`--chart-2` (used for stats charts and Connect Four's two pieces) are validated separately from the UI accent colors — `--teal` reads too gray as a data mark, so the chart pair was derived and checked with the dataviz skill's palette validator rather than reused verbatim.

## Testing notes
`test/server.test.js` and `test/games/connectFour.logic.test.js` spawn a real server process / exercise real win-detection logic against real WebSocket clients — see the in-file comments on the message-queue-draining helper (`trackMessages`/`seatedPair`). Every broadcast goes to *both* connected clients; a test that only drains the acting client's queue leaves the other one desynced the moment it becomes their turn.
