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
const SCORE_CONFIRM_TIMEOUT = 4000;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const app = document.getElementById('app');

let token = localStorage.getItem('yahtzee-token');
let mySeat = null;
let isSpectator = true;
let latest = null;
let armedCategory = null;
let armTimer = null;
let animateFinishOnNextRender = false;

let theme = localStorage.getItem('yahtzee-theme'); // 'light' | 'dark' | null (system default)
if (theme) document.body.dataset.theme = theme;

function pipGridHtml(value) {
  const active = new Set(PIP_LAYOUTS[value]);
  return Array.from({ length: 9 }, (_, i) => `<span class="pip ${active.has(i + 1) ? 'on' : ''}"></span>`).join('');
}

function effectiveTheme() {
  return theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function themeButtonHtml() {
  const dark = effectiveTheme() === 'dark';
  return `<button id="theme-btn" class="icon-btn" title="Switch to ${dark ? 'light' : 'dark'} mode" aria-label="Toggle theme">${dark ? '☀' : '🌙'}</button>`;
}

function leftHeaderIconsHtml() {
  return `
    <div class="header-icon-group">
      ${themeButtonHtml()}
      <a href="/" class="icon-btn" title="Game lobby" aria-label="Game lobby">🏠</a>
    </div>
  `;
}

function bindThemeToggle() {
  document.getElementById('theme-btn')?.addEventListener('click', () => {
    theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.body.dataset.theme = theme;
    localStorage.setItem('yahtzee-theme', theme);
    render();
  });
}

// --- Push notifications: "your turn" alerts -----------------------------

let pushSubscribed = false;
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function refreshPushState() {
  if (!pushSupported) return;
  const registration = await navigator.serviceWorker.ready;
  const sub = await registration.pushManager.getSubscription();
  pushSubscribed = !!sub;
}

async function subscribeToPush() {
  if (!token) return;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;
  const { publicKey } = await fetch('/api/vapid-public-key').then((r) => r.json());
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, subscription: subscription.toJSON() }),
  });
  pushSubscribed = true;
}

async function unsubscribeFromPush() {
  const registration = await navigator.serviceWorker.ready;
  const sub = await registration.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  pushSubscribed = false;
}

function pushButtonHtml() {
  if (!pushSupported) return '';
  return `<button id="push-btn" class="icon-btn" title="${pushSubscribed ? 'Turn off turn notifications' : 'Notify me on my turn'}" aria-label="Toggle turn notifications">${pushSubscribed ? '🔔' : '🔕'}</button>`;
}

function bindPushButton() {
  document.getElementById('push-btn')?.addEventListener('click', async () => {
    if (pushSubscribed) await unsubscribeFromPush();
    else await subscribeToPush();
    render();
  });
}

function playSound(src) {
  const audio = new Audio(src);
  audio.play().catch(() => {});
}
function playRollSound() {
  playSound(`/sounds/roll-${1 + Math.floor(Math.random() * 3)}.mp3`);
}
function playScratchSound() {
  playSound('/sounds/scratch.wav');
}

function animateDiceRoll(held) {
  const dieEls = document.querySelectorAll('.dice-row .die');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;
  dieEls.forEach((el, i) => { if (!held[i]) el.classList.add('rolling'); });
  let ticks = 0;
  const flicker = setInterval(() => {
    dieEls.forEach((el, i) => {
      if (held[i]) return;
      const grid = el.querySelector('.pip-grid');
      if (grid) grid.innerHTML = pipGridHtml(1 + Math.floor(Math.random() * 6));
    });
    ticks++;
    if (ticks >= 5) {
      clearInterval(flicker);
      dieEls.forEach((el, i) => {
        el.classList.remove('rolling');
        if (held[i]) return;
        const grid = el.querySelector('.pip-grid');
        if (grid) grid.innerHTML = pipGridHtml(latest.game.dice[i]);
      });
    }
  }, 70);
}

