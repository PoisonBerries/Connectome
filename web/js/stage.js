// The playfield: the current word in the middle, its five most related words wired around it.
// Each word is a real <button>, so it works with keyboard, screen readers and touch alike.

const SVG_NS = 'http://www.w3.org/2000/svg';
const ANGLES = [-90, -18, 54, 126, 198].map((d) => (d * Math.PI) / 180); // pentagon, first option on top
const LINE_WIDTH = [3.2, 2.8, 2.4, 2.0, 1.7, 1.6, 1.5, 1.4]; // stronger link = thicker synapse

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Stage {
  /**
   * @param {{root: HTMLElement, svg: SVGElement, layer: HTMLElement, burst: HTMLCanvasElement, onPick: (id:number)=>void}} o
   */
  constructor({ root, svg, layer, burst, onPick }) {
    Object.assign(this, { root, svg, layer, burstCanvas: burst, onPick });
    this.nodes = new Map(); // node id -> element
    this.view = null;
    this.timers = new Set();
    svg.innerHTML = `<defs><linearGradient id="synGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="var(--cur)" stop-opacity=".85"/><stop offset="1" stop-color="var(--opt)" stop-opacity=".55"/></linearGradient></defs>
      <g class="lines"></g>`;
    this.lines = svg.querySelector('.lines');
    new ResizeObserver(() => this.view && this.render(this.view, { animate: false })).observe(root);
  }

  /** Place the ring for a new view. `from` tells us where new words should sprout from. */
  render(view, { animate = true, from = null } = {}) {
    const first = !this.view;
    this.view = view;
    const W = this.root.clientWidth;
    const H = this.root.clientHeight;
    if (!W || !H) return;
    animate = animate && !first;

    const geo = this.geometry(W, H, view.options.length);
    this.root.classList.toggle('dense', view.options.length > 5); // eight bubbles need slightly smaller type
    const wanted = new Map();
    wanted.set(view.current, { role: 'current', x: geo.cx, y: geo.cy });
    view.options.forEach((id, i) => wanted.set(id, { role: 'option', rank: i, x: geo.pts[i].x, y: geo.pts[i].y }));

    // words that are no longer on screen fade out (and are reused if they come straight back)
    for (const [id, el] of this.nodes) {
      if (wanted.has(id)) continue;
      el.classList.add('leaving');
      el.style.transform = `translate(${geo.cx - el.offsetWidth / 2}px, ${geo.cy - el.offsetHeight / 2}px) scale(.25)`;
      const t = setTimeout(() => {
        if (this.nodes.get(id) === el && el.classList.contains('leaving')) {
          el.remove();
          this.nodes.delete(id);
        }
        this.timers.delete(t);
      }, 480);
      this.timers.add(t);
    }

    const origin = from ?? { x: geo.cx, y: geo.cy };
    for (const [id, spec] of wanted) {
      let el = this.nodes.get(id);
      const fresh = !el || el.classList.contains('leaving');
      if (!el) {
        el = this.makeNode(id);
        this.nodes.set(id, el);
      }
      el.classList.remove('leaving');
      this.decorate(el, id, spec, view);

      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const scale = spec.role === 'current' ? 1.38 : 1;
      let x = spec.x;
      // keep whole bubbles on screen without letting the ring collapse
      const half = (w * scale) / 2 + 6;
      x = clamp(x, half, W - half);
      const y = clamp(spec.y, (h * scale) / 2 + 4, H - (h * scale) / 2 - 4);
      spec.px = x;
      spec.py = y;

      if (fresh && animate) {
        el.style.transition = 'none';
        el.style.opacity = '0';
        el.style.transform = `translate(${origin.x - w / 2}px, ${origin.y - h / 2}px) scale(.25)`;
        void el.offsetWidth; // commit the starting frame
        el.style.transition = '';
      } else if (fresh) {
        el.style.transition = 'none';
      }
      el.style.opacity = '1';
      el.style.transform = `translate(${x - w / 2}px, ${y - h / 2}px) scale(${scale})`;
      if (fresh && !animate) requestAnimationFrame(() => (el.style.transition = ''));
    }

    // brief lock so a fast double-tap doesn't hop twice through a half-moved ring
    if (animate) this.lock(430);
    this.drawLines(wanted, view, geo, animate);
  }

  geometry(W, H, n = 5) {
    const cx = W / 2;
    const cy = H / 2;
    if (n <= 5) {
      const rx = clamp(W * 0.36, 96, 250);
      const ry = clamp(H * 0.355, 108, 215);
      const pts = ANGLES.map((a) => ({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry }));
      return { cx, cy, pts };
    }
    // the octopus's eight arms: an even ring on a tall ellipse, rotated so no bubble sits on the far left/right edge
    const rx = clamp(W * 0.375, 96, 260);
    const ry = clamp(H * 0.425, 108, 230);
    const pts = Array.from({ length: n }, (_, i) => {
      const a = ((-90 + 180 / n + (360 / n) * i) * Math.PI) / 180;
      return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
    });
    return { cx, cy, pts };
  }

  makeNode(id) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'node';
    el.dataset.id = id;
    el.addEventListener('click', () => {
      if (el.classList.contains('option') && !el.classList.contains('locked')) this.onPick(id, el);
    });
    this.layer.appendChild(el);
    return el;
  }

  decorate(el, id, spec, view) {
    const word = view.words[id];
    el.className = 'node';
    el.classList.add(spec.role);
    if (word.length > 10) el.classList.add('long');
    if (id === view.target) el.classList.add('is-target');
    if (spec.role === 'option' && view.extras && view.extras.has(id)) el.classList.add('extra');
    if (spec.role === 'option') {
      if (view.visited.has(id)) el.classList.add('visited');
      if (view.compass && view.compass.has(id)) el.classList.add('hint');
    }
    const label = spec.role === 'current' ? word : `${spec.rank + 1}`;
    el.replaceChildren(document.createTextNode(word));
    if (spec.role === 'option') {
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = label;
      k.setAttribute('aria-hidden', 'true');
      el.appendChild(k);
      const bits = [word, `option ${spec.rank + 1}`];
      if (view.extras && view.extras.has(id)) bits.push('octopus arm');
      if (id === view.target) bits.push('the target');
      else if (view.visited.has(id)) bits.push('already visited');
      el.setAttribute('aria-label', bits.join(', '));
      el.tabIndex = 0;
      el.disabled = false;
    } else {
      el.setAttribute('aria-label', `Current word: ${word}`);
      el.tabIndex = -1;
    }
  }

  drawLines(wanted, view, geo, animate) {
    this.lines.replaceChildren();
    const cur = wanted.get(view.current);
    const delay = animate ? 0.3 : 0;
    view.options.forEach((id, i) => {
      const spec = wanted.get(id);
      const x0 = cur.px ?? geo.cx;
      const y0 = cur.py ?? geo.cy;
      const x1 = spec.px;
      const y1 = spec.py;
      // gentle organic bend
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const nx = -(y1 - y0);
      const ny = x1 - x0;
      const len = Math.hypot(nx, ny) || 1;
      const bend = (i % 2 ? 1 : -1) * 14;
      const d = `M${x0},${y0} Q${mx + (nx / len) * bend},${my + (ny / len) * bend} ${x1},${y1}`;

      const base = document.createElementNS(SVG_NS, 'path');
      base.setAttribute('d', d);
      base.setAttribute('class', 'syn base' + (id === view.target ? ' hot' : '') + (view.extras && view.extras.has(id) ? ' extra' : ''));
      base.setAttribute('stroke-width', LINE_WIDTH[i]);
      base.setAttribute('stroke-opacity', 1 - i * 0.09);
      if (animate) {
        const L = Math.hypot(x1 - x0, y1 - y0) * 1.15;
        base.style.setProperty('--len', L);
        base.setAttribute('stroke-dasharray', L);
        base.style.animationDelay = `${delay + i * 0.045}s`;
        base.classList.add('draw');
        base.style.opacity = '0';
        base.style.animationFillMode = 'both';
        setTimeout(() => (base.style.opacity = ''), (delay + i * 0.045) * 1000);
      }
      this.lines.appendChild(base);

      const flow = document.createElementNS(SVG_NS, 'path');
      flow.setAttribute('d', d);
      flow.setAttribute('class', 'syn flow');
      flow.setAttribute('stroke-width', LINE_WIDTH[i] + 0.6);
      flow.style.animationDelay = `${(i * 0.9 + Math.random()) % 2.8}s`;
      flow.style.animationDuration = `${2.4 + i * 0.35}s`;
      this.lines.appendChild(flow);
    });
  }

  lock(ms) {
    for (const el of this.nodes.values()) el.classList.add('locked');
    const t = setTimeout(() => {
      for (const el of this.nodes.values()) el.classList.remove('locked');
      this.timers.delete(t);
    }, ms);
    this.timers.add(t);
  }

  optionEl(id) {
    return this.nodes.get(id);
  }

  shake(id) {
    const el = this.nodes.get(id);
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  /** Position of a node in stage coordinates (for particle bursts). */
  centerOf(id) {
    const el = this.nodes.get(id);
    if (!el) return { x: this.root.clientWidth / 2, y: this.root.clientHeight / 2 };
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return { x: m.e + el.offsetWidth / 2, y: m.f + el.offsetHeight / 2 };
  }

  /** Fireworks made of synapses: sparks fly out and thread back together. */
  burst(x, y, colors = ['#6cf1ff', '#a99bff', '#ff5fa2', '#7dffb5', '#ffd166']) {
    const cv = this.burstCanvas;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = this.root.clientWidth * dpr;
    cv.height = this.root.clientHeight * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const parts = Array.from({ length: 70 }, (_, i) => {
      const a = (i / 70) * Math.PI * 2 + Math.random() * 0.4;
      const s = 1.5 + Math.random() * 5.5;
      return { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: 1.6 + Math.random() * 2.6, c: colors[i % colors.length], life: 1 };
    });
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(40, now - last) / 16.7;
      last = now;
      ctx.clearRect(0, 0, cv.width, cv.height);
      let alive = 0;
      for (const p of parts) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.965;
        p.vy = p.vy * 0.965 + 0.05 * dt;
        p.life -= 0.012 * dt;
        if (p.life <= 0) continue;
        alive++;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.c;
        ctx.shadowColor = p.c;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (alive) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, cv.width, cv.height);
    };
    requestAnimationFrame(tick);
  }
}
