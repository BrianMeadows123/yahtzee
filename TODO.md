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
