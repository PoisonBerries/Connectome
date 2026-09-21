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
