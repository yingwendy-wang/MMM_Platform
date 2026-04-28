document.addEventListener('DOMContentLoaded', async () => {
  const cfg = window.PERSONA_PAGE;
  if (!cfg) return;
  try {
    const [overview, places, flows, cooccurs] = await Promise.all([
      MMM.fetchJSON('home/home_overview.json').catch(() => ({})),
      MMM.fetchJSON('dictionaries/places.json'),
      MMM.fetchJSON('explorer/flow_daily.json').catch(() => []),
      MMM.fetchJSON('explorer/cooccur_daily.json').catch(() => [])
    ]);

    const cleanPlaces = (places || []).filter(Boolean).map(p => ({ ...p }));
    const cleanFlows = (flows || []).filter(Boolean).map(r => ({ ...r }));
    const cleanCo = (cooccurs || []).filter(Boolean).map(r => ({ ...r }));
    window.__personaCooccurs = cleanCo;

    if (cfg.key === 'hotels-v2') {
      renderHotelsPage(cleanPlaces, cfg.threshold || 5);
      return;
    }

    if (cfg.key === 'attractions-v2' || cfg.key === 'retail-v2' || cfg.key === 'restaurants-v2') {
      renderSectorPage(cfg.key, cleanPlaces, cfg.threshold || 5);
      return;
    }

    if (cfg.key === 'product-designers-v2') {
      renderProductDesignersPage(cleanPlaces, cleanFlows, cleanCo, cfg.threshold || 5);
      return;
    }

    const predicate = makePredicate(cfg.key);
    const popular = cleanPlaces.filter(predicate).sort((a,b)=>(Number(b.journey_n_total||0)-Number(a.journey_n_total||0))).slice(0,5);
    const beforeAfter = buildBeforeAfter(cfg.key, cleanFlows, predicate);
    const pairings = buildPairings(cfg.key, cleanCo, predicate, cfg.threshold);
    const routes = buildRoutes(cleanFlows);

    if (MMM.qs('#persona-glance')) MMM.renderStats(MMM.qs('#persona-glance'), [
      { label: 'Demo city', value: overview.city_name || 'Hong Kong', sub: 'Current live demo' },
      { label: 'Date range', value: `${overview.default_start_date || '—'} to ${overview.default_end_date || '—'}`, sub: 'Visible coverage' },
      { label: 'Places in scope', value: MMM.fmtNum(cleanPlaces.filter(predicate).length), sub: 'Places matching this perspective' }
    ]);

    if (MMM.qs('#persona-hero-title')) MMM.qs('#persona-hero-title').textContent = cfg.heroTitle;
    if (MMM.qs('#persona-hero-copy')) MMM.qs('#persona-hero-copy').textContent = cfg.heroCopy;
    if (MMM.qs('#persona-learn')) {
      MMM.qs('#persona-learn').innerHTML = cfg.learn.map(card => `
        <article class="feature-card persona-learn-card">
          <div class="home-card-head"><div class="home-card-icon">${card.icon}</div><h3>${card.title}</h3></div>
          <p>${card.text}</p>
        </article>`).join('');
    }

    MMM.qs('#persona-block-a-title').textContent = cfg.blocks[0].title;
    MMM.qs('#persona-block-a-copy').textContent = cfg.blocks[0].copy;
    renderSimpleRanking('#persona-block-a-list', cfg.key === 'product-designers' ? buildPopularCombinations(cleanCo) : popular, cfg.key === 'product-designers' ? 'label' : 'poi_name', cfg.key === 'product-designers' ? 'score' : 'journey_n_total', cfg.key === 'product-designers' ? null : null, cfg.key === 'product-designers' ? 'Popular' : 'Popular');

    MMM.qs('#persona-block-b-title').textContent = cfg.blocks[1].title;
    MMM.qs('#persona-block-b-copy').textContent = cfg.blocks[1].copy;
    if (cfg.key === 'product-designers') {
      renderSimpleRanking('#persona-block-b-list', buildBetterCombinations(cleanCo, cfg.threshold), 'label', 'avg', 'count', 'Stronger');
    } else if (cfg.key === 'attractions' || cfg.key === 'hotels' || cfg.key === 'restaurants' || cfg.key === 'retail') {
      const box = MMM.qs('#persona-block-b-list');
      box.innerHTML = `
        <div class="persona-duo-grid">
          <div>
            <div class="persona-mini-title">Before</div>
            <div id="persona-before"></div>
          </div>
          <div>
            <div class="persona-mini-title">After</div>
            <div id="persona-after"></div>
          </div>
        </div>`;
      renderSimpleRanking('#persona-before', beforeAfter.before, 'label', 'score', null, 'Common');
      renderSimpleRanking('#persona-after', beforeAfter.after, 'label', 'score', null, 'Common');
    }

    MMM.qs('#persona-block-c-title').textContent = cfg.blocks[2].title;
    MMM.qs('#persona-block-c-copy').textContent = cfg.blocks[2].copy;
    if (cfg.key === 'product-designers') {
      renderSimpleRanking('#persona-block-c-list', routes, 'label', 'score', null, 'Common');
    } else {
      renderSimpleRanking('#persona-block-c-list', pairings, 'label', 'avg', 'count', 'Stronger');
    }

    const ctas = MMM.qs('#persona-cta');
    if (ctas) ctas.innerHTML = cfg.ctas.map(btn => `<a class="btn ${btn.primary ? 'btn-primary' : 'btn-secondary'}" href="${btn.href}">${btn.label}</a>`).join('');
  } catch (err) {
    console.error(err);
  }
});

function lower(v){ return String(v || '').toLowerCase(); }
function isHotel(p){ const s = `${lower(p.poi_cate)} ${lower(p.poi_name)}`; return /(hotel|resort|hostel|inn|lodge)/.test(s); }
function isRestaurant(p){ const s = `${lower(p.poi_cate)} ${lower(p.poi_name)}`; return /(restaurant|dining|food|cafe|coffee|bar|bistro|eatery)/.test(s); }
function isRetail(p){ const s = `${lower(p.poi_cate)} ${lower(p.poi_name)}`; return /(retail|shopping|mall|market|store|plaza|outlet)/.test(s); }
function isAttraction(p){ const s = `${lower(p.poi_cate)} ${lower(p.poi_name)}`; return /(attraction|entertainment|theme|museum|park|peak|island|natural|landmark|scenic|city)/.test(s) && !isHotel(p) && !isRestaurant(p) && !isRetail(p) && !/airport|station|terminal/.test(s); }

