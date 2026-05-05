document.addEventListener('DOMContentLoaded', async () => {
  try {
    const EXP_THRESHOLD = 3;
    const focals = await MMM.fetchJSON('dictionaries/focal_places.json');
    const meta = await MMM.fetchJSON('explorer/meta.json');
    const [coDaily, flowDaily, poiDaily] = await Promise.all([
      MMM.fetchJSON('explorer/cooccur_daily.json'),
      MMM.fetchJSON('explorer/flow_daily.json'),
      MMM.fetchJSON('explorer/poi_daily.json'),
    ]);

    const placeSelect = MMM.qs('#report-place');
    const placeInput = MMM.qs('#report-place-input');
    const placeList = MMM.qs('#report-place-list');
    const placeClear = MMM.qs('#report-place-clear');
    const compareSelect = MMM.qs('#report-compare');
    const compareInput = MMM.qs('#report-compare-input');
    const compareList = MMM.qs('#report-compare-list');
    const compareChipRail = MMM.qs('#report-compare-chips');
    const compareChipHero = MMM.qs('#report-hero-compare-chips');
    const compareHeroLine = MMM.qs('#report-hero-compare-line');
    const dateStart = MMM.qs('#report-start');
    const dateEnd = MMM.qs('#report-end');
    const resetBtn = MMM.qs('#report-reset');

    const initialPlace = MMM.getParam('place') || String(focals[0]?.poi_id || '');
    const initialCompare = (MMM.getParam('compare') || '').split(',').map(s => String(s).trim()).filter(Boolean).slice(0,3);
    const defaultStart = (meta.min_date && meta.max_date && '2024-01-01' >= meta.min_date && '2024-01-01' <= meta.max_date) ? '2024-01-01' : (meta.min_date || '');
    const defaultEnd = meta.max_date || '';
    dateStart.value = MMM.getParam('start') || defaultStart;
    dateEnd.value = MMM.getParam('end') || defaultEnd;
    MMM.setSelect(placeSelect, focals, { includeAll: false }, initialPlace);
    MMM.setMulti(compareSelect, focals.filter(p => String(p.poi_id) !== String(initialPlace)), initialCompare.filter(v => v !== String(initialPlace)));

    const focalSearchPlaces = (focals || []).slice().sort((a, b) => String(a.poi_name || '').localeCompare(String(b.poi_name || '')));

    function selectedFocalRow() {
      return focals.find(p => String(p.poi_id) === String(placeSelect.value)) || focals[0] || null;
    }
    function updateFocalClear() {
      if (placeClear) placeClear.hidden = !String(placeInput?.value || '').trim();
    }
    function syncFocalInput() {
      if (!placeInput) return;
      const row = selectedFocalRow();
      placeInput.value = row?.poi_name || '';
      updateFocalClear();
    }
    function populateFocalList() {
      if (!placeList) return;
      placeList.innerHTML = focalSearchPlaces.map(p => `<option value="${escapeHtml(p.poi_name)}"></option>`).join('');
    }
    function applyFocalInput() {
      if (!placeInput) return false;
      const name = String(placeInput.value || '').trim();
      const row = focalSearchPlaces.find(p => String(p.poi_name || '').toLowerCase() === name.toLowerCase());
      if (!row) return false;
      const id = String(row.poi_id);
      if (String(placeSelect.value) !== id) {
        placeSelect.value = id;
        resetScaleTabs();
        ensureCompareOptions(placeSelect.value);
        syncCompareChips();
        render();
      }
      syncFocalInput();
      return true;
    }
    function setupFocalSearch() {
      if (!placeInput) return;
      populateFocalList();
      placeInput.addEventListener('focus', () => placeInput.select());
      placeInput.addEventListener('input', updateFocalClear);
      placeInput.addEventListener('change', () => {
        if (!applyFocalInput()) syncFocalInput();
      });
      placeInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (!applyFocalInput()) syncFocalInput();
          placeInput.blur();
        }
        if (event.key === 'Escape') {
          syncFocalInput();
          placeInput.blur();
        }
      });
      if (placeClear) {
        placeClear.addEventListener('click', () => {
          placeInput.value = '';
          updateFocalClear();
          placeInput.focus();
        });
      }
      syncFocalInput();
    }

    const trendScale = { visits: 'weekly', flow: 'weekly', experience: 'weekly' };

    function resetScaleTabs() {
      trendScale.visits = 'weekly';
      trendScale.flow = 'weekly';
      trendScale.experience = 'weekly';
      MMM.qsa('.report-scale-tabs').forEach(group => {
        group.querySelectorAll('.scale-chip').forEach(btn => btn.classList.toggle('active', btn.dataset.scale === 'weekly'));
      });
    }

    const lineColors = ['#1d73ff', '#22a268', '#ea8d45', '#8a56ff'];

    function fmt2(v) {
      const x = Number(v);
      return Number.isFinite(x) ? x.toFixed(2) : '—';
    }
    function pct(part, whole) {
      const p = Number(part || 0), w = Number(whole || 0);
      return w ? `${((p / w) * 100).toFixed(1)}%` : '—';
    }
    function sum(rows, key) { return (rows || []).reduce((a, r) => a + Number(r[key] || 0), 0); }
    function weightedAvg(rows, valueKey, weightKey) {
      const total = sum(rows, weightKey);
      if (!total) return null;
      return rows.reduce((acc, r) => acc + Number(r[valueKey] || 0) * Number(r[weightKey] || 0), 0) / total;
    }
    function escapeHtml(str) {
      return String(str ?? '').replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
    }

    async function loadReport(id) {
      return MMM.fetchJSON(`reports/place_${id}.json`);
    }

    function bucket(date, scale) {
      const d = new Date(date + 'T00:00:00');
      if (scale === 'daily') return date;
      if (scale === 'monthly') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const tmp = new Date(d);
      const day = (tmp.getDay() + 6) % 7;
      tmp.setDate(tmp.getDate() - day);
      return tmp.toISOString().slice(0, 10);
    }
    function formatBucketLabel(dateStr, scale) {
      if (scale === 'monthly') return String(dateStr).slice(0, 7);
      return dateStr;
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
    function trendSeries(rows, scale, start, end, label, valueKey, weightedAverage=false) {
      const by = new Map();
      rows.forEach(r => {
        const k = bucket(r.video_date, scale);
        if (!by.has(k)) by.set(k, { bucket: k, total: 0, expSum: 0, weight: 0 });
        const v = by.get(k);
        if (weightedAverage) {
          const weight = Number(r.stop_n || r.journey_n || 0);
          v.expSum += Number(r[valueKey] || 0) * weight;
          v.weight += weight;
        } else {
          v.total += Number(r[valueKey] || 0);
        }
      });
      const labels = enumerateBuckets(start, end, scale);
      return {
        label,
        rows: labels.map(l => {
          const v = by.get(l);
          return { bucket: l, value: weightedAverage ? (v && v.weight ? v.expSum / v.weight : null) : (v ? v.total : null) };
        })
      };
    }
    function syncSeries(seriesList) {
      const labels = [...new Set(seriesList.flatMap(s => s.rows.map(r => r.bucket)))].sort();
      return {
        labels,
        datasets: seriesList.map((series) => {
          const map = new Map(series.rows.map(r => [r.bucket, r.value]));
          return { label: series.label, data: labels.map(l => map.get(l) ?? null), borderColor: series.borderColor, borderDash: series.borderDash || undefined };
        })
      };
    }

    function selectedCompareIds() {
      return Array.from(compareSelect.selectedOptions).map(o => String(o.value)).filter(Boolean).slice(0, 3);
    }
    function ensureCompareOptions(selectedId) {
      const selectedNow = selectedCompareIds();
      MMM.setMulti(compareSelect, focals.filter(p => String(p.poi_id) !== String(selectedId)), selectedNow.filter(v => v !== String(selectedId)).slice(0, 3));
      const selectedSet = new Set(selectedCompareIds());
      compareList.innerHTML = focals.filter(p => String(p.poi_id) !== String(selectedId) && !selectedSet.has(String(p.poi_id))).map(p => `<option value="${escapeHtml(p.poi_name)}"></option>`).join('');
    }
    function syncCompareChips() {
      const rows = selectedCompareIds().map(id => focals.find(p => String(p.poi_id) === String(id))).filter(Boolean);
      const chips = rows.map(r => `<button class="chip chip-compare" data-remove-compare="${r.poi_id}">${escapeHtml(r.poi_name)} <span aria-hidden="true">×</span></button>`).join('');
      compareChipRail.innerHTML = chips;
      compareChipHero.innerHTML = chips;
      compareHeroLine.classList.toggle('hidden', !rows.length);
      compareInput.disabled = rows.length >= 3;
      compareInput.placeholder = rows.length >= 3 ? 'Up to 3 compare places' : 'Type to add a compare place';
    }
    function addCompareByName(name) {
      const found = focals.find(p => p.poi_name === name);
      if (!found) return;
      const id = String(found.poi_id);
      if (id === String(placeSelect.value)) return;
      const current = new Set(selectedCompareIds());
      if (current.has(id) || current.size >= 3) return;
      Array.from(compareSelect.options).forEach(o => { if (String(o.value) === id) o.selected = true; });
      compareInput.value = '';
      resetScaleTabs();
      ensureCompareOptions(placeSelect.value);
      syncCompareChips();
      render();
    }
    function removeCompareById(id) {
      Array.from(compareSelect.options).forEach(o => { if (String(o.value) === String(id)) o.selected = false; });
      ensureCompareOptions(placeSelect.value);
      syncCompareChips();
      render();
    }

    function buildCompanionPairs(rows) {
      const m = new Map();
      rows.forEach(r => {
        const a = String(r.poi_a_id), b = String(r.poi_b_id);
        const [id1, id2] = [a, b].sort((x, y) => Number(x) - Number(y));
        const key = `${id1}__${id2}`;
        if (!m.has(key)) m.set(key, { id1, id2, name1: id1 === a ? r.poi_a_name : r.poi_b_name, name2: id2 === b ? r.poi_b_name : r.poi_a_name, cate1: id1 === a ? r.poi_a_cate : r.poi_b_cate, cate2: id2 === b ? r.poi_b_cate : r.poi_a_cate, n: 0, expSum: 0 });
        const v = m.get(key);
        const cnt = Number(r.cooccur_n || 0);
        v.n += cnt;
        v.expSum += Number(r.avg_journey_sentiment || 0) * cnt;
      });
      return [...m.values()].map(v => ({ ...v, avg: v.n ? v.expSum / v.n : null })).sort((a, b) => b.n - a.n);
    }
    function buildSequences(rows) {
      const m = new Map();
      rows.forEach(r => {
        const key = `${r.origin_poi_id}__${r.dest_poi_id}`;
        if (!m.has(key)) m.set(key, { originId: String(r.origin_poi_id), originName: r.origin_poi_name, originCate: r.origin_poi_cate, destId: String(r.dest_poi_id), destName: r.dest_poi_name, destCate: r.dest_poi_cate, n: 0, expSum: 0 });
        const v = m.get(key);
        const cnt = Number(r.flow_n || 0);
        v.n += cnt;
        v.expSum += Number(r.avg_edge_sentiment || 0) * cnt;
      });
      return [...m.values()].map(v => ({ ...v, avg: v.n ? v.expSum / v.n : null })).sort((a, b) => b.n - a.n);
    }
    const allPairs = buildCompanionPairs(coDaily);
    const allSeqs = buildSequences(flowDaily);

    function networkAroundPlace(placeId, placeName) {
      const companions = allPairs.filter(p => p.id1 === String(placeId) || p.id2 === String(placeId)).map(p => ({
        name: p.id1 === String(placeId) ? p.name2 : p.name1,
        cate: p.id1 === String(placeId) ? p.cate2 : p.cate1,
        n: p.n,
        avg: p.avg,
        label: `${placeName} + ${p.id1 === String(placeId) ? p.name2 : p.name1}`,
      })).sort((a, b) => b.n - a.n);
      const before = allSeqs.filter(s => s.destId === String(placeId)).map(s => ({ name: s.originName, cate: s.originCate, n: s.n, avg: s.avg, label: `${s.originName} → ${placeName}` })).sort((a, b) => b.n - a.n);
      const after = allSeqs.filter(s => s.originId === String(placeId)).map(s => ({ name: s.destName, cate: s.destCate, n: s.n, avg: s.avg, label: `${placeName} → ${s.destName}` })).sort((a, b) => b.n - a.n);
      const topPair = companions.filter(r => r.n >= EXP_THRESHOLD).sort((a, b) => (b.avg || 0) - (a.avg || 0));
      const lowPair = companions.filter(r => r.n >= EXP_THRESHOLD).sort((a, b) => (a.avg || 0) - (b.avg || 0));
      const seqMix = [...before, ...after].filter(r => r.n >= EXP_THRESHOLD);
      const topSeq = [...seqMix].sort((a, b) => (b.avg || 0) - (a.avg || 0));
      const lowSeq = [...seqMix].sort((a, b) => (a.avg || 0) - (b.avg || 0));
      return { companions, before, after, topPair, lowPair, topSeq, lowSeq };
    }


    function placeDailyRows(placeId) {
      return (poiDaily || []).filter(r => String(r.poi_id) === String(placeId));
    }
    function aggregateByKey(rows, keyGetter, nameGetter, valueKey, avgKey) {
      const m = new Map();
      (rows || []).forEach(r => {
        const key = keyGetter(r);
        if (!key) return;
        if (!m.has(key)) m.set(key, { label: nameGetter(r), n: 0, expSum: 0 });
        const v = m.get(key);
        const n = Number(r[valueKey] || 0);
        v.n += n;
        v.expSum += Number(r[avgKey] || 0) * n;
      });
      return [...m.values()].map(v => ({ ...v, avg: v.n ? v.expSum / v.n : null })).sort((a, b) => b.n - a.n);
    }

    function aggregateCommon(baseRows, cmpRows, keyField, countField, avgField, labelField) {
      const a = new Map();
      (baseRows || []).forEach(r => a.set(r[keyField], r));
      const b = new Map();
      (cmpRows || []).forEach(r => b.set(r[keyField], r));
      const out = [];
      a.forEach((ra, key) => {
        if (!b.has(key)) return;
        const rb = b.get(key);
        const shared = Math.min(Number(ra[countField] || 0), Number(rb[countField] || 0));
        const total = Number(ra[countField] || 0) + Number(rb[countField] || 0);
        const avg = total ? ((Number(ra[avgField] || 0) * Number(ra[countField] || 0)) + (Number(rb[avgField] || 0) * Number(rb[countField] || 0))) / total : null;
        out.push({ label: ra[labelField] ?? key, n: shared, avg });
      });
      return out.sort((x, y) => y.n - x.n);
    }

    function marketRows(base, mode='visits') {
      const rows = [...(base.markets || [])];
      if (mode === 'experience') return rows.filter(r => Number(r.journey_n || 0) >= EXP_THRESHOLD).sort((a,b)=>Number(b.avg_stop_sentiment||0)-Number(a.avg_stop_sentiment||0)).slice(0,5).map(r=>({ label:r.author_region, value:Number(r.avg_stop_sentiment||0), valueText:`${fmt2(r.avg_stop_sentiment)} (${MMM.fmtNum(r.journey_n)})`, count:Number(r.journey_n||0) }));
      const total = sum(rows, 'journey_n');
      return rows.sort((a,b)=>Number(b.journey_n||0)-Number(a.journey_n||0)).slice(0,5).map(r=>({ label:r.author_region, value:Number(r.journey_n||0), valueText:`${MMM.fmtNum(r.journey_n)} (${pct(r.journey_n,total)})`, count:Number(r.journey_n||0) }));
    }

    function commonMarketRows(base, cmp, mode='visits') {
      const common = aggregateCommon(base.markets, cmp.markets, 'author_region', 'journey_n', 'avg_stop_sentiment', 'author_region');
      if (mode === 'experience') return common.filter(r => Number(r.n || 0) >= EXP_THRESHOLD).sort((a,b)=>Number(b.avg||0)-Number(a.avg||0)).slice(0,5).map(r=>({ label:r.label, value:Number(r.avg||0), valueText:`${fmt2(r.avg)} (${MMM.fmtNum(r.n)})`, count:Number(r.n||0) }));
      const total = sum(common, 'n');
      return common.slice(0,5).map(r=>({ label:r.label, value:Number(r.n||0), valueText:`${MMM.fmtNum(r.n)} (${pct(r.n,total)})`, count:Number(r.n||0) }));
    }

    function flowRowsForPlace(placeId, start, end, mode) {
      const rows = MMM.inRange(flowDaily || [], start, end);
      return rows.filter(r => mode === 'inbound' ? String(r.dest_poi_id) === String(placeId) : String(r.origin_poi_id) === String(placeId));
    }
    function aggregateFlowList(rows, mode) {
      const keyField = mode === 'inbound' ? 'origin_poi_id' : 'dest_poi_id';
      const labelField = mode === 'inbound' ? 'origin_poi_name' : 'dest_poi_name';
      const m = new Map();
      (rows || []).forEach(r => {
        const key = String(r[keyField] || r[labelField]);
        if (!m.has(key)) m.set(key, { label: r[labelField], n: 0, expSum: 0 });
        const v = m.get(key);
        const n = Number(r.flow_n || 0);
        v.n += n;
        v.expSum += Number(r.avg_edge_sentiment || 0) * n;
      });
      return [...m.values()].map(v => ({ ...v, avg: v.n ? v.expSum / v.n : null })).sort((a, b) => b.n - a.n);
    }
    function inboundRows(base, start, end) {
      const agg = aggregateFlowList(flowRowsForPlace(base.place.poi_id, start, end, 'inbound'), 'inbound');
      const total = sum(agg, 'n');
      return agg.slice(0,5).map(r=>({ label:r.label, value:Number(r.n||0), valueText:`${MMM.fmtNum(r.n)} (${pct(r.n,total)})`, avgText:fmt2(r.avg), count:Number(r.n||0) }));
    }
    function outboundRows(base, start, end) {
      const agg = aggregateFlowList(flowRowsForPlace(base.place.poi_id, start, end, 'outbound'), 'outbound');
      const total = sum(agg, 'n');
      return agg.slice(0,5).map(r=>({ label:r.label, value:Number(r.n||0), valueText:`${MMM.fmtNum(r.n)} (${pct(r.n,total)})`, avgText:fmt2(r.avg), count:Number(r.n||0) }));
    }
    function commonInboundRows(base, cmp, start, end) {
      const a = aggregateFlowList(flowRowsForPlace(base.place.poi_id, start, end, 'inbound'), 'inbound').map(r=>({key:r.label,...r}));
      const b = aggregateFlowList(flowRowsForPlace(cmp.place.poi_id, start, end, 'inbound'), 'inbound').map(r=>({key:r.label,...r}));
      const common = aggregateCommon(a, b, 'key', 'n', 'avg', 'label');
      const total = sum(common, 'n');
      return common.slice(0,5).map(r=>({ label:r.label, value:Number(r.n||0), valueText:`${MMM.fmtNum(r.n)} (${pct(r.n,total)})`, avgText:fmt2(r.avg), count:Number(r.n||0) }));
    }
    function commonOutboundRows(base, cmp, start, end) {
      const a = aggregateFlowList(flowRowsForPlace(base.place.poi_id, start, end, 'outbound'), 'outbound').map(r=>({key:r.label,...r}));
      const b = aggregateFlowList(flowRowsForPlace(cmp.place.poi_id, start, end, 'outbound'), 'outbound').map(r=>({key:r.label,...r}));
      const common = aggregateCommon(a, b, 'key', 'n', 'avg', 'label');
      const total = sum(common, 'n');
      return common.slice(0,5).map(r=>({ label:r.label, value:Number(r.n||0), valueText:`${MMM.fmtNum(r.n)} (${pct(r.n,total)})`, avgText:fmt2(r.avg), count:Number(r.n||0) }));
    }

    function combinationRows(base) {
      const net = networkAroundPlace(base.place.poi_id, base.place.poi_name);
      const high = [...net.topPair.map(r=>({ label:r.label, avg:r.avg, n:r.n })), ...net.topSeq.map(r=>({ label:r.label, avg:r.avg, n:r.n }))].sort((a,b)=>Number(b.avg||0)-Number(a.avg||0)).slice(0,5).map(r=>({ label:r.label, value:Number(r.avg||0), valueText:`${fmt2(r.avg)} (${MMM.fmtNum(r.n)})`, count:Number(r.n||0) }));
      const low = [...net.lowPair.map(r=>({ label:r.label, avg:r.avg, n:r.n })), ...net.lowSeq.map(r=>({ label:r.label, avg:r.avg, n:r.n }))].sort((a,b)=>Number(a.avg||0)-Number(b.avg||0)).slice(0,5).map(r=>({ label:r.label, value:Number(r.avg||0), valueText:`${fmt2(r.avg)} (${MMM.fmtNum(r.n)})`, count:Number(r.n||0) }));
      return { high, low };
    }

    function compareCombinationRows(base, cmp) {
      const baseId = String(base.place.poi_id), cmpId = String(cmp.place.poi_id);
      const seqAB = allSeqs.find(s => s.originId === baseId && s.destId === cmpId);
      const seqBA = allSeqs.find(s => s.originId === cmpId && s.destId === baseId);
      const pair = allPairs.find(p => (p.id1 === baseId && p.id2 === cmpId) || (p.id1 === cmpId && p.id2 === baseId));
      const rows = [
        { label: `${base.place.poi_name} → ${cmp.place.poi_name}`, value: Number(seqAB?.avg || 0), valueText: `${fmt2(seqAB?.avg)} (${MMM.fmtNum(seqAB?.n)})`, kind:'rel' },
        { label: `${cmp.place.poi_name} → ${base.place.poi_name}`, value: Number(seqBA?.avg || 0), valueText: `${fmt2(seqBA?.avg)} (${MMM.fmtNum(seqBA?.n)})`, kind:'rel' },
        { label: `${base.place.poi_name} + ${cmp.place.poi_name}`, value: Number(pair?.avg || 0), valueText: `${fmt2(pair?.avg)} (${MMM.fmtNum(pair?.n)})`, kind:'rel' },
        { label: `${base.place.poi_name} benchmark`, value: Number(base.kpis.avg_stop_sentiment || 0), valueText: `${fmt2(base.kpis.avg_stop_sentiment)} (${MMM.fmtNum(base.kpis.journey_n_total)})`, kind:'bench-a' },
        { label: `${cmp.place.poi_name} benchmark`, value: Number(cmp.kpis.avg_stop_sentiment || 0), valueText: `${fmt2(cmp.kpis.avg_stop_sentiment)} (${MMM.fmtNum(cmp.kpis.journey_n_total)})`, kind:'bench-b' },
      ].sort((a,b)=>Number(b.value||0)-Number(a.value||0));
      return rows;
    }

    function barRowsHTML(rows, { tone='blue', maxValue=null } = {}) {
      if (!rows?.length) return '<div class="empty">No data available for this selection.</div>';
      const max = maxValue ?? Math.max(...rows.map(r => Number(r.value || 0)), 1);
      return `<div class="report-rank-list">${rows.map((r, i) => {
        const w = max ? Math.max(6, (Number(r.value || 0) / max) * 100) : 0;
        const extra = r.avgText ? `<small>${r.avgText}</small>` : '';
        const toneClass = r.kind ? `tone-${r.kind}` : `tone-${tone}`;
        return `<div class="report-rank-row ${toneClass}">
          <div class="report-rank-top"><span class="report-rank-index">${i + 1}</span><div class="report-rank-name"><strong>${escapeHtml(r.label)}</strong>${extra}</div><span class="report-rank-metric">${escapeHtml(r.valueText)}</span></div>
          <div class="report-rank-track"><span style="width:${w}%"></span></div>
        </div>`;
      }).join('')}</div>`;
    }

    function cardHTML(title, rows, { tone='blue', note='', maxValue=null } = {}) {
      return `<section class="sub-card report-rank-card">
        <div class="title-row"><h4>${escapeHtml(title)}</h4></div>
        ${barRowsHTML(rows, { tone, maxValue })}
        <div class="note-inline">${note}</div>
      </section>`;
    }

    function renderCardGrid(node, cards) {
      node.innerHTML = cards.join('');
    }

    function noteForRows(prefix, rows, meaning) {
      if (!rows?.length) return 'No qualifying data is visible under the current selection.';
      const top = rows[0];
      const total = rows.reduce((a,r)=>a + Number(r.count || 0), 0);
      return `<strong>${prefix}</strong> ${top.label} currently leads with ${top.valueText}. The top five together account for ${pct(total, total)} of the visible ranked volume in this card. ${meaning}`;
    }

    function buildTakeaways(base, compareReports, combos, inbound, outbound, marketRowsMain) {
      const items = [];
      const expCity = Number(base.benchmarks.exp_vs_city || 0);
      const expCat = Number(base.benchmarks.exp_vs_category || 0);
      items.push({
        type: expCity >= 0 ? 'Experience position' : 'Experience risk',
        title: `${base.place.poi_name} against baseline`,
        detail: `${base.place.poi_name} sits ${expCity >= 0 ? 'above' : 'below'} the city baseline by ${fmt2(Math.abs(expCity))} and ${expCat >= 0 ? 'above' : 'below'} its category baseline by ${fmt2(Math.abs(expCat))}. That shows whether the place is winning broadly, only within its niche, or underperforming on both benchmarks.`
      });
      if (marketRowsMain[0]) {
        items.push({
          type: 'Source market signal',
          title: `${marketRowsMain[0].label} is the clearest market anchor`,
          detail: `${marketRowsMain[0].label} leads the visible source-market ranking with ${marketRowsMain[0].valueText}. That indicates where the place's strongest observable demand concentration currently sits.`
        });
      }
      if (inbound[0] && outbound[0]) {
        items.push({
          type: 'Mobility pattern',
          title: `${inbound[0].label} in, ${outbound[0].label} out`,
          detail: `The strongest feeder is ${inbound[0].label}, while the strongest next stop is ${outbound[0].label}. That gives you the clearest visible entry and continuation points around ${base.place.poi_name}.`
        });
      }
      if (combos.high[0]) {
        items.push({
          type: 'Combination quality',
          title: `${combos.high[0].label} ranks highest`,
          detail: `Among visible combinations, ${combos.high[0].label} leads at ${combos.high[0].valueText}. That marks the strongest experience-linked combination currently connected to the focal place.`
        });
      }
      compareReports.forEach(cmp => {
        const diff = Number(base.kpis.avg_stop_sentiment || 0) - Number(cmp.kpis.avg_stop_sentiment || 0);
        const comboRows = compareCombinationRows(base, cmp);
        const best = comboRows[0];
        items.push({
          type: 'Compare diagnosis',
          title: `${base.place.poi_name} vs ${cmp.place.poi_name}`,
          detail: `${base.place.poi_name} is ${diff >= 0 ? 'ahead of' : 'behind'} ${cmp.place.poi_name} on average experience by ${fmt2(Math.abs(diff))}. Within their shared combination card, ${best.label} ranks highest at ${best.valueText}, which gives the clearest relationship-level explanation for this comparison.`
        });
      });
      return items;
    }

    function renderTakeawayCards(node, items) {
      if (!items?.length) { node.innerHTML = '<div class="empty">No takeaways available.</div>'; return; }
      const compareItems = items.filter(item => item.type === 'Compare diagnosis');
      const baseItems = items.filter(item => item.type !== 'Compare diagnosis').slice(0, 4);
      const renderCard = (item) => `<article class="insight-item"><div class="badge">${escapeHtml(item.type)}</div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.detail)}</p></article>`;
      node.innerHTML = `
        <div class="takeaways-base-grid">${baseItems.map(renderCard).join('')}</div>
        ${compareItems.length ? `<div class="takeaways-compare-grid">${compareItems.map(renderCard).join('')}</div>` : ''}
      `;
    }

    const load = { current: null, compare: [] };

    function safeReportFileName(ext) {
      const raw = String(load.current?.place?.poi_name || placeSelect.options[placeSelect.selectedIndex]?.text || 'Place Report').trim();
      const safe = raw.replace(/[\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
      return `Place Report_${safe || 'Place'}.${ext}`;
    }

    function visibleExportSections() {
      return ['section-overview','section-visits','section-mobility','section-experience','section-combinations','section-compare','section-takeaways']
        .map(id => MMM.qs(`#${id}`))
        .filter(el => el && !el.classList.contains('hidden'));
    }

    async function captureSection(el) {
      return html2canvas(el, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
        scrollX: 0,
        scrollY: -window.scrollY,
        windowWidth: document.documentElement.clientWidth,
      });
    }

    function overviewMetricPairs() {
      return [
        ['Avg. Experience', fmt2(load.current?.kpis?.avg_stop_sentiment)],
        ['Visits', MMM.fmtNum(load.current?.kpis?.stop_n_total)],
        ['Journeys', MMM.fmtNum(load.current?.kpis?.journey_n_total)],
        ['Source Markets', MMM.fmtNum(load.current?.benchmarks?.market_count)],
      ];
    }

    function cloneNodeForExport(el) {
      const clone = el.cloneNode(true);
      const originalCanvases = el.querySelectorAll('canvas');
      const cloneCanvases = clone.querySelectorAll('canvas');
      cloneCanvases.forEach((canvas, idx) => {
        const original = originalCanvases[idx];
        if (!original) return;
        const img = document.createElement('img');
        img.src = original.toDataURL('image/png');
        img.style.width = '100%';
        img.style.height = 'auto';
        img.style.display = 'block';
        img.style.borderRadius = '14px';
        img.style.background = '#fff';
        canvas.replaceWith(img);
      });
      clone.querySelectorAll('.report-card-grid').forEach(grid => {
        const count = Array.from(grid.children).filter(ch => !ch.classList.contains('hidden')).length;
        if (count === 4) grid.style.gridTemplateColumns = 'repeat(4,minmax(0,1fr))';
        else if (count === 3) grid.style.gridTemplateColumns = 'repeat(3,minmax(0,1fr))';
        else if (count === 2) grid.style.gridTemplateColumns = 'repeat(2,minmax(0,1fr))';
        else if (count === 1) grid.style.gridTemplateColumns = '1fr';
      });
      return clone;
    }

    async function captureExportCard(title, nodes) {
      const shell = document.createElement('div');
      shell.className = 'report-export-shell';
      shell.style.position = 'fixed';
      shell.style.left = '-10000px';
      shell.style.top = '0';
      shell.style.width = '1180px';
      shell.style.background = '#ffffff';
      shell.style.padding = '20px';
      shell.style.pointerEvents = 'none';
      shell.style.zIndex = '-1';
      const page = document.createElement('section');
      page.className = 'report-export-page';
      if (title) {
        const h2 = document.createElement('h2');
        h2.className = 'report-export-title';
        h2.textContent = title;
        page.appendChild(h2);
      }
      nodes.filter(Boolean).forEach(node => page.appendChild(cloneNodeForExport(node)));
      shell.appendChild(page);
      document.body.appendChild(shell);
      try {
        const imgs = Array.from(page.querySelectorAll('img'));
        await Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(resolve => { img.onload = resolve; img.onerror = resolve; })));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return await html2canvas(page, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
          logging: false,
          scrollX: 0,
          scrollY: -window.scrollY,
          windowWidth: 1180,
        });
      } finally {
        shell.remove();
      }
    }

    function slicedGridForExport(grid, start, end) {
      const clone = grid.cloneNode(false);
      clone.className = grid.className;
      clone.style.gridTemplateColumns = 'repeat(2,minmax(0,1fr))';
      Array.from(grid.children).slice(start, end).forEach(child => clone.appendChild(child.cloneNode(true)));
      return clone;
    }

    function pushGridSpecs(specs, title, grid) {
      if (!grid) return;
      const count = Array.from(grid.children).filter(ch => !ch.classList.contains('hidden')).length;
      if (count === 4) {
        specs.push({ title: `${title} · Part 1`, nodes: [slicedGridForExport(grid, 0, 2)] });
        specs.push({ title: `${title} · Part 2`, nodes: [slicedGridForExport(grid, 2, 4)] });
      } else {
        specs.push({ title, nodes: [grid] });
      }
    }

    function exportCardSpecs() {
      const specs = [
        { title: 'Visit Trend', nodes: [MMM.qs('#section-visits .report-section-head'), MMM.qs('#section-visits .chart-shell'), MMM.qs('#report-visits-note')] },
        { title: 'Flow Trend', nodes: [MMM.qs('#section-mobility .report-section-head'), MMM.qs('#section-mobility .chart-shell'), MMM.qs('#report-flow-note')] },
        { title: 'Experience Trend', nodes: [MMM.qs('#section-experience .report-section-head'), MMM.qs('#section-experience .chart-shell'), MMM.qs('#report-experience-note')] },
      ];
      pushGridSpecs(specs, 'Source Markets', MMM.qs('#report-visits-markets'));
      pushGridSpecs(specs, 'Top Inbound Places', MMM.qs('#report-mobility-inbound'));
      pushGridSpecs(specs, 'Top Outbound Places', MMM.qs('#report-mobility-outbound'));
      pushGridSpecs(specs, 'Source Markets by Experience', MMM.qs('#report-experience-markets'));
      pushGridSpecs(specs, 'Place Combinations', MMM.qs('#report-combinations-main'));
      const comboCmp = MMM.qs('#report-combinations-compare');
      if (comboCmp && comboCmp.children.length) pushGridSpecs(specs, 'Combination Comparison', comboCmp);
      const compare = MMM.qs('#section-compare');
      if (compare && !compare.classList.contains('hidden')) specs.push({ title: 'Overlay Comparison', nodes: [compare] });
      specs.push({ title: 'Takeaways', nodes: [MMM.qs('#report-takeaways')] });
      return specs.filter(spec => spec.nodes.some(Boolean));
    }

    function addCoverPdf(doc) {
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(28);
      doc.setTextColor(31,45,61);
      doc.text(load.current?.place?.poi_name || 'Place Report', pageW/2, pageH/2 - 10, { align:'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(14);
      doc.setTextColor(90,111,132);
      doc.text(`${dateStart.value || ''} to ${dateEnd.value || ''}`, pageW/2, pageH/2 + 2, { align:'center' });
      if (load.compare?.length) {
        doc.setFont('helvetica', 'bold');
        doc.text(`Compare with: ${load.compare.map(r => r.place.poi_name).join(', ')}`, pageW/2, pageH/2 + 14, { align:'center' });
      }
    }

    async function exportPdf() {
      const JsPdfCtor = window.jspdf?.jsPDF || window.jsPDF;
      if (!JsPdfCtor) { alert('PDF export is not available in this browser session.'); return; }
      try {
        const doc = new JsPdfCtor({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const maxW = pageW - 16;
        const maxH = pageH - 16;
        addCoverPdf(doc);
        const specs = exportCardSpecs();
        for (const spec of specs) {
          doc.addPage('a4', 'landscape');
          const canvas = await captureExportCard(spec.title, spec.nodes);
          const img = canvas.toDataURL('image/jpeg', 0.95);
          const ratio = Math.min(maxW / canvas.width, maxH / canvas.height);
          const w = canvas.width * ratio;
          const h = canvas.height * ratio;
          const x = (pageW - w) / 2;
          const y = (pageH - h) / 2;
          doc.addImage(img, 'JPEG', x, y, w, h, undefined, 'FAST');
        }
        doc.save(safeReportFileName('pdf'));
      } catch (err) {
        console.error(err);
        alert('PDF export could not complete in this browser session.');
      }
    }

    async function exportPpt() {
      const PptxCtor = window.pptxgen || window.PptxGenJS || window.pptxgenjs || window.PptxGenJS?.default;
      if (!PptxCtor) { alert('PPT export is not available in this browser session.'); return; }
      try {
        let pptx;
        if (typeof PptxCtor === 'function') pptx = new PptxCtor();
        else if (window.pptxgen && typeof window.pptxgen === 'function') pptx = new window.pptxgen();
        else if (window.PptxGenJS && typeof window.PptxGenJS === 'function') pptx = new window.PptxGenJS();
        else if (window.PptxGenJS?.default && typeof window.PptxGenJS.default === 'function') pptx = new window.PptxGenJS.default();
        else throw new Error('PptxGenJS constructor is not available');
        pptx.layout = 'LAYOUT_WIDE';
        pptx.author = 'OpenAI';
        pptx.subject = load.current?.place?.poi_name || 'Place Report';
        pptx.title = safeReportFileName('pptx').replace(/\.pptx$/,'');

        let slide = pptx.addSlide();
        slide.addText(load.current?.place?.poi_name || 'Place Report', { x:0.6, y:2.0, w:12.1, h:0.5, fontFace:'Inter', fontSize:28, bold:true, color:'1f2d3d', align:'center' });
        slide.addText(`${dateStart.value || ''} to ${dateEnd.value || ''}`, { x:0.6, y:2.7, w:12.1, h:0.25, fontFace:'Inter', fontSize:14, color:'5A6F84', align:'center' });
        if (load.compare?.length) slide.addText(`Compare with: ${load.compare.map(r => r.place.poi_name).join(', ')}`, { x:0.6, y:3.1, w:12.1, h:0.25, fontFace:'Inter', fontSize:13, bold:true, color:'3760A0', align:'center' });

        const specs = exportCardSpecs();
        for (const spec of specs) {
          slide = pptx.addSlide();
          const canvas = await captureExportCard(spec.title, spec.nodes);
          const img = canvas.toDataURL('image/jpeg', 0.95);
          const maxW = 12.2;
          const maxH = 6.6;
          const ratio = Math.min(maxW / canvas.width, maxH / canvas.height);
          const w = canvas.width * ratio;
          const h = canvas.height * ratio;
          const x = 0.55 + (maxW - w) / 2;
          const y = 0.45 + (maxH - h) / 2;
          slide.addImage({ data: img, x, y, w, h });
        }
        if (typeof pptx.writeFile === 'function') {
          try { await pptx.writeFile({ fileName: safeReportFileName('pptx') }); }
          catch { await pptx.writeFile(safeReportFileName('pptx')); }
        } else throw new Error('writeFile is not available');
      } catch (err) {
        console.error(err);
        alert('PPT export could not complete in this browser session.');
      }
    }

    function setActiveToc() {}

    async function render() {
      const selectedId = placeSelect.value;
      MMM.setParam({ place: selectedId || null, start: dateStart.value || null, end: dateEnd.value || null });
      ensureCompareOptions(selectedId);
      syncCompareChips();

      const base = await loadReport(selectedId);
      const compareIds = selectedCompareIds().filter(v => v !== String(selectedId));
      const compareReports = await Promise.all(compareIds.map(loadReport));
      load.current = base;
      load.compare = compareReports;

      MMM.qs('#report-title').textContent = base.place.poi_name;
      MMM.qs('#report-subtitle').textContent = base.place.summary || `${base.place.poi_cate || 'Place'} in Hong Kong.`;
      MMM.renderStats(MMM.qs('#report-kpis'), [
        { label: 'Avg. Experience', value: fmt2(base.kpis.avg_stop_sentiment) },
        { label: 'Number of Visits', value: MMM.fmtNum(base.kpis.stop_n_total) },
        { label: 'Number of Journeys', value: MMM.fmtNum(base.kpis.journey_n_total) },
        { label: 'Number of Source Markets', value: MMM.fmtNum(base.benchmarks.market_count) },
      ]);
      compareHeroLine.classList.toggle('hidden', !compareReports.length);

      const start = dateStart.value || '';
      const end = dateEnd.value || '';
      const basePlaceRows = MMM.inRange(placeDailyRows(base.place.poi_id), start, end);
      const cmpPlaceRows = compareReports.map(r => MMM.inRange(placeDailyRows(r.place.poi_id), start, end));
      const visitsAligned = syncSeries([
        Object.assign(trendSeries(basePlaceRows, trendScale.visits, start, end, base.place.poi_name, 'stop_n', false), { borderColor: lineColors[0] }),
        ...compareReports.map((r, i) => Object.assign(trendSeries(cmpPlaceRows[i], trendScale.visits, start, end, r.place.poi_name, 'stop_n', false), { borderColor: lineColors[(i + 1) % lineColors.length] }))
      ]);
      MMM.lineChart('report-visits-chart', visitsAligned.labels.map(d => formatBucketLabel(d, trendScale.visits)), visitsAligned.datasets);
      const peakVisit = [...basePlaceRows].sort((a,b)=>Number(b.stop_n||0)-Number(a.stop_n||0))[0];
      MMM.qs('#report-visits-note').innerHTML = peakVisit ? `<strong>This chart shows how visible visit volume changes over time.</strong> ${base.place.poi_name} reaches its highest visible volume in ${peakVisit.video_date}, with ${MMM.fmtNum(peakVisit.stop_n)} visits. That identifies the clearest peak period in the selected date range.` : 'No visible visit trend is available in the selected date range.';

      const visitMarketCards = [
        cardHTML('Source Markets', marketRows(base, 'visits'), { tone:'blue', note: noteForRows('This card shows the largest visible source markets reaching the place.', marketRows(base, 'visits'), 'That helps you see which markets currently drive the most visible visit volume.') })
      ];
      compareReports.forEach((cmp, i) => visitMarketCards.push(cardHTML(`Common with ${cmp.place.poi_name}`, commonMarketRows(base, cmp, 'visits'), { tone:'neutral', note: noteForRows(`This card shows the strongest shared source markets between ${base.place.poi_name} and ${cmp.place.poi_name}.`, commonMarketRows(base, cmp, 'visits'), 'These shared markets show where the two places draw from overlapping visible demand.') })));
      renderCardGrid(MMM.qs('#report-visits-markets'), visitMarketCards);

      const flowAligned = syncSeries([
        Object.assign(trendSeries(basePlaceRows, trendScale.flow, start, end, `${base.place.poi_name} inbound`, 'inbound_n', false), { borderColor: '#cf6a67' }),
        Object.assign(trendSeries(basePlaceRows, trendScale.flow, start, end, `${base.place.poi_name} outbound`, 'outbound_n', false), { borderColor: '#5f9f75' }),
        ...compareReports.map((r, i) => ({ ...trendSeries(cmpPlaceRows[i], trendScale.flow, start, end, `${r.place.poi_name} total flow`, 'flow_total', false), borderColor: lineColors[(i + 1) % lineColors.length], borderDash: [6,4], rows: trendSeries(cmpPlaceRows[i].map(x => ({...x, flow_total: Number(x.inbound_n||0)+Number(x.outbound_n||0)})), trendScale.flow, start, end, `${r.place.poi_name} total flow`, 'flow_total', false).rows }))
      ]);
      MMM.lineChart('report-flow-chart', flowAligned.labels.map(d => formatBucketLabel(d, trendScale.flow)), flowAligned.datasets);
      const peakFlow = [...basePlaceRows].sort((a,b)=>(Number(b.inbound_n||0)+Number(b.outbound_n||0))-(Number(a.inbound_n||0)+Number(a.outbound_n||0)))[0];
      MMM.qs('#report-flow-note').innerHTML = peakFlow ? `<strong>This chart shows how linked inbound and outbound movement changes over time.</strong> The busiest visible movement period is ${peakFlow.video_date}, when ${MMM.fmtNum(Number(peakFlow.inbound_n||0)+Number(peakFlow.outbound_n||0))} linked journeys are observed around ${base.place.poi_name}. That highlights when movement intensity is most concentrated.` : 'No visible flow trend is available in the selected date range.';
      const baseInbound = inboundRows(base, start, end);
      const baseOutbound = outboundRows(base, start, end);
      const inboundCards = [cardHTML('Top Inbound Places', baseInbound, { tone:'inbound', note: noteForRows('This card shows the strongest feeder places into the focal place.', baseInbound, 'These are the clearest lead-in sources under the current selection.') })];
      compareReports.forEach(cmp => inboundCards.push(cardHTML(`Common Inbound with ${cmp.place.poi_name}`, commonInboundRows(base, cmp, start, end), { tone:'neutral', note: noteForRows(`This card shows the strongest shared inbound places between ${base.place.poi_name} and ${cmp.place.poi_name}.`, commonInboundRows(base, cmp, start, end), 'Shared feeder places suggest overlap in visible lead-in demand.') })));
      renderCardGrid(MMM.qs('#report-mobility-inbound'), inboundCards);
      const outboundCards = [cardHTML('Top Outbound Places', baseOutbound, { tone:'outbound', note: noteForRows('This card shows the strongest next-stop destinations after the focal place.', baseOutbound, 'These places receive the clearest visible continuation flow.') })];
      compareReports.forEach(cmp => outboundCards.push(cardHTML(`Common Outbound with ${cmp.place.poi_name}`, commonOutboundRows(base, cmp, start, end), { tone:'neutral', note: noteForRows(`This card shows the strongest shared outbound destinations between ${base.place.poi_name} and ${cmp.place.poi_name}.`, commonOutboundRows(base, cmp, start, end), 'Shared next-stop destinations suggest overlap in continuation behaviour.') })));
      renderCardGrid(MMM.qs('#report-mobility-outbound'), outboundCards);

      const cityScopeRows = MMM.inRange(poiDaily || [], start, end);
      const categoryScopeRows = cityScopeRows.filter(r => r.poi_cate === base.place.poi_cate);
      const expAligned = syncSeries([
        Object.assign(trendSeries(basePlaceRows, trendScale.experience, start, end, base.place.poi_name, 'avg_stop_sentiment', true), { borderColor: lineColors[0] }),
        Object.assign(trendSeries(cityScopeRows, trendScale.experience, start, end, 'City average', 'avg_stop_sentiment', true), { borderColor: '#8ba1b7', borderDash:[5,5] }),
        Object.assign(trendSeries(categoryScopeRows, trendScale.experience, start, end, `${base.place.poi_cate} average`, 'avg_stop_sentiment', true), { borderColor: '#b48f5f', borderDash:[3,4] }),
        ...compareReports.map((r, i) => Object.assign(trendSeries(cmpPlaceRows[i], trendScale.experience, start, end, r.place.poi_name, 'avg_stop_sentiment', true), { borderColor: lineColors[(i + 1) % lineColors.length] }))
      ]);
      MMM.lineChart('report-experience-chart', expAligned.labels.map(d => formatBucketLabel(d, trendScale.experience)), expAligned.datasets);
      MMM.qs('#report-experience-note').innerHTML = `<strong>This chart shows how visible experience changes over time for the focal place.</strong> ${base.place.poi_name} is currently ${Number(base.benchmarks.exp_vs_city || 0) >= 0 ? 'above' : 'below'} the city baseline by ${fmt2(Math.abs(base.benchmarks.exp_vs_city || 0))}. That tells you whether the place is outperforming the wider city context.`;
      const expCards = [cardHTML('Source Markets', marketRows(base, 'experience'), { tone:'high', note: noteForRows('This card shows which source markets record stronger visible experience at the place.', marketRows(base, 'experience'), 'These markets can indicate where the place is landing particularly well.') })];
      compareReports.forEach(cmp => expCards.push(cardHTML(`Common with ${cmp.place.poi_name}`, commonMarketRows(base, cmp, 'experience'), { tone:'neutral', note: noteForRows(`This card shows the strongest shared source markets between ${base.place.poi_name} and ${cmp.place.poi_name}, ranked by average experience.`, commonMarketRows(base, cmp, 'experience'), 'These shared markets show where the two places overlap in higher-quality visible demand.') })));
      renderCardGrid(MMM.qs('#report-experience-markets'), expCards);

      const combos = combinationRows(base);
      const comboCards = [
        cardHTML('High-quality Combinations', combos.high, { tone:'high', maxValue:1, note: noteForRows('This card ranks the strongest place combinations by average experience.', combos.high, 'These combinations suggest where the focal place sits inside stronger-quality visible journeys.') }),
        cardHTML('Low-quality Combinations', combos.low, { tone:'low', maxValue:1, note: noteForRows('This card ranks the weakest place combinations by average experience.', combos.low, 'These relationships highlight where visible journey quality looks weaker and may need investigation.') }),
      ];
      renderCardGrid(MMM.qs('#report-combinations-main'), comboCards);
      const comboCompareCards = compareReports.map(cmp => cardHTML(`Combination with ${cmp.place.poi_name}`, compareCombinationRows(base, cmp), { tone:'neutral', maxValue:1, note: `This card compares direct directional and pair relationships between ${base.place.poi_name} and ${cmp.place.poi_name}, alongside both place benchmarks. It shows whether the visible combination between the two places performs above or below each place's own experience baseline.` }));
      renderCardGrid(MMM.qs('#report-combinations-compare'), comboCompareCards);

      const compareSection = MMM.qs('#section-compare');
      if (!compareReports.length) {
        compareSection.classList.add('hidden');
      } else {
        compareSection.classList.remove('hidden');
        const rows = [{ poi_name: base.place.poi_name, category: base.place.poi_cate, visits: base.kpis.stop_n_total, journeys: base.kpis.journey_n_total, avg: base.kpis.avg_stop_sentiment, markets: base.benchmarks.market_count }, ...compareReports.map(r => ({ poi_name: r.place.poi_name, category: r.place.poi_cate, visits: r.kpis.stop_n_total, journeys: r.kpis.journey_n_total, avg: r.kpis.avg_stop_sentiment, markets: r.benchmarks.market_count }))];
        MMM.qs('#report-compare-table').innerHTML = `<div class="table-wrap compare-table-wrap"><table class="compare-table"><thead><tr><th>Place</th><th>Category</th><th>Visits</th><th>Journeys</th><th>Avg. experience</th><th>Source markets</th></tr></thead><tbody>${rows.map((r, i) => `<tr class="${i===0?'is-focal':''}"><td>${escapeHtml(r.poi_name)}</td><td>${escapeHtml(r.category)}</td><td>${MMM.fmtNum(r.visits)}</td><td>${MMM.fmtNum(r.journeys)}</td><td>${fmt2(r.avg)}</td><td>${MMM.fmtNum(r.markets)}</td></tr>`).join('')}</tbody></table></div>`;
      }

      renderTakeawayCards(MMM.qs('#report-takeaways'), buildTakeaways(base, compareReports, combos, baseInbound, baseOutbound, marketRows(base, 'visits')));
    }

    MMM.qsa('.report-scale-tabs').forEach(group => {
      group.addEventListener('click', (e) => {
        const btn = e.target.closest('.scale-chip');
        if (!btn) return;
        group.querySelectorAll('.scale-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        trendScale[group.dataset.group] = btn.dataset.scale;
        render();
      });
    });

    placeSelect.addEventListener('change', () => { syncFocalInput(); ensureCompareOptions(placeSelect.value); syncCompareChips(); render(); });
    compareInput.addEventListener('change', () => addCompareByName(compareInput.value.trim()));
    compareChipRail.addEventListener('click', (e) => { const btn = e.target.closest('[data-remove-compare]'); if (btn) removeCompareById(btn.dataset.removeCompare); });
    compareChipHero.addEventListener('click', (e) => { const btn = e.target.closest('[data-remove-compare]'); if (btn) removeCompareById(btn.dataset.removeCompare); });
    dateStart.addEventListener('change', render);
    dateEnd.addEventListener('change', render);
    resetBtn.addEventListener('click', () => {
      dateStart.value = defaultStart;
      dateEnd.value = defaultEnd;
      Array.from(compareSelect.options).forEach(o => o.selected = false);
      compareInput.value = '';
      resetScaleTabs();
      ensureCompareOptions(placeSelect.value);
      syncCompareChips();
      render();
    });

    const exportToggle = MMM.qs('#report-export-toggle');
    const exportMenu = MMM.qs('#report-export-menu');
    function positionExportMenu() {
      const rect = exportToggle.getBoundingClientRect();
      const menuWidth = 116;
      exportMenu.style.position = 'fixed';
      exportMenu.style.width = `${menuWidth}px`;
      exportMenu.style.top = `${rect.bottom + 8}px`;
      exportMenu.style.left = `${Math.max(12, rect.right - menuWidth)}px`;
      exportMenu.style.zIndex = '10000';
    }
    exportToggle.addEventListener('click', () => {
      exportMenu.classList.toggle('hidden');
      if (!exportMenu.classList.contains('hidden')) {
        requestAnimationFrame(positionExportMenu);
      }
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.export-menu-wrap') && !e.target.closest('#report-export-menu')) exportMenu.classList.add('hidden'); });
    window.addEventListener('resize', () => { if (!exportMenu.classList.contains('hidden')) positionExportMenu(); });
    window.addEventListener('scroll', () => { if (!exportMenu.classList.contains('hidden')) positionExportMenu(); }, { passive:true });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        render();
        if (!exportMenu.classList.contains('hidden')) positionExportMenu();
      }, 140);
    });

    MMM.qs('#report-export-pdf').addEventListener('click', async () => { exportMenu.classList.add('hidden'); await exportPdf(); });
    MMM.qs('#report-export-ppt').addEventListener('click', async () => { exportMenu.classList.add('hidden'); await exportPpt(); });

    setupFocalSearch();
    ensureCompareOptions(placeSelect.value);
    syncCompareChips();
    resetScaleTabs();
    render();
  } catch (err) {
    console.error(err);
  }
});
