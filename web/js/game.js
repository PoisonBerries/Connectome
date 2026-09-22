// Game state machine. No DOM in here, so it can be reasoned about (and tested) on its own.

export const GATEWAY_COST = 1;
export const COMPASS_COST = 2;
export const PLASTICITY_COST = 2;

export class Game {
  constructor(world, puzzle, saved = null) {
    this.world = world;
    this.puzzle = puzzle;
    this.dist = world.distTo(puzzle.target);

    this.path = [puzzle.start]; // the active chain, start .. current
    this.hops = []; // every forward move ever made: {from, to, before, after}  (dead ends included)
    this.visited = new Set([puzzle.start]);
    this.gatewaysShown = false;
    this.compassUses = 0; // paid uses
    this.plasticityNodes = new Set(); // words that have grown their three extra arms (once per word)
    this.compassNodes = new Set(); // words the compass has been used on (it is only ever bought once per word)
    this.status = 'playing'; // playing | won | gaveup
    this.revealed = null; // optimal path shown after giving up

    if (saved && saved.puzzle === puzzle.num) this._restore(saved);
  }

  get current() {
    return this.path[this.path.length - 1];
  }
  get options() {
    return this.optionsAt(this.current);
  }
  /** Where you can hop from a word: its five links, plus three more once plasticity has grown them. */
  optionsAt(node) {
    const base = this.world.neighbors(node);
    return this.plasticityNodes.has(node) ? [...base, ...this.world.extras(node)] : base;
  }
  /** The three extra options plasticity has grown on the current word (empty until it is used). */
  get extraOptions() {
    return this.plasticityNodes.has(this.current) ? this.world.extras(this.current) : [];
  }
  get moves() {
    return this.hops.length;
  }
  get penalty() {
    return (this.gatewaysShown ? GATEWAY_COST : 0) + this.compassUses * COMPASS_COST + this.plasticityNodes.size * PLASTICITY_COST;
  }
  get score() {
    return this.moves + this.penalty;
  }
  get over() {
    return this.status !== 'playing';
  }
  get hintsUsed() {
    return (this.gatewaysShown ? 1 : 0) + this.compassUses + this.plasticityNodes.size;
  }
  /** Distance from the current word to the target along the best route. */
  get remaining() {
    return this.dist[this.current];
  }

  /** Everything the player has seen so far: visited words and every option offered from them. */
  discovered() {
    const seen = new Set(this.visited);
    for (const v of this.visited) for (const n of this.optionsAt(v)) seen.add(n);
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

  hasPlasticity(node = this.current) {
    return this.plasticityNodes.has(node);
  }

  /** Grow three extra links: the next three most related words become hop options. Once per word. */
  plasticity() {
    if (this.over || this.hasPlasticity() || this.world.extras(this.current).length === 0) return false;
    this.plasticityNodes.add(this.current);
    return true;
  }

  /** Has the compass already been used on this word? Using it again would show the same options for nothing. */
  hasCompass(node = this.current) {
    return this.compassNodes.has(node);
  }

  /** Options from the current word that lie on a shortest route to the target. */
  compassOptions() {
    const d = this.dist;
    return this.options.filter((n) => d[n] === d[this.current] - 1);
  }

  /** Light up the best next hops. Costs a penalty once per word; returns false if it was already used here. */
  compass() {
    if (this.over || this.hasCompass()) return false;
    this.compassUses += 1;
    this.compassNodes.add(this.current);
    return true;
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

  /**
   * Saves store *words*, not node ids, so rebuilding or expanding the word graph never corrupts a saved game.
   * (Ids are only meaningful within one build of graph.json.)
   */
  serialize() {
    const w = this.world.words;
    const words = (ids) => ids.map((i) => w[i]);
    return {
      v: 2,
      puzzle: this.puzzle.num,
      path: words(this.path),
      hops: this.hops.map((h) => [w[h.from], w[h.to]]),
      visited: words([...this.visited]),
      gateways: this.gatewaysShown,
      compass: this.compassUses,
      compassAt: words([...this.compassNodes]),
      plasticityAt: words([...this.plasticityNodes]),
      status: this.status,
      revealed: this.revealed ? words(this.revealed) : null,
    };
  }

  _restore(s) {
    if (!s || s.v !== 2 || !Array.isArray(s.path) || !Array.isArray(s.hops)) return;
    const idx = this.world.index;
    const ids = (arr) => (Array.isArray(arr) ? arr.map((x) => idx.get(x)) : null);
    const path = ids(s.path);
    if (!path || path.some((x) => x === undefined) || path[0] !== this.puzzle.start) return;
    this.plasticityNodes = new Set((ids(s.plasticityAt) || []).filter((x) => x !== undefined));

    // keep the longest prefix of the saved path that is still a valid chain in this build of the graph
    let keep = 1;
    while (keep < path.length && this.optionsAt(path[keep - 1]).includes(path[keep])) keep++;
    this.path = path.slice(0, keep);

    const d = this.dist;
    this.hops = s.hops
      .map(([f, t]) => [idx.get(f), idx.get(t)])
      .filter(([f, t]) => f !== undefined && t !== undefined && this.optionsAt(f).includes(t))
      .map(([f, t]) => ({ from: f, to: t, before: d[f], after: d[t] }));
    const visited = (ids(s.visited) || []).filter((x) => x !== undefined);
    this.visited = new Set([...visited, ...this.path]);
    this.gatewaysShown = !!s.gateways;
    this.compassUses = s.compass | 0;
    this.compassNodes = new Set((ids(s.compassAt) || []).filter((x) => x !== undefined));
    const revealed = ids(s.revealed);
    this.revealed = revealed && revealed.every((x) => x !== undefined) ? revealed : null;
    this.status = ['playing', 'won', 'gaveup'].includes(s.status) ? s.status : 'playing';
    // a "won" save whose route no longer reaches the target in this graph is no longer a win
    if (this.status === 'won' && this.path[this.path.length - 1] !== this.puzzle.target) this.status = 'playing';
  }
}
