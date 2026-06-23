'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  minimaxToken,
  parseMinimaxTiers,
  fetchMinimaxLimits,
  MINIMAX_REMAINS_URL_CN,
  MINIMAX_REMAINS_URL_EN,
  minimaxBaseUrl
} = require('../../src/shared/minimaxLimits');
const { parseLimitProviders } = require('../../src/shared/limitCollector');

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

test('minimaxToken reads MINIMAX_TOKEN_PLAN_KEY then MINIMAX_API_KEY, stripping quotes', () => {
  assert.equal(minimaxToken({ MINIMAX_TOKEN_PLAN_KEY: '  "eyJabc"  ' }), 'eyJabc');
  assert.equal(minimaxToken({ MINIMAX_API_KEY: 'eyJdef' }), 'eyJdef');
  assert.equal(minimaxToken({}), '');
  assert.equal(minimaxToken({ MINIMAX_TOKEN_PLAN_KEY: '' }, '  "sk-direct"  '), 'sk-direct');
});

test('parseLimitProviders now includes minimax in the default provider set', () => {
  assert.deepEqual(
    parseLimitProviders(),
    ['claude', 'codex', 'cursor', 'antigravity', 'opencode', 'deepseek', 'minimax', 'grok']
  );
});

test('minimaxBaseUrl defaults to the CN endpoint and honors the EN flag', () => {
  assert.equal(minimaxBaseUrl(), MINIMAX_REMAINS_URL_CN);
  assert.equal(minimaxBaseUrl({ minimaxApiHost: 'en' }), MINIMAX_REMAINS_URL_EN);
  assert.equal(minimaxBaseUrl({ minimaxApiHost: 'minimax.io' }), MINIMAX_REMAINS_URL_EN);
});

test('parseMinimaxTiers picks the general bucket and emits 5h + weekly windows', () => {
  const body = {
    model_remains: [
      {
        model_name: 'general',
        current_interval_remaining_percent: 98,
        current_interval_status: 1,
        current_weekly_remaining_percent: 95,
        current_weekly_status: 1,
        end_time: 1_716_350_400_000,
        weekly_end_time: 1_716_780_000_000
      }
    ]
  };
  const windows = parseMinimaxTiers(body);
  assert.equal(windows.length, 2);
  assert.equal(windows[0].kind, 'session');
  assert.equal(windows[0].usedPercent, 2);
  assert.equal(windows[0].remainingPercent, 98);
  assert.equal(windows[0].windowMinutes, 5 * 60);
  assert.match(windows[0].resetsAt, /^20\d\d-/);
  assert.equal(windows[1].kind, 'weekly');
  assert.equal(windows[1].usedPercent, 5);
  assert.equal(windows[1].remainingPercent, 95);
  assert.equal(windows[1].windowMinutes, 7 * 24 * 60);
  assert.match(windows[1].resetsAt, /^20\d\d-/);
});

test('parseMinimaxTiers skips video / voice buckets and locates general anywhere in the array', () => {
  const body = {
    model_remains: [
      { model_name: 'video', current_interval_remaining_percent: 20, current_interval_status: 1, current_weekly_status: 0 },
      {
        model_name: 'general',
        current_interval_remaining_percent: 80,
        current_interval_status: 1,
        current_weekly_remaining_percent: 70,
        current_weekly_status: 1
      }
    ]
  };
  const windows = parseMinimaxTiers(body);
  assert.equal(windows.length, 2);
  assert.equal(windows[0].usedPercent, 20); // 100 - 80, NOT the video 80%
});

test('parseMinimaxTiers drops the weekly window when status is 2 or 3', () => {
  const body = {
    model_remains: [
      {
        model_name: 'general',
        current_interval_remaining_percent: 99,
        current_interval_status: 1,
        current_weekly_remaining_percent: 100,
        current_weekly_status: 3
      }
    ]
  };
  const windows = parseMinimaxTiers(body);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].kind, 'session');
});

test('parseMinimaxTiers returns [] when model_remains is missing or has no general entry', () => {
  assert.deepEqual(parseMinimaxTiers({ model_remains: [] }), []);
  assert.deepEqual(parseMinimaxTiers({ model_remains: [{ model_name: 'video' }] }), []);
  assert.deepEqual(parseMinimaxTiers({}), []);
  assert.deepEqual(parseMinimaxTiers(null), []);
});

test('parseMinimaxTiers clamps percentages to [0, 100] and handles negative remainders', () => {
  const body = {
    model_remains: [
      {
        model_name: 'general',
        current_interval_remaining_percent: -5,
        current_interval_status: 1,
        current_weekly_remaining_percent: 150,
        current_weekly_status: 1
      }
    ]
  };
  const windows = parseMinimaxTiers(body);
  assert.equal(windows.length, 2);
  assert.equal(windows[0].usedPercent, 100); // 100 - (-5) clamped
  assert.equal(windows[0].remainingPercent, 0);
  assert.equal(windows[1].usedPercent, 0); // 100 - 150 clamped
  assert.equal(windows[1].remainingPercent, 100);
});