function makePredicate(key){
  if (key === 'attractions') return isAttraction;
  if (key === 'hotels' || key === 'hotels-v2') return isHotel;
  if (key === 'restaurants') return isRestaurant;
  if (key === 'retail') return isRetail;
  return () => true;
}

function buildBeforeAfter(key, flows, predicate){
  const before = new Map();
  const after = new Map();
  flows.forEach(r => {
    const destProxy = { poi_cate:r.dest_poi_cate, poi_name:r.dest_poi_name };
    const originProxy = { poi_cate:r.origin_poi_cate, poi_name:r.origin_poi_name };
    if (predicate(destProxy)) {
      const k = r.origin_poi_name || 'Unknown';
      before.set(k, (before.get(k) || 0) + Number(r.flow_n || 0));
    }
    if (predicate(originProxy)) {
      const k = r.dest_poi_name || 'Unknown';
      after.set(k, (after.get(k) || 0) + Number(r.flow_n || 0));
    }
  });
  return {
    before: [...before.entries()].map(([label, score]) => ({ label, score })).sort((a,b)=>b.score-a.score).slice(0,5),
    after: [...after.entries()].map(([label, score]) => ({ label, score })).sort((a,b)=>b.score-a.score).slice(0,5)
  };
}

function buildPairings(key, cooccurs, predicate, threshold){
  const map = new Map();
  cooccurs.forEach(r => {
    const a = { poi_cate:r.poi_a_cate, poi_name:r.poi_a_name };
    const b = { poi_cate:r.poi_b_cate, poi_name:r.poi_b_name };
    if (!(predicate(a) || predicate(b))) return;
    const nameA = r.poi_a_name || 'Unknown';
    const nameB = r.poi_b_name || 'Unknown';
    const label = `${nameA} + ${nameB}`;
    const entry = map.get(label) || { label, count:0, weighted:0 };
    const w = Number(r.cooccur_n || 0);
    entry.count += w;
    entry.weighted += Number(r.avg_journey_sentiment || 0) * w;
    map.set(label, entry);
  });
  return [...map.values()]
    .filter(r => r.count >= threshold)
    .map(r => ({ label:r.label, count:r.count, avg:r.count ? r.weighted / r.count : 0 }))
    .sort((a,b)=>b.avg-a.avg)
    .slice(0,5);
}

function buildPopularCombinations(cooccurs){
  const map = new Map();
  cooccurs.forEach(r => {
    const label = `${r.poi_a_name || 'Unknown'} + ${r.poi_b_name || 'Unknown'}`;
    map.set(label, (map.get(label) || 0) + Number(r.cooccur_n || 0));
  });
  return [...map.entries()].map(([label, score]) => ({ label, score })).sort((a,b)=>b.score-a.score).slice(0,5);
}
function buildBetterCombinations(cooccurs, threshold){
  const map = new Map();
  cooccurs.forEach(r => {
    const label = `${r.poi_a_name || 'Unknown'} + ${r.poi_b_name || 'Unknown'}`;
    const e = map.get(label) || { label, count:0, weighted:0 };
    const w = Number(r.cooccur_n || 0);
    e.count += w; e.weighted += Number(r.avg_journey_sentiment || 0) * w;
    map.set(label, e);
  });
  return [...map.values()].filter(r => r.count >= threshold).map(r => ({ label:r.label, count:r.count, avg:r.weighted / r.count })).sort((a,b)=>b.avg-a.avg).slice(0,5);
}
function buildRoutes(flows){
  const map = new Map();
  flows.forEach(r => {
    const label = `${r.origin_poi_name || 'Unknown'} → ${r.dest_poi_name || 'Unknown'}`;
    map.set(label, (map.get(label) || 0) + Number(r.flow_n || 0));
  });
  return [...map.entries()].map(([label, score]) => ({ label, score })).sort((a,b)=>b.score-a.score).slice(0,5);
}

function renderSimpleRanking(selector, rows, labelKey, primaryKey, secondaryKey, toneLabel){
  const node = MMM.qs(selector);
  if (!node) return;
  if (!rows || !rows.length) { node.innerHTML = '<div class="empty">No matching results in the current demo sample.</div>'; return; }
  const max = Math.max(...rows.map(r => Number(r[primaryKey] || 0)), 1);
  node.innerHTML = `<div class="persona-rank-list">${rows.map((r, idx) => {
    const pct = Math.max(8, (Number(r[primaryKey] || 0) / max) * 100);
    const primary = primaryKey === 'avg' ? Number(r[primaryKey] || 0).toFixed(2) : MMM.fmtNum(r[primaryKey] || 0);
    const secondary = secondaryKey ? (secondaryKey === 'count' ? MMM.fmtNum(r[secondaryKey] || 0) : r[secondaryKey]) : '';
    return `
      <div class="persona-rank-item">
        <div class="persona-rank-top"><span class="persona-rank-index">${idx+1}</span><strong>${r[labelKey]}</strong></div>
        <div class="persona-rank-bar"><span style="width:${pct}%"></span></div>
        <div class="persona-rank-meta">${toneLabel ? `<span>${toneLabel}</span>`:''}<span>${primary}${secondary ? ` · ${secondary}` : ''}</span></div>
      </div>`;
  }).join('')}</div>`;
}


function renderHotelsPage(places, threshold){
  const hotels = places.filter(isHotel).map(p => ({ ...p,
    popularity: Number(p.journey_n_total || 0),
    rating: Number(p.avg_stop_sentiment || 0)
  }));

  const totalPopularity = hotels.reduce((acc, h) => acc + Math.max(0, h.popularity), 0) || 1;
  const hotelsWithShare = hotels.map(h => ({ ...h, popularityShare: h.popularity / totalPopularity }));

  const popular = hotelsWithShare.slice().sort((a,b)=>b.popularity-a.popularity).slice(0,10);
  const rated = hotelsWithShare.filter(h => h.popularity >= threshold).slice().sort((a,b)=>b.rating-a.rating || b.popularity-a.popularity).slice(0,10);

  const linked = buildHotelLinkedPlaces(window.__personaCooccurs || [], threshold);
  renderHotelPopularList('#hotel-popular-list', popular, totalPopularity);
  renderHotelRatedList('#hotel-rated-list', rated);
  renderHotelScatter('#hotel-compare-chart', hotelsWithShare.filter(h => h.popularity > 0));
  renderHotelLinkedGrid('#hotel-linked-grid', linked);
}

