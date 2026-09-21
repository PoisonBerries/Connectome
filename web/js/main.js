import { loadData, todayNumber, dateOfPuzzle, msUntilNextPuzzle } from './data.js';
import { Game, GATEWAY_COST, COMPASS_COST } from './game.js';
import { Stage } from './stage.js';
import { Ambient } from './ambient.js';
import { drawConstellation } from './map.js';
import { shareText, shareOrCopy, copyText } from './share.js';
import { sound, haptic } from './sound.js';
import { settings as settingsStore, saves, stats as statsStore, TIERS, tierIndex } from './store.js';
import { hydrateIcons } from './icons.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const state = {
  world: null,
  game: null,
  stage: null,
  today: 1,
  settings: settingsStore.load(),
  compass: null, // {node, ids:Set} valid only while you stay on that word
  lastTier: null,
  map: null,
  cal: null,
};

// ------------------------------------------------------------------ boot

hydrateIcons();
const ambient = new Ambient($('ambient'));
applySettings();

loadData()
  .then((world) => {
    state.world = world;
    state.today = Math.max(1, todayNumber(world));
    state.stage = new Stage({
      root: $('stage'),
      svg: $('synapses'),
      layer: $('nodes'),
      burst: $('burst'),
      onPick: (id) => pick(id),
    });
    // ?p=N replays an earlier puzzle; future puzzles stay locked (append &dev=1 to preview them while testing)
    const q = new URLSearchParams(location.search);
    const wanted = Number(q.get('p'));
    const allowed = Number.isInteger(wanted) && wanted >= 1 && (wanted <= state.today || q.has('dev'));
    loadPuzzle(allowed ? wanted : state.today, { push: false });
    wireEvents();
    if (!state.settings.seenHelp) setTimeout(() => openDialog('dlg-help'), 350);
    setInterval(tickCountdown, 1000);
  })
  .catch((err) => {
    console.error(err);
    $('live').textContent = 'Could not load the puzzle data.';
    document.querySelector('main').insertAdjacentHTML(
      'afterbegin',
      '<p class="lede" style="padding:24px 4px">Couldn\'t load the word network. If you opened this file directly, serve the folder with a local web server (for example <code>python3 -m http.server</code>) and try again.</p>'
    );
  });

// ------------------------------------------------------------------ settings

