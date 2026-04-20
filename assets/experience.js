document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [meta, places, poiDaily, expPlaces, poiMarketDaily] = await Promise.all([
      MMM.fetchJSON('explorer/meta.json'),
      MMM.fetchJSON('dictionaries/places.json'),
      MMM.fetchJSON('explorer/poi_daily.json'),
      MMM.fetchJSON('experience/experience_places.json').catch(() => ({})),
      MMM.fetchJSON('explorer/poi_market_daily.json').catch(() => []),
    ]);

    const placeLookup = new Map(places.map(p => [String(p.poi_id), p]));
    const state = { selectedPlaceId: MMM.getParam('place') || '', trendScale: 'weekly', marketSort: 'experience' };

    const startInput = MMM.qs('#experience-start');
    const endInput = MMM.qs('#experience-end');
    const catSelect = MMM.qs('#experience-category');
    const focalOnly = MMM.qs('#experience-focal');
    const resetBtn = MMM.qs('#experience-reset');
    const map = MMM.map('experience-map');
    const defaultCenter = [22.38, 114.2];
    const defaultZoom = 11;
    map.setView(defaultCenter, defaultZoom);

    requestAnimationFrame(() => map.invalidateSize());
    setTimeout(() => map.invalidateSize(), 180);
    const handleViewportResize = () => {
      setTimeout(() => {
        map.invalidateSize();
        if (window.innerWidth <= 1180) map.setView(defaultCenter, defaultZoom);
      }, 120);
    };
    window.addEventListener('resize', handleViewportResize);

    const nodeLayer = L.layerGroup().addTo(map);

    const fmt2 = (v) => v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(2);
    const experienceColor = (v) => { const n = Math.max(0, Math.min(1, Number(v || 0))); return `hsl(${n * 120}, 68%, 44%)`; };
    const defaultStart = (meta.min_date && meta.min_date > '2024-01-01') ? meta.min_date : '2024-01-01';
    startInput.value = defaultStart;
    endInput.value = meta.max_date;
    focalOnly.checked = false;

    const categories = [...new Set(poiDaily.map(r => r.poi_cate).filter(Boolean))].sort();
    catSelect.innerHTML = `<option value="">All categories</option>${categories.map(c => `<option value="${c}">${c}</option>`).join('')}`;

    let scatterChart = null;
    let benchmarkChart = null;

    const isFocal = (poiId, rowFocal) => rowFocal === 1 || rowFocal === 1.0 || Number(placeLookup.get(String(poiId))?.is_focal) === 1;
    const getCoords = (poiId, lat, lng) => {
      const ref = placeLookup.get(String(poiId)) || {};
      return { lat: lat ?? ref.poi_lat ?? null, lng: lng ?? ref.poi_lng ?? null };
    };
    const setTip = (id, text) => {
      const el = MMM.qs(id);
      if (!el) return;
      el.setAttribute('title', text);
      el.setAttribute('aria-label', text);
    };

    function bucket(date, scale) {
      const d = new Date(date + 'T00:00:00');
      if (scale === 'daily') return date;
      if (scale === 'monthly') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const tmp = new Date(d);
      const day = (tmp.getDay() + 6) % 7;
      tmp.setDate(tmp.getDate() - day);
      return tmp.toISOString().slice(0, 10);
    }

    function enumerateBuckets(start, end, scale) {
      if (!start || !end) return [];
      const out = [];
      let cur = new Date(start + 'T00:00:00');
      const endDate = new Date(end + 'T00:00:00');
      if (scale === 'daily') {
        while (cur <= endDate) {
          out.push(cur.toISOString().slice(0, 10));
          cur.setDate(cur.getDate() + 1);
        }
        return out;
      }
      if (scale === 'weekly') {
        const day = (cur.getDay() + 6) % 7;
        cur.setDate(cur.getDate() - day);
        while (cur <= endDate) {
          out.push(cur.toISOString().slice(0, 10));
          cur.setDate(cur.getDate() + 7);
        }
        return [...new Set(out)];
      }
      cur = new Date(cur.getFullYear(), cur.getMonth(), 1);
      while (cur <= endDate) {
        out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
      return out;
    }

    function rowsByDateRange() {
      return MMM.inRange(poiDaily, startInput.value, endInput.value);
    }

    function applyScopeFilters(rows) {
      let out = rows;
      if (focalOnly.checked) out = out.filter(r => isFocal(r.poi_id, r.is_focal));
      return out;
    }

    function applyVisibleFilters(rows) {
      let out = applyScopeFilters(rows);
      if (catSelect.value) out = out.filter(r => r.poi_cate === catSelect.value);
      return out;
    }

    function applyMarketScopeFilters(rows) {
      let out = rows.filter(r => (!startInput.value || r.video_date >= startInput.value) && (!endInput.value || r.video_date <= endInput.value));
      if (focalOnly.checked) out = out.filter(r => isFocal(r.poi_id, r.is_focal));
      return out;
    }

    function aggregateMarkets(rows) {
      const m = new Map();
      rows.forEach(r => {
        const key = String(r.author_region || 'Unknown');
        if (!m.has(key)) m.set(key, { author_region: key, journey_n: 0, stop_n: 0, exp_sum: 0 });
        const v = m.get(key);
        const weight = Number(r.stop_n || 0);
        v.journey_n += Number(r.journey_n || 0);
        v.stop_n += weight;
        v.exp_sum += Number(r.avg_stop_sentiment || 0) * weight;
      });
      return [...m.values()].map(v => ({ author_region: v.author_region, journey_n: v.journey_n, stop_n: v.stop_n, avg_stop_sentiment: v.stop_n ? v.exp_sum / v.stop_n : null }));
    }

    function aggregate(rows) {
      const m = new Map();
      rows.forEach(r => {
        const key = String(r.poi_id);
        if (!m.has(key)) {
          const c = getCoords(r.poi_id, r.poi_lat, r.poi_lng);
          m.set(key, {
            poi_id: r.poi_id,
            poi_name: r.poi_name,
            poi_cate: r.poi_cate,
            poi_lat: c.lat,
            poi_lng: c.lng,
            journey_n: 0,
            stop_n: 0,
            exp_sum: 0,
            exp_weight: 0,
            city_avg_hint: Number(r.city_avg_stop_sentiment || 0),
            cat_avg_hint: Number(r.category_avg_stop_sentiment || 0),
          });
        }
        const n = m.get(key);
        const weight = Number(r.stop_n || 0);
        n.journey_n += Number(r.journey_n || 0);
        n.stop_n += weight;
        n.exp_sum += Number(r.avg_stop_sentiment || 0) * weight;
        n.exp_weight += weight;
      });
      return [...m.values()].map(n => ({
        ...n,
        avg_stop_sentiment: n.exp_weight ? n.exp_sum / n.exp_weight : null,
      }));
    }

    function weightedAverage(rows) {
      const w = rows.reduce((a, r) => a + Number(r.stop_n || 0), 0);
      if (!w) return null;
      return rows.reduce((a, r) => a + Number(r.avg_stop_sentiment || 0) * Number(r.stop_n || 0), 0) / w;
    }

    function categoryBenchmarks(rows) {
      const m = new Map();
      rows.forEach(r => {
        const key = r.poi_cate || 'Unknown';
        if (!m.has(key)) m.set(key, { poi_cate: key, stop_n: 0, exp_sum: 0, journey_n: 0, poi_count: new Set() });
        const v = m.get(key);
        const weight = Number(r.stop_n || 0);
        v.stop_n += weight;
        v.exp_sum += Number(r.avg_stop_sentiment || 0) * weight;
        v.journey_n += Number(r.journey_n || 0);
        v.poi_count.add(String(r.poi_id));
      });
      return [...m.values()].map(v => ({
        poi_cate: v.poi_cate,
        stop_n: v.stop_n,
        journey_n: v.journey_n,
        visible_places: v.poi_count.size,
        avg_stop_sentiment: v.stop_n ? v.exp_sum / v.stop_n : null,
      }));
    }

    function seriesFor(rows, groupLabel) {
      const by = new Map();
      rows.forEach(r => {
        const k = bucket(r.video_date, state.trendScale);
        if (!by.has(k)) by.set(k, { bucket: k, stop_n: 0, exp_sum: 0 });
        const v = by.get(k);
        const weight = Number(r.stop_n || 0);
        v.stop_n += weight;
        v.exp_sum += Number(r.avg_stop_sentiment || 0) * weight;
      });
      const labels = enumerateBuckets(startInput.value, endInput.value, state.trendScale);
      return {
        label: groupLabel,
        rows: labels.map(label => {
          const v = by.get(label);
          return { bucket: label, avg_stop_sentiment: v && v.stop_n ? v.exp_sum / v.stop_n : null };
        }),
      };
    }

    function syncBuckets(seriesList) {
      const labels = [...new Set(seriesList.flatMap(s => s.rows.map(r => r.bucket)))].sort();
      return {
        labels,
        datasets: seriesList.map((series, idx) => {
          const map = new Map(series.rows.map(r => [r.bucket, r.avg_stop_sentiment]));
          return { label: series.label, data: labels.map(l => map.get(l) ?? null), idx };
        })
      };
    }

    function drawMap(nodes, selected) {
      nodeLayer.clearLayers();
      const maxJourneys = Math.max(...nodes.map(n => Number(n.journey_n || 0)), 1);
      nodes.forEach(n => {
        if ([n.poi_lat, n.poi_lng].some(v => v == null || Number.isNaN(Number(v)))) return;
        let fillColor = experienceColor(n.avg_stop_sentiment);
        if (selected) {
          if (String(selected.poi_id) === String(n.poi_id)) fillColor = '#0f6fff';
          else fillColor = MMM.toneFromDiff((n.avg_stop_sentiment || 0) - (selected.avg_stop_sentiment || 0));
        }
        const radius = String(selected?.poi_id || '') === String(n.poi_id)
          ? 13.5
          : 5.5 + Math.pow((Number(n.journey_n || 0) / maxJourneys), 0.45) * 11;
        const marker = L.circleMarker([n.poi_lat, n.poi_lng], {
          radius,
          stroke: false,
          fillColor,
          fillOpacity: .94,
        }).addTo(nodeLayer);
        const html = `<strong>${n.poi_name}</strong><br>${n.poi_cate}<br>Experience: ${fmt2(n.avg_stop_sentiment)}<br>Journeys: ${MMM.fmtNum(n.journey_n)}`;
        marker.bindTooltip(html, { sticky: true, direction: 'top', opacity: .95 });
        marker.bindPopup(html);
        marker.on('click', () => { state.selectedPlaceId = String(n.poi_id); MMM.setParam({ place: n.poi_id }); render(); });
      });
    }

    function renderLegend(selected) {
      const node = MMM.qs('#experience-legend');
      if (!selected) {
        node.innerHTML = `
          <div class="legend-caption">Map Legend</div>
          <div class="legend-gradient-row"><span>0.00</span><div class="legend-gradient"></div><span>1.00</span></div>
          <div class="legend-note">Red indicates lower observed experience. Green indicates higher observed experience.</div>`;
      } else {
        node.innerHTML = `
          <div class="legend-caption">Map Legend</div>
          <div class="legend-keys">
            <span><i class="legend-swatch selected"></i> Selected place</span>
            <span><i class="legend-swatch lower"></i> Lower than selected</span>
            <span><i class="legend-swatch higher"></i> Higher than selected</span>
          </div>
          <div class="legend-note">Other visible places are recolored relative to ${selected.poi_name}.</div>`;
      }
    }

    function renderScatter(nodes, selected) {
      const basePoints = nodes.filter(n => !selected || String(n.poi_id) !== String(selected.poi_id)).map(n => ({
        x: Math.log10((n.journey_n || 0) + 1),
        y: n.avg_stop_sentiment,
        label: n.poi_name,
        journeys: n.journey_n,
      }));
      const datasets = [{ label: 'Visible places', data: basePoints, pointRadius: 6, pointHoverRadius: 8 }];
      if (selected) datasets.push({ label: selected.poi_name, data: [{ x: Math.log10((selected.journey_n || 0) + 1), y: selected.avg_stop_sentiment, label: selected.poi_name, journeys: selected.journey_n }], pointRadius: 8, pointHoverRadius: 10 });
      if (scatterChart) scatterChart.destroy();
      scatterChart = new Chart(document.getElementById('experience-scatter-chart'), {
        type: 'scatter',
        data: { datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom' },
            tooltip: { callbacks: { label: (ctx) => `${ctx.raw.label}: ${MMM.fmtNum(ctx.raw.journeys)} journeys · ${fmt2(ctx.raw.y)} experience` } },
          },
          scales: {
            x: { title: { display: true, text: 'Journey volume (log scale)' }, beginAtZero: true },
            y: { title: { display: true, text: 'Average experience' }, suggestedMin: 0, suggestedMax: 1 },
          },
        },
      });
    }

    function renderRanking(node, rows) {
      if (!rows?.length) { node.innerHTML = '<div class="empty">No data available for this selection.</div>'; return; }
      const maxExp = Math.max(...rows.map(r => Number(r.avg_stop_sentiment || 0)), 0.0001);
      node.innerHTML = `<div class="rank-bars">${rows.map((r, i) => `
        <div class="rank-bar inbound">
          <div class="rank-bar-top">
            <div class="rank-index inbound">${i + 1}</div>
            <div><div class="rank-name">${r.poi_name}</div><div class="rank-sub">${r.poi_cate || ''}</div></div>
            <div class="rank-metric inbound">${fmt2(r.avg_stop_sentiment)} (${MMM.fmtNum(r.journey_n)} journeys)</div>
          </div>
          <div class="bar-track"><div class="bar-fill inbound" style="width:${Math.max(8, (Number(r.avg_stop_sentiment || 0) / maxExp) * 100)}%"></div></div>
        </div>`).join('')}</div>`;
    }

    function renderNote(id, lead, detail) {
      MMM.qs(id).innerHTML = `<strong>${lead}</strong> ${detail}`;
    }

    function render(mode = "all") {
      const allRows = rowsByDateRange();
      const scopeRows = applyScopeFilters(allRows);
      const visibleRows = applyVisibleFilters(allRows);
      const nodes = aggregate(visibleRows).sort((a, b) => b.journey_n - a.journey_n);
      const marketScopeRows = applyMarketScopeFilters(poiMarketDaily || []);
      if (state.selectedPlaceId && !nodes.find(n => String(n.poi_id) === String(state.selectedPlaceId))) state.selectedPlaceId = '';
      const selected = nodes.find(n => String(n.poi_id) === String(state.selectedPlaceId));
      const cityAvgScope = weightedAverage(scopeRows);
      const cityAvgVisible = weightedAverage(visibleRows);
      const categoryRowsScope = catSelect.value ? scopeRows.filter(r => r.poi_cate === catSelect.value) : [];
      const categoryAvgScope = categoryRowsScope.length ? weightedAverage(categoryRowsScope) : null;
      const selectedRowsScope = selected ? scopeRows.filter(r => String(r.poi_id) === String(selected.poi_id)) : [];
      const selectedCategoryRowsScope = selected ? scopeRows.filter(r => r.poi_cate === selected.poi_cate) : [];
      const selectedCategoryAvgScope = selectedCategoryRowsScope.length ? weightedAverage(selectedCategoryRowsScope) : null;
      const catBenchScope = categoryBenchmarks(scopeRows).sort((a, b) => (b.avg_stop_sentiment || 0) - (a.avg_stop_sentiment || 0));
      const topRank = nodes.filter(n => n.avg_stop_sentiment != null).sort((a, b) => (b.avg_stop_sentiment || 0) - (a.avg_stop_sentiment || 0)).slice(0, 5);

      MMM.qs('#experience-headline').textContent = selected ? selected.poi_name : 'Hong Kong experience overview';
      MMM.qs('#experience-subline').textContent = selected ? `${selected.poi_cate} · selected place detail` : 'Average observed experience across visible places';
      MMM.qs('#experience-summary-title').textContent = selected ? selected.poi_name : 'City Overview';
      MMM.qs('#experience-summary-sub').textContent = selected ? selected.poi_cate : (catSelect.value ? `${catSelect.value} selected` : 'Current date, category, and focal-place view');
      MMM.qs('#experience-hint').textContent = selected ? `You are viewing ${selected.poi_name}. Click another point to switch places, or use Reset to return to the city overview.` : 'You are viewing the city overview. Click any point on the map to open place-level detail.';
      renderLegend(selected);

      setTip('#info-exp-summary', selected ? 'This summary shows the selected place and its current experience footprint.' : 'This summary shows the current city-level or category-level experience footprint.');
      setTip('#info-exp-trend', selected ? 'This chart tracks the selected place, its category, and the city average over time.' : catSelect.value ? 'This chart compares the selected category with the city average over time.' : 'This chart tracks the city average experience over time.');
      setTip('#info-exp-benchmark', selected ? 'This chart compares the selected place with the current city and category averages.' : catSelect.value ? 'This chart compares all category averages, while highlighting the selected category and city average.' : 'This chart compares all category averages and the current city average.');
      setTip('#info-exp-scatter', 'This chart positions visible places by journey volume and average experience. The x-axis uses a log transform so large places do not compress the rest of the distribution.');
      setTip('#info-exp-ranking', 'This ranking shows the strongest visible average experience in the current filter.');

      if (selected) {
        MMM.qs('#experience-metrics').innerHTML = `
          <div class="metric-card"><div class="k">Average Experience</div><div class="v">${fmt2(selected.avg_stop_sentiment)}</div></div>
          <div class="metric-card"><div class="k">Visits</div><div class="v">${MMM.fmtNum(selected.stop_n)}</div></div>
          <div class="metric-card"><div class="k">Vs. City Avg</div><div class="v">${selected.avg_stop_sentiment >= cityAvgScope ? '+' : '-'}${fmt2(Math.abs((selected.avg_stop_sentiment || 0) - (cityAvgScope || 0)))}</div></div>
          <div class="metric-card"><div class="k">Vs. Category Avg</div><div class="v">${selected.avg_stop_sentiment >= selectedCategoryAvgScope ? '+' : '-'}${fmt2(Math.abs((selected.avg_stop_sentiment || 0) - (selectedCategoryAvgScope || 0)))}</div></div>`;
      } else if (catSelect.value) {
        MMM.qs('#experience-metrics').innerHTML = `
          <div class="metric-card"><div class="k">Category Avg</div><div class="v">${fmt2(categoryAvgScope)}</div></div>
          <div class="metric-card"><div class="k">Vs. City Avg</div><div class="v">${categoryAvgScope >= cityAvgScope ? '+' : '-'}${fmt2(Math.abs((categoryAvgScope || 0) - (cityAvgScope || 0)))}</div></div>
          <div class="metric-card"><div class="k">Visible Places</div><div class="v">${MMM.fmtNum(nodes.length)}</div></div>
          <div class="metric-card"><div class="k">Journeys</div><div class="v">${MMM.fmtNum(MMM.sum(nodes, 'journey_n'))}</div></div>`;
      } else {
        MMM.qs('#experience-metrics').innerHTML = `
          <div class="metric-card"><div class="k">Average Experience</div><div class="v">${fmt2(cityAvgVisible)}</div></div>
          <div class="metric-card"><div class="k">Visible Places</div><div class="v">${MMM.fmtNum(nodes.length)}</div></div>
          <div class="metric-card"><div class="k">Journeys</div><div class="v">${MMM.fmtNum(MMM.sum(nodes, 'journey_n'))}</div></div>
          <div class="metric-card"><div class="k">Visits</div><div class="v">${MMM.fmtNum(MMM.sum(nodes, 'stop_n'))}</div></div>`;
      }

      const seriesList = [];
      if (selected) {
        seriesList.push(seriesFor(selectedRowsScope, selected.poi_name));
        seriesList.push(seriesFor(selectedCategoryRowsScope, `${selected.poi_cate} avg`));
        seriesList.push(seriesFor(scopeRows, 'City average'));
      } else if (catSelect.value) {
        seriesList.push(seriesFor(categoryRowsScope, `${catSelect.value} avg`));
        seriesList.push(seriesFor(scopeRows, 'City average'));
      } else {
        seriesList.push(seriesFor(scopeRows, 'City average'));
      }
      const synced = syncBuckets(seriesList);
      if (mode === 'all' || mode === 'trend') {
        MMM.lineChart('experience-trend-chart', synced.labels, synced.datasets.map((d, idx) => ({
          label: d.label,
          data: d.data,
          borderColor: idx === 0 ? '#22a268' : idx === 1 ? '#1d73ff' : '#e87130',
        })), { scales: { y: { suggestedMin: 0, suggestedMax: 1 } } });
      }

      if (mode === 'all') {
      if (selected) {
        const labels = [selected.poi_name, 'City average', `${selected.poi_cate} average`];
        const values = [selected.avg_stop_sentiment, cityAvgScope, selectedCategoryAvgScope];
        if (benchmarkChart) benchmarkChart.destroy();
        benchmarkChart = new Chart(document.getElementById('experience-benchmark-chart'), {
          type: 'bar',
          data: { labels, datasets: [{ data: values, backgroundColor: ['#22a268', '#1d73ff', '#7d93b2'], borderRadius: 8 }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { suggestedMin: 0, suggestedMax: 1, ticks: { callback: (v) => Number(v).toFixed(2) } } } },
        });
      } else {
        const labels = catBenchScope.map(c => c.poi_cate).concat(['City average']);
        const values = catBenchScope.map(c => c.avg_stop_sentiment).concat([cityAvgScope]);
        const colors = catBenchScope.map(c => c.poi_cate === catSelect.value ? '#22a268' : '#1d73ff').concat(['#e87130']);
        if (benchmarkChart) benchmarkChart.destroy();
        benchmarkChart = new Chart(document.getElementById('experience-benchmark-chart'), {
          type: 'bar',
          data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 8 }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, indexAxis: 'y', layout: { padding: { right: 8 } }, scales: { x: { suggestedMin: 0, suggestedMax: 1, ticks: { callback: (v) => Number(v).toFixed(2) } }, y: { ticks: { autoSkip: false, font: { size: 11 } } } } },
        });
      }

      renderScatter(nodes, selected);
      }
      let marketRows = [];
      if ((poiMarketDaily || []).length) {
        let selectedMarketRows = marketScopeRows;
        if (selected) selectedMarketRows = selectedMarketRows.filter(r => String(r.poi_id) === String(selected.poi_id));
        else if (catSelect.value) selectedMarketRows = selectedMarketRows.filter(r => r.poi_cate === catSelect.value);
        marketRows = aggregateMarkets(selectedMarketRows);
      } else if (selected && expPlaces[String(selected.poi_id)]?.markets) {
        marketRows = expPlaces[String(selected.poi_id)].markets.map(m => ({ author_region: m.author_region, journey_n: m.journey_n, stop_n: m.stop_n, avg_stop_sentiment: m.avg_stop_sentiment }));
      }
      const MARKET_THRESHOLD = 3;
      const sortedMarkets = marketRows.length ? marketRows.filter(m => Number(m.journey_n || 0) >= MARKET_THRESHOLD).slice().sort((a, b) => state.marketSort === 'experience' ? (b.avg_stop_sentiment || 0) - (a.avg_stop_sentiment || 0) : (b.journey_n || 0) - (a.journey_n || 0)).slice(0, 5).map(m => ({
        poi_name: m.author_region,
        poi_cate: 'Source market',
        avg_stop_sentiment: m.avg_stop_sentiment,
        journey_n: m.journey_n,
      })) : null;
      renderRanking(MMM.qs('#experience-ranking'), sortedMarkets?.length ? sortedMarkets : topRank);
      drawMap(nodes, selected);

      const flat = synced.datasets[0]?.data?.filter(v => v != null) || [];
      const peak = flat.length ? Math.max(...flat) : null;
      const low = flat.length ? Math.min(...flat) : null;

      if (mode === 'all' || mode === 'trend') {
        renderNote('#experience-trend-insight', selected ? `${selected.poi_name} over time.` : catSelect.value ? `${catSelect.value} against the city average over time.` : 'City average over time.', peak != null ? `The strongest ${state.trendScale} experience level reaches ${fmt2(peak)}, while the weakest reaches ${fmt2(low)}. ${selected ? 'This lets you see whether the selected place stays above or below its category and city baselines through time.' : catSelect.value ? 'This lets you see when the selected category pulls ahead of or falls behind the city average.' : 'This gives you the baseline city rhythm before you drill into categories or places.'}` : 'No trend is visible in the current filter.');
      }

      if (mode === 'all') {
        renderNote('#experience-core-insight', selected ? `${selected.poi_name} in the current experience view.` : catSelect.value ? `${catSelect.value} in the current experience view.` : 'This summary reflects the visible experience footprint.', selected ? `${selected.poi_name} is currently at ${fmt2(selected.avg_stop_sentiment)} average experience, compared with ${fmt2(cityAvgScope)} for the city average and ${fmt2(selectedCategoryAvgScope)} for its category average.` : catSelect.value ? `${catSelect.value} averages ${fmt2(categoryAvgScope)} in the current date window, against ${fmt2(cityAvgScope)} for the city-wide baseline.` : `The visible city average stands at ${fmt2(cityAvgVisible)} across ${MMM.fmtNum(nodes.length)} visible places.`);

        if (selected) {
          const dc = (selected.avg_stop_sentiment || 0) - (cityAvgScope || 0);
          const dg = (selected.avg_stop_sentiment || 0) - (selectedCategoryAvgScope || 0);
          renderNote('#experience-benchmark-insight', `${selected.poi_name} against city and category averages.`, `${selected.poi_name} is ${dc >= 0 ? 'above' : 'below'} the city average by ${fmt2(Math.abs(dc))} and ${dg >= 0 ? 'above' : 'below'} ${selected.poi_cate} by ${fmt2(Math.abs(dg))}. This shows whether the place is outperforming its broader market and its immediate peer group at the same time.`);
        } else if (catBenchScope.length) {
          const lead = catBenchScope[0];
          renderNote('#experience-benchmark-insight', catSelect.value ? `${catSelect.value} against the category field.` : 'Category averages in the current city view.', catSelect.value ? `${catSelect.value} averages ${fmt2(categoryAvgScope)} versus ${fmt2(cityAvgScope)} for the city average. ${lead.poi_cate} is currently the strongest visible category at ${fmt2(lead.avg_stop_sentiment)}.` : `${lead.poi_cate} leads the visible category set at ${fmt2(lead.avg_stop_sentiment)}. The chart shows how the rest of the category field sits relative to that level and to the city average.`);
        } else {
          renderNote('#experience-benchmark-insight', 'Category averages in the current city view.', 'No category benchmark is visible in the current filter.');
        }

        if (nodes.length) {
          const topVolume = nodes.reduce((a, b) => a.journey_n >= b.journey_n ? a : b);
          const topExp = topRank[0];
          renderNote('#experience-scatter-insight', selected ? `${selected.poi_name} in the volume × experience space.` : 'Visible places in the volume × experience space.', selected ? `${selected.poi_name} sits at ${MMM.fmtNum(selected.journey_n)} journeys and ${fmt2(selected.avg_stop_sentiment)} average experience. The log-scaled x-axis makes it easier to compare this position with both very large and much smaller places.` : `${topVolume.poi_name} has the largest visible journey volume, while ${topExp?.poi_name || '—'} has the highest visible average experience. The log-scaled x-axis prevents a few very large places from pushing most points into the far-left edge.`);
        } else {
          renderNote('#experience-scatter-insight', 'Visible places in the volume × experience space.', 'No places are visible in the current filter.');
        }
      }

      if (mode === 'all' || mode === 'ranking') {
        MMM.qs('#experience-ranking-title').textContent = sortedMarkets?.length ? 'Source Market Experience' : 'Highest Visible Experience';
        MMM.qs('#info-exp-ranking').title = sortedMarkets?.length ? 'This ranking shows source markets in the current filter. Use the toggle to sort by experience or by journeys.' : 'This ranking shows the strongest visible average experience in the current filter.';
        if (sortedMarkets?.length) {
          const top = sortedMarkets[0];
          renderNote('#experience-ranking-insight', selected ? `Source markets for ${selected.poi_name}.` : catSelect.value ? `Source markets for ${catSelect.value}.` : 'Source markets in the current city view.', `${top.poi_name} ranks first at ${fmt2(top.avg_stop_sentiment)} with ${MMM.fmtNum(top.journey_n)} journeys. The ranking is currently sorted by ${state.marketSort === 'experience' ? 'average experience' : 'journey volume'}, so you can compare quality-driven and volume-driven source markets in the same section.`);
        } else if (topRank.length) {
          renderNote('#experience-ranking-insight', 'Highest visible experience in the current filter.', `${topRank[0].poi_name} ranks first at ${fmt2(topRank[0].avg_stop_sentiment)} with ${MMM.fmtNum(topRank[0].journey_n)} journeys. This lets you separate high experience that is well-supported by volume from high experience built on only a small number of journeys.`);
        } else {
          renderNote('#experience-ranking-insight', 'Highest visible experience in the current filter.', 'No ranked places are visible in the current filter.');
        }
      }
    }

    MMM.qsa('[data-exp-scale]').forEach(btn => btn.addEventListener('click', () => {
      state.trendScale = btn.dataset.expScale;
      MMM.qsa('[data-exp-scale]').forEach(b => b.classList.toggle('active', b === btn));
      render('trend');
    }));
    MMM.qsa('[data-market-sort]').forEach(btn => btn.addEventListener('click', () => {
      state.marketSort = btn.dataset.marketSort;
      MMM.qsa('[data-market-sort]').forEach(b => b.classList.toggle('active', b === btn));
      render('ranking');
    }));
    [startInput, endInput, catSelect, focalOnly].forEach(el => el.addEventListener('change', render));
    resetBtn.addEventListener('click', () => {
      state.selectedPlaceId = '';
      startInput.value = defaultStart;
      endInput.value = meta.max_date;
      catSelect.value = '';
      focalOnly.checked = false;
      MMM.setParam({ place: null });
      map.setView(defaultCenter, defaultZoom);
      render();
    });

    render();
  } catch (err) {
    console.error(err);
  }
});
