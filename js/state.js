// Shared state. Filters and shop toggles are remembered per browser; the selected area is not.

export const MAX_PUPILS = 1800;
export const state = { phase: 'all', faith: 'all', max: MAX_PUPILS, cat: true, area: null };
export const poiOn = { up: true, bake: true, cult: false, gym: false, disc: false };

try { const s = JSON.parse(localStorage.getItem('lsm-state') || 'null'); if (s) Object.assign(state, s, { area: null }); } catch (e) {}
try { const s = JSON.parse(localStorage.getItem('lsm-poi') || 'null'); if (s) Object.assign(poiOn, s); } catch (e) {}

export function saveState() {
  try { localStorage.setItem('lsm-state', JSON.stringify({ phase: state.phase, faith: state.faith, max: state.max, cat: state.cat })); } catch (e) {}
}
export function savePoi() {
  try { localStorage.setItem('lsm-poi', JSON.stringify(poiOn)); } catch (e) {}
}

export function isVisible(s) {
  if (state.phase !== 'all' && s.p !== state.phase && s.p !== 'A') return false;
  if (state.faith !== 'all' && s.f !== state.faith) return false;
  if (state.max < MAX_PUPILS && s.pu > state.max) return false; // slider at its top = no limit
  if (state.area && s.a !== state.area) return false;
  return true;
}