function applySettings() {
  const s = state.settings;
  const light = s.theme === 'light' || (s.theme === 'auto' && matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.documentElement.dataset.motion = s.motion ? 'on' : 'off';
  document.querySelector('meta[name="theme-color"]').content = light ? '#f6f3ec' : '#070913';
  sound.enabled = s.sound;
  ambient.readTheme();
  ambient.setAnimate(s.motion && !matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function saveSettings(patch) {
  Object.assign(state.settings, patch);
  settingsStore.save(state.settings);
  applySettings();
}

matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => state.settings.theme === 'auto' && applySettings());

// ------------------------------------------------------------------ puzzle lifecycle

function loadPuzzle(num, { push = true } = {}) {
  const { world } = state;
  state.map?.stop();
  const puzzle = world.puzzleFor(num);
  state.game = new Game(world, puzzle, saves.load(num));
  state.compass = null;
  state.lastTier = null;

  if (push) {
    const url = new URL(location.href);
    num === state.today ? url.searchParams.delete('p') : url.searchParams.set('p', num);
    history.replaceState(null, '', url);
  }

  const date = dateOfPuzzle(world, num);
  $('meta-num').textContent = `Puzzle #${num}`;
  $('meta-date').textContent = date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  $('from-word').textContent = world.words[puzzle.start];
  $('to-word').textContent = world.words[puzzle.target];
  $('from-sub').textContent = puzzle.startLabel || '';
  $('to-sub').textContent = puzzle.targetLabel || '';
  $('par-count').textContent = puzzle.par;
  document.title = `Connectome #${num} — the daily word-wiring game`;

  const g = state.game;
  $('gateways').hidden = !g.gatewaysShown;
  if (g.gatewaysShown) fillGateways();
  render({ animate: false });
}

// ------------------------------------------------------------------ rendering

function view() {
  const g = state.game;
  return {
    current: g.current,
    options: g.over ? [] : g.options,
    target: g.puzzle.target,
    visited: g.visited,
    words: state.world.words,
    compass: state.compass && state.compass.node === g.current ? state.compass.ids : null,
  };
}

function render({ animate = true, from = null } = {}) {
  const g = state.game;
  state.stage.render(view(), { animate, from });
  renderHud();
  renderTrail();
  announce();
}

function renderHud() {
  const g = state.game;
  const badge = $('hop-count');
  if (badge.textContent !== String(g.score)) {
    badge.textContent = g.score;
    const box = badge.parentElement;
    box.classList.remove('bump');
    void box.offsetWidth;
    box.classList.add('bump');
  }
  $('btn-undo').disabled = !g.canUndo();
  $('btn-hint').disabled = g.over;
  $('btn-giveup').disabled = g.over;
  $('btn-hint').classList.toggle('on', g.hintsUsed > 0 && !g.over);
  $('btn-hint').querySelector('span').textContent = g.hintsUsed ? `Hint · ${g.hintsUsed}` : 'Hint';
  document.querySelector('.controls').classList.toggle('over', g.over);
  $('btn-results').hidden = !g.over;
  for (const id of ['btn-undo', 'btn-hint', 'btn-map', 'btn-giveup']) $(id).hidden = g.over;
}

function renderTrail() {
  const g = state.game;
  const w = state.world.words;
  const el = $('trail');
  const parts = [];
  g.path.forEach((id, i) => {
    const last = i === g.path.length - 1;
    if (i) parts.push('<span class="sep"></span>');
    const cls = ['chip', i === 0 ? 'first' : '', last ? (g.status === 'won' ? 'won' : 'now') : ''].filter(Boolean).join(' ');
    parts.push(
      last || g.over
        ? `<span class="${cls}">${esc(w[id])}</span>`
        : `<button class="${cls}" data-i="${i}" aria-label="Jump back to ${esc(w[id])}">${esc(w[id])}</button>`
    );
  });
  if (g.status !== 'won') {
    parts.push('<span class="sep dim"></span>', `<span class="chip goal">${esc(w[g.puzzle.target])}</span>`);
  }
  el.innerHTML = parts.join('');
  el.scrollTo({ left: el.scrollWidth, behavior: state.settings.motion ? 'smooth' : 'auto' });
}

function announce() {
  const g = state.game;
  const w = state.world.words;
  $('live').textContent = g.over
    ? g.status === 'won' ? `You reached ${w[g.puzzle.target]} in ${g.score} hops.` : 'Puzzle revealed.'
    : `At ${w[g.current]}. Options: ${g.options.map((o, i) => `${i + 1} ${w[o]}`).join(', ')}. Target: ${w[g.puzzle.target]}.`;
}

function fillGateways() {
  const { world, game } = state;
  $('gateway-chips').innerHTML = world
    .gateways(game.puzzle.target)
    .map((id) => `<span class="chip">${esc(world.words[id])}</span>`)
    .join('');
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ------------------------------------------------------------------ actions

function persist() {
  saves.save(state.game.puzzle.num, state.game.serialize());
}

function pick(id) {
  const g = state.game;
  if (g.over) return;
  const rec = g.hop(id);
  if (!rec) return;
  state.compass = null;
  persist();

  const progress = g.puzzle.par ? clamp(1 - g.dist[id] / Math.max(1, g.dist[g.puzzle.start]), 0, 1) : 0;
  sound.hop(progress, Math.sign(rec.before - rec.after));
  haptic(8);

  render();
  if (g.status === 'won') celebrate();
}

function celebrate() {
  const { stage, game } = state;
  sound.win();
  haptic(30);
  setTimeout(() => {
    const p = stage.centerOf(game.puzzle.target);
    stage.burst(p.x, p.y);
  }, 350);
  setTimeout(() => finish(), 1500);
}

function undo() {
  const g = state.game;
  if (!g.canUndo()) return;
  const from = state.stage.centerOf(g.current);
  g.undo();
  state.compass = null;
  persist();
  sound.back();
  render({ from });
}

function jumpTo(i) {
  const g = state.game;
  const from = state.stage.centerOf(g.current);
  if (!g.jumpTo(i)) return;
  state.compass = null;
  persist();
  sound.back();
  render({ from });
}

function useGateways() {
  const g = state.game;
  if (g.over) return;
  const first = !g.gatewaysShown;
  g.showGateways();
  fillGateways();
  $('gateways').hidden = false;
  persist();
  sound.hint();
  renderHud();
  toast(first ? `Gateways revealed · +${GATEWAY_COST} hop` : 'Gateways are already showing');
}

function useCompass() {
  const g = state.game;
  if (g.over) return;
  const ids = new Set(g.compass());
  state.compass = { node: g.current, ids };
  persist();
  sound.hint();
  render({ animate: false });
  toast(`Compass on · +${COMPASS_COST} hops`);
}

function giveUp() {
  const g = state.game;
  if (g.over) return;
  g.giveUp();
  persist();
  sound.lose();
  render({ animate: false });
  finish();
}

function finish({ show = true } = {}) {
  const { game, world } = state;
  const num = game.puzzle.num;
  const won = game.status === 'won';
  const tier = won ? tierIndex(game.score, game.puzzle.par) : -1;
  if (!saves.index()[num]) {
    statsStore.record(num, state.today, won, Math.max(0, tier));
    saves.mark(num, { status: game.status, score: game.score, tier });
  }
  state.lastTier = tier;
  if (show) openResult();
}

// ------------------------------------------------------------------ dialogs

function openDialog(id) {
  const d = $(id);
  if (!d.open) d.showModal();
  return d;
}

function closeAllDialogs() {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  $('toasts').replaceChildren(t);
  setTimeout(() => t.remove(), 2300);
}

function fmtCountdown() {
  const ms = msUntilNextPuzzle();
  const s = Math.floor(ms / 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

function tickCountdown() {
  document.querySelectorAll('.next b').forEach((b) => (b.textContent = fmtCountdown()));
  const t = todayNumber(state.world);
  if (t !== state.today && t > state.today) {
    // midnight rolled over while the tab was open
    state.today = t;
    if (!document.querySelector('dialog[open]')) toast('A new puzzle is ready. Reload to play!');
  }
}

function nextBlock() {
  return `Next puzzle in<b>${fmtCountdown()}</b>`;
}

function statBoxes(s, ids) {
  const pct = s.played ? Math.round((s.wins / s.played) * 100) : 0;
  return [
    ['Played', s.played], ['Win %', pct], ['Streak', s.streak], ['Best', s.maxStreak],
  ].map(([l, v]) => `<div class="stat"><b>${v}</b><small>${l}</small></div>`).join('');
}

function openStats() {
  const s = statsStore.load();
  $('stat-row').innerHTML = statBoxes(s);
  const max = Math.max(1, ...s.dist);
  $('dist').innerHTML = TIERS.map((t, i) => {
    const pct = Math.max(9, Math.round((s.dist[i] / max) * 100));
    return `<div class="bar ${state.lastTier === i ? 'hl' : ''}"><span>${t.emoji} ${t.name}</span><div class="fill" style="width:${pct}%">${s.dist[i]}</div></div>`;
  }).join('');
  $('stats-next').innerHTML = nextBlock();
  openDialog('dlg-stats');
}

function openResult() {
  const { game, world } = state;
  const won = game.status === 'won';
  const tier = won ? tierIndex(game.score, game.puzzle.par) : -1;
  const T = TIERS[tier];
  const p = game.puzzle;

  $('res-emoji').textContent = won ? T.emoji : '🌫️';
  $('res-title').textContent = won ? T.name : 'Signal lost';
  $('res-sub').textContent = won
    ? `${world.words[p.start]} to ${world.words[p.target]} in ${game.score} hops${game.score === p.par ? ', the shortest possible.' : `. The shortest route is ${p.par}.`}`
    : `The shortest route from where you stopped was ${game.revealed ? game.revealed.length - 1 : '?'} hops.`;

  $('res-stats').innerHTML = [
    ['Hops', game.score, game.penalty ? `${game.moves} + ${game.penalty} hint` : ''],
    ['Par', p.par, ''],
    ['Words seen', game.discovered().size, ''],
  ].map(([l, v, sub]) => `<div class="stat"><b>${v}</b><small>${l}</small>${sub ? `<em>${sub}</em>` : ''}</div>`).join('');

  const route = world.shortestPath(p.start, p.target) || [];
  $('res-route-body').innerHTML = `<div class="path-words">${route.map((id) => esc(world.words[id])).join(' <i>→</i> ')}</div>`;
  $('res-route').open = !won;

  const text = shareText(game, world, tier, location.origin && location.origin !== 'null' ? location.origin + location.pathname : '');
  $('share-preview').textContent = text;

  const s = statsStore.load();
  const pct = s.played ? Math.round((s.wins / s.played) * 100) : 0;
  $('res-mini').innerHTML = [['Played', s.played], ['Win %', pct], ['Streak', s.streak], ['Best', s.maxStreak]]
    .map(([l, v]) => `<div><b>${v}</b><small>${l}</small></div>`).join('');
  $('res-next').innerHTML = nextBlock();

  const d = openDialog('dlg-result');
  state.map?.stop();
  requestAnimationFrame(() => (state.map = drawConstellation($('res-canvas'), world, game, { animate: state.settings.motion })));
  d.scrollTop = 0;
}

function openMap() {
  const { game, world } = state;
  $('map-sub').textContent = `${game.visited.size} words visited · ${game.discovered().size} seen`;
  openDialog('dlg-map');
  state.map?.stop();
  requestAnimationFrame(() => (state.map = drawConstellation($('map-canvas'), world, game, { animate: state.settings.motion })));
}

// ---- archive

function openArchive() {
  const today = dateOfPuzzle(state.world, state.today);
  state.cal = { y: today.getFullYear(), m: today.getMonth() };
  renderCalendar();
  openDialog('dlg-archive');
}

function renderCalendar() {
  const { world } = state;
  const { y, m } = state.cal;
  const first = new Date(y, m, 1);
  const days = new Date(y, m + 1, 0).getDate();
  const epoch = dateOfPuzzle(world, 1);
  const today = dateOfPuzzle(world, state.today);
  const idx = saves.index();
  $('cal-title').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('cal-prev').disabled = new Date(y, m, 0) < epoch;
  $('cal-next').disabled = new Date(y, m + 1, 1) > today;

  const cells = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<div class="dow">${d}</div>`);
  for (let i = 0; i < first.getDay(); i++) cells.push('<div class="day blank"></div>');
  for (let d = 1; d <= days; d++) {
    const date = new Date(y, m, d);
    const num = Math.round((Date.UTC(y, m, d) - Date.UTC(epoch.getFullYear(), epoch.getMonth(), epoch.getDate())) / 86400000) + 1;
    const playable = num >= 1 && num <= state.today;
    const rec = idx[num];
    const cls = ['day', playable ? '' : 'off', num === state.today ? 'today' : '', rec ? (rec.status === 'won' ? 'won' : 'lost') : ''].filter(Boolean).join(' ');
    const mark = rec ? `<small>${rec.status === 'won' ? TIERS[rec.tier]?.emoji || '✓' : '·'}</small>` : '';
    cells.push(
      playable
        ? `<button class="${cls}" data-num="${num}" aria-label="Puzzle ${num}, ${date.toDateString()}">${d}${mark}</button>`
        : `<div class="${cls}">${d}</div>`
    );
  }
  $('cal').innerHTML = cells.join('');
}

// ---- settings dialog

function openSettings() {
  const s = state.settings;
  document.querySelectorAll('#seg-theme button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === s.theme)));
  $('set-sound').checked = s.sound;
  $('set-motion').checked = s.motion;
  openDialog('dlg-settings');
}

// ------------------------------------------------------------------ events

function wireEvents() {
  $('btn-help').onclick = () => openDialog('dlg-help');
  $('btn-stats').onclick = openStats;
  $('btn-archive').onclick = openArchive;
  $('btn-settings').onclick = openSettings;
  $('btn-undo').onclick = undo;
  $('btn-hint').onclick = () => {
    $('hint-gateways').disabled = state.game.gatewaysShown;
    openDialog('dlg-hint');
  };
  $('btn-map').onclick = openMap;
  $('btn-giveup').onclick = () => openDialog('dlg-giveup');
  $('btn-results').onclick = () => finish({ show: true });

  $('help-go').onclick = () => {
    $('dlg-help').close();
  };
  $('dlg-help').addEventListener('close', () => {
    if (!state.settings.seenHelp) saveSettings({ seenHelp: true });
  });

  $('hint-gateways').onclick = () => { $('dlg-hint').close(); useGateways(); };
  $('hint-compass').onclick = () => { $('dlg-hint').close(); useCompass(); };
  $('giveup-no').onclick = () => $('dlg-giveup').close();
  $('giveup-yes').onclick = () => { $('dlg-giveup').close(); giveUp(); };

  $('trail').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (b) jumpTo(Number(b.dataset.i));
  });

  $('cal-prev').onclick = () => { state.cal.m--; if (state.cal.m < 0) { state.cal.m = 11; state.cal.y--; } renderCalendar(); };
  $('cal-next').onclick = () => { state.cal.m++; if (state.cal.m > 11) { state.cal.m = 0; state.cal.y++; } renderCalendar(); };
  $('cal').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-num]');
    if (!b) return;
    closeAllDialogs();
    loadPuzzle(Number(b.dataset.num));
    if (state.game.over) setTimeout(() => finish({ show: true }), 250);
  });

  document.querySelectorAll('#seg-theme button').forEach((b) => {
    b.onclick = () => {
      saveSettings({ theme: b.dataset.v });
      document.querySelectorAll('#seg-theme button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    };
  });
  $('set-sound').onchange = (e) => { saveSettings({ sound: e.target.checked }); if (e.target.checked) sound.hint(); };
  $('set-motion').onchange = (e) => saveSettings({ motion: e.target.checked });
  $('set-reset').onclick = () => {
    if (!confirm('Clear all stats, streaks and saved games on this device?')) return;
    try {
      Object.keys(localStorage).filter((k) => k.startsWith('connectome:v1:') && !k.endsWith('settings')).forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
    location.reload();
  };

  $('btn-share').onclick = async () => {
    const r = await shareOrCopy($('share-preview').textContent);
    if (r === 'copied') toast('Copied to clipboard');
    else if (r === 'failed') toast('Couldn\'t copy. Select the text instead.');
  };
  $('btn-copy').onclick = () => toast(copyText($('share-preview').textContent) ? 'Copied to clipboard' : 'Couldn\'t copy. Select the text instead.');

  // click outside a dialog to dismiss it; stop map animation loops when closed
  document.querySelectorAll('dialog').forEach((d) => {
    d.addEventListener('click', (e) => {
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
    });
    d.addEventListener('close', () => {
      if (d.id === 'dlg-map' || d.id === 'dlg-result') state.map?.stop();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    const g = state.game;
    if (/^[1-5]$/.test(e.key) && !g.over) {
      const id = g.options[Number(e.key) - 1];
      const el = state.stage.optionEl(id);
      if (el && !el.classList.contains('locked')) pick(id);
    } else if (e.key === 'Backspace' || e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'u') {
      e.preventDefault();
      undo();
    } else if (e.key.toLowerCase() === 'h' && !g.over) {
      $('btn-hint').click();
    } else if (e.key.toLowerCase() === 'm' && !g.over) {
      openMap();
    } else if (e.key === '?') {
      openDialog('dlg-help');
    }
  });

  // a finished puzzle opened from a saved game: offer results right away
  if (state.game.over) setTimeout(() => finish({ show: true }), 500);
}
