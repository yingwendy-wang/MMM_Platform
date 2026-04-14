import { SITE_CONFIG } from "./config.js";

const cache = new Map();
const chartStore = new Map();
let siteMeta = null;

export function el(id) { return document.getElementById(id); }
export async function loadJSON(path) {
  if (cache.has(path)) return cache.get(path);
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  const data = await res.json();
  cache.set(path, data);
  return data;
}
export async function loadCSV(path) {
  if (cache.has(path)) return cache.get(path);
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  const text = await res.text();
  const rows = Papa.parse(text, { header: true, skipEmptyLines: true }).data;
  cache.set(path, rows);
  return rows;
}
export async function getSiteMeta() {
  if (siteMeta) return siteMeta;
  siteMeta = await loadJSON(`${SITE_CONFIG.dataBasePath}/master/site_meta.json`);
  return siteMeta;
}
export const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const asId = (v) => String(v ?? "").trim();
export const unique = (arr) => [...new Set(arr)];
export const sum = (arr) => arr.reduce((a, b) => a + toNum(b), 0);
export function weightedMean(rows, valueKey, weightKey) {
  const total = sum(rows.map((r) => r[weightKey]));
  return total ? rows.reduce((acc, r) => acc + toNum(r[valueKey]) * toNum(r[weightKey]), 0) / total : 0;
}
export function withinDateRange(dateStr, start, end) {
  const d = String(dateStr || "");
  if (!d) return false;
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}
export const filterByDate = (rows, dateKey, range) => rows.filter((row) => withinDateRange(row[dateKey], range.start, range.end));
export function groupBy(rows, keyGetter) {
  const map = new Map();
  rows.forEach((row) => {
    const key = typeof keyGetter === "function" ? keyGetter(row) : row[keyGetter];
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}
export const topN = (rows, key, n = 5) => [...rows].sort((a, b) => toNum(b[key]) - toNum(a[key])).slice(0, n);
export const formatInt = (v) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(toNum(v));
export const formatFloat = (v, d = 2) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(toNum(v));
export const formatPct = (v, d = 1) => `${formatFloat(toNum(v) * 100, d)}%`;
export const formatSentiment = (v) => formatFloat(v, 2);
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export function scaleRadius(value, minValue, maxValue, minRadius = 5, maxRadius = 18) {
  const v = Math.max(0, toNum(value));
  if (maxValue <= minValue) return minRadius;
  const norm = Math.sqrt((v - minValue) / Math.max(1e-9, (maxValue - minValue)));
  return minRadius + clamp(norm, 0, 1) * (maxRadius - minRadius);
}
function hexToRgb(hex) { const h = hex.replace('#', ''); const n = parseInt(h, 16); return [(n>>16)&255, (n>>8)&255, n&255]; }
function rgbToHex([r,g,b]) { return `#${[r,g,b].map((v)=>Math.round(v).toString(16).padStart(2,'0')).join('')}`; }
export function interpolateColor(a, b, t) {
  const aa = hexToRgb(a), bb = hexToRgb(b);
  return rgbToHex(aa.map((v, i) => v + (bb[i] - v) * clamp(t, 0, 1)));
}
export function movementColor(value, minValue, maxValue) {
  const t = maxValue <= minValue ? 0.5 : clamp((toNum(value) - minValue) / (maxValue - minValue), 0, 1);
  return interpolateColor('#cde4ff', '#4b89dc', t);
}
export function sentimentColor(value, minValue = 0, maxValue = 1) {
  const t = clamp((toNum(value) - minValue) / Math.max(1e-9, maxValue - minValue), 0, 1);
  if (t <= 0.5) return interpolateColor('#d14343', '#f7f5d9', t / 0.5);
  return interpolateColor('#f7f5d9', '#1f9d55', (t - 0.5) / 0.5);
}
export function wrapLabel(label, maxLen = 18) {
  const text = String(label || '');
  if (text.length <= maxLen) return text;
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLen && current) { lines.push(current); current = word; }
    else current = next;
  });
  if (current) lines.push(current);
  return lines.join('\n');
}
export function chartLeftMargin(labels, min = 150, max = 300) {
  const len = Math.max(0, ...labels.map((label) => String(label || '').length));
  return clamp(min + len * 5, min, max);
}
export function shareRows(rows, valueKey) {
  const total = sum(rows.map((r) => r[valueKey]));
  return rows.map((r) => ({ ...r, share: total ? toNum(r[valueKey]) / total : 0, total }));
}
function weekKey(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
export function aggregateSeriesByPeriod(rows, dateKey, valueKey, period = 'monthly', weighted = false, weightKey = null) {
  const keyFn = period === 'daily' ? (d) => d : period === 'weekly' ? weekKey : (d) => String(d).slice(0,7);
  const grouped = groupBy(rows, (row) => keyFn(row[dateKey]));
  return [...grouped.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date, group]) => {
    if (!weighted) return { date, value: sum(group.map((r) => r[valueKey])) };
    const totalW = sum(group.map((r) => r[weightKey]));
    return { date, value: totalW ? group.reduce((acc, r) => acc + toNum(r[valueKey]) * toNum(r[weightKey]), 0) / totalW : 0 };
  });
}
export function createChart(id, option) {
  const dom = el(id); if (!dom) return null;
  let chart = chartStore.get(id);
  if (chart && chart.getDom() !== dom) { chart.dispose(); chartStore.delete(id); chart = null; }
  if (!chart) { chart = echarts.init(dom, null, { renderer: 'canvas' }); chartStore.set(id, chart); }
  chart.clear(); chart.setOption(option, true); return chart;
}
export const resizeCharts = () => chartStore.forEach((chart) => chart.resize());
window.addEventListener('resize', resizeCharts);
export const getChart = (id) => chartStore.get(id) || null;

