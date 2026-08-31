if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const app = document.getElementById('app');

const SIZE = 8;
const FLEET_META = [
  { len: 4, name: 'Carrier' },
  { len: 3, name: 'Cruiser' },
  { len: 3, name: 'Submarine' },
  { len: 2, name: 'Destroyer' },
];

let token = localStorage.getItem('battleship-token');
let mySeat = null;
let isSpectator = true;
let latest = null;
let animateFinishOnNextRender = false;

// --- Local, pre-submission placement scratch state (see resetLocalPlacementState) ---
let placementShips;
let selectedShip = null;
let horizontal = true;
let occupied = new Set();
resetLocalPlacementState();

function resetLocalPlacementState() {
  placementShips = FLEET_META.map((meta, idx) => ({ ...meta, idx, placed: false, cells: [] }));
  selectedShip = null;
  horizontal = true;
  occupied = new Set();
}

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

function playSound(src) {
  const audio = new Audio(src);
  audio.play().catch(() => {});
}
function playFireSound(hit) {
  playSound(hit ? '/sounds/bs-hit.mp3' : '/sounds/bs-miss.mp3');
}

// --- Connection -----------------------------------------------------------

const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${proto}//${location.host}/?room=battleship${token ? `&token=${encodeURIComponent(token)}` : ''}`;
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
      localStorage.setItem('battleship-token', token);
    } else if (msg.type === 'state') {
      const prevGame = latest?.game;
      latest = msg;
      mySeat = msg.you.seat;
      isSpectator = msg.you.spectator;

      // A fresh game (reinit or "new game") clears myShips server-side —
      // that's the signal to throw away stale local placement scratch.
      if (prevGame && prevGame.myShips.length > 0 && msg.game.myShips.length === 0) {
        resetLocalPlacementState();
      }
      if (prevGame && prevGame.phase !== 'finished' && msg.game.phase === 'finished') {
        animateFinishOnNextRender = true;
      }
      if (prevGame && msg.game.shotsAgainstMe.length > prevGame.shotsAgainstMe.length) {
        playFireSound(msg.game.shotsAgainstMe.at(-1).hit);
      }
      if (prevGame && msg.game.myShots.length > prevGame.myShots.length) {
        playFireSound(msg.game.myShots.at(-1).hit);
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

// --- Board rendering (shared by placing/playing/finished) -------------------

function ownBoardCellsHtml(game) {
  const shipCells = new Set(game.myShips.flat().map(([r, c]) => `${r},${c}`));
  const hitCells = new Set(game.shotsAgainstMe.filter((s) => s.hit).map((s) => `${s.row},${s.col}`));
  const missCells = new Set(game.shotsAgainstMe.filter((s) => !s.hit).map((s) => `${s.row},${s.col}`));
  let html = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const key = `${r},${c}`;
      let cls = 'bs-cell';
      if (hitCells.has(key)) cls += ' hit';
      else if (missCells.has(key)) cls += ' miss';
      else if (shipCells.has(key)) cls += ' ship';
      html += `<div class="${cls}"></div>`;
    }
  }
  return html;
}

function enemyBoardCellsHtml(game, clickable) {
  const hitCells = new Set(game.myShots.filter((s) => s.hit).map((s) => `${s.row},${s.col}`));
  const missCells = new Set(game.myShots.filter((s) => !s.hit).map((s) => `${s.row},${s.col}`));
  const sunkCells = new Set(game.enemySunkShips.flat().map(([r, c]) => `${r},${c}`));
  let html = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const key = `${r},${c}`;
      const alreadyShot = hitCells.has(key) || missCells.has(key);
      let cls = 'bs-cell';
      if (sunkCells.has(key)) cls += ' sunk';
      else if (hitCells.has(key)) cls += ' hit';
      else if (missCells.has(key)) cls += ' miss';
      if (clickable && !alreadyShot) cls += ' clickable';
      html += `<div class="${cls}" data-r="${r}" data-c="${c}"></div>`;
    }
  }
  return html;
}

