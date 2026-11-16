import { loadData } from './data.js';
import { createMap } from './map.js';
import { createPanel } from './panel.js';
import { createCompare } from './compare.js';
import { createGuide } from './guide.js';
import { createSweet } from './sweet.js';

try {
  const DATA = await loadData();
  let guide;
  const map = createMap(document.getElementById('map'), DATA, { onGuide: (area, id) => guide.open(area, id) });
  guide = createGuide(DATA, { onShow: (area, it) => map.showHighlight(area, it) });
  const panel = createPanel(DATA, map, { openGuide: id => guide.open(id) });
  // Any "data-guide" button (filter box, map popups) opens that area's guide.
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-guide]');
    if (b && !b.classList.contains('guide-btn')) guide.open(b.dataset.guide, b.dataset.item);
  });
  createCompare(DATA, { onPick: id => panel.pickArea(id) });
  createSweet(DATA, map, { onPickArea: id => panel.pickArea(id) });
} catch (err) {
  console.error(err);
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = 'Could not load the map data. If you opened the file directly, run a local server (python3 -m http.server) instead.';
  document.querySelector('.panel header').after(p);
}