export function horizontalBarOption({ rows, valueKey = 'value', labelKey = 'label', color = '#2563eb', percent = false, maxRows = 5, labelMax = 20, tooltipSuffix = '', valueFormatter = null }) {
  const picked = rows.slice(0, maxRows);
  const labels = picked.map((row) => row[labelKey]);
  const fmt = valueFormatter || ((v) => percent ? formatPct(v, 1) : formatInt(v));
  return {
    animationDuration: 300,
    grid: { left: chartLeftMargin(labels), right: 24, top: 12, bottom: 12, containLabel: false },
    xAxis: { type: 'value', axisLabel: { formatter: (v) => fmt(v), color: '#475569', fontSize: 13 }, splitLine: { lineStyle: { color: '#e6edf6' } } },
    yAxis: { type: 'category', inverse: true, data: labels.map((l) => wrapLabel(l, labelMax)), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: '#334155', lineHeight: 19, fontSize: 14, width: chartLeftMargin(labels) - 30, overflow: 'break' } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => { const p = params[0]; const row = picked[p.dataIndex]; return `${row[labelKey]}<br>${fmt(row[valueKey])}${tooltipSuffix ? ` ${tooltipSuffix}` : ''}`; } },
    series: [{ type: 'bar', data: picked.map((row) => ({ value: toNum(row[valueKey]), itemStyle: { color: row.color || color, borderRadius: [0,10,10,0] } })), label: { show: true, position: 'right', color: '#334155', fontSize: 13, formatter: (p) => fmt(p.value) }, barWidth: 28 }],
  };
}
export function groupedBarOption({ categories, series, percent = false, horizontal = true, labelMax = 16, valueFormatter = null }) {
  const left = horizontal ? chartLeftMargin(categories, 160, 300) : 56;
  const fmt = valueFormatter || ((v) => percent ? formatPct(v, 1) : formatInt(v));
  return {
    animationDuration: 300,
    legend: { top: 0, textStyle: { fontSize: 13 } },
    grid: horizontal ? { left, right: 24, top: 42, bottom: 18 } : { left: 56, right: 24, top: 42, bottom: 68 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => [`<strong>${params[0]?.axisValueLabel || ''}</strong>`, ...params.map((p)=>`${p.marker}${p.seriesName}: ${fmt(p.value)}`)].join('<br>') },
    xAxis: horizontal ? { type: 'value', axisLabel: { formatter: (v) => fmt(v), color:'#475569', fontSize:13 }, splitLine: { lineStyle: { color:'#e6edf6' } } } : { type:'category', data: categories.map((c)=>wrapLabel(c,labelMax)), axisLabel: { interval:0, fontSize:13 } },
    yAxis: horizontal ? { type:'category', inverse:true, data: categories.map((c)=>wrapLabel(c,labelMax)), axisTick:{show:false}, axisLine:{show:false}, axisLabel:{ lineHeight:19, fontSize:14, color:'#334155' } } : { type:'value', axisLabel:{ formatter:(v)=>fmt(v), color:'#475569', fontSize:13 }, splitLine:{ lineStyle:{ color:'#e6edf6' } } },
    series: series.map((item) => ({ ...item, type: 'bar', barMaxWidth: 18 })),
  };
}
export function lineOption({ dates, series, valueFormatter = null, yAxisName = '' }) {
  return {
    animationDuration: 300,
    legend: { top: 0, textStyle: { fontSize: 13 } },
    grid: { left: 56, right: 24, top: 42, bottom: 56 },
    tooltip: { trigger: 'axis', formatter: (params) => [`<strong>${params[0]?.axisValue || ''}</strong>`, ...params.map((p) => `${p.marker}${p.seriesName}: ${valueFormatter ? valueFormatter(p.value) : formatFloat(p.value,2)}`)].join('<br>') },
    xAxis: { type:'category', data: dates, boundaryGap:false, axisLabel:{ color:'#475569', fontSize:13, hideOverlap:true } },
    yAxis: { type:'value', name:yAxisName, axisLabel:{ formatter:(v)=>valueFormatter ? valueFormatter(v) : formatFloat(v,2), color:'#475569', fontSize:13 }, splitLine:{ lineStyle:{ color:'#e6edf6' } }, nameTextStyle:{ color:'#64748b', padding:[0,0,0,8] } },
    series: series.map((item) => ({ ...item, type:'line', smooth:true, symbol:'circle', symbolSize:6, lineStyle:{ width:3, color:item.color }, itemStyle:{ color:item.color }, connectNulls:true })),
  };
}
export function metricCard(label, value, sub = '', icon = '•') {
  return `<div class="metric-card"><div class="label"><span class="module-icon">${icon}</span>${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}
export function popupHTML({ title, lines = [] }) { return `<div><div class="popup-title">${title}</div>${lines.map((line)=>`<div class="popup-meta">${line}</div>`).join('')}</div>`; }
export function attachPopup(marker) {
  const popup = marker.getPopup?.();
  if (popup) popup.options.autoPan = false;
  marker.on('mouseover', function () { this.openPopup(); });
  marker.on('mouseout', function () { this.closePopup(); });
  return marker;
}
export function fillDateInputs(startId, endId, range) { if (el(startId)) el(startId).value = range.start; if (el(endId)) el(endId).value = range.end; }
export const readDateInputs = (startId, endId) => ({ start: el(startId)?.value || '', end: el(endId)?.value || '' });
export function sentenceBlock(title, body) { return `<div class="insight-box"><h4>${title}</h4><p>${body}</p></div>`; }
export function createMap(id, center = [22.3193, 114.1694], zoom = 11) {
  const map = L.map(id, { scrollWheelZoom: true, zoomControl: true, preferCanvas: true, zoomSnap: 0.25 });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap &copy; CARTO' }).addTo(map);
  map.setView(center, zoom);
  return map;
}
export function clearMapOverlays(map) { map.eachLayer((layer) => { if (!(layer instanceof L.TileLayer)) map.removeLayer(layer); }); }
export function getDefaultRange(meta) { return { start: String(meta.default_start_date), end: String(meta.default_end_date) }; }
export function initBasePage(pageKey, { showUpdated = true } = {}) {
  document.querySelectorAll('[data-site-name]').forEach((node) => { node.textContent = SITE_CONFIG.siteName; });
  document.querySelectorAll('.top-nav a').forEach((a) => { if (a.dataset.page === pageKey) a.classList.add('active'); });
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.top-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => { nav.classList.toggle('open'); toggle.setAttribute('aria-expanded', nav.classList.contains('open') ? 'true' : 'false'); });
    nav.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => nav.classList.remove('open')));
  }
  if (showUpdated) getSiteMeta().then((meta) => { const node = el('site-last-updated'); if (node) node.textContent = String(meta.last_updated || ''); }).catch(() => {});
  initChatbot();
}
export function initChatbot() {
  const openBtn = el('chatbot-open'); const modal = el('chatbot-modal'); const closeBtn = el('chatbot-close'); const frameWrap = el('chatbot-frame-wrap');
  if (!openBtn || !modal || !closeBtn || !frameWrap) return;
  openBtn.onclick = () => {
    modal.classList.add('open');
    frameWrap.innerHTML = SITE_CONFIG.chatbotUrl ? `<iframe class="chatbot-frame" src="${SITE_CONFIG.chatbotUrl}" title="${SITE_CONFIG.chatbotTitle}"></iframe>` : `<div class="empty-state" style="margin:18px;">Set <code>chatbotUrl</code> in <code>assets/js/config.js</code> to connect your existing Hugging Face chatbot.</div>`;
  };
  closeBtn.onclick = () => modal.classList.remove('open');
  modal.onclick = (event) => { if (event.target === modal) modal.classList.remove('open'); };
}
