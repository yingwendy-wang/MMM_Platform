import {
  initBasePage, getSiteMeta, loadCSV, filterByDate, createMap, clearMapOverlays,
  toNum, asId, topN, shareRows, scaleRadius, sentimentColor, popupHTML, attachPopup,
  formatInt, formatSentiment, createChart, horizontalBarOption,
  lineOption, metricCard, fillDateInputs, readDateInputs, aggregateSeriesByPeriod
} from "./common.js";

let map;
let meta;
const data = {};
const state = { range: null, selectedPoi: null, showAll: false, trendScale: 'weekly' };

function buildPoiLookup(rows) {
  return Object.fromEntries(rows.map((row) => [asId(row.poi_id), { ...row, poi_id: asId(row.poi_id), poi_lat: toNum(row.poi_lat), poi_lng: toNum(row.poi_lng), is_focal: toNum(row.is_focal) }]));
}

function aggregatePoiStats(range) {
  const rows = filterByDate(data.poiDaily, 'video_date', range);
  const grouped = new Map();
  rows.forEach((row) => {
    const id = asId(row.poi_id); const base = data.poiLookup[id]; if (!base) return;
    if (!grouped.has(id)) grouped.set(id, { poi_id: id, poi_name: row.poi_name || base.poi_name, poi_cate: row.poi_cate || base.poi_cate, poi_lat: base.poi_lat, poi_lng: base.poi_lng, is_focal: base.is_focal, visits: 0, weighted_sentiment_sum: 0 });
    const agg = grouped.get(id); const visits = toNum(row.journey_n); agg.visits += visits; agg.weighted_sentiment_sum += toNum(row.avg_stop_sentiment) * Math.max(1, visits);
  });
  return [...grouped.values()].map((row) => ({ ...row, avg_sentiment: row.visits ? row.weighted_sentiment_sum / row.visits : 0 })).filter((row) => row.visits > 0);
}

function aggregateMarketStats(range) {
  const rows = filterByDate(data.poiMarketDaily, 'video_date', range);
  const grouped = new Map();
  rows.forEach((row) => {
    const key = `${asId(row.poi_id)}__${row.author_region}`;
    if (!grouped.has(key)) grouped.set(key, { poi_id: asId(row.poi_id), author_region: row.author_region, visits: 0, weighted_sentiment_sum: 0 });
    const agg = grouped.get(key); const visits = toNum(row.journey_n); agg.visits += visits; agg.weighted_sentiment_sum += toNum(row.avg_stop_sentiment) * Math.max(1, visits);
  });
  return [...grouped.values()].map((row) => ({ ...row, avg_sentiment: row.visits ? row.weighted_sentiment_sum / row.visits : 0 }));
}

function aggregateCooccurrence(range) {
  const rows = filterByDate(data.cooccurDaily, 'video_date', range);
  const grouped = new Map();
  rows.forEach((row) => {
    const a = asId(row.poi_a_id), b = asId(row.poi_b_id); const key = `${a}__${b}`;
    if (!grouped.has(key)) grouped.set(key, { poi_a_id: a, poi_a_name: row.poi_a_name, poi_b_id: b, poi_b_name: row.poi_b_name, cooccur_n: 0, weighted_sentiment_sum: 0 });
    const agg = grouped.get(key); const count = toNum(row.cooccur_n); agg.cooccur_n += count; agg.weighted_sentiment_sum += toNum(row.avg_journey_sentiment) * Math.max(1, count);
  });
  return [...grouped.values()].map((row) => ({ ...row, avg_journey_sentiment: row.cooccur_n ? row.weighted_sentiment_sum / row.cooccur_n : 0 })).filter((row)=>row.cooccur_n>0);
}

const getDisplayedPois = (poiAgg) => (state.showAll ? poiAgg : poiAgg.filter((row) => row.is_focal === 1)).filter((row) => row.visits > 0);

