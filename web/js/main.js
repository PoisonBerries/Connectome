import { loadData, todayNumber, dateOfPuzzle, msUntilNextPuzzle } from './data.js';
import { Game, GATEWAY_COST, COMPASS_COST, PLASTICITY_COST } from './game.js';
import { Stage } from './stage.js';
import { Ambient } from './ambient.js';
import { drawConstellation } from './map.js';
import { shareText, shareOrCopy, copyText } from './share.js';
import { sound, haptic } from './sound.js';
import { settings as settingsStore, saves, stats as statsStore, endless as endlessStore, TIERS, tierIndex } from './store.js';
import { EndlessRun, minForRound } from './endless.js';
import { hydrateIcons } from './icons.js';
import { submitDailyResult, fetchDailyStats, percentileBetterThan } from './firebase.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const state = {
  world: null,
  game: null,
  stage: null,
  today: 1,
  settings: settingsStore.load(),
  lastTier: null,
  map: null,
  cal: null,
  mode: 'daily', // 'daily' | 'endless'
  run: null, // EndlessRun while in endless mode
  dailyNum: 1, // the daily puzzle to return to
  endlessResult: null,
  communityCache: new Map(), // puzzle number -> community stats (or null), so reopening results doesn't re-fetch
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
  state.lastTier = null;
  state.dailyNum = num;
  state.mode = 'daily';
  state.run = null;

  if (push) {
    const url = new URL(location.href);
    num === state.today ? url.searchParams.delete('p') : url.searchParams.set('p', num);
    history.replaceState(null, '', url);
  }
  document.title = `Connectome #${num} — the daily word-wiring game`;
  paintMode();
  paintMission();
  render({ animate: false });
}

/** Everything that depends on which mode (and which round/puzzle) we're in. */
function paintMode() {
  const endless = state.mode === 'endless';
  $('modes').dataset.mode = state.mode;
  $('mode-daily').setAttribute('aria-selected', String(!endless));
  $('mode-endless').setAttribute('aria-selected', String(endless));
  document.body.dataset.mode = state.mode;
  $('btn-giveup').querySelector('span').textContent = endless ? 'Quit' : 'Reveal';
  $('hop-label').textContent = endless ? 'left' : 'hops';
  if (endless) {
    const best = endlessStore.stats().best;
    $('meta-num').textContent = `Endless ∞ · Round ${state.run.round}`;
    $('meta-date').textContent = `${state.run.links} linked · best ${best}`;
    document.title = 'Connectome ∞ — endless mode';
  } else {
    const date = dateOfPuzzle(state.world, state.game.puzzle.num);
    $('meta-num').textContent = `Puzzle #${state.game.puzzle.num}`;
    $('meta-date').textContent = date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }
}

function paintMission() {
  const { world, game: g } = state;
  const p = g.puzzle;
  $('from-word').textContent = world.words[p.start];
  $('to-word').textContent = world.words[p.target];
  $('from-sub').textContent = p.startLabel || '';
  $('to-sub').textContent = p.targetLabel || '';
  $('min-line').innerHTML =
    state.mode === 'endless'
      ? `of <b id="min-count">${state.run.budget}</b>${state.run.carry > 0 ? `<span class="carry-note">+${state.run.carry} carried</span>` : ''}<span class="sep">·</span>min ${p.min}`
      : `min <b id="min-count">${p.min}</b>`;
  $('gateways').hidden = !g.gatewaysShown;
  if (g.gatewaysShown) fillGateways();
}

// ------------------------------------------------------------------ rendering

function view() {
  const g = state.game;
  return {
    current: g.current,
    options: frozen() ? [] : g.options,
    extras: new Set(frozen() ? [] : g.extraOptions), // plasticity's three extra links
    target: g.puzzle.target,
    visited: g.visited,
    words: state.world.words,
    compass: g.hasCompass() ? new Set(g.compassOptions()) : null, // stays lit here if this is the word it was used on
  };
}

function render({ animate = true, from = null } = {}) {
  const g = state.game;
  state.stage.render(view(), { animate, from });
  renderHud();
  renderTrail();
  announce();
}

/** Nothing more can be played (round celebrating, or the run has ended). */
function frozen() {
  return state.game.over || (state.mode === 'endless' && state.run.over);
}

/** The controls give way to the "See results" button. */
function finished() {
  return state.mode === 'endless' ? state.run.over : state.game.over;
}

