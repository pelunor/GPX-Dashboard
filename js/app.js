// Dashboard UI: loading data, filters, stats, map, table and detail view.

import * as store from './store.js';
import { collectInputs, parseEntry, readStravaCsv, isUsefulFile } from './parse.js';
import { buildActivity, applyCsv } from './metrics.js';
import { OverviewMap, routeMap } from './map.js';
import { renderProfiles, purgeProfiles } from './charts.js';
import {
  $, esc, tick, finite, sportColor, sportFamily, maxBy,
  fmtKm, fmtDuration, fmtHours, fmtSpeed, fmtInt, fmtDate, fmtDateTime,
} from './util.js';

const PAGE = 25;

const state = {
  all: [],
  filtered: [],
  filters: { sports: new Set(), from: NaN, to: NaN },
  search: '',
  sort: { key: 'start', dir: -1 },
  shown: PAGE,
  mapMode: 'heat',
};

let overview = null;
let detailMap = null;

// ==========================================
// LOADING
// ==========================================

async function handleFiles(fileList) {
  const files = [...fileList].filter((f) => isUsefulFile(f.relPath || f.webkitRelativePath || f.name));
  if (!files.length) {
    toast('No activity files found. Choose a Strava export (.zip or folder), or .gpx / .fit files.');
    return;
  }
  progress('Reading files…', 0);
  try {
    const { csvText, entries } = await collectInputs(files);
    const csvRows = csvText ? readStravaCsv(csvText) : [];
    const csvById = new Map(csvRows.map((r) => [r.id, r]));
    const existing = new Map(state.all.map((a) => [a.id, a]));
    const loaded = new Map();
    const failed = [];

    for (let i = 0; i < entries.length; i++) {
      if (i % 4 === 0) { progress(`Processing ${i + 1} of ${entries.length}…`, i / entries.length); await tick(); }
      try {
        const parsed = await parseEntry(entries[i]);
        const csv = csvById.get(parsed.id) || existing.get(parsed.id)?.csv || null;
        const act = buildActivity(parsed, csv);
        if (act) loaded.set(act.id, act); else failed.push(entries[i].name);
      } catch (e) {
        failed.push(entries[i].name);
        console.warn(entries[i].name, e);
      }
    }
    // Activities that only exist in activities.csv (gym sessions, manual
    // entries, unreadable files) still count towards stats.
    for (const row of csvRows) {
      if (loaded.has(row.id)) continue;
      const prev = existing.get(row.id);
      loaded.set(row.id, prev ? applyCsv(prev, row) : buildActivity(null, row));
    }

    const acts = [...loaded.values()];
    if (!acts.length) { toast('Nothing could be read from those files.'); return; }
    for (const a of acts) existing.set(a.id, a);
    state.all = [...existing.values()];

    progress('Saving in this browser…', 1);
    try { await store.putAll(acts); } catch (e) {
      console.warn(e);
      toast('Loaded, but this browser blocked local storage, so the data will be gone after a reload.');
    }
    const skipped = failed.filter((f) => !loaded.has(f.replace(/\.(gpx|fit)(\.gz)?$/i, '')));
    toast(`${acts.length} activities loaded.` + (skipped.length ? ` ${skipped.length} file(s) couldn't be read.` : ''));
    render();
  } catch (e) {
    console.error(e);
    toast('Something went wrong reading those files: ' + e.message);
  } finally {
    progress(null);
  }
}

async function filesFromDrop(dt) {
  const roots = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!roots.length) return [...dt.files];
  const out = [];
  async function walk(entry, path) {
    if (entry.isFile) {
      if (!isUsefulFile(entry.name)) return;
      const f = await new Promise((res, rej) => entry.file(res, rej));
      f.relPath = path + f.name;
      out.push(f);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, path + entry.name + '/');
      } while (batch.length);
    }
  }
  for (const r of roots) await walk(r, '');
  return out;
}

