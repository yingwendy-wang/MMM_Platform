import {
  initBasePage, getSiteMeta, loadCSV, filterByDate, toNum, asId,
  formatInt, formatSentiment, formatPct, fillDateInputs, readDateInputs,
  createChart, lineOption, groupedBarOption, horizontalBarOption,
  metricCard, getChart, aggregateSeriesByPeriod
} from './common.js';

let meta;
const data = {};
const palette = ['#2563eb', '#0f766e', '#f97316', '#8b5cf6'];
const state = { range: null, focalPoi: '', comparePois: [], exportNotes: {} };

function buildPoiLookup(rows) { return Object.fromEntries(rows.map((row) => [asId(row.poi_id), { ...row, poi_id: asId(row.poi_id) }])); }
function sortPlacesAlpha(rows) { return [...rows].sort((a,b)=>String(a.poi_name).localeCompare(String(b.poi_name), 'en', { sensitivity:'base' })); }
function seriesIds() { return [state.focalPoi, ...state.comparePois].filter(Boolean); }
function resolveByName(name) { const target = String(name || '').trim().toLowerCase(); const found = data.sortedPlaces.find((row) => row.poi_name.toLowerCase() === target); return found ? asId(found.poi_id) : ''; }

function buildOptions() {
  document.getElementById('report-focal-options').innerHTML = data.sortedPlaces.map((row) => `<option value="${row.poi_name}"></option>`).join('');
  const excluded = new Set([state.focalPoi, ...state.comparePois]);
  document.getElementById('report-compare-options').innerHTML = data.sortedPlaces.filter((row) => !excluded.has(asId(row.poi_id))).map((row) => `<option value="${row.poi_name}"></option>`).join('');
}
function updateSelectedRow() {
  document.getElementById('report-focal-summary').innerHTML = state.focalPoi ? `<strong>Focal place:</strong> ${data.poiLookup[state.focalPoi]?.poi_name || state.focalPoi}` : '';
  const node = document.getElementById('report-compare-chips');
  node.innerHTML = state.comparePois.map((poiId) => `<span class="selected-chip">${data.poiLookup[poiId]?.poi_name || poiId}<button type="button" data-remove-compare="${poiId}">×</button></span>`).join('');
  node.querySelectorAll('[data-remove-compare]').forEach((button) => button.addEventListener('click', () => { state.comparePois = state.comparePois.filter((id) => id !== button.dataset.removeCompare); buildOptions(); updateSelectedRow(); render(); }));
}