test('parseMinimaxTiers treats second-precision timestamps as seconds, not milliseconds', () => {
  const body = {
    model_remains: [
      {
        model_name: 'general',
        current_interval_remaining_percent: 50,
        current_interval_status: 1,
        end_time: 1_716_350_400 // 10 digits → seconds, < 1e12
      }
    ]
  };
  const windows = parseMinimaxTiers(body);
  assert.match(windows[0].resetsAt, /^20\d\d-/);
});

test('fetchMinimaxLimits returns notConfigured when no key is provided', async () => {
  const r = await fetchMinimaxLimits({}, { env: {} });
  assert.equal(r.provider, 'minimax');
  assert.equal(r.status, 'notConfigured');
  assert.equal(r.source, 'api');
  assert.deepEqual(r.windows, []);
});

test('fetchMinimaxLimits returns ok with both windows and never leaks the key', async () => {
  const env = { MINIMAX_TOKEN_PLAN_KEY: 'eyJhbGciOiJIUzI1NiJ9' };
  const body = {
    model_remains: [
      {
        model_name: 'general',
        current_interval_remaining_percent: 92,
        current_interval_status: 1,
        current_weekly_remaining_percent: 88,
        current_weekly_status: 1,
        end_time: 1_716_350_400_000,
        weekly_end_time: 1_716_780_000_000
      }
    ]
  };
  let capturedAuth = '';
  const r = await fetchMinimaxLimits({}, {
    env,
    now: () => 1_716_350_000_000,
    fetch: async (url, init) => {
      capturedAuth = init.headers.Authorization;
      return okResponse(body);
    }
  });

  assert.equal(r.provider, 'minimax');
  assert.equal(r.status, 'ok');
  assert.equal(r.source, 'api');
  assert.equal(r.accountLabel, 'Token Plan');
  assert.match(r.accountKey, /^sha256:/);
  assert.equal(r.windows.length, 2);
  assert.equal(r.windows[0].kind, 'session');
  assert.equal(r.windows[0].usedPercent, 8);
  assert.equal(r.windows[1].kind, 'weekly');
  assert.equal(r.windows[1].usedPercent, 12);
  assert.equal(capturedAuth, 'Bearer eyJhbGciOiJIUzI1NiJ9');
  assert.ok(!JSON.stringify(r).includes('eyJhbGciOiJIUzI1NiJ9'));
});

test('fetchMinimaxLimits prefers the widget settings key over env fallback', async () => {
  let capturedAuth = '';
  const r = await fetchMinimaxLimits(
    { minimaxApiKey: " 'eyJ-settings' " },
    {
      env: { MINIMAX_TOKEN_PLAN_KEY: 'eyJ-env' },
      now: () => 1_716_350_000_000,
      fetch: async (_url, init) => {
        capturedAuth = init.headers.Authorization;
        return okResponse({ model_remains: [] });
      }
    }
  );
  assert.equal(capturedAuth, 'Bearer eyJ-settings');
  assert.equal(r.status, 'unavailable'); // empty model_remains → no windows → unavailable
  assert.ok(!JSON.stringify(r).includes('eyJ-settings'));
});

test('fetchMinimaxLimits maps HTTP 401 to unauthorized', async () => {
  const r = await fetchMinimaxLimits({}, {
    env: { MINIMAX_TOKEN_PLAN_KEY: 'eyJ' },
    now: () => 1_716_350_000_000,
    fetch: async () => ({ ok: false, status: 401, json: async () => ({}) })
  });
  assert.equal(r.status, 'unauthorized');
  assert.deepEqual(r.windows, []);
});

test('fetchMinimaxLimits maps base_resp.status_code != 0 to unavailable', async () => {
  const r = await fetchMinimaxLimits({}, {
    env: { MINIMAX_TOKEN_PLAN_KEY: 'eyJ' },
    now: () => 1_716_350_000_000,
    fetch: async () => okResponse({ base_resp: { status_code: 1001, status_msg: 'quota api disabled' } })
  });
  assert.equal(r.status, 'unavailable');
});

test('fetchMinimaxLimits maps an unexpected body shape to unavailable', async () => {
  const r = await fetchMinimaxLimits({}, {
    env: { MINIMAX_TOKEN_PLAN_KEY: 'eyJ' },
    now: () => 1_716_350_000_000,
    fetch: async () => okResponse({ nope: true })
  });
  assert.equal(r.status, 'unavailable');
});

test('fetchMinimaxLimits uses the EN endpoint when minimaxApiHost is set', async () => {
  let capturedUrl = '';
  await fetchMinimaxLimits(
    { minimaxApiKey: 'eyJ', minimaxApiHost: 'en' },
    {
      env: {},
      now: () => 1_716_350_000_000,
      fetch: async (url) => {
        capturedUrl = url;
        return okResponse({ model_remains: [] });
      }
    }
  );
  assert.equal(capturedUrl, MINIMAX_REMAINS_URL_EN);
});