import {
  initBasePage, getSiteMeta, loadCSV, filterByDate, createMap, clearMapOverlays,
  toNum, asId, topN, shareRows, scaleRadius, movementColor, popupHTML, attachPopup,
  formatInt, formatPct, createChart, horizontalBarOption,
  metricCard, fillDateInputs, readDateInputs
} from "./common.js";

let map;
let meta;
const data = {};
const state = { range: null, selectedPoi: null, showAll: false };

function buildPoiLookup(rows) {
  return Object.fromEntries(rows.map((row) => [asId(row.poi_id), { ...row, poi_id: asId(row.poi_id), poi_lat: toNum(row.poi_lat), poi_lng: toNum(row.poi_lng), is_focal: toNum(row.is_focal) }]));
}

function aggregatePoiStats(range) {
  const rows = filterByDate(data.poiDaily, "video_date", range);
  const grouped = new Map();
  rows.forEach((row) => {
    const id = asId(row.poi_id);
    const base = data.poiLookup[id];
    if (!base) return;
    if (!grouped.has(id)) grouped.set(id, { poi_id: id, poi_name: row.poi_name || base.poi_name, poi_cate: row.poi_cate || base.poi_cate, poi_lat: base.poi_lat, poi_lng: base.poi_lng, is_focal: base.is_focal, visits: 0 });
    grouped.get(id).visits += toNum(row.journey_n);
  });
  return [...grouped.values()].filter((row) => row.visits > 0);
}

function aggregateFlows(range) {
  const rows = filterByDate(data.flowDaily, "video_date", range);
  const grouped = new Map();
  rows.forEach((row) => {
    const origin = asId(row.origin_poi_id), dest = asId(row.dest_poi_id);
    const key = `${origin}__${dest}`;
    if (!grouped.has(key)) grouped.set(key, { origin_poi_id: origin, origin_poi_name: row.origin_poi_name, dest_poi_id: dest, dest_poi_name: row.dest_poi_name, flow_n: 0 });
    grouped.get(key).flow_n += toNum(row.flow_n);
  });
  return [...grouped.values()].filter((row) => row.flow_n > 0);
}

function getDisplayedPois(poiAgg) {
  return (state.showAll ? poiAgg : poiAgg.filter((row) => row.is_focal === 1)).filter((row) => row.visits > 0);
}

function flowRowsForPlace(flows, placeId) {
  const inMap = new Map(), outMap = new Map(), allMap = new Map();
  flows.forEach((row) => {
    if (row.dest_poi_id === placeId) {
      const key = row.origin_poi_id;
      if (!inMap.has(key)) inMap.set(key, { poi_id: key, label: row.origin_poi_name, value: 0 });
      inMap.get(key).value += row.flow_n;
      if (!allMap.has(key)) allMap.set(key, { poi_id: key, label: row.origin_poi_name, value: 0 });
      allMap.get(key).value += row.flow_n;
    }
    if (row.origin_poi_id === placeId) {
      const key = row.dest_poi_id;
      if (!outMap.has(key)) outMap.set(key, { poi_id: key, label: row.dest_poi_name, value: 0 });
      outMap.get(key).value += row.flow_n;
      if (!allMap.has(key)) allMap.set(key, { poi_id: key, label: row.dest_poi_name, value: 0 });
      allMap.get(key).value += row.flow_n;
    }
  });
  return {
    inboundAll: [...inMap.values()].sort((a,b)=>b.value-a.value),
    outboundAll: [...outMap.values()].sort((a,b)=>b.value-a.value),
    connectedAll: [...allMap.values()].sort((a,b)=>b.value-a.value),
    inbound: shareRows([...inMap.values()].sort((a,b)=>b.value-a.value).slice(0,5), 'value'),
    outbound: shareRows([...outMap.values()].sort((a,b)=>b.value-a.value).slice(0,5), 'value'),
    connected: shareRows([...allMap.values()].sort((a,b)=>b.value-a.value).slice(0,5), 'value'),
  };
}