function aggregatePoiStats(range) {
  const rows = filterByDate(data.poiDaily, 'video_date', range); const grouped = new Map();
  rows.forEach((row) => { const id = asId(row.poi_id); if (!grouped.has(id)) grouped.set(id, { poi_id:id, poi_name: row.poi_name, poi_cate: row.poi_cate, visits:0, weighted_sentiment_sum:0 }); const agg = grouped.get(id); const visits = toNum(row.journey_n); agg.visits += visits; agg.weighted_sentiment_sum += toNum(row.avg_stop_sentiment) * Math.max(1, visits); });
  return [...grouped.values()].map((row) => ({ ...row, avg_sentiment: row.visits ? row.weighted_sentiment_sum / row.visits : 0 }));
}
function aggregatePoiMarket(range) {
  const rows = filterByDate(data.poiMarketDaily, 'video_date', range); const grouped = new Map();
  rows.forEach((row) => { const key = `${asId(row.poi_id)}__${row.author_region}`; if (!grouped.has(key)) grouped.set(key, { poi_id: asId(row.poi_id), author_region: row.author_region, visits:0, weighted_sentiment_sum:0 }); const agg = grouped.get(key); const visits = toNum(row.journey_n); agg.visits += visits; agg.weighted_sentiment_sum += toNum(row.avg_stop_sentiment) * Math.max(1, visits); });
  return [...grouped.values()].map((row) => ({ ...row, avg_sentiment: row.visits ? row.weighted_sentiment_sum / row.visits : 0 }));
}
function aggregateFlows(range) {
  const rows = filterByDate(data.flowDaily, 'video_date', range); const grouped = new Map();
  rows.forEach((row) => { const o = asId(row.origin_poi_id), d = asId(row.dest_poi_id), key = `${o}__${d}`; if (!grouped.has(key)) grouped.set(key, { origin_poi_id:o, origin_poi_name: row.origin_poi_name, dest_poi_id:d, dest_poi_name: row.dest_poi_name, flow_n:0 }); grouped.get(key).flow_n += toNum(row.flow_n); });
  return [...grouped.values()].filter((row)=>row.flow_n>0);
}
function aggregateCooccur(range) {
  const rows = filterByDate(data.cooccurDaily, 'video_date', range); const grouped = new Map();
  rows.forEach((row) => { const a = asId(row.poi_a_id), b = asId(row.poi_b_id), key = `${a}__${b}`; if (!grouped.has(key)) grouped.set(key, { poi_a_id:a, poi_a_name:row.poi_a_name, poi_b_id:b, poi_b_name:row.poi_b_name, cooccur_n:0 }); grouped.get(key).cooccur_n += toNum(row.cooccur_n); });
  return [...grouped.values()].filter((row)=>row.cooccur_n>0);
}
function buildVisitsSeries(range, poiId) { const rows = filterByDate(data.poiDaily, 'video_date', range).filter((row)=>asId(row.poi_id)===poiId).map((row)=>({ ...row, visits: toNum(row.journey_n), sentiment: toNum(row.avg_stop_sentiment) })); return aggregateSeriesByPeriod(rows, 'video_date', 'visits', 'monthly', false); }
function buildSentimentSeries(range, poiId) { const rows = filterByDate(data.poiDaily, 'video_date', range).filter((row)=>asId(row.poi_id)===poiId).map((row)=>({ ...row, visits: toNum(row.journey_n), sentiment: toNum(row.avg_stop_sentiment) })); return aggregateSeriesByPeriod(rows, 'video_date', 'sentiment', 'monthly', true, 'visits'); }
function topMarketsForPlace(poiId, marketStats) {
  const map = new Map();
  marketStats.filter((row)=>row.poi_id===poiId).forEach((row) => { if (!map.has(row.author_region)) map.set(row.author_region, { label: row.author_region, visits:0, weighted_sentiment_sum:0 }); const agg = map.get(row.author_region); agg.visits += row.visits; agg.weighted_sentiment_sum += row.avg_sentiment * Math.max(1, row.visits); });
  return [...map.values()].map((row) => ({ label: row.label, visits: row.visits, avg_sentiment: row.visits ? row.weighted_sentiment_sum / row.visits : 0 })).sort((a,b)=>b.visits-a.visits);
}
function flowRows(flows, poiId, direction) {
  const map = new Map();
  flows.forEach((row) => {
    if (direction === 'in' && row.dest_poi_id === poiId) { if (!map.has(row.origin_poi_name)) map.set(row.origin_poi_name, { label: row.origin_poi_name, value:0 }); map.get(row.origin_poi_name).value += row.flow_n; }
    if (direction === 'out' && row.origin_poi_id === poiId) { if (!map.has(row.dest_poi_name)) map.set(row.dest_poi_name, { label: row.dest_poi_name, value:0 }); map.get(row.dest_poi_name).value += row.flow_n; }
  });
  return [...map.values()].sort((a,b)=>b.value-a.value);
}
function companionRows(cooccur, poiId) { return [...cooccur.filter((row)=>row.poi_a_id===poiId || row.poi_b_id===poiId).map((row)=>({ label: row.poi_a_id===poiId ? row.poi_b_name : row.poi_a_name, value: row.cooccur_n })).reduce((acc,row)=>acc.set(row.label, (acc.get(row.label)||0)+row.value), new Map()).entries()].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value); }
function orderedRows(flows, poiId) { return flows.filter((row)=>row.origin_poi_id===poiId || row.dest_poi_id===poiId).map((row)=>({ label: `${row.origin_poi_name} → ${row.dest_poi_name}`, value: row.flow_n })).sort((a,b)=>b.value-a.value); }