function renderHud() {
  const g = state.game;
  const endless = state.mode === 'endless';
  const done = finished();
  const badge = $('hop-count');
  const shown = endless ? state.run.left : g.score;
  if (badge.textContent !== String(shown)) {
    badge.textContent = shown;
    const box = badge.parentElement;
    box.classList.remove('bump');
    void box.offsetWidth;
    box.classList.add('bump');
  }
  $('hops-badge').classList.toggle('low', endless && !done && state.run.left <= 3);
  $('btn-undo').disabled = frozen() || !g.canUndo();
  $('btn-hint').disabled = frozen();
  $('btn-giveup').disabled = frozen();
  $('btn-hint').classList.toggle('on', g.hintsUsed > 0 && !done);
  $('btn-hint').querySelector('span').textContent = g.hintsUsed ? `Hint · ${g.hintsUsed}` : 'Hint';
  document.querySelector('.controls').classList.toggle('over', done);
  $('btn-results').hidden = !done;
  for (const id of ['btn-undo', 'btn-hint', 'btn-map', 'btn-giveup', 'btn-reroll']) $(id).hidden = done;
  // gently point finished daily players at endless mode until they've tried it
  $('modes').classList.toggle('nudge', !endless && g.over && !state.settings.seenEndless);
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
  if (state.mode === 'endless') endlessStore.saveRun(state.run.serialize());
  else saves.save(state.game.puzzle.num, state.game.serialize());
}

function pick(id) {
  if (frozen()) return;
  const g = state.game;
  const res = state.mode === 'endless' ? state.run.hop(id) : (() => { const rec = g.hop(id); return rec && { rec, won: g.status === 'won' }; })();
  if (!res) return;
  const rec = res.rec;
  persist();

  const progress = g.puzzle.min ? clamp(1 - g.dist[id] / Math.max(1, g.dist[g.puzzle.start]), 0, 1) : 0;
  const trend = Math.sign(rec.before - rec.after);
  sound.hop(progress, trend);
  haptic(8);

  render();
  state.stage.pulseTrend(trend);
  if (state.mode === 'endless') {
    if (res.won) roundWon();
    else if (res.lost) runOver();
  } else if (res.won) celebrate();
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
  if (frozen() || !g.canUndo()) return;
  const from = state.stage.centerOf(g.current);
  g.undo();
  persist();
  sound.back();
  render({ from });
}

function jumpTo(i) {
  const g = state.game;
  if (frozen()) return;
  const from = state.stage.centerOf(g.current);
  if (!g.jumpTo(i)) return;
  persist();
  sound.back();
  render({ from });
}

/** In endless mode hints spend moves, and can't spend the last one. */
function affordable(cost) {
  if (state.mode !== 'endless' || state.run.canAfford(cost)) return true;
  toast('Not enough moves left for that hint');
  return false;
}

function useGateways() {
  const g = state.game;
  if (frozen()) return;
  const first = !g.gatewaysShown;
  if (first && !affordable(GATEWAY_COST)) return;
  g.showGateways();
  fillGateways();
  $('gateways').hidden = false;
  persist();
  sound.hint();
  renderHud();
  toast(first ? `Gateways revealed · ${state.mode === 'endless' ? '−' : '+'}${GATEWAY_COST} ${state.mode === 'endless' ? 'move' : 'hop'}` : 'Gateways are already showing');
}

function useCompass() {
  const g = state.game;
  if (frozen()) return;
  if (g.compassNodes.size > 0) {
    toast(`The compass is already used up for ${state.mode === 'endless' ? 'this round' : 'this puzzle'}`);
    return;
  }
  if (!affordable(COMPASS_COST)) return;
  g.compass();
  persist();
  sound.hint();
  render({ animate: false });
  toast(`Compass on · ${state.mode === 'endless' ? '−' : '+'}${COMPASS_COST} ${state.mode === 'endless' ? 'moves' : 'hops'}`);
}

function usePlasticity() {
  const g = state.game;
  if (frozen()) return;
  if (g.plasticityNodes.size > 0) {
    toast(`Plasticity is already used up for ${state.mode === 'endless' ? 'this round' : 'this puzzle'}`);
    return;
  }
  if (!affordable(PLASTICITY_COST)) return;
  if (!g.plasticity()) {
    toast('No extra links to grow on this word');
    return;
  }
  persist();
  sound.hint();
  render({ animate: true });
  toast(`3 extra links grown · ${state.mode === 'endless' ? '−' : '+'}${PLASTICITY_COST} ${state.mode === 'endless' ? 'moves' : 'hops'}`);
}

function giveUp() {
  const g = state.game;
  if (frozen()) return;
  if (state.mode === 'endless') {
    state.run.quit();
    return runOver();
  }
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
  const tier = won ? tierIndex(game.score, game.puzzle.min) : -1;
  if (!saves.index()[num]) {
    statsStore.record(num, state.today, won, Math.max(0, tier));
    saves.mark(num, { status: game.status, score: game.score, tier });
    if (state.mode === 'daily') {
      // fire-and-forget: submitDailyResult never throws, and community stats must never hold up the result screen
      submitDailyResult(num, { score: game.score, min: game.puzzle.min, won, path: game.path.map((i) => world.words[i]) });
    }
  }
  state.lastTier = tier;
  if (show) openResult();
}

/** Community numbers for the puzzle just finished: how you compare, and the route most solvers took. */
async function loadCommunity(num, myScore, won) {
  $('community').hidden = true;
  $('community-words').innerHTML = '';
  let data = state.communityCache.get(num);
  if (data === undefined) {
    data = await fetchDailyStats(num);
    state.communityCache.set(num, data);
  }
  // the result dialog may have moved on to a different puzzle while this was in flight
  if (state.game.puzzle.num !== num || !$('dlg-result').open || !data || !data.solved) return;

  // "you beat X%" only makes sense against a real finish, not a give-up
  const pct = won ? percentileBetterThan(data.hist, myScore) : null;
  $('community-row').innerHTML = [
    ['Solved by', data.solved],
    ['Avg hops', data.avg.toFixed(1)],
    ...(pct == null ? [] : [['You beat', `${pct}%`]]),
  ].map(([l, v]) => `<div class="stat"><b>${v}</b><small>${l}</small></div>`).join('');

  $('community-words').innerHTML = [
    ['Most started with', data.bestFirst, data.bestFirstPct],
    ['Most arrived via', data.bestLast, data.bestLastPct],
  ]
    .filter(([, word]) => word)
    .map(([label, word, p]) => `<div class="cword"><span class="route-label">${label}</span><span class="cword-val"><span class="chip">${esc(word)}</span><em>${p}%</em></span></div>`)
    .join('');
  $('community').hidden = false;
}

// ------------------------------------------------------------------ endless mode

function enterEndless() {
  closeAllDialogs();
  state.map?.stop();
  state.run = new EndlessRun(state.world, { saved: endlessStore.run() });
  state.mode = 'endless';
  state.game = state.run.game;
  state.endlessResult = null;
  persist();
  paintMode();
  paintMission();
  render({ animate: false });
  if (!state.settings.seenEndless) {
    saveSettings({ seenEndless: true });
    setTimeout(() => openDialog('dlg-endless-intro'), 250);
  }
}

function newEndlessRun() {
  endlessStore.clearRun();
  enterEndless();
}

/**
 * The easy "get me a new round" button: reroll instantly if there's nothing to lose yet (fresh round 1, no hops
 * made), otherwise confirm first since it discards the current run. Either way it skips straight to a new run
 * rather than routing through the full results screen — that's the whole point of it being the fast path.
 */
function rerollEndless() {
  const run = state.run;
  if (frozen()) return; // already over: the results screen's own "Play again" covers this
  const untouched = run.round === 1 && run.links === 0 && run.game.moves === 0;
  if (untouched) {
    newEndlessRun();
    return;
  }
  $('reroll-msg').textContent = run.links
    ? `You've chained ${run.links}. This ends the current run and locks that in.`
    : "You're partway through this round. Starting over discards that progress.";
  openDialog('dlg-reroll');
}

function confirmReroll() {
  const run = state.run;
  run.quit();
  endlessStore.record(run.links, run.totalHops);
  endlessStore.clearRun();
  toast(run.links ? `New run · ${run.links} linked before` : 'New run');
  newEndlessRun();
}

function backToDaily() {
  closeAllDialogs();
  loadPuzzle(state.dailyNum, { push: false });
  if (state.game.over) setTimeout(() => finish({ show: true }), 250);
}

/** Target reached: celebrate, then it becomes the next start word and a fresh target is rolled. */
function roundWon() {
  const { run, stage } = state;
  sound.win();
  haptic(30);
  toast(`Linked! ${run.links} in the chain`);
  setTimeout(() => {
    if (state.run !== run) return;
    const p = stage.centerOf(run.game.puzzle.target);
    stage.burst(p.x, p.y);
  }, 250);
  setTimeout(() => {
    if (state.run !== run || state.mode !== 'endless' || run.over) return;
    const leftover = run.left; // moves unspent this round; about to carry into the next one
    run.advance();
    state.game = run.game;
    persist();
    paintMode();
    paintMission();
    render({ animate: true });
    if (leftover > 0) {
      showCarryPop(leftover);
      animateCountUp($('hop-count'), run.baseBudget, run.left, run);
    }
  }, 1150);
}

/** Flashes a "+N carried" chip over the moves badge when unspent moves roll into the new round. */
function showCarryPop(n) {
  const el = $('carry-pop');
  el.textContent = `+${n} carried`;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

/** Counts the moves badge up from the shrunk base to the full carried-over total, so the carryover reads as arriving, not just appearing. */
function animateCountUp(el, from, to, run, duration = 800) {
  const start = performance.now();
  el.textContent = from;
  function step(now) {
    if (state.run !== run || run.left !== to) return; // a hop or a new run took over; leave the real value alone
    const t = Math.min(1, (now - start) / duration);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      const box = el.parentElement;
      box.classList.remove('bump');
      void box.offsetWidth;
      box.classList.add('bump');
    }
  }
  requestAnimationFrame(step);
}

function runOver() {
  const { run } = state;
  sound.lose();
  haptic(40);
  state.endlessResult = endlessStore.record(run.links, run.totalHops);
  endlessStore.clearRun();
  if (!run.game.over) run.game.giveUp(); // reveals the shortest route from where you stopped
  render({ animate: false });
  paintMode();
  setTimeout(() => state.run === run && openEndlessOver(), 900);
}