function drawCityMap(poiAgg) {
  clearMapOverlays(map);
  const displayed = getDisplayedPois(poiAgg);
  if (!displayed.length) return;
  const minVisit = Math.min(...displayed.map((row) => row.visits));
  const maxVisit = Math.max(...displayed.map((row) => row.visits));
  displayed.forEach((row) => {
    const color = movementColor(row.visits, minVisit, maxVisit);
    const marker = L.circleMarker([row.poi_lat, row.poi_lng], {
      radius: scaleRadius(row.visits, minVisit, maxVisit, 5, 15),
      color,
      fillColor: color,
      fillOpacity: 0.9,
      weight: 0,
    }).addTo(map).bindPopup(popupHTML({ title: row.poi_name, lines: [`Visits: ${formatInt(row.visits)}`, row.poi_cate] }), { autoPan: false });
    attachPopup(marker);
    marker.on('click', () => { state.selectedPoi = row.poi_id; render(); });
  });
}

function drawPlaceMap(poiAgg, flows, placeId) {
  clearMapOverlays(map);
  const lookup = Object.fromEntries(poiAgg.map((row) => [row.poi_id, row]));
  const place = lookup[placeId];
  if (!place) return drawCityMap(poiAgg);
  const displayed = getDisplayedPois(poiAgg);
  const flowRows = flowRowsForPlace(flows, placeId);
  const relatedIds = new Set([placeId, ...flowRows.inboundAll.map((r)=>r.poi_id), ...flowRows.outboundAll.map((r)=>r.poi_id)]);
  const markerRows = [...displayed.filter((row) => row.poi_id !== placeId), place, ...[...relatedIds].map((id) => lookup[id]).filter(Boolean)].filter((row, idx, arr) => arr.findIndex((r) => r.poi_id === row.poi_id) === idx);

  markerRows.forEach((row) => {
    const isMain = row.poi_id === placeId;
    const isRelated = relatedIds.has(row.poi_id);
    const fillColor = isMain ? '#ef4444' : isRelated ? '#94a3b8' : '#cbd5e1';
    const fillOpacity = isMain ? 0.95 : isRelated ? 0.85 : 0.72;
    const marker = L.circleMarker([row.poi_lat, row.poi_lng], {
      radius: isMain ? 14 : isRelated ? 8 : 5,
      color: fillColor,
      fillColor,
      fillOpacity,
      weight: 0,
    }).addTo(map).bindPopup(popupHTML({ title: row.poi_name, lines: [`Visits: ${formatInt(row.visits)}`, row.poi_cate] }), { autoPan: false });
    attachPopup(marker);
    marker.on('click', () => { state.selectedPoi = row.poi_id; render(); });
  });

  flowRows.inbound.slice(0, 5).forEach((row) => {
    const other = lookup[row.poi_id]; if (!other) return;
    L.polyline([[other.poi_lat, other.poi_lng], [place.poi_lat, place.poi_lng]], { color: '#16a34a', weight: 2 + row.share * 8, opacity: 0.68 }).addTo(map);
  });
  flowRows.outbound.slice(0, 5).forEach((row) => {
    const other = lookup[row.poi_id]; if (!other) return;
    L.polyline([[place.poi_lat, place.poi_lng], [other.poi_lat, other.poi_lng]], { color: '#f97316', weight: 2 + row.share * 8, opacity: 0.68 }).addTo(map);
  });
  map.panTo([place.poi_lat, place.poi_lng]);
}

