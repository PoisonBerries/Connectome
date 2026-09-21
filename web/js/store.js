// Tiny localStorage wrapper. Every call is guarded: storage can be missing or throw (private mode, blocked cookies).

const NS = 'connectome:v1:';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the game still works, it just won't remember */
  }
}

export const settings = {
  defaults: { theme: 'auto', sound: false, motion: true, seenHelp: false, seenEndless: false },
  load() {
    return { ...this.defaults, ...read('settings', {}) };
  },
  save(s) {
    write('settings', s);
  },
};

export const saves = {
  load(num) {
    return read('game:' + num, null);
  },
  save(num, data) {
    write('game:' + num, data);
  },
  /** { [puzzleNumber]: {status, score, tier} } for the archive grid */
  index() {
    return read('index', {});
  },
  mark(num, entry) {
    const idx = this.index();
    idx[num] = entry;
    write('index', idx);
  },
};

export const TIERS = [
  { id: 'perfect', name: 'Perfect wiring', emoji: '⚡', dots: 5 },
  { id: 'prodigy', name: 'Prodigy', emoji: '🧠', dots: 5 },
  { id: 'synaptic', name: 'Synaptic', emoji: '✨', dots: 4 },
  { id: 'neural', name: 'Neural', emoji: '🔗', dots: 3 },
  { id: 'wanderer', name: 'Wanderer', emoji: '🧭', dots: 2 },
  { id: 'tangled', name: 'Tangled', emoji: '🌀', dots: 1 },
];

/**
 * Rate a finished game by score (hops + hint penalties) against par.
 * Tuned so a typical player (roughly 2.5-3x par) lands mid-table rather than near the bottom.
 */
export function tierIndex(score, par) {
  if (score <= par) return 0;
  if (score <= Math.max(par + 3, par * 1.5)) return 1;
  if (score <= par * 2.5) return 2;
  if (score <= par * 3.5) return 3;
  if (score <= par * 5) return 4;
  return 5;
}

export const stats = {
  empty: () => ({ played: 0, wins: 0, streak: 0, maxStreak: 0, lastDaily: 0, dist: [0, 0, 0, 0, 0, 0] }),
  load() {
    return { ...this.empty(), ...read('stats', {}) };
  },
  save(s) {
    write('stats', s);
  },
  /**
   * Record a finished puzzle. Only today's puzzle moves the streak; archive plays count toward totals.
   */
  record(num, todayNum, won, tier) {
    const s = this.load();
    s.played += 1;
    if (won) {
      s.wins += 1;
      s.dist[tier] += 1;
    }
    if (num === todayNum) {
      if (won) {
        s.streak = s.lastDaily === num - 1 || s.lastDaily === num ? s.streak + 1 : 1;
        s.maxStreak = Math.max(s.maxStreak, s.streak);
        s.lastDaily = num;
      } else {
        s.streak = 0;
        s.lastDaily = num;
      }
    }
    this.save(s);
    return s;
  },
};

/** Endless mode: the in-progress run plus lifetime bests. */
export const endless = {
  emptyStats: () => ({ best: 0, bestHops: 0, runs: 0, links: 0 }),
  stats() {
    return { ...this.emptyStats(), ...read('endless:stats', {}) };
  },
  run() {
    return read('endless:run', null);
  },
  saveRun(run) {
    write('endless:run', run);
  },
  clearRun() {
    try {
      localStorage.removeItem(NS + 'endless:run');
    } catch {
      /* ignore */
    }
  },
  /** Record a finished run and return the updated stats (plus whether it set a new best). */
  record(links, hops) {
    const s = this.stats();
    const newBest = links > s.best;
    s.runs += 1;
    s.links += links;
    if (newBest) {
      s.best = links;
      s.bestHops = hops;
    }
    write('endless:stats', s);
    return { stats: s, newBest };
  },
};
