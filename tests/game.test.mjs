import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, todayNumber, dateOfPuzzle } from '../web/js/data.js';
import { Game } from '../web/js/game.js';
import { tierIndex } from '../web/js/store.js';

const g = JSON.parse(readFileSync(new URL('../web/data/graph.json', import.meta.url)));
const p = JSON.parse(readFileSync(new URL('../web/data/puzzles.json', import.meta.url)));
const w = new World(g, p);

// every node has 5 distinct, non-self links
for (let i = 0; i < w.N; i++) {
  const n = w.neighbors(i);
  assert.equal(new Set(n).size, 5, `dup links at ${w.words[i]}`);
  assert(!n.includes(i));
}
// every node can reach every other target sampled (strong connectivity spot check)
const d0 = w.distTo(w.index.get('Paris') ?? 0);
assert(d0.every((x) => x >= 0), 'graph not strongly connected to Paris');

// all puzzles: par matches the shipped value, and stays within the intended range
let bad = 0;
const parCounts = {};
for (let n = 1; n <= w.puzzles.length; n++) {
  const pz = w.puzzleFor(n);
  const shipped = w.puzzles[n - 1];
  if (pz.par !== shipped.par) bad++;
  parCounts[pz.par] = (parCounts[pz.par] || 0) + 1;
}
assert.equal(bad, 0, 'shipped par differs from BFS par');
console.log('par distribution', parCounts);

// the calendar never pairs two words of the same theme (no Paris -> Austria)
{
  let same = 0;
  for (const [s, t2] of w.puzzles.map((p) => [w.index.get(p.start), w.index.get(p.target)])) {
    const a = w.themeOf(s), b = w.themeOf(t2);
    if (a && b && a === b) same++;
  }
  assert(same <= 0, `${same} calendar puzzles pair two words of the same theme`);
}

// play puzzle 1 optimally
const pz = w.puzzleFor(1);
const game = new Game(w, pz);
const route = w.shortestPath(pz.start, pz.target);
assert.equal(route.length - 1, pz.par);
for (const step of route.slice(1)) assert(game.hop(step));
assert.equal(game.status, 'won');
assert.equal(game.score, pz.par);
assert.equal(tierIndex(game.score, pz.par), 0);
assert.deepEqual(game.hopTrend(), Array(pz.par).fill(1));

// undo is free but hops stay counted; hints add penalty
const g2 = new Game(w, pz);
const first = g2.options[0];
g2.hop(first); g2.undo();
assert.equal(g2.moves, 1); assert.equal(g2.path.length, 1);
g2.compass(); g2.showGateways();
assert.equal(g2.score, 1 + 2 + 1);
assert(g2.hop(w.neighbors(g2.current).find((n) => !g2.visited.has(n))));

// save / restore round trip
const g3 = new Game(w, pz, JSON.parse(JSON.stringify(g2.serialize())));
assert.deepEqual(g3.path, g2.path); assert.equal(g3.score, g2.score);

// give up reveals a valid optimal route from where you stand
const g4 = new Game(w, pz); g4.giveUp();
assert.equal(g4.revealed.length - 1, pz.par);

