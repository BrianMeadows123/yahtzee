if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const app = document.getElementById('app');

const SIZE = 8;

let token = localStorage.getItem('checkers-token');
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
const wsUrl = `${proto}//${location.host}/?room=checkers${token ? `&token=${encodeURIComponent(token)}` : ''}`;
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
      localStorage.setItem('checkers-token', token);
    } else if (msg.type === 'state') {
      const prevGame = latest?.game;
      latest = msg;
      mySeat = msg.you.seat;
      isSpectator = msg.you.spectator;
      if (prevGame && prevGame.phase !== 'finished' && msg.game.phase === 'finished') {
        animateFinishOnNextRender = true;
      }
      if (prevGame && JSON.stringify(prevGame.board) !== JSON.stringify(msg.game.board)) {
        playPlunk();
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

function playSound(src) {
  const audio = new Audio(src);
  audio.play().catch(() => {});
}
function playPlunk() {
  playSound('/sounds/checkers-move.mp3');
}

// --- Move generation (client-side prediction only, for drag UX — the server
// is the authority; an illegal attempt just comes back as an error toast) ---

function isDark(r, c) {
  return (r + c) % 2 === 1;
}
function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}
function pieceDirs(piece) {
  return piece.king ? [-1, 1] : (piece.player === 0 ? [1] : [-1]);
}
function movesFrom(board, r, c) {
  const piece = board[r][c];
  const simple = [];
  const capture = [];
  for (const dr of pieceDirs(piece)) {
    for (const dc of [-1, 1]) {
      const mr = r + dr;
      const mc = c + dc;
      const tr = r + 2 * dr;
      const tc = c + 2 * dc;
      if (inBounds(mr, mc) && board[mr][mc] === null) simple.push([mr, mc]);
      if (inBounds(tr, tc)) {
        const mid = board[mr]?.[mc];
        if (mid && mid.player !== piece.player && board[tr][tc] === null) {
          capture.push({ to: [tr, tc], captured: [mr, mc] });
        }
      }
    }
  }
  return { simple, capture };
}
function allCaptures(board, player) {
  const out = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c]?.player === player) {
        movesFrom(board, r, c).capture.forEach((m) => out.push({ from: [r, c], ...m }));
      }
    }
  }
  return out;
}
function mandatoryFromSet(game) {
  if (game.mustContinueFrom) {
    const [r, c] = game.mustContinueFrom;
    return new Set([`${r},${c}`]);
  }
  return new Set(allCaptures(game.board, game.currentPlayer).map((m) => m.from.join(',')));
}

// --- Drag-and-drop (Pointer Events — same approach as Battleship's ship
// placement: works identically for mouse, touch, and pen) ---------------------

let dragState = null;

function beginDrag(e, el, game, r, c) {
  e.preventDefault();
  const gridEl = document.getElementById('ck-grid');
  if (!gridEl) return;
  const sampleCell = gridEl.querySelector('.ck-cell');
  const size = sampleCell ? sampleCell.getBoundingClientRect().width : 40;
  const piece = game.board[r][c];
  const { simple, capture } = movesFrom(game.board, r, c);
  const legalDestinations = capture.length > 0 ? capture.map((m) => m.to) : simple;

  const ghost = document.createElement('div');
  ghost.className = `ck-drag-ghost p${piece.player}`;
  ghost.style.width = `${size}px`;
  ghost.style.height = `${size}px`;
  if (piece.king) ghost.innerHTML = '<span class="ck-crown">👑</span>';
  document.body.appendChild(ghost);

  dragState = { r, c, legalDestinations, pointerId: e.pointerId, ghost, size, sourceEl: el };
  el.style.visibility = 'hidden';
  updateGhostPosition(e.clientX, e.clientY);

  const captureCells = new Set(capture.map((m) => m.to.join(',')));
  legalDestinations.forEach(([dr, dc]) => {
    const cell = gridEl.querySelector(`.ck-cell[data-r="${dr}"][data-c="${dc}"]`);
    if (cell) cell.classList.add(captureCells.has(`${dr},${dc}`) ? 'legal-capture' : 'legal-move');
  });

  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd);
  document.addEventListener('pointercancel', onDragEnd);
}
function updateGhostPosition(x, y) {
  const { ghost, size } = dragState;
  ghost.style.left = `${x - size / 2}px`;
  ghost.style.top = `${y - size / 2}px`;
}
function onDragMove(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  updateGhostPosition(e.clientX, e.clientY);
}
function onDragEnd(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  const { r, c, legalDestinations, ghost } = dragState;
  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', onDragEnd);
  document.removeEventListener('pointercancel', onDragEnd);
  ghost.remove();
  const hovered = cellFromPoint(e.clientX, e.clientY);
  dragState = null;
  if (hovered && legalDestinations.some(([dr, dc]) => dr === hovered.r && dc === hovered.c)) {
    send({ type: 'move', fromR: r, fromC: c, toR: hovered.r, toC: hovered.c });
  }
  render(); // no local state to snap back — just repaint from the last known server state
}
function cellFromPoint(x, y) {
  const cell = document.elementFromPoint(x, y)?.closest('.ck-cell');
  return cell ? { r: Number(cell.dataset.r), c: Number(cell.dataset.c) } : null;
}

