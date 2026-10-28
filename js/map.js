// Leaflet maps: the overview (heatmap / speed / gradient / routes) and the
// single-activity route map in the detail view.
//
// Drawing strategy: segments sharing a colour bucket are merged into ONE
// multi-polyline per bucket, so even a million GPS points render as a dozen
// canvas layers instead of hundreds of thousands of map objects.

import { cssVar, isDark, sportColor, sportFamily, esc, fmtDate, fmtKm, finite } from './util.js';

const MAX_GAP_M = 300;         // don't join points across GPS dropouts / paused recording
const HEAT_GRID = 0.0005;      // ~50 m cells used to match passages between activities
const N_HEAT = 12, N_SPEED = 10, N_SLOPE = 8;
const SLOPE_WINDOW_M = 50;     // gradient measured over this distance
const SLOPE_MAX_PCT = 15;

// ---------- tiles (all free, no API key) ----------

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
const ESRI_ATTR = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors';

function baseLayers() {
  return {
    Dark: L.tileLayer(ESRI + 'World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 16, maxZoom: 19, attribution: ESRI_ATTR }),
    Light: L.tileLayer(ESRI + 'World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 16, maxZoom: 19, attribution: ESRI_ATTR }),
    Streets: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }),
  };
}

// ---------- colour ramps ----------

const ramps = () => isDark()
  ? {
      heat: [[0, '#4a1e06'], [0.2, '#7a2e00'], [0.4, '#bf4400'], [0.6, '#e05c00'], [0.8, '#ff7a1a'], [1, '#ffd1a3']],
      speed: [[0, '#184f95'], [0.35, '#2a78d6'], [0.7, '#6da7ec'], [1, '#cde2fb']],
      up: [[0, '#6b6a64'], [0.25, '#c8a000'], [0.55, '#e05c00'], [1, '#e34948']],
      down: [[0, '#6b6a64'], [0.25, '#20b5c4'], [0.55, '#3987e5'], [1, '#9085e9']],
      none: '#4a4a46',
    }
  : {
      heat: [[0, '#f6c9a8'], [0.25, '#f0915a'], [0.5, '#e05c00'], [0.75, '#b83a00'], [1, '#6e1a00']],
      speed: [[0, '#b7d3f6'], [0.35, '#5598e7'], [0.7, '#256abf'], [1, '#0d366b']],
      up: [[0, '#b5b3ab'], [0.25, '#d9a400'], [0.55, '#e05c00'], [1, '#b8191a']],
      down: [[0, '#b5b3ab'], [0.25, '#1a9bab'], [0.55, '#2a78d6'], [1, '#4a3aa7']],
      none: '#c3c2b7',
    };

function interp(ramp, t) {
  t = Math.min(1, Math.max(0, t));
  for (let i = 0; i < ramp.length - 1; i++) {
    const [t0, c0] = ramp[i], [t1, c1] = ramp[i + 1];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      const a = [1, 3, 5].map((k) => parseInt(c0.slice(k, k + 2), 16));
      const b = [1, 3, 5].map((k) => parseInt(c1.slice(k, k + 2), 16));
      return '#' + a.map((v, k) => Math.round(v + f * (b[k] - v)).toString(16).padStart(2, '0')).join('');
    }
  }
  return ramp[ramp.length - 1][1];
}

const gradientCss = (ramp) => `linear-gradient(90deg, ${ramp.map(([t, c]) => `${c} ${t * 100}%`).join(', ')})`;

// ---------- geometry helpers ----------

