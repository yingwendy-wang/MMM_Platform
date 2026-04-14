import { SITE_CONFIG } from "./config.js";
import {
  initBasePage, getSiteMeta, loadJSON, loadCSV, filterByDate, createMap, clearMapOverlays,
  toNum, asId, topN, shareRows, scaleRadius, sentimentColor, popupHTML, attachPopup,
  sentenceBlock, formatInt, formatSentiment, formatPct, createChart,
  horizontalBarOption, lineOption, aggregateSeriesByPeriod, metricCard
} from "./common.js";

let movementMap;
let sentimentMap;

function buildPoiLookup(rows) {
  return Object.fromEntries(rows.map((row) => [asId(row.poi_id), { ...row, poi_lat: toNum(row.poi_lat), poi_lng: toNum(row.poi_lng), is_focal: toNum(row.is_focal) }]));
}

function aggregatePoiStats(poiDaily, poiLookup, range) {
  const rows = filterByDate(poiDaily, "video_date", range);
  const map = new Map();
  rows.forEach((row) => {
    const id = asId(row.poi_id);
    const base = poiLookup[id];
    if (!base) return;
    if (!map.has(id)) map.set(id, { poi_id: id, poi_name: row.poi_name || base.poi_name, poi_cate: row.poi_cate || base.poi_cate, poi_lat: base.poi_lat, poi_lng: base.poi_lng, is_focal: toNum(base.is_focal), visits: 0, weighted_sentiment_sum: 0 });
    const agg = map.get(id);
    const visits = toNum(row.journey_n);
    agg.visits += visits;
    agg.weighted_sentiment_sum += toNum(row.avg_stop_sentiment) * Math.max(1, visits);
  });
  return [...map.values()].map((row) => ({ ...row, avg_sentiment: row.visits ? row.weighted_sentiment_sum / row.visits : 0 }));
}

function renderKpis(cityDaily, homeKpis, marketDaily) {
  const totalVisits = cityDaily.reduce((acc, row) => acc + toNum(row.journey_n), 0);
  const avgSent = cityDaily.length ? cityDaily.reduce((acc, row) => acc + toNum(row.avg_journey_sentiment) * Math.max(1, toNum(row.journey_n)), 0) / Math.max(1, totalVisits) : toNum(homeKpis.avg_journey_sentiment);
  const marketCount = new Set(marketDaily.map((row) => row.author_region)).size;
  document.getElementById("home-kpis").innerHTML = [
    metricCard("Total visits", formatInt(totalVisits), "", "◔"),
    metricCard("Identified places", formatInt(homeKpis.total_pois), "", "◎"),
    metricCard("Avg journey sentiment", formatSentiment(avgSent), "", "↗"),
    metricCard("Source markets", formatInt(marketCount), "", "▤"),
  ].join("");
}

function renderMovementMap(poiAgg) {
  clearMapOverlays(movementMap);
  const focal = poiAgg.filter((row) => row.is_focal === 1 && row.visits > 0);
  if (!focal.length) return;
  const heatData = focal.map((row) => [row.poi_lat, row.poi_lng, Math.sqrt(row.visits)]);
  if (window.L.heatLayer) {
    L.heatLayer(heatData, {
      radius: 30,
      blur: 24,
      maxZoom: 13,
      gradient: { 0.1: "#fee8c8", 0.4: "#fdbb84", 0.65: "#fc8d59", 0.85: "#ef6548", 1.0: "#b30000" },
    }).addTo(movementMap);
  }
  const topHotspots = shareRows(topN(focal.map((row) => ({ label: row.poi_name, value: row.visits })), "value", 5), "value");
  document.getElementById("home-movement-notes").innerHTML = [
    sentenceBlock("What this map shows", "This heat map highlights where visible visits are most concentrated across focal places in Hong Kong."),
    sentenceBlock("What stands out", topHotspots.length ? `${topHotspots[0].label} is the strongest hotspot in the current range. The top five hotspots together account for ${formatPct(topHotspots.reduce((acc, row) => acc + row.share, 0), 1)} of visible visits across the focal-place view.` : "No clear hotspot pattern is visible in the current range."),
    sentenceBlock("How to read the pattern", topHotspots.length > 1 ? `After ${topHotspots[0].label}, visible demand drops into a smaller group of secondary hotspots, which suggests a concentrated city pattern rather than an evenly spread one.` : "Visible demand is concentrated in a very small number of places in the current range."),
  ].join("");
}

