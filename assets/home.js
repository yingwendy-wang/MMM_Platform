document.addEventListener('DOMContentLoaded', async () => {
  try {
    const overview = await MMM.fetchJSON('home/home_overview.json');

    MMM.renderStats(MMM.qs('#home-kpis'), [
      { label:'Activity Records', value:MMM.fmtNum(overview.total_videos), sub:'Social media records used here' },
      { label:'Places', value:MMM.fmtNum(overview.total_pois), sub:'Standardized Hong Kong places' },
      { label:'Avg. Places / Record', value:Number(overview.avg_stops_per_journey || 0).toFixed(1), sub:'How many places appear together' },
      { label:'Avg. Rating Signal', value:Number(overview.avg_journey_sentiment || 0).toFixed(2), sub:'Overall response signal' },
      { label:'Earliest Date', value:(overview.default_start_date || '—'), sub:'Data coverage begins' },
      { label:'Latest Date', value:(overview.default_end_date || '—'), sub:'Data coverage ends' },
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