function splitGaps(track) {
  const { lat, lon, d } = track;
  const out = [];
  let cur = [[lat[0], lon[0]]];
  for (let i = 1; i < lat.length; i++) {
    if (d[i] - d[i - 1] > MAX_GAP_M) { if (cur.length > 1) out.push(cur); cur = []; }
    cur.push([lat[i], lon[i]]);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

// Groups consecutive segments with the same key into runs; keyOf(j) is the
// key of the segment j -> j+1 (null = don't draw).
function collectRuns(runs, track, keyOf) {
  const { lat, lon, d } = track;
  let run = null, runKey = null;
  const flush = () => {
    if (run) { if (!runs.has(runKey)) runs.set(runKey, []); runs.get(runKey).push(run); }
    run = null;
  };
  for (let j = 0; j < lat.length - 1; j++) {
    const k = d[j + 1] - d[j] > MAX_GAP_M ? null : keyOf(j);
    if (k === null) { flush(); continue; }
    if (run && k === runKey) run.push([lat[j + 1], lon[j + 1]]);
    else { flush(); run = [[lat[j], lon[j]], [lat[j + 1], lon[j + 1]]]; runKey = k; }
  }
  flush();
}

// One numeric key per segment: (cell A, offset to cell B), direction-independent,
// so the same street ridden both ways counts as the same passage.
function segmentKeys(track) {
  const { lat, lon } = track;
  const keys = new Float64Array(Math.max(lat.length - 1, 0));
  let cy0 = Math.round(lat[0] / HEAT_GRID), cx0 = Math.round(lon[0] / HEAT_GRID);
  for (let j = 0; j < keys.length; j++) {
    const cy1 = Math.round(lat[j + 1] / HEAT_GRID), cx1 = Math.round(lon[j + 1] / HEAT_GRID);
    let ay = cy0, ax = cx0, by = cy1, bx = cx1;
    if (by < ay || (by === ay && bx < ax)) [ay, ax, by, bx] = [by, bx, ay, ax];
    const dy = by - ay, dx = bx - ax;
    keys[j] = dy > 7 || Math.abs(dx) > 7 ? NaN : ((ay + 200000) * 800000 + (ax + 400000)) * 256 + dy * 16 + (dx + 8);
    cy0 = cy1; cx0 = cx1;
  }
  return keys;
}

function segmentGradients(track) {
  const { d, ele } = track;
  const n = d.length;
  const g = new Float32Array(Math.max(n - 1, 0)).fill(NaN);
  if (!ele || n < 2) return g;
  const at = () => {
    let k = 0;
    return (x) => {
      while (k < n - 2 && d[k + 1] < x) k++;
      const span = d[k + 1] - d[k];
      const f = span > 0 ? Math.min(1, Math.max(0, (x - d[k]) / span)) : 0;
      return ele[k] + (ele[k + 1] - ele[k]) * f;
    };
  };
  const atLo = at(), atHi = at();
  const h = SLOPE_WINDOW_M / 2;
  for (let j = 0; j < n - 1; j++) {
    const mid = (d[j] + d[j + 1]) / 2;
    const lo = Math.max(mid - h, d[0]), hi = Math.min(mid + h, d[n - 1]);
    if (hi - lo < h) continue;
    g[j] = ((atHi(hi) - atLo(lo)) / (hi - lo)) * 100;
  }
  return g;
}

// Centre of the ~10 km cell with the most points: the map opens where you
// usually are, not zoomed out over every trip you've ever made.
function densestArea(acts) {
  const counts = new Map();
  for (const a of acts) {
    const { lat, lon } = a.track;
    for (let i = 0; i < lat.length; i += 5) {
      const k = Math.floor(lat[i] * 10) + ':' + Math.floor(lon[i] * 10);
      const c = counts.get(k) || { n: 0, lat: 0, lon: 0 };
      c.n++; c.lat += lat[i]; c.lon += lon[i];
      counts.set(k, c);
    }
  }
  let best = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return [best.lat / best.n, best.lon / best.n];
}

// ---------- overview map ----------

export class OverviewMap {
  constructor(el, { onSelect }) {
    this.onSelect = onSelect;
    this.map = L.map(el, { preferCanvas: true, scrollWheelZoom: false });
    this.renderer = L.canvas({ padding: 0.3, tolerance: 6 });
    // Don't hijack page scrolling: wheel-zoom only after the map is clicked
    this.map.on('click focus', () => this.map.scrollWheelZoom.enable());
    this.map.on('mouseout blur', () => this.map.scrollWheelZoom.disable());
    const bases = baseLayers();
    bases[isDark() ? 'Dark' : 'Light'].addTo(this.map);
    L.control.layers(bases, null, { position: 'topright' }).addTo(this.map);
    this.group = L.layerGroup().addTo(this.map);
    this.legendEl = L.DomUtil.create('div', 'map-legend');
    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = () => this.legendEl;
    legend.addTo(this.map);
    this.keyCache = new WeakMap();
    this.gradCache = new WeakMap();
    this.viewSet = false;
    this.gps = [];
  }

  render(acts, mode) {
    this.map.invalidateSize();
    this.group.clearLayers();
    this.gps = acts.filter((a) => a.hasGps);
    if (!this.gps.length) {
      this.legendEl.innerHTML = '<p>No GPS activities in this selection.</p>';
      return;
    }
    if (!this.viewSet) { this.map.setView(densestArea(this.gps), 13); this.viewSet = true; }
    const draw = { heat: this.drawHeat, speed: this.drawSpeed, slope: this.drawSlope, routes: this.drawRoutes }[mode];
    draw.call(this, this.gps);
  }

  fitAll() {
    if (!this.gps.length) return;
    const b = this.gps.reduce((acc, a) => [Math.min(acc[0], a.bbox[0]), Math.min(acc[1], a.bbox[1]), Math.max(acc[2], a.bbox[2]), Math.max(acc[3], a.bbox[3])], [90, 180, -90, -180]);
    this.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: [20, 20] });
  }

  drawRuns(runs, styleOf) {
    const keys = [...runs.keys()].sort((a, b) => styleOf(a).z - styleOf(b).z);
    for (const k of keys) {
      const { color, weight, opacity } = styleOf(k);
      L.polyline(runs.get(k), { renderer: this.renderer, color, weight, opacity, interactive: false }).addTo(this.group);
    }
  }

  cached(cache, act, fn) {
    let v = cache.get(act);
    if (!v) { v = fn(act.track); cache.set(act, v); }
    return v;
  }

  drawHeat(acts) {
    const keysPer = acts.map((a) => this.cached(this.keyCache, a, segmentKeys));
    const counts = new Map();
    for (const keys of keysPer) {
      const seen = new Set();
      for (const k of keys) if (k === k && !seen.has(k)) { seen.add(k); counts.set(k, (counts.get(k) || 0) + 1); }
    }
    let max = 1;
    for (const c of counts.values()) if (c > max) max = c;
    const sq = Math.sqrt(max);
    const runs = new Map();
    acts.forEach((a, i) => {
      const keys = keysPer[i];
      collectRuns(runs, a.track, (j) => Math.min(N_HEAT - 1, Math.floor((Math.sqrt(counts.get(keys[j]) || 1) / sq) * N_HEAT)));
    });
    const ramp = ramps().heat;
    this.drawRuns(runs, (b) => {
      const t = (b + 0.5) / N_HEAT;
      return { color: interp(ramp, t), weight: 1.5 + t * 3, opacity: 0.55 + t * 0.4, z: b };
    });
    this.legend('Route frequency', ramp, '1 pass', `${max}× most used`);
  }

  drawSpeed(acts) {
    const sample = [];
    for (const a of acts) {
      const s = a.track.spd;
      if (s) for (let i = 0; i < s.length; i += 3) if (s[i] > 0.3) sample.push(s[i]);
    }
    const ramp = ramps().speed;
    const none = ramps().none;
    sample.sort((x, y) => x - y);
    const q = (p) => sample[Math.floor(p * (sample.length - 1))];
    const lo = sample.length ? q(0.05) : 0, hi = sample.length ? q(0.95) : 1;
    const span = Math.max(hi - lo, 0.5);
    const runs = new Map();
    for (const a of acts) {
      const s = a.track.spd;
      collectRuns(runs, a.track, (j) => (s && finite(s[j + 1]) ? Math.min(N_SPEED - 1, Math.max(0, Math.floor(((s[j + 1] - lo) / span) * N_SPEED))) : -1));
    }
    this.drawRuns(runs, (b) => (b < 0
      ? { color: none, weight: 1.5, opacity: 0.5, z: -1 }
      : { color: interp(ramp, (b + 0.5) / N_SPEED), weight: 3, opacity: 0.85, z: b }));
    const sports = new Set(acts.map((a) => sportFamily(a.sport)));
    this.legend('Speed', ramp, `${(lo * 3.6).toFixed(0)} km/h`, `${(hi * 3.6).toFixed(0)} km/h`,
      sports.size > 1 ? 'Tip: filter to one sport for a fairer scale.' : '');
  }

  drawSlope(acts) {
    const { up, down, none } = ramps();
    const runs = new Map();
    for (const a of acts) {
      const g = this.cached(this.gradCache, a, segmentGradients);
      collectRuns(runs, a.track, (j) => {
        if (!finite(g[j])) return -1;
        const b = Math.min(N_SLOPE - 1, Math.floor((Math.abs(g[j]) / SLOPE_MAX_PCT) * N_SLOPE));
        return g[j] >= 0 ? 100 + b : 200 + b;
      });
    }
    this.drawRuns(runs, (k) => {
      if (k < 0) return { color: none, weight: 1.5, opacity: 0.5, z: -1 };
      const b = k % 100, t = (b + 0.5) / N_SLOPE;
      return { color: interp(k < 200 ? up : down, t), weight: 2 + t * 2.5, opacity: 0.6 + t * 0.35, z: b };
    });
    const both = [...[...down].reverse().map(([t, c]) => [(1 - t) / 2, c]), ...up.map(([t, c]) => [0.5 + t / 2, c])];
    this.legend('Gradient', both, `−${SLOPE_MAX_PCT}% descent`, `+${SLOPE_MAX_PCT}% climb`, 'Grey = flat or no elevation data.');
  }

  drawRoutes(acts) {
    for (const a of acts) {
      const line = L.polyline(splitGaps(a.track), { renderer: this.renderer, color: sportColor(a.sport), weight: 2.5, opacity: 0.75 });
      line.bindTooltip(`<strong>${esc(a.name)}</strong><br>${esc(a.sport)} · ${fmtDate(a.start)} · ${fmtKm(a.distance)}`, { sticky: true });
      line.on('mouseover', () => line.setStyle({ weight: 5, opacity: 1 }).bringToFront());
      line.on('mouseout', () => line.setStyle({ weight: 2.5, opacity: 0.75 }));
      line.on('click', () => this.onSelect(a.id));
      line.addTo(this.group);
    }
    const sports = [...new Set(acts.map((a) => a.sport))].sort();
    this.legendEl.innerHTML = `<p class="map-legend__title">Routes by sport</p>` +
      sports.map((s) => `<p><span class="swatch" style="background:${sportColor(s)}"></span>${esc(s)}</p>`).join('') +
      `<p class="map-legend__hint">Click a route to open it.</p>`;
  }

  legend(title, ramp, loLabel, hiLabel, hint = '') {
    this.legendEl.innerHTML = `<p class="map-legend__title">${title}</p>
      <div class="map-legend__bar" style="background:${gradientCss(ramp)}"></div>
      <p class="map-legend__ends"><span>${loLabel}</span><span>${hiLabel}</span></p>
      ${hint ? `<p class="map-legend__hint">${hint}</p>` : ''}`;
  }
}

// ---------- single activity ----------

export function routeMap(el, act) {
  const map = L.map(el, { preferCanvas: true });
  baseLayers()[isDark() ? 'Dark' : 'Light'].addTo(map);
  const color = sportColor(act.sport);
  const line = L.polyline(splitGaps(act.track), { color, weight: 4, opacity: 0.9 }).addTo(map);
  const { lat, lon } = act.track;
  const n = lat.length - 1;
  const ring = cssVar('--surface');
  L.circleMarker([lat[0], lon[0]], { radius: 7, color: ring, weight: 2, fillColor: cssVar('--ink'), fillOpacity: 1 })
    .bindTooltip('Start').addTo(map);
  L.circleMarker([lat[n], lon[n]], { radius: 7, color: ring, weight: 2, fillColor: color, fillOpacity: 1 })
    .bindTooltip('Finish').addTo(map);
  map.fitBounds(line.getBounds(), { padding: [24, 24] });
  return map;
}
