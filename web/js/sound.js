// Synapse blips via WebAudio. Off by default; pitch climbs as you close in on the target.

let ctx = null;
let enabled = false;

const PENTATONIC = [0, 2, 4, 7, 9];

function ensure() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, { type = 'sine', gain = 0.07, glide = 0 } = {}) {
  const c = ensure();
  if (!c) return;
  const t = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glide) osc.frequency.exponentialRampToValueAtTime(freq * glide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

const note = (step, base = 262) => base * Math.pow(2, (PENTATONIC[step % 5] + 12 * Math.floor(step / 5)) / 12);

export const sound = {
  set enabled(v) {
    enabled = !!v;
    if (enabled) ensure();
  },
  get enabled() {
    return enabled;
  },

  /** progress 0..1 is how far along the shortest route you are; trend -1 farther, 0 sideways, 1 closer. */
  hop(progress = 0, trend = 0) {
    if (!enabled) return;
    const step = Math.round(progress * 9);
    tone(note(step), 0, 0.22, { type: 'sine', gain: 0.09 });
    tone(note(step) * 2, 0.02, 0.14, { type: 'triangle', gain: 0.025 });
    if (trend < 0) tone(note(step) * 0.5, 0.05, 0.25, { type: 'sine', gain: 0.03 });
  },
  back() {
    if (!enabled) return;
    tone(330, 0, 0.16, { type: 'sine', gain: 0.05, glide: 0.7 });
  },
  hint() {
    if (!enabled) return;
    tone(note(6), 0, 0.12, { gain: 0.05 });
    tone(note(8), 0.09, 0.2, { gain: 0.05 });
  },
  win() {
    if (!enabled) return;
    [0, 2, 4, 6, 7, 9].forEach((s, i) => tone(note(s), i * 0.085, 0.42, { type: 'triangle', gain: 0.08 }));
    tone(note(12), 0.55, 0.9, { type: 'sine', gain: 0.07 });
  },
  lose() {
    if (!enabled) return;
    tone(220, 0, 0.5, { type: 'sine', gain: 0.06, glide: 0.6 });
  },
};

export function haptic(ms = 8) {
  try {
    navigator.vibrate && navigator.vibrate(ms);
  } catch {
    /* not supported */
  }
}