// ==========================================
// FILTERS
// ==========================================

function applyFilters() {
  const { sports, from, to } = state.filters;
  state.filtered = state.all.filter((a) =>
    (!sports.size || sports.has(a.sport)) &&
    (!finite(from) || a.start >= from) &&
    (!finite(to) || a.start < to));
}

function renderFilters() {
  const counts = new Map();
  for (const a of state.all) counts.set(a.sport, (counts.get(a.sport) || 0) + 1);
  const sports = [...counts].sort((a, b) => b[1] - a[1]);
  $('#f-sports').innerHTML = sports.map(([s, n]) => `
    <button type="button" class="chip" data-sport="${esc(s)}" aria-pressed="${state.filters.sports.has(s)}">
      <span class="swatch" style="background:${sportColor(s)}"></span>${esc(s)} <span class="chip__n">${n}</span>
    </button>`).join('');

  const years = [...new Set(state.all.map((a) => finite(a.start) && new Date(a.start).getFullYear()).filter(Boolean))].sort((a, b) => b - a);
  const sel = $('#f-year');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All time</option>' + years.map((y) => `<option value="${y}">${y}</option>`).join('') +
    '<option value="custom" hidden>Custom range</option>';
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';

  const n = state.filtered.length, total = state.all.length;
  $('#f-count').textContent = n === total ? `${total} activities` : `${n} of ${total} activities`;
  $('#f-reset').hidden = !state.filters.sports.size && !finite(state.filters.from) && !finite(state.filters.to);
}

function setDateRange(from, to) {
  state.filters.from = from;
  state.filters.to = to;
  const iso = (ms) => (finite(ms) ? new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '');
  $('#f-from').value = iso(from);
  $('#f-to').value = finite(to) ? iso(to - 86400000) : '';
}

// ==========================================
// STATS
// ==========================================

const sum = (acts, k) => acts.reduce((s, a) => s + (finite(a[k]) ? a[k] : 0), 0);

function actLink(a, text) {
  return `<button type="button" class="link" data-id="${esc(a.id)}">${esc(text)}</button>`;
}

function renderKpis() {
  const acts = state.filtered;
  const dist = sum(acts, 'distance'), time = sum(acts, 'moving'), elev = sum(acts, 'elevGain');
  const days = new Set(acts.filter((a) => finite(a.start)).map((a) => new Date(a.start).toDateString())).size;
  const longest = maxBy(acts, (a) => a.distance);
  const climb = maxBy(acts, (a) => a.elevGain);
  const tiles = [
    ['Activities', acts.length.toLocaleString(), `on ${days.toLocaleString()} days`],
    ['Distance', fmtKm(dist, 0), acts.length ? `${fmtKm(dist / acts.length)} per activity` : ''],
    ['Moving time', fmtHours(time), acts.length ? `${fmtDuration(time / acts.length)} per activity` : ''],
    ['Elevation gain', fmtInt(elev, ' m'), elev > 0 ? `${(elev / 8849).toFixed(1)}× Everest` : ''],
    ['Longest', longest ? fmtKm(longest.distance) : '–', longest ? actLink(longest, longest.name) : '', true],
    ['Biggest climb', climb && climb.elevGain > 0 ? fmtInt(climb.elevGain, ' m') : '–', climb && climb.elevGain > 0 ? actLink(climb, climb.name) : '', true],
  ];
  $('#kpis').innerHTML = tiles.map(([label, value, sub, html]) => `
    <div class="kpi">
      <p class="kpi__label">${label}</p>
      <p class="kpi__value">${value}</p>
      <p class="kpi__sub">${html ? sub : esc(sub)}</p>
    </div>`).join('');
}

function bySport(acts) {
  const groups = new Map();
  for (const a of acts) {
    if (!groups.has(a.sport)) groups.set(a.sport, []);
    groups.get(a.sport).push(a);
  }
  return [...groups].sort((a, b) => b[1].length - a[1].length);
}

