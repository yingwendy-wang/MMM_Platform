document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [compareIndex, focalPlaces, mobilityPlaces, experiencePlaces, companions] = await Promise.all([
      MMM.fetchJSON('reports/compare_index.json'),
      MMM.fetchJSON('dictionaries/focal_places.json'),
      MMM.fetchJSON('mobility/mobility_places.json'),
      MMM.fetchJSON('experience/experience_places.json'),
      MMM.fetchJSON('networks/place_companions.json'),
    ]);

    const escapeHtml = (str) => String(str ?? '').replace(/[&<>"']/g, s => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[s]));
    const fmtNum = (v) => MMM.fmtNum(Number(v || 0));
    const fmtRating = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n.toFixed(2) : '—';
    };
    const fmtPct = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? `${n.toFixed(2)}%` : '—';
    };
    const idOf = (row) => String(row?.poi_id ?? '');
    const placeParam = (row) => encodeURIComponent(idOf(row));
    const reportUrl = (row) => idOf(row) ? `report.html?place=${placeParam(row)}` : 'report.html';
    const mobilityUrl = (row) => idOf(row) ? `mobility.html?place=${placeParam(row)}` : 'mobility.html';
    const experienceUrl = (row) => idOf(row) ? `experience.html?place=${placeParam(row)}` : 'experience.html';
    const compareUrl = (a, b) => `report.html?place=${encodeURIComponent(idOf(a))}&compare=${encodeURIComponent(idOf(b))}`;

    const categoryLabel = (value) => String(value || 'Place').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const rawCategory = (value) => String(value || '').trim().toLowerCase();
    const categoryGroup = (value) => {
      const c = rawCategory(value);
      if (/hotel|accommodation|lodging|resort/.test(c)) return 'hotel';
      if (/dining|restaurant|food|drink|cafe|bar|dessert/.test(c)) return 'dining';
      if (/shopping|retail|mall|store|market/.test(c)) return 'shopping';
      if (/entertainment|attraction|theme|museum|park/.test(c)) return 'entertainment';
      return c || 'other';
    };

    const byId = new Map();
    (focalPlaces || []).forEach(p => byId.set(idOf(p), { ...p }));
    (compareIndex || []).forEach(p => byId.set(idOf(p), { ...(byId.get(idOf(p)) || {}), ...p, has_report: true }));

    function getExperience(id) {
      return experiencePlaces?.[String(id)] || null;
    }

    function getMobility(id) {
      return mobilityPlaces?.[String(id)] || null;
    }

    const places = [...byId.values()]
      .filter(p => idOf(p) && p.poi_name)
      .map(p => {
        const exp = getExperience(idOf(p));
        const mob = getMobility(idOf(p));
        const mentions = Number(p.journey_n_total ?? p.stop_n_total ?? p.frame_n_total ?? 0);
        const rating = Number.isFinite(Number(p.avg_stop_sentiment))
          ? Number(p.avg_stop_sentiment)
          : (Number.isFinite(Number(exp?.avg_stop_sentiment)) ? Number(exp.avg_stop_sentiment) : null);
        const companionRows = companions?.[idOf(p)] || [];
        const connectedCount = companionRows.length + Number(mob?.total_inbound || 0) + Number(mob?.total_outbound || 0);
        return { ...p, mentions, rating, connectedCount, category_group: categoryGroup(p.poi_cate) };
      })
      .filter(p => p.mentions > 0 || Number.isFinite(Number(p.rating)));

    const totalMentions = places.reduce((acc, p) => acc + Number(p.mentions || 0), 0) || 1;
    places.forEach(p => { p.mention_share_pct = Number(p.mentions || 0) / totalMentions * 100; });

    const finiteRatings = places.map(p => Number(p.rating)).filter(Number.isFinite);
    const finiteMentions = places.map(p => Number(p.mention_share_pct)).filter(Number.isFinite);

    function median(values) {
      if (!values.length) return 0;
      const s = values.slice().sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }

    const medianRating = median(finiteRatings);
    const medianMention = median(finiteMentions);
    const minShareForCandidates = Math.max(0.10, medianMention * 0.2);

    const ratingSort = (a, b) => Number(b.rating || -1) - Number(a.rating || -1) || Number(b.mention_share_pct || 0) - Number(a.mention_share_pct || 0);
    const mentionSort = (a, b) => Number(b.mention_share_pct || 0) - Number(a.mention_share_pct || 0) || Number(b.rating || -1) - Number(a.rating || -1);
    const nameSort = (a, b) => String(a.poi_name).localeCompare(String(b.poi_name));

    let talkedAndRated = places
      .filter(p => Number(p.mention_share_pct) >= medianMention && Number(p.rating) >= medianRating)
      .sort(mentionSort)
      .slice(0, 6);

    let promotionCandidates = places
      .filter(p => Number(p.rating) >= medianRating && Number(p.mention_share_pct) < medianMention && Number(p.mention_share_pct) >= minShareForCandidates)
      .sort(ratingSort)
      .slice(0, 6);

    let placesToCheck = places
      .filter(p => Number(p.mention_share_pct) >= medianMention && Number(p.rating) < medianRating)
      .sort(mentionSort)
      .slice(0, 6);

    if (!talkedAndRated.length) {
      talkedAndRated = places.slice().filter(p => Number.isFinite(Number(p.rating))).sort((a, b) => (Number(b.mention_share_pct || 0) + Number(b.rating || 0)) - (Number(a.mention_share_pct || 0) + Number(a.rating || 0))).slice(0, 6);
    }
    if (!promotionCandidates.length) {
      promotionCandidates = places.slice().filter(p => Number.isFinite(Number(p.rating))).sort(ratingSort).slice(0, 6);
    }
    if (!placesToCheck.length) {
      placesToCheck = places.slice().sort(mentionSort).slice(0, 6);
    }

    function findPlaceByName(name) {
      const cleaned = String(name || '').trim().toLowerCase();
      if (!cleaned) return null;
      return places.find(p => String(p.poi_name || '').toLowerCase() === cleaned)
        || places.find(p => String(p.poi_name || '').toLowerCase().includes(cleaned));
    }

    function placeRow(row, mode = 'mentions') {
      const action = mode === 'rating'
        ? { href: experienceUrl(row), text: 'Rating details →' }
        : { href: mobilityUrl(row), text: 'Mention details →' };
      const companion = row.top_companion_poi_name || (companions?.[idOf(row)] || [])[0]?.companion_poi_name;
      return `
        <div class="place-performance-row place-performance-row--clickable" role="link" tabindex="0" data-report-url="${reportUrl(row)}">
          <div class="place-performance-row-main">
            <div class="place-performance-title-line">
              <a class="place-performance-place-name" href="${reportUrl(row)}">${escapeHtml(row.poi_name || '—')}</a>
              <a class="place-performance-report-link" href="${reportUrl(row)}">Place report →</a>
            </div>
            <small>${escapeHtml(categoryLabel(row.poi_cate))}${companion ? ` · Often linked with ${escapeHtml(companion)}` : ''}</small>
          </div>
          <div class="place-performance-row-metrics">
            <span>${fmtPct(row.mention_share_pct)} of mentions</span>
            <span>Rating ${fmtRating(row.rating)}</span>
            ${row.top_market ? `<span>Main market ${escapeHtml(row.top_market)}</span>` : ''}
          </div>
          <a class="place-performance-inline-link" href="${action.href}">${action.text}</a>
        </div>`;
    }

    function bindRows(root = document) {
      MMM.qsa('.place-performance-row[data-report-url]', root).forEach(row => {
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

    function renderList(selector, rows, mode, emptyText) {
      const node = MMM.qs(selector);
      if (!node) return;
      node.innerHTML = rows.length ? rows.map(r => placeRow(r, mode)).join('') : `<div class="empty">${emptyText}</div>`;
      bindRows(node);
    }

    const coreCategories = [
      { key: 'entertainment', title: 'Entertainment' },
      { key: 'hotel', title: 'Hotels' },
      { key: 'dining', title: 'Dining' },
      { key: 'shopping', title: 'Shopping' },
    ];

    function renderCategoryLeaders() {
      const node = MMM.qs('#category-leader-list');
      if (!node) return;
      node.innerHTML = coreCategories.map(cat => {
        const rows = places.filter(p => p.category_group === cat.key);
        const byMention = rows.slice().sort(mentionSort)[0];
        const byRatingPool = rows.filter(r => Number.isFinite(Number(r.rating)) && Number(r.mention_share_pct) >= minShareForCandidates);
        const byRating = (byRatingPool.length ? byRatingPool : rows.filter(r => Number.isFinite(Number(r.rating)))).slice().sort(ratingSort)[0];
        const mentionLine = byMention
          ? `<a href="${reportUrl(byMention)}"><span>Most Talked-About</span><strong>${escapeHtml(byMention.poi_name || '—')}</strong><em>${fmtPct(byMention.mention_share_pct)} of mentions</em></a>`
          : `<div class="place-category-empty"><span>Most Talked-About</span><strong>No data yet</strong></div>`;
        const ratingLine = byRating
          ? `<a href="${reportUrl(byRating)}"><span>Best-Rated</span><strong>${escapeHtml(byRating.poi_name || '—')}</strong><em>Rating ${fmtRating(byRating.rating)}</em></a>`
          : `<div class="place-category-empty"><span>Best-Rated</span><strong>No data yet</strong></div>`;
        return `
          <div class="place-category-card">
            <div class="place-category-card-head">
              <strong>${escapeHtml(cat.title)}</strong>
              <span>${fmtNum(rows.length)} places</span>
            </div>
            <div class="place-category-mini-list">
              ${mentionLine}
              ${ratingLine}
            </div>
          </div>`;
      }).join('');
    }

    function linkedPairs() {
      const sameType = [];
      const differentType = [];
      const seen = new Set();
      const addPair = (a, b, cooccurN) => {
        if (!a || !b || idOf(a) === idOf(b)) return;
        const ids = [idOf(a), idOf(b)].sort().join('|');
        if (seen.has(ids)) return;
        seen.add(ids);
        const pair = { a, b, cooccurN: Number(cooccurN || 0) };
        if (categoryGroup(a.poi_cate) === categoryGroup(b.poi_cate)) sameType.push(pair);
        else differentType.push(pair);
      };

      places.forEach(p => {
        const compRows = companions?.[idOf(p)] || [];
        compRows.forEach(c => {
          const b = byId.get(String(c.companion_poi_id)) || findPlaceByName(c.companion_poi_name);
          addPair(p, b, c.cooccur_n);
        });
        if (p.top_companion_poi_name) addPair(p, findPlaceByName(p.top_companion_poi_name), 0);
      });

      const sortPairs = (a, b) => Number(b.cooccurN || 0) - Number(a.cooccurN || 0);
      return {
        sameType: sameType.sort(sortPairs).slice(0, 4),
        differentType: differentType.sort(sortPairs).slice(0, 4),
      };
    }

    function renderCompareCard(pair) {
      return `
        <a class="place-compare-card" href="${compareUrl(pair.a, pair.b)}">
          <div>
            <strong>${escapeHtml(pair.a.poi_name)} + ${escapeHtml(pair.b.poi_name)}</strong>
            <span>${escapeHtml(categoryLabel(pair.a.poi_cate))} + ${escapeHtml(categoryLabel(pair.b.poi_cate))}${pair.cooccurN ? ` · linked ${fmtNum(pair.cooccurN)} times` : ''}</span>
          </div>
          <em>Compare →</em>
        </a>`;
    }

    function renderCompareSuggestions() {
      const node = MMM.qs('#compare-suggestion-list');
      if (!node) return;
      const pairs = linkedPairs();
      node.innerHTML = `
        <div class="place-compare-column">
          <h3>Same type, often linked</h3>
          <p>Useful for comparing similar places people connect.</p>
          <div class="place-compare-stack">
            ${pairs.sameType.length ? pairs.sameType.map(renderCompareCard).join('') : '<div class="empty">No same-type linked pairs yet.</div>'}
          </div>
        </div>
        <div class="place-compare-column">
          <h3>Different types, often linked</h3>
          <p>Useful for route ideas, packages, or cross-place partnerships.</p>
          <div class="place-compare-stack">
            ${pairs.differentType.length ? pairs.differentType.map(renderCompareCard).join('') : '<div class="empty">No cross-type linked pairs yet.</div>'}
          </div>
        </div>`;
    }

    function setupSearch() {
      const input = MMM.qs('#place-performance-search');
      const button = MMM.qs('#place-performance-search-button');
      const results = MMM.qs('#place-performance-results');
      const clearBtn = MMM.qs('#place-performance-clear');
      if (!input || !button || !results) return;

      const sortedPlaces = places.filter(p => p.has_report).sort(nameSort);
      let selectedPlace = null;
      let typingMode = false;

      const filterPlaces = (query, useFilter = true) => {
        const q = String(query || '').trim().toLowerCase();
        const pool = useFilter && q
          ? sortedPlaces.filter(p => String(p.poi_name || '').toLowerCase().includes(q))
          : sortedPlaces;
        return pool;
      };

      const hideResults = () => { results.hidden = true; };
      const updateClear = () => {
        if (!clearBtn) return;
        clearBtn.hidden = !input.value.trim();
      };
      const showResults = (query = '', useFilter = true) => {
        const matches = filterPlaces(query, useFilter);
        results.innerHTML = matches.length
          ? matches.map(p => `
              <button type="button" class="place-search-result" data-id="${escapeHtml(idOf(p))}">
                <span>${escapeHtml(p.poi_name)}</span>
              </button>`).join('')
          : '<div class="place-search-empty">No matching place.</div>';
        results.hidden = false;
      };

      const selectPlace = (row) => {
        selectedPlace = row || null;
        input.value = row?.poi_name || '';
        typingMode = false;
        updateClear();
        hideResults();
      };

      const clearSelection = () => {
        selectedPlace = null;
        typingMode = false;
        input.value = '';
        updateClear();
        input.focus();
        showResults('', false);
      };

      const open = () => {
        const row = selectedPlace || findPlaceByName(input.value) || filterPlaces(input.value, true)[0];
        if (row) window.location.href = reportUrl(row);
      };

      input.addEventListener('focus', () => {
        typingMode = false;
        input.select();
        showResults('', false);
      });
      input.addEventListener('click', () => {
        typingMode = false;
        showResults('', false);
      });
      input.addEventListener('input', () => {
        selectedPlace = null;
        typingMode = true;
        updateClear();
        showResults(input.value, true);
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') open();
        if (event.key === 'Escape') hideResults();
      });
      button.addEventListener('click', open);
      if (clearBtn) clearBtn.addEventListener('click', clearSelection);
      results.addEventListener('mousedown', (event) => {
        const btn = event.target.closest('.place-search-result');
        if (!btn) return;
        event.preventDefault();
        const row = sortedPlaces.find(p => idOf(p) === btn.dataset.id);
        selectPlace(row);
      });
      document.addEventListener('click', (event) => {
        if (!event.target.closest('.place-search-panel')) hideResults();
      });
      updateClear();
    }

    renderList('#strong-performer-list', talkedAndRated, 'mentions', 'No places available yet.');
    renderList('#promotion-candidate-list', promotionCandidates, 'rating', 'No places available yet.');
    renderList('#places-to-check-list', placesToCheck, 'rating', 'No places available yet.');
    renderCategoryLeaders();
    renderCompareSuggestions();
    setupSearch();
  } catch (err) {
    console.error(err);
  }
});
