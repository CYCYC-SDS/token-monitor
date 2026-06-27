(function exposeHomeOverview(root, factory) {
  const api = factory();
  if (root) root.TokenMonitorHomeOverview = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function createHomeOverviewApi() {
  const windowPriority = new Map([
    ['session', 0],
    ['weekly', 1],
    ['billing', 2],
    ['monthly', 3]
  ]);

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, value));
  }

  function remainingPercent(window) {
    if (!window || window.showMeter === false) return null;
    const remaining = finiteNumber(window.remainingPercent);
    if (remaining != null) return clampPercent(remaining);
    const used = finiteNumber(window.usedPercent);
    return used == null ? null : clampPercent(100 - used);
  }

  function usedPercent(window) {
    const remaining = remainingPercent(window);
    return remaining == null ? null : 100 - remaining;
  }

  function homeLimitAccounts(accounts, limit = 3) {
    return (accounts || [])
      .map((account, index) => {
        const windows = (account.windows || [])
          .map((window, windowIndex) => ({
            kind: String(window.kind || '').trim().toLowerCase(),
            label: window.label || window.kind || '',
            remainingPercent: remainingPercent(window),
            resetsAt: window.resetsAt,
            resetDescription: window.resetDescription || '',
            index: windowIndex
          }))
          .filter((window) => window.remainingPercent != null)
          .sort((a, b) => {
            const aPriority = windowPriority.get(a.kind) ?? 10;
            const bPriority = windowPriority.get(b.kind) ?? 10;
            return aPriority - bPriority || a.index - b.index;
          })
          .slice(0, 2)
          .map(({ index: _index, ...window }) => window);
        if (windows.length === 0) return null;
        return {
          key: account.key || String(index),
          providerId: account.providerId || '',
          name: account.name || '',
          color: account.color || '',
          lowestRemaining: Math.min(...windows.map((window) => window.remainingPercent)),
          windows,
          index
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.lowestRemaining - b.lowestRemaining || a.index - b.index)
      .slice(0, Math.max(0, Number(limit) || 0))
      .map(({ index: _index, ...account }) => account);
  }

  function homeModelRows(rows, totalTokens, limit = 5) {
    const visible = (rows || []).slice(0, Math.max(0, Number(limit) || 0));
    const suppliedTotal = finiteNumber(totalTokens);
    const total = suppliedTotal != null && suppliedTotal > 0
      ? suppliedTotal
      : visible.reduce((sum, row) => sum + Math.max(0, Number(row?.value || 0)), 0);
    return visible.map((row) => ({
      key: row.key || row.name || '',
      name: row.name || '',
      value: Math.max(0, Number(row.value || 0)),
      share: total > 0 ? Math.max(0, Number(row.value || 0)) / total : 0,
      color: row.color || ''
    }));
  }

  function homeTrendSummary(points) {
    const visible = Array.isArray(points) ? points : [];
    const peak = Math.max(0, ...visible.map((point) => Math.max(0, Number(point?.tokens || 0))));
    const dates = visible.length === 0
      ? []
      : [
          visible[0]?.date || '',
          visible[Math.floor((visible.length - 1) / 2)]?.date || '',
          visible[visible.length - 1]?.date || ''
        ];
    return { peak, dates };
  }

  function homeActivityHeatmapLayout() {
    return { cell: 9, gap: 3, radius: 2 };
  }

  function historyHasDays(history) {
    return Array.isArray(history?.daily) && history.daily.length > 0;
  }

  // Which history source the home activity/trends module renders. Prefer the
  // full-year homeHistory (fetched on demand), but fall back to the compact stats
  // preview while it loads — an empty homeHistory must never shadow real preview
  // data (#39: a cold-start fetch that raced the collector cached an empty result).
  function pickHomeHistory(homeHistory, preview) {
    return historyHasDays(homeHistory) ? homeHistory : (preview || { daily: [] });
  }

  // Stable signature of the preview's daily tail. Two previews with the same key
  // describe the same fetch opportunity, so the full history is fetched at most
  // once per distinct preview state — a failed/empty fetch (e.g. a transient
  // /api/history error in hub mode while /api/stats preview has data) can't spin
  // the render→fetch loop, since loadHomeHistory's finally always re-renders Home.
  function historyPreviewKey(preview) {
    const daily = Array.isArray(preview?.daily) ? preview.daily : [];
    if (daily.length === 0) return '';
    const last = daily[daily.length - 1] || {};
    return `${daily.length}:${last.date || ''}:${last.tokens || 0}`;
  }

  // Whether loadHomeHistory should (re)fetch the full history. The first fetch can
  // race the local collector at cold start and return empty; don't let that stick —
  // refetch once the stats preview confirms history exists, but only when the preview
  // has actually changed since the last attempt (so one bad fetch can't loop), stop
  // once we hold the full data, and never poll a genuinely zero-usage account (#39).
  function shouldFetchHomeHistory({ homeHistory, requested, preview, lastPreviewKey } = {}) {
    if (historyHasDays(homeHistory)) return false;
    if (!requested) return true;
    const key = historyPreviewKey(preview);
    if (!key) return false;
    return key !== lastPreviewKey;
  }

  function homeActivityWheelRoute(event) {
    if (event?.shiftKey) return 'activity-horizontal';
    const deltaX = Math.abs(Number(event?.deltaX || 0));
    const deltaY = Math.abs(Number(event?.deltaY || 0));
    return deltaY > deltaX ? 'home-vertical' : 'activity-horizontal';
  }

  function maxScrollLeft(scrollWidth, clientWidth) {
    return Math.max(0, Number(scrollWidth || 0) - Number(clientWidth || 0));
  }

  // Where the activity heatmap should sit: pinned to the newest (right) edge while
  // the user is following the end, otherwise their saved offset clamped to the
  // current overflow. Callers re-run this from a ResizeObserver so the measurement
  // is taken after layout settles, not from a too-early requestAnimationFrame.
  function homeActivityScrollTarget({ scrollWidth, clientWidth, followEnd, savedLeft } = {}) {
    const max = maxScrollLeft(scrollWidth, clientWidth);
    if (followEnd || savedLeft == null) return max;
    const saved = Number(savedLeft);
    if (!Number.isFinite(saved)) return max;
    return Math.max(0, Math.min(max, saved));
  }

  // Turn an observed scroll position into the state we persist. Returns null when
  // the heatmap has not overflowed yet (panel hidden or layout not settled), so a
  // bogus 0 measured too early can never overwrite a real saved/follow-end value.
  function homeActivityScrollRecord({ scrollLeft, scrollWidth, clientWidth, endThreshold = 2 } = {}) {
    const max = maxScrollLeft(scrollWidth, clientWidth);
    if (max <= 0) return null;
    const left = Math.max(0, Math.min(max, Number(scrollLeft || 0)));
    return { scrollLeft: left, followEnd: left >= max - endThreshold };
  }

  return {
    homeLimitAccounts,
    homeModelRows,
    homeTrendSummary,
    pickHomeHistory,
    historyPreviewKey,
    shouldFetchHomeHistory,
    homeActivityHeatmapLayout,
    homeActivityWheelRoute,
    homeActivityScrollTarget,
    homeActivityScrollRecord,
    remainingPercent,
    usedPercent
  };
});
