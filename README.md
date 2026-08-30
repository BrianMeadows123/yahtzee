# Yahtzee

A Yahtzee game I built so my girlfriend and I could play from our phones (one iPhone, one Android) without installing anything. It runs as a small web server, real-time over WebSockets, so both people see rolls and scores update live on separate devices.

Follows the actual Yahtzee rules, including the joker rule for extra Yahtzees, which most quick clones online skip or get wrong.

## Running it

```bash
npm install
npm start
```

It'll print out addresses to open on each device. If you want to play from different networks (not just the same wifi), stick it behind Tailscale or something similar.

## Tests

```bash
npm test
```

Covers the scoring rules and the turn/game flow, including the joker rule edge cases since those are the easiest part to get wrong.

## Stack

Just Node (`node:http`, `ws`), no framework, no build step. Plain JS/CSS on the frontend.

## About the build

I built this with Claude doing most of the actual coding — game logic, the multiplayer/networking side, and the UI — while I drove requirements and testing. Wanted to be upfront about that rather than pretend otherwise.

## Contributors

- Brian Meadows ([@BrianMeadows123](https://github.com/BrianMeadows123))
- Claude (Anthropic) — did the coding
