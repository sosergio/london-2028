import { loadData } from './data.js';
import { createMap } from './map.js';
import { createPanel } from './panel.js';
import { createCompare } from './compare.js';
import { createGuide } from './guide.js';
import { createSweet } from './sweet.js';
import { createHood } from './hood.js';

let panelOpen = true, setPanel = () => {};
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
  // Picking an area elsewhere (compare table, sweet spots) shows its card, so it opens a folded panel.
  const pick = id => { if (!panelOpen) { panelOpen = true; setPanel(true); } panel.pickArea(id); };
  createCompare(DATA, { onPick: pick });
  createSweet(DATA, map, { onPickArea: pick });
  createHood(map);
  // The side panel (areas and school list) folds away to give the map the full width; remembered.
  const app = document.querySelector('.app'), toggle = document.getElementById('panel-toggle');
  setPanel = open => {
    app.classList.toggle('collapsed', !open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? '›' : '‹';
    toggle.title = open ? 'Hide the side panel' : 'Show the side panel (areas and schools)';
    map.resize();
  };
  try { panelOpen = localStorage.getItem('lsm-panel') !== 'closed'; } catch (e) {}
  setPanel(panelOpen);
  toggle.addEventListener('click', () => {
    panelOpen = !panelOpen; setPanel(panelOpen);
    try { localStorage.setItem('lsm-panel', panelOpen ? 'open' : 'closed'); } catch (e) {}
  });
} catch (err) {
  console.error(err);
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = 'Could not load the map data. If you opened the file directly, run a local server (python3 -m http.server) instead.';
  document.querySelector('.panel header').after(p);
}
