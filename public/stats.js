const CATEGORY_LABELS = {
  ones: 'Aces', twos: 'Twos', threes: 'Threes', fours: 'Fours', fives: 'Fives', sixes: 'Sixes',
  threeOfAKind: '3 of a Kind', fourOfAKind: '4 of a Kind', fullHouse: 'Full House',
  smallStraight: 'Sm. Straight', largeStraight: 'Lg. Straight', yahtzee: 'Yahtzee', chance: 'Chance',
};
const CATEGORY_SHORT = {
  ones: 'Ace', twos: '2s', threes: '3s', fours: '4s', fives: '5s', sixes: '6s',
  threeOfAKind: '3K', fourOfAKind: '4K', fullHouse: 'FH',
  smallStraight: 'SS', largeStraight: 'LS', yahtzee: 'Yz', chance: 'Ch',
};
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

let theme = localStorage.getItem('yahtzee-theme');
if (theme) document.body.dataset.theme = theme;
function effectiveTheme() {
  return theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function themeButtonHtml() {
  const dark = effectiveTheme() === 'dark';
  return `<button id="theme-btn" class="icon-btn" title="Switch to ${dark ? 'light' : 'dark'} mode" aria-label="Toggle theme">${dark ? '☀' : '🌙'}</button>`;
}
function themeToggleHtml() {
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
    document.getElementById('theme-btn').outerHTML = themeButtonHtml();
    bindThemeToggle();
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

const app = document.getElementById('app');

async function main() {
  const stats = await fetch('/api/stats').then((r) => r.json());
  render(stats);
}

function render(stats) {
  const hasData = stats.players.length > 0;
  app.innerHTML = `
    <header>
      <div class="header-row">
        ${themeToggleHtml()}
        <h1>Stats</h1>
        <div class="header-icon-group"><a href="/yahtzee.html" class="icon-btn" title="Back to Yahtzee" aria-label="Back to Yahtzee">&larr;</a></div>
      </div>
    </header>
    <div class="stats-wrap">
      ${hasData ? statsBodyHtml(stats) : `<div class="stats-empty">No games finished yet &mdash; play one to start tracking stats.</div>`}
    </div>
  `;
  bindThemeToggle();
  if (hasData) {
    drawTrendChart(stats.trend);
    drawCategoryChart(stats.categoryAverages);
  }
}

function statsBodyHtml(stats) {
  return `
    <div class="stat-tiles">
      ${stats.players.map(statTileHtml).join('')}
    </div>
    <div class="chart-card">
      <h2>Score trend</h2>
      <p class="chart-sub">Total score across every finished game, in order played.</p>
      ${legendHtml(stats.players.map((p) => p.name))}
      <div class="chart-svg-wrap" id="trend-chart"></div>
    </div>
    <div class="chart-card">
      <h2>Average score by category</h2>
      <p class="chart-sub">Where each player tends to score high or low.</p>
      ${legendHtml(stats.players.map((p) => p.name))}
      <div class="chart-svg-wrap" id="category-chart"></div>
    </div>
    <div class="chart-card">
      <h2>Recent games</h2>
      <div class="table-scroll">
        <table class="stats-table">
          <thead><tr><th>Date</th><th>Player</th><th>Total</th></tr></thead>
          <tbody>${recentGamesRows(stats.recentGames)}</tbody>
        </table>
      </div>
    </div>
  `;
}

function statTileHtml(p) {
  const record = `${p.wins}-${p.losses}${p.ties ? `-${p.ties}` : ''}`;
  return `
    <div class="stat-tile">
      <div class="stat-name">${escapeHtml(p.name)}</div>
      <div class="stat-row"><span>Games played</span><b>${p.gamesPlayed}</b></div>
      <div class="stat-row"><span>Record (W-L${p.ties ? '-T' : ''})</span><b>${record}</b></div>
      <div class="stat-row"><span>Avg total</span><b>${p.avgTotal.toFixed(1)}</b></div>
      <div class="stat-row"><span>Upper bonus hit</span><b>${p.gamesPlayed ? Math.round((p.upperBonusCount / p.gamesPlayed) * 100) : 0}%</b></div>
      <div class="stat-row"><span>Yahtzee bonuses</span><b>${p.yahtzeeBonusCount}</b></div>
    </div>
  `;
}

function legendHtml(names) {
  return `
    <div class="chart-legend">
      ${names.map((n, i) => `<span class="key"><span class="swatch" style="background:var(--chart-${i + 1})"></span>${escapeHtml(n)}</span>`).join('')}
    </div>
  `;
}

function recentGamesRows(games) {
  const rows = [];
  for (const g of games) {
    const isWinner = g.winnerSeat === g.seat;
    const date = new Date(g.finishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    rows.push(`<tr><td>${date}</td><td>${escapeHtml(g.name)}</td><td class="${isWinner ? 'win' : ''}">${g.total}</td></tr>`);
  }
  return rows.join('');
}

// --- Charts (inline SVG, no library) ----------------------------------------

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function niceMax(n) {
  if (n <= 0) return 10;
  const mag = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / mag) * mag;
}

function drawTrendChart(trend) {
  const container = document.getElementById('trend-chart');
  const W = 640, H = 220, PAD = { top: 10, right: 28, bottom: 24, left: 34 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const byName = new Map();
  for (const row of trend) {
    if (!byName.has(row.name)) byName.set(row.name, []);
    byName.get(row.name).push(row);
  }
  const names = [...byName.keys()];
  const gameCount = Math.max(...names.map((n) => byName.get(n).length), 1);
  const maxTotal = niceMax(Math.max(...trend.map((r) => r.total), 50));

  const x = (i) => PAD.left + (gameCount <= 1 ? plotW / 2 : (i / (gameCount - 1)) * plotW);
  const y = (v) => PAD.top + plotH - (v / maxTotal) * plotH;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: 'auto', role: 'img', 'aria-label': 'Score trend over games' });

  // gridlines
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const v = Math.round((maxTotal / ticks) * t);
    const gy = y(v);
    svg.appendChild(svgEl('line', { x1: PAD.left, x2: W - PAD.right, y1: gy, y2: gy, stroke: 'var(--line)', 'stroke-width': 1 }));
    const label = svgEl('text', { x: PAD.left - 8, y: gy + 3, 'text-anchor': 'end', 'font-size': 9, fill: 'var(--ink-soft)', 'font-family': 'Poppins, sans-serif' });
    label.textContent = v;
    svg.appendChild(label);
  }

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  const hoverDot = svgEl('circle', { r: 5, fill: 'var(--ink)', stroke: 'var(--chart-surface)', 'stroke-width': 2, opacity: 0 });

  const endLabels = [];
  names.forEach((name, seriesIdx) => {
    const points = byName.get(name);
    const color = `var(--chart-${seriesIdx + 1})`;
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.total)}`).join(' ');
    svg.appendChild(svgEl('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    points.forEach((p, i) => {
      const dot = svgEl('circle', { cx: x(i), cy: y(p.total), r: 3, fill: color, 'data-name': name, 'data-total': p.total, 'data-game': i + 1 });
      svg.appendChild(dot);
    });
    const last = points[points.length - 1];
    endLabels.push({ x: x(points.length - 1) + 6, y: y(last.total), value: last.total });
  });

  // Nudge colliding end-labels apart vertically (leader-line-free version for 2 series).
  const MIN_GAP = 12;
  endLabels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++) {
    if (endLabels[i].y - endLabels[i - 1].y < MIN_GAP) {
      endLabels[i].y = endLabels[i - 1].y + MIN_GAP;
    }
  }
  endLabels.forEach((lbl) => {
    const el = svgEl('text', {
      x: lbl.x, y: lbl.y + 3, 'font-size': 9, fill: 'var(--ink)', 'font-weight': 700, 'font-family': 'Poppins, sans-serif',
    });
    el.textContent = lbl.value;
    svg.appendChild(el);
  });

  svg.appendChild(hoverDot);

  svg.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const scaleX = W / rect.width;
    const mx = (e.clientX - rect.left) * scaleX;
    let nearest = null, nearestDist = Infinity;
    svg.querySelectorAll('circle[data-name]').forEach((dot) => {
      const cx = parseFloat(dot.getAttribute('cx'));
      const dist = Math.abs(cx - mx);
      if (dist < nearestDist) { nearestDist = dist; nearest = dot; }
    });
    if (nearest && nearestDist < 20) {
      hoverDot.setAttribute('cx', nearest.getAttribute('cx'));
      hoverDot.setAttribute('cy', nearest.getAttribute('cy'));
      hoverDot.setAttribute('opacity', 1);
      const scale = rect.width / W;
      tooltip.textContent = `${nearest.dataset.name} · game ${nearest.dataset.game}: ${nearest.dataset.total}`;
      tooltip.style.left = `${parseFloat(nearest.getAttribute('cx')) * scale}px`;
      tooltip.style.top = `${parseFloat(nearest.getAttribute('cy')) * scale}px`;
      tooltip.classList.add('show');
    } else {
      hoverDot.setAttribute('opacity', 0);
      tooltip.classList.remove('show');
    }
  });
  svg.addEventListener('mouseleave', () => {
    hoverDot.setAttribute('opacity', 0);
    tooltip.classList.remove('show');
  });

  container.innerHTML = '';
  container.style.position = 'relative';
  container.appendChild(svg);
  container.appendChild(tooltip);
}

function drawCategoryChart(categoryAverages) {
  const container = document.getElementById('category-chart');
  const byName = new Map();
  for (const row of categoryAverages) {
    if (!byName.has(row.name)) byName.set(row.name, {});
    byName.get(row.name)[row.category] = row.avgScore;
  }
  const names = [...byName.keys()];
  const maxVal = niceMax(Math.max(...categoryAverages.map((r) => r.avgScore), 10));

  const W = 640, H = 260, PAD = { top: 10, right: 10, bottom: 34, left: 30 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const groupW = plotW / CATEGORY_ORDER.length;
  const barGap = 2;
  const barW = Math.min(22, (groupW - barGap * (names.length + 1)) / names.length);

  const y = (v) => PAD.top + plotH - (v / maxVal) * plotH;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: 'auto', role: 'img', 'aria-label': 'Average score per category' });

  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const v = Math.round((maxVal / ticks) * t);
    const gy = y(v);
    svg.appendChild(svgEl('line', { x1: PAD.left, x2: W - PAD.right, y1: gy, y2: gy, stroke: 'var(--line)', 'stroke-width': 1 }));
    const label = svgEl('text', { x: PAD.left - 6, y: gy + 3, 'text-anchor': 'end', 'font-size': 9, fill: 'var(--ink-soft)', 'font-family': 'Poppins, sans-serif' });
    label.textContent = v;
    svg.appendChild(label);
  }

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';

  CATEGORY_ORDER.forEach((cat, ci) => {
    const groupX = PAD.left + ci * groupW;
    names.forEach((name, ni) => {
      const val = byName.get(name)[cat] || 0;
      const bx = groupX + barGap + ni * (barW + barGap);
      const by = y(val);
      const bh = PAD.top + plotH - by;
      const color = `var(--chart-${ni + 1})`;
      const rect = svgEl('rect', {
        x: bx, y: by, width: barW, height: Math.max(bh, 0), rx: 4, ry: 4, fill: color,
        'data-name': name, 'data-cat': CATEGORY_LABELS[cat], 'data-val': val.toFixed(1),
      });
      svg.appendChild(rect);
    });
    const label = svgEl('text', {
      x: groupX + groupW / 2, y: PAD.top + plotH + 14, 'text-anchor': 'middle', 'font-size': 8.5,
      fill: 'var(--ink-soft)', 'font-family': 'Poppins, sans-serif', 'font-weight': 600,
    });
    label.textContent = CATEGORY_SHORT[cat];
    svg.appendChild(label);
  });

  svg.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const target = e.target;
    if (target.tagName === 'rect' && target.dataset.name) {
      const scale = rect.width / W;
      tooltip.textContent = `${target.dataset.name} · ${target.dataset.cat}: ${target.dataset.val}`;
      const bx = parseFloat(target.getAttribute('x')) + parseFloat(target.getAttribute('width')) / 2;
      const by = parseFloat(target.getAttribute('y'));
      tooltip.style.left = `${bx * scale}px`;
      tooltip.style.top = `${by * scale}px`;
      tooltip.classList.add('show');
    } else {
      tooltip.classList.remove('show');
    }
  });
  svg.addEventListener('mouseleave', () => tooltip.classList.remove('show'));

  container.innerHTML = '';
  container.style.position = 'relative';
  container.appendChild(svg);
  container.appendChild(tooltip);
}

main();