function getPlaceCombinations(placeId, poiAgg, cooccurAgg) {
  const place = poiAgg.find((row) => row.poi_id === placeId); if (!place) return { positive: [], negative: [] };
  const rows = cooccurAgg.filter((row) => row.poi_a_id === placeId || row.poi_b_id === placeId).map((row) => ({ poi_id: row.poi_a_id === placeId ? row.poi_b_id : row.poi_a_id, label: row.poi_a_id === placeId ? row.poi_b_name : row.poi_a_name, value: row.cooccur_n, delta: row.avg_journey_sentiment - place.avg_sentiment }));
  return { positive: rows.filter((row) => row.delta > 0).sort((a,b)=>b.delta-a.delta).slice(0,5), negative: rows.filter((row)=>row.delta<0).sort((a,b)=>a.delta-b.delta).slice(0,5) };
}

function drawCityMap(poiAgg) {
  clearMapOverlays(map);
  const displayed = getDisplayedPois(poiAgg); if (!displayed.length) return;
  const minVisit = Math.min(...displayed.map((row) => row.visits)); const maxVisit = Math.max(...displayed.map((row) => row.visits));
  displayed.forEach((row) => {
    const color = sentimentColor(row.avg_sentiment, 0, 1);
    const marker = L.circleMarker([row.poi_lat, row.poi_lng], { radius: scaleRadius(row.visits, minVisit, maxVisit, 5, 15), color, fillColor: color, fillOpacity: 0.9, weight: 0 }).addTo(map).bindPopup(popupHTML({ title: row.poi_name, lines: [`Sentiment: ${formatSentiment(row.avg_sentiment)}`, `Visits: ${formatInt(row.visits)}`] }), { autoPan: false });
    attachPopup(marker); marker.on('click', () => { state.selectedPoi = row.poi_id; render(); });
  });
}

function drawPlaceMap(poiAgg, cooccurAgg, placeId) {
  clearMapOverlays(map);
  const displayed = getDisplayedPois(poiAgg);
  const lookup = Object.fromEntries(poiAgg.map((row) => [row.poi_id, row]));
  const place = lookup[placeId]; if (!place) return drawCityMap(poiAgg);
  const combos = getPlaceCombinations(placeId, poiAgg, cooccurAgg);
  const positiveIds = new Set(combos.positive.map((row) => row.poi_id));
  const negativeIds = new Set(combos.negative.map((row) => row.poi_id));
  const markerRows = [...displayed.filter((row) => row.poi_id !== placeId), place, ...[...positiveIds, ...negativeIds].map((id) => lookup[id]).filter(Boolean)].filter((row, idx, arr) => arr.findIndex((r) => r.poi_id === row.poi_id) === idx);
  markerRows.forEach((row) => {
    const isMain = row.poi_id === placeId;
    const color = isMain ? '#2563eb' : positiveIds.has(row.poi_id) ? '#1f9d55' : negativeIds.has(row.poi_id) ? '#d14343' : '#cbd5e1';
    const fillOpacity = isMain ? 0.96 : (positiveIds.has(row.poi_id) || negativeIds.has(row.poi_id)) ? 0.86 : 0.72;
    const marker = L.circleMarker([row.poi_lat, row.poi_lng], { radius: isMain ? 14 : (positiveIds.has(row.poi_id) || negativeIds.has(row.poi_id)) ? 8 : 5, color, fillColor: color, fillOpacity, weight: 0 }).addTo(map).bindPopup(popupHTML({ title: row.poi_name, lines: [`Sentiment: ${formatSentiment(row.avg_sentiment)}`, `Visits: ${formatInt(row.visits)}`] }), { autoPan: false });
    attachPopup(marker); marker.on('click', () => { state.selectedPoi = row.poi_id; render(); });
  });
  map.panTo([place.poi_lat, place.poi_lng]);
}