function renderOverviewSection(poiStats) {
  const ids = seriesIds(); const summaries = ids.map((id)=>poiStats.find((row)=>row.poi_id===id)).filter(Boolean);
  if (!state.focalPoi || !summaries.length) { document.getElementById('report-overview-section').innerHTML = `<div class="empty-state">Choose a focal place to start building a report. Compare places are optional and can be added afterwards.</div>`; return; }
  const focal = summaries[0];
  const cards = summaries.map((row, idx) => metricCard(idx===0 ? 'Focal place' : `Compare ${idx}`, row.poi_name, `${row.poi_cate} · Visits ${formatInt(row.visits)} · Sentiment ${formatSentiment(row.avg_sentiment)}`, idx===0?'◎':'↔')).join('');
  state.exportNotes.overview = `${focal.poi_name} is the focal place for this report. The current view compares visible place performance, source-market mix, movement, and combinations across the selected period.`;
  document.getElementById('report-overview-section').innerHTML = `<div class="report-section-header"><div><h2><span class="module-icon">◎</span>Overview</h2><p>${state.exportNotes.overview}</p></div></div><div class="report-overview-grid">${cards}</div>`;
}

function renderVisitsSection(marketStats) {
  const ids = seriesIds(); if (!state.focalPoi || !ids.length) return document.getElementById('report-visits-section').innerHTML = '';
  const trendSeries = ids.map((id, idx) => { const series = buildVisitsSeries(state.range, id); return { name: data.poiLookup[id]?.poi_name || id, dates: series.map((row)=>row.date), data: series.map((row)=>row.value), color: palette[idx % palette.length] }; });
  const dates = trendSeries[0]?.dates || [];
  const marketCategories = [...new Set(ids.flatMap((id) => topMarketsForPlace(id, marketStats).slice(0, 10).map((row)=>row.label)))].slice(0,10);
  const marketSeries = ids.map((id, idx) => {
    const markets = topMarketsForPlace(id, marketStats); const shareLookup = Object.fromEntries(markets.map((row) => [row.label, row.visits])); const total = markets.reduce((acc,row)=>acc+row.visits,0) || 1;
    return { name: data.poiLookup[id]?.poi_name || id, data: marketCategories.map((label) => (shareLookup[label] || 0) / total), itemStyle: { color: palette[idx % palette.length] } };
  });
  state.exportNotes.visitsTrend = `${data.poiLookup[state.focalPoi]?.poi_name || 'The focal place'} is shown first in the time series. Compare lines make it easier to see whether visible visits move together or diverge across the selected period.`;
  state.exportNotes.visitsMarket = `${marketCategories[0] ? `${marketCategories[0]} appears within the leading source markets in the current comparison set.` : 'No source-market share pattern is visible in the selected period.'}`;
  document.getElementById('report-visits-section').innerHTML = `<div class="report-section-header"><div><h2><span class="module-icon">◔</span>Visits</h2><p>Read visible visits in two ways: a monthly trend over time and a source-market share profile.</p></div></div><div class="subsection-grid"><div class="subsection-card"><div id="report-visits-trend-chart" class="chart-box tall"></div><div class="chart-insight"><p>${state.exportNotes.visitsTrend}</p></div></div><div class="subsection-card"><div id="report-visits-market-chart" class="chart-box tall"></div><div class="chart-insight"><p>${state.exportNotes.visitsMarket}</p></div></div></div>`;
  createChart('report-visits-trend-chart', lineOption({ dates, series: trendSeries.map((s)=>({ name:s.name, data:s.data, color:s.color })), valueFormatter:(v)=>formatInt(v) }));
  createChart('report-visits-market-chart', groupedBarOption({ categories: marketCategories, series: marketSeries, percent: true, horizontal: true, labelMax: 14 }));
}

