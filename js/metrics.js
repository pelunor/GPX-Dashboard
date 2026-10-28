// Summary stats + a compact, downsampled track for each activity.

import { haversine, finite } from './util.js';

const KEEP_EVERY_M = 5;        // downsampled track keeps a point every ~5 m...
const KEEP_EVERY_S = 30;       // ...or every 30 s when standing still
const ELEV_HYSTERESIS_M = 3;   // ignore elevation wiggles smaller than this
const MOVING_MIN_MPS = 0.4;    // slower than this counts as stopped

function rollingMean(a, w) {
  const out = new Float64Array(a.length).fill(NaN);
  const h = w >> 1;
  for (let i = 0; i < a.length; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(a.length - 1, i + h); j++) if (finite(a[j])) { s += a[j]; c++; }
    if (c) out[i] = s / c;
  }
  return out;
}

function summarise(raw) {
  const hasGps = raw.lat.some(finite);
  let idx = raw.t.map((_, i) => i);
  if (hasGps) idx = idx.filter((i) => finite(raw.lat[i]) && finite(raw.lon[i]));
  const n = idx.length;
  if (n < 2) return null;

  const pick = (a) => Float64Array.from(idx, (i) => a[i] ?? NaN);
  const lat = hasGps ? pick(raw.lat) : null;
  const lon = hasGps ? pick(raw.lon) : null;
  const ele = pick(raw.ele), t = pick(raw.t), dev = pick(raw.dist), devSpd = pick(raw.speed), hr = pick(raw.hr);

  // cumulative distance: from GPS, or from the device (indoor trainer / footpod)
  const cum = new Float64Array(n);
  if (hasGps) {
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + haversine(lat[i - 1], lon[i - 1], lat[i], lon[i]);
  } else {
    let last = 0;
    for (let i = 0; i < n; i++) { if (finite(dev[i])) last = Math.max(last, dev[i]); cum[i] = last; }
  }

  const spd = new Float64Array(n).fill(NaN);
  let moving = 0;
  for (let i = 1; i < n; i++) {
    const dt = t[i] - t[i - 1];
    const v = dt > 0 ? (cum[i] - cum[i - 1]) / dt : NaN;
    spd[i] = finite(devSpd[i]) ? devSpd[i] : v;
    if (dt > 0 && dt <= 60 && v > MOVING_MIN_MPS) moving += dt;
  }
  const smooth = rollingMean(spd, 5);

  const tFinite = t.filter(finite);
  const t0 = tFinite.length ? tFinite[0] : NaN;
  const elapsed = tFinite.length ? tFinite[tFinite.length - 1] - t0 : NaN;

  let gain = 0, ref = NaN;
  for (const e of ele) {
    if (!finite(e)) continue;
    if (!finite(ref)) ref = e;
    else if (e > ref + ELEV_HYSTERESIS_M) { gain += e - ref; ref = e; }
    else if (e < ref - ELEV_HYSTERESIS_M) ref = e;
  }

  let maxSpeed = NaN;
  for (const v of smooth) if (finite(v) && v < 60 && !(v <= maxSpeed)) maxSpeed = v;
  let hrSum = 0, hrN = 0, hrMax = NaN;
  for (const v of hr) {
    if (!finite(v) || v <= 0) continue;
    hrSum += v; hrN++;
    if (!(v <= hrMax)) hrMax = v;
  }

  // downsample for storage and drawing
  const keep = [0];
  for (let i = 1; i < n - 1; i++) {
    const k = keep[keep.length - 1];
    const dd = cum[i] - cum[k], dt = t[i] - t[k];
    if (hasGps ? dd >= KEEP_EVERY_M || dt >= KEEP_EVERY_S : dt >= 5 || dd >= 10) keep.push(i);
  }
  keep.push(n - 1);
  const f32 = (a, map = (v) => v) => (a && a.some(finite) ? Float32Array.from(keep, (i) => map(a[i])) : null);

  const track = {
    lat: f32(lat), lon: f32(lon), ele: f32(ele),
    d: Float32Array.from(keep, (i) => cum[i]),
    t: finite(t0) ? f32(t, (v) => v - t0) : null,
    spd: f32(smooth), hr: f32(hr),
  };

  let bbox = null;
  if (hasGps) {
    bbox = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      bbox[0] = Math.min(bbox[0], lat[i]); bbox[1] = Math.min(bbox[1], lon[i]);
      bbox[2] = Math.max(bbox[2], lat[i]); bbox[3] = Math.max(bbox[3], lon[i]);
    }
  }

  return {
    stats: {
      start: finite(t0) ? t0 * 1000 : NaN,
      distance: cum[n - 1],
      moving: moving || (cum[n - 1] > 0 ? NaN : elapsed),
      elapsed,
      elevGain: ele.some(finite) ? gain : NaN,
      maxSpeed,
      avgHr: hrN ? hrSum / hrN : NaN,
      maxHr: hrMax,
    },
    track,
    bbox,
  };
}

// Strava's own numbers (from activities.csv) win when present, so totals match
// what the athlete sees on Strava; the file's numbers fill the gaps.
function finalize(a) {
  const c = a.csv || {}, o = a.own || {};
  const pick = (cv, ov) => (finite(cv) && cv > 0 ? cv : finite(ov) ? ov : finite(cv) ? cv : NaN);
  a.sport = c.sport || a.fileSport || 'Other';
  a.start = finite(o.start) ? o.start : finite(c.startMs) ? c.startMs : NaN;
  a.name = c.name || a.trackName || a.sport;
  a.distance = pick(c.distance, o.distance);
  a.moving = pick(c.moving, o.moving);
  a.elapsed = pick(c.elapsed, o.elapsed);
  a.elevGain = pick(c.elevGain, o.elevGain);
  a.maxSpeed = pick(c.maxSpeed, o.maxSpeed);
  a.avgHr = pick(c.avgHr, o.avgHr);
  a.maxHr = pick(c.maxHr, o.maxHr);
  a.avgSpeed = a.distance > 0 && a.moving > 0 ? a.distance / a.moving : NaN;
  a.hasGps = !!(a.track && a.track.lat && a.track.lat.length > 1);
  return a;
}

export function buildActivity(parsed, csv) {
  const s = parsed ? summarise(parsed.raw) : null;
  if (!s && !csv) return null;
  return finalize({
    id: parsed?.id ?? csv.id,
    fileSport: parsed?.sport ?? null,
    trackName: parsed?.trackName ?? null,
    own: s?.stats ?? null,
    track: s?.track ?? null,
    bbox: s?.bbox ?? null,
    csv: csv ?? null,
  });
}

export const applyCsv = (act, csv) => finalize({ ...act, csv });