function reportHref(poiId){ return poiId != null && poiId !== '' ? `./report.html?place=${encodeURIComponent(poiId)}` : './report.html'; }

function rankBadge(index){
  const n = index + 1;
  const cls = n===1 ? ' gold' : n===2 ? ' silver' : n===3 ? ' bronze' : '';
  return `<span class="hotel-rank-badge${cls}">${n}</span>`;
}

function renderHotelPopularList(selector, rows, totalPopularity){
  const node = MMM.qs(selector);
  if (!node) return;
  if (!rows.length) { node.innerHTML = '<div class="empty">No matching hotels in this demo sample.</div>'; return; }
  const max = Math.max(...rows.map(r=>r.popularityShare),1e-9);
  node.innerHTML = `<div class="hotel-rank-list">${rows.map((r, idx) => {
    const pct = Math.max(7, r.popularityShare / max * 100);
    return `
      <a class="hotel-rank-row hotel-rank-row--popular" href="${reportHref(r.poi_id)}" title="Open place report for ${escapeHtml(r.poi_name || 'Unknown')}">
        <div class="hotel-rank-main">
          ${rankBadge(idx)}
          <div class="hotel-rank-name">${escapeHtml(r.poi_name || 'Unknown')}</div>
        </div>
        <div class="hotel-rank-track"><span style="width:${pct}%"></span></div>
        <div class="hotel-rank-value">${(r.popularityShare*100).toFixed(1)}%</div>
      </a>`;
  }).join('')}</div>`;
}

function renderStars(score){
  const value = Math.max(0, Math.min(1, Number(score || 0)));
  const stars = value * 5;
  return `<div class="hotel-stars hotel-stars-dynamic" aria-label="${value.toFixed(2)} rating">${Array.from({length:5}).map((_,i)=>{
    const fill = Math.max(0, Math.min(1, stars - i));
    return `<span class="hotel-star"><span class="hotel-star-bg">★</span><span class="hotel-star-fill" style="width:${(fill*100).toFixed(1)}%">★</span></span>`;
  }).join('')}</div>`;
}

function renderHotelRatedList(selector, rows){
  const node = MMM.qs(selector);
  if (!node) return;
  if (!rows.length) { node.innerHTML = '<div class="empty">No matching places in this demo sample.</div>'; return; }
  node.innerHTML = `<div class="hotel-rank-list">${rows.map((r, idx) => {
    const score = Math.max(0, Math.min(1, Number(r.rating || 0)));
    return `
      <a class="hotel-rank-row hotel-rank-row--rated" href="${reportHref(r.poi_id)}" title="Open place report for ${escapeHtml(r.poi_name || 'Unknown')}">
        <div class="hotel-rank-main">
          ${rankBadge(idx)}
          <div class="hotel-rank-name">${escapeHtml(r.poi_name || 'Unknown')}</div>
        </div>
        <div class="hotel-rating-wrap">
          ${renderStars(score)}
          <div class="hotel-rank-value hotel-rank-value--rated">${score.toFixed(2)}</div>
        </div>
      </a>`;
  }).join('')}</div>`;
}

