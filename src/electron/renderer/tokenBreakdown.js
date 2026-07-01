'use strict';

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function computeTokenBreakdown({ totalTokens = 0, inputTokens, cacheReadTokens = 0, outputTokens = 0 } = {}) {
  const cacheRead = Math.max(0, Math.round(finiteNumber(cacheReadTokens)));
  const output = Math.max(0, Math.round(finiteNumber(outputTokens)));
  const total = Math.max(0, Math.round(finiteNumber(totalTokens)));
  const hasExplicitInput = inputTokens !== undefined && inputTokens !== null;
  const explicitInput = hasExplicitInput ? Math.max(0, Math.round(finiteNumber(inputTokens))) : null;

  const cacheMiss = explicitInput !== null
    ? explicitInput
    : Math.max(0, total - cacheRead - output);
  const inputTotal = cacheRead + cacheMiss;
  const hitPct = inputTotal > 0 ? Math.round((cacheRead / inputTotal) * 100) : 0;

  return {
    mode: explicitInput !== null ? 'explicit' : 'inferred',
    rows: [
      { key: 'cacheHit', labelKey: 'dashboard.tooltip.inputCacheHit', value: cacheRead, pct: hitPct },
      { key: 'cacheMiss', labelKey: 'dashboard.tooltip.inputCacheMiss', value: cacheMiss, pct: 100 - hitPct },
      { key: 'output', labelKey: 'dashboard.tooltip.output', value: output }
    ]
  };
}

function renderTokenAccordionHtml(breakdown, translate) {
  const t = typeof translate === 'function' ? translate : (key) => key;
  const rows = (breakdown?.rows || []).map((row) => {
    const pct = row.pct !== undefined
      ? ` <span class="accordion-pct">${row.pct}%</span>`
      : '';
    return `
        <div class="accordion-row">
          <div class="accordion-label">${t(row.labelKey)}${pct}</div>
          <div class="accordion-value">${Math.round(finiteNumber(row.value)).toLocaleString('en-US')}</div>
        </div>`;
  }).join('');

  return `<div class="accordion-content">${rows}
      </div>`;
}

(function exposeTokenBreakdown(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TokenMonitorTokenBreakdown = api;
})(typeof window !== 'undefined' ? window : null, function createTokenBreakdownApi() {
  return { computeTokenBreakdown, renderTokenAccordionHtml };
});