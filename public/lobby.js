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

const app = document.getElementById('app');

function render() {
  app.innerHTML = `
    <header>
      <div class="header-row">
        <div class="header-icon-group">${themeButtonHtml()}</div>
        <h1>Game Night</h1>
        <div class="header-icon-group"></div>
      </div>
    </header>
    <div class="lobby-wrap">
      <p class="lobby-sub">Pick what to play &mdash; whoever gets here first sets it, the other just joins.</p>
      <div class="lobby-tiles">
        <a class="game-tile" href="/yahtzee.html">
          <span class="tile-emoji">🎲</span>
          <span class="tile-text"><h2>Yahtzee</h2><p>Roll, hold, score. The classic.</p></span>
        </a>
        <a class="game-tile" href="/connect-four.html">
          <span class="tile-emoji">🔴</span>
          <span class="tile-text"><h2>Connect Four</h2><p>Get four in a row before they do.</p></span>
        </a>
        <a class="game-tile" href="/battleship.html">
          <span class="tile-emoji">🚢</span>
          <span class="tile-text"><h2>Battleship</h2><p>Hunt their fleet before they sink yours.</p></span>
        </a>
        <a class="game-tile" href="/checkers.html">
          <span class="tile-emoji">⚫</span>
          <span class="tile-text"><h2>Checkers</h2><p>Jump their pieces, king your way home.</p></span>
        </a>
        <a class="game-tile" href="/solitaire.html">
          <span class="tile-emoji">🃏</span>
          <span class="tile-text"><h2>Solitaire</h2><p>A solo game for whenever you've got a minute — plus a daily deal you both play and compare.</p></span>
        </a>
      </div>
    </div>
  `;
  bindThemeToggle();
}
render();