function renderHotelScatter(selector, rows){
  const node = MMM.qs(selector);
  if (!node) return;
  if (!rows.length) { node.innerHTML = '<div class="empty">No comparison data available.</div>'; return; }

  const pops = rows.map(r => Number(r.popularityShare || 0)).filter(v => v > 0).sort((a,b)=>a-b);
  const ratings = rows.map(r => Number(r.rating || 0)).sort((a,b)=>a-b);
  const popMedian = pops.length % 2 ? pops[(pops.length - 1) / 2] : (pops[pops.length / 2 - 1] + pops[pops.length / 2]) / 2;
  const ratingMedian = ratings.length % 2 ? ratings[(ratings.length - 1) / 2] : (ratings[ratings.length / 2 - 1] + ratings[ratings.length / 2]) / 2;
  const popMin = max(min(pops), 1e-4);
  const popMax = max(maxv(pops), popMin * 1.01);
  const logMin = Math.log10(popMin);
  const logMax = Math.log10(popMax);
  const logRange = Math.max(logMax - logMin, 1e-6);

  const W = 980, H = 462, pad = {l:118,r:54,t:52,b:74};
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const x = v => pad.l + ((Math.log10(Math.max(Number(v || popMin), popMin)) - logMin) / logRange) * plotW;
  const y = v => H - pad.b - (Math.max(0, Math.min(1, Number(v || 0))) * plotH);
  const midX = x(popMedian || popMin);
  const midY = y(ratingMedian || 0.5);

  const xLabelY = H - pad.b + 11;
  const lowX = pad.l + 6;
  const highX = W - pad.r - 54;
  const medianX = Math.min(Math.max(midX, lowX + 138), highX - 138);
  const leftAxisX = pad.l - 28;
  const lowerQuadrantY = xLabelY + 36;

  node.innerHTML = `
    <div class="hotel-scatter-wrap">
      <div class="hotel-scatter-tooltip" id="hotel-scatter-tooltip"></div>
      <svg viewBox="0 0 ${W} ${H}" class="hotel-scatter-svg" role="img" aria-label="Popular vs top-rated places">
        <rect x="0" y="0" width="${W}" height="${H}" rx="16" fill="#ffffff"></rect>
        <rect x="${pad.l}" y="${pad.t}" width="${midX-pad.l}" height="${midY-pad.t}" fill="#edf7ef"></rect>
        <rect x="${midX}" y="${pad.t}" width="${W-pad.r-midX}" height="${midY-pad.t}" fill="#eef5ff"></rect>
        <rect x="${pad.l}" y="${midY}" width="${midX-pad.l}" height="${H-pad.b-midY}" fill="#f5f7fa"></rect>
        <rect x="${midX}" y="${midY}" width="${W-pad.r-midX}" height="${H-pad.b-midY}" fill="#f7f1ea"></rect>
        <line x1="${pad.l}" y1="${H-pad.b}" x2="${W-pad.r}" y2="${H-pad.b}" stroke="#cdd8e5" stroke-width="1.5"></line>
        <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H-pad.b}" stroke="#cdd8e5" stroke-width="1.5"></line>
        <line x1="${midX}" y1="${pad.t}" x2="${midX}" y2="${H-pad.b}" stroke="#d8e2ef" stroke-dasharray="5 5"></line>
        <line x1="${pad.l}" y1="${midY}" x2="${W-pad.r}" y2="${midY}" stroke="#d8e2ef" stroke-dasharray="5 5"></line>
        <text x="${lowX}" y="${xLabelY}" text-anchor="start" class="hotel-axis-label">Low popularity</text>
        <text x="${medianX}" y="${xLabelY}" text-anchor="middle" class="hotel-axis-label">Median popularity</text>
        <text x="${highX}" y="${xLabelY}" text-anchor="end" class="hotel-axis-label">High popularity</text>
        <text x="${leftAxisX}" y="${H-pad.b}" text-anchor="end" class="hotel-axis-label">Low rating</text>
        <text x="${leftAxisX}" y="${midY}" text-anchor="end" class="hotel-axis-label">Median rating</text>
        <text x="${leftAxisX}" y="${pad.t}" text-anchor="end" class="hotel-axis-label">High rating</text>
        <text x="${pad.l}" y="${pad.t-24}" class="hotel-quadrant-label hotel-quadrant-label--tl">Less known but highly rated</text>
        <text x="${W-pad.r}" y="${pad.t-24}" text-anchor="end" class="hotel-quadrant-label hotel-quadrant-label--tr">Popular and highly rated</text>
        <text x="${pad.l}" y="${lowerQuadrantY}" class="hotel-quadrant-label hotel-quadrant-label--bl">Less known and lower-rated</text>
        <text x="${W-pad.r}" y="${lowerQuadrantY}" text-anchor="end" class="hotel-quadrant-label hotel-quadrant-label--br">Popular but mixed ratings</text>
        ${rows.map(r => {
          const cx = x(r.popularityShare || popMin), cy = y(r.rating), radius = 3.7;
          return `<circle cx="${cx}" cy="${cy}" r="${radius}" class="hotel-scatter-point" data-name="${escapeHtml(r.poi_name || 'Unknown')}" data-pop="${(Number(r.popularityShare || 0)*100).toFixed(2)}" data-rating="${Number(r.rating || 0).toFixed(2)}" data-href="${reportHref(r.poi_id)}"></circle>`;
        }).join('')}
      </svg>
    </div>`;

  const tooltip = node.querySelector('#hotel-scatter-tooltip');
  const wrap = node.querySelector('.hotel-scatter-wrap');
  const moveTip = (e, pt) => {
    const rect = wrap.getBoundingClientRect();
    tooltip.innerHTML = `<strong>${pt.dataset.name}</strong><div>${pt.dataset.pop}% popular · ${pt.dataset.rating} rating</div>`;
    tooltip.classList.add('show');
    tooltip.style.left = `${e.clientX - rect.left + 12}px`;
    tooltip.style.top = `${e.clientY - rect.top - 14}px`;
  };
  node.querySelectorAll('.hotel-scatter-point').forEach(pt => {
    pt.addEventListener('mouseenter', e => moveTip(e, pt));
    pt.addEventListener('mousemove', e => moveTip(e, pt));
    pt.addEventListener('mouseleave', () => {
      tooltip.classList.remove('show');
      tooltip.style.left = `-9999px`;
      tooltip.style.top = `-9999px`;
    });
    pt.addEventListener('click', () => {
      window.location.href = pt.dataset.href;
    });
  });
}

function min(arr){ return arr.length ? Math.min(...arr) : 0; }
function maxv(arr){ return arr.length ? Math.max(...arr) : 0; }
function max(a,b){ return Math.max(a,b); }

function buildHotelLinkedPlaces(cooccurs, threshold){
  const buckets = { attraction:new Map(), retail:new Map(), dining:new Map() };
  cooccurs.forEach(r => {
    const a = { poi_cate:r.poi_a_cate, poi_name:r.poi_a_name };
    const b = { poi_cate:r.poi_b_cate, poi_name:r.poi_b_name };
    const w = Number(r.cooccur_n || 0);
    if (!w) return;
    if (isHotel(a) && !isHotel(b)) addHotelLinked(buckets, r.poi_b_id, r.poi_b_name, b, w);
    if (isHotel(b) && !isHotel(a)) addHotelLinked(buckets, r.poi_a_id, r.poi_a_name, a, w);
  });
  return {
    attraction: sortHotelLinked(buckets.attraction, threshold),
    retail: sortHotelLinked(buckets.retail, threshold),
    dining: sortHotelLinked(buckets.dining, threshold)
  };
}

function addHotelLinked(buckets, poiId, poiName, proxy, weight){
  const bucket = isAttraction(proxy) ? buckets.attraction : isRetail(proxy) ? buckets.retail : isRestaurant(proxy) ? buckets.dining : null;
  if (!bucket) return;
  const key = String(poiId || poiName || 'Unknown');
  const item = bucket.get(key) || { poi_id:poiId, poi_name:poiName || 'Unknown', score:0 };
  item.score += weight;
  bucket.set(key, item);
}

function sortHotelLinked(bucket, threshold){
  return [...bucket.values()].filter(r => r.score >= threshold).sort((a,b)=>b.score-a.score).slice(0,5);
}

function renderHotelLinkedGrid(selector, linked){
  const node = MMM.qs(selector);
  if (!node) return;
  const defs = [
    { key:'attraction', title:'Attractions' },
    { key:'retail', title:'Retail' },
    { key:'dining', title:'Dining' }
  ];
  node.innerHTML = defs.map(def => {
    const rows = linked[def.key] || [];
    const max = Math.max(...rows.map(r=>Number(r.score || 0)), 1);
    const total = rows.reduce((acc, r) => acc + Number(r.score || 0), 0) || 1;
    return `
      <article class="hotel-linked-card">
        <h3>${def.title}</h3>
        ${rows.length ? `<div class="hotel-linked-list">${rows.map((r, idx) => {
          const pct = Math.max(12, (Number(r.score || 0) / max) * 100);
          const share = ((Number(r.score || 0) / total) * 100).toFixed(1);
          return `
            <a class="hotel-linked-row" href="${reportHref(r.poi_id)}" title="Open place report for ${escapeHtml(r.poi_name || 'Unknown')}">
              <div class="hotel-linked-top">
                <div class="hotel-linked-main">${rankBadge(idx)}<div class="hotel-rank-name">${escapeHtml(r.poi_name || 'Unknown')}</div></div>
                <div class="hotel-rank-value">${share}%</div>
              </div>
              <div class="hotel-rank-track"><span style="width:${pct}%"></span></div>
            </a>`;
        }).join('')}</div>` : `<div class="empty">No matching places in this demo sample.</div>`}
      </article>`;
  }).join('');
}

