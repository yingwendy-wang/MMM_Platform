const MMM = (() => {
  const cfg = window.APP_CONFIG || { dataRoot: './site', assistantUrl: '#' };
  const cache = new Map();
  const charts = new Map();

  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const fmtNum = (v) => new Intl.NumberFormat().format(Number(v || 0));
  const fmt1 = (v) => Number(v || 0).toFixed(1);
  const fmtPct = (v, d = 1) => `${(Number(v || 0) * 100).toFixed(d)}%`;
  const byDate = (a, b) => String(a.video_date).localeCompare(String(b.video_date));
  const unique = (arr) => [...new Set(arr)];
  const getParam = (k) => new URLSearchParams(location.search).get(k);
  const setParam = (updates) => {
    const url = new URL(location.href);
    Object.entries(updates).forEach(([k, v]) => {
      if (v === null || v === undefined || v === '') url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    });
    history.replaceState({}, '', url);
  };
  const todayRange = async () => fetchJSON('explorer/meta.json');

  function showError(message) {
    let box = qs('#global-error');
    if (!box) {
      box = document.createElement('div');
      box.id = 'global-error';
      box.className = 'container';
      box.style.marginTop = '16px';
      box.innerHTML = '<div class="notice"></div>';
      const main = document.querySelector('main');
      if (main) main.prepend(box);
    }
    qs('.notice', box).textContent = message;
  }

  function parseJSON(text) {
    return JSON.parse(text
      .replace(/:\s*NaN(?=\s*[,}])/g, ': null')
      .replace(/:\s*Infinity(?=\s*[,}])/g, ': null')
      .replace(/:\s*-Infinity(?=\s*[,}])/g, ': null'));
  }

  async function fetchJSON(path) {
    const full = `${cfg.dataRoot.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
    if (cache.has(full)) return cache.get(full);
    try {
      const res = await fetch(full);
      if (!res.ok) throw new Error(full);
      const data = parseJSON(await res.text());
      cache.set(full, data);
      return data;
    } catch (err) {
      showError(location.protocol === 'file:'
        ? 'This project must be opened through a local server or GitHub Pages. Opening HTML directly via file:// blocks JSON loading.'
        : `Could not load ${full}. Confirm that the site/ folder is in the same root as the HTML files.`);
      throw err;
    }
  }

  function toneFromExperience(v) {
    if (v == null || Number.isNaN(Number(v))) return '#c6d0db';
    const n = Number(v);
    if (n <= .25) return '#d75454';
    if (n <= .5) return '#ea8d45';
    if (n <= .75) return '#a6b63f';
    return '#22a268';
  }
  function toneFromDiff(v) {
    if (v == null || Number.isNaN(Number(v))) return '#c6d0db';
    return Number(v) >= 0 ? '#22a268' : '#d75454';
  }
  function roleTone(role) {
    return { Gateway:'#1d73ff', Connector:'#22a268', Disperser:'#ea8d45', Anchor:'#8a56ff', Destination:'#465768', Standalone:'#98a5b4' }[role] || '#465768';
  }

  function renderStats(node, items) {
    node.innerHTML = items.map(i => `
      <article class="stat">
        <div class="stat-label">${i.label}</div>
        <div class="stat-value">${i.value}</div>
        ${i.sub ? `<div class="stat-sub">${i.sub}</div>` : ''}
      </article>`).join('');
  }

  function renderRanking(node, rows, opts = {}) {
    if (!rows?.length) { node.innerHTML = '<div class="empty">No data available for this selection.</div>'; return; }
    const title = opts.titleKey || 'poi_name';
    const sub = opts.subKey;
    const valueKey = opts.valueKey;
    const fmt = opts.format || ((v) => v ?? '—');
    node.innerHTML = `<div class="rank-list">${rows.map(r => `
      <div class="rank-row ${opts.rowClass || ''}">
        <div>
          <strong>${r[title] ?? r.companion_poi_name ?? r.origin_poi_name ?? r.dest_poi_name ?? r.author_region ?? '—'}</strong>
          ${sub ? `<small>${r[sub] ?? ''}</small>` : ''}
        </div>
        <div class="rank-metric">${fmt(r[valueKey], r)}</div>
      </div>`).join('')}</div>`;
  }

  function renderTable(node, columns, rows) {
    if (!rows?.length) { node.innerHTML = '<div class="empty">No data available for this selection.</div>'; return; }
    node.innerHTML = `<div class="table-wrap"><table><thead><tr>${columns.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(c => `<td>${c.render ? c.render(row[c.key], row) : (row[c.key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function renderCards(node, cards) {
    if (!cards?.length) { node.innerHTML = '<div class="empty">No cards available.</div>'; return; }
    node.innerHTML = cards.map(card => `
      <article class="insight-item">
        ${card.type ? `<div class="badge">${String(card.type).replace(/_/g,' ')}</div>` : ''}
        <h4>${card.title}</h4>
        <p>${card.detail || card.summary || ''}</p>
      </article>`).join('');
  }

  function setSelect(select, rows, { value='poi_id', label='poi_name', includeAll=true, allLabel='All' } = {}, current='') {
    select.innerHTML = `${includeAll ? `<option value="">${allLabel}</option>` : ''}${rows.map(r => `<option value="${r[value]}" ${String(r[value])===String(current)?'selected':''}>${r[label]}</option>`).join('')}`;
  }

  function setMulti(select, rows, selected = [], { value='poi_id', label='poi_name' } = {}) {
    select.innerHTML = rows.map(r => `<option value="${r[value]}" ${selected.includes(String(r[value]))?'selected':''}>${r[label]}</option>`).join('');
  }

  function chart(id, config) {
    if (charts.has(id)) { charts.get(id).destroy(); charts.delete(id); }
    const c = new Chart(document.getElementById(id), config);
    charts.set(id, c);
    return c;
  }
  function lineChart(id, labels, datasets, extra={}) {
    return chart(id, {
      type: 'line',
      data: { labels, datasets: datasets.map(d => ({ ...d, tension: .25, fill: false, borderWidth: 2, pointRadius: 2 })) },
      options: { responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false}, plugins:{legend:{position:'bottom'}}, ...extra }
    });
  }
  function barChart(id, labels, values, label, extra={}) {
    return chart(id, {
      type:'bar',
      data:{ labels, datasets:[{ label, data: values, borderRadius: 8 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, ...extra }
    });
  }
  function scatterChart(id, points) {
    return chart(id, {
      type:'scatter',
      data:{ datasets:[{ data: points.map(p => ({ x:p.x, y:p.y, label:p.label })), pointRadius:6, pointHoverRadius:8 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}, tooltip:{callbacks:{label:(ctx)=>`${ctx.raw.label}: ${fmtNum(ctx.raw.x)} / ${fmt1(ctx.raw.y)}`}}}, scales:{x:{title:{display:true,text:'Volume'}}, y:{title:{display:true,text:'Experience'}, suggestedMin:0, suggestedMax:1}} }
    });
  }

  function map(id) {
    const m = L.map(id, { zoomControl:true, scrollWheelZoom:true }).setView(cfg.mapCenter, cfg.mapZoom);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution:'&copy; OpenStreetMap &copy; CARTO' }).addTo(m);
    return m;
  }

  function groupSum(rows, key, val='journey_n') {
    const out = new Map();
    rows.forEach(r => out.set(r[key], (out.get(r[key]) || 0) + Number(r[val] || 0)));
    return out;
  }

  function sum(rows, key) { return rows.reduce((a, r) => a + Number(r[key] || 0), 0); }
  function avgWeighted(rows, valueKey, weightKey) {
    const w = sum(rows, weightKey);
    if (!w) return null;
    return rows.reduce((a, r) => a + Number(r[valueKey] || 0) * Number(r[weightKey] || 0), 0) / w;
  }

  function inRange(rows, start, end) {
    return rows.filter(r => (!start || r.video_date >= start) && (!end || r.video_date <= end));
  }

  function syncNav() {
    const page = document.body.dataset.page;
    qsa('.nav a').forEach(a => a.classList.toggle('active', a.dataset.page === page));
    const assistant = qs('#assistant-fab');
    if (assistant && assistant.tagName === 'A') assistant.href = cfg.assistantUrl || '#';
  }

  function initNav() {
    const headerInner = qs('.site-header-inner');
    const nav = qs('.nav');
    if (!headerInner || !nav) return;
    let toggle = qs('.nav-toggle', headerInner);
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'nav-toggle';
      toggle.setAttribute('aria-label', 'Toggle navigation');
      toggle.innerHTML = '<span></span><span></span><span></span>';
      headerInner.appendChild(toggle);
    }
    const closeNav = () => headerInner.classList.remove('nav-open');
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      headerInner.classList.toggle('nav-open');
    });
    qsa('a', nav).forEach(a => a.addEventListener('click', () => { if (window.innerWidth <= 980) closeNav(); }));
    document.addEventListener('click', (e) => {
      if (window.innerWidth > 980) return;
      if (!e.target.closest('.site-header-inner')) closeNav();
    });
    window.addEventListener('resize', () => { if (window.innerWidth > 980) closeNav(); });
  }

  function exportPDF(button, target, filename) {
    button.addEventListener('click', async () => {
      button.disabled = true; button.textContent = 'Exporting…';
      try {
        await html2pdf().set({ margin: 10, filename, image:{type:'jpeg',quality:.98}, html2canvas:{scale:2}, jsPDF:{unit:'mm',format:'a4',orientation:'portrait'} }).from(target).save();
      } finally { button.disabled = false; button.textContent = 'Export PDF'; }
    });
  }

  return {
    cfg, qs, qsa, fmtNum, fmt1, fmtPct, byDate, unique, getParam, setParam, todayRange,
    fetchJSON, showError, toneFromExperience, toneFromDiff, roleTone, renderStats, renderRanking,
    renderTable, renderCards, setSelect, setMulti, lineChart, barChart, scatterChart, map,
    groupSum, sum, avgWeighted, inRange, syncNav, initNav, exportPDF
  };
})();

document.addEventListener('DOMContentLoaded', () => { MMM.syncNav(); MMM.initNav(); });
