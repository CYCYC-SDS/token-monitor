'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { computeTokenBreakdown, renderTokenAccordionHtml } = require('../../src/electron/renderer/tokenBreakdown');

test('computeTokenBreakdown keeps the three-row layout for Grok-style input-only rows', () => {
  const breakdown = computeTokenBreakdown({
    totalTokens: 3_649_529,
    inputTokens: 3_649_529,
    cacheReadTokens: 0,
    outputTokens: 0
  });

  assert.equal(breakdown.mode, 'explicit');
  assert.deepEqual(breakdown.rows, [
    { key: 'cacheHit', labelKey: 'dashboard.tooltip.inputCacheHit', value: 0, pct: 0 },
    { key: 'cacheMiss', labelKey: 'dashboard.tooltip.inputCacheMiss', value: 3_649_529, pct: 100 },
    { key: 'output', labelKey: 'dashboard.tooltip.output', value: 0 }
  ]);
});

test('computeTokenBreakdown keeps Claude-style cache split when explicit input is available', () => {
  const breakdown = computeTokenBreakdown({
    totalTokens: 115,
    inputTokens: 10,
    cacheReadTokens: 100,
    outputTokens: 5
  });

  assert.equal(breakdown.mode, 'explicit');
  assert.deepEqual(breakdown.rows, [
    { key: 'cacheHit', labelKey: 'dashboard.tooltip.inputCacheHit', value: 100, pct: 91 },
    { key: 'cacheMiss', labelKey: 'dashboard.tooltip.inputCacheMiss', value: 10, pct: 9 },
    { key: 'output', labelKey: 'dashboard.tooltip.output', value: 5 }
  ]);
});

test('computeTokenBreakdown infers cache miss from total when input is unknown', () => {
  const breakdown = computeTokenBreakdown({
    totalTokens: 150,
    cacheReadTokens: 40,
    outputTokens: 20
  });

  assert.equal(breakdown.mode, 'inferred');
  assert.equal(breakdown.rows[0].value, 40);
  assert.equal(breakdown.rows[1].value, 90);
  assert.equal(breakdown.rows[2].value, 20);
});

test('renderTokenAccordionHtml renders cache rows with percentages', () => {
  const html = renderTokenAccordionHtml({
    rows: [
      { key: 'cacheHit', labelKey: 'dashboard.tooltip.inputCacheHit', value: 0, pct: 0 },
      { key: 'cacheMiss', labelKey: 'dashboard.tooltip.inputCacheMiss', value: 298_223, pct: 100 },
      { key: 'output', labelKey: 'dashboard.tooltip.output', value: 0 }
    ]
  }, (key) => ({
    'dashboard.tooltip.inputCacheHit': '输入 (缓存命中)',
    'dashboard.tooltip.inputCacheMiss': '输入 (缓存未命中)',
    'dashboard.tooltip.output': '输出'
  })[key] || key);

  assert.match(html, /输入 \(缓存命中\)/);
  assert.match(html, /输入 \(缓存未命中\)/);
  assert.match(html, /298,223/);
  assert.match(html, /accordion-pct/);
});