function openEndlessOver() {
  const { run, world } = state;
  const { stats, newBest } = state.endlessResult || { stats: endlessStore.stats(), newBest: false };
  const w = world.words;
  $('eo-emoji').textContent = newBest && run.links > 0 ? '🏆' : '🔗';
  $('eo-title').textContent = run.links === 0 ? 'Chain broken' : newBest ? 'New best!' : run.reason === 'quit' ? 'Run ended' : 'Out of moves';
  $('eo-sub').textContent =
    run.reason === 'quit'
      ? `You chained ${run.links} ${run.links === 1 ? 'link' : 'links'}.`
      : `You chained ${run.links} ${run.links === 1 ? 'link' : 'links'}, then ran out of moves reaching ${w[run.missed]}.`;
  $('eo-stats').innerHTML = [['Links', run.links], ['Best', stats.best], ['Hops', run.totalHops]]
    .map(([l, v]) => `<div class="stat"><b>${v}</b><small>${l}</small></div>`).join('');
  $('eo-chain').innerHTML =
    run.chain.map((id, i) => `<span class="chip${i === 0 ? ' first' : ''}">${esc(w[id])}</span>`).join('<span class="arr">→</span>') +
    (run.missed != null ? `<span class="arr">→</span><span class="chip miss">${esc(w[run.missed])}</span>` : '');
  const topMin = run.links ? minForRound(run.links) : 0;
  $('eo-share').textContent = [
    `Connectome ∞ 🔗×${run.links}${newBest && run.links ? ' 🏆' : ''}`,
    run.links ? `Chained ${run.links} ${run.links === 1 ? 'word' : 'words'} · up to min ${topMin} · ${run.totalHops} hops` : 'Broke the chain on the first link',
    location.origin && location.origin !== 'null' ? location.origin + location.pathname : '',
  ].filter(Boolean).join('\n');
  const p = run.game.puzzle;
  const here = run.game.current; // the word you were on when the run ended
  const fromStart = world.shortestPath(p.start, p.target) || [];
  const fromHere = here === p.start ? null : world.shortestPath(here, p.target);
  const line = (route) => `<div class="path-words">${route.map((id) => esc(w[id])).join(' <i>→</i> ')}</div>`;
  $('eo-route').querySelector('summary').textContent = 'The shortest routes';
  $('eo-route-body').innerHTML =
    `<div class="route-label">From the start · ${fromStart.length - 1} hops</div>${line(fromStart)}` +
    (fromHere ? `<div class="route-label">From where you stopped, ${esc(w[here])} · ${fromHere.length - 1} hops</div>${line(fromHere)}` : '');
  openDialog('dlg-endless-over');
  state.map?.stop();
  requestAnimationFrame(() => (state.map = drawConstellation($('eo-canvas'), world, run.game, { animate: state.settings.motion })));
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
  const tier = won ? tierIndex(game.score, game.puzzle.min) : -1;
  const T = TIERS[tier];
  const p = game.puzzle;

  $('res-emoji').textContent = won ? T.emoji : '🌫️';
  $('res-title').textContent = won ? T.name : 'Signal lost';
  $('res-sub').textContent = won
    ? `${world.words[p.start]} to ${world.words[p.target]} in ${game.score} hops${game.score === p.min ? ', the shortest possible.' : `. The shortest route is ${p.min}.`}`
    : `The shortest route from where you stopped was ${game.revealed ? game.revealed.length - 1 : '?'} hops.`;

  $('res-stats').innerHTML = [
    ['Hops', game.score, game.penalty ? `${game.moves} + ${game.penalty} hint` : ''],
    ['Min', p.min, ''],
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
  loadCommunity(p.num, game.score, game.status === 'won');
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
    const g = state.game;
    const spent = state.mode === 'endless' ? 'this round' : 'this puzzle';
    $('hint-gateways').disabled = g.gatewaysShown;
    $('hint-compass').disabled = g.compassNodes.size > 0;
    $('hint-plasticity').disabled = g.plasticityNodes.size > 0;
    $('hint-plasticity').querySelector('small').textContent = g.plasticityNodes.size > 0
      ? `Already used up for ${spent}.`
      : 'Grow three extra links: the next three most related words.';
    $('hint-compass').querySelector('small').textContent = g.compassNodes.size > 0
      ? `Already used up for ${spent}.`
      : 'Light up the options that sit on a shortest route from here.';
    openDialog('dlg-hint');
  };
  $('btn-map').onclick = openMap;
  $('btn-giveup').onclick = () => {
    const endless = state.mode === 'endless';
    $('giveup-title').textContent = endless ? 'End this run?' : 'Reveal the shortest path?';
    $('giveup-msg').textContent = endless ? `You've chained ${state.run.links}. Ending now locks that in.` : "This ends the puzzle and won't count as a win.";
    $('giveup-yes').textContent = endless ? 'End run' : 'Reveal it';
    openDialog('dlg-giveup');
  };
  $('btn-results').onclick = () => (state.mode === 'endless' ? openEndlessOver() : finish({ show: true }));

  $('mode-daily').onclick = () => state.mode !== 'daily' && backToDaily();
  $('mode-endless').onclick = () => state.mode !== 'endless' && enterEndless();
  $('btn-to-endless').onclick = enterEndless;
  $('ei-go').onclick = () => $('dlg-endless-intro').close();
  $('btn-reroll').onclick = rerollEndless;
  $('reroll-no').onclick = () => $('dlg-reroll').close();
  $('reroll-yes').onclick = () => { $('dlg-reroll').close(); confirmReroll(); };
  $('eo-again').onclick = newEndlessRun;
  $('eo-daily').onclick = backToDaily;
  $('eo-share-btn').onclick = async () => {
    const r = await shareOrCopy($('eo-share').textContent);
    if (r === 'copied') toast('Copied to clipboard');
    else if (r === 'failed') toast("Couldn't copy. Select the text instead.");
  };

  $('help-go').onclick = () => {
    $('dlg-help').close();
  };
  $('dlg-help').addEventListener('close', () => {
    if (!state.settings.seenHelp) saveSettings({ seenHelp: true });
  });

  $('hint-gateways').onclick = () => { $('dlg-hint').close(); useGateways(); };
  $('hint-compass').onclick = () => { $('dlg-hint').close(); useCompass(); };
  $('hint-plasticity').onclick = () => { $('dlg-hint').close(); usePlasticity(); };
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
      if (d.id === 'dlg-map' || d.id === 'dlg-result' || d.id === 'dlg-endless-over') state.map?.stop();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    const g = state.game;
    if (/^[1-8]$/.test(e.key) && !frozen()) {
      const id = g.options[Number(e.key) - 1];
      const el = state.stage.optionEl(id);
      if (el && !el.classList.contains('locked')) pick(id);
    } else if (e.key === 'Backspace' || e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'u') {
      e.preventDefault();
      undo();
    } else if (e.key.toLowerCase() === 'h' && !frozen()) {
      $('btn-hint').click();
    } else if (e.key.toLowerCase() === 'm' && !frozen()) {
      openMap();
    } else if (e.key === '?') {
      openDialog('dlg-help');
    }
  });

  // a finished puzzle opened from a saved game: offer results right away
  if (state.game.over) setTimeout(() => finish({ show: true }), 500);
}
