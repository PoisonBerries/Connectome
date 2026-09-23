import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, todayNumber, dateOfPuzzle } from '../web/js/data.js';
import { Game } from '../web/js/game.js';
import { tierIndex } from '../web/js/store.js';

const g = JSON.parse(readFileSync(new URL('../web/data/graph.json', import.meta.url)));
const p = JSON.parse(readFileSync(new URL('../web/data/puzzles.json', import.meta.url)));
const w = new World(g, p);

/**
 * Walks `entity` (a Game or EndlessRun) toward `target` by always hopping to whichever currently-available
 * option is closest to it by base-graph distance. Deliberately does NOT replay a precomputed shortestPath()
 * route step-by-step: a target override can legitimately evict the exact next step that route expects (it
 * evicts a word's weakest links, which the shortest path sometimes has to use), and can occasionally offer a
 * genuine shortcut shorter than the base graph's own min - both are intended behavior, not bugs, so a test
 * that assumes "the base shortest path is always exactly replayable and score always equals min" is the
 * fragile part, not the game.
 */
function walkToward(entity, target, maxSteps = 40) {
  const d = w.distTo(target);
  const current = () => entity.current ?? entity.game.current;
  const options = () => entity.options ?? entity.game.options;
  let guard = 0;
  while (current() !== target && guard++ < maxSteps) {
    const opts = options();
    const next = opts.reduce((best, o) => (d[o] < d[best] ? o : best), opts[0]);
    entity.hop(next);
  }
}

// every node has 5 distinct, non-self links
for (let i = 0; i < w.N; i++) {
  const n = w.neighbors(i);
  assert.equal(new Set(n).size, 5, `dup links at ${w.words[i]}`);
  assert(!n.includes(i));
}
// every node can reach every other target sampled (strong connectivity spot check)
const d0 = w.distTo(w.index.get('Paris') ?? 0);
assert(d0.every((x) => x >= 0), 'graph not strongly connected to Paris');

// all puzzles: min matches the shipped value, and stays within the intended range
let bad = 0;
const minCounts = {};
for (let n = 1; n <= w.puzzles.length; n++) {
  const pz = w.puzzleFor(n);
  const shipped = w.puzzles[n - 1];
  if (pz.min !== shipped.min) bad++;
  minCounts[pz.min] = (minCounts[pz.min] || 0) + 1;
}
assert.equal(bad, 0, 'shipped min differs from BFS min');
console.log('min distribution', minCounts);

// the calendar never pairs two words of the same theme (no Paris -> Austria)
{
  let same = 0;
  for (const [s, t2] of w.puzzles.map((p) => [w.index.get(p.start), w.index.get(p.target)])) {
    const a = w.themeOf(s), b = w.themeOf(t2);
    if (a && b && a === b) same++;
  }
  assert(same <= 0, `${same} calendar puzzles pair two words of the same theme`);
}

// play puzzle 1, always taking whichever available option is closest to the target
const pz = w.puzzleFor(1);
const game = new Game(w, pz);
assert.equal(w.shortestPath(pz.start, pz.target).length - 1, pz.min);
walkToward(game, pz.target);
assert.equal(game.status, 'won');
assert(game.score <= pz.min, 'greedy play never needs more hops than the base graph\'s true shortest route');
assert.equal(tierIndex(game.score, pz.min), 0);
assert.deepEqual(game.hopTrend(), Array(game.score).fill(1), 'every greedy hop gets strictly closer');

// undo is free but hops stay counted, and only once per puzzle; hints add penalty
const g2 = new Game(w, pz);
const first = g2.options[0];
g2.hop(first); g2.undo();
assert.equal(g2.moves, 1); assert.equal(g2.path.length, 1);
assert(!g2.canUndo(), 'undo is single-use per puzzle');
assert(!g2.undo(), 'a second undo is refused, even with more path to undo');
g2.compass(); g2.showGateways();
assert.equal(g2.score, 1 + 3 + 5); // compass=3, gateway=5
assert(g2.hop(w.neighbors(g2.current).find((n) => !g2.visited.has(n))));

// save / restore round trip
const g3 = new Game(w, pz, JSON.parse(JSON.stringify(g2.serialize())));
assert.deepEqual(g3.path, g2.path); assert.equal(g3.score, g2.score);

// give up reveals a valid optimal route from where you stand
const g4 = new Game(w, pz); g4.giveUp();
assert.equal(g4.revealed.length - 1, pz.min);