function renderSectorPage(key, places, threshold){
  const sector = {
    'attractions-v2': {
      predicate: isAttraction,
      empty: 'No matching attractions in this demo sample.',
      linked: [
        { key:'hotel', title:'Hotels' },
        { key:'dining', title:'Dining' },
        { key:'retail', title:'Retail' }
      ]
    },
    'retail-v2': {
      predicate: isRetail,
      empty: 'No matching retail places in this demo sample.',
      linked: [
        { key:'attraction', title:'Attractions' },
        { key:'hotel', title:'Hotels' },
        { key:'dining', title:'Dining' }
      ]
    },
    'restaurants-v2': {
      predicate: isRestaurant,
      empty: 'No matching dining places in this demo sample.',
      linked: [
        { key:'attraction', title:'Attractions' },
        { key:'hotel', title:'Hotels' },
        { key:'retail', title:'Retail' }
      ]
    }
  }[key];
  if (!sector) return;

  const base = (places || []).filter(sector.predicate).map(p => ({
    ...p,
    popularity: Number(p.journey_n_total || 0),
    rating: Number(p.avg_stop_sentiment || 0)
  }));

  const popularHost = MMM.qs('#hotel-popular-list');
  const ratedHost = MMM.qs('#hotel-rated-list');
  const chartHost = MMM.qs('#hotel-compare-chart');
  const linkedHost = MMM.qs('#hotel-linked-grid');

  if (!base.length) {
    const empty = `<div class="empty">${sector.empty}</div>`;
    if (popularHost) popularHost.innerHTML = empty;
    if (ratedHost) ratedHost.innerHTML = empty;
    if (chartHost) chartHost.innerHTML = '<div class="empty">No comparison data available.</div>';
    if (linkedHost) linkedHost.innerHTML = sector.linked.map(def => `<article class="hotel-linked-card"><h3>${def.title}</h3><div class="empty">No matching places.</div></article>`).join('');
    return;
  }

  const totalPopularity = base.reduce((acc, r) => acc + Math.max(0, Number(r.popularity || 0)), 0) || 1;
  const rows = base.map(r => ({ ...r, popularityShare: Number(r.popularity || 0) / totalPopularity }));
  const popular = rows.slice().sort((a,b)=>b.popularity-a.popularity).slice(0,10);
  const rated = rows.filter(r => r.popularity >= threshold).slice().sort((a,b)=>b.rating-a.rating || b.popularity-a.popularity).slice(0,10);
  const linked = buildSectorLinkedPlaces(window.__personaCooccurs || [], sector.predicate, threshold);

  renderHotelPopularList('#hotel-popular-list', popular, totalPopularity);
  renderHotelRatedList('#hotel-rated-list', rated);
  renderHotelScatter('#hotel-compare-chart', rows.filter(r => Number(r.popularity || 0) > 0));
  renderSectorLinkedGrid('#hotel-linked-grid', linked, sector.linked);
}

function detectBucket(proxy){
  if (isAttraction(proxy)) return 'attraction';
  if (isHotel(proxy)) return 'hotel';
  if (isRetail(proxy)) return 'retail';
  if (isRestaurant(proxy)) return 'dining';
  return null;
}

function buildSectorLinkedPlaces(cooccurs, predicate, threshold){
  const buckets = { attraction:new Map(), hotel:new Map(), retail:new Map(), dining:new Map() };
  cooccurs.forEach(r => {
    const a = { poi_cate:r.poi_a_cate, poi_name:r.poi_a_name };
    const b = { poi_cate:r.poi_b_cate, poi_name:r.poi_b_name };
    const w = Number(r.cooccur_n || 0);
    if (!w) return;
    if (predicate(a) && !predicate(b)) addSectorLinked(buckets, r.poi_b_id, r.poi_b_name, b, w);
    if (predicate(b) && !predicate(a)) addSectorLinked(buckets, r.poi_a_id, r.poi_a_name, a, w);
  });
  return Object.fromEntries(Object.entries(buckets).map(([k,v]) => [k, sortHotelLinked(v, threshold)]));
}

function addSectorLinked(buckets, poiId, poiName, proxy, weight){
  const bucketKey = detectBucket(proxy);
  if (!bucketKey) return;
  const bucket = buckets[bucketKey];
  if (!bucket) return;
  const key = String(poiId || poiName || 'Unknown');
  const item = bucket.get(key) || { poi_id: poiId, poi_name: poiName || 'Unknown', score: 0 };
  item.score += weight;
  bucket.set(key, item);
}

function renderSectorLinkedGrid(selector, linked, defs){
  const node = MMM.qs(selector);
  if (!node) return;
  node.innerHTML = defs.map(def => {
    const rows = linked[def.key] || [];
    const max = Math.max(...rows.map(r => Number(r.score || 0)), 1);
    const total = rows.reduce((acc, r) => acc + Number(r.score || 0), 0) || 1;
    return `
      <article class="hotel-linked-card">
        <h3>${def.title}</h3>
        ${rows.length ? `<div class="hotel-linked-list">${rows.map((r, idx) => {
          const pct = Math.max(12, (Number(r.score || 0) / max) * 100);
          const share = ((Number(r.score || 0) / total) * 100).toFixed(1);
          return `
            <a class="hotel-linked-row" href="${reportHref(r.poi_id)}" title="Open place report for ${escapeHtml(r.poi_name || 'Unknown')}">
              <div class="hotel-linked-top">
                <div class="hotel-linked-main">${rankBadge(idx)}<div class="hotel-rank-name">${escapeHtml(r.poi_name || 'Unknown')}</div></div>
                <div class="hotel-rank-value">${share}%</div>
              </div>
              <div class="hotel-rank-track"><span style="width:${pct}%"></span></div>
            </a>`;
        }).join('')}</div>` : `<div class="empty">No matching places in this demo sample.</div>`}
      </article>`;
  }).join('');
}