function renderSentimentMap(poiAgg) {
  clearMapOverlays(sentimentMap);
  const focal = poiAgg.filter((row) => row.is_focal === 1 && row.visits > 0);
  if (!focal.length) return;
  const minVisit = Math.min(...focal.map((row) => row.visits), 0);
  const maxVisit = Math.max(...focal.map((row) => row.visits), 1);
  topN(focal, "visits", 120).forEach((row) => {
    const color = sentimentColor(row.avg_sentiment, 0, 1);
    const marker = L.circleMarker([row.poi_lat, row.poi_lng], {
      radius: scaleRadius(row.visits, minVisit, maxVisit, 5, 15),
      color,
      fillColor: color,
      fillOpacity: 0.9,
      weight: 0,
    }).addTo(sentimentMap).bindPopup(popupHTML({ title: row.poi_name, lines: [`Sentiment: ${formatSentiment(row.avg_sentiment)}`, `Visits: ${formatInt(row.visits)}`] }), { autoPan: false });
    attachPopup(marker);
  });
  const best = topN(focal, "avg_sentiment", 3);
  const low = [...focal].sort((a, b) => a.avg_sentiment - b.avg_sentiment).slice(0, 3);
  document.getElementById("home-sentiment-notes").innerHTML = [
    sentenceBlock("What this map shows", "This map shows place-level average sentiment on a red-to-green scale, where red indicates lower sentiment and green indicates higher sentiment."),
    sentenceBlock("Higher-scoring places", best.length ? `${best[0].poi_name} sits at the strongest end of the visible sentiment range, with ${best.slice(1).map((row) => row.poi_name).join(" and ")} also appearing among the strongest focal places.` : "No higher-scoring place is visible in the current range."),
    sentenceBlock("Lower-scoring places", low.length ? `${low[0].poi_name} sits at the weaker end of the visible sentiment range. This means strong visitor volume and strong visitor experience do not always appear in the same places.` : "No lower-scoring place is visible in the current range."),
  ].join("");
}

function renderVisitOverview(cityDaily, marketDaily) {
  const monthlyVisits = aggregateSeriesByPeriod(cityDaily, "video_date", "journey_n", "monthly", false);
  createChart("home-platform-chart", lineOption({
    dates: monthlyVisits.map((row) => row.date),
    series: [{ name: "Visits", data: monthlyVisits.map((row) => row.value), color: "#2563eb" }],
    valueFormatter: (v) => formatInt(v),
  }));

  const marketGrouped = new Map();
  marketDaily.forEach((row) => {
    if (!marketGrouped.has(row.author_region)) marketGrouped.set(row.author_region, { label: row.author_region, value: 0 });
    marketGrouped.get(row.author_region).value += toNum(row.journey_n);
  });
  const topMarkets = shareRows(topN([...marketGrouped.values()], "value", 10), "value");
  createChart("home-platform-market-chart", horizontalBarOption({ rows: topMarkets, valueKey: "share", percent: true, color: "#2563eb", maxRows: 10, labelMax: 12 }));

  const latest = monthlyVisits.at(-1)?.value || 0;
  document.getElementById("home-visit-trend-note").innerHTML = `<div class="chart-insight"><p>${monthlyVisits.length ? `This line chart shows visible visits by month. The latest month in the current range records ${formatInt(latest)} visible visits, which helps place the mobility and experience maps in city-wide context.` : `No monthly visit trend is visible in the current range.`}</p></div>`;
  document.getElementById("home-source-market-note").innerHTML = `<div class="chart-insight"><p>${topMarkets.length ? `${topMarkets[0].label} contributes the largest visible source-market share in the current city view, followed by ${topMarkets.slice(1, 3).map((row) => row.label).join(" and ")}. Shares are shown here so smaller markets remain readable even when a few markets dominate in size.` : `No source-market pattern is visible in the current range.`}</p></div>`;
}

async function main() {
  initBasePage("home");
  const meta = await getSiteMeta();
  const range = { start: String(meta.default_start_date), end: String(meta.default_end_date) };
  const [homeKpis, poiMaster, poiDaily, cityDaily, marketDaily] = await Promise.all([
    loadJSON(`${SITE_CONFIG.dataBasePath}/summary/home_kpis.json`),
    loadCSV(`${SITE_CONFIG.dataBasePath}/master/poi_master.csv`),
    loadCSV(`${SITE_CONFIG.dataBasePath}/summary/poi_daily.csv`),
    loadCSV(`${SITE_CONFIG.dataBasePath}/summary/city_daily.csv`),
    loadCSV(`${SITE_CONFIG.dataBasePath}/summary/market_daily.csv`),
  ]);

  renderKpis(filterByDate(cityDaily, "video_date", range), homeKpis, filterByDate(marketDaily, "video_date", range));
  movementMap = createMap("home-movement-map");
  sentimentMap = createMap("home-sentiment-map");
  const poiLookup = buildPoiLookup(poiMaster);
  const poiAgg = aggregatePoiStats(poiDaily, poiLookup, range);
  renderMovementMap(poiAgg);
  renderSentimentMap(poiAgg);
  renderVisitOverview(filterByDate(cityDaily, "video_date", range), filterByDate(marketDaily, "video_date", range));
}

main().catch((error) => {
  console.error(error);
  ["home-movement-notes", "home-sentiment-notes", "home-visit-trend-note", "home-source-market-note"].forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.innerHTML = `<div class="empty-state">Unable to load home page data. Check the files inside <code>data/</code> and the browser console.</div>`;
  });
});