function renderTitleBlock(poiAgg, cooccurAgg) {
  const node = document.getElementById('sentiment-title-block');
  if (!state.selectedPoi) {
    const displayed = getDisplayedPois(poiAgg); const totalVisits = displayed.reduce((acc,row)=>acc+row.visits,0); const avgSent = totalVisits ? displayed.reduce((acc,row)=>acc+row.avg_sentiment*row.visits,0)/totalVisits : 0;
    node.innerHTML = `<div class="sidebar-title-row"><div><h2>City overview</h2><div class="sidebar-title-meta">Visible place-level experience across the selected period.</div></div></div><div class="metric-grid compact-3" style="margin-top:14px;">${metricCard('Visits', formatInt(totalVisits), '', '◔')}${metricCard(state.showAll ? 'Places shown' : 'Focal places shown', formatInt(displayed.length), '', '◎')}${metricCard('Avg sentiment', formatSentiment(avgSent), '', '↗')}</div>`;
    return;
  }
  const place = poiAgg.find((row)=>row.poi_id===state.selectedPoi); if (!place) return;
  const combos = getPlaceCombinations(place.poi_id, poiAgg, cooccurAgg);
  node.innerHTML = `<div class="sidebar-title-row"><div><h2>${place.poi_name}</h2><div class="sidebar-title-meta">${place.poi_cate}</div></div></div><div class="metric-grid compact-3" style="margin-top:14px;">${metricCard('Visits', formatInt(place.visits), '', '◔')}${metricCard('Avg sentiment', formatSentiment(place.avg_sentiment), '', '↗')}${metricCard('Positive / negative combinations', `${formatInt(combos.positive.length)} / ${formatInt(combos.negative.length)}`, '', '⇄')}</div>`;
}

function renderCityOverview(poiAgg, marketAgg) {
  const displayed = getDisplayedPois(poiAgg);
  const best = topN(displayed.map((row) => ({ label: row.poi_name, value: row.avg_sentiment })), 'value', 5);
  const low = [...displayed].sort((a,b)=>a.avg_sentiment-b.avg_sentiment).slice(0,5).map((row)=>({ label: row.poi_name, value: row.avg_sentiment }));
  const marketMap = new Map();
  marketAgg.forEach((row) => { if (!marketMap.has(row.author_region)) marketMap.set(row.author_region, { label: row.author_region, value: 0 }); marketMap.get(row.author_region).value += row.visits; });
  const cityMarkets = shareRows(topN([...marketMap.values()], 'value', 10), 'value');
  document.getElementById('sentiment-module-overview').innerHTML = `<h3 class="module-section-title"><span class="module-icon">◎</span>Higher-scoring places</h3><div id="sentiment-top-chart" class="chart-box small"></div><div class="chart-insight"><p>${best.length ? `${best[0].label} sits at the strongest end of the visible focal-place sentiment range in the selected period.` : `No place-level sentiment data is visible in the selected period.`}</p></div>`;
  createChart('sentiment-top-chart', horizontalBarOption({ rows: best, valueKey: 'value', color: '#1f9d55', valueFormatter: (v) => formatSentiment(v), maxRows: 5 }));
  document.getElementById('sentiment-module-trend').innerHTML = `<h3 class="module-section-title"><span class="module-icon">◎</span>Lower-scoring places</h3><div id="sentiment-low-chart" class="chart-box small"></div><div class="chart-insight"><p>${low.length ? `${low[0].label} sits at the weaker end of the visible focal-place sentiment range in the selected period.` : `No lower-scoring place is visible in the selected period.`}</p></div>`;
  createChart('sentiment-low-chart', horizontalBarOption({ rows: low, valueKey: 'value', color: '#d14343', valueFormatter: (v) => formatSentiment(v), maxRows: 5 }));
  document.getElementById('sentiment-module-market-share').innerHTML = `<h3 class="module-section-title"><span class="module-icon">▤</span>Source market share</h3><div id="sentiment-market-city-chart" class="chart-box tall"></div><div class="chart-insight"><p>${cityMarkets.length ? `${cityMarkets[0].label} contributes the largest visible source-market share in the current city view.` : `No source-market pattern is visible in the selected period.`}</p></div>`;
  createChart('sentiment-market-city-chart', horizontalBarOption({ rows: cityMarkets, valueKey: 'share', percent: true, color: '#2563eb', maxRows: 10, labelMax: 12 }));
  document.getElementById('sentiment-module-market-sentiment').innerHTML = `<div class="chart-insight"><p>Click a place on the map to replace this city summary with place-level trend, market, and combination detail.</p></div>`;
  document.getElementById('sentiment-module-combinations').innerHTML = ``;
}

