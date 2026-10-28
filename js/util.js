// Small shared helpers: DOM, formatting, geometry, sports.

export const $ = (sel, root = document) => root.querySelector(sel);

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const isDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

export const tick = () => new Promise((r) => setTimeout(r));

export const finite = Number.isFinite;

// ---------- geometry ----------

export function haversine(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 12_742_017.6 * Math.asin(Math.sqrt(a));
}

// ---------- sports ----------
// Colour follows the sport *family* (fixed slot per family), never its rank,
// so filtering never repaints a sport.

export function sportFamily(type = '') {
  const t = String(type).toLowerCase();
  if (/run/.test(t)) return 'run';
  if (/ride|bike|cycl|velomobile|handcycle/.test(t)) return 'ride';
  if (/hike|mountaineer/.test(t)) return 'hike';
  if (/walk/.test(t)) return 'walk';
  if (/swim/.test(t)) return 'swim';
  if (/row|kayak|canoe|paddl|surf|sail|kite/.test(t)) return 'water';
  if (/ski|snow|skat/.test(t)) return 'winter';
  return 'other';
}

export const sportColor = (sport) => cssVar('--sport-' + sportFamily(sport));

export const usesPace = (sport) => ['run', 'walk', 'hike'].includes(sportFamily(sport));

// ---------- formatting ----------

const pad = (n) => String(n).padStart(2, '0');

export function fmtKm(m, digits = 1) {
  if (!finite(m)) return '–';
  return (m / 1000).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) + ' km';
}

export function fmtDuration(s) {
  if (!finite(s) || s <= 0) return '–';
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export function fmtHours(s) {
  if (!finite(s)) return '–';
  const h = s / 3600;
  return (h < 10 ? h.toFixed(1) : Math.round(h).toLocaleString()) + ' h';
}

export function fmtPace(secPerUnit) {
  if (!finite(secPerUnit) || secPerUnit <= 0) return '–';
  const s = Math.round(secPerUnit);
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

export function fmtSpeed(mps, sport) {
  if (!finite(mps) || mps <= 0) return '–';
  if (sportFamily(sport) === 'swim') return fmtPace(100 / mps) + ' /100m';
  if (usesPace(sport)) return fmtPace(1000 / mps) + ' /km';
  return (mps * 3.6).toFixed(1) + ' km/h';
}

export const fmtInt = (v, unit = '') => (finite(v) ? Math.round(v).toLocaleString() + unit : '–');

export const fmtDate = (ms) =>
  finite(ms) ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '–';

export const fmtDateTime = (ms) =>
  finite(ms)
    ? new Date(ms).toLocaleString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '–';

export function maxBy(items, fn) {
  let best = null, bestV = -Infinity;
  for (const it of items) {
    const v = fn(it);
    if (finite(v) && v > bestV) { best = it; bestV = v; }
  }
  return best;
}