// tier thresholds (par 6): perfect<=6, prodigy<=9, synaptic<=15, neural<=21, wanderer<=30, tangled beyond
const tiers = [6, 7, 9, 10, 15, 16, 21, 22, 30, 31].map((sc) => tierIndex(sc, 6));
assert.deepEqual(tiers, [0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
assert.equal(tierIndex(8, 5), 1); assert.equal(tierIndex(12, 8), 1); assert.equal(tierIndex(13, 8), 2);

console.log('date of #1:', dateOfPuzzle(w, 1).toDateString(), '| today is #', todayNumber(w));
console.log('all game logic checks passed');

// ---- endless mode
{
  const { EndlessRun, parForRound, BUDGET_MULT } = await import('../web/js/endless.js');
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9, 10, 20].map(parForRound), [4, 4, 5, 5, 6, 6, 8, 8, 8]);

  // deterministic RNG so the test is reproducible
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const run = new EndlessRun(w, { rand });
  let prevTarget = null;
  for (let r = 1; r <= 12; r++) {
    const pz = run.game.puzzle;
    if (prevTarget !== null) assert.equal(pz.start, prevTarget, 'target becomes next start');
    assert(pz.par >= 3 && pz.par <= 9, 'par in range');
    assert.notEqual(w.themeOf(pz.start), w.themeOf(pz.target), `round ${r}: start and target share a theme`);
    assert.equal(run.budget, BUDGET_MULT * pz.par);
    assert.equal(run.left, run.budget);
    const route = w.shortestPath(pz.start, pz.target);
    let res;
    for (const step of route.slice(1)) res = run.hop(step);
    assert(res.won && !run.over, `round ${r} should be won`);
    prevTarget = pz.target;
    assert(run.advance());
  }
  assert.equal(run.links, 12);

  // variety: over many rolls, no same-theme pairs and places don't dominate
  const counts = {};
  let sameTheme = 0;
  for (let n = 0; n < 300; n++) {
    const r = new EndlessRun(w, { rand });
    const th = w.themeOf(r.game.puzzle.target);
    counts[th] = (counts[th] || 0) + 1;
    if (w.themeOf(r.game.puzzle.start) === th) sameTheme++;
  }
  assert.equal(sameTheme, 0, 'no same-theme start/target');
  assert(counts.place / 300 < 0.2, `places should be under 20% of targets, got ${counts.place}`);
  assert(Object.keys(counts).length >= 8, 'themes are varied');

  // targets are steerable: nearly every rolled target clears the approachability floor
  const { MIN_APPROACH } = await import('../web/js/endless.js');
  let hard = 0;
  for (let n = 0; n < 300; n++) {
    const r = new EndlessRun(w, { rand });
    if (w.approachOf(r.game.puzzle.target) < MIN_APPROACH) hard++;
  }
  assert(hard <= 6, `too many hard-to-reach targets rolled: ${hard}/300`);
  console.log('hard-to-reach targets rolled:', hard, '/ 300');
  console.log('target theme mix over 300 runs:', counts);
  assert.equal(new Set(run.chain).size, run.chain.length, 'no word repeats in a chain');

  // run out of moves: wander until the budget is gone
  const lost = new EndlessRun(w, { rand });
  const budget = lost.budget;
  let result = null;
  for (let i = 0; i < budget + 5 && !lost.over; i++) {
    const opts = lost.game.options;
    const bad = opts.find((o) => lost.game.dist[o] >= lost.game.dist[lost.game.current] && o !== lost.game.puzzle.target) ?? opts[0];
    result = lost.hop(bad);
    if (!lost.over && lost.game.status === 'won') break;
    if (!lost.over) lost.game.undo(); // walking back is free; only forward hops burn moves
  }
  assert(lost.over && lost.reason === 'out' && result.lost, 'runs end when moves run out');
  assert.equal(lost.hop(lost.game.options[0]), null, 'no moves after the run ends');

  // hints spend moves and can't take the last one
  const h = new EndlessRun(w, { rand });
  assert(h.canAfford(2));
  h.game.compass(); h.game.compass();
  const spent = h.left;
  assert.equal(spent, h.budget - 4);
  assert(!h.canAfford(spent), 'a hint may not consume the final move');

  // save / restore, including mid-celebration
  const a = new EndlessRun(w, { rand });
  const route = w.shortestPath(a.game.puzzle.start, a.game.puzzle.target);
  for (const step of route.slice(1)) a.hop(step);
  const b = new EndlessRun(w, { saved: JSON.parse(JSON.stringify(a.serialize())) });
  assert.equal(b.round, 2, 'restoring a just-won round moves on to the next');
  assert.equal(b.game.puzzle.start, a.game.puzzle.target);
  assert.equal(b.links, 1);
  console.log('endless mode checks passed');
}

// ---- saves survive a rebuilt graph (node ids reshuffled, words unchanged)
{
  const N = g.w.length;
  const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => ((a * 7919) % 10007) - ((b * 7919) % 10007)); // deterministic shuffle
  const newId = new Array(N);
  order.forEach((old, ni) => (newId[old] = ni));
  const g2 = {
    w: order.map((old) => g.w[old]),
    k: order.map((old) => g.k[old]),
    n: order.flatMap((old) => g.n.slice(old * 5, old * 5 + 5).map((x) => newId[x])),
    e: g.e.map((x) => newId[x]),
  };
  const w2 = new World(g2, p);
  assert.notEqual(w2.index.get('Paris'), w.index.get('Paris'), 'ids really did change');

  const pzA = w.puzzleFor(3);
  const gameA = new Game(w, pzA);
  gameA.hop(gameA.options[0]); gameA.hop(gameA.options[1]);
  gameA.compass();
  const saved = JSON.parse(JSON.stringify(gameA.serialize()));

  const gameB = new Game(w2, w2.puzzleFor(3), saved);
  const names = (world, game) => game.path.map((i) => world.words[i]);
  assert.deepEqual(names(w2, gameB), names(w, gameA), 'path restored by words');
  assert.equal(gameB.score, gameA.score, 'score restored');

  const { EndlessRun } = await import('../web/js/endless.js');
  const run = new EndlessRun(w, { rand: () => 0.42 });
  run.hop(run.game.options[0]);
  const run2 = new EndlessRun(w2, { saved: JSON.parse(JSON.stringify(run.serialize())) });
  assert.equal(w2.words[run2.game.puzzle.target], w.words[run.game.puzzle.target]);
  assert.equal(run2.left, run.left, 'endless run restored');

  // old id-based saves (v1) are ignored rather than misread
  const legacy = new Game(w2, w2.puzzleFor(3), { puzzle: 3, path: [1, 2, 3], hops: [], status: 'won' });
  assert.equal(legacy.path.length, 1);
  console.log('saves survive graph rebuilds');
}
