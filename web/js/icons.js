// Inline SVG icons (24x24, stroked). Elements with data-icon="name" get the icon prepended.

const p = (d) => `<path d="${d}"/>`;

const ICONS = {
  help: '<circle cx="12" cy="12" r="9.5"/>' + p('M9.2 9.3a2.9 2.9 0 0 1 5.6.9c0 1.9-2.8 2.4-2.8 4.1') + '<circle cx="12" cy="17.6" r=".6" fill="currentColor"/>',
  stats: p('M5 20V11M12 20V4M19 20v-6'),
  settings: '<circle cx="12" cy="12" r="3"/>' + p('M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7'),
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/>' + p('M3.5 10h17M8 3v4M16 3v4'),
  close: p('M6 6l12 12M18 6L6 18'),
  undo: p('M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11'),
  bulb: p('M9.5 18h5M10 21h4') + p('M12 3a6.2 6.2 0 0 0-3.6 11.2c.7.6 1.1 1.3 1.1 2.1V17h5v-.7c0-.8.4-1.5 1.1-2.1A6.2 6.2 0 0 0 12 3z'),
  nodes: '<circle cx="6" cy="7" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="12" cy="18" r="2.4"/>' + p('M8 8.2l3 7.6M16.2 7.8L13 15.8M8.4 6.7l7.2-.5'),
  flag: p('M6 21V4M6 5h11l-2 4 2 4H6'),
  share: p('M12 15V3.5M7.5 8L12 3.5 16.5 8M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5'),
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/>' + p('M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5'),
  'chevron-left': p('M14.5 6l-6 6 6 6'),
  'chevron-right': p('M9.5 6l6 6-6 6'),
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  compass: '<circle cx="12" cy="12" r="9"/>' + p('M15.8 8.2l-2 5.6-5.6 2 2-5.6z'),
  octopus: p('M6.5 12a5.5 5.5 0 0 1 11 0v1.4M6.5 12v1.4M6.5 13.4c0 2.6-2.5 2.6-2.5 5.4M9.5 14c0 2.8-1 3.4-1 5.7M12 14.2V20M14.5 14c0 2.8 1 3.4 1 5.7M17.5 13.4c0 2.6 2.5 2.6 2.5 5.4') + '<circle cx="10" cy="10.3" r=".7" fill="currentColor"/><circle cx="14" cy="10.3" r=".7" fill="currentColor"/>',
  check: p('M5 12.5l4.5 4.5L19 7.5'),
};

export function icon(name, size = 22) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.iconDone) return;
    el.dataset.iconDone = '1';
    const size = el.classList.contains('icon-btn') ? 22 : el.classList.contains('hi') ? 26 : 18;
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, size));
  });
}