function renderPlaceModules(poiAgg, marketAgg, cooccurAgg) {
  const place = poiAgg.find((row)=>row.poi_id===state.selectedPoi); if (!place) return renderCityOverview(poiAgg, marketAgg);
  const placeDaily = filterByDate(data.poiDaily, 'video_date', state.range).filter((row)=>asId(row.poi_id)===place.poi_id).map((row)=>({ ...row, sentiment: toNum(row.avg_stop_sentiment), visits: toNum(row.journey_n) }));
  const trendRows = aggregateSeriesByPeriod(placeDaily, 'video_date', 'sentiment', state.trendScale, true, 'visits');
  document.getElementById('sentiment-module-overview').innerHTML = `<div class="chart-insight"><p>${place.poi_name} records ${formatInt(place.visits)} visible visits and an average sentiment of ${formatSentiment(place.avg_sentiment)} in the selected period. On the map, places associated with stronger joint sentiment are highlighted in green, while places associated with weaker joint sentiment are highlighted in red.</p></div>`;
  document.getElementById('sentiment-module-trend').innerHTML = `<div class="module-head-inline"><h3 class="module-section-title"><span class="module-icon">∿</span>Sentiment over time</h3><select id="sentiment-trend-scale"><option value="daily" ${state.trendScale==='daily'?'selected':''}>Daily</option><option value="weekly" ${state.trendScale==='weekly'?'selected':''}>Weekly</option><option value="monthly" ${state.trendScale==='monthly'?'selected':''}>Monthly</option></select></div><div id="sentiment-trend-chart" class="chart-box small"></div><div class="chart-insight"><p>${trendRows.length ? `This chart shows how ${place.poi_name}'s average sentiment changes through the selected period. The current view is aggregated by ${state.trendScale}.` : `No sentiment time series is available for ${place.poi_name} in the selected period.`}</p></div>`;
  createChart('sentiment-trend-chart', lineOption({ dates: trendRows.map((row)=>row.date), series:[{ name: place.poi_name, data: trendRows.map((row)=>row.value), color:'#2563eb' }], valueFormatter:(v)=>formatSentiment(v) }));
  document.getElementById('sentiment-trend-scale')?.addEventListener('change', (event) => { state.trendScale = event.target.value; render(); });

  const marketRows = marketAgg.filter((row)=>row.poi_id===place.poi_id);
  const groupedMarkets = new Map();
  marketRows.forEach((row) => { if (!groupedMarkets.has(row.author_region)) groupedMarkets.set(row.author_region, { label: row.author_region, visits: 0, weighted_sentiment_sum: 0 }); const agg = groupedMarkets.get(row.author_region); agg.visits += row.visits; agg.weighted_sentiment_sum += row.avg_sentiment * Math.max(1, row.visits); });
  const markets = [...groupedMarkets.values()].map((row)=>({ label: row.label, visits: row.visits, avg_sentiment: row.visits ? row.weighted_sentiment_sum / row.visits : 0 })).sort((a,b)=>b.visits-a.visits);
  const topVisitMarkets = markets.slice(0,10);
  const marketShare = shareRows(topVisitMarkets.map((row)=>({ label: row.label, value: row.visits })), 'value');
  const marketSent = [...topVisitMarkets].sort((a,b)=>b.avg_sentiment-a.avg_sentiment).map((row)=>({ label: row.label, value: row.avg_sentiment }));
  document.getElementById('sentiment-module-market-share').innerHTML = `<h3 class="module-section-title"><span class="module-icon">▤</span>Source market share</h3><div id="sentiment-market-share-chart" class="chart-box tall"></div><div class="chart-insight"><p>${marketShare.length ? `${marketShare[0].label} contributes the largest visible market share for ${place.poi_name}. Shares are shown here so smaller markets remain readable even when one market dominates in volume.` : `No source-market pattern is visible for ${place.poi_name} in the selected period.`}</p></div>`;
  createChart('sentiment-market-share-chart', horizontalBarOption({ rows: marketShare, valueKey: 'share', percent: true, color: '#2563eb', maxRows: 10, labelMax: 12 }));
  document.getElementById('sentiment-module-market-sentiment').innerHTML = `<h3 class="module-section-title"><span class="module-icon">▤</span>Source market sentiment</h3><div id="sentiment-market-sentiment-chart" class="chart-box tall"></div><div class="chart-insight"><p>${marketSent.length ? `This chart compares average sentiment across the ten largest visible source markets for ${place.poi_name}, sorted from higher to lower sentiment.` : `No source-market sentiment comparison is visible for ${place.poi_name} in the selected period.`}</p></div>`;
  createChart('sentiment-market-sentiment-chart', horizontalBarOption({ rows: marketSent, valueKey: 'value', color: '#1f9d55', valueFormatter:(v)=>formatSentiment(v), maxRows:10, labelMax:12 }));
  const combos = getPlaceCombinations(place.poi_id, poiAgg, cooccurAgg);
  document.getElementById('sentiment-module-combinations').innerHTML = `<h3 class="module-section-title"><span class="module-icon">⇄</span>Combinations</h3><div id="sentiment-positive-combo-chart" class="chart-box small"></div><div class="chart-insight"><p>${combos.positive.length ? `${combos.positive[0].label} is the clearest higher-sentiment companion place for ${place.poi_name} in the selected period.` : `No higher-sentiment companion place is visible for ${place.poi_name} in the selected period.`}</p></div><div id="sentiment-negative-combo-chart" class="chart-box small" style="margin-top:18px;"></div><div class="chart-insight"><p>${combos.negative.length ? `${combos.negative[0].label} is the clearest lower-sentiment companion place for ${place.poi_name} in the selected period.` : `No lower-sentiment companion place is visible for ${place.poi_name} in the selected period.`}</p></div>`;
  createChart('sentiment-positive-combo-chart', horizontalBarOption({ rows: combos.positive.map((row)=>({ label: row.label, value: Math.max(0,row.delta) })), valueKey:'value', color:'#1f9d55', valueFormatter:(v)=>formatSentiment(v), maxRows:5 }));
  createChart('sentiment-negative-combo-chart', horizontalBarOption({ rows: combos.negative.map((row)=>({ label: row.label, value: Math.abs(row.delta) })), valueKey:'value', color:'#d14343', valueFormatter:(v)=>formatSentiment(v), maxRows:5 }));
}