function renderSentimentSection(marketStats) {
  const ids = seriesIds(); if (!state.focalPoi || !ids.length) return document.getElementById('report-sentiment-section').innerHTML = '';
  const trendSeries = ids.map((id, idx) => { const series = buildSentimentSeries(state.range, id); return { name: data.poiLookup[id]?.poi_name || id, dates: series.map((row)=>row.date), data: series.map((row)=>row.value), color: palette[idx % palette.length] }; });
  const dates = trendSeries[0]?.dates || [];
  const marketCategories = [...new Set(ids.flatMap((id) => topMarketsForPlace(id, marketStats).slice(0, 10).map((row)=>row.label)))].slice(0,10);
  const marketSeries = ids.map((id, idx) => {
    const markets = Object.fromEntries(topMarketsForPlace(id, marketStats).map((row)=>[row.label, row.avg_sentiment]));
    return { name: data.poiLookup[id]?.poi_name || id, data: marketCategories.map((label) => markets[label] ?? null), itemStyle: { color: palette[idx % palette.length] } };
  });
  state.exportNotes.sentimentTrend = `${data.poiLookup[state.focalPoi]?.poi_name || 'The focal place'} is shown first in the sentiment trend. Compare lines show whether experience stays above, below, or close to other selected places over time.`;
  state.exportNotes.sentimentMarket = `${marketCategories[0] ? `Source-market sentiment is shown for the largest visible markets only, which reduces distortion from very small markets with unstable values.` : 'No source-market sentiment comparison is visible in the selected period.'}`;
  document.getElementById('report-sentiment-section').innerHTML = `<div class="report-section-header"><div><h2><span class="module-icon">↗</span>Sentiment</h2><p>Read visible experience in two ways: a time trend and a source-market comparison based on the ten largest visible markets.</p></div></div><div class="subsection-grid"><div class="subsection-card"><div id="report-sentiment-trend-chart" class="chart-box tall"></div><div class="chart-insight"><p>${state.exportNotes.sentimentTrend}</p></div></div><div class="subsection-card"><div id="report-sentiment-market-chart" class="chart-box tall"></div><div class="chart-insight"><p>${state.exportNotes.sentimentMarket}</p></div></div></div>`;
  createChart('report-sentiment-trend-chart', lineOption({ dates, series: trendSeries.map((s)=>({ name:s.name, data:s.data, color:s.color })), valueFormatter:(v)=>formatSentiment(v) }));
  createChart('report-sentiment-market-chart', groupedBarOption({ categories: marketCategories, series: marketSeries, percent: false, horizontal: true, labelMax: 14, valueFormatter:(v)=>formatSentiment(v) }));
}

function renderMovementSection(flows) {
  const ids = seriesIds(); if (!state.focalPoi || !ids.length) return document.getElementById('report-movement-section').innerHTML = '';
  const inboundCategories = flowRows(flows, state.focalPoi, 'in').slice(0,5).map((row)=>row.label);
  const outboundCategories = flowRows(flows, state.focalPoi, 'out').slice(0,5).map((row)=>row.label);
  const inboundSeries = ids.map((id, idx) => { const rows = flowRows(flows, id, 'in'); const total = rows.reduce((acc,row)=>acc+row.value,0) || 1; const lookup = Object.fromEntries(rows.map((row)=>[row.label,row.value])); return { name: data.poiLookup[id]?.poi_name || id, data: inboundCategories.map((label)=>(lookup[label]||0)/total), itemStyle:{ color: palette[idx % palette.length] } }; });
  const outboundSeries = ids.map((id, idx) => { const rows = flowRows(flows, id, 'out'); const total = rows.reduce((acc,row)=>acc+row.value,0) || 1; const lookup = Object.fromEntries(rows.map((row)=>[row.label,row.value])); return { name: data.poiLookup[id]?.poi_name || id, data: outboundCategories.map((label)=>(lookup[label]||0)/total), itemStyle:{ color: palette[idx % palette.length] } }; });
  state.exportNotes.movementInbound = `${inboundCategories[0] ? `${inboundCategories[0]} is the strongest inbound link in the focal-place view.` : `No inbound movement is visible for the focal place.`}`;
  state.exportNotes.movementOutbound = `${outboundCategories[0] ? `${outboundCategories[0]} is the strongest outbound link in the focal-place view.` : `No outbound movement is visible for the focal place.`}`;
  document.getElementById('report-movement-section').innerHTML = `<div class="report-section-header"><div><h2><span class="module-icon">⇄</span>Movement</h2><p>Inbound and outbound movement are shown as shares of the focal place's top five connected places. Compare places are overlaid on the same categories for direct reading.</p></div></div><div class="subsection-grid"><div class="subsection-card"><div id="report-inbound-chart" class="chart-box tall"></div><div class="chart-insight"><p>${state.exportNotes.movementInbound}</p></div></div><div class="subsection-card"><div id="report-outbound-chart" class="chart-box tall"></div><div class="chart-insight"><p>${state.exportNotes.movementOutbound}</p></div></div></div>`;
  createChart('report-inbound-chart', groupedBarOption({ categories: inboundCategories, series: inboundSeries, percent: true, horizontal: true, labelMax: 16 }));
  createChart('report-outbound-chart', groupedBarOption({ categories: outboundCategories, series: outboundSeries, percent: true, horizontal: true, labelMax: 16 }));
}