function legendHtml() {
  return `
    <div class="bs-legend">
      <span class="key"><span class="swatch ship"></span>Ship</span>
      <span class="key"><span class="swatch hit"></span>Hit</span>
      <span class="key"><span class="swatch"></span>&#9679; Miss</span>
      <span class="key"><span class="swatch sunk"></span>&#9760; Sunk</span>
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

// --- Placement phase ---------------------------------------------------------

function placementCellsFor(r, c, len) {
  const cells = [];
  for (let i = 0; i < len; i++) cells.push(horizontal ? [r, c + i] : [r + i, c]);
  return cells;
}
function placementValid(cells) {
  return cells.every(([r, c]) => r >= 0 && r < SIZE && c >= 0 && c < SIZE && !occupied.has(`${r},${c}`));
}

function renderPlacementGrid(container, previewCells, previewValid) {
  let html = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const key = `${r},${c}`;
      let cls = 'bs-cell clickable';
      if (occupied.has(key)) cls += ' ship';
      if (previewCells?.some(([pr, pc]) => pr === r && pc === c)) {
        cls += previewValid ? ' preview-ok' : ' preview-bad';
      }
      html += `<div class="${cls}" data-r="${r}" data-c="${c}"></div>`;
    }
  }
  container.innerHTML = html;
}
function bindPlacementGridEvents(container) {
  container.onmouseover = (e) => {
    if (!selectedShip) return;
    const cell = e.target.closest('.bs-cell');
    if (!cell) return;
    const cells = placementCellsFor(Number(cell.dataset.r), Number(cell.dataset.c), selectedShip.len);
    renderPlacementGrid(container, cells, placementValid(cells));
  };
  container.onmouseleave = () => {
    if (selectedShip) renderPlacementGrid(container);
  };
  container.onclick = (e) => {
    if (!selectedShip) return;
    const cell = e.target.closest('.bs-cell');
    if (!cell) return;
    const cells = placementCellsFor(Number(cell.dataset.r), Number(cell.dataset.c), selectedShip.len);
    if (!placementValid(cells)) return;
    cells.forEach(([cr, cc]) => occupied.add(`${cr},${cc}`));
    selectedShip.placed = true;
    selectedShip.cells = cells;
    selectedShip = null;
    render();
  };
}

function placementTrayHtml() {
  const rows = placementShips.map((ship) => {
    const segs = Array.from({ length: ship.len }).map(() => '<div class="seg"></div>').join('');
    return `
      <div class="bs-ship-option ${selectedShip === ship ? 'selected' : ''} ${ship.placed ? 'placed' : ''}" data-idx="${ship.idx}">
        <div class="swatch-row">${segs}</div>
        <span class="label">${ship.name} (${ship.len})</span>
      </div>`;
  }).join('');
  const allPlaced = placementShips.every((s) => s.placed);
  return `
    <div class="bs-tray">
      <div class="bs-tray-title">Your fleet</div>
      ${rows}
      <button id="rotate-btn" type="button">&#8635; Rotate: ${horizontal ? 'horizontal' : 'vertical'}</button>
      <button id="ready-btn" type="button" class="${allPlaced ? 'armed' : ''}" ${allPlaced ? '' : 'disabled'}>Ready!</button>
    </div>
  `;
}
function bindPlacementControls() {
  document.querySelectorAll('.bs-ship-option').forEach((el) => {
    el.addEventListener('click', () => {
      const ship = placementShips[Number(el.dataset.idx)];
      if (ship.placed) return;
      selectedShip = selectedShip === ship ? null : ship;
      render();
    });
  });
  document.getElementById('rotate-btn')?.addEventListener('click', () => {
    horizontal = !horizontal;
    render();
  });
  document.getElementById('ready-btn')?.addEventListener('click', () => {
    if (!placementShips.every((s) => s.placed)) return;
    send({ type: 'placeFleet', ships: placementShips.map((s) => s.cells) });
  });
  const grid = document.getElementById('placement-grid');
  if (grid) {
    renderPlacementGrid(grid);
    bindPlacementGridEvents(grid);
  }
}

function renderPlacement(game, seatsTaken) {
  const amReady = mySeat !== null && game.players[mySeat]?.ready;
  const opponentSeat = mySeat === null ? null : 1 - mySeat;
  const opponentReady = opponentSeat !== null && game.players[opponentSeat]?.ready;
  const opponentName = opponentSeat !== null ? game.players[opponentSeat].name : 'the other player';
  const hasOpenSeat = seatsTaken.some((taken) => !taken);

  app.innerHTML = `
    <header>
      ${headerHtml('Battleship')}
      <div class="status-line">
        <span class="turn-banner">
          ${isSpectator ? 'Spectating' : amReady ? 'Fleet locked' : 'Place your fleet'}
        </span>
        ${!isSpectator && opponentReady ? '<span class="status-sub">opponent ready</span>' : ''}
      </div>
      ${isSpectator && hasOpenSeat ? '<button id="join-btn">Join game</button>' : ''}
    </header>
    ${amReady ? `
      <div class="center">
        <p>Fleet locked. Waiting for ${escapeHtml(opponentName)} to finish placing&hellip;</p>
        <div class="bs-board-block">
          <div class="bs-board-label">Your Fleet</div>
          <div class="bs-grid-wrap"><div class="bs-grid">${ownBoardCellsHtml(game)}</div></div>
        </div>
      </div>
    ` : isSpectator ? `
      <div class="center"><p>Waiting for both players to place their fleets&hellip;</p></div>
    ` : `
      <div class="bs-placement-layout">
        ${placementTrayHtml()}
        <div class="bs-board-block">
          <div class="bs-grid-wrap"><div class="bs-grid" id="placement-grid"></div></div>
        </div>
      </div>
    `}
  `;

  bindHeaderControls();
  if (!isSpectator && !amReady) bindPlacementControls();
}

// --- Playing phase -------------------------------------------------------

function renderPlaying(game, seatsTaken) {
  const myTurn = mySeat === game.currentPlayer && !isSpectator;
  const hasOpenSeat = seatsTaken.some((taken) => !taken);

  app.innerHTML = `
    <header>
      ${headerHtml('Battleship')}
      <div class="status-line">
        <span class="turn-banner ${myTurn ? 'my-turn' : ''}">
          ${isSpectator ? 'Spectating' : myTurn ? 'Your turn — fire!' : `Waiting for ${escapeHtml(game.players[game.currentPlayer].name)}`}
        </span>
        ${!isSpectator && hasOpenSeat ? '<span class="status-sub">seat open</span>' : ''}
      </div>
      ${isSpectator && hasOpenSeat ? '<button id="join-btn">Join game</button>' : ''}
    </header>
    <div class="bs-battle-layout">
      <div class="bs-board-block">
        <div class="bs-board-label">Your Fleet</div>
        <div class="bs-grid-wrap"><div class="bs-grid">${ownBoardCellsHtml(game)}</div></div>
      </div>
      <div class="bs-board-block">
        <div class="bs-board-label">Enemy Waters</div>
        <div class="bs-grid-wrap"><div class="bs-grid" id="enemy-grid">${enemyBoardCellsHtml(game, myTurn)}</div></div>
      </div>
    </div>
    ${legendHtml()}
  `;

  bindHeaderControls();
  if (myTurn) {
    document.getElementById('enemy-grid')?.addEventListener('click', (e) => {
      const cell = e.target.closest('.bs-cell.clickable');
      if (!cell) return;
      send({ type: 'fire', row: Number(cell.dataset.r), col: Number(cell.dataset.c) });
    });
  }
}

// --- Finished phase --------------------------------------------------------

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
  if (animate) playSound(iWon ? '/sounds/game-win.mp3' : '/sounds/game-over.mp3');

  app.innerHTML = `
    <header>${headerHtml('Battleship')}</header>
    <div class="center">
      ${confettiHtml}
      <h2>${winnerText}</h2>
      ${stampHtml}
      <div class="bs-battle-layout">
        <div class="bs-board-block">
          <div class="bs-board-label">Your Fleet</div>
          <div class="bs-grid-wrap"><div class="bs-grid">${ownBoardCellsHtml(game)}</div></div>
        </div>
        <div class="bs-board-block">
          <div class="bs-board-label">Enemy Waters</div>
          <div class="bs-grid-wrap"><div class="bs-grid">${enemyBoardCellsHtml(game, false)}</div></div>
        </div>
      </div>
      ${legendHtml()}
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

// --- Top-level dispatch ------------------------------------------------------

function render() {
  if (!latest) return;
  const { game, seatsTaken } = latest;
  if (game.phase === 'placing') renderPlacement(game, seatsTaken);
  else if (game.phase === 'playing') renderPlaying(game, seatsTaken);
  else renderFinished(game);
}