function typeLabel(proxy){
  if (isAttraction(proxy)) return 'Attraction';
  if (isHotel(proxy)) return 'Hotel';
  if (isRetail(proxy)) return 'Retail';
  if (isRestaurant(proxy)) return 'Dining';
  return 'Place';
}

function compareReportHref(aId, bId){
  const params = new URLSearchParams();
  if (aId != null && aId !== '') params.set('place', String(aId));
  if (bId != null && bId !== '') params.set('compare', String(bId));
  const qs = params.toString();
  return `./report.html${qs ? `?${qs}` : ''}`;
}

function buildProductPairings(cooccurs){
  const map = new Map();
  cooccurs.forEach(r => {
    const aId = String(r.poi_a_id || '');
    const bId = String(r.poi_b_id || '');
    if (!aId || !bId || aId === bId) return;
    const [first, second] = [
      { id:aId, name:r.poi_a_name || 'Unknown', cate:r.poi_a_cate || '' },
      { id:bId, name:r.poi_b_name || 'Unknown', cate:r.poi_b_cate || '' },
    ].sort((x,y)=> x.name.localeCompare(y.name));
    const key = `${first.id}__${second.id}`;
    const entry = map.get(key) || {
      aId:first.id, bId:second.id, aName:first.name, bName:second.name,
      aType:typeLabel({ poi_name:first.name, poi_cate:first.cate }),
      bType:typeLabel({ poi_name:second.name, poi_cate:second.cate }),
      count:0, weighted:0
    };
    const n = Number(r.cooccur_n || 0);
    entry.count += n;
    entry.weighted += Number(r.avg_journey_sentiment || 0) * n;
    map.set(key, entry);
  });
  const rows = [...map.values()].map(r => ({
    ...r,
    label:`${r.aName} + ${r.bName}`,
    tag:`${r.aType} + ${r.bType}`,
    avg:r.count ? r.weighted / r.count : 0
  }));
  const total = rows.reduce((acc,r)=>acc + r.count, 0) || 1;
  return rows.map(r => ({ ...r, share:r.count / total })).sort((a,b)=>b.count-a.count);
}

function buildProductRoutes(flows){
  const map = new Map();
  flows.forEach(r => {
    const aId = String(r.origin_poi_id || '');
    const bId = String(r.dest_poi_id || '');
    if (!aId || !bId || aId === bId) return;
    const key = `${aId}__${bId}`;
    const entry = map.get(key) || {
      aId, bId,
      aName:r.origin_poi_name || 'Unknown',
      bName:r.dest_poi_name || 'Unknown',
      aType:typeLabel({ poi_name:r.origin_poi_name, poi_cate:r.origin_poi_cate }),
      bType:typeLabel({ poi_name:r.dest_poi_name, poi_cate:r.dest_poi_cate }),
      count:0
    };
    entry.count += Number(r.flow_n || 0);
    map.set(key, entry);
  });
  const rows = [...map.values()].map(r => ({
    ...r,
    label:`${r.aName} → ${r.bName}`,
    tag:`${r.aType} → ${r.bType}`
  }));
  const total = rows.reduce((acc,r)=>acc+r.count,0) || 1;
  return rows.map(r=>({ ...r, share:r.count/total })).sort((a,b)=>b.count-a.count);
}



function renderProductDesignersPage(places, flows, cooccurs, threshold){
  const matrixThreshold = Number(threshold || 5);
  const pairings = buildProductPairings(cooccurs || []);
  const popular = pairings.slice(0,5);
  const rated = pairings.filter(r => Number(r.count || 0) >= matrixThreshold).slice().sort((a,b)=>b.avg-a.avg || b.count-a.count).slice(0,5);
  const compareRows = pairings.filter(r => Number(r.count || 0) >= matrixThreshold && Number(r.avg || 0) > 0);
  const highPotential = buildHighPotentialPairings(pairings, matrixThreshold, popular, rated).slice(0,5);

  renderDesignerPopularList('#designer-popular-list', popular);
  renderDesignerRatedList('#designer-rated-list', rated);
  renderDesignerCompareChart('#designer-compare-chart', compareRows, matrixThreshold);
  renderDesignerHighPotentialList('#designer-routes-list', highPotential);
}

function designerPairKey(r){
  return `${r.aId || ''}__${r.bId || ''}`;
}

function percentile(sortedValues, p){
  if (!sortedValues.length) return 0;
  const pos = (sortedValues.length - 1) * p;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sortedValues[base + 1];
  return next == null ? sortedValues[base] : sortedValues[base] + rest * (next - sortedValues[base]);
}

function buildHighPotentialPairings(pairings, threshold = 5, popularRows = [], ratedRows = []){
  const base = (pairings || []).filter(r => Number(r.count || 0) >= threshold && Number(r.avg || 0) > 0 && r.aType !== r.bType);
  if (!base.length) return [];

  const shares = base.map(r => Number(r.share || 0)).sort((a,b)=>a-b);
  const ratings = base.map(r => Number(r.avg || 0)).sort((a,b)=>a-b);
  const shareMedian = percentile(shares, .5) || 0;
  const shareUpper = percentile(shares, .75) || shares[shares.length - 1] || 0;
  const ratingMedian = percentile(ratings, .5) || 0;
  const popularKeys = new Set(popularRows.map(designerPairKey));
  const ratedKeys = new Set(ratedRows.map(designerPairKey));

  const makeCandidate = (r) => {
    const share = Number(r.share || 0);
    const rating = Number(r.avg || 0);
    const useGap = Math.max(0, (shareMedian - share) / Math.max(shareMedian, 1e-9));
    const ratingLift = Math.max(0, rating - ratingMedian);
    return { ...r, useGap, ratingLift, whyLabel: 'Good rating · less common' };
  };

  const rank = rows => rows
    .map(makeCandidate)
    .sort((a,b)=>b.avg-a.avg || b.useGap-a.useGap || b.count-a.count);

  let candidates = rank(base
    .filter(r => Number(r.avg || 0) >= ratingMedian)
    .filter(r => Number(r.share || 0) <= shareMedian)
    .filter(r => !popularKeys.has(designerPairKey(r)))
    .filter(r => !ratedKeys.has(designerPairKey(r))));

  if (candidates.length < 3) {
    candidates = rank(base
      .filter(r => Number(r.avg || 0) >= ratingMedian)
      .filter(r => Number(r.share || 0) <= shareUpper)
      .filter(r => !popularKeys.has(designerPairKey(r))));
  }
  if (candidates.length < 3) {
    candidates = rank(base
      .filter(r => Number(r.avg || 0) >= ratingMedian)
      .filter(r => Number(r.share || 0) <= shareUpper));
  }
  return candidates;
}

