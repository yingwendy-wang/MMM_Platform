document.addEventListener('DOMContentLoaded', async () => {
  try {
    const EXP_THRESHOLD = 3;
    const DEFAULT_CENTER = [22.38, 114.2];
    const DEFAULT_ZOOM = 11;

    const [meta, places, coDaily, flowDaily] = await Promise.all([
      MMM.fetchJSON('explorer/meta.json'),
      MMM.fetchJSON('dictionaries/places.json'),
      MMM.fetchJSON('explorer/cooccur_daily.json'),
      MMM.fetchJSON('explorer/flow_daily.json'),
    ]);

    const placeLookup = new Map(places.map(p => [String(p.poi_id), p]));
    const state = {
      selectedPlaceId: MMM.getParam('place') || '',
      map: null,
      mapLayer: null,
      visiblePlaceOptions: places,
    };

    const startInput = MMM.qs('#network-start');
    const endInput = MMM.qs('#network-end');
    const catSelect = MMM.qs('#network-category');
    const placeInput = MMM.qs('#network-place-search');
    const placeList = MMM.qs('#network-place-list');
    const focalOnly = MMM.qs('#network-focal');
    const resetBtn = MMM.qs('#network-reset');

    const defaultStart = (meta.min_date && meta.min_date > '2024-01-01') ? meta.min_date : '2024-01-01';
    startInput.value = defaultStart;
    endInput.value = meta.max_date;
    focalOnly.checked = false;
    catSelect.innerHTML = `<option value="">All categories</option>${(meta.categories || []).map(c => `<option value="${c}">${c}</option>`).join('')}`;

    MMM.qsa('#network-card-3 .info-chip, #network-card-4 .info-chip').forEach(el => {
      el.title = `This ranking keeps only pair relationships with at least ${EXP_THRESHOLD} visible co-occurrences before sorting by average experience.`;
    });
    MMM.qsa('#network-card-5 .info-chip, #network-card-6 .info-chip').forEach(el => {
      el.title = `This ranking keeps only directional relationships with at least ${EXP_THRESHOLD} visible journeys before sorting by average experience.`;
    });

    function n(v) {
      const x = Number(v);
      return Number.isFinite(x) ? x : null;
    }
    function fmt2(v) {
      const x = Number(v);
      return Number.isFinite(x) ? x.toFixed(2) : '—';
    }
    function getPlace(id) {
      return placeLookup.get(String(id)) || {};
    }
    function isFocal(poiId, rowFocal) {
      return Number(rowFocal) === 1 || Number(getPlace(poiId)?.is_focal) === 1;
    }
    function coords(rowLat, rowLng, place) {
      const lat = n(rowLat) ?? n(place?.poi_lat);
      const lng = n(rowLng) ?? n(place?.poi_lng);
      return { lat, lng };
    }
    function weighted(sum, w) {
      return w ? sum / w : null;
    }
    function pct(part, whole) {
      return whole ? `${((part / whole) * 100).toFixed(1)}%` : '—';
    }
    function clamp(v, min, max) {
      return Math.max(min, Math.min(max, v));
    }
    function hasCoord(obj, latKey, lngKey) {
      return Number.isFinite(Number(obj?.[latKey])) && Number.isFinite(Number(obj?.[lngKey]));
    }

    function updatePlaceOptions() {
      state.visiblePlaceOptions = places
        .filter(p => !focalOnly.checked || Number(p.is_focal) === 1)
        .filter(p => !catSelect.value || p.poi_cate === catSelect.value)
        .sort((a, b) => String(a.poi_name).localeCompare(String(b.poi_name)));
      placeList.innerHTML = state.visiblePlaceOptions
        .map(p => `<option value="${String(p.poi_name).replace(/"/g, '&quot;')}"></option>`)
        .join('');
    }

    function resolvePlaceInput() {
      const raw = placeInput.value.trim().toLowerCase();
      if (!raw) return '';
      const exact = state.visiblePlaceOptions.find(p => String(p.poi_name).toLowerCase() === raw);
      return exact ? String(exact.poi_id) : '';
    }

    function filtered() {
      let co = MMM.inRange(coDaily, startInput.value, endInput.value);
      let fl = MMM.inRange(flowDaily, startInput.value, endInput.value);

      if (catSelect.value) {
        co = co.filter(r => r.poi_a_cate === catSelect.value || r.poi_b_cate === catSelect.value);
        fl = fl.filter(r => r.origin_poi_cate === catSelect.value || r.dest_poi_cate === catSelect.value);
      }

      if (focalOnly.checked) {
        co = co.filter(r => isFocal(r.poi_a_id, r.poi_a_is_focal) || isFocal(r.poi_b_id, r.poi_b_is_focal));
        fl = fl.filter(r => isFocal(r.origin_poi_id, r.origin_is_focal) || isFocal(r.dest_poi_id, r.dest_is_focal));
      }

      return { co, fl };
    }

    function companionPairs(rows) {
      const m = new Map();
      rows.forEach(r => {
        const a = String(r.poi_a_id), b = String(r.poi_b_id);
        const [id1, id2] = [a, b].sort((x, y) => Number(x) - Number(y));
        const p1 = getPlace(id1), p2 = getPlace(id2);
        const key = `${id1}__${id2}`;
        const c1 = id1 === a ? coords(r.poi_a_lat, r.poi_a_lng, p1) : coords(r.poi_b_lat, r.poi_b_lng, p1);
        const c2 = id2 === b ? coords(r.poi_b_lat, r.poi_b_lng, p2) : coords(r.poi_a_lat, r.poi_a_lng, p2);
        if (!m.has(key)) {
          m.set(key, {
            pair_key: key,
            poi_a_id: id1, poi_a_name: p1.poi_name || (id1 === a ? r.poi_a_name : r.poi_b_name), poi_a_cate: p1.poi_cate || (id1 === a ? r.poi_a_cate : r.poi_b_cate), poi_a_lat: c1.lat, poi_a_lng: c1.lng,
            poi_b_id: id2, poi_b_name: p2.poi_name || (id2 === b ? r.poi_b_name : r.poi_a_name), poi_b_cate: p2.poi_cate || (id2 === b ? r.poi_b_cate : r.poi_a_cate), poi_b_lat: c2.lat, poi_b_lng: c2.lng,
            cooccur_n: 0, exp_sum: 0,
          });
        }
        const v = m.get(key);
        const cnt = Number(r.cooccur_n || 0);
        v.cooccur_n += cnt;
        v.exp_sum += Number(r.avg_journey_sentiment || 0) * cnt;
      });
      return [...m.values()]
        .map(v => ({ ...v, avg_journey_sentiment: weighted(v.exp_sum, v.cooccur_n) }))
        .sort((a, b) => b.cooccur_n - a.cooccur_n);
    }

    function directionalSequences(rows) {
      const m = new Map();
      rows.forEach(r => {
        const key = `${r.origin_poi_id}__${r.dest_poi_id}`;
        const op = getPlace(r.origin_poi_id), dp = getPlace(r.dest_poi_id);
        const co = coords(r.origin_lat, r.origin_lng, op);
        const cd = coords(r.dest_lat, r.dest_lng, dp);
        if (!m.has(key)) {
          m.set(key, {
            seq_key: key,
            origin_poi_id: String(r.origin_poi_id), origin_poi_name: op.poi_name || r.origin_poi_name, origin_poi_cate: op.poi_cate || r.origin_poi_cate, origin_lat: co.lat, origin_lng: co.lng,
            dest_poi_id: String(r.dest_poi_id), dest_poi_name: dp.poi_name || r.dest_poi_name, dest_poi_cate: dp.poi_cate || r.dest_poi_cate, dest_lat: cd.lat, dest_lng: cd.lng,
            flow_n: 0, exp_sum: 0,
          });
        }
        const v = m.get(key);
        const cnt = Number(r.flow_n || 0);
        v.flow_n += cnt;
        v.exp_sum += Number(r.avg_edge_sentiment || 0) * cnt;
      });
      return [...m.values()]
        .map(v => ({ ...v, avg_edge_sentiment: weighted(v.exp_sum, v.flow_n) }))
        .sort((a, b) => b.flow_n - a.flow_n);
    }

    function placeDrill(placeId, pairs, seqs) {
      const place = getPlace(placeId);
      const companions = pairs
        .filter(p => p.poi_a_id === String(placeId) || p.poi_b_id === String(placeId))
        .map(p => ({
          companion_poi_id: p.poi_a_id === String(placeId) ? p.poi_b_id : p.poi_a_id,
          companion_poi_name: p.poi_a_id === String(placeId) ? p.poi_b_name : p.poi_a_name,
          companion_poi_cate: p.poi_a_id === String(placeId) ? p.poi_b_cate : p.poi_a_cate,
          cooccur_n: p.cooccur_n,
          avg_journey_sentiment: p.avg_journey_sentiment,
        }))
        .sort((a, b) => b.cooccur_n - a.cooccur_n);

      const before = seqs.filter(s => s.dest_poi_id === String(placeId)).sort((a, b) => b.flow_n - a.flow_n);
      const after = seqs.filter(s => s.origin_poi_id === String(placeId)).sort((a, b) => b.flow_n - a.flow_n);
      const topExpPairs = companions.filter(r => Number(r.cooccur_n) >= EXP_THRESHOLD).sort((a, b) => (b.avg_journey_sentiment || 0) - (a.avg_journey_sentiment || 0));
      const lowExpPairs = companions.filter(r => Number(r.cooccur_n) >= EXP_THRESHOLD).sort((a, b) => (a.avg_journey_sentiment || 0) - (b.avg_journey_sentiment || 0));
      const seqBlend = [
        ...before.map(r => ({ ...r, direction: 'Before', label: `${r.origin_poi_name} → ${place.poi_name}` })),
        ...after.map(r => ({ ...r, direction: 'After', label: `${place.poi_name} → ${r.dest_poi_name}` }))
      ].filter(r => Number(r.flow_n) >= EXP_THRESHOLD);
      const topExpSeq = [...seqBlend].sort((a, b) => (b.avg_edge_sentiment || 0) - (a.avg_edge_sentiment || 0));
      const lowExpSeq = [...seqBlend].sort((a, b) => (a.avg_edge_sentiment || 0) - (b.avg_edge_sentiment || 0));
      return { companions, before, after, topExpPairs, lowExpPairs, topExpSeq, lowExpSeq };
    }

    function citySignals(pairs, seqs) {
      const expPairs = pairs.filter(p => Number(p.cooccur_n) >= EXP_THRESHOLD).sort((a, b) => (b.avg_journey_sentiment || 0) - (a.avg_journey_sentiment || 0));
      const lowPairs = pairs.filter(p => Number(p.cooccur_n) >= EXP_THRESHOLD).sort((a, b) => (a.avg_journey_sentiment || 0) - (b.avg_journey_sentiment || 0));
      const expSeqs = seqs.filter(s => Number(s.flow_n) >= EXP_THRESHOLD).sort((a, b) => (b.avg_edge_sentiment || 0) - (a.avg_edge_sentiment || 0));
      const totalPairs = pairs.reduce((a, r) => a + Number(r.cooccur_n || 0), 0);
      const totalSeqs = seqs.reduce((a, r) => a + Number(r.flow_n || 0), 0);
      const out = [];
      if (pairs[0]) out.push({
        type: 'Partnership signal',
        title: `${pairs[0].poi_a_name} + ${pairs[0].poi_b_name}`,
        detail: `This is the strongest visible companion pair in the current filter, with ${MMM.fmtNum(pairs[0].cooccur_n)} shared journeys. That equals ${pct(pairs[0].cooccur_n, totalPairs)} of all visible pair occurrences, making it the clearest existing partnership anchor in the network.`
      });
      if (expPairs[0]) out.push({
        type: 'Quality signal',
        title: `${expPairs[0].poi_a_name} + ${expPairs[0].poi_b_name}`,
        detail: `Among pairs that clear the ${EXP_THRESHOLD}-journey threshold, this one leads on visible experience at ${fmt2(expPairs[0].avg_journey_sentiment)} across ${MMM.fmtNum(expPairs[0].cooccur_n)} co-occurrences. It is the strongest high-quality pairing currently visible in the city network.`
      });
      if (lowPairs[0]) out.push({
        type: 'Risk signal',
        title: `${lowPairs[0].poi_a_name} + ${lowPairs[0].poi_b_name}`,
        detail: `This pair also clears the threshold, but sits lowest on visible experience at ${fmt2(lowPairs[0].avg_journey_sentiment)} across ${MMM.fmtNum(lowPairs[0].cooccur_n)} co-occurrences. It is the clearest weak pairing signal in the current filter.`
      });
      if (expSeqs[0] && out.length < 3) out.push({
        type: 'Sequencing signal',
        title: `${expSeqs[0].origin_poi_name} → ${expSeqs[0].dest_poi_name}`,
        detail: `This is the strongest high-experience sequence that also clears the ${EXP_THRESHOLD}-journey threshold, with ${MMM.fmtNum(expSeqs[0].flow_n)} journeys at ${fmt2(expSeqs[0].avg_edge_sentiment)} average experience. It accounts for ${pct(expSeqs[0].flow_n, totalSeqs)} of all visible directional journeys.`
      });
      return out.slice(0, 3);
    }

    function placeSignals(placeName, drill) {
      const cards = [];
      const totalBefore = drill.before.reduce((a, r) => a + Number(r.flow_n || 0), 0);
      const totalAfter = drill.after.reduce((a, r) => a + Number(r.flow_n || 0), 0);
      if (drill.before[0]) cards.push({
        type: 'Lead-in signal',
        title: `${drill.before[0].origin_poi_name} feeds into ${placeName}`,
        detail: `${drill.before[0].origin_poi_name} is the strongest visible lead-in, sending ${MMM.fmtNum(drill.before[0].flow_n)} journeys into ${placeName}. That equals ${pct(drill.before[0].flow_n, totalBefore)} of all visible lead-ins, so it is the clearest feeder relationship around the selected place.`
      });
      if (drill.topExpPairs[0]) cards.push({
        type: 'Quality signal',
        title: `${placeName} + ${drill.topExpPairs[0].companion_poi_name}`,
        detail: `Among companion relationships that pass the ${EXP_THRESHOLD}-journey threshold, this pairing performs best on visible experience at ${fmt2(drill.topExpPairs[0].avg_journey_sentiment)} across ${MMM.fmtNum(drill.topExpPairs[0].cooccur_n)} co-occurrences. It is the clearest high-quality relationship around ${placeName}.`
      });
      if (drill.lowExpSeq[0]) cards.push({
        type: 'Risk signal',
        title: drill.lowExpSeq[0].label,
        detail: `This sequence clears the threshold, but sits lowest on visible experience at ${fmt2(drill.lowExpSeq[0].avg_edge_sentiment)} across ${MMM.fmtNum(drill.lowExpSeq[0].flow_n)} journeys. It is the clearest weak route signal around ${placeName}.`
      });
      if (drill.after[0] && cards.length < 3) cards.push({
        type: 'Next-stop signal',
        title: `${placeName} → ${drill.after[0].dest_poi_name}`,
        detail: `${drill.after[0].dest_poi_name} is the strongest visible next stop after ${placeName}, capturing ${MMM.fmtNum(drill.after[0].flow_n)} journeys, or ${pct(drill.after[0].flow_n, totalAfter)} of all visible outbound movement from the selected place.`
      });
      return cards.slice(0, 3);
    }

    function metricPair(aVal, aLabel, bVal, bLabel) {
      return `<div class="network-metric-stack"><span><strong>${aVal}</strong> ${aLabel}</span><span><strong>${bVal}</strong> ${bLabel}</span></div>`;
    }

    function renderRows(node, rows, makeHtml, emptyText) {
      if (!rows?.length) {
        node.innerHTML = `<div class="empty">${emptyText}</div>`;
        return;
      }
      node.innerHTML = `<div class="network-list">${rows.map(makeHtml).join('')}</div>`;
    }

    function rowTemplate(i, title, sub, metricHtml, tone='neutral') {
      return `<div class="network-row-btn tone-${tone}"><span class="network-rank">${i + 1}</span><span class="network-main"><strong>${title}</strong><small>${sub || ''}</small></span><span class="network-metric">${metricHtml}</span></div>`;
    }

    function renderPairList(node, rows, mode='pair', tone='neutral') {
      renderRows(node, rows.slice(0, 5), (r, i) => {
        const title = mode === 'pair' ? `${r.poi_a_name} + ${r.poi_b_name}` : `${r.origin_poi_name} → ${r.dest_poi_name}`;
        const sub = mode === 'pair' ? `${r.poi_a_cate} × ${r.poi_b_cate}` : `${r.origin_poi_cate} → ${r.dest_poi_cate}`;
        const metric = mode === 'pair'
          ? metricPair(MMM.fmtNum(r.cooccur_n), 'co-occ.', fmt2(r.avg_journey_sentiment), 'avg. exp')
          : metricPair(MMM.fmtNum(r.flow_n), 'journeys', fmt2(r.avg_edge_sentiment), 'avg. exp');
        return rowTemplate(i, title, sub, metric, tone);
      }, 'No relationships are visible in the current filter.');
    }

    function renderCompanionList(node, rows, tone='neutral') {
      renderRows(node, rows.slice(0, 5), (r, i) => rowTemplate(i, r.companion_poi_name, r.companion_poi_cate, metricPair(MMM.fmtNum(r.cooccur_n), 'co-occ.', fmt2(r.avg_journey_sentiment), 'avg. exp'), tone), `No companion places meet the current filter.`);
    }

    function renderSeqList(node, rows, mode='before', tone=mode === 'before' ? 'before' : 'after') {
      renderRows(node, rows.slice(0, 5), (r, i) => {
        const title = mode === 'before' ? r.origin_poi_name : r.dest_poi_name;
        const sub = mode === 'before' ? r.origin_poi_cate : r.dest_poi_cate;
        const metric = metricPair(MMM.fmtNum(r.flow_n), 'journeys', fmt2(r.avg_edge_sentiment), 'avg. exp');
        return rowTemplate(i, title, sub, metric, tone);
      }, mode === 'before' ? 'No visible lead-in places.' : 'No visible next-stop places.');
    }

    function renderExpCompanionList(node, rows, tone='high') {
      renderRows(node, rows.slice(0, 5), (r, i) => rowTemplate(i, r.companion_poi_name, r.companion_poi_cate, metricPair(fmt2(r.avg_journey_sentiment), 'avg. exp', MMM.fmtNum(r.cooccur_n), 'co-occ.'), tone), `No companion relationships meet the threshold of ${EXP_THRESHOLD} co-occurrences.`);
    }

    function renderExpSequenceList(node, rows, tone='high') {
      renderRows(node, rows.slice(0, 5), (r, i) => rowTemplate(i, r.label, r.direction, metricPair(fmt2(r.avg_edge_sentiment), 'avg. exp', MMM.fmtNum(r.flow_n), 'journeys'), tone), `No sequences meet the threshold of ${EXP_THRESHOLD} journeys.`);
    }

    function buildCurvedPath(a, b) {
      const lat1 = Number(a.lat), lng1 = Number(a.lng), lat2 = Number(b.lat), lng2 = Number(b.lng);
      if (![lat1,lng1,lat2,lng2].every(Number.isFinite)) return null;
      const midLat = (lat1 + lat2) / 2;
      const midLng = (lng1 + lng2) / 2;
      const dx = lng2 - lng1;
      const dy = lat2 - lat1;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const curve = clamp(len * 0.18, 0.02, 0.18);
      const ctrlLat = midLat + ny * curve;
      const ctrlLng = midLng + nx * curve;
      const pts = [];
      for (let t = 0; t <= 1.0001; t += 0.08) {
        const lat = (1 - t) * (1 - t) * lat1 + 2 * (1 - t) * t * ctrlLat + t * t * lat2;
        const lng = (1 - t) * (1 - t) * lng1 + 2 * (1 - t) * t * ctrlLng + t * t * lng2;
        pts.push([lat, lng]);
      }
      return pts;
    }

    function renderMap(pairs, seqs) {
      if (!state.map) {
        state.map = MMM.map('network-map');
        state.map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
        state.mapLayer = L.layerGroup().addTo(state.map);
      }
      state.mapLayer.clearLayers();

      const visiblePoints = new Map();
      const addPoint = (id, name, cate, lat, lng, focal) => {
        if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;
        if (!visiblePoints.has(String(id))) visiblePoints.set(String(id), { id: String(id), name, cate, lat: Number(lat), lng: Number(lng), focal: Number(focal) === 1 || Number(getPlace(id)?.is_focal) === 1 });
      };

      pairs.forEach(p => {
        addPoint(p.poi_a_id, p.poi_a_name, p.poi_a_cate, p.poi_a_lat, p.poi_a_lng, getPlace(p.poi_a_id)?.is_focal);
        addPoint(p.poi_b_id, p.poi_b_name, p.poi_b_cate, p.poi_b_lat, p.poi_b_lng, getPlace(p.poi_b_id)?.is_focal);
      });
      seqs.forEach(s => {
        addPoint(s.origin_poi_id, s.origin_poi_name, s.origin_poi_cate, s.origin_lat, s.origin_lng, getPlace(s.origin_poi_id)?.is_focal);
        addPoint(s.dest_poi_id, s.dest_poi_name, s.dest_poi_cate, s.dest_lat, s.dest_lng, getPlace(s.dest_poi_id)?.is_focal);
      });

      // points visible by mode
      let pointList = [...visiblePoints.values()];
      if (focalOnly.checked) pointList = pointList.filter(p => p.focal);

      const legend = MMM.qs('#network-map-legend');
      legend.innerHTML = '';

      if (state.selectedPlaceId) {
        const before = seqs.filter(s => s.dest_poi_id === String(state.selectedPlaceId)).slice(0, 8);
        const after = seqs.filter(s => s.origin_poi_id === String(state.selectedPlaceId)).slice(0, 8);
        const allFlows = [...before, ...after];
        const maxFlow = Math.max(...allFlows.map(r => Number(r.flow_n || 0)), 1);

        before.forEach(r => {
          const path = buildCurvedPath({ lat: r.origin_lat, lng: r.origin_lng }, { lat: r.dest_lat, lng: r.dest_lng });
          if (!path) return;
          L.polyline(path, { color: '#cf6a67', weight: 1.4 + (Number(r.flow_n || 0) / maxFlow) * 5.5, opacity: 0.78, smoothFactor: 1 }).addTo(state.mapLayer);
        });
        after.forEach(r => {
          const path = buildCurvedPath({ lat: r.origin_lat, lng: r.origin_lng }, { lat: r.dest_lat, lng: r.dest_lng });
          if (!path) return;
          L.polyline(path, { color: '#5f9f75', weight: 1.4 + (Number(r.flow_n || 0) / maxFlow) * 5.5, opacity: 0.78, smoothFactor: 1 }).addTo(state.mapLayer);
        });

        const inboundIds = new Set(before.map(r => String(r.origin_poi_id)));
        const outboundIds = new Set(after.map(r => String(r.dest_poi_id)));

        pointList.forEach(p => {
          let color = '#98a6b6';
          let radius = 5.5;
          if (String(p.id) === String(state.selectedPlaceId)) { color = '#e48b4b'; radius = 8.5; }
          else if (outboundIds.has(String(p.id))) { color = '#5f9f75'; radius = 6.6; }
          else if (inboundIds.has(String(p.id))) { color = '#cf6a67'; radius = 6.6; }
          const marker = L.circleMarker([p.lat, p.lng], { radius, fillColor: color, color: 'transparent', weight: 0, fillOpacity: 0.96 });
          marker.bindTooltip(`<strong>${p.name}</strong><br>${p.cate || 'Place'}`);
          marker.on('click', () => {
            if (String(state.selectedPlaceId) !== String(p.id)) {
              state.selectedPlaceId = String(p.id);
              placeInput.value = p.name;
              MMM.setParam({ place: p.id });
              render();
            }
          });
          marker.addTo(state.mapLayer);
        });

        legend.innerHTML = `
          <span><i class="legend-swatch-map selected"></i> Selected place</span>
          <span><i class="legend-swatch-map outbound"></i> Strongest outbound links and places</span>
          <span><i class="legend-swatch-map inbound"></i> Strongest inbound links and places</span>
          <span><i class="legend-swatch-map other"></i> Other visible places</span>`;
      } else {
        const lines = seqs.slice(0, 16);
        const maxFlow = Math.max(...lines.map(r => Number(r.flow_n || 0)), 1);
        lines.forEach(r => {
          const path = buildCurvedPath({ lat: r.origin_lat, lng: r.origin_lng }, { lat: r.dest_lat, lng: r.dest_lng });
          if (!path) return;
          L.polyline(path, { color: '#87a0bf', weight: 1.1 + (Number(r.flow_n || 0) / maxFlow) * 4.8, opacity: 0.52, smoothFactor: 1 }).addTo(state.mapLayer);
        });

        pointList.forEach(p => {
          const color = p.focal ? '#5b8fd8' : '#a9b4c2';
          const radius = p.focal ? 6.8 : 4.8;
          const marker = L.circleMarker([p.lat, p.lng], { radius, fillColor: color, color: 'transparent', weight: 0, fillOpacity: 0.95 });
          marker.bindTooltip(`<strong>${p.name}</strong><br>${p.cate || 'Place'}`);
          marker.on('click', () => {
            state.selectedPlaceId = String(p.id);
            placeInput.value = p.name;
            MMM.setParam({ place: p.id });
            render();
          });
          marker.addTo(state.mapLayer);
        });

        legend.innerHTML = `
          <span><i class="legend-swatch-map focal"></i> Focal places</span>
          <span><i class="legend-swatch-map other"></i> Other visible places</span>
          <span><i class="legend-line-map"></i> Strongest visible directional links</span>`;
      }
    }

    function showCityCards(pairs, seqs) {
      MMM.qs('#network-mode-head').classList.add('hidden');
      MMM.qs('#network-block-1-title').textContent = 'Top Companion Pairs';
      MMM.qs('#network-block-2-title').textContent = 'Top Directional Sequences';
      MMM.qs('#network-block-3-title').textContent = 'Top Experience Pairs';
      MMM.qs('#network-block-4-title').textContent = 'Lowest Experience Pairs';
      MMM.qs('#network-block-5-title').textContent = 'Top Experience Sequences';
      MMM.qs('#network-block-6-title').textContent = 'Lowest Experience Sequences';
      MMM.qs('#network-block-7-title').textContent = 'Opportunity Signals';

      const expPairs = pairs.filter(p => Number(p.cooccur_n) >= EXP_THRESHOLD).sort((a, b) => (b.avg_journey_sentiment || 0) - (a.avg_journey_sentiment || 0));
      const lowPairs = pairs.filter(p => Number(p.cooccur_n) >= EXP_THRESHOLD).sort((a, b) => (a.avg_journey_sentiment || 0) - (b.avg_journey_sentiment || 0));
      const expSeqs = seqs.filter(s => Number(s.flow_n) >= EXP_THRESHOLD).sort((a, b) => (b.avg_edge_sentiment || 0) - (a.avg_edge_sentiment || 0));
      const lowSeqs = seqs.filter(s => Number(s.flow_n) >= EXP_THRESHOLD).sort((a, b) => (a.avg_edge_sentiment || 0) - (b.avg_edge_sentiment || 0));

      renderPairList(MMM.qs('#network-block-1'), pairs, 'pair', 'neutral');
      renderPairList(MMM.qs('#network-block-2'), seqs, 'seq', 'neutral');
      renderPairList(MMM.qs('#network-block-3'), expPairs, 'pair', 'high');
      renderPairList(MMM.qs('#network-block-4'), lowPairs, 'pair', 'low');
      renderPairList(MMM.qs('#network-block-5'), expSeqs, 'seq', 'high');
      renderPairList(MMM.qs('#network-block-6'), lowSeqs, 'seq', 'low');
      MMM.renderCards(MMM.qs('#network-block-7'), citySignals(pairs, seqs));

      MMM.qs('#network-block-1-note').innerHTML = pairs[0] ? `<strong>This block shows which place pairs most often belong to the same wider journey.</strong> ${pairs[0].poi_a_name} + ${pairs[0].poi_b_name} is the strongest visible pair, with ${MMM.fmtNum(pairs[0].cooccur_n)} co-occurrences.` : 'No companion pairs are visible.';
      MMM.qs('#network-block-2-note').innerHTML = seqs[0] ? `<strong>This block shows where movement has the clearest visible direction.</strong> ${seqs[0].origin_poi_name} → ${seqs[0].dest_poi_name} is the strongest visible directional journey, with ${MMM.fmtNum(seqs[0].flow_n)} journeys.` : 'No directional sequences are visible.';
      MMM.qs('#network-block-3-note').innerHTML = expPairs[0] ? `<strong>This block highlights the highest-experience pairs that clear the ${EXP_THRESHOLD}-co-occurrence threshold.</strong> ${expPairs[0].poi_a_name} + ${expPairs[0].poi_b_name} leads at ${fmt2(expPairs[0].avg_journey_sentiment)} average experience.` : `No pairs clear the ${EXP_THRESHOLD}-co-occurrence threshold.`;
      MMM.qs('#network-block-4-note').innerHTML = lowPairs[0] ? `<strong>This block surfaces the weakest pair experiences among pairs that still clear the threshold.</strong> ${lowPairs[0].poi_a_name} + ${lowPairs[0].poi_b_name} sits lowest at ${fmt2(lowPairs[0].avg_journey_sentiment)}.` : `No pairs clear the ${EXP_THRESHOLD}-co-occurrence threshold.`;
      MMM.qs('#network-block-5-note').innerHTML = expSeqs[0] ? `<strong>This block shows which directional journeys combine relationship quality and minimum scale.</strong> ${expSeqs[0].origin_poi_name} → ${expSeqs[0].dest_poi_name} leads at ${fmt2(expSeqs[0].avg_edge_sentiment)} average experience.` : `No sequences clear the ${EXP_THRESHOLD}-journey threshold.`;
      MMM.qs('#network-block-6-note').innerHTML = lowSeqs[0] ? `<strong>This block surfaces the weakest visible journey experiences among sequences that still clear the threshold.</strong> ${lowSeqs[0].origin_poi_name} → ${lowSeqs[0].dest_poi_name} sits lowest at ${fmt2(lowSeqs[0].avg_edge_sentiment)}.` : `No sequences clear the ${EXP_THRESHOLD}-journey threshold.`;
      MMM.qs('#network-hero-note').innerHTML = `<strong>This overview shows the strongest visible place-to-place relationships in the current filter.</strong> The wider city network stays in view, while focal places remain easier to spot than the rest.`;
      MMM.qs('#network-hint').textContent = 'You are viewing the city-level network overview. Click a place in the map or use the search box to switch into place mode.';
      MMM.qs('#network-overview-title').textContent = 'City Network Overview';
    }

    function showPlaceCards(placeId, pairs, seqs) {
      const place = getPlace(placeId);
      const drill = placeDrill(placeId, pairs, seqs);
      MMM.qs('#network-mode-head').classList.remove('hidden');
      MMM.qs('#network-detail-title').textContent = place.poi_name || 'Selected place';
      MMM.qs('#network-detail-sub').textContent = `${place.poi_cate || ''} · the blocks below now focus on this place while the map keeps the wider city network in view.`;
      MMM.qs('#network-open-report').href = `report.html?place=${placeId}`;

      MMM.qs('#network-block-1-title').textContent = 'Top Before Places';
      MMM.qs('#network-block-2-title').textContent = 'Top After Places';
      MMM.qs('#network-block-3-title').textContent = 'Top Experience Pairs';
      MMM.qs('#network-block-4-title').textContent = 'Lowest Experience Pairs';
      MMM.qs('#network-block-5-title').textContent = 'Top Experience Sequences';
      MMM.qs('#network-block-6-title').textContent = 'Lowest Experience Sequences';
      MMM.qs('#network-block-7-title').textContent = 'Opportunity Signals';

      renderSeqList(MMM.qs('#network-block-1'), drill.before, 'before', 'before');
      renderSeqList(MMM.qs('#network-block-2'), drill.after, 'after', 'after');
      renderExpCompanionList(MMM.qs('#network-block-3'), drill.topExpPairs, 'high');
      renderExpCompanionList(MMM.qs('#network-block-4'), drill.lowExpPairs, 'low');
      renderExpSequenceList(MMM.qs('#network-block-5'), drill.topExpSeq, 'high');
      renderExpSequenceList(MMM.qs('#network-block-6'), drill.lowExpSeq, 'low');
      MMM.renderCards(MMM.qs('#network-block-7'), placeSignals(place.poi_name || 'This place', drill));

      MMM.qs('#network-block-1-note').innerHTML = drill.before[0] ? `<strong>This block shows the strongest visible lead-in places before ${place.poi_name}.</strong> ${drill.before[0].origin_poi_name} is the strongest lead-in, with ${MMM.fmtNum(drill.before[0].flow_n)} journeys.` : `No visible lead-in places are available for ${place.poi_name}.`;
      MMM.qs('#network-block-2-note').innerHTML = drill.after[0] ? `<strong>This block shows the strongest visible next stops after ${place.poi_name}.</strong> ${drill.after[0].dest_poi_name} is the strongest next stop, with ${MMM.fmtNum(drill.after[0].flow_n)} journeys.` : `No visible next-stop places are available for ${place.poi_name}.`;
      MMM.qs('#network-block-3-note').innerHTML = drill.topExpPairs[0] ? `<strong>This block keeps only companion relationships around ${place.poi_name} that clear the ${EXP_THRESHOLD}-co-occurrence threshold.</strong> ${place.poi_name} + ${drill.topExpPairs[0].companion_poi_name} leads at ${fmt2(drill.topExpPairs[0].avg_journey_sentiment)} average experience.` : `No companion relationships around ${place.poi_name} clear the ${EXP_THRESHOLD}-co-occurrence threshold.`;
      MMM.qs('#network-block-4-note').innerHTML = drill.lowExpPairs[0] ? `<strong>This block surfaces the weakest companion experiences around ${place.poi_name} among relationships that still clear the threshold.</strong> ${place.poi_name} + ${drill.lowExpPairs[0].companion_poi_name} sits lowest at ${fmt2(drill.lowExpPairs[0].avg_journey_sentiment)}.` : `No companion relationships around ${place.poi_name} clear the ${EXP_THRESHOLD}-co-occurrence threshold.`;
      MMM.qs('#network-block-5-note').innerHTML = drill.topExpSeq[0] ? `<strong>This block shows the strongest visible sequence quality around ${place.poi_name} among routes that clear the ${EXP_THRESHOLD}-journey threshold.</strong> ${drill.topExpSeq[0].label} leads at ${fmt2(drill.topExpSeq[0].avg_edge_sentiment)}.` : `No sequences around ${place.poi_name} clear the ${EXP_THRESHOLD}-journey threshold.`;
      MMM.qs('#network-block-6-note').innerHTML = drill.lowExpSeq[0] ? `<strong>This block surfaces the weakest visible sequence quality around ${place.poi_name} among routes that still clear the threshold.</strong> ${drill.lowExpSeq[0].label} sits lowest at ${fmt2(drill.lowExpSeq[0].avg_edge_sentiment)}.` : `No sequences around ${place.poi_name} clear the ${EXP_THRESHOLD}-journey threshold.`;
      MMM.qs('#network-hero-note').innerHTML = `<strong>The wider city network remains visible, but the colored lines now show how ${place.poi_name} connects to the rest of the network.</strong> Green links show the strongest visible next stops after the selected place, while red links show the strongest visible lead-ins into it.`;
      MMM.qs('#network-hint').textContent = `You are viewing ${place.poi_name}. The relationship blocks now focus on this place while the map keeps the wider city network in view.`;
      MMM.qs('#network-overview-title').textContent = `${place.poi_name} in the City Network`;
    }

    function render() {
      updatePlaceOptions();
      const { co, fl } = filtered();
      const pairs = companionPairs(co);
      const seqs = directionalSequences(fl);
      renderMap(pairs, seqs);
      if (state.selectedPlaceId) showPlaceCards(state.selectedPlaceId, pairs, seqs);
      else showCityCards(pairs, seqs);
    }

    [startInput, endInput, focalOnly].forEach(el => el.addEventListener('change', () => render()));

    catSelect.addEventListener('change', () => {
      updatePlaceOptions();
      if (state.selectedPlaceId && catSelect.value && getPlace(state.selectedPlaceId).poi_cate !== catSelect.value) {
        state.selectedPlaceId = '';
        placeInput.value = '';
        MMM.setParam({ place: null });
      }
      render();
    });

    placeInput.addEventListener('change', () => {
      const id = resolvePlaceInput();
      if (!id) return;
      state.selectedPlaceId = id;
      placeInput.value = getPlace(id).poi_name || placeInput.value;
      MMM.setParam({ place: id });
      render();
    });

    placeInput.addEventListener('input', () => {
      if (!placeInput.value.trim() && state.selectedPlaceId) {
        state.selectedPlaceId = '';
        MMM.setParam({ place: null });
        render();
      }
    });

    resetBtn.addEventListener('click', () => {
      startInput.value = defaultStart;
      endInput.value = meta.max_date;
      catSelect.value = '';
      focalOnly.checked = true;
      placeInput.value = '';
      state.selectedPlaceId = '';
      MMM.setParam({ place: null });
      if (state.map) state.map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      render();
    });

    if (state.selectedPlaceId) placeInput.value = getPlace(state.selectedPlaceId).poi_name || '';
    render();
  } catch (err) {
    console.error(err);
  }
});