function renderTitleBlock(poiAgg, flows) {
  const node = document.getElementById('movement-title-block');
  if (!state.selectedPoi) {
    const displayed = getDisplayedPois(poiAgg);
    const totalVisits = displayed.reduce((acc, row) => acc + row.visits, 0);
    const topCorridors = topN(flows.map((row) => ({ label: `${row.origin_poi_name} → ${row.dest_poi_name}`, value: row.flow_n })), 'value', 5);
    node.innerHTML = `
      <div class="sidebar-title-row"><div><h2>City overview</h2><div class="sidebar-title-meta">Visible movement patterns across the selected period.</div></div></div>
      <div class="metric-grid compact-3" style="margin-top:14px;">
        ${metricCard('Visits', formatInt(totalVisits), '', '◔')}
        ${metricCard(state.showAll ? 'Places shown' : 'Focal places shown', formatInt(displayed.length), '', '◎')}
        ${metricCard('Strong corridors', formatInt(topCorridors.length), '', '↔')}
      </div>`;
    return;
  }
  const place = poiAgg.find((row) => row.poi_id === state.selectedPoi);
  if (!place) return;
  const flowRows = flowRowsForPlace(flows, place.poi_id);
  const inboundShare = flowRows.inbound[0]?.share || 0;
  const outboundShare = flowRows.outbound[0]?.share || 0;
  node.innerHTML = `
    <div class="sidebar-title-row"><div><h2>${place.poi_name}</h2><div class="sidebar-title-meta">${place.poi_cate}</div></div></div>
    <div class="metric-grid compact-3" style="margin-top:14px;">
      ${metricCard('Visits', formatInt(place.visits), '', '◔')}
      ${metricCard('Connected places', formatInt(flowRows.connectedAll.length), '', '⇄')}
      ${metricCard('Inbound / outbound share', `${formatPct(inboundShare, 0)} / ${formatPct(outboundShare, 0)}`, '', '↔')}
    </div>`;
}

function renderCityModules(poiAgg, flows) {
  const displayed = getDisplayedPois(poiAgg);
  const topHotspots = shareRows(topN(displayed.map((row) => ({ label: row.poi_name, value: row.visits })), 'value', 5), 'value');
  const topCorridors = shareRows(topN(flows.map((row) => ({ label: `${row.origin_poi_name} → ${row.dest_poi_name}`, value: row.flow_n })), 'value', 5), 'value');
  document.getElementById('movement-module-overview').innerHTML = `
    <h3 class="module-section-title"><span class="module-icon">◎</span>Top hotspots</h3>
    <div id="movement-hotspot-chart" class="chart-box small"></div>
    <div class="chart-insight"><p>${topHotspots.length ? `${topHotspots[0].label} is the strongest hotspot in the current view. The top five hotspots together account for ${formatPct(topHotspots.reduce((acc, row) => acc + row.share, 0), 1)} of visible visits across the places currently shown on the map.` : `No hotspot pattern is visible in the selected period.`}</p></div>`;
  createChart('movement-hotspot-chart', horizontalBarOption({ rows: topHotspots, valueKey: 'share', percent: true, color: '#2563eb', maxRows: 5 }));
  document.getElementById('movement-module-inbound').innerHTML = `
    <h3 class="module-section-title"><span class="module-icon">↗</span>Strongest corridors</h3>
    <div id="movement-corridor-chart" class="chart-box small"></div>
    <div class="chart-insight"><p>${topCorridors.length ? `${topCorridors[0].label} is the strongest adjacent corridor in the selected period. The chart ranks the five most visible place-to-place links across the full movement table, not only the places currently highlighted on the map.` : `No corridor pattern is visible in the selected period.`}</p></div>`;
  createChart('movement-corridor-chart', horizontalBarOption({ rows: topCorridors, valueKey: 'share', percent: true, color: '#16a34a', maxRows: 5 }));
  document.getElementById('movement-module-outbound').innerHTML = '';
  document.getElementById('movement-module-connected').innerHTML = `<div class="chart-insight"><p>Click a place on the map to switch from city overview to place-level inbound, outbound, and connected-place detail.</p></div>`;
}

