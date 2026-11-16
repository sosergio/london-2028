// Shared state. Filters and shop toggles are remembered per browser; the selected area is not.

export const state = { phase: 'all', faith: 'all', of: { O: true, G: true, W: true, N: true }, cat: true, area: null };
export const poiOn = { up: true, bake: true, cult: false, gym: false, disc: false };

try {
  const s = JSON.parse(localStorage.getItem('lsm-state') || 'null');
  if (s) { state.phase = s.phase ?? state.phase; state.faith = s.faith ?? state.faith; state.cat = s.cat ?? state.cat; Object.assign(state.of, s.of); }
} catch (e) {}
try { const s = JSON.parse(localStorage.getItem('lsm-poi') || 'null'); if (s) Object.assign(poiOn, s); } catch (e) {}

export function saveState() {
  try { localStorage.setItem('lsm-state', JSON.stringify({ phase: state.phase, faith: state.faith, of: state.of, cat: state.cat })); } catch (e) {}
}
export function savePoi() {
  try { localStorage.setItem('lsm-poi', JSON.stringify(poiOn)); } catch (e) {}
}

export function isVisible(s) {
  if (state.phase !== 'all' && s.p !== state.phase && s.p !== 'A') return false;
  if (state.faith !== 'all' && s.f !== state.faith) return false;
  if (!state.of[s.ok]) return false;
  if (state.area && s.a !== state.area) return false;
  return true;
}