function renderRecords() {
  const cards = bySport(state.filtered).map(([sport, acts]) => {
    const minDist = sportFamily(sport) === 'swim' ? 200 : 1000;
    const rows = [
      ['Longest', maxBy(acts, (a) => (a.distance > 0 ? a.distance : NaN)), (a) => fmtKm(a.distance, 2)],
      ['Longest time', maxBy(acts, (a) => a.moving), (a) => fmtDuration(a.moving)],
      ['Biggest climb', maxBy(acts, (a) => (a.elevGain > 0 ? a.elevGain : NaN)), (a) => fmtInt(a.elevGain, ' m')],
      ['Fastest average', maxBy(acts, (a) => (a.distance >= minDist ? a.avgSpeed : NaN)), (a) => fmtSpeed(a.avgSpeed, sport)],
    ].filter(([, a]) => a);
    return `
      <article class="record">
        <h3 class="record__title"><span class="swatch" style="background:${sportColor(sport)}"></span>${esc(sport)}
          <span class="record__n">${acts.length}</span></h3>
        <dl>${rows.map(([label, a, f]) => `
          <div class="record__row">
            <dt>${label}</dt>
            <dd><button type="button" class="record__value" data-id="${esc(a.id)}">${f(a)}</button>
              <span class="record__who">${esc(a.name)} · ${fmtDate(a.start)}</span></dd>
          </div>`).join('')}
        </dl>
      </article>`;
  });
  $('#records').innerHTML = cards.join('') || '<p class="empty">No activities match the filters.</p>';
}

function renderBreakdown() {
  const groups = bySport(state.filtered).map(([sport, acts]) => ({
    sport, n: acts.length, dist: sum(acts, 'distance'), time: sum(acts, 'moving'),
  }));
  const maxTime = Math.max(1, ...groups.map((g) => g.time));
  $('#breakdown').innerHTML = groups.map((g) => `
    <li class="bar-row">
      <div class="bar-row__label"><span class="swatch" style="background:${sportColor(g.sport)}"></span>${esc(g.sport)}</div>
      <div class="bar-row__track" title="${esc(g.sport)}: ${fmtHours(g.time)}">
        <div class="bar-row__fill" style="width:${(g.time / maxTime) * 100}%;background:${sportColor(g.sport)}"></div>
      </div>
      <div class="bar-row__nums"><span>${fmtHours(g.time)}</span><span>${g.dist > 0 ? fmtKm(g.dist, 0) : ''}</span><span>${g.n}×</span></div>
    </li>`).join('') || '<li class="empty">No activities.</li>';
}

// ==========================================
// MAP
// ==========================================

function renderMap() {
  if (!overview) overview = new OverviewMap($('#map'), { onSelect: openDetail });
  for (const b of document.querySelectorAll('[data-map-mode]')) b.setAttribute('aria-pressed', b.dataset.mapMode === state.mapMode);
  overview.render(state.filtered, state.mapMode);
}

// ==========================================
// TABLE
// ==========================================

const COLUMNS = [
  { key: 'start', label: 'Date', fmt: (a) => fmtDate(a.start) },
  { key: 'name', label: 'Name', fmt: (a) => esc(a.name), cls: 'col-name' },
  { key: 'sport', label: 'Sport', fmt: (a) => `<span class="swatch" style="background:${sportColor(a.sport)}"></span>${esc(a.sport)}` },
  { key: 'distance', label: 'Distance', num: true, fmt: (a) => (a.distance > 0 ? fmtKm(a.distance, 2) : '–') },
  { key: 'moving', label: 'Time', num: true, fmt: (a) => fmtDuration(a.moving) },
  { key: 'avgSpeed', label: 'Pace / speed', num: true, fmt: (a) => fmtSpeed(a.avgSpeed, a.sport) },
  { key: 'elevGain', label: 'Elevation', num: true, fmt: (a) => (a.elevGain > 0 ? fmtInt(a.elevGain, ' m') : '–') },
  { key: 'avgHr', label: 'Avg HR', num: true, fmt: (a) => fmtInt(a.avgHr) },
];

