// Spoiler-free share text: the shape of your journey without the words you used.

import { TIERS } from './store.js';

const SQUARE = { 1: '🟩', 0: '🟨', '-1': '🟥' };

export function shareText(game, world, tier, url) {
  const p = game.puzzle;
  const t = TIERS[tier];
  const won = game.status === 'won';
  const trend = game.hopTrend().map((x) => SQUARE[x]);
  const rows = [];
  for (let i = 0; i < trend.length; i += 10) rows.push(trend.slice(i, i + 10).join(''));
  if (won && rows.length) rows[rows.length - 1] += '🎯';

  const head = `Connectome #${p.num} ${won ? t.emoji : '🌫️'}`;
  const route = `${world.words[p.start]} → ${world.words[p.target]}`;
  const meta = won
    ? `${game.score} hops · min ${p.min}${game.hintsUsed ? ` · 💡×${game.hintsUsed}` : ''}`
    : `Lost the signal after ${game.moves} hops · min ${p.min}`;
  return [head, route, meta, ...rows, url].filter(Boolean).join('\n');
}

export async function shareOrCopy(text) {
  const canShare = navigator.share && matchMedia('(pointer: coarse)').matches;
  if (canShare) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  return copyText(text) ? 'copied' : 'failed';
}

export function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
