# TODO

## Getting her set up
- [ ] She installs Tailscale and accepts the tailnet invite
- [ ] She opens `https://bmeadows-desktop.tail660078.ts.net` in Safari and adds it to her home screen (hostname changed back from `weplayyahtzee` on purpose — instructions file updated to match)
- [ ] First real game together, both devices, to confirm it actually works end to end

## Loose ends
- [x] Remove the `brain.net` search domain in the Tailscale admin console
- [x] Diagnosed "refused to connect" on phone — the `weplayyahtzee` hostname/URL was dead after the device was renamed back to `bmeadows-desktop`; serve config and instructions file now point at the current name
- [x] Confirmed the orphaned `weplayyahtzee` entry in `tailscale serve status` is inert (dead hostname, can't route real traffic) — can't be removed via CLI since it belongs to the old node identity, not worth chasing further

## Done: feel/redesign pass
- [x] Dice "rolling" animation (tumble/spin before settling on result)
- [x] Dice-on-felt rolling sound effect (real recorded SFX, credited in README)
- [x] Scratchpad/pencil sound effect when scoring
- [x] Non-intrusive score confirmation (tap-to-arm, tap-again-to-confirm) to prevent misclicks
- [x] Dark mode (defaults to system preference, overridable, per device)
- [x] Retro board-game-box redesign, replacing the paper-and-pencil look
- [x] Felt table background: tried a halftone-dot texture, removed it per feedback (too cluttered) — now a flat color, theme-aware (kraft-tan light / espresso dark)
- [x] Tiered visual hierarchy (design-reviewed and sketched up first): quiet scoreboard/inactive card/available buttons, bold active card/armed confirm, prominent roll button
- [x] Condensed header (sketched up first): theme toggle + reset room collapsed into corner icon buttons, turn banner + waiting text merged into one status line
- [x] Total color differentiation (sketched up first): teal = entered score, muted ink = subtotal math, avocado = any grand/running total

## Done: stats & history
- [x] Persist every finished game to a local SQLite DB (`node:sqlite`, no new dependency), grouped by player name so stats follow a person across games regardless of seat
- [x] `/stats.html` dashboard: win/loss record + avg score + bonus rates per player, a score-trend line chart, an average-score-per-category bar chart, and a recent-games table
- [x] Chart colors validated for colorblind-safe separation (dataviz skill's `validate_palette.js`) rather than reused verbatim from the UI's muted teal/rust — those read too gray as chart marks
- [x] Linked from the main game header (📊 icon)
- [x] Win/lose animation on the finished screen (sketched up first): confetti + bouncing "Winner" stamp for whoever's own seat won, a quiet muted "Good Game"/"Tie Game" stamp for the other viewer — plays once on the actual finish transition, not on every re-render

## Done: dev-proposed infra pass
- [x] Graceful shutdown — SIGTERM/SIGINT now close websocket connections cleanly and close the SQLite handle before exit, instead of just getting killed. Verified under both a manual test and a real systemd restart
- [x] Server/websocket integration tests (`test/server.test.js`) — spawns a real server on an isolated port/DB and drives it with actual `ws` clients: seat claiming, turn enforcement, stale-seat reclaiming, reinit, and a full game landing in `/api/stats`
- [x] PWA manifest + icons + service worker — home-screen install now launches full-screen with a real app icon (a die-face design, rendered deterministically via headless Chromium) instead of a bookmark glyph. Service worker has no offline caching (nothing useful works offline for a live multiplayer game) but is wired up for push notifications

- [x] Push notifications for "it's your turn" — bell icon in the header subscribes via the service worker; server notifies whoever's turn it becomes on every score event. VAPID keys auto-generated and persisted server-side, dead subscriptions dropped automatically.
- [x] Real-device check confirmed delivery works — notification lands in the tray/notification center. No heads-up banner pop-up though; added `vibrate` + `requireInteraction` to the service worker's `showNotification()` call, but banner-vs-tray-only is ultimately an OS-level per-app/per-site notification importance setting outside what the page can force. Worth checking the device's own notification settings for the site/PWA if the banner matters.

## Done: multi-game platform
- [x] Restructured into a small lobby ("/") + independent rooms per game — Yahtzee and Connect Four each have their own seats/state, so switching games never loses progress on the other
- [x] Connect Four built and shipped: full win detection (all 4 directions) and draw detection, exhaustively tested; reuses the existing design system, chart colors for the two pieces, and the win/lose stamp+confetti animation as-is
- [x] `game/` reorganized into `games/<name>/` to establish the per-game convention for future additions
- [ ] Note: this moved `/` from Yahtzee straight to the lobby — anyone who already added the old PWA to their home screen will now land on the lobby first instead of jumping straight into Yahtzee (one extra tap). Worth a heads up if that trips you up.

## Done: Battleship
- [x] Third game, a deliberate change of genre from dice/board games — hidden info + deduction instead of luck
- [x] Genuinely new architecture: per-seat state shaping (`clientState(room, seat)`, `broadcast()` computed per-connection) so each player's fleet stays hidden from the other until a ship is fully sunk — verified with a server-integration test that actually checks the wire payload, not just the pure logic
- [x] Interactive ship-placement phase (tray of 4 ships, rotate, hover preview, Ready button) sketched up first and approved before building
- [x] Hit/miss sound effects (real recorded SFX — splash / distant explosion — credited in README), reuses the existing win/lose stamp+confetti animation for the finished screen
- [x] Slots into the same games/<name>/ + independent-room pattern established for Connect Four
- [x] Shared win/lose sound effects (a fanfare + a "game over" sting) added to all three games' finished screens, not just Battleship — credited in README

## Done: Checkers
- [x] Fourth game — a design-sketch artifact (checkered board, chart-1/chart-2 pieces, live mandatory-capture dimming/pulse, king crown) was drafted and approved before building
- [x] Standard American rules, the part most quick clones get wrong: captures are mandatory, a multi-jump chain must continue with the same piece before the turn passes, and a piece that kings mid-capture stops immediately rather than continuing the chain
- [x] Fully-visible game state (no hidden info like Battleship), so the server side is much closer to Connect Four's pattern — no per-seat state shaping needed
- [x] Movement is drag-and-drop via Pointer Events (the same approach built for Battleship's ship placement) rather than click-to-select-then-click-to-move, per earlier feedback that direct manipulation reads clearer than a two-step click flow, especially on touch
- [x] Slots into the same games/<name>/ + independent-room pattern established for Connect Four and Battleship
- [x] Move/capture sound — started as a synthesized Web Audio "plunk", then swapped for a real recorded sound bite once the user provided one (trimmed to a single hit from a 6-hit "increasing force" sample pack), matching the other games' real-SFX pattern. Credited in README.

## Done: Solitaire
- [x] Fifth game, and architecturally the odd one out: single-player, so no room/seats/WebSocket — `games/solitaire/logic.js` is served statically and imported as a native ES module directly in the browser, and only touches the server via two REST endpoints to persist a finished game
- [x] Standard Klondike, draw-1, with the usual descending-alternating-color tableau runs (including multi-card "supermoves") and ascending-by-suit foundations
- [x] Free Play (unlimited, random deals) and a Wordle-style Today's Challenge (seeded off today's date, so both players get the identical deal) — one daily attempt per person enforced by a DB unique constraint, with a locked "already played today" screen on a repeat visit
- [x] Score is `cardsHome` (0-52) + moves + elapsed time rather than the old arcane Windows point formula — meaningful for a given-up game too, not just a win
- [x] Drag-and-drop reuses the Checkers/Battleship ghost-element + `elementFromPoint` Pointer Events pattern
- [x] Own leaderboard panel (🏆 icon) on the page itself: free-play stats per name, plus a daily-results table comparing both players day by day
- [ ] No dedicated move/draw sound yet — only the shared win/lose sounds are wired up so far

## Done: Solitaire follow-ups (readability, shared identity, guaranteed-winnable daily deal)
- [x] Stacked tableau cards were unreadable (covered cards only showed a ~22px sliver, and rank/suit text was centered) — switched to a corner index like a real playing card, so a covered card's visible sliver still shows its rank/suit
- [x] Shared Brian/Justy/Custom name picker (`public/name-picker.js`) replacing free-text name entry, added to **all five** games (Battleship and Checkers never had a name-editing UI before this at all) — one shared identity (`gamenight-name` in localStorage) auto-applied the moment you're seated in any game, so picking a name once shows up everywhere
- [x] The daily challenge deal is now guaranteed solvable, backed by an actual found winning move sequence — not a probability. `games/solitaire/solver.js` (greedy best-first search, reuses the real game logic as its step function) tries the plain date, then deterministic fallback seeds, caching whichever one solves in a new `daily_seeds` table. Calibrated against real dates: the plain date solves the large majority of the time, almost always within milliseconds; a fallback is rarely needed more than once or twice. Chunked to yield to the event loop so a same-day search never freezes other players' live games.
- [x] Undo button — an in-memory history stack (not persisted; a refresh loses undo history, not the game itself) snapshotted before every draw/move/auto-move-to-foundation, popped back on Undo. Doesn't rewind the clock or touch how a finished game gets scored.
