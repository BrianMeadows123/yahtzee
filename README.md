# Yahtzee

A from-scratch, two-device Yahtzee clone built to play over the web — one host machine, two browsers, real-time sync. No accounts, no database, just open a link and roll.

## Features

- Full official Yahtzee rules: upper/lower sections, upper bonus (63+), Yahtzee bonus, and the joker rule for extra Yahtzees
- Real-time two-player sync over WebSockets — works across separate devices (tested iPhone + Android) on the same network or remotely via [Tailscale](https://tailscale.com/)
- Cryptographically secure dice rolls (`node:crypto`, not `Math.random()`)
- Reconnect-safe seating — a dropped connection doesn't permanently occupy a seat, and a "reset room" option is always available
- Pencil-and-paper scorecard aesthetic with realistic dice

## Running it

```bash
npm install
npm start
```

The server prints the local and LAN addresses to open on each device. For remote play across networks (not just the same Wi-Fi), put it behind something like Tailscale.

## Tests

```bash
npm test
```

Covers scoring rules and full turn/game state flow, including joker-rule edge cases.

## Stack

Plain Node.js (`node:http`, `ws`) on the server, no framework; vanilla JS/CSS on the client. No build step.

## Built with AI

This project was coded with [Claude](https://claude.com/claude-code) (Anthropic), from game logic through multiplayer networking to UI, in collaboration with the repo owner.

## Contributors

- Brian Meadows ([@BrianMeadows123](https://github.com/BrianMeadows123))
- [Claude](https://claude.com/claude-code) (Anthropic) — AI pair programmer
