// Plotly profile charts for the activity detail view: one chart per measure
// (never two y-scales on one chart), all sharing distance on the x-axis.

import { cssVar, sportColor, sportFamily, usesPace, fmtPace, finite } from './util.js';

const CONFIG = { displayModeBar: false, responsive: true };

function layout(yTitle, yaxis = {}) {
  const grid = cssVar('--grid'), axis = cssVar('--axis');
  return {
    height: 190,
    margin: { l: 58, r: 12, t: 6, b: 38 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', size: 12, color: cssVar('--ink-2') },
    xaxis: { title: { text: 'Distance (km)' }, gridcolor: grid, linecolor: axis, zeroline: false, ticks: 'outside', tickcolor: axis },
    yaxis: { title: { text: yTitle }, gridcolor: grid, linecolor: axis, zeroline: false, ...yaxis },
    hovermode: 'x unified',
    hoverlabel: { bgcolor: cssVar('--surface'), bordercolor: cssVar('--axis'), font: { color: cssVar('--ink') } },
    showlegend: false,
  };
}

function rgba(hex, a) {
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
}

function quantile(values, p) {
  const v = values.filter(finite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(p * (v.length - 1))] : NaN;
}

export function renderProfiles(container, act) {
  purgeProfiles(container);
  const tr = act.track;
  if (!tr) return;
  const x = Array.from(tr.d, (v) => v / 1000);
  const color = sportColor(act.sport);

  const add = (title, y, yTitle, { fill = false, hover, customdata, yaxis } = {}) => {
    if (!y.some(finite)) return;
    const fig = document.createElement('figure');
    fig.className = 'profile';
    fig.innerHTML = `<figcaption>${title}</figcaption><div class="profile__plot"></div>`;
    container.append(fig);
    Plotly.newPlot(fig.lastElementChild, [{
      x, y, customdata, type: 'scatter', mode: 'lines', connectgaps: false,
      line: { color, width: 2 },
      fill: fill ? 'tozeroy' : 'none', fillcolor: rgba(color, 0.14),
      hovertemplate: hover,
    }], layout(yTitle, yaxis), CONFIG);
  };

  if (tr.ele) {
    const ele = Array.from(tr.ele, (v) => (finite(v) ? v : null));
    const lo = quantile(ele, 0), hi = quantile(ele, 1);
    add('Elevation', ele, 'Elevation (m)', {
      fill: lo >= 0, hover: '%{y:.0f} m<extra></extra>',
      yaxis: { range: [Math.max(0, lo - (hi - lo) * 0.15 - 5), hi + (hi - lo) * 0.1 + 5] },
    });
  }

  if (tr.spd) {
    if (usesPace(act.sport) || sportFamily(act.sport) === 'swim') {
      const per = sportFamily(act.sport) === 'swim' ? 100 : 1000;
      const unit = per === 100 ? '/100m' : '/km';
      const pace = Array.from(tr.spd, (v) => (v > 0.4 ? per / v : null));   // seconds per unit
      const fast = quantile(pace, 0.02), slow = quantile(pace, 0.97);
      const ticks = [];
      for (let s = Math.floor(fast / 60) * 60; s <= slow + 60; s += slow - fast > 600 ? 120 : 60) ticks.push(s);
      add('Pace', pace, `Pace (min${unit})`, {
        customdata: pace.map((p) => (p ? fmtPace(p) : '')),
        hover: `%{customdata} ${unit}<extra></extra>`,
        yaxis: { range: [slow + 10, fast - 10], tickvals: ticks, ticktext: ticks.map(fmtPace) },  // faster = higher
      });
    } else {
      const kmh = Array.from(tr.spd, (v) => (finite(v) ? v * 3.6 : null));
      add('Speed', kmh, 'Speed (km/h)', { fill: true, hover: '%{y:.1f} km/h<extra></extra>', yaxis: { rangemode: 'tozero' } });
    }
  }

  if (tr.hr) {
    add('Heart rate', Array.from(tr.hr, (v) => (finite(v) ? v : null)), 'Heart rate (bpm)', { hover: '%{y:.0f} bpm<extra></extra>' });
  }
}

export function purgeProfiles(container) {
  for (const el of container.querySelectorAll('.profile__plot')) Plotly.purge(el);
  container.innerHTML = '';
}