// tier thresholds (min 6): perfect<=6, prodigy<=9, synaptic<=15, neural<=21, wanderer<=30, tangled beyond
const tiers = [6, 7, 9, 10, 15, 16, 21, 22, 30, 31].map((sc) => tierIndex(sc, 6));
assert.deepEqual(tiers, [0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
assert.equal(tierIndex(8, 5), 1); assert.equal(tierIndex(12, 8), 1); assert.equal(tierIndex(13, 8), 2);

// compass: single-use per puzzle/round (not per word), stays lit if you come back to the word it was used on
{
  const gc = new Game(w, w.puzzleFor(2));
  const startWord = gc.current;
  assert(gc.compass(), 'first use works');
  assert(!gc.compass(), 'second use on the same word is refused');
  assert.equal(gc.compassUses, 1);
  assert.equal(gc.penalty, 3, 'charged once');
  assert(gc.compassOptions().length >= 1);
  gc.hop(gc.options[0]);
  assert(!gc.hasCompass(), 'a new word has no compass lit');
  assert(!gc.compass(), 'compass is already spent this puzzle, even on a new word');
  assert.equal(gc.penalty, 3, 'no extra charge for the refused reuse');
  assert(gc.canUndo(), 'stepping back is a separate, still-unused charge');
  gc.undo();
  assert.equal(gc.current, startWord);
  assert(gc.hasCompass(), 'coming back to the paid-for word keeps its compass lit');
  assert(!gc.canUndo(), 'stepping back was single-use and is now spent');
  const back = new Game(w, w.puzzleFor(2), JSON.parse(JSON.stringify(gc.serialize())));
  assert(back.hasCompass(startWord) && back.penalty === 3 && !back.canUndo(), 'compass and spent undo survive save/restore');
}

// ---- target overrides: words whose real top-5 just missed a target get it spliced into their options
{
  let found = null;
  outer: for (const [target, byWord] of w.overrides) {
    for (const [word, extra] of byWord) {
      if (extra.includes(target)) { found = { target, word, extra }; break outer; } // a direct-to-target case
    }
  }
  assert(found, 'the shipped graph has at least one direct-to-target override to test against');
  const { target, word, extra } = found;
  const baseNeighbors = w.neighbors(word);
  assert(extra.every((x) => !baseNeighbors.includes(x)), 'override links are not already among the real 5');

  const g = new Game(w, { num: 999, start: word, target, min: w.distTo(target)[word], startLabel: '', targetLabel: '' });
  assert(g.options.includes(target), `${w.words[word]}'s options include the target ${w.words[target]} it was overridden to reach`);
  assert.equal(g.options.length, 5, 'the override replaces weak links rather than growing the option count');
  assert(extra.every((x) => g.options.includes(x)), 'every override link for this word is present');
  assert(w.gateways(target).includes(word), "a word overridden to reach the target directly also shows up in the target's Gateways hint");

  const otherTarget = w.pool.find((t) => t !== target && t !== word && !w.overridesAt(word, t).length);
  if (otherTarget !== undefined) {
    const g2 = new Game(w, { num: 998, start: word, target: otherTarget, min: w.distTo(otherTarget)[word], startLabel: '', targetLabel: '' });
    assert.deepEqual(g2.options, baseNeighbors, "a puzzle whose target has no override for this word shows the word's real neighbors");
  }
  console.log('target override checks passed');
}

console.log('date of #1:', dateOfPuzzle(w, 1).toDateString(), '| today is #', todayNumber(w));
console.log('all game logic checks passed');

// ---- endless mode
{
  const { EndlessRun, minForRound, BASE_BUDGET, BUDGET_STEP, FLOOR_BUFFER } = await import('../web/js/endless.js');
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9, 10, 20].map(minForRound), [4, 4, 5, 5, 6, 6, 8, 8, 8]);

  // deterministic RNG so the test is reproducible
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const run = new EndlessRun(w, { rand });
  let prevTarget = null;
  let carryExpected = 0; // playing every round optimally, so leftover = budget - min each time
  let sawCarry = false;
  for (let r = 1; r <= 12; r++) {
    const pz = run.game.puzzle;
    if (prevTarget !== null) assert.equal(pz.start, prevTarget, 'target becomes next start');
    assert(pz.min >= 3 && pz.min <= 9, 'min in range');
    assert.notEqual(w.themeOf(pz.start), w.themeOf(pz.target), `round ${r}: start and target share a theme`);
    const baseExpected = Math.max(BASE_BUDGET - BUDGET_STEP * (r - 1), pz.min + FLOOR_BUFFER);
    assert.equal(run.baseBudget, baseExpected, `round ${r}: base budget shrinks by ${BUDGET_STEP}/round, floored at min+${FLOOR_BUFFER}`);
    assert.equal(run.carry, carryExpected, `round ${r}: carry matches previous round's leftover`);
    assert.equal(run.budget, baseExpected + carryExpected, `round ${r}: budget is base + carry`);
    assert.equal(run.left, run.budget);

    walkToward(run, pz.target);
    assert(run.game.status === 'won' && !run.over, `round ${r} should be won`);
    carryExpected = baseExpected + carryExpected - run.game.score; // unspent moves roll into the next round
    if (carryExpected > 0) sawCarry = true;
    prevTarget = pz.target;
    assert(run.advance());
  }
  assert.equal(run.links, 12);
  assert(sawCarry, 'at least one round should have left unspent moves to carry over');

  // a round finished with moves to spare hands them straight to the next round's budget
  {
    const c = new EndlessRun(w, { rand });
    assert.equal(c.carry, 0, 'round 1 starts with no carry');
    walkToward(c, c.game.puzzle.target);
    const leftover = c.left;
    assert(leftover > 0, 'an optimal solve leaves moves unspent');
    assert(c.advance());
    assert.equal(c.carry, leftover, 'the exact leftover carries into round 2');
    assert.equal(c.budget, c.baseBudget + leftover, "round 2's budget includes the carryover");
  }

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
  assert(h.canAfford(3));
  assert(h.game.compass(), 'first compass works');
  assert(!h.game.compass(), 'a second compass this round does nothing, even on a new word');
  const spent = h.left;
  assert.equal(spent, h.budget - 3, 'and costs nothing extra');
  assert(!h.canAfford(spent), 'a hint may not consume the final move');

  // single-use hints and undo reset every round, since each round gets a fresh Game
  {
    const e = new EndlessRun(w, { rand });
    e.hop(e.game.options[0]);
    assert(e.game.canUndo(), 'undo usable in round 1');
    e.game.undo();
    assert(!e.game.canUndo(), 'undo spent for the rest of round 1');
    assert(e.game.compass(), 'compass usable in round 1');
    assert(!e.game.compass(), 'compass spent for the rest of round 1');

    walkToward(e, e.game.puzzle.target);
    assert(e.advance(), 'round 1 won, round 2 begins');

    e.hop(e.game.options[0]);
    assert(e.game.canUndo(), 'undo is usable again in round 2');
    assert(e.game.compass(), 'compass is usable again in round 2');
    console.log('single-use hint/undo round-reset checks passed');
  }

  // target overrides need no endless-specific code: every round is an ordinary Game sharing the same World,
  // so whatever override applies to a rolled target's start word shows up in that round's options too
  {
    let checked = false;
    for (let n = 0; n < 200 && !checked; n++) {
      const e = new EndlessRun(w, { rand });
      assert(e.game instanceof Game, 'endless rounds use the same Game class as daily');
      const ov = w.overridesAt(e.game.current, e.game.puzzle.target);
      if (ov.length) {
        assert(ov.every((x) => e.game.options.includes(x)), "the rolled round's start word shows its override exactly like daily would");
        checked = true;
      }
    }
    assert(checked, 'at least one of 200 rolled endless rounds should exercise a real override');
    console.log('endless target-override checks passed');
  }

  // save / restore, including mid-celebration
  const a = new EndlessRun(w, { rand });
  walkToward(a, a.game.puzzle.target);
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

// ---- plasticity hint: 3 extra links, single-use per puzzle/round, saved/restored, folded into score and the discovered/map sets
{
  const gc = new Game(w, w.puzzleFor(3));
  const startWord = gc.current;
  assert.equal(gc.options.length, 5, 'starts with 5 options');
  const extrasBefore = w.extras(gc.current);
  if (extrasBefore.length) {
    assert(gc.plasticity(), 'first use works');
    assert.equal(gc.options.length, 5 + extrasBefore.length, 'extra arms become options');
    assert(!gc.plasticity(), 'a second use on the same word does nothing');
    assert.equal(gc.penalty, 1, 'charged once');
    assert.deepEqual(new Set(gc.extraOptions), new Set(extrasBefore));
    assert(gc.discovered().size >= gc.visited.size + extrasBefore.length);

    const other = gc.options.find((o) => !gc.world.neighbors(startWord).includes(o));
    assert(other !== undefined, 'an extra arm is actually reachable');
    assert(gc.hop(other));
    assert(!gc.hasPlasticity(), 'the new word has no arms grown yet');
    assert.equal(gc.options.length, 5, 'the new word starts with just its 5 links');
    assert(!gc.plasticity(), 'plasticity is already spent this puzzle, even on a new word');

    assert(gc.canUndo(), 'stepping back is a separate, still-unused charge');
    gc.undo();
    assert.equal(gc.current, startWord);
    assert(gc.hasPlasticity(), 'coming back keeps the arms out');
    assert.equal(gc.options.length, 5 + extrasBefore.length, 'still 8 options, for free');
    assert.equal(gc.penalty, 1, 'no extra charge for revisiting');
    assert(!gc.canUndo(), 'stepping back was single-use and is now spent');

    const back = new Game(w, w.puzzleFor(3), JSON.parse(JSON.stringify(gc.serialize())));
    assert(back.hasPlasticity(startWord) && back.options.length === 5 + extrasBefore.length && !back.canUndo(), 'arms and spent undo survive save/restore');
  }
  // a word with no extras (rare, but the API must not lie about it)
  let noExtra = null;
  for (let i = 0; i < w.N; i++) if (w.extras(i).length === 0) { noExtra = i; break; }
  if (noExtra !== null) {
    const gg = new Game(w, { num: 1, start: noExtra, target: w.puzzleFor(1).target });
    assert(!gg.plasticity(), "plasticity refuses when there's nothing to add");
    assert.equal(gg.penalty, 0);
  }
  console.log('plasticity hint checks passed');
}