function renderTable() {
  const q = state.search.trim().toLowerCase();
  const { key, dir } = state.sort;
  const rows = state.filtered
    .filter((a) => !q || a.name.toLowerCase().includes(q) || a.sport.toLowerCase().includes(q))
    .sort((a, b) => {
      const x = a[key], y = b[key];
      if (typeof x === 'string') return dir * x.localeCompare(y);
      const fx = finite(x), fy = finite(y);
      if (!fx || !fy) return fx ? -1 : fy ? 1 : 0;   // missing values last
      return dir * (x - y);
    });

  $('#t-head').innerHTML = COLUMNS.map((c) => `
    <th scope="col" class="${c.num ? 'num' : ''}" aria-sort="${c.key === key ? (dir > 0 ? 'ascending' : 'descending') : 'none'}">
      <button type="button" data-sort="${c.key}">${c.label}<span class="sort-ind" aria-hidden="true">${c.key === key ? (dir > 0 ? '▲' : '▼') : ''}</span></button>
    </th>`).join('');

  $('#t-body').innerHTML = rows.slice(0, state.shown).map((a) => `
    <tr data-id="${esc(a.id)}" tabindex="0">
      ${COLUMNS.map((c) => `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.fmt(a)}</td>`).join('')}
    </tr>`).join('') || `<tr><td colspan="${COLUMNS.length}" class="empty">No activities match.</td></tr>`;

  $('#t-status').textContent = rows.length > state.shown ? `Showing ${state.shown} of ${rows.length}` : `${rows.length} activities`;
  $('#t-more').hidden = rows.length <= state.shown;
}

// ==========================================
// DETAIL
// ==========================================

function openDetail(id) {
  const a = state.all.find((x) => x.id === id);
  if (!a) return;
  const dlg = $('#detail');
  $('#d-title').textContent = a.name;
  $('#d-meta').innerHTML = `<span class="swatch" style="background:${sportColor(a.sport)}"></span>${esc(a.sport)} · ${fmtDateTime(a.start)}`;

  const stats = [
    ['Distance', a.distance > 0 ? fmtKm(a.distance, 2) : null],
    ['Moving time', a.moving > 0 ? fmtDuration(a.moving) : null],
    ['Elapsed time', a.elapsed > 0 ? fmtDuration(a.elapsed) : null],
    ['Avg pace / speed', finite(a.avgSpeed) ? fmtSpeed(a.avgSpeed, a.sport) : null],
    ['Max speed', a.maxSpeed > 0 ? `${(a.maxSpeed * 3.6).toFixed(1)} km/h` : null],
    ['Elevation gain', a.elevGain > 0 ? fmtInt(a.elevGain, ' m') : null],
    ['Avg heart rate', finite(a.avgHr) ? fmtInt(a.avgHr, ' bpm') : null],
    ['Max heart rate', finite(a.maxHr) ? fmtInt(a.maxHr, ' bpm') : null],
  ].filter(([, v]) => v);
  $('#d-stats').innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  $('#d-map').hidden = !a.hasGps;
  $('#d-note').hidden = !!a.track;
  dlg.showModal();
  if (a.hasGps) detailMap = routeMap($('#d-map'), a);
  renderProfiles($('#d-charts'), a);
}

function closeDetail() {
  if (detailMap) { detailMap.remove(); detailMap = null; }
  purgeProfiles($('#d-charts'));
}

// ==========================================
// RENDER + UI PLUMBING
// ==========================================

function render() {
  const has = state.all.length > 0;
  $('#welcome').hidden = has;
  $('#dashboard').hidden = !has;
  for (const el of document.querySelectorAll('.js-has-data')) el.hidden = !has;
  if (!has) return;
  applyFilters();
  renderFilters();
  renderKpis();
  renderRecords();
  renderBreakdown();
  state.shown = PAGE;
  renderTable();
  renderMap();
}

