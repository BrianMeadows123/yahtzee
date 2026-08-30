const CATEGORY_LABELS = {
  ones: 'Aces', twos: 'Twos', threes: 'Threes', fours: 'Fours', fives: 'Fives', sixes: 'Sixes',
  threeOfAKind: '3 of a Kind', fourOfAKind: '4 of a Kind', fullHouse: 'Full House',
  smallStraight: 'Sm. Straight', largeStraight: 'Lg. Straight', yahtzee: 'Yahtzee', chance: 'Chance',
};
const CATEGORY_HINTS = {
  ones: 'count aces', twos: 'count 2s', threes: 'count 3s', fours: 'count 4s',
  fives: 'count 5s', sixes: 'count 6s', fullHouse: '25', smallStraight: '30',
  largeStraight: '40', yahtzee: '50',
};
const PIP_LAYOUTS = {
  1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9],
};
const UPPER = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
const LOWER = ['threeOfAKind', 'fourOfAKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance'];

const app = document.getElementById('app');

let token = localStorage.getItem('yahtzee-token');
let mySeat = null;
let isSpectator = true;
let latest = null;

const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${proto}//${location.host}/${token ? `?token=${encodeURIComponent(token)}` : ''}`;
let ws;

function connect() {
  ws = new WebSocket(wsUrl);
  ws.onopen = () => render();
  ws.onclose = () => {
    app.innerHTML = '<div class="center"><p>Disconnected. Reconnecting…</p></div>';
    setTimeout(connect, 1500);
  };
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'welcome') {
      token = msg.token;
      localStorage.setItem('yahtzee-token', token);
    } else if (msg.type === 'state') {
      latest = msg;
      mySeat = msg.you.seat;
      isSpectator = msg.you.spectator;
      render();
    } else if (msg.type === 'error') {
      flashError(msg.message);
    }
  };
}
connect();

