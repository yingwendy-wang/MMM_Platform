document.addEventListener('DOMContentLoaded', async () => {
  try {
    const overview = await MMM.fetchJSON('home/home_overview.json');

    MMM.renderStats(MMM.qs('#home-kpis'), [
      { label:'Journeys / Videos', value:MMM.fmtNum(overview.total_videos), sub:'Visible journey records' },
      { label:'Places', value:MMM.fmtNum(overview.total_pois), sub:'Standardized POIs' },
      { label:'Avg. Stops / Journey', value:Number(overview.avg_stops_per_journey || 0).toFixed(1), sub:'Visible path depth' },
      { label:'Avg. Journey Experience', value:Number(overview.avg_journey_sentiment || 0).toFixed(2), sub:'Observed journey-level experience' },
      { label:'Earliest Date', value:(overview.default_start_date || '—'), sub:'Visible coverage begins' },
      { label:'Latest Date', value:(overview.default_end_date || '—'), sub:'Visible coverage ends' },
    ]);

    const fab = MMM.qs('#assistant-fab');
    const modal = MMM.qs('#chatbot-modal');
    fab?.addEventListener('click', () => modal.classList.toggle('hidden'));
    MMM.qsa('[data-close-chatbot]').forEach(node => node.addEventListener('click', () => modal.classList.add('hidden')));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') modal.classList.add('hidden');
    });
  } catch (err) {
    console.error(err);
  }
});