const refresh = render;

function progress(text, frac) {
  const el = $('#progress');
  el.hidden = text == null;
  if (text == null) return;
  $('#progress-text').textContent = text;
  $('#progress-bar').value = frac ?? 0;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 7000);
}

function bindUi() {
  const pickFiles = () => $('#in-files').click();
  const pickFolder = () => $('#in-folder').click();
  for (const b of document.querySelectorAll('.js-pick-files')) b.addEventListener('click', pickFiles);
  for (const b of document.querySelectorAll('.js-pick-folder')) b.addEventListener('click', pickFolder);
  for (const id of ['#in-files', '#in-folder']) {
    $(id).addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  }

  // drag & drop anywhere
  let depth = 0;
  document.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { depth++; document.body.classList.add('dragging'); } });
  document.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging');
    handleFiles(await filesFromDrop(e.dataTransfer));
  });

  $('#btn-clear').addEventListener('click', async () => {
    if (!confirm('Remove all activities from this browser? Your original files are not touched.')) return;
    try { await store.clearAll(); } catch (e) { console.warn(e); }
    state.all = [];
    state.filters = { sports: new Set(), from: NaN, to: NaN };
    overview = null;
    $('#map').replaceWith(Object.assign(document.createElement('div'), { id: 'map', className: 'map' }));
    render();
  });

  // filters
  $('#f-sports').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sport]');
    if (!b) return;
    const s = b.dataset.sport, set = state.filters.sports;
    set.has(s) ? set.delete(s) : set.add(s);
    refresh();
  });
  $('#f-year').addEventListener('change', (e) => {
    const y = +e.target.value;
    if (y) setDateRange(new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime());
    else setDateRange(NaN, NaN);
    refresh();
  });
  for (const id of ['#f-from', '#f-to']) {
    $(id).addEventListener('change', () => {
      const parse = (v) => (v ? new Date(v + 'T00:00').getTime() : NaN);
      const to = parse($('#f-to').value);
      setDateRange(parse($('#f-from').value), finite(to) ? to + 86400000 : NaN);
      $('#f-year').value = finite(state.filters.from) || finite(state.filters.to) ? 'custom' : '';
      refresh();
    });
  }
  $('#f-reset').addEventListener('click', () => {
    state.filters.sports.clear();
    setDateRange(NaN, NaN);
    $('#f-year').value = '';
    refresh();
  });

  // map
  for (const b of document.querySelectorAll('[data-map-mode]')) {
    b.addEventListener('click', () => { state.mapMode = b.dataset.mapMode; renderMap(); });
  }
  $('#map-fit').addEventListener('click', () => overview?.fitAll());

  // records / KPI links -> detail
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) openDetail(b.dataset.id);
  });

  // table
  $('#t-head').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    const key = b.dataset.sort;
    state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : key === 'name' || key === 'sport' ? 1 : -1 };
    renderTable();
  });
  $('#t-search').addEventListener('input', (e) => { state.search = e.target.value; state.shown = PAGE; renderTable(); });
  $('#t-more').addEventListener('click', () => { state.shown += PAGE * 2; renderTable(); });
  $('#t-body').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) openDetail(tr.dataset.id); });
  $('#t-body').addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(tr.dataset.id); }
  });

  // detail dialog
  const dlg = $('#detail');
  $('#d-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', closeDetail);

  // re-colour maps/charts if the OS theme changes
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!state.all.length) return;
    overview?.map.remove();
    overview = null;
    $('#map').replaceWith(Object.assign(document.createElement('div'), { id: 'map', className: 'map' }));
    render();
  });
}

async function init() {
  bindUi();
  try {
    state.all = await store.getAll();
  } catch (e) {
    console.warn(e);
    toast("This browser blocks local storage, so data won't be remembered between visits.");
  }
  render();
}

init();