function renderCombinationsSection(flows, cooccur) {
  const ids = seriesIds(); if (!state.focalPoi || !ids.length) return document.getElementById('report-combinations-section').innerHTML = '';
  const companionCategories = companionRows(cooccur, state.focalPoi).slice(0,5).map((row)=>row.label);
  const orderedCategories = orderedRows(flows, state.focalPoi).slice(0,5).map((row)=>row.label);
  const companionSeries = ids.map((id, idx) => { const rows = companionRows(cooccur, id); const total = rows.reduce((acc,row)=>acc+row.value,0) || 1; const lookup = Object.fromEntries(rows.map((row)=>[row.label,row.value])); return { name: data.poiLookup[id]?.poi_name || id, data: companionCategories.map((label)=>(lookup[label]||0)/total), itemStyle:{ color: palette[idx % palette.length] } }; });
  const orderedSeries = ids.map((id, idx) => { const rows = orderedRows(flows, id); const total = rows.reduce((acc,row)=>acc+row.value,0) || 1; const lookup = Object.fromEntries(rows.map((row)=>[row.label,row.value])); return { name: data.poiLookup[id]?.poi_name || id, data: orderedCategories.map((label)=>(lookup[label]||0)/total), itemStyle:{ color: palette[idx % palette.length] } }; });
  state.exportNotes.companion = `${companionCategories[0] ? `${companionCategories[0]} is the strongest companion place in the focal-place view.` : `No companion-place pattern is visible for the focal place.`}`;
  state.exportNotes.ordered = `${orderedCategories[0] ? `${orderedCategories[0]} is the strongest ordered link involving the focal place.` : `No ordered-link pattern is visible for the focal place.`}`;
  document.getElementById('report-combinations-section').innerHTML = `<div class="report-section-header"><div><h2><span class="module-icon">↔</span>Combinations</h2><p>Companion places ignore order, while ordered links preserve visible sequence. Both are shown here as shares within the focal place's top five visible relationships.</p></div></div><div class="subsection-grid"><div class="subsection-card"><div id="report-companion-chart" class="chart-box tall"></div><div class="chart-insight"><p>${state.exportNotes.companion}</p></div></div><div class="subsection-card"><div id="report-ordered-chart" class="chart-box tall"></div><div class="chart-insight"><p>${state.exportNotes.ordered}</p></div></div></div>`;
  createChart('report-companion-chart', groupedBarOption({ categories: companionCategories, series: companionSeries, percent: true, horizontal: true, labelMax: 16 }));
  createChart('report-ordered-chart', groupedBarOption({ categories: orderedCategories, series: orderedSeries, percent: true, horizontal: true, labelMax: 16 }));
}

