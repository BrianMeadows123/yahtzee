# TODO

## Getting her set up
- [ ] She installs Tailscale and accepts the tailnet invite
- [ ] She opens `https://bmeadows-desktop.tail660078.ts.net` in Safari and adds it to her home screen (hostname changed back from `weplayyahtzee` on purpose — instructions file updated to match)
- [ ] First real game together, both devices, to confirm it actually works end to end

## Loose ends
- [x] Remove the `brain.net` search domain in the Tailscale admin console
- [x] Diagnosed "refused to connect" on phone — the `weplayyahtzee` hostname/URL was dead after the device was renamed back to `bmeadows-desktop`; serve config and instructions file now point at the current name
- [x] Confirmed the orphaned `weplayyahtzee` entry in `tailscale serve status` is inert (dead hostname, can't route real traffic) — can't be removed via CLI since it belongs to the old node identity, not worth chasing further

## Design follow-ups (sketch-ups before implementing)
- [ ] Reduce header chrome before gameplay — title, theme toggle, reset link, turn banner, waiting text, and player tiles all stack above the dice; consider de-emphasizing toggle/reset since they're used once a session, not every turn
- [ ] Teal is reused for scoreboard total, every entered score, and the grand total — only difference is font size. Brian doesn't see this as a problem currently, but wants a sketch-up explored anyway

## Done: feel/redesign pass
- [x] Dice "rolling" animation (tumble/spin before settling on result)
- [x] Dice-on-felt rolling sound effect (real recorded SFX, credited in README)
- [x] Scratchpad/pencil sound effect when scoring
- [x] Non-intrusive score confirmation (tap-to-arm, tap-again-to-confirm) to prevent misclicks
- [x] Dark mode (defaults to system preference, overridable, per device)
- [x] Retro board-game-box redesign, replacing the paper-and-pencil look
- [x] Felt table background: tried a halftone-dot texture, removed it per feedback (too cluttered) — now a flat color, theme-aware (kraft-tan light / espresso dark)
- [x] Tiered visual hierarchy (design-reviewed and sketched up first): quiet scoreboard/inactive card/available buttons, bold active card/armed confirm, prominent roll button

## Possible next polish (not started, just ideas)
- [ ] Win/lose animation on the finished screen
- [ ] Score history across multiple games (currently resets every game)