function pairingNameMarkup(r){
  return `
    <div class="designer-pair-pills">
      <span class="designer-place-pill">${escapeHtml(r.aName)}</span>
      <span class="designer-pair-symbol">+</span>
      <span class="designer-place-pill">${escapeHtml(r.bName)}</span>
    </div>
    <div class="designer-tag">${escapeHtml(r.tag)}</div>`;
}

function renderDesignerPopularList(selector, rows){
  const node = MMM.qs(selector);
  if (!node) return;
  if (!rows.length) { node.innerHTML = '<div class="empty">No pairing data in this demo sample.</div>'; return; }
  const maxShare = Math.max(...rows.map(r=>Number(r.share||0)), 1e-9);
  node.innerHTML = `<div class="designer-rank-list">${rows.map((r, idx) => {
    const pct = Math.max(8, (Number(r.share||0) / maxShare) * 100);
    return `
      <a class="designer-rank-row designer-rank-row--popular" href="${compareReportHref(r.aId, r.bId)}" title="Open comparison report for ${escapeHtml(r.label)}">
        <div class="designer-rank-main">
          ${rankBadge(idx)}
          <div class="designer-rank-texts">
            ${pairingNameMarkup(r)}
          </div>
        </div>
        <div class="designer-rank-metric designer-rank-metric--popular">
          <div class="designer-rank-metric-row designer-rank-metric-row--single"><strong>${(Number(r.share||0)*100).toFixed(2)}%</strong></div>
          <div class="designer-score-track"><span style="width:${pct}%"></span></div>
        </div>
      </a>`;
  }).join('')}</div>`;
}

function renderDesignerStars(score){
  const value = Math.max(0, Math.min(1, Number(score || 0)));
  const stars = value * 5;
  return `<div class="designer-stars" aria-label="${value.toFixed(2)} rating">${Array.from({length:5}).map((_,i)=>{
    const fill = Math.max(0, Math.min(1, stars - i));
    return `<span class="designer-star"><span class="designer-star-bg">★</span><span class="designer-star-fill" style="width:${(fill*100).toFixed(1)}%">★</span></span>`;
  }).join('')}</div>`;
}

function renderDesignerRatedList(selector, rows){
  const node = MMM.qs(selector);
  if (!node) return;
  if (!rows.length) { node.innerHTML = '<div class="empty">No pairing data in this demo sample.</div>'; return; }
  node.innerHTML = `<div class="designer-rank-list">${rows.map((r, idx) => {
    const score = Math.max(0, Math.min(1, Number(r.avg || 0)));
    return `
      <a class="designer-rank-row designer-rank-row--rated" href="${compareReportHref(r.aId, r.bId)}" title="Open comparison report for ${escapeHtml(r.label)}">
        <div class="designer-rank-main">
          ${rankBadge(idx)}
          <div class="designer-rank-texts">
            ${pairingNameMarkup(r)}
          </div>
        </div>
        <div class="designer-rating-wrap">
          ${renderDesignerStars(score)}
          <div class="designer-rating-value">${score.toFixed(2)}</div>
        </div>
      </a>`;
  }).join('')}</div>`;
}