function send(payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function flashError(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

function render() {
  if (!latest) return;
  const { game, scoreOptions, seatsTaken } = latest;
  const myTurn = mySeat === game.currentPlayer && !isSpectator;

  if (game.phase === 'finished') {
    renderFinished(game);
    return;
  }

  const canHold = game.turnStarted && game.rollsRemaining > 0 && myTurn;
  const canRoll = game.rollsRemaining > 0 && myTurn;

  const hasOpenSeat = seatsTaken.some((taken) => !taken);
  app.innerHTML = `
    <header>
      <div class="header-row">
        <h1>Yahtzee</h1>
        <button id="reset-btn" class="link-btn">Reset room</button>
      </div>
      <div class="turn-banner ${myTurn ? 'my-turn' : ''}">
        ${isSpectator ? 'Spectating' : myTurn ? "Your turn" : `Waiting for ${game.players[game.currentPlayer].name}`}
      </div>
      ${isSpectator && hasOpenSeat ? '<button id="join-btn">Join game</button>' : ''}
      ${!isSpectator && hasOpenSeat ? '<div class="waiting">Waiting for second player to join…</div>' : ''}
    </header>

    <section class="scoreboard">
      ${orderedSeats(game, mySeat).map((i) => scoreboardTile(game.players[i], i, game)).join('')}
    </section>

    <section class="dice-row">
      ${game.dice.map((d, i) => diceEl(d, game.held[i], i, canHold, game.turnStarted)).join('')}
    </section>

    <section class="controls">
      <button id="roll-btn" ${canRoll ? '' : 'disabled'}>
        ${game.turnStarted ? `Roll (${game.rollsRemaining} left)` : 'Roll dice'}
      </button>
      ${mySeat !== null && !isSpectator ? nameEditor(game.players[mySeat].name) : ''}
    </section>

    <section class="scorecards">
      ${orderedSeats(game, mySeat).map((i) => scorecardEl(game.players[i], i, game, scoreOptions, myTurn && i === mySeat)).join('')}
    </section>
  `;

  document.getElementById('roll-btn')?.addEventListener('click', () => send({ type: 'roll' }));
  document.getElementById('join-btn')?.addEventListener('click', () => send({ type: 'claimSeat' }));
  document.getElementById('reset-btn')?.addEventListener('click', () => {
    if (confirm('Reset the room? This clears both seats and starts a brand new game.')) {
      send({ type: 'reinit' });
    }
  });
  document.querySelectorAll('.die').forEach((el) => {
    el.addEventListener('click', () => {
      if (!canHold) return;
      send({ type: 'toggleHold', dieIndex: Number(el.dataset.index) });
    });
  });
  document.querySelectorAll('.score-btn').forEach((el) => {
    el.addEventListener('click', () => send({ type: 'score', category: el.dataset.category }));
  });
  document.getElementById('name-input')?.addEventListener('change', (e) => {
    send({ type: 'setName', name: e.target.value });
  });
}

function scoreboardTile(player, seatIndex, game) {
  return `
    <div class="scoreboard-tile ${seatIndex === game.currentPlayer ? 'active' : ''}">
      <span class="sb-name">${escapeHtml(player.name)}</span>
      <span class="sb-stat"><span class="sb-label">Upper</span><span class="sb-val">${player.summary.upperSubtotal + player.summary.upperBonus}</span></span>
      <span class="sb-stat"><span class="sb-label">Lower</span><span class="sb-val">${player.summary.lowerSubtotal + player.summary.yahtzeeBonus}</span></span>
      <span class="sb-stat total"><span class="sb-label">Total</span><span class="sb-val">${player.summary.total}</span></span>
    </div>
  `;
}

function orderedSeats(game, mySeat) {
  const indices = game.players.map((_, i) => i);
  if (mySeat === null) return indices; // spectators see the default order
  return [mySeat, ...indices.filter((i) => i !== mySeat)];
}

function diceEl(value, held, index, canHold, turnStarted) {
  if (!turnStarted) {
    return `<div class="die placeholder"></div>`;
  }
  const active = new Set(PIP_LAYOUTS[value]);
  const pips = Array.from({ length: 9 }, (_, i) => {
    const pos = i + 1;
    return `<span class="pip ${active.has(pos) ? 'on' : ''}"></span>`;
  }).join('');
  return `
    <div class="die ${held ? 'held' : ''} ${canHold ? 'clickable' : ''}" data-index="${index}">
      <div class="pip-grid">${pips}</div>
    </div>
  `;
}

function nameEditor(name) {
  return `<input id="name-input" type="text" value="${escapeHtml(name)}" maxlength="24" placeholder="Your name" />`;
}

function scorecardEl(player, seatIndex, game, scoreOptions, canScoreHere) {
  const rows = (cats) => cats.map((cat) => {
    const filled = player.scorecard[cat] !== null;
    const option = canScoreHere ? scoreOptions[cat] : undefined;
    const clickable = canScoreHere && !filled && option !== undefined;
    let valueHtml;
    if (filled) {
      valueHtml = `<span class="value">${player.scorecard[cat]}</span>`;
    } else if (clickable) {
      valueHtml = `<button class="score-btn ${option.forced ? 'forced' : ''}" data-category="${cat}">${option.score}</button>`;
    } else {
      valueHtml = `<span class="value empty">—</span>`;
    }
    const hint = CATEGORY_HINTS[cat] ? `<span class="hint">${CATEGORY_HINTS[cat]}</span>` : '';
    return `<div class="score-row"><span class="label">${CATEGORY_LABELS[cat]}${hint}</span>${valueHtml}</div>`;
  }).join('');

  return `
    <div class="scorecard ${seatIndex === game.currentPlayer ? 'active' : ''}">
      <h2>${escapeHtml(player.name)}</h2>
      ${rows(UPPER)}
      <div class="score-row subtotal"><span class="label">Upper total</span><span class="value">${player.summary.upperSubtotal}</span></div>
      <div class="score-row subtotal"><span class="label">Bonus (63+)</span><span class="value">${player.summary.upperBonus}</span></div>
      ${rows(LOWER)}
      ${player.scorecard.yahtzeeBonusCount > 0 ? `<div class="score-row subtotal"><span class="label">Yahtzee bonus ×${player.scorecard.yahtzeeBonusCount}</span><span class="value">${player.summary.yahtzeeBonus}</span></div>` : ''}
      <div class="score-row total"><span class="label">Total</span><span class="value">${player.summary.total}</span></div>
    </div>
  `;
}

function renderFinished(game) {
  const winnerText = game.winner === null
    ? "It's a tie!"
    : `${game.players[game.winner].name} wins!`;
  app.innerHTML = `
    <header>
      <div class="header-row">
        <h1>Yahtzee</h1>
        <button id="reset-btn" class="link-btn">Reset room</button>
      </div>
    </header>
    <div class="center">
      <h2>${winnerText}</h2>
      <div class="scorecards final">
        ${orderedSeats(game, mySeat).map((i) => scorecardEl(game.players[i], i, game, {}, false)).join('')}
      </div>
      ${!isSpectator ? '<button id="new-game-btn">New game (same players)</button>' : ''}
    </div>
  `;
  document.getElementById('new-game-btn')?.addEventListener('click', () => send({ type: 'newGame' }));
  document.getElementById('reset-btn')?.addEventListener('click', () => {
    if (confirm('Reset the room? This clears both seats and starts a brand new game.')) {
      send({ type: 'reinit' });
    }
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
