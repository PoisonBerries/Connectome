// "Your connectome": every word you visited (and every option you were offered) laid out as a living network.

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Seeded PRNG so a given game always lays out the same way. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function layout(ids, edges, roles, seed) {
  const rand = rng(seed);
  const n = ids.length;
  const idx = new Map(ids.map((id, i) => [id, i]));
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  ids.forEach((_, i) => {
    const a = rand() * Math.PI * 2;
    const r = 40 + rand() * 120;
    px[i] = Math.cos(a) * r;
    py[i] = Math.sin(a) * r;
  });
  const links = edges.map(([a, b]) => [idx.get(a), idx.get(b), roles.get(a) === 'seen' || roles.get(b) === 'seen' ? 30 : 58]);
  const ITER = 320;
  for (let it = 0; it < ITER; it++) {
    const alpha = 1 - it / ITER;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = px[i] - px[j];
        let dy = py[i] - py[j];
        const d2 = dx * dx + dy * dy + 0.5;
        const f = (1500 * alpha) / d2;
        const d = Math.sqrt(d2);
        dx = (dx / d) * f;
        dy = (dy / d) * f;
        vx[i] += dx; vy[i] += dy; vx[j] -= dx; vy[j] -= dy;
      }
    }
    for (const [a, b, rest] of links) {
      const dx = px[b] - px[a];
      const dy = py[b] - py[a];
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - rest) * 0.045;
      vx[a] += (dx / d) * f; vy[a] += (dy / d) * f; vx[b] -= (dx / d) * f; vy[b] -= (dy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      vx[i] -= px[i] * 0.012;
      vy[i] -= py[i] * 0.012;
      px[i] += vx[i];
      py[i] += vy[i];
      vx[i] *= 0.82;
      vy[i] *= 0.82;
    }
  }
  return { px, py, idx };
}

/**
 * @returns {{stop: () => void}}
 */
export function drawConstellation(canvas, world, game, { animate = true } = {}) {
  const puzzle = game.puzzle;
  const path = game.path;
  const pathSet = new Set(path);
  const revealed = game.revealed || [];

  const ids = new Set([...game.visited, puzzle.target, ...revealed]);
  const edges = [];
  for (const v of game.visited) {
    for (const n of world.neighbors(v)) {
      ids.add(n);
      edges.push([v, n]);
    }
  }
  const list = [...ids];

  const roles = new Map();
  for (const id of list) {
    roles.set(id, 'seen');
    if (game.visited.has(id)) roles.set(id, 'dead');
    if (pathSet.has(id)) roles.set(id, 'path');
  }
  roles.set(puzzle.start, 'start');
  roles.set(puzzle.target, 'goal');

  const { px, py, idx } = layout(list, edges, roles, puzzle.num * 7919 + list.length);

  const colors = {
    start: cssVar('--start'), path: cssVar('--cur'), dead: cssVar('--opt'), seen: cssVar('--faint'),
    goal: cssVar('--tgt'), ink: cssVar('--ink'), bg: cssVar('--sheet-bg'), hint: cssVar('--warn'),
  };

  let raf = 0;
  let stopped = false;

  const paint = (t) => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch) return;
    if (canvas.width !== Math.round(cw * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    // fit
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < list.length; i++) {
      x0 = Math.min(x0, px[i]); x1 = Math.max(x1, px[i]);
      y0 = Math.min(y0, py[i]); y1 = Math.max(y1, py[i]);
    }
    const padX = 46, padY = 30;
    const s = Math.min((cw - padX * 2) / (x1 - x0 || 1), (ch - padY * 2) / (y1 - y0 || 1), 2.2);
    const ox = cw / 2 - ((x0 + x1) / 2) * s;
    const oy = ch / 2 - ((y0 + y1) / 2) * s;
    const X = (i) => px[i] * s + ox;
    const Y = (i) => py[i] * s + oy;

    // edges
    ctx.lineCap = 'round';
    for (const [a, b] of edges) {
      const i = idx.get(a), j = idx.get(b);
      ctx.strokeStyle = colors.seen;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(X(i), Y(i));
      ctx.lineTo(X(j), Y(j));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // optimal route (revealed after giving up)
    if (revealed.length > 1) {
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = colors.hint;
      ctx.lineWidth = 2;
      ctx.beginPath();
      revealed.forEach((id, k) => {
        const i = idx.get(id);
        k ? ctx.lineTo(X(i), Y(i)) : ctx.moveTo(X(i), Y(i));
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // the player's own path
    const pts = path.map((id) => [X(idx.get(id)), Y(idx.get(id))]);
    if (pts.length > 1) {
      ctx.strokeStyle = colors.path;
      ctx.lineWidth = 2.6;
      ctx.shadowColor = colors.path;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (animate) {
        // a signal travelling from start to target, over and over
        const segs = pts.length - 1;
        const u = ((t / 2600) % 1) * segs;
        const k = Math.min(segs - 1, Math.floor(u));
        const f = u - k;
        const px_ = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f;
        const py_ = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f;
        const g = ctx.createRadialGradient(px_, py_, 0, px_, py_, 14);
        g.addColorStop(0, '#fff');
        g.addColorStop(0.25, colors.path);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px_, py_, 14, 0, 6.283);
        ctx.fill();
      }
    }

    // nodes
    const radius = { seen: 2.6, dead: 4.6, path: 5.6, start: 7, goal: 8 };
    const order = ['seen', 'dead', 'path', 'start', 'goal'];
    for (const role of order) {
      for (let i = 0; i < list.length; i++) {
        if (roles.get(list[i]) !== role) continue;
        ctx.fillStyle = colors[role];
        if (role !== 'seen') {
          ctx.shadowColor = colors[role];
          ctx.shadowBlur = role === 'goal' ? 18 : 10;
        }
        ctx.beginPath();
        ctx.arc(X(i), Y(i), radius[role], 0, 6.283);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // labels (skip collisions; important words first)
    ctx.font = '600 11.5px Outfit, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const boxes = [];
    const words = world.words;
    const labelOrder = ['goal', 'start', 'path', 'dead'];
    for (const role of labelOrder) {
      for (let i = 0; i < list.length; i++) {
        if (roles.get(list[i]) !== role) continue;
        const text = words[list[i]];
        const w = ctx.measureText(text).width + 6;
        const x = X(i);
        const y = Y(i) - radius[role] - 9;
        const box = [x - w / 2, y - 8, x + w / 2, y + 8];
        if (box[0] < 2 || box[2] > cw - 2 || box[1] < 2) continue;
        if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        boxes.push(box);
        ctx.lineWidth = 4;
        ctx.strokeStyle = colors.bg;
        ctx.strokeText(text, x, y);
        ctx.fillStyle = role === 'goal' ? colors.goal : role === 'start' ? colors.start : role === 'path' ? colors.ink : colors.dead;
        ctx.fillText(text, x, y);
      }
    }
  };

  const loop = (t) => {
    if (stopped) return;
    paint(t);
    raf = requestAnimationFrame(loop);
  };
  if (animate) raf = requestAnimationFrame(loop);
  else requestAnimationFrame(() => paint(0));

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}
