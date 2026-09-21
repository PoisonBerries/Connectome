// Drifting neurons behind the game: slow, quiet, and occasionally a signal fires along a connection.

export class Ambient {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.nodes = [];
    this.pulses = [];
    this.animate = true;
    this.raf = 0;
    this.last = 0;
    this.colors = { line: '150,160,255', dot: '190,180,255', pulse: '108,241,255' };
    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
    this.resize();
    this.readTheme();
  }

  readTheme() {
    const light = document.documentElement.dataset.theme === 'light';
    this.colors = light
      ? { line: '90,80,190', dot: '90,73,214', pulse: '7,148,184', alpha: 0.5 }
      : { line: '150,160,255', dot: '190,180,255', pulse: '108,241,255', alpha: 1 };
    if (!this.raf) this.draw();
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = innerWidth;
    this.h = innerHeight;
    this.c.width = this.w * dpr;
    this.c.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.max(16, Math.min(58, Math.round((this.w * this.h) / 26000)));
    this.nodes = Array.from({ length: count }, () => ({
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      vx: (Math.random() - 0.5) * 0.16,
      vy: (Math.random() - 0.5) * 0.16,
      r: 0.8 + Math.random() * 1.8,
    }));
    this.draw();
  }

  setAnimate(on) {
    this.animate = on;
    on ? this.start() : (this.stop(), this.draw());
  }

  start() {
    if (!this.animate || this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  frame(now) {
    const dt = Math.min(48, now - this.last) / 16.7;
    this.last = now;
    for (const n of this.nodes) {
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      if (n.x < -20) n.x = this.w + 20;
      if (n.x > this.w + 20) n.x = -20;
      if (n.y < -20) n.y = this.h + 20;
      if (n.y > this.h + 20) n.y = -20;
    }
    if (Math.random() < 0.02 && this.pulses.length < 4) this.spawnPulse();
    for (const p of this.pulses) p.t += 0.012 * dt;
    this.pulses = this.pulses.filter((p) => p.t < 1);
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  }

  spawnPulse() {
    const a = this.nodes[(Math.random() * this.nodes.length) | 0];
    const near = this.nodes.filter((b) => b !== a && Math.hypot(a.x - b.x, a.y - b.y) < 170);
    if (near.length) this.pulses.push({ a, b: near[(Math.random() * near.length) | 0], t: 0 });
  }

  draw() {
    const { ctx, nodes, colors: col } = this;
    const A = col.alpha ?? 1;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
        if (d < 150) {
          ctx.strokeStyle = `rgba(${col.line},${(1 - d / 150) * 0.16 * A})`;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }
    }
    for (const n of nodes) {
      ctx.fillStyle = `rgba(${col.dot},${0.35 * A})`;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, 6.283);
      ctx.fill();
    }
    for (const p of this.pulses) {
      const x = p.a.x + (p.b.x - p.a.x) * p.t;
      const y = p.a.y + (p.b.y - p.a.y) * p.t;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
      g.addColorStop(0, `rgba(${col.pulse},${0.9 * A})`);
      g.addColorStop(1, `rgba(${col.pulse},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, 6.283);
      ctx.fill();
    }
  }
}