function render() {
  const poiStats = aggregatePoiStats(state.range); const marketStats = aggregatePoiMarket(state.range); const flows = aggregateFlows(state.range); const cooccur = aggregateCooccur(state.range);
  renderOverviewSection(poiStats); renderVisitsSection(marketStats); renderSentimentSection(marketStats); renderMovementSection(flows); renderCombinationsSection(flows, cooccur);
}
function getDefaultFocal() { const preferred = data.sortedPlaces.find((row) => String(row.poi_name).toLowerCase() === 'hong kong disneyland'); return preferred ? asId(preferred.poi_id) : asId(data.sortedPlaces[0]?.poi_id || ''); }
function resetAll() { state.range = { start: String(meta.default_start_date), end: String(meta.default_end_date) }; state.comparePois = []; state.focalPoi = getDefaultFocal(); fillDateInputs('report-start-date', 'report-end-date', state.range); document.getElementById('report-focal-input').value = data.poiLookup[state.focalPoi]?.poi_name || ''; document.getElementById('report-compare-input').value = ''; buildOptions(); updateSelectedRow(); render(); }
function setupControls() {
  fillDateInputs('report-start-date', 'report-end-date', state.range); state.focalPoi = getDefaultFocal(); document.getElementById('report-focal-input').value = data.poiLookup[state.focalPoi]?.poi_name || ''; buildOptions(); updateSelectedRow();
  document.getElementById('report-focal-input').addEventListener('change', (event) => { const poiId = resolveByName(event.target.value); if (!poiId) return; state.focalPoi = poiId; state.comparePois = state.comparePois.filter((id) => id !== poiId); buildOptions(); updateSelectedRow(); render(); });
  document.getElementById('report-add-compare').addEventListener('click', () => { const poiId = resolveByName(document.getElementById('report-compare-input').value); if (!poiId || poiId===state.focalPoi || state.comparePois.includes(poiId) || state.comparePois.length>=3) { document.getElementById('report-compare-input').value = ''; return; } state.comparePois.push(poiId); document.getElementById('report-compare-input').value = ''; buildOptions(); updateSelectedRow(); render(); });
  document.getElementById('report-start-date').addEventListener('change', () => { state.range = readDateInputs('report-start-date', 'report-end-date'); render(); });
  document.getElementById('report-end-date').addEventListener('change', () => { state.range = readDateInputs('report-start-date', 'report-end-date'); render(); });
  document.getElementById('report-reset').addEventListener('click', resetAll);
  const exportWrap = document.getElementById('report-export-wrap');
  document.getElementById('report-export-toggle').addEventListener('click', () => exportWrap.classList.toggle('open'));
  document.addEventListener('click', (event) => { if (!exportWrap.contains(event.target)) exportWrap.classList.remove('open'); });
  document.getElementById('report-export-ppt').addEventListener('click', exportPpt);
  document.getElementById('report-export-pdf').addEventListener('click', exportPdf);
}
function chartImage(id) { const chart = getChart(id); return chart ? chart.getDataURL({ pixelRatio: 2, backgroundColor: '#ffffff' }) : null; }
async function exportPpt() {
  if (!state.focalPoi) return; const focalName = data.poiLookup[state.focalPoi]?.poi_name || 'Place'; const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE';
  const titleSlide = pptx.addSlide(); titleSlide.addText(`${focalName} Report`, { x:0.5, y:0.4, w:8, h:0.5, fontSize:26, bold:true, color:'1A2333' }); titleSlide.addText(`Period: ${state.range.start} to ${state.range.end}`, { x:0.5, y:0.95, w:5, h:0.3, fontSize:12, color:'64748B' }); titleSlide.addText(state.exportNotes.overview || '', { x:0.5, y:1.35, w:11.8, h:0.9, fontSize:14, color:'334155' });
  const charts = [['Visits over time','report-visits-trend-chart',state.exportNotes.visitsTrend],['Source market share','report-visits-market-chart',state.exportNotes.visitsMarket],['Sentiment over time','report-sentiment-trend-chart',state.exportNotes.sentimentTrend],['Source market sentiment','report-sentiment-market-chart',state.exportNotes.sentimentMarket],['Top inbound share','report-inbound-chart',state.exportNotes.movementInbound],['Top outbound share','report-outbound-chart',state.exportNotes.movementOutbound],['Companion place share','report-companion-chart',state.exportNotes.companion],['Ordered link share','report-ordered-chart',state.exportNotes.ordered]];
  charts.forEach(([title, chartId, note]) => { const image = chartImage(chartId); if (!image) return; const slide = pptx.addSlide(); slide.addText(title, { x:0.5, y:0.4, w:7, h:0.4, fontSize:22, bold:true, color:'1A2333' }); slide.addImage({ data:image, x:0.5, y:1.0, w:7.8, h:4.7 }); slide.addShape(pptx.ShapeType.roundRect, { x:8.7, y:1.0, w:3.7, h:4.7, fill:{ color:'F7FAFF' }, line:{ color:'D9E3EF', pt:1 }, radius:0.18 }); slide.addText(note || '', { x:9.0, y:1.3, w:3.1, h:3.8, fontSize:13, color:'334155', breakLine:false, valign:'mid' }); });
  await pptx.writeFile({ fileName: `${focalName.replace(/[^a-z0-9]+/gi, '_')}_report.pptx` });
}
async function exportPdf() {
  if (!state.focalPoi) return; const focalName = data.poiLookup[state.focalPoi]?.poi_name || 'Place'; const { jsPDF } = window.jspdf; const doc = new jsPDF({ orientation:'landscape', unit:'pt', format:'a4' });
  const pages = [['Visits over time','report-visits-trend-chart',state.exportNotes.visitsTrend],['Source market share','report-visits-market-chart',state.exportNotes.visitsMarket],['Sentiment over time','report-sentiment-trend-chart',state.exportNotes.sentimentTrend],['Source market sentiment','report-sentiment-market-chart',state.exportNotes.sentimentMarket],['Top inbound share','report-inbound-chart',state.exportNotes.movementInbound],['Top outbound share','report-outbound-chart',state.exportNotes.movementOutbound],['Companion place share','report-companion-chart',state.exportNotes.companion],['Ordered link share','report-ordered-chart',state.exportNotes.ordered]];
  const addPage = (title, chartId, note, first=false) => { if (!first) doc.addPage(); doc.setFont('helvetica','bold'); doc.setFontSize(22); doc.text(title,34,42); doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(100,116,139); doc.text(`${focalName} · ${state.range.start} to ${state.range.end}`,34,62); const image = chartImage(chartId); if (image) doc.addImage(image,'PNG',34,84,500,300,undefined,'FAST'); doc.setDrawColor(217,227,239); doc.roundedRect(560,84,220,300,12,12,'S'); doc.setTextColor(51,65,85); doc.setFontSize(12); doc.text(note || '',578,112,{ maxWidth:184, lineHeightFactor:1.5 }); };
  doc.setFont('helvetica','bold'); doc.setFontSize(24); doc.text(`${focalName} Report`,34,44); doc.setFont('helvetica','normal'); doc.setFontSize(12); doc.setTextColor(100,116,139); doc.text(`Period: ${state.range.start} to ${state.range.end}`,34,66); doc.setTextColor(51,65,85); doc.text(state.exportNotes.overview || '',34,96,{ maxWidth:720, lineHeightFactor:1.6 }); pages.forEach((page)=>addPage(...page)); doc.save(`${focalName.replace(/[^a-z0-9]+/gi, '_')}_report.pdf`);
}
async function main() {
  initBasePage('report'); meta = await getSiteMeta(); state.range = { start: String(meta.default_start_date), end: String(meta.default_end_date) };
  [data.placeIndex, data.poiDaily, data.poiMarketDaily, data.flowDaily, data.cooccurDaily, data.poiMaster] = await Promise.all([
    loadCSV('./data/report/place_report_index.csv'), loadCSV('./data/summary/poi_daily.csv'), loadCSV('./data/summary/poi_market_daily.csv'), loadCSV('./data/summary/flow_daily.csv'), loadCSV('./data/summary/cooccur_daily.csv'), loadCSV('./data/master/poi_master.csv')
  ]);
  data.poiLookup = buildPoiLookup(data.poiMaster); data.sortedPlaces = sortPlacesAlpha(data.placeIndex); setupControls(); render();
}
main().catch((error) => { console.error(error); document.getElementById('report-overview-section').innerHTML = `<div class="empty-state">Unable to load report data. Check the files in <code>data/</code> and the browser console for details.</div>`; });
