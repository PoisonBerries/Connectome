// Graph + puzzle data. Every node has exactly 5 out-links (its five most related words).

const K = 5;

export async function loadData() {
  const [g, p] = await Promise.all([
    fetch('data/graph.json').then((r) => r.json()),
    fetch('data/puzzles.json').then((r) => r.json()),
  ]);
  return new World(g, p);
}

export class World {
  constructor(g, p) {
    this.words = g.w;
    this.kinds = g.k; // 0 word, 1 proper noun, 2 phrase
    this.out = Int32Array.from(g.n);
    this.N = this.words.length;
    this.index = new Map(this.words.map((w, i) => [w, i]));
    this.epoch = p.epoch;
    this.puzzles = p.puzzles.map(([s, t, par, sl, tl]) => ({ start: s, target: t, par, startLabel: sl, targetLabel: tl }));

    // reverse adjacency (who links *to* a node)
    const inn = Array.from({ length: this.N }, () => []);
    for (let i = 0; i < this.N; i++) for (let j = 0; j < K; j++) inn[this.out[i * K + j]].push(i);
    this.inn = inn;
    this._dist = new Map();
  }

  neighbors(i) {
    const o = this.out;
    return [o[i * K], o[i * K + 1], o[i * K + 2], o[i * K + 3], o[i * K + 4]];
  }

  /** Directed distance from every node to `target` (Int16Array, -1 = unreachable). Cached. */
  distTo(target) {
    let d = this._dist.get(target);
    if (d) return d;
    d = new Int16Array(this.N).fill(-1);
    d[target] = 0;
    const q = [target];
    for (let h = 0; h < q.length; h++) {
      const u = q[h];
      for (const v of this.inn[u]) {
        if (d[v] < 0) {
          d[v] = d[u] + 1;
          q.push(v);
        }
      }
    }
    this._dist.set(target, d);
    return d;
  }

  /** One shortest path start -> target. */
  shortestPath(start, target) {
    const d = this.distTo(target);
    const path = [start];
    let cur = start;
    while (cur !== target) {
      const next = this.neighbors(cur).find((n) => d[n] === d[cur] - 1);
      if (next === undefined) return null;
      path.push(next);
      cur = next;
    }
    return path;
  }

  /** Nodes that link directly to `target`. */
  gateways(target) {
    return this.inn[target].filter((n) => n !== target);
  }

  puzzleFor(num) {
    // num is 1-based and loops if the calendar ever runs out
    const n = this.puzzles.length;
    const p = this.puzzles[(((num - 1) % n) + n) % n];
    const start = this.index.get(p.start);
    const target = this.index.get(p.target);
    if (start === undefined || target === undefined) throw new Error(`Puzzle ${num} references unknown words`);
    return { num, start, target, par: this.distTo(target)[start], startLabel: p.startLabel, targetLabel: p.targetLabel };
  }
}

// ---- calendar helpers (puzzles roll over at the player's local midnight, like Wordle)

const DAY = 86400000;
const utcDay = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());

export function todayNumber(world, now = new Date()) {
  const [y, m, d] = world.epoch.split('-').map(Number);
  return Math.floor((utcDay(now) - Date.UTC(y, m - 1, d)) / DAY) + 1;
}

export function dateOfPuzzle(world, num) {
  const [y, m, d] = world.epoch.split('-').map(Number);
  return new Date(y, m - 1, d + num - 1);
}

export function msUntilNextPuzzle(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next - now;
}