function renderDesignerCompareChart(selector, rows, threshold = 5){
  const node = MMM.qs(selector);
  if (!node) return;
  if (!rows.length) { node.innerHTML = `<div class="empty">No pairings seen together ${Number(threshold || 5)}+ times in this sample.</div>`; return; }

  const pops = rows.map(r => Number(r.share || 0)).filter(v => v > 0).sort((a,b)=>a-b);
  const ratings = rows.map(r => Number(r.avg || 0)).sort((a,b)=>a-b);
  const popMedian = percentile(pops, .5) || pops[0] || 1e-4;
  const ratingMedian = percentile(ratings, .5) || .5;
  const popMin = Math.max(pops[0] || 1e-4, 1e-4);
  const popMax = Math.max(pops[pops.length-1] || popMin * 1.01, popMin * 1.01);
  const logMin = Math.log10(popMin);
  const logMax = Math.log10(popMax);
  const logRange = Math.max(logMax - logMin, 1e-6);

  const W = 980, H = 468, pad = {l:122,r:48,t:58,b:82};
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const x = v => pad.l + ((Math.log10(Math.max(Number(v || popMin), popMin)) - logMin) / logRange) * plotW;
  const y = v => H - pad.b - (Math.max(0, Math.min(1, Number(v || 0))) * plotH);
  const midX = Math.max(pad.l + 2, Math.min(W - pad.r - 2, x(popMedian || popMin)));
  const midY = Math.max(pad.t + 2, Math.min(H - pad.b - 2, y(ratingMedian || .5)));
  const xLabelY = H - pad.b + 13;
  const lowX = pad.l - 2;
  const highX = W - pad.r - 6;
  const medianX = Math.min(Math.max(midX + 76, pad.l + 190), W - pad.r - 172);
  const bottomQuadrantY = xLabelY + 23;
  const leftAxisX = pad.l - 12;

  node.innerHTML = `
    <div class="designer-scatter-wrap">
      <div class="designer-scatter-tooltip" id="designer-scatter-tooltip" aria-hidden="true"></div>
      <svg viewBox="0 0 ${W} ${H}" class="designers-scatter-svg" role="img" aria-label="Popular vs top-rated pairings">
        <rect x="0" y="0" width="${W}" height="${H}" rx="16" fill="#ffffff"></rect>
        <rect x="${pad.l}" y="${pad.t}" width="${midX-pad.l}" height="${midY-pad.t}" fill="#eef7ef"></rect>
        <rect x="${midX}" y="${pad.t}" width="${W-pad.r-midX}" height="${midY-pad.t}" fill="#edf4ff"></rect>
        <rect x="${pad.l}" y="${midY}" width="${midX-pad.l}" height="${H-pad.b-midY}" fill="#f5f7fa"></rect>
        <rect x="${midX}" y="${midY}" width="${W-pad.r-midX}" height="${H-pad.b-midY}" fill="#fbf1e7"></rect>
        <line x1="${pad.l}" y1="${H-pad.b}" x2="${W-pad.r}" y2="${H-pad.b}" stroke="#cdd8e5" stroke-width="1.5"></line>
        <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H-pad.b}" stroke="#cdd8e5" stroke-width="1.5"></line>
        <line x1="${midX}" y1="${pad.t}" x2="${midX}" y2="${H-pad.b}" stroke="#d8e2ef" stroke-dasharray="5 5"></line>
        <line x1="${pad.l}" y1="${midY}" x2="${W-pad.r}" y2="${midY}" stroke="#d8e2ef" stroke-dasharray="5 5"></line>

        <text x="${lowX}" y="${xLabelY}" text-anchor="start" class="designer-axis-label">Low popularity</text>
        <text x="${medianX}" y="${xLabelY}" text-anchor="middle" class="designer-axis-label">Median popularity</text>
        <text x="${highX}" y="${xLabelY}" text-anchor="end" class="designer-axis-label">High popularity</text>
        <text x="${leftAxisX}" y="${H-pad.b}" text-anchor="end" class="designer-axis-label">Low rating</text>
        <text x="${leftAxisX}" y="${midY}" text-anchor="end" class="designer-axis-label">Median rating</text>
        <text x="${leftAxisX}" y="${pad.t}" text-anchor="end" class="designer-axis-label">High rating</text>

        <text x="${pad.l}" y="${pad.t-18}" class="designer-quadrant designer-quadrant--tl">High-potential</text>
        <text x="${W-pad.r}" y="${pad.t-18}" text-anchor="end" class="designer-quadrant designer-quadrant--tr">Popular and top-rated</text>
        <text x="${pad.l}" y="${bottomQuadrantY}" class="designer-quadrant designer-quadrant--bl">Lower priority</text>
        <text x="${W-pad.r}" y="${bottomQuadrantY}" text-anchor="end" class="designer-quadrant designer-quadrant--br">Popular but mixed</text>

        ${rows.map(r => {
          const cx = x(r.share || popMin), cy = y(r.avg), radius = 3.8;
          return `<g class="designers-scatter-item" tabindex="0" role="link" aria-label="Open comparison report for ${escapeHtml(r.label)}" data-name="${escapeHtml(r.label)}" data-tag="${escapeHtml(r.tag)}" data-count="${Number(r.count || 0).toFixed(0)}" data-pop="${(Number(r.share || 0)*100).toFixed(2)}" data-rating="${Number(r.avg || 0).toFixed(2)}" data-href="${compareReportHref(r.aId, r.bId)}"><circle cx="${cx}" cy="${cy}" r="12" class="designers-scatter-hit"></circle><circle cx="${cx}" cy="${cy}" r="${radius}" class="designers-scatter-dot"></circle></g>`;
        }).join('')}
      </svg>
    </div>`;

  const tooltip = node.querySelector('#designer-scatter-tooltip');
  const wrap = node.querySelector('.designer-scatter-wrap');
  const hideTip = () => {
    tooltip.classList.remove('show');
    tooltip.setAttribute('aria-hidden', 'true');
    tooltip.style.setProperty('left', '-9999px', 'important');
    tooltip.style.setProperty('top', '-9999px', 'important');
  };
  const moveTip = (e, pt) => {
    const rect = wrap.getBoundingClientRect();
    tooltip.innerHTML = `<strong>${pt.dataset.name}</strong><div>${pt.dataset.tag}</div><div>${pt.dataset.pop}% popularity · ${pt.dataset.rating} rating · ${pt.dataset.count} together</div>`;
    tooltip.classList.add('show');
    tooltip.setAttribute('aria-hidden', 'false');
    const width = tooltip.offsetWidth || 240;
    const height = tooltip.offsetHeight || 70;
    const left = Math.max(8, Math.min(e.clientX - rect.left + 14, rect.width - width - 8));
    const top = Math.max(8, Math.min(e.clientY - rect.top - 16, rect.height - height - 8));
    tooltip.style.setProperty('left', `${left}px`, 'important');
    tooltip.style.setProperty('top', `${top}px`, 'important');
  };
  node.querySelectorAll('.designers-scatter-item').forEach(pt => {
    ['pointerenter','mouseenter'].forEach(evt => pt.addEventListener(evt, e => moveTip(e, pt)));
    ['pointermove','mousemove'].forEach(evt => pt.addEventListener(evt, e => moveTip(e, pt)));
    ['pointerleave','mouseleave'].forEach(evt => pt.addEventListener(evt, hideTip));
    pt.addEventListener('focus', e => {
      const rect = pt.getBoundingClientRect();
      moveTip({ clientX: rect.left + rect.width / 2, clientY: rect.top }, pt);
    });
    pt.addEventListener('blur', hideTip);
    pt.addEventListener('click', () => { window.location.href = pt.dataset.href; });
    pt.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.location.href = pt.dataset.href;
      }
    });
  });
}

function renderDesignerHighPotentialList(selector, rows){
  const node = MMM.qs(selector);
  if (!node) return;
  if (!rows.length) { node.innerHTML = '<div class="empty">No high-potential pairing data in this demo sample.</div>'; return; }
  node.innerHTML = `<div class="designer-opportunity-list">${rows.map((r, idx) => {
    const rating = Math.max(0, Math.min(1, Number(r.avg || 0)));
    return `
      <a class="designer-opportunity-row" href="${compareReportHref(r.aId, r.bId)}" title="Open comparison report for ${escapeHtml(r.label)}">
        <div class="designer-rank-main">
          ${rankBadge(idx)}
          <div class="designer-rank-texts">
            ${pairingNameMarkup(r)}
          </div>
        </div>
        <div class="designer-opportunity-side">
          <div class="designer-opportunity-chip designer-opportunity-chip--rating">
            <span>Rating</span><strong>${rating.toFixed(2)}</strong>
          </div>
          <div class="designer-opportunity-chip designer-opportunity-chip--count">
            <span>Times paired</span><strong>${MMM.fmtNum(Number(r.count || 0))}</strong>
          </div>
        </div>
      </a>`;
  }).join('')}</div>`;
}
function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}
