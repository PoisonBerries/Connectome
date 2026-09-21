// Game state machine. No DOM in here, so it can be reasoned about (and tested) on its own.

export const GATEWAY_COST = 1;
export const COMPASS_COST = 2;

export class Game {
  constructor(world, puzzle, saved = null) {
    this.world = world;
    this.puzzle = puzzle;
    this.dist = world.distTo(puzzle.target);

    this.path = [puzzle.start]; // the active chain, start .. current
    this.hops = []; // every forward move ever made: {from, to, before, after}  (dead ends included)
    this.visited = new Set([puzzle.start]);
    this.gatewaysShown = false;
    this.compassUses = 0;
    this.status = 'playing'; // playing | won | gaveup
    this.revealed = null; // optimal path shown after giving up

    if (saved && saved.puzzle === puzzle.num) this._restore(saved);
  }

  get current() {
    return this.path[this.path.length - 1];
  }
  get options() {
    return this.world.neighbors(this.current);
  }
  get moves() {
    return this.hops.length;
  }
  get penalty() {
    return (this.gatewaysShown ? GATEWAY_COST : 0) + this.compassUses * COMPASS_COST;
  }
  get score() {
    return this.moves + this.penalty;
  }
  get over() {
    return this.status !== 'playing';
  }
  get hintsUsed() {
    return (this.gatewaysShown ? 1 : 0) + this.compassUses;
  }
  /** Distance from the current word to the target along the best route. */
  get remaining() {
    return this.dist[this.current];
  }

  /** Everything the player has seen so far: visited words and every option offered from them. */
  discovered() {
    const seen = new Set(this.visited);
    for (const v of this.visited) for (const n of this.world.neighbors(v)) seen.add(n);
    return seen;
  }

  hop(id) {
    if (this.over || !this.options.includes(id)) return null;
    const from = this.current;
    const rec = { from, to: id, before: this.dist[from], after: this.dist[id] };
    this.hops.push(rec);
    this.path.push(id);
    this.visited.add(id);
    if (id === this.puzzle.target) this.status = 'won';
    return rec;
  }

  canUndo() {
    return !this.over && this.path.length > 1;
  }

  /** Stepping back is free; the hop you spent still counts. */
  undo(steps = 1) {
    if (!this.canUndo()) return false;
    this.path.splice(Math.max(1, this.path.length - steps));
    return true;
  }

  jumpTo(pathIndex) {
    if (this.over || pathIndex < 0 || pathIndex >= this.path.length - 1) return false;
    this.path.splice(pathIndex + 1);
    return true;
  }

  showGateways() {
    if (this.over) return [];
    this.gatewaysShown = true;
    return this.world.gateways(this.puzzle.target);
  }

  /** Options that lie on a shortest route to the target. Costs a penalty each time it is used. */
  compass() {
    if (this.over) return [];
    this.compassUses += 1;
    const d = this.dist;
    return this.options.filter((n) => d[n] === d[this.current] - 1);
  }

  giveUp() {
    if (this.over) return;
    this.status = 'gaveup';
    this.revealed = this.world.shortestPath(this.current, this.puzzle.target);
  }

  /** Emoji-ready summary of each hop: 1 closer, 0 sideways, -1 farther. */
  hopTrend() {
    return this.hops.map((h) => Math.sign(h.before - h.after));
  }

  serialize() {
    return {
      puzzle: this.puzzle.num,
      path: this.path,
      hops: this.hops,
      visited: [...this.visited],
      gateways: this.gatewaysShown,
      compass: this.compassUses,
      status: this.status,
      revealed: this.revealed,
    };
  }

  _restore(s) {
    const n = this.world.N;
    const ok = (a) => Array.isArray(a) && a.every((x) => Number.isInteger(x) && x >= 0 && x < n);
    if (!ok(s.path) || s.path[0] !== this.puzzle.start || !Array.isArray(s.hops)) return;
    this.path = s.path;
    this.hops = s.hops.filter((h) => ok([h.from, h.to]));
    this.visited = new Set(ok(s.visited) ? s.visited : s.path);
    this.gatewaysShown = !!s.gateways;
    this.compassUses = s.compass | 0;
    this.status = ['playing', 'won', 'gaveup'].includes(s.status) ? s.status : 'playing';
    this.revealed = ok(s.revealed) ? s.revealed : null;
  }
}