function renderPlaceModules(poiAgg, flows) {
  const place = poiAgg.find((row) => row.poi_id === state.selectedPoi);
  if (!place) return renderCityModules(poiAgg, flows);
  const flowRows = flowRowsForPlace(flows, place.poi_id);
  document.getElementById('movement-module-overview').innerHTML = `<div class="chart-insight"><p>${place.poi_name} records ${formatInt(place.visits)} visible visits in the selected period. The panels below show where movement into this place comes from, where it most often continues next, and which places are most strongly connected when inbound and outbound links are combined.</p></div>`;
  document.getElementById('movement-module-inbound').innerHTML = `
    <h3 class="module-section-title"><span class="module-icon">↓</span>Top inbound</h3>
    <div id="movement-inbound-chart" class="chart-box small"></div>
    <div class="chart-insight"><p>${flowRows.inbound.length ? `${flowRows.inbound[0].label} contributes the largest inbound share into ${place.poi_name}. This means it is the strongest visible feeder place in the selected period.` : `No inbound movement is visible for ${place.poi_name} in the selected period.`}</p></div>`;
  createChart('movement-inbound-chart', horizontalBarOption({ rows: flowRows.inbound, valueKey: 'share', percent: true, color: '#16a34a', maxRows: 5 }));
  document.getElementById('movement-module-outbound').innerHTML = `
    <h3 class="module-section-title"><span class="module-icon">↑</span>Top outbound</h3>
    <div id="movement-outbound-chart" class="chart-box small"></div>
    <div class="chart-insight"><p>${flowRows.outbound.length ? `${flowRows.outbound[0].label} is the strongest next visible stop after ${place.poi_name}. Shares are used here so the onward pattern remains readable even when one destination dominates in absolute size.` : `No outbound movement is visible for ${place.poi_name} in the selected period.`}</p></div>`;
  createChart('movement-outbound-chart', horizontalBarOption({ rows: flowRows.outbound, valueKey: 'share', percent: true, color: '#f97316', maxRows: 5 }));
  document.getElementById('movement-module-connected').innerHTML = `
    <h3 class="module-section-title"><span class="module-icon">⇄</span>Most connected places</h3>
    <div id="movement-connected-chart" class="chart-box small"></div>
    <div class="chart-insight"><p>${flowRows.connected.length ? `${flowRows.connected[0].label} is the most connected place around ${place.poi_name} when inbound and outbound links are read together. This reveals the strongest place-level movement relationship in the selected range.` : `No connected-place pattern is visible for ${place.poi_name} in the selected period.`}</p></div>`;
  createChart('movement-connected-chart', horizontalBarOption({ rows: flowRows.connected, valueKey: 'share', percent: true, color: '#2563eb', maxRows: 5 }));
}

function render() {
  const poiAgg = aggregatePoiStats(state.range);
  const flows = aggregateFlows(state.range);
  renderTitleBlock(poiAgg, flows);
  if (state.selectedPoi) drawPlaceMap(poiAgg, flows, state.selectedPoi); else drawCityMap(poiAgg);
  if (state.selectedPoi) renderPlaceModules(poiAgg, flows); else renderCityModules(poiAgg, flows);
}

function resetAll() {
  state.range = { start: String(meta.default_start_date), end: String(meta.default_end_date) };
  state.selectedPoi = null;
  state.showAll = false;
  fillDateInputs('movement-start-date', 'movement-end-date', state.range);
  document.getElementById('movement-show-all').checked = false;
  render();
}

async function main() {
  initBasePage('movement');
  meta = await getSiteMeta();
  state.range = { start: String(meta.default_start_date), end: String(meta.default_end_date) };
  data.poiMaster = await loadCSV('./data/master/poi_master.csv');
  data.poiLookup = buildPoiLookup(data.poiMaster);
  [data.poiDaily, data.flowDaily] = await Promise.all([
    loadCSV('./data/summary/poi_daily.csv'),
    loadCSV('./data/summary/flow_daily.csv'),
  ]);
  map = createMap('movement-map');
  fillDateInputs('movement-start-date', 'movement-end-date', state.range);
  document.getElementById('movement-start-date').addEventListener('change', () => { state.range = readDateInputs('movement-start-date', 'movement-end-date'); render(); });
  document.getElementById('movement-end-date').addEventListener('change', () => { state.range = readDateInputs('movement-start-date', 'movement-end-date'); render(); });
  document.getElementById('movement-show-all').addEventListener('change', (event) => { state.showAll = event.target.checked; state.selectedPoi = null; render(); });
  document.getElementById('movement-reset').addEventListener('click', resetAll);
  render();
}

main().catch((error) => {
  console.error(error);
  document.getElementById('movement-title-block').innerHTML = `<div class="empty-state">Unable to load movement data. Check the files in <code>data/</code> and open the browser console for details.</div>`;
});