const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${proto}//${location.host}/?room=yahtzee${token ? `&token=${encodeURIComponent(token)}` : ''}`;
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
      const prevGame = latest?.game;
      latest = msg;
      mySeat = msg.you.seat;
      isSpectator = msg.you.spectator;
      const firstRollOfTurn = prevGame && !prevGame.turnStarted && msg.game.turnStarted;
      const reroll = prevGame && prevGame.turnStarted && msg.game.turnStarted
        && msg.game.currentPlayer === prevGame.currentPlayer
        && msg.game.rollsRemaining < prevGame.rollsRemaining;
      if (prevGame && prevGame.phase !== 'finished' && msg.game.phase === 'finished') {
        animateFinishOnNextRender = true;
      }
      render();
      if (firstRollOfTurn || reroll) {
        playRollSound();
        animateDiceRoll(msg.game.held);
      }
    } else if (msg.type === 'error') {
      flashError(msg.message);
    }
  };
}
connect();
refreshPushState().then(() => render());

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

  if (armedCategory && !(myTurn && scoreOptions[armedCategory])) {
    armedCategory = null;
    clearTimeout(armTimer);
  }

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
        ${leftHeaderIconsHtml()}
        <h1>Yahtzee</h1>
        <div class="header-icon-group">
          ${pushButtonHtml()}
          <a href="/stats.html" class="icon-btn" title="Stats" aria-label="Stats">📊</a>
          <button id="reset-btn" class="icon-btn" title="Reset room" aria-label="Reset room">↺</button>
        </div>
      </div>
      <div class="status-line">
        <span class="turn-banner ${myTurn ? 'my-turn' : ''}">
          ${isSpectator ? 'Spectating' : myTurn ? "Your turn" : `Waiting for ${game.players[game.currentPlayer].name}`}
        </span>
        ${!isSpectator && hasOpenSeat ? '<span class="status-sub">seat open</span>' : ''}
      </div>
      ${isSpectator && hasOpenSeat ? '<button id="join-btn">Join game</button>' : ''}
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
  bindThemeToggle();
  bindPushButton();
  document.querySelectorAll('.die').forEach((el) => {
    el.addEventListener('click', () => {
      if (!canHold) return;
      send({ type: 'toggleHold', dieIndex: Number(el.dataset.index) });
    });
  });
  document.querySelectorAll('.score-btn').forEach((el) => {
    el.addEventListener('click', () => {
      const cat = el.dataset.category;
      if (armedCategory !== cat) {
        armedCategory = cat;
        clearTimeout(armTimer);
        armTimer = setTimeout(() => { armedCategory = null; render(); }, SCORE_CONFIRM_TIMEOUT);
        render();
      } else {
        clearTimeout(armTimer);
        armedCategory = null;
        playScratchSound();
        send({ type: 'score', category: cat });
      }
    });
  });
  document.getElementById('name-input')?.addEventListener('change', (e) => {
    send({ type: 'setName', name: e.target.value });
  });
}

function scoreboardTile(player, seatIndex, game) {
  return `
    <div class="scoreboard-tile ${seatIndex === game.currentPlayer ? 'active' : ''}">
      <span class="sb-name">${escapeHtml(player.name)}</span>
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
  return `
    <div class="die ${held ? 'held' : ''} ${canHold ? 'clickable' : ''}" data-index="${index}">
      <div class="pip-grid">${pipGridHtml(value)}</div>
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
    const armed = clickable && cat === armedCategory;
    let valueHtml;
    if (filled) {
      valueHtml = `<span class="value">${player.scorecard[cat]}</span>`;
    } else if (clickable) {
      valueHtml = `<button class="score-btn ${option.forced ? 'forced' : ''} ${armed ? 'armed' : ''}" data-category="${cat}">${armed ? 'Confirm?' : option.score}</button>`;
    } else {
      valueHtml = `<span class="value empty">—</span>`;
    }
    const hint = CATEGORY_HINTS[cat] ? `<span class="hint">${CATEGORY_HINTS[cat]}</span>` : '';
    return `<div class="score-row"><span class="label">${CATEGORY_LABELS[cat]}${hint}</span>${valueHtml}</div>`;
  }).join('');

  return `
    <div class="scorecard ${seatIndex === game.currentPlayer ? 'active' : ''}">
      <div class="stamp"><div class="pip-grid">${pipGridHtml(6)}</div></div>
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

function confettiPiecesHtml(count) {
  const colors = ['var(--mustard)', 'var(--rust)', 'var(--teal)', 'var(--avocado)'];
  let html = '';
  for (let i = 0; i < count; i++) {
    const left = (5 + Math.random() * 90).toFixed(1);
    const duration = (0.9 + Math.random() * 0.6).toFixed(2);
    const delay = (Math.random() * 0.15).toFixed(2);
    html += `<div class="confetti-piece" style="left:${left}%;background:${colors[i % colors.length]};animation-duration:${duration}s;animation-delay:${delay}s;"></div>`;
  }
  return html;
}

function renderFinished(game) {
  const animate = animateFinishOnNextRender;
  animateFinishOnNextRender = false;

  const winnerText = game.winner === null
    ? "It's a tie!"
    : `${game.players[game.winner].name} wins!`;
  const iWon = !isSpectator && game.winner !== null && mySeat === game.winner;
  const enterClass = animate ? 'enter' : '';
  const stampHtml = iWon
    ? `<div class="stamp-badge win ${enterClass}">Winner</div>`
    : `<div class="stamp-badge quiet ${enterClass}">${game.winner === null ? 'Tie Game' : 'Good Game'}</div>`;
  const confettiHtml = animate && iWon ? confettiPiecesHtml(26) : '';

  app.innerHTML = `
    <header>
      <div class="header-row">
        ${leftHeaderIconsHtml()}
        <h1>Yahtzee</h1>
        <div class="header-icon-group">
          ${pushButtonHtml()}
          <a href="/stats.html" class="icon-btn" title="Stats" aria-label="Stats">📊</a>
          <button id="reset-btn" class="icon-btn" title="Reset room" aria-label="Reset room">↺</button>
        </div>
      </div>
    </header>
    <div class="center">
      ${confettiHtml}
      <h2>${winnerText}</h2>
      ${stampHtml}
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
  bindThemeToggle();
  bindPushButton();
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
