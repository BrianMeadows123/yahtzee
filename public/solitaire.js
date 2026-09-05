import {
  newGame, draw, move, legalDestinations, autoMoveToFoundation, giveUp, rankLabel, isRed, SUITS,
} from '/games/solitaire/logic.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const app = document.getElementById('app');

// --- Theme (shared boilerplate, deliberately duplicated per-page per CLAUDE.md) ---
let theme = localStorage.getItem('yahtzee-theme');
if (theme) document.body.dataset.theme = theme;
function effectiveTheme() {
  return theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function themeButtonHtml() {
  const dark = effectiveTheme() === 'dark';
  return `<button id="theme-btn" class="icon-btn" title="Switch to ${dark ? 'light' : 'dark'} mode" aria-label="Toggle theme">${dark ? '☀' : '🌙'}</button>`;
}
function bindThemeToggle() {
  document.getElementById('theme-btn')?.addEventListener('click', () => {
    theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.body.dataset.theme = theme;
    localStorage.setItem('yahtzee-theme', theme);
    render();
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

// --- State ---------------------------------------------------------------
// Solitaire has no opponent to synchronize with, so it never opens a
// WebSocket — logic.js runs directly in the browser and the server is only
// touched via REST to persist a finished game for the shared leaderboard.
let name = window.NamePicker.getSaved();
let mode = localStorage.getItem('solitaire-mode') || 'daily';
let game = null;
let gameStart = null;
let statsCache = null;
let statsPanelOpen = false;
let dailyLockedResult = null;
let animateFinishOnNextRender = false;
let timerHandle = null;
let dragState = null;
let history = []; // stack of prior game snapshots for Undo — in-memory only, not persisted (a refresh loses undo history, not the game itself)

function todayDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function currentElapsed() {
  return gameStart ? Math.floor((Date.now() - gameStart) / 1000) : 0;
}
function startTimer() {
  stopTimer();
  timerHandle = setInterval(() => {
    const el = document.getElementById('sol-timer');
    if (el) el.textContent = formatTime(currentElapsed());
  }, 1000);
}
function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

function saveKey(m, dailySeed) {
  return m === 'daily' ? `solitaire-save-daily-${dailySeed}` : 'solitaire-save-free';
}
function persist() {
  try { localStorage.setItem(saveKey(mode, game?.seed), JSON.stringify({ game, gameStart })); } catch { /* private-browsing storage denial — game still works, just won't resume */ }
}
function loadSaved(m, dailySeed) {
  try {
    const raw = localStorage.getItem(saveKey(m, dailySeed));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
async function resolveDailySeed() {
  try {
    const { seed } = await fetch(`/api/solitaire/daily-seed?date=${todayDate()}`).then((r) => r.json());
    return seed;
  } catch {
    return todayDate(); // offline fallback — keeps the game playable, just not provably solvable
  }
}

async function refreshStats() {
  try {
    statsCache = await fetch('/api/solitaire/stats').then((r) => r.json());
  } catch {
    statsCache = statsCache || { freePlay: [], daily: [] };
  }
}
function findDailyResult(forName, seed) {
  if (!forName || !statsCache) return null;
  const needle = forName.trim().toLowerCase();
  return statsCache.daily.find((r) => r.seed === seed && r.name.trim().toLowerCase() === needle) || null;
}
async function submitResult(elapsedSeconds) {
  if (!name) return;
  try {
    await fetch('/api/solitaire/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, mode: game.mode, seed: game.seed, won: game.won,
        cardsHome: game.cardsHome, moves: game.moves, elapsedSeconds,
      }),
    });
  } catch { /* offline/server hiccup — the finished screen still shows locally */ }
}

function newRound(dailySeed) {
  const seed = mode === 'daily' ? dailySeed : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  game = newGame(seed, mode);
  gameStart = Date.now();
  persist();
}

async function enterMode(m) {
  mode = m;
  localStorage.setItem('solitaire-mode', mode);
  history = []; // undo history isn't persisted, so it never carries across a mode switch, resume, or new round
  if (mode === 'daily') {
    // Resolving today's guaranteed-solvable seed usually returns in
    // milliseconds (cached after the first request of the day), but the
    // very first request of a new day runs the solver — show a loading
    // state immediately rather than leaving the previous tab's board up
    // for however long that takes.
    game = null;
    render();
  }
  await refreshStats(); // catches a result submitted elsewhere/earlier this session before deciding the daily lock
  const dailySeed = mode === 'daily' ? await resolveDailySeed() : null;
  dailyLockedResult = mode === 'daily' ? findDailyResult(name, dailySeed) : null;
  if (dailyLockedResult) {
    game = null;
    stopTimer();
    render();
    return;
  }
  const saved = loadSaved(mode, dailySeed);
  if (saved?.game && saved.game.phase === 'playing') {
    game = saved.game;
    gameStart = saved.gameStart;
  } else {
    newRound(dailySeed);
  }
  startTimer();
  render();
}

function afterGameChange() {
  persist();
  if (game.phase === 'finished') {
    stopTimer();
    animateFinishOnNextRender = true;
    submitResult(currentElapsed());
  }
  render();
}

// Snapshot before a mutating action, so it can be popped back on Undo — the
// caller is responsible for discarding the snapshot if the action turns out
// to be illegal (nothing actually happened, so there's nothing to undo).
function snapshotForUndo() {
  history.push(structuredClone(game));
}
function undo() {
  if (!history.length) return;
  game = history.pop();
  persist();
  render();
}

// --- Card rendering --------------------------------------------------------
function suitChar(s) {
  return { S: '♠', H: '♥', D: '♦', C: '♣' }[s];
}
function cardHtml(c, { draggable = false, dataset = {}, style = '' } = {}) {
  if (!c.faceUp) return `<div class="sol-card back" style="${style}"></div>`;
  const dataAttrs = Object.entries(dataset).map(([k, v]) => `data-${k}="${v}"`).join(' ');
  return `<div class="sol-card face ${isRed(c.suit) ? 'red' : 'black'} ${draggable ? 'draggable' : ''}" style="${style}" ${dataAttrs}>
    <span class="sol-rank">${rankLabel(c.rank)}</span><span class="sol-suit">${suitChar(c.suit)}</span>
  </div>`;
}
function tableauCardHtml(c, col, index) {
  return cardHtml(c, {
    draggable: c.faceUp,
    dataset: c.faceUp ? { pile: 'tableau', col, index } : {},
    style: `top:${index * 22}px; z-index:${index};`,
  });
}
function tableauColumnHtml(col, colIndex) {
  const height = Math.max(90, 22 * col.length + 68);
  const cardsHtml = col.map((c, i) => tableauCardHtml(c, colIndex, i)).join('');
  return `<div class="sol-col sol-dropzone" data-pile="tableau" data-col="${colIndex}" style="height:${height}px;">${cardsHtml}</div>`;
}
function foundationHtml(suit) {
  const top = game.foundations[suit];
  const inner = top
    ? cardHtml({ rank: top, suit, faceUp: true }, { draggable: true, dataset: { pile: 'foundation', suit } })
    : `<span class="sol-foundation-suit ${isRed(suit) ? 'red' : 'black'}">${suitChar(suit)}</span>`;
  return `<div class="sol-foundation sol-dropzone" data-pile="foundation" data-suit="${suit}">${inner}</div>`;
}
function stockWasteHtml() {
  const stockCount = game.stock.length;
  const wasteTop = game.waste.length ? game.waste[game.waste.length - 1] : null;
  const canDraw = stockCount > 0 || game.waste.length > 0;
  return `
    <div class="sol-pile-pair">
      <div class="sol-stock-slot ${canDraw ? 'clickable' : ''}" id="sol-stock">
        ${stockCount > 0 ? '<div class="sol-card back"></div>' : '<div class="sol-card empty-slot">↺</div>'}
        <span class="sol-pile-count">${stockCount}</span>
      </div>
      <div class="sol-waste-slot">
        ${wasteTop ? cardHtml(wasteTop, { draggable: true, dataset: { pile: 'waste' } }) : '<div class="sol-card empty-slot"></div>'}
      </div>
    </div>
  `;
}

// --- Drag-and-drop (Pointer Events — same ghost + elementFromPoint approach
// as Battleship's ship placement / Checkers' piece drag) --------------------
function cardsForSource(source) {
  if (source.pile === 'waste') return game.waste.length ? [game.waste[game.waste.length - 1]] : [];
  if (source.pile === 'foundation') {
    const top = game.foundations[source.suit];
    return top ? [{ rank: top, suit: source.suit, faceUp: true }] : [];
  }
  return game.tableau[source.col].slice(source.index);
}
function resolveClientSource(el) {
  const pile = el.dataset.pile;
  if (pile === 'tableau') return { pile: 'tableau', col: Number(el.dataset.col), index: Number(el.dataset.index) };
  if (pile === 'waste') return { pile: 'waste' };
  return { pile: 'foundation', suit: el.dataset.suit };
}

function beginDrag(e, source) {
  e.preventDefault();
  const cards = cardsForSource(source);
  if (cards.length === 0) return;
  let dests;
  try { dests = legalDestinations(game, source); } catch { return; }
  if (dests.length === 0) return;

  const sample = document.querySelector('.sol-card');
  const width = sample ? sample.getBoundingClientRect().width : 46;
  const height = sample ? sample.getBoundingClientRect().height : 64;

  const ghost = document.createElement('div');
  ghost.className = 'sol-drag-ghost';
  ghost.style.width = `${width}px`;
  cards.forEach((c, i) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = cardHtml(c, { style: `top:${i * 22}px;` });
    ghost.appendChild(wrap.firstElementChild);
  });
  document.body.appendChild(ghost);

  dragState = {
    source, dests, pointerId: e.pointerId, ghost, width, runHeight: height + (cards.length - 1) * 22,
  };
  updateGhostPosition(e.clientX, e.clientY);
  highlightDests(dests, true);

  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd);
  document.addEventListener('pointercancel', onDragEnd);
}
function updateGhostPosition(x, y) {
  const { ghost, width, runHeight } = dragState;
  ghost.style.left = `${x - width / 2}px`;
  ghost.style.top = `${y - runHeight / 2}px`;
}
function onDragMove(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  updateGhostPosition(e.clientX, e.clientY);
}
function onDragEnd(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  const { source, dests, ghost } = dragState;
  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', onDragEnd);
  document.removeEventListener('pointercancel', onDragEnd);
  ghost.remove();
  highlightDests(dests, false);
  const target = dropZoneFromPoint(e.clientX, e.clientY);
  dragState = null;
  if (target && dests.some((d) => d.pile === target.pile && (d.pile === 'foundation' ? d.suit === target.suit : d.col === target.col))) {
    snapshotForUndo();
    try {
      move(game, source, target);
      afterGameChange();
      return;
    } catch (err) {
      history.pop();
      flashError(err.message);
    }
  }
  render();
}
function dropZoneFromPoint(x, y) {
  const el = document.elementFromPoint(x, y)?.closest('.sol-dropzone');
  if (!el) return null;
  if (el.dataset.pile === 'foundation') return { pile: 'foundation', suit: el.dataset.suit };
  return { pile: 'tableau', col: Number(el.dataset.col) };
}
function highlightDests(dests, on) {
  dests.forEach((d) => {
    const sel = d.pile === 'foundation'
      ? `.sol-dropzone[data-pile="foundation"][data-suit="${d.suit}"]`
      : `.sol-dropzone[data-pile="tableau"][data-col="${d.col}"]`;
    document.querySelector(sel)?.classList.toggle('legal', on);
  });
}

// --- Rendering --------------------------------------------------------------
function headerHtml() {
  return `
    <div class="header-row">
      <div class="header-icon-group">
        ${themeButtonHtml()}
        <a href="/" class="icon-btn" title="Game lobby" aria-label="Game lobby">🏠</a>
      </div>
      <h1>Solitaire</h1>
      <div class="header-icon-group">
        <button id="stats-toggle-btn" class="icon-btn" title="Leaderboard" aria-label="Leaderboard">🏆</button>
      </div>
    </div>
  `;
}
function tabsHtml() {
  return `
    <div class="choice-group">
      <button class="choice-btn ${mode === 'daily' ? 'active' : ''}" data-mode="daily">Today's Challenge</button>
      <button class="choice-btn ${mode === 'free' ? 'active' : ''}" data-mode="free">Free Play</button>
    </div>
  `;
}
function nameFieldHtml() {
  return `
    <div class="sol-name-row">
      <label>Playing as</label>
      ${window.NamePicker.html(name)}
    </div>
  `;
}
function statsPanelHtml() {
  const stats = statsCache || { freePlay: [], daily: [] };
  const tiles = stats.freePlay.length
    ? stats.freePlay.map((p) => `
      <div class="stat-tile">
        <div class="stat-name">${escapeHtml(p.name)}</div>
        <div class="stat-row"><span>Games</span><b>${p.gamesPlayed}</b></div>
        <div class="stat-row"><span>Wins</span><b>${p.wins}</b></div>
        <div class="stat-row"><span>Avg cards home</span><b>${Math.round(p.avgCardsHome)}</b></div>
        <div class="stat-row"><span>Best time</span><b>${p.bestElapsedSeconds != null ? formatTime(p.bestElapsedSeconds) : '—'}</b></div>
      </div>
    `).join('')
    : '<p class="stats-empty">No free-play games recorded yet.</p>';

  const dailyRows = stats.daily.length
    ? stats.daily.map((r) => `
      <tr>
        <td>${escapeHtml(r.seed)}</td>
        <td>${escapeHtml(r.name)}</td>
        <td class="${r.won ? 'win' : ''}">${r.won ? 'Won' : 'Gave up'}</td>
        <td>${r.cardsHome}/52</td>
        <td>${formatTime(r.elapsedSeconds)}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="5" class="stats-empty">No daily results yet.</td></tr>';

  return `
    <div class="sol-stats-overlay">
      <div class="sol-stats-panel">
        <div class="header-row">
          <h2>Leaderboard</h2>
          <button id="stats-close-btn" class="icon-btn" aria-label="Close">✕</button>
        </div>
        <h3>Free Play</h3>
        <div class="stat-tiles">${tiles}</div>
        <h3>Daily Challenge</h3>
        <div class="table-scroll">
          <table class="stats-table">
            <thead><tr><th>Date</th><th>Player</th><th>Result</th><th>Cards home</th><th>Time</th></tr></thead>
            <tbody>${dailyRows}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function bodyPlaying() {
  return `
    <div class="sol-status-line">
      <span class="sol-timer" id="sol-timer">${formatTime(currentElapsed())}</span>
      <span class="sol-moves">${game.moves} moves</span>
      <span class="sol-cards-home">${game.cardsHome}/52 home</span>
    </div>
    <div class="sol-board">
      <div class="sol-top-row">
        ${stockWasteHtml()}
        <div class="sol-foundations">${SUITS.map((s) => foundationHtml(s)).join('')}</div>
      </div>
      <div class="sol-tableau">${game.tableau.map((col, i) => tableauColumnHtml(col, i)).join('')}</div>
    </div>
    <div class="sol-actions">
      <button id="undo-btn" class="sol-secondary-btn" ${history.length ? '' : 'disabled'}>Undo</button>
      <button id="give-up-btn" class="sol-secondary-btn">Give Up</button>
      ${mode === 'free' ? '<button id="new-round-btn" class="sol-secondary-btn">New Deal</button>' : ''}
    </div>
  `;
}
function bodyFinished() {
  const animate = animateFinishOnNextRender;
  animateFinishOnNextRender = false;
  const stampHtml = game.won
    ? `<div class="stamp-badge win ${animate ? 'enter' : ''}">Winner</div>`
    : `<div class="stamp-badge quiet ${animate ? 'enter' : ''}">Good Try</div>`;
  const confettiHtml = animate && game.won ? confettiPiecesHtml(26) : '';
  if (animate) playSound(game.won ? '/sounds/game-win.mp3' : '/sounds/game-over.mp3');
  return `
    <div class="center">
      ${confettiHtml}
      <h2>${game.won ? 'You cleared the board!' : 'Game over'}</h2>
      ${stampHtml}
      <div class="sol-finish-stats">
        <span>${game.cardsHome}/52 cards home</span>
        <span>${game.moves} moves</span>
        <span>${formatTime(currentElapsed())}</span>
      </div>
      ${!name ? '<p class="sol-hint">Set your name above to save this to the shared leaderboard.</p>' : ''}
      ${mode === 'free' ? '<button id="new-round-btn">New Deal</button>' : '<p class="sol-hint">Come back tomorrow for a new daily deal.</p>'}
    </div>
  `;
}
function bodyDailyLocked(result) {
  return `
    <div class="center">
      <h2>Today's deal — already played</h2>
      <div class="sol-finish-stats">
        <span>${result.won ? 'Won' : 'Gave up'}</span>
        <span>${result.cardsHome}/52 cards home</span>
        <span>${formatTime(result.elapsedSeconds)}</span>
      </div>
      <p class="sol-hint">One attempt per day, so you can compare fairly — come back tomorrow, or switch to Free Play.</p>
    </div>
  `;
}

function bindHeaderControls() {
  bindThemeToggle();
  document.getElementById('stats-toggle-btn')?.addEventListener('click', async () => {
    statsPanelOpen = !statsPanelOpen;
    if (statsPanelOpen) await refreshStats();
    render();
  });
}
function bindTabs() {
  document.querySelectorAll('.choice-btn[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => { if (btn.dataset.mode !== mode) enterMode(btn.dataset.mode); });
  });
}
function bindNameField() {
  window.NamePicker.bind(document.querySelector('.sol-name-row .name-picker'), (newName) => {
    name = newName;
    enterMode(mode); // re-check the daily lock under the new name
  });
}
function bindStatsPanel() {
  document.getElementById('stats-close-btn')?.addEventListener('click', () => {
    statsPanelOpen = false;
    render();
  });
}
function bindBoard() {
  document.querySelectorAll('.sol-card.draggable').forEach((el) => {
    el.addEventListener('pointerdown', (e) => beginDrag(e, resolveClientSource(el)));
    el.addEventListener('dblclick', () => {
      snapshotForUndo();
      try {
        autoMoveToFoundation(game, resolveClientSource(el));
        afterGameChange();
      } catch (err) {
        history.pop();
        flashError(err.message);
      }
    });
  });
  document.getElementById('sol-stock')?.addEventListener('click', () => {
    snapshotForUndo();
    try {
      draw(game);
      afterGameChange();
    } catch (err) {
      history.pop();
      flashError(err.message);
    }
  });
  document.getElementById('undo-btn')?.addEventListener('click', undo);
}

function render() {
  let body;
  if (mode === 'daily' && dailyLockedResult && (!game || game.mode !== 'daily')) {
    body = bodyDailyLocked(dailyLockedResult);
  } else if (!game) {
    body = '<div class="center">Loading&hellip;</div>';
  } else if (game.phase === 'finished') {
    body = bodyFinished();
  } else {
    body = bodyPlaying();
  }
  app.innerHTML = `${headerHtml()}${tabsHtml()}${nameFieldHtml()}${body}${statsPanelOpen ? statsPanelHtml() : ''}`;

  bindHeaderControls();
  bindTabs();
  bindNameField();
  bindStatsPanel();
  if (game && game.phase === 'playing') bindBoard();
  document.getElementById('new-round-btn')?.addEventListener('click', () => { newRound(); render(); });
  document.getElementById('give-up-btn')?.addEventListener('click', () => {
    if (confirm('Give up this game? It counts as a loss with your current progress.')) {
      giveUp(game);
      afterGameChange();
    }
  });
}

enterMode(mode);
