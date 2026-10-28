// Turning whatever the user drops in (Strava export .zip, its folder, or loose
// .gpx / .fit / .gz files) into raw tracks + Strava's activities.csv metadata.
// Only activities.csv and activity files are ever read; every other file in a
// Strava export (profile, followers, messages, media...) is ignored.

import { decodeFit, FIT_SPORTS } from './fit.js';

const ACTIVITY_RE = /\.(gpx|fit)(\.gz)?$/i;
const CSV_RE = /(^|[\\/])activities\.csv$/i;

export const isUsefulFile = (name) => ACTIVITY_RE.test(name) || CSV_RE.test(name) || /\.zip$/i.test(name);

const baseName = (path) => path.split(/[\\/]/).pop();

export function fileId(path) {
  return baseName(path).replace(/\.gz$/i, '').replace(/\.(gpx|fit)$/i, '');
}

export async function collectInputs(files) {
  let csvText = null;
  const entries = [];
  for (const file of files) {
    const path = file.relPath || file.webkitRelativePath || file.name;
    if (/\.zip$/i.test(file.name)) {
      const buf = new Uint8Array(await file.arrayBuffer());
      const unzipped = fflate.unzipSync(buf, { filter: (f) => CSV_RE.test(f.name) || ACTIVITY_RE.test(f.name) });
      for (const [name, data] of Object.entries(unzipped)) {
        if (CSV_RE.test(name)) csvText = new TextDecoder().decode(data);
        else entries.push({ name: baseName(name), data });
      }
    } else if (CSV_RE.test(path) || file.name.toLowerCase() === 'activities.csv') {
      csvText = await file.text();
    } else if (ACTIVITY_RE.test(file.name)) {
      entries.push({ name: file.name, file });
    }
  }
  return { csvText, entries };
}

// ---------- activity files ----------

export async function parseEntry(entry) {
  let bytes = entry.data || new Uint8Array(await entry.file.arrayBuffer());
  let name = entry.name;
  if (/\.gz$/i.test(name)) {
    bytes = fflate.gunzipSync(bytes);
    name = name.slice(0, -3);
  }
  const parsed = /\.gpx$/i.test(name) ? parseGpx(new TextDecoder().decode(bytes)) : parseFit(bytes);
  return { id: fileId(name), ...parsed };
}

function emptyRaw() {
  return { lat: [], lon: [], ele: [], t: [], dist: [], speed: [], hr: [] };
}

const num = (s) => (s == null || s === '' ? NaN : Number(s));

function childText(el, localName) {
  if (!el) return null;
  for (const c of el.children) if (c.localName === localName) return c.textContent.trim();
  return null;
}

function gpxSport(type) {
  const t = (type || '').toLowerCase();
  if (/run/.test(t)) return 'Run';
  if (/cycl|bik|ride/.test(t)) return 'Ride';
  if (/hik/.test(t)) return 'Hike';
  if (/walk/.test(t)) return 'Walk';
  if (/swim/.test(t)) return 'Swim';
  return null;
}

function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text.replace(/^﻿/, '').trim(), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('not a valid GPX file');
  const raw = emptyRaw();
  for (const p of doc.getElementsByTagNameNS('*', 'trkpt')) {
    raw.lat.push(num(p.getAttribute('lat')));
    raw.lon.push(num(p.getAttribute('lon')));
    raw.ele.push(num(childText(p, 'ele')));
    const time = childText(p, 'time');
    raw.t.push(time ? Date.parse(time) / 1000 : NaN);
    raw.hr.push(num(p.getElementsByTagNameNS('*', 'hr')[0]?.textContent));
    raw.dist.push(NaN);
    raw.speed.push(NaN);
  }
  const trk = doc.getElementsByTagNameNS('*', 'trk')[0];
  return { raw, sport: gpxSport(childText(trk, 'type')), trackName: childText(trk, 'name') };
}

function parseFit(bytes) {
  const fit = decodeFit(bytes);
  const raw = emptyRaw();
  for (const r of fit.records) for (const k in raw) raw[k].push(r[k]);
  return { raw, sport: FIT_SPORTS[fit.sport] ?? null, trackName: null };
}

// ---------- Strava activities.csv ----------

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// Strava writes "Oct 27, 2026, 7:00:13 PM" in UTC
function parseStravaDate(s) {
  const m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4}),? (\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)?/i.exec(s || '');
  if (m && m[1].toLowerCase() in MONTHS) {
    let h = +m[4];
    if (m[7]) {
      const pm = /p/i.test(m[7]);
      h = h === 12 ? (pm ? 12 : 0) : pm ? h + 12 : h;
    }
    return Date.UTC(+m[3], MONTHS[m[1].toLowerCase()], +m[2], h, +m[5], +m[6]);
  }
  const d = Date.parse(s);
  return Number.isFinite(d) ? d : NaN;
}

const csvNum = (s) => (s ? Number(String(s).replace(/,/g, '')) : NaN);

export function readStravaCsv(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const head = rows[0] || [];
  const first = (n) => head.indexOf(n);
  const last = (n) => head.lastIndexOf(n);
  const col = {
    id: first('Activity ID'), date: first('Activity Date'), name: first('Activity Name'),
    type: first('Activity Type'), file: first('Filename'), elapsed: last('Elapsed Time'),
    moving: first('Moving Time'), distKm: first('Distance'), distM: last('Distance'),
    gain: first('Elevation Gain'), maxSpeed: first('Max Speed'),
    avgHr: first('Average Heart Rate'), maxHr: last('Max Heart Rate'),
  };
  if (col.id < 0) return [];   // not an English Strava activities.csv

  return rows.slice(1).filter((r) => r[col.id]).map((r) => {
    const g = (k) => (col[k] >= 0 ? r[col[k]] : '');
    let distance = col.distM !== col.distKm ? csvNum(g('distM')) : NaN;
    if (!Number.isFinite(distance)) distance = csvNum(g('distKm')) * 1000;
    return {
      id: g('file') ? fileId(g('file')) : 'strava-' + g('id'),
      name: g('name'),
      sport: g('type') || null,
      startMs: parseStravaDate(g('date')),
      elapsed: csvNum(g('elapsed')),
      moving: csvNum(g('moving')),
      distance,
      elevGain: csvNum(g('gain')),
      maxSpeed: csvNum(g('maxSpeed')),
      avgHr: csvNum(g('avgHr')),
      maxHr: csvNum(g('maxHr')),
    };
  });
}
