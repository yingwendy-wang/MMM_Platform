document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [meta, places, poiDaily, flowDaily] = await Promise.all([
      MMM.fetchJSON('explorer/meta.json'),
      MMM.fetchJSON('dictionaries/places.json'),
      MMM.fetchJSON('explorer/poi_daily.json'),
      MMM.fetchJSON('explorer/flow_daily.json'),
    ]);

    const placeLookup = new Map(places.map(p => [String(p.poi_id), p]));
    const state = { selectedPlaceId: MMM.getParam('place') || '', visitsScale: 'weekly', flowScale: 'weekly' };

    const startInput = MMM.qs('#mobility-start');
    const endInput = MMM.qs('#mobility-end');
    const focalOnly = MMM.qs('#mobility-focal');
    const resetBtn = MMM.qs('#mobility-reset');
    const map = MMM.map('mobility-map');
    const defaultCenter = [22.38, 114.2];
    const defaultZoom = 11;
    map.setView(defaultCenter, defaultZoom);
    const edgeLayer = L.layerGroup().addTo(map);
    const nodeLayer = L.layerGroup().addTo(map);
    const focusLayer = L.layerGroup().addTo(map);

    const defaultStart = (meta.min_date && meta.min_date > '2024-01-01') ? meta.min_date : '2024-01-01';
    startInput.value = defaultStart;
    endInput.value = meta.max_date;
    focalOnly.checked = false;

    const isFocal = (poiId, rowFocal) => rowFocal === 1 || rowFocal === 1.0 || Number(placeLookup.get(String(poiId))?.is_focal) === 1;
    const getCoords = (poiId, lat, lng) => {
      const ref = placeLookup.get(String(poiId)) || {};
      return { lat: lat ?? ref.poi_lat ?? null, lng: lng ?? ref.poi_lng ?? null };
    };

    function currentRows() {
      let pr = MMM.inRange(poiDaily, startInput.value, endInput.value);
      let fr = MMM.inRange(flowDaily, startInput.value, endInput.value);
      if (focalOnly.checked) {
        pr = pr.filter(r => isFocal(r.poi_id, r.is_focal));
        fr = fr.filter(r => isFocal(r.origin_poi_id, r.origin_is_focal) || isFocal(r.dest_poi_id, r.dest_is_focal));
      }
      return { pr, fr };
    }

    function bucket(date, scale) {
      const d = new Date(date + 'T00:00:00');
      if (scale === 'daily') return date;
      if (scale === 'monthly') return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const tmp = new Date(d); const day = (tmp.getDay() + 6) % 7; tmp.setDate(tmp.getDate() - day); return tmp.toISOString().slice(0,10);
    }

    function enumerateBuckets(start, end, scale) {
      if (!start || !end) return [];
      const out = [];
      let cur = new Date(start + 'T00:00:00');
      const endDate = new Date(end + 'T00:00:00');
      if (scale === 'daily') {
        while (cur <= endDate) { out.push(cur.toISOString().slice(0,10)); cur.setDate(cur.getDate() + 1); }
        return out;
      }
      if (scale === 'weekly') {
        const day = (cur.getDay() + 6) % 7; cur.setDate(cur.getDate() - day);
        while (cur <= endDate) { out.push(cur.toISOString().slice(0,10)); cur.setDate(cur.getDate() + 7); }
        return [...new Set(out)];
      }
      cur = new Date(cur.getFullYear(), cur.getMonth(), 1);
      while (cur <= endDate) { out.push(`${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}`); cur = new Date(cur.getFullYear(), cur.getMonth()+1, 1); }
      return out;
    }

    function aggregateNodes(rows) {
      const m = new Map();
      rows.forEach(r => {
        const id = String(r.poi_id);
        if (!m.has(id)) {
          const c = getCoords(r.poi_id, r.poi_lat, r.poi_lng);
          m.set(id, { poi_id:r.poi_id, poi_name:r.poi_name, poi_cate:r.poi_cate, poi_lat:c.lat, poi_lng:c.lng, visits:0, journeys:0, inbound:0, outbound:0 });
        }
        const n = m.get(id);
        n.visits += Number(r.stop_n || 0);
        n.journeys += Number(r.journey_n || 0);
        n.inbound += Number(r.inbound_n || 0);
        n.outbound += Number(r.outbound_n || 0);
      });
      return [...m.values()].sort((a,b)=>b.visits-a.visits);
    }

    function aggregateEdges(rows) {
      const m = new Map();
      rows.forEach(r => {
        const key = `${r.origin_poi_id}__${r.dest_poi_id}`;
        if (!m.has(key)) {
          const o = getCoords(r.origin_poi_id, r.origin_lat, r.origin_lng);
          const d = getCoords(r.dest_poi_id, r.dest_lat, r.dest_lng);
          m.set(key, { origin_poi_id:r.origin_poi_id, origin_poi_name:r.origin_poi_name, origin_poi_cate:r.origin_poi_cate, origin_lat:o.lat, origin_lng:o.lng, dest_poi_id:r.dest_poi_id, dest_poi_name:r.dest_poi_name, dest_poi_cate:r.dest_poi_cate, dest_lat:d.lat, dest_lng:d.lng, flow_n:0 });
        }
        m.get(key).flow_n += Number(r.flow_n || 0);
      });
      return [...m.values()].sort((a,b)=>b.flow_n-a.flow_n);
    }

    function timeSeriesVisits(rows, selectedId='') {
      const by = new Map();
      rows.filter(r => !selectedId || String(r.poi_id) === String(selectedId)).forEach(r => {
        const k = bucket(r.video_date, state.visitsScale);
        if (!by.has(k)) by.set(k, { bucket:k, visits:0 });
        by.get(k).visits += Number(r.stop_n || 0);
      });
      return enumerateBuckets(startInput.value, endInput.value, state.visitsScale).map(label => ({ bucket: label, visits: by.has(label) ? by.get(label).visits : null }));
    }

    function timeSeriesFlows(rows, selectedId='') {
      const by = new Map();
      rows.filter(r => !selectedId || String(r.origin_poi_id) === String(selectedId) || String(r.dest_poi_id) === String(selectedId)).forEach(r => {
        const k = bucket(r.video_date, state.flowScale);
        if (!by.has(k)) by.set(k, { bucket:k, internal:0, inbound:0, outbound:0 });
        const v = by.get(k);
        if (!selectedId) v.internal += Number(r.flow_n || 0);
        else {
          if (String(r.dest_poi_id) === String(selectedId)) v.inbound += Number(r.flow_n || 0);
          if (String(r.origin_poi_id) === String(selectedId)) v.outbound += Number(r.flow_n || 0);
        }
      });
      return enumerateBuckets(startInput.value, endInput.value, state.flowScale).map(label => {
        const v = by.get(label);
        return { bucket: label, internal: v ? v.internal : null, inbound: v ? v.inbound : null, outbound: v ? v.outbound : null };
      });
    }

    function rankRowsFromTotals(rows, totalValue) {
      return rows.map(r => ({ ...r, pct: totalValue ? r.value / totalValue : 0 }));
    }

    function renderRankBars(node, rows, tone) {
      if (!rows?.length) { node.innerHTML = '<div class="empty">No data available for this selection.</div>'; return; }
      const maxPct = Math.max(...rows.map(r => r.pct || 0), 0.0001);
      node.innerHTML = `<div class="rank-bars">${rows.map((r,i)=>`
        <div class="rank-bar ${tone}">
          <div class="rank-bar-top">
            <div class="rank-index ${tone}">${i+1}</div>
            <div><div class="rank-name">${r.poi_name}</div><div class="rank-sub">${r.poi_cate || ''}</div></div>
            <div class="rank-metric ${tone}">${MMM.fmtNum(r.value)} (${MMM.fmtPct(r.pct,1)})</div>
          </div>
          <div class="bar-track"><div class="bar-fill ${tone}" style="width:${Math.max(8,(r.pct / maxPct) * 100)}%"></div></div>
        </div>`).join('')}</div>`;
    }

    function renderNote(id, lead, detail) {
      MMM.qs(id).innerHTML = `<strong>${lead}</strong> ${detail}`;
    }
    function formatTopFiveShare(rows) {
      if (!rows?.length) return null;
      const share = rows.reduce((a, r) => a + Number(r.pct || 0), 0);
      return MMM.fmtPct(Math.min(1, share), 1);
    }

    function periodsDominance(flowSeries) {
      let inboundPeriods = 0, outboundPeriods = 0, tiedPeriods = 0;
      flowSeries.forEach(d => {
        if ((d.inbound || 0) > (d.outbound || 0)) inboundPeriods += 1;
        else if ((d.outbound || 0) > (d.inbound || 0)) outboundPeriods += 1;
        else tiedPeriods += 1;
      });
      return { inboundPeriods, outboundPeriods, tiedPeriods };
    }

    function shareSentence(rows, label) {
      if (!rows?.length) return `No ${label} is visible in the current filter.`;
      const lead = rows[0];
      const topFiveShare = formatTopFiveShare(rows);
      return `${lead.poi_name} ranks first with ${MMM.fmtNum(lead.value)} ${label}, equal to ${MMM.fmtPct(lead.pct,1)} of the visible total. The top five together account for ${topFiveShare}.`;
    }

    function setTip(id, text) {
      const el = MMM.qs(id);
      if (!el) return;
      el.setAttribute('title', text);
      el.setAttribute('aria-label', text);
      if (el.hasAttribute('data-tip')) el.removeAttribute('data-tip');
    }

    function draw(edges, nodes, selectedId='') {
      edgeLayer.clearLayers(); nodeLayer.clearLayers(); focusLayer.clearLayers();
      const visibleEdges = selectedId ? edges.filter(e => String(e.origin_poi_id) === String(selectedId) || String(e.dest_poi_id) === String(selectedId)).slice(0, 40) : [];
      const maxFlow = Math.max(...visibleEdges.map(e => Number(e.flow_n || 0)), 1);
      visibleEdges.forEach(e => {
        if ([e.origin_lat,e.origin_lng,e.dest_lat,e.dest_lng].some(v => v == null || Number.isNaN(Number(v)))) return;
        const weight = 1.4 + (Number(e.flow_n || 0) / maxFlow) * 6.4;
        L.polyline([[e.origin_lat,e.origin_lng],[e.dest_lat,e.dest_lng]], {
          color: 'rgba(232,113,48,.78)',
          weight,
          opacity: .82,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(edgeLayer);
      });
      const maxVisits = Math.max(...nodes.map(n => Number(n.journeys || 0)), 1);
      nodes.forEach(n => {
        if ([n.poi_lat,n.poi_lng].some(v => v == null || Number.isNaN(Number(v)))) return;
        const selected = String(n.poi_id) === String(selectedId);
        const radius = selected ? 13.5 : 5.4 + Math.pow((Number(n.journeys || 0) / maxVisits), 0.45) * 11.5;
        const marker = L.circleMarker([n.poi_lat,n.poi_lng], {
          radius: selected ? radius + 1.5 : radius + 1.2,
          stroke: false,
          fillColor: selected ? 'rgba(232,113,48,.98)' : 'rgba(142,188,236,.95)',
          fillOpacity: .95,
        }).addTo(nodeLayer);
        const html = `<strong>${n.poi_name}</strong><br>${n.poi_cate}<br>Visits: ${MMM.fmtNum(n.visits)}<br>Inbound: ${MMM.fmtNum(n.inbound)} · Outbound: ${MMM.fmtNum(n.outbound)}`;
        marker.bindTooltip(html, { sticky:true, direction:'top', opacity:.95 });
        marker.bindPopup(html);
        marker.on('click', () => { state.selectedPlaceId = String(n.poi_id); MMM.setParam({ place:n.poi_id }); render(); });
        if (selected) {
          L.circleMarker([n.poi_lat,n.poi_lng], { radius:18, stroke:false, fillColor:'rgba(232,113,48,.18)', fillOpacity:1 }).addTo(focusLayer);
          marker.bringToFront();
        }
      });
    }

    function render(mode = "all") {
      const { pr, fr } = currentRows();
      const nodes = aggregateNodes(pr);
      const edges = aggregateEdges(fr);
      if (state.selectedPlaceId && !nodes.find(n => String(n.poi_id) === String(state.selectedPlaceId))) state.selectedPlaceId = '';
      const selected = nodes.find(n => String(n.poi_id) === String(state.selectedPlaceId));
      const selectedId = selected?.poi_id || '';

      MMM.qs('#mobility-headline').textContent = selected ? selected.poi_name : 'Hong Kong mobility overview';
      MMM.qs('#mobility-subline').textContent = selected ? `${selected.poi_cate} · selected place detail` : 'Visible places across Hong Kong';
      MMM.qs('#mobility-summary-title').textContent = selected ? selected.poi_name : 'City overview';
      MMM.qs('#mobility-summary-sub').textContent = selected ? selected.poi_cate : 'Current date and focal-place view';
      MMM.qs('#mobility-hint').textContent = selected ? `You are viewing ${selected.poi_name}. Click another point to switch places, or use Reset to return to the city overview.` : 'You are viewing the city overview. Click any point on the map to open place-level detail.';
      MMM.qs('#title-inbound').textContent = selected ? 'Top Inbound Places' : 'Top Inbound Places';
      MMM.qs('#title-outbound').textContent = selected ? 'Top Outbound Places' : 'Top Outbound Places';
      MMM.qs('#title-receivers').textContent = selected ? 'Top Net Feeders' : 'Top Net Receivers';
      MMM.qs('#title-senders').textContent = selected ? 'Top Net Destinations' : 'Top Net Senders';
      setTip('#info-summary', selected ? 'This summary shows the selected place and its current visit and flow totals.' : 'This summary shows the current city-level visible footprint under the active controls.');
      setTip('#info-visits', selected ? 'This chart tracks visit volume for the selected place only.' : 'This chart tracks visit volume across all visible places in the current city view.');
      setTip('#info-flow', selected ? 'This chart compares inbound and outbound flow for the selected place over time.' : 'This chart tracks internal movement between visible places across the city view.');
      setTip('#info-inbound', selected ? 'These are the places that most often send movement into the selected place.' : 'These are the visible places with the strongest inbound movement totals.');
      setTip('#info-outbound', selected ? 'These are the places most often reached after the selected place.' : 'These are the visible places with the strongest outbound movement totals.');
      setTip('#info-receivers', selected ? 'These places send more flow into the selected place than they receive back from it.' : 'These places absorb more movement than they pass on in the city view.');
      setTip('#info-senders', selected ? 'These places receive more flow from the selected place than they send back to it.' : 'These places send more movement onward than they retain in the city view.');
      MMM.qs('#mobility-metrics').innerHTML = selected
        ? `<div class="metric-card"><div class="k">Visits</div><div class="v">${MMM.fmtNum(selected.visits)}</div></div>
           <div class="metric-card"><div class="k">Inbound</div><div class="v">${MMM.fmtNum(selected.inbound)}</div></div>
           <div class="metric-card"><div class="k">Outbound</div><div class="v">${MMM.fmtNum(selected.outbound)}</div></div>`
        : `<div class="metric-card"><div class="k">Visits</div><div class="v">${MMM.fmtNum(MMM.sum(nodes,'visits'))}</div></div>
           <div class="metric-card"><div class="k">Visible places</div><div class="v">${MMM.fmtNum(nodes.length)}</div></div>
           <div class="metric-card"><div class="k">Journeys</div><div class="v">${MMM.fmtNum(MMM.sum(nodes,'journeys'))}</div></div>`;

      const visitSeries = timeSeriesVisits(pr, selectedId);
      const flowSeries = timeSeriesFlows(fr, selectedId);
      if (mode === 'all' || mode === 'visits') {
        MMM.lineChart('mobility-visits-chart', visitSeries.map(d=>d.bucket), [{ label:'Visits', data:visitSeries.map(d=>d.visits), borderColor:'#1d73ff' }], { scales:{ y:{ beginAtZero:true } } });
      }
      if (mode === 'all' || mode === 'flow') {
        if (!selected) MMM.lineChart('mobility-flow-chart', flowSeries.map(d=>d.bucket), [{ label:'Internal mobility intensity', data:flowSeries.map(d=>d.internal), borderColor:'#e87130' }], { scales:{ y:{ beginAtZero:true } } });
        else MMM.lineChart('mobility-flow-chart', flowSeries.map(d=>d.bucket), [{ label:'Inbound', data:flowSeries.map(d=>d.inbound), borderColor:'#1fa774' },{ label:'Outbound', data:flowSeries.map(d=>d.outbound), borderColor:'#e87130' }], { scales:{ y:{ beginAtZero:true } } });
      }

      const inboundRaw = !selected ? nodes.slice().sort((a,b)=>b.inbound-a.inbound).map(n=>({ poi_name:n.poi_name, poi_cate:n.poi_cate, value:n.inbound })) : edges.filter(e=>String(e.dest_poi_id)===String(selected.poi_id)).map(e=>({ poi_name:e.origin_poi_name, poi_cate:e.origin_poi_cate, value:e.flow_n }));
      const outboundRaw = !selected ? nodes.slice().sort((a,b)=>b.outbound-a.outbound).map(n=>({ poi_name:n.poi_name, poi_cate:n.poi_cate, value:n.outbound })) : edges.filter(e=>String(e.origin_poi_id)===String(selected.poi_id)).map(e=>({ poi_name:e.dest_poi_name, poi_cate:e.dest_poi_cate, value:e.flow_n }));
      const netBase = !selected ? nodes.map(n=>({ poi_name:n.poi_name, poi_cate:n.poi_cate, value:n.inbound-n.outbound })) : (() => {
        const m = new Map();
        edges.forEach(e => {
          if (String(e.dest_poi_id) === String(selected.poi_id)) { const key = String(e.origin_poi_id); if(!m.has(key)) m.set(key,{poi_name:e.origin_poi_name,poi_cate:e.origin_poi_cate,value:0}); m.get(key).value += e.flow_n; }
          if (String(e.origin_poi_id) === String(selected.poi_id)) { const key = String(e.dest_poi_id); if(!m.has(key)) m.set(key,{poi_name:e.dest_poi_name,poi_cate:e.dest_poi_cate,value:0}); m.get(key).value -= e.flow_n; }
        }); return [...m.values()];
      })();
      const receiversRaw = netBase.filter(r=>r.value>0).sort((a,b)=>b.value-a.value);
      const sendersRaw = netBase.filter(r=>r.value<0).sort((a,b)=>a.value-b.value).map(r=>({ ...r, value:Math.abs(r.value) }));
      const inboundTotal = inboundRaw.reduce((a,r)=>a+r.value,0);
      const outboundTotal = outboundRaw.reduce((a,r)=>a+r.value,0);
      const receiverTotal = receiversRaw.reduce((a,r)=>a+r.value,0);
      const senderTotal = sendersRaw.reduce((a,r)=>a+r.value,0);
      const inbound = rankRowsFromTotals(inboundRaw.slice(0,5), inboundTotal);
      const outbound = rankRowsFromTotals(outboundRaw.slice(0,5), outboundTotal);
      const receivers = rankRowsFromTotals(receiversRaw.slice(0,5), receiverTotal);
      const senders = rankRowsFromTotals(sendersRaw.slice(0,5), senderTotal);

      renderRankBars(MMM.qs('#mobility-inbound-list'), inbound, 'inbound');
      renderRankBars(MMM.qs('#mobility-outbound-list'), outbound, 'outbound');
      renderRankBars(MMM.qs('#mobility-net-receivers'), receivers, 'receiver');
      renderRankBars(MMM.qs('#mobility-net-senders'), senders, 'sender');

      const totalVisits = MMM.sum(nodes,'visits');
      renderNote('#mobility-core-insight', selected ? 'This panel shows the movement profile for the selected place.' : 'This panel shows the visible mobility footprint in the current city view.', selected ? `${selected.poi_name} records ${MMM.fmtNum(selected.visits)} visits in the selected window, with ${MMM.fmtNum(selected.inbound)} inbound and ${MMM.fmtNum(selected.outbound)} outbound flows. ${selected.inbound >= selected.outbound ? 'Inbound movement is slightly stronger than outbound movement.' : 'Outbound movement is slightly stronger than inbound movement.'}` : `${MMM.fmtNum(nodes.length)} visible places account for ${MMM.fmtNum(totalVisits)} visits and ${MMM.fmtNum(MMM.sum(nodes,'journeys'))} journeys in the current view.`);

      const nonNullVisits = visitSeries.filter(d => d.visits != null);
      if (nonNullVisits.length) {
        const peakVisit = nonNullVisits.reduce((a,b)=> a.visits >= b.visits ? a : b);
        const avgVisit = nonNullVisits.reduce((a,b)=>a + b.visits,0) / nonNullVisits.length;
        renderNote('#mobility-visits-insight', selected ? `${selected.poi_name} visits over time.` : 'City-level visits over time.', `${peakVisit.bucket} is the strongest ${state.visitsScale} period with ${MMM.fmtNum(peakVisit.visits)} visits. ${peakVisit.visits >= avgVisit * 1.2 ? 'That peak stands clearly above the typical level in this window.' : 'Visit volume stays relatively even across most periods in this window.'}`);
      } else {
        renderNote('#mobility-visits-insight', selected ? `${selected.poi_name} visits over time.` : 'City-level visits over time.', 'No visit data is visible in the current filter.');
      }

      if (!selected) {
        const nonNullFlow = flowSeries.filter(d => d.internal != null);
        if (nonNullFlow.length) {
          const peakFlow = nonNullFlow.reduce((a,b)=> a.internal >= b.internal ? a : b);
          const nonZeroPeriods = nonNullFlow.filter(d => (d.internal || 0) > 0).length;
          renderNote('#mobility-flow-insight', 'Within-city movement over time.', `${peakFlow.bucket} has the strongest within-city movement intensity with ${MMM.fmtNum(peakFlow.internal)} recorded internal flows. ${MMM.fmtNum(nonZeroPeriods)} ${state.flowScale} periods show active place-to-place movement, so multi-stop behavior is visible throughout the selected window.`);
        } else {
          renderNote('#mobility-flow-insight', 'Within-city movement over time.', 'No internal movement is visible in the current filter.');
        }
      } else {
        const nonNullFlow = flowSeries.filter(d => d.inbound != null || d.outbound != null);
        if (nonNullFlow.length) {
          const inboundSum = nonNullFlow.reduce((a,d)=>a+(d.inbound || 0),0), outboundSum = nonNullFlow.reduce((a,d)=>a+(d.outbound || 0),0);
          const peakIn = nonNullFlow.reduce((a,b)=> (a.inbound || 0) >= (b.inbound || 0) ? a : b);
          const peakOut = nonNullFlow.reduce((a,b)=> (a.outbound || 0) >= (b.outbound || 0) ? a : b);
          const dom = periodsDominance(nonNullFlow);
          const directionText = dom.inboundPeriods > dom.outboundPeriods ? `Across most ${state.flowScale} periods, ${selected.poi_name} behaves more like a receiver than a sender.` : dom.outboundPeriods > dom.inboundPeriods ? `Across most ${state.flowScale} periods, ${selected.poi_name} behaves more like a sender than a receiver.` : `Inbound and outbound movement stay fairly balanced across the selected periods.`;
          renderNote('#mobility-flow-insight', `${selected.poi_name} inbound vs outbound flow over time.`, `${directionText} The strongest inbound period is ${peakIn.bucket} with ${MMM.fmtNum(peakIn.inbound)} inbound flow, while the strongest outbound period is ${peakOut.bucket} with ${MMM.fmtNum(peakOut.outbound)} outbound flow. Total inbound reaches ${MMM.fmtNum(inboundSum)} versus ${MMM.fmtNum(outboundSum)} outbound.`);
        } else {
          renderNote('#mobility-flow-insight', `${selected.poi_name} inbound vs outbound flow over time.`, 'No flow trend is visible for the selected place.');
        }
      }

      renderNote('#mobility-inbound-insight', selected ? `Strongest feeder places into ${selected.poi_name}.` : 'Strongest inbound places in the current city view.', inbound.length ? shareSentence(inbound, !selected ? 'inbound movements' : `inbound flow into ${selected.poi_name}`) : 'No inbound concentration is visible.');
      renderNote('#mobility-outbound-insight', selected ? `Strongest next-stop places from ${selected.poi_name}.` : 'Strongest outbound places in the current city view.', outbound.length ? shareSentence(outbound, !selected ? 'outbound movements' : `outbound flow from ${selected.poi_name}`) : 'No outbound concentration is visible.');
      renderNote('#mobility-net-receivers-insight', selected ? `Places that send more flow into ${selected.poi_name} than they receive back from it.` : 'Places that absorb more movement than they pass on.', receivers.length ? `${receivers[0].poi_name} ranks first with ${MMM.fmtNum(receivers[0].value)} net receiving flow. The top five together account for ${formatTopFiveShare(receivers)} of visible net receiving volume, which means ${formatTopFiveShare(receivers) === '100.0%' ? 'the visible receiving side is concentrated in just a handful of places.' : 'receiving flow extends beyond the first few places.'}` : 'No net receivers are visible.');
      renderNote('#mobility-net-senders-insight', selected ? `Places that receive more flow from ${selected.poi_name} than they send back to it.` : 'Places that send more movement onward than they retain.', senders.length ? `${senders[0].poi_name} ranks first with ${MMM.fmtNum(senders[0].value)} net sending flow. The top five together account for ${formatTopFiveShare(senders)} of visible net sending volume, which means ${formatTopFiveShare(senders) === '100.0%' ? 'the visible sending side is concentrated in just a handful of places.' : 'sending flow is distributed across more than a few places.'}` : 'No net senders are visible.');

      draw(edges, nodes, selectedId);
    }

    MMM.qsa('[data-visits-scale]').forEach(btn => btn.addEventListener('click', () => { state.visitsScale = btn.dataset.visitsScale; MMM.qsa('[data-visits-scale]').forEach(b => b.classList.toggle('active', b === btn)); render('visits'); }));
    MMM.qsa('[data-flow-scale]').forEach(btn => btn.addEventListener('click', () => { state.flowScale = btn.dataset.flowScale; MMM.qsa('[data-flow-scale]').forEach(b => b.classList.toggle('active', b === btn)); render('flow'); }));
    [startInput, endInput, focalOnly].forEach(el => el.addEventListener('change', render));
    resetBtn.addEventListener('click', () => { state.selectedPlaceId = ''; startInput.value = defaultStart; endInput.value = meta.max_date; focalOnly.checked = true; MMM.setParam({ place:null }); map.setView(defaultCenter, defaultZoom); render(); });
    render();
  } catch (err) { console.error(err); }
});
