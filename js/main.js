import { loadData } from './data.js';
import { createMap } from './map.js';
import { createPanel } from './panel.js';

try {
  const DATA = await loadData();
  const map = createMap(document.getElementById('map'), DATA);
  createPanel(DATA, map);
} catch (err) {
  console.error(err);
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = 'Could not load the map data. If you opened the file directly, run a local server (python3 -m http.server) instead.';
  document.querySelector('.panel header').after(p);
}