// --- Board rendering ---------------------------------------------------------

function boardHtml(game) {
  let html = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      html += `<div class="ck-cell ${isDark(r, c) ? 'dark' : 'light'}" data-r="${r}" data-c="${c}">`;
      const piece = game.board[r][c];
      if (piece) {
        html += `<div class="ck-piece p${piece.player}" data-r="${r}" data-c="${c}">${piece.king ? '<span class="ck-crown">👑</span>' : ''}</div>`;
      }
      html += '</div>';
    }
  }
  return html;
}

function bindBoard(game) {
  const gridEl = document.getElementById('ck-grid');
  if (!gridEl) return;
  const myTurn = mySeat === game.currentPlayer && !isSpectator;
  if (!myTurn || game.phase !== 'playing') return;

  const mandatory = mandatoryFromSet(game);
  gridEl.querySelectorAll('.ck-piece').forEach((el) => {
    const r = Number(el.dataset.r);
    const c = Number(el.dataset.c);
    const piece = game.board[r][c];
    if (!piece || piece.player !== mySeat) return;
    if (mandatory.size > 0 && !mandatory.has(`${r},${c}`)) {
      el.classList.add('dimmed');
      return;
    }
    if (mandatory.has(`${r},${c}`)) el.classList.add('must-capture');
    el.addEventListener('pointerdown', (e) => beginDrag(e, el, game, r, c));
  });
}

function legendHtml(game) {
  return `
    <div class="ck-legend">
      <span class="key"><span class="swatch p0"></span>${escapeHtml(game.players[0].name)}</span>
      <span class="key"><span class="swatch p1"></span>${escapeHtml(game.players[1].name)}</span>
      <span class="key"><span class="swatch move"></span>Move</span>
      <span class="key"><span class="swatch capture"></span>Capture</span>
    </div>
  `;
}

function headerHtml(title) {
  return `
    <div class="header-row">
      ${leftHeaderIconsHtml()}
      <h1>${title}</h1>
      <div class="header-icon-group">
        ${pushButtonHtml()}
        <button id="reset-btn" class="icon-btn" title="Reset room" aria-label="Reset room">↺</button>
      </div>
    </div>
  `;
}
function bindHeaderControls() {
  bindThemeToggle();
  bindPushButton();
  document.getElementById('reset-btn')?.addEventListener('click', () => {
    if (confirm('Reset the room? This clears both seats and starts a brand new game.')) {
      send({ type: 'reinit' });
    }
  });
  document.getElementById('join-btn')?.addEventListener('click', () => send({ type: 'claimSeat' }));
}

function render() {
  if (!latest) return;
  const { game } = latest;
  if (game.phase === 'finished') renderFinished(game);
  else renderPlaying(game, latest.seatsTaken);
}

function renderPlaying(game, seatsTaken) {
  const myTurn = mySeat === game.currentPlayer && !isSpectator;
  const hasOpenSeat = seatsTaken.some((taken) => !taken);
  const chaining = !!game.mustContinueFrom && myTurn;

  app.innerHTML = `
    <header>
      ${headerHtml('Checkers')}
      <div class="status-line">
        <span class="turn-banner ${myTurn ? 'my-turn' : ''}">
          ${isSpectator ? 'Spectating' : chaining ? 'Capture again with the same piece!' : myTurn ? 'Your turn' : `Waiting for ${escapeHtml(game.players[game.currentPlayer].name)}`}
        </span>
        ${!isSpectator && hasOpenSeat ? '<span class="status-sub">seat open</span>' : ''}
      </div>
      ${isSpectator && hasOpenSeat ? '<button id="join-btn">Join game</button>' : ''}
    </header>
    <div class="ck-board-wrap">
      <div class="ck-grid" id="ck-grid">${boardHtml(game)}</div>
    </div>
    ${legendHtml(game)}
  `;

  bindHeaderControls();
  bindBoard(game);
}

function renderFinished(game) {
  const animate = animateFinishOnNextRender;
  animateFinishOnNextRender = false;

  const winnerText = `${game.players[game.winner].name} wins!`;
  const iWon = !isSpectator && mySeat === game.winner;
  const enterClass = animate ? 'enter' : '';
  const stampHtml = iWon
    ? `<div class="stamp-badge win ${enterClass}">Winner</div>`
    : `<div class="stamp-badge quiet ${enterClass}">Good Game</div>`;
  const confettiHtml = animate && iWon ? confettiPiecesHtml(26) : '';
  if (animate) playSound(iWon ? '/sounds/game-win.mp3' : '/sounds/game-over.mp3');

  app.innerHTML = `
    <header>${headerHtml('Checkers')}</header>
    <div class="center">
      ${confettiHtml}
      <h2>${winnerText}</h2>
      ${stampHtml}
      <div class="ck-board-wrap">
        <div class="ck-grid">${boardHtml(game)}</div>
      </div>
      ${legendHtml(game)}
      ${!isSpectator ? '<button id="new-game-btn">New game (same players)</button>' : ''}
    </div>
  `;
  document.getElementById('new-game-btn')?.addEventListener('click', () => send({ type: 'newGame' }));
  bindHeaderControls();
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
