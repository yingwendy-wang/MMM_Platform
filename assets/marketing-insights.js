document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [overview, marketSummary, marketCategories, marketPlaces, featurePlaces, reportIndex] = await Promise.all([
      MMM.fetchJSON('marketing/marketing_overview.json'),
      MMM.fetchJSON('marketing/market_summary.json'),
      MMM.fetchJSON('marketing/market_categories.json'),
      MMM.fetchJSON('marketing/market_places.json'),
      MMM.fetchJSON('marketing/market_feature_places.json'),
      MMM.fetchJSON('reports/compare_index.json'),
    ]);

    const reportIds = new Set((reportIndex || []).map(r => String(r.poi_id)));
    const marketList = MMM.qs('#marketing-market-list');
    const marketContext = MMM.qs('#marketing-market-context');
    const categoryDemandList = MMM.qs('#marketing-category-demand-list');
    const categoryRatingList = MMM.qs('#marketing-category-rating-list');
    const demandPlaces = MMM.qs('#marketing-demand-places');
    const ratingPlaces = MMM.qs('#marketing-rating-places');

    const demandTitle = MMM.qs('#marketing-demand-title');
    const ratingTitle = MMM.qs('#marketing-rating-title');
    const demandPlacesTitle = MMM.qs('#marketing-demand-places-title');
    const ratingPlacesTitle = MMM.qs('#marketing-rating-places-title');
    const demandSubtitle = MMM.qs('#marketing-demand-subtitle');
    const ratingSubtitle = MMM.qs('#marketing-rating-subtitle');
    const demandPlacesSubtitle = MMM.qs('#marketing-demand-places-subtitle');
    const ratingPlacesSubtitle = MMM.qs('#marketing-rating-places-subtitle');

    const summaryByMarket = new Map((marketSummary || []).map(r => [String(r.market), r]));
    const categoryMarkets = new Set((marketCategories || []).map(r => String(r.market)));
    const placeMarkets = new Set((marketPlaces || []).map(r => String(r.market)));
    const featureMarkets = new Set(Object.keys(featurePlaces || {}).map(String));
    const detailMarkets = new Set([...categoryMarkets, ...placeMarkets, ...featureMarkets]);
    const summaryOrder = (marketSummary || []).map(r => String(r.market));
    const allMarkets = [...new Set([...summaryOrder, ...detailMarkets])].filter(Boolean);

    const fmtNum = (v) => MMM.fmtNum(Number(v || 0));
    const fmtRating = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n.toFixed(2) : '—';
    };
    const fmtPct = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? `${n.toFixed(2)}%` : '—';
    };
    const fmtShare = (r) => {
      const raw = r?.share_pct;
      if (raw !== null && raw !== undefined && Number.isFinite(Number(raw))) return fmtPct(raw);
      if (r?.share !== null && r?.share !== undefined && Number.isFinite(Number(r.share))) return fmtPct(Number(r.share) * 100);
      return '—';
    };
    const escapeHtml = (str) => String(str ?? '').replace(/[&<>"']/g, s => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[s]));
    const hasPlaceId = (row) => row?.poi_id !== null && row?.poi_id !== undefined && row?.poi_id !== '';
    const hasReport = (row) => hasPlaceId(row) && (row?.has_report === true || Boolean(row?.report_url) || reportIds.has(String(row.poi_id)));
    const placeParam = (row) => encodeURIComponent(String(row.poi_id));
    const reportUrl = (row) => hasReport(row) ? (row.report_url || `report.html?place=${placeParam(row)}`) : 'report.html';
    const mobilityUrl = (row) => hasPlaceId(row) ? `mobility.html?place=${placeParam(row)}` : 'mobility.html';
    const experienceUrl = (row) => hasPlaceId(row) ? `experience.html?place=${placeParam(row)}` : 'experience.html';
    const RATING_PLACE_MIN_SHARE_PCT = 0.10;

    function sumRows(rows, key) {
      return (rows || []).reduce((acc, r) => acc + Number(r[key] || 0), 0);
    }

    function detailScore(market) {
      const features = featurePlaces?.[market];
      if (features?.strong_demand?.length) return sumRows(features.strong_demand, 'stop_n');
      const rows = (marketPlaces || []).filter(r => String(r.market) === market);
      if (rows.length) return sumRows(rows, 'stop_n');
      const cats = (marketCategories || []).filter(r => String(r.market) === market);
      if (cats.length) return sumRows(cats, 'stop_n');
      return 0;
    }

    function chooseInitialMarket() {
      const fromUrl = MMM.getParam('market');
      if (fromUrl && allMarkets.includes(fromUrl)) return fromUrl;
      const summaryWithDetail = summaryOrder.find(m => detailMarkets.has(m));
      if (summaryWithDetail) return summaryWithDetail;
      const scoredDetail = [...detailMarkets].sort((a, b) => detailScore(b) - detailScore(a))[0];
      if (scoredDetail) return scoredDetail;
      return summaryOrder[0] || allMarkets[0] || '';
    }

    let selectedMarket = chooseInitialMarket();

    function summaryForMarket(market) {
      const summary = summaryByMarket.get(market);
      if (summary) return summary;
      const cats = (marketCategories || []).filter(r => String(r.market) === market);
      const places = (marketPlaces || []).filter(r => String(r.market) === market);
      const topCat = cats.slice().sort((a, b) => Number(b.stop_n || 0) - Number(a.stop_n || 0))[0];
      const topPlace = places.slice().sort((a, b) => Number(b.stop_n || 0) - Number(a.stop_n || 0))[0];
      return {
        market,
        journey_n: null,
        share_pct: null,
        avg_rating: topCat?.avg_rating ?? topPlace?.avg_rating ?? null,
        top_category: topCat?.poi_cate || topPlace?.poi_cate || null,
        top_place_id: topPlace?.poi_id || null,
        top_place_name: topPlace?.poi_name || null,
        top_place_cate: topPlace?.poi_cate || null,
      };
    }

    function getMarketPlaceRows(market) {
      return (marketPlaces || []).filter(r => String(r.market) === market);
    }

    function getFeatureRows(market) {
      const rows = getMarketPlaceRows(market);
      const existing = featurePlaces?.[market] || {};

      const strongDemand = existing.strong_demand?.length
        ? existing.strong_demand
        : rows.slice().sort((a, b) => Number(b.stop_n || 0) - Number(a.stop_n || 0)).slice(0, 5);

      const strongRating = rows.length
        ? rows.slice().sort((a, b) => Number(b.avg_rating || 0) - Number(a.avg_rating || 0) || Number(b.stop_n || 0) - Number(a.stop_n || 0))
        : (existing.strong_rating || []);

      if (strongDemand.length || strongRating.length) {
        return { strong_demand: strongDemand, strong_rating: strongRating };
      }

      const s = summaryByMarket.get(market);
      if (s?.top_place_id) {
        const row = {
          market,
          poi_id: s.top_place_id,
          poi_name: s.top_place_name,
          poi_cate: s.top_place_cate || s.top_category,
          stop_n: null,
          share_pct: null,
          avg_rating: s.avg_rating,
        };
        return { strong_demand: [row], strong_rating: [row] };
      }
      return { strong_demand: [], strong_rating: [] };
    }

    function topRatedMajorMarket() {
      const topMarkets = (marketSummary || [])
        .slice(0, 10)
        .filter(r => Number.isFinite(Number(r.avg_rating)));
      return topMarkets.sort((a, b) => Number(b.avg_rating || 0) - Number(a.avg_rating || 0) || Number(b.journey_n || 0) - Number(a.journey_n || 0))[0] || null;
    }

    function renderKpis() {
      const k = overview?.kpis || {};
      const bestMajor = topRatedMajorMarket();
      MMM.renderStats(MMM.qs('#marketing-kpis'), [
        { label: 'Markets Covered', value: fmtNum(k.active_markets), sub: 'Source markets in the data' },
        { label: 'Main Market', value: k.top_market?.market || '—', sub: k.top_market ? `${fmtPct(k.top_market.share_pct || 0)} of mentions` : 'No data' },
        { label: 'Best-Rated Major Market', value: bestMajor?.market || '—', sub: bestMajor ? `Rating ${fmtRating(bestMajor.avg_rating)} · ${fmtShare(bestMajor)} of mentions` : 'No data' },
      ]);
    }

    function renderMarketList() {
      let rows = (marketSummary || []).slice(0, 10);
      if (selectedMarket && !rows.some(r => String(r.market) === selectedMarket)) {
        rows = [...rows, summaryForMarket(selectedMarket)];
      }
      if (!rows.length && detailMarkets.size) {
        rows = [...detailMarkets].sort((a, b) => detailScore(b) - detailScore(a)).slice(0, 10).map(summaryForMarket);
      }
      if (!rows.length) {
        marketList.innerHTML = '<div class="empty">No market summary available.</div>';
        return;
      }

      const maxShare = Math.max(...rows.map(r => Number(r.share_pct || 0)), 1);
      marketList.innerHTML = rows.map((r, idx) => {
        const market = String(r.market);
        const active = market === selectedMarket ? ' is-active' : '';
        return `
          <button class="marketing-market-row${active}" type="button" data-market="${escapeHtml(market)}">
            <div class="marketing-market-main">
              <span class="marketing-market-rank">${idx + 1}</span>
              <strong>${escapeHtml(market)}</strong>
            </div>
            <div class="marketing-market-metrics">
              <div><span>${fmtShare(r)}</span><small>of mentions</small></div>
              <div><span>${fmtRating(r.avg_rating)}</span><small>rating</small></div>
            </div>
            <div class="marketing-market-bar" aria-hidden="true"><i style="width:${Math.max(4, Number(r.share_pct || 0) / maxShare * 100)}%"></i></div>
          </button>`;
      }).join('');
      MMM.qsa('[data-market]', marketList).forEach(btn => btn.addEventListener('click', () => setMarket(btn.dataset.market)));
    }

    function marketDisplayName(market) {
      return String(market || 'selected market');
    }

    function setDynamicTitles() {
      const market = marketDisplayName(selectedMarket);
      demandTitle.textContent = 'Most Talked-About Place Types';
      ratingTitle.textContent = 'Best-Rated Place Types';
      demandPlacesTitle.textContent = 'Most Talked-About Places';
      ratingPlacesTitle.textContent = 'Best-Rated Places';
      const sub = `For ${market}`;
      if (demandSubtitle) demandSubtitle.textContent = sub;
      if (ratingSubtitle) ratingSubtitle.textContent = sub;
      if (demandPlacesSubtitle) demandPlacesSubtitle.textContent = `${sub} · Click a place to open its report`;
      if (ratingPlacesSubtitle) ratingPlacesSubtitle.textContent = `${sub} · Minimum ${RATING_PLACE_MIN_SHARE_PCT.toFixed(2)}% of mentions`;
    }

    function renderMarketContext() {
      const s = summaryForMarket(selectedMarket);
      marketContext.innerHTML = `
        <div class="marketing-context-main">
          <span class="marketing-context-label">Current market</span>
          <strong>${escapeHtml(marketDisplayName(selectedMarket) || '—')}</strong>
          <p>All four cards below use this market.</p>
        </div>
        <div class="marketing-context-metrics">
          <span>Share: <strong>${fmtShare(s)} of mentions</strong></span>
          <span>Rating: <strong>${fmtRating(s.avg_rating)}</strong></span>
        </div>`;
    }

    function marketCategoryRows() {
      return (marketCategories || [])
        .filter(r => String(r.market) === selectedMarket)
        .filter(r => Number.isFinite(Number(r.stop_n)) || Number.isFinite(Number(r.avg_rating)));
    }

    function renderCategoryDemand() {
      const cats = marketCategoryRows()
        .sort((a, b) => Number(b.stop_n || 0) - Number(a.stop_n || 0))
        .slice(0, 5);
      if (!cats.length) {
        categoryDemandList.innerHTML = '<div class="empty">No place-type detail available for this market.</div>';
        return;
      }
      const max = Math.max(...cats.map(r => Number(r.share_pct || 0)), 1);
      categoryDemandList.innerHTML = cats.map(r => `
        <div class="marketing-category-card">
          <div class="marketing-category-card-head">
            <strong>${escapeHtml(r.poi_cate || 'Other')}</strong>
            <span>${fmtShare(r)}</span>
          </div>
          <div class="marketing-category-bar"><i style="width:${Math.max(4, Number(r.share_pct || 0) / max * 100)}%"></i></div>
        </div>`).join('');
    }

    function renderCategoryRating() {
      const cats = marketCategoryRows()
        .filter(r => Number.isFinite(Number(r.avg_rating)))
        .sort((a, b) => Number(b.avg_rating || 0) - Number(a.avg_rating || 0) || Number(b.stop_n || 0) - Number(a.stop_n || 0))
        .slice(0, 5);
      if (!cats.length) {
        categoryRatingList.innerHTML = '<div class="empty">No rating detail available for this market.</div>';
        return;
      }
      const maxRating = Math.max(...cats.map(r => Number(r.avg_rating || 0)), 1);
      categoryRatingList.innerHTML = cats.map(r => `
        <div class="marketing-category-card marketing-category-card--rating">
          <div class="marketing-category-card-head">
            <div class="marketing-category-type">
              <strong>${escapeHtml(r.poi_cate || 'Other')}</strong>
              <em>${fmtShare(r)} of mentions</em>
            </div>
            <span>${fmtRating(r.avg_rating)}</span>
          </div>
          <div class="marketing-category-bar"><i style="width:${Math.max(4, Number(r.avg_rating || 0) / maxRating * 100)}%"></i></div>
        </div>`).join('');
    }

    function renderPlaceRow(row, mode) {
      const actionUrl = mode === 'rating' ? experienceUrl(row) : mobilityUrl(row);
      const actionText = mode === 'rating' ? 'Rating details →' : 'Mention details →';
      const primaryMetric = mode === 'rating'
        ? `<span>Rating ${fmtRating(row.avg_rating)}</span>`
        : `<span>${fmtShare(row)} of mentions</span>`;
      const secondaryMetric = mode === 'rating'
        ? `<span>${fmtShare(row)} of mentions</span>`
        : `<span>Rating ${fmtRating(row.avg_rating)}</span>`;
      const placeReport = reportUrl(row);

      return `
        <div class="marketing-place-row marketing-place-row--clickable" role="link" tabindex="0" data-report-url="${placeReport}">
          <div class="marketing-place-main">
            <div class="marketing-place-title-line">
              <a class="marketing-place-name" href="${placeReport}">${escapeHtml(row.poi_name || '—')}</a>
              <a class="marketing-report-link" href="${placeReport}" aria-label="Open place report for ${escapeHtml(row.poi_name || 'this place')}">Place report →</a>
            </div>
            <small>${escapeHtml(row.poi_cate || 'Place')}</small>
          </div>
          <div class="marketing-place-metrics">
            ${primaryMetric}
            ${secondaryMetric}
          </div>
          <a class="marketing-place-inline-link" href="${actionUrl}">${actionText}</a>
        </div>`;
    }

    function bindPlaceRows() {
      MMM.qsa('.marketing-place-row[data-report-url]').forEach(row => {
        row.addEventListener('click', (event) => {
          if (event.target.closest('a')) return;
          window.location.href = row.dataset.reportUrl;
        });
        row.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            window.location.href = row.dataset.reportUrl;
          }
        });
      });
    }

    function renderPlaces() {
      const data = getFeatureRows(selectedMarket);
      const demand = (data.strong_demand || []).slice(0, 5);
      const directRows = getMarketPlaceRows(selectedMarket);
      const ratingSource = directRows.length ? directRows : (data.strong_rating || []);
      const ratingPool = ratingSource.filter(r => {
        if (!Number.isFinite(Number(r.avg_rating))) return false;
        const share = Number(r.share_pct);
        if (Number.isFinite(share)) return share >= RATING_PLACE_MIN_SHARE_PCT;
        const stops = Number(r.stop_n);
        return !Number.isFinite(stops) || stops >= 5;
      });
      const rating = ratingPool
        .sort((a, b) => Number(b.avg_rating || 0) - Number(a.avg_rating || 0) || Number(b.stop_n || 0) - Number(a.stop_n || 0))
        .slice(0, 5);

      demandPlaces.innerHTML = demand.length
        ? demand.map(row => renderPlaceRow(row, 'demand')).join('')
        : '<div class="empty">No place list available for this market.</div>';

      ratingPlaces.innerHTML = rating.length
        ? rating.map(row => renderPlaceRow(row, 'rating')).join('')
        : `<div class="empty">No place passes the ${RATING_PLACE_MIN_SHARE_PCT.toFixed(2)}% of mentions threshold for this market.</div>`;

      bindPlaceRows();
    }

    function setMarket(market) {
      if (!market) return;
      selectedMarket = String(market);
      MMM.setParam({ market: selectedMarket });
      render();
    }

    function render() {
      renderMarketList();
      setDynamicTitles();
      renderMarketContext();
      renderCategoryDemand();
      renderCategoryRating();
      renderPlaces();
    }

    renderKpis();
    render();
  } catch (err) {
    console.error(err);
  }
});
