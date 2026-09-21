// Endless mode: chain links until you run out of moves.
//
// Each round hands you a start word and a random target. You get BUDGET_MULT x par moves to reach it.
// Reach it and the target becomes your next start word with a fresh target; run out and the run is over.
// Par climbs as the chain grows, so early links are a warm-up and later ones are proper puzzles.

import { Game } from './game.js';

export const BUDGET_MULT = 3;

/** Shortest-route length for a round: 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, ... */
export const parForRound = (round) => Math.min(8, 4 + Math.floor((round - 1) / 2));

export class EndlessRun {
  /**
   * @param {import('./data.js').World} world
   * @param {{rand?: () => number, saved?: object|null}} opts
   */
  constructor(world, { rand = Math.random, saved = null } = {}) {
    this.world = world;
    this.rand = rand;
    this.round = 1;
    this.links = 0; // rounds completed
    this.totalHops = 0; // moves spent on completed rounds (hint penalties included)
    this.chain = []; // start word, then every target reached
    this.used = new Set(); // words already used as a start or target this run
    this.over = false;
    this.reason = null; // 'out' | 'quit'
    this.game = null;

    if (saved && this._restore(saved)) return;
    const pool = world.pool;
    const start = pool[Math.floor(rand() * pool.length)];
    this.chain = [start];
    this.used.add(start);
    this._begin(start);
  }

  get par() {
    return this.game.puzzle.par;
  }
  get budget() {
    return BUDGET_MULT * this.par;
  }
  /** Moves remaining this round (hints spend moves too). */
  get left() {
    return this.budget - this.game.score;
  }
  /** A hint must leave at least one move to use it. */
  canAfford(cost) {
    return !this.over && this.left - cost >= 1;
  }

  hop(id) {
    if (this.over) return null;
    const rec = this.game.hop(id);
    if (!rec) return null;
    if (this.game.status === 'won') {
      this.links += 1;
      this.totalHops += this.game.score;
      this.chain.push(this.game.puzzle.target);
      return { rec, won: true };
    }
    if (this.left <= 0) {
      this.over = true;
      this.reason = 'out';
      return { rec, lost: true };
    }
    return { rec };
  }

  /** After a round is won: the target becomes the new start and a new target is rolled. */
  advance() {
    if (this.over || this.game.status !== 'won') return false;
    this.round += 1;
    this._begin(this.game.puzzle.target);
    return true;
  }

  quit() {
    if (this.over) return;
    this.over = true;
    this.reason = 'quit';
  }

  /** The target you were chasing when the run ended. */
  get missed() {
    return this.over ? this.game.puzzle.target : null;
  }

  _begin(start, savedGame = null, savedPuzzle = null) {
    const par = parForRound(this.round);
    const puzzle = savedPuzzle || this._roll(start, par);
    this.used.add(puzzle.target);
    this.game = new Game(this.world, puzzle, savedGame);
  }

  _roll(start, wantPar) {
    const w = this.world;
    const d = w.forwardDist(start);
    const fresh = w.pool.filter((t) => t !== start && !this.used.has(t) && d[t] > 0);
    // prefer the exact par; otherwise the nearest available distance
    const order = [0, -1, 1, -2, 2, -3, 3].map((k) => wantPar + k).filter((p) => p >= 3);
    let cands = [];
    for (const p of order) {
      cands = fresh.filter((t) => d[t] === p);
      if (cands.length) break;
    }
    if (!cands.length) cands = fresh.filter((t) => d[t] >= 3);
    const target = cands[Math.floor(this.rand() * cands.length)];
    return { num: `e${this.round}`, start, target, par: d[target], startLabel: '', targetLabel: '' };
  }

  serialize() {
    const p = this.game.puzzle;
    return {
      round: this.round, links: this.links, totalHops: this.totalHops, chain: this.chain, used: [...this.used],
      over: this.over, reason: this.reason,
      puzzle: { start: p.start, target: p.target, par: p.par },
      game: this.game.serialize(),
    };
  }

  _restore(s) {
    const n = this.world.N;
    const ok = (a) => Array.isArray(a) && a.every((x) => Number.isInteger(x) && x >= 0 && x < n);
    if (!s || !ok(s.chain) || !ok(s.used) || !s.puzzle || !ok([s.puzzle.start, s.puzzle.target])) return false;
    if (!Number.isInteger(s.round) || s.round < 1) return false;
    this.round = s.round;
    this.links = s.links | 0;
    this.totalHops = s.totalHops | 0;
    this.chain = s.chain;
    this.used = new Set(s.used);
    this.over = !!s.over;
    this.reason = s.reason || null;
    const puzzle = { num: `e${this.round}`, start: s.puzzle.start, target: s.puzzle.target, par: s.puzzle.par, startLabel: '', targetLabel: '' };
    this.game = new Game(this.world, puzzle, s.game);
    // saved mid-celebration: move on to the next round
    if (!this.over && this.game.status === 'won') this.advance();
    return true;
  }
}