function render() {
  const poiAgg = aggregatePoiStats(state.range);
  const marketAgg = aggregateMarketStats(state.range);
  const cooccurAgg = aggregateCooccurrence(state.range);
  renderTitleBlock(poiAgg, cooccurAgg);
  if (state.selectedPoi) drawPlaceMap(poiAgg, cooccurAgg, state.selectedPoi); else drawCityMap(poiAgg);
  if (state.selectedPoi) renderPlaceModules(poiAgg, marketAgg, cooccurAgg); else renderCityOverview(poiAgg, marketAgg);
}

function resetAll() {
  state.range = { start: String(meta.default_start_date), end: String(meta.default_end_date) };
  state.selectedPoi = null; state.showAll = false; state.trendScale = 'weekly';
  fillDateInputs('sentiment-start-date', 'sentiment-end-date', state.range);
  document.getElementById('sentiment-show-all').checked = false;
  render();
}

async function main() {
  initBasePage('sentiment');
  meta = await getSiteMeta();
  state.range = { start: String(meta.default_start_date), end: String(meta.default_end_date) };
  data.poiMaster = await loadCSV('./data/master/poi_master.csv');
  data.poiLookup = buildPoiLookup(data.poiMaster);
  [data.poiDaily, data.poiMarketDaily, data.cooccurDaily] = await Promise.all([
    loadCSV('./data/summary/poi_daily.csv'),
    loadCSV('./data/summary/poi_market_daily.csv'),
    loadCSV('./data/summary/cooccur_daily.csv'),
  ]);
  map = createMap('sentiment-map');
  fillDateInputs('sentiment-start-date', 'sentiment-end-date', state.range);
  document.getElementById('sentiment-start-date').addEventListener('change', () => { state.range = readDateInputs('sentiment-start-date', 'sentiment-end-date'); render(); });
  document.getElementById('sentiment-end-date').addEventListener('change', () => { state.range = readDateInputs('sentiment-start-date', 'sentiment-end-date'); render(); });
  document.getElementById('sentiment-show-all').addEventListener('change', (event) => { state.showAll = event.target.checked; state.selectedPoi = null; render(); });
  document.getElementById('sentiment-reset').addEventListener('click', resetAll);
  render();
}

main().catch((error) => {
  console.error(error);
  document.getElementById('sentiment-title-block').innerHTML = `<div class="empty-state">Unable to load sentiment data. Check the files inside <code>data/</code> and the browser console for details.</div>`;
});
