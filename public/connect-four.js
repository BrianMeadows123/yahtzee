if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const app = document.getElementById('app');

let token = localStorage.getItem('connectfour-token');
let mySeat = null;
let isSpectator = true;
let latest = null;
let animateFinishOnNextRender = false;

let theme = localStorage.getItem('yahtzee-theme'); // shared across all games on purpose
if (theme) document.body.dataset.theme = theme;

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

// --- Push notifications: "your turn" alerts (own subscription, same server infra) ---

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

// --- Connection -----------------------------------------------------------

const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${proto}//${location.host}/?room=connectFour${token ? `&token=${encodeURIComponent(token)}` : ''}`;
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
      localStorage.setItem('connectfour-token', token);
    } else if (msg.type === 'state') {
      const prevGame = latest?.game;
      latest = msg;
      mySeat = msg.you.seat;
      isSpectator = msg.you.spectator;
      if (prevGame && prevGame.phase !== 'finished' && msg.game.phase === 'finished') {
        animateFinishOnNextRender = true;
      }
      render();
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

// --- Rendering --------------------------------------------------------------

function boardHtml(game, canPlay) {
  const cols = [];
  for (let c = 0; c < game.board[0].length; c++) {
    const cells = [];
    for (let r = 0; r < game.board.length; r++) {
      const val = game.board[r][c];
      const isWin = game.winningCells?.some(([wr, wc]) => wr === r && wc === c);
      const cls = val === 0 ? 'p0' : val === 1 ? 'p1' : '';
      cells.push(`<div class="c4-cell ${cls} ${isWin ? 'win' : ''}"></div>`);
    }
    cols.push(`<div class="c4-col ${canPlay ? 'clickable' : ''}" data-col="${c}">${cells.join('')}</div>`);
  }
  return `<div class="c4-board">${cols.join('')}</div>`;
}

function nameEditor(name) {
  return `<input id="name-input" type="text" value="${escapeHtml(name)}" maxlength="24" placeholder="Your name" />`;
}

function render() {
  if (!latest) return;
  const { game, seatsTaken } = latest;
  const myTurn = mySeat === game.currentPlayer && !isSpectator;

  if (game.phase === 'finished') {
    renderFinished(game);
    return;
  }

  const canPlay = myTurn;
  const hasOpenSeat = seatsTaken.some((taken) => !taken);

  app.innerHTML = `
    <header>
      <div class="header-row">
        ${leftHeaderIconsHtml()}
        <h1>Connect 4</h1>
        <div class="header-icon-group">
          ${pushButtonHtml()}
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

    <div class="c4-legend">
      <span class="key"><span class="dot p0"></span>${escapeHtml(game.players[0].name)}</span>
      <span class="key"><span class="dot p1"></span>${escapeHtml(game.players[1].name)}</span>
    </div>

    <div class="c4-board-wrap">${boardHtml(game, canPlay)}</div>

    <section class="controls">
      ${mySeat !== null && !isSpectator ? nameEditor(game.players[mySeat].name) : ''}
    </section>
  `;

  document.getElementById('join-btn')?.addEventListener('click', () => send({ type: 'claimSeat' }));
  document.getElementById('reset-btn')?.addEventListener('click', () => {
    if (confirm('Reset the room? This clears both seats and starts a brand new game.')) {
      send({ type: 'reinit' });
    }
  });
  bindThemeToggle();
  bindPushButton();
  document.querySelectorAll('.c4-col.clickable').forEach((el) => {
    el.addEventListener('click', () => send({ type: 'drop', column: Number(el.dataset.col) }));
  });
  document.getElementById('name-input')?.addEventListener('change', (e) => {
    send({ type: 'setName', name: e.target.value });
  });
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
        <h1>Connect 4</h1>
        <div class="header-icon-group">
          ${pushButtonHtml()}
          <button id="reset-btn" class="icon-btn" title="Reset room" aria-label="Reset room">↺</button>
        </div>
      </div>
    </header>
    <div class="center">
      ${confettiHtml}
      <h2>${winnerText}</h2>
      ${stampHtml}
      <div class="c4-board-wrap">${boardHtml(game, false)}</div>
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

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
