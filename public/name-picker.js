// Shared "who am I" picker — Brian / Justy / a custom typed name — used by
// every game page. A plain script (not an ES module) attached to
// `window.NamePicker`, so it works identically whether the including page
// uses classic <script> tags (Yahtzee, Connect Four, Battleship, Checkers)
// or `type="module"` (Solitaire) — a module can still read a global a
// preceding classic script attached to `window`.
//
// One shared localStorage key ('gamenight-name') across all 5 games, on
// purpose (mirrors 'yahtzee-theme') — Brian/Justy's identity is a
// cross-game concept, not a per-game one. Persistence here only remembers
// the *choice*; each page still owns what "selecting a name" actually does
// (send `setName` over its own WebSocket room, or just hold it locally for
// Solitaire) via the `onSelect` callback passed to `bind`.
(function () {
  const STORAGE_KEY = 'gamenight-name';
  const CHOICES = ['Brian', 'Justy'];

  function getSaved() {
    try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
  }
  function save(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* private browsing — picking still works this session */ }
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function html(selected) {
    const isCustom = !!selected && !CHOICES.includes(selected);
    const buttons = CHOICES.map((n) => `<button type="button" class="choice-btn name-pick-btn ${selected === n ? 'active' : ''}" data-name="${n}">${n}</button>`).join('');
    const customBtn = `<button type="button" class="choice-btn name-pick-btn ${isCustom ? 'active' : ''}" data-name="__custom">Custom</button>`;
    const customInput = `<input type="text" class="name-pick-custom-input" ${isCustom ? '' : 'hidden'} maxlength="24" placeholder="Your name" value="${isCustom ? escapeHtml(selected) : ''}" />`;
    return `<div class="choice-group name-picker">${buttons}${customBtn}${customInput}</div>`;
  }

  // rootEl: the container `html()` was rendered into. onSelect(name) fires
  // with a non-empty name the instant it's chosen (a pill click) or
  // committed (the custom input's change/blur/Enter) — never with an empty
  // string, so callers don't need to guard against that themselves.
  function bind(rootEl, onSelect) {
    if (!rootEl) return;
    const customInput = rootEl.querySelector('.name-pick-custom-input');
    rootEl.querySelectorAll('.name-pick-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.name === '__custom') {
          if (customInput) customInput.hidden = false;
          customInput?.focus();
          return;
        }
        save(btn.dataset.name);
        onSelect(btn.dataset.name);
      });
    });
    customInput?.addEventListener('change', () => {
      const value = customInput.value.trim();
      if (!value) return;
      save(value);
      onSelect(value);
    });
  }

  window.NamePicker = {
    STORAGE_KEY, getSaved, save, html, bind,
  };
}());
