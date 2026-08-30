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

## Possible next polish (not started, just ideas)
- [ ] Win/lose animation on the finished screen
