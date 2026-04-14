import {
  initBasePage, getSiteMeta, loadCSV, filterByDate, fillDateInputs, readDateInputs,
  asId, toNum, topN, shareRows, createChart, horizontalBarOption, formatPct,
  createMap, clearMapOverlays, popupHTML, attachPopup
} from './common.js';

let meta;
let companionMap;
const data = {};
const state = { range: null, focalPoi: '' };

function buildPoiLookup(rows) {
  return Object.fromEntries(rows.map((row) => [asId(row.poi_id), { ...row, poi_id: asId(row.poi_id), poi_lat: toNum(row.poi_lat), poi_lng: toNum(row.poi_lng) }]));
}
function fillFocalOptions() {
  const rows = [...data.placeIndex].map((row) => ({ id: asId(row.poi_id), name: row.poi_name })).sort((a,b)=>a.name.localeCompare(b.name, 'en', { sensitivity:'base' }));
  data.sortedPlaces = rows;
  document.getElementById('comb-focal-options').innerHTML = rows.map((row) => `<option value="${row.name}"></option>`).join('');
}
function resolvePoiByName(name) { const match = data.sortedPlaces.find((row) => row.name.toLowerCase() === String(name || '').trim().toLowerCase()); return match ? match.id : ''; }
function aggregateCooccur(range) {
  const rows = filterByDate(data.cooccurDaily, 'video_date', range);
  const grouped = new Map();
  rows.forEach((row) => {
    const a = asId(row.poi_a_id), b = asId(row.poi_b_id); const key = `${a}__${b}`;
    if (!grouped.has(key)) grouped.set(key, { poi_a_id: a, poi_a_name: row.poi_a_name, poi_b_id: b, poi_b_name: row.poi_b_name, cooccur_n: 0, weighted_sentiment_sum: 0 });
    const agg = grouped.get(key); agg.cooccur_n += toNum(row.cooccur_n); agg.weighted_sentiment_sum += toNum(row.avg_journey_sentiment) * Math.max(1, toNum(row.cooccur_n));
  });
  return [...grouped.values()].map((row) => ({ ...row, avg_journey_sentiment: row.cooccur_n ? row.weighted_sentiment_sum / row.cooccur_n : 0 }));
}
function aggregateOrdered(range) {
  const rows = filterByDate(data.flowDaily, 'video_date', range);
  const grouped = new Map();
  rows.forEach((row) => {
    const o = asId(row.origin_poi_id), d = asId(row.dest_poi_id); const key = `${o}__${d}`;
    if (!grouped.has(key)) grouped.set(key, { origin_poi_id: o, origin_poi_name: row.origin_poi_name, dest_poi_id: d, dest_poi_name: row.dest_poi_name, flow_n: 0 });
    grouped.get(key).flow_n += toNum(row.flow_n);
  });
  return [...grouped.values()];
}
function drawMap(focalId, orderedAgg, companions) {
  if (!focalId) return;
  const focal = data.poiLookup[focalId]; if (!focal) return;
  if (!companionMap) companionMap = createMap('comb-companion-map');
  clearMapOverlays(companionMap);
  const inbound = topN(orderedAgg.filter((row) => row.dest_poi_id === focalId).map((row) => ({ poi_id: row.origin_poi_id, label: row.origin_poi_name, value: row.flow_n })), 'value', 5);
  const outbound = topN(orderedAgg.filter((row) => row.origin_poi_id === focalId).map((row) => ({ poi_id: row.dest_poi_id, label: row.dest_poi_name, value: row.flow_n })), 'value', 5);
  const focalMarker = L.circleMarker([focal.poi_lat, focal.poi_lng], { radius: 14, color:'#ef4444', fillColor:'#ef4444', fillOpacity:0.95, weight:0 }).addTo(companionMap).bindPopup(popupHTML({ title: focal.poi_name, lines:[focal.poi_cate] }), { autoPan:false });
  attachPopup(focalMarker);
  const ids = new Set([...companions.slice(0,10).map((r)=>r.poi_id), ...inbound.map((r)=>r.poi_id), ...outbound.map((r)=>r.poi_id)]);
  [...ids].forEach((id) => {
    const poi = data.poiLookup[id]; if (!poi) return;
    const marker = L.circleMarker([poi.poi_lat, poi.poi_lng], { radius: 8, color:'#94a3b8', fillColor:'#94a3b8', fillOpacity:0.86, weight:0 }).addTo(companionMap).bindPopup(popupHTML({ title: poi.poi_name, lines:[poi.poi_cate] }), { autoPan:false });
    attachPopup(marker);
  });
  inbound.forEach((row) => { const poi = data.poiLookup[row.poi_id]; if (poi) L.polyline([[poi.poi_lat, poi.poi_lng],[focal.poi_lat, focal.poi_lng]], { color:'#16a34a', weight:2.2, opacity:0.7 }).addTo(companionMap); });
  outbound.forEach((row) => { const poi = data.poiLookup[row.poi_id]; if (poi) L.polyline([[focal.poi_lat, focal.poi_lng],[poi.poi_lat, poi.poi_lng]], { color:'#f97316', weight:2.2, opacity:0.7 }).addTo(companionMap); });
  companionMap.panTo([focal.poi_lat, focal.poi_lng]);
}
function renderCompanionSection(cooccurAgg, orderedAgg) {
  if (!state.focalPoi) {
    const topPairs = shareRows(topN(cooccurAgg.map((row) => ({ label: `${row.poi_a_name} + ${row.poi_b_name}`, value: row.cooccur_n })), 'value', 10), 'value');
    document.getElementById('comb-companion-section').innerHTML = `<div class="report-section-header"><div><h2><span class="module-icon">⇄</span>Companion places</h2><p>Companion places appear within the same journey, regardless of order.</p></div></div><div class="report-body stack"><div class="report-chart-stack"><div id="comb-city-companion-chart" class="chart-box tall"></div><div class="chart-insight"><p>${topPairs.length ? `${topPairs[0].label} is the strongest companion pair in the current city view.` : `No companion-place data is available for the selected period.`}</p></div></div></div>`;
    createChart('comb-city-companion-chart', horizontalBarOption({ rows: topPairs, valueKey: 'share', percent: true, color: '#2563eb', maxRows: 10, labelMax: 18 }));
  } else {
    const focal = data.poiLookup[state.focalPoi];
    const rows = cooccurAgg.filter((row) => row.poi_a_id === state.focalPoi || row.poi_b_id === state.focalPoi).map((row) => ({ poi_id: row.poi_a_id === state.focalPoi ? row.poi_b_id : row.poi_a_id, label: row.poi_a_id === state.focalPoi ? row.poi_b_name : row.poi_a_name, value: row.cooccur_n }));
    const topRows = shareRows(topN(rows, 'value', 10), 'value');
    document.getElementById('comb-companion-section').innerHTML = `<div class="report-section-header"><div><h2><span class="module-icon">⇄</span>Companion places</h2><p>${focal.poi_name} is used as the focal place. The chart shows which places most often appear alongside it in the same journey.</p></div></div><div class="report-body"><div class="report-chart-stack"><div id="comb-focal-companion-chart" class="chart-box tall"></div><div class="chart-insight"><p>${topRows.length ? `${topRows[0].label} is the strongest companion place for ${focal.poi_name} in the selected period.` : `No companion-place pattern is visible for ${focal.poi_name} in the selected period.`}</p></div></div><div class="report-note-stack"><div id="comb-companion-map" class="mini-map"></div><div class="chart-insight"><p>This map highlights the focal place and its strongest companion, inbound, and outbound links.</p></div></div></div>`;
    createChart('comb-focal-companion-chart', horizontalBarOption({ rows: topRows, valueKey: 'share', percent: true, color: '#2563eb', maxRows: 10, labelMax: 18 }));
    drawMap(state.focalPoi, orderedAgg, topRows);
  }
}
function renderOrderedSection(orderedAgg) {
  let rows, titleText, introText;
  if (state.focalPoi) {
    const focal = data.poiLookup[state.focalPoi];
    rows = orderedAgg.filter((row) => row.origin_poi_id === state.focalPoi || row.dest_poi_id === state.focalPoi).map((row) => ({ label: `${row.origin_poi_name} → ${row.dest_poi_name}`, value: row.flow_n }));
    titleText = `Ordered links around ${focal.poi_name}`;
    introText = `${focal.poi_name} is used as the focal place here. Ordered links preserve adjacent sequence rather than simple co-occurrence.`;
  } else {
    rows = orderedAgg.map((row) => ({ label: `${row.origin_poi_name} → ${row.dest_poi_name}`, value: row.flow_n }));
    titleText = 'Ordered links';
    introText = 'Ordered links show adjacent movement sequence across the selected period.';
  }
  const topRows = shareRows(topN(rows, 'value', 10), 'value');
  let html = `<div class="report-section-header"><div><h2><span class="module-icon">→</span>${titleText}</h2><p>${introText}</p></div></div><div class="report-body stack"><div class="report-chart-stack"><div id="comb-ordered-chart" class="chart-box tall"></div><div class="chart-insight"><p>${topRows.length ? `${topRows[0].label} is the strongest ordered link in the current view.` : `No ordered-link pattern is available for the selected period.`}</p></div></div></div>`;
  document.getElementById('comb-ordered-section').innerHTML = html;
  createChart('comb-ordered-chart', horizontalBarOption({ rows: topRows, valueKey: 'share', percent: true, color: '#f97316', maxRows: 10, labelMax: 18 }));
  if (state.focalPoi) {
    const inbound = shareRows(topN(orderedAgg.filter((row)=>row.dest_poi_id===state.focalPoi).map((row)=>({ label: row.origin_poi_name, value: row.flow_n })), 'value', 5), 'value');
    const outbound = shareRows(topN(orderedAgg.filter((row)=>row.origin_poi_id===state.focalPoi).map((row)=>({ label: row.dest_poi_name, value: row.flow_n })), 'value', 5), 'value');
    document.getElementById('comb-ordered-section').innerHTML += `<div class="subsection-grid" style="margin-top:20px;"><div class="subsection-card"><h3 class="module-section-title"><span class="module-icon">↓</span>Top inbound</h3><div id="comb-top-inbound-chart" class="chart-box small"></div><div class="chart-insight"><p>${inbound.length ? `${inbound[0].label} is the strongest inbound link around the focal place.` : `No inbound pattern is visible for the focal place.`}</p></div></div><div class="subsection-card"><h3 class="module-section-title"><span class="module-icon">↑</span>Top outbound</h3><div id="comb-top-outbound-chart" class="chart-box small"></div><div class="chart-insight"><p>${outbound.length ? `${outbound[0].label} is the strongest outbound link around the focal place.` : `No outbound pattern is visible for the focal place.`}</p></div></div></div>`;
    createChart('comb-top-inbound-chart', horizontalBarOption({ rows: inbound, valueKey: 'share', percent: true, color: '#16a34a', maxRows: 5, labelMax: 18 }));
    createChart('comb-top-outbound-chart', horizontalBarOption({ rows: outbound, valueKey: 'share', percent: true, color: '#f97316', maxRows: 5, labelMax: 18 }));
  }
}
function render() { const cooccurAgg = aggregateCooccur(state.range); const orderedAgg = aggregateOrdered(state.range); renderCompanionSection(cooccurAgg, orderedAgg); renderOrderedSection(orderedAgg); }
function resetAll() { state.range = { start: String(meta.default_start_date), end: String(meta.default_end_date) }; state.focalPoi = ''; fillDateInputs('comb-start-date', 'comb-end-date', state.range); document.getElementById('comb-focal-input').value = ''; render(); }
async function main() {
  initBasePage('combinations');
  meta = await getSiteMeta();
  state.range = { start: String(meta.default_start_date), end: String(meta.default_end_date) };
  [data.placeIndex, data.cooccurDaily, data.flowDaily, data.poiMaster] = await Promise.all([
    loadCSV('./data/report/place_report_index.csv'),
    loadCSV('./data/summary/cooccur_daily.csv'),
    loadCSV('./data/summary/flow_daily.csv'),
    loadCSV('./data/master/poi_master.csv'),
  ]);
  data.poiLookup = buildPoiLookup(data.poiMaster);
  fillFocalOptions();
  fillDateInputs('comb-start-date', 'comb-end-date', state.range);
  document.getElementById('comb-focal-input').addEventListener('change', (event) => { state.focalPoi = resolvePoiByName(event.target.value); render(); });
  document.getElementById('comb-start-date').addEventListener('change', () => { state.range = readDateInputs('comb-start-date', 'comb-end-date'); render(); });
  document.getElementById('comb-end-date').addEventListener('change', () => { state.range = readDateInputs('comb-start-date', 'comb-end-date'); render(); });
  document.getElementById('comb-reset').addEventListener('click', resetAll);
  render();
}
main().catch((error) => { console.error(error); document.getElementById('comb-companion-section').innerHTML = `<div class="empty-state">Unable to load combinations data. Check the files in <code>data/</code> and the browser console for details.</div>`; });
