'use strict';

// MiniMax (a.k.a. MiniMax / Hailuo AI) Token Plan quota lookup.
//
// Mirrors farion1231/cc-switch `services::coding_plan::query_minimax` and
// `parse_minimax_tiers`. URL + field mapping captured locally in
// docs/cc-switch-reference/coding_plan.rs so future ports (Kimi / GLM /
// ZenMux / Volcengine) can follow the same shape.

const { normalizeLimitProvider } = require('./limits');

const MINIMAX_KEY_NAMES = ['MINIMAX_TOKEN_PLAN_KEY', 'MINIMAX_API_KEY'];

const MINIMAX_REMAINS_URL_CN = 'https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains';
const MINIMAX_REMAINS_URL_EN = 'https://api.minimax.io/v1/api/openplatform/coding_plan/remains';

const MINIMAX_WINDOW_MINUTES_5H = 5 * 60;
const MINIMAX_WINDOW_MINUTES_WEEKLY = 7 * 24 * 60;

function cleanSecret(value) {
  let raw = value;
  if (typeof raw !== 'string') return '';
  raw = raw.trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }
  return raw;
}

function minimaxToken(env = process.env, explicitKey = '') {
  const explicit = cleanSecret(explicitKey);
  if (explicit) return explicit;
  for (const name of MINIMAX_KEY_NAMES) {
    const raw = cleanSecret(env[name]);
    if (raw) return raw;
  }
  return '';
}

// Pull the `general` bucket out of `model_remains`. cc-switch treats
// model_name === 'general' as the coding-plan row; video / voice / other
// models live in the same array and must be ignored.
function selectMinimaxGeneralBucket(body) {
  const modelRemains = body && typeof body === 'object' && body.model_remains;
  if (!Array.isArray(modelRemains)) return null;
  return modelRemains.find((row) => row && row.model_name === 'general') || null;
}

function toMillisNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function millisToIso8601(value) {
  const ms = toMillisNumber(value);
  if (ms === null) return null;
  // Treat <1e12 as seconds (matches cc-switch's `millis_to_iso8601`).
  const normalized = ms < 1_000_000_000_000 ? ms * 1000 : ms;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// 5h window: `current_interval_remaining_percent` is "remaining" (0-100).
// Only emit the window when `current_interval_status === 1` (active).
function buildMinimaxSessionWindow(item) {
  if (!item || toMillisNumber(item.current_interval_status) !== 1) return null;
  const remainPct = toMillisNumber(item.current_interval_remaining_percent);
  if (remainPct === null) return null;
  const used = Math.max(0, Math.min(100, 100 - remainPct));
  return {
    kind: 'session',
    label: '5h',
    usedPercent: used,
    remainingPercent: Math.max(0, Math.min(100, remainPct)),
    resetsAt: millisToIso8601(item.end_time),
    windowMinutes: MINIMAX_WINDOW_MINUTES_5H,
    showMeter: true
  };
}

// Weekly window: only show when `current_weekly_status === 1`. status 2/3
// means the plan has no weekly bucket and the server returns a constant
// 100% — drop it instead of misleading the user with an empty meter.
function buildMinimaxWeeklyWindow(item) {
  if (!item || toMillisNumber(item.current_weekly_status) !== 1) return null;
  const remainPct = toMillisNumber(item.current_weekly_remaining_percent);
  if (remainPct === null) return null;
  const used = Math.max(0, Math.min(100, 100 - remainPct));
  return {
    kind: 'weekly',
    label: 'Weekly',
    usedPercent: used,
    remainingPercent: Math.max(0, Math.min(100, remainPct)),
    resetsAt: millisToIso8601(item.weekly_end_time),
    windowMinutes: MINIMAX_WINDOW_MINUTES_WEEKLY,
    showMeter: true
  };
}

// Body must already be the parsed JSON. Returns the windows array, never
// throws. Returns [] when the response lacks the expected shape so the
// collector can still surface the provider row with status 'unavailable'.
function parseMinimaxTiers(body) {
  const item = selectMinimaxGeneralBucket(body);
  if (!item) return [];
  const windows = [];
  const session = buildMinimaxSessionWindow(item);
  if (session) windows.push(session);
  const weekly = buildMinimaxWeeklyWindow(item);
  if (weekly) windows.push(weekly);
  return windows;
}

function minimaxBaseUrl(options = {}) {
  // Allow callers to force the EN endpoint (api.minimax.io) — keeps the door
  // open for a future MINIMAX_REGION setting without touching this module.
  if (options.minimaxApiHost === 'en' || options.minimaxApiHost === 'minimax.io') {
    return MINIMAX_REMAINS_URL_EN;
  }
  return MINIMAX_REMAINS_URL_CN;
}

async function fetchMinimaxLimits(options = {}, deps = {}) {
  const env = deps.env || process.env;
  const now = (deps.now || Date.now)();
  const updatedAt = new Date(now).toISOString();
  const key = minimaxToken(env, options.minimaxApiKey);
  if (!key) {
    return normalizeLimitProvider({
      provider: 'minimax',
      source: 'api',
      status: 'notConfigured',
      updatedAt,
      windows: []
    });
  }
  try {
    const url = minimaxBaseUrl(options);
    const fetchJson = deps.fetchJson || (async (u, headers) => {
      const response = await (deps.fetch || fetch)(u, { headers });
      if (!response.ok) {
        const status = response.status === 401 ? 'unauthorized' : response.status === 429 ? 'sourceRateLimited' : 'unavailable';
        const error = new Error(`${u} returned ${response.status}`);
        error.status = status;
        throw error;
      }
      return response.json();
    });
    const data = await fetchJson(url, {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }, deps);
    if (!data || typeof data !== 'object') {
      throw Object.assign(new Error('unexpected remains response shape'), { status: 'unavailable' });
    }
    const baseResp = data.base_resp;
    if (baseResp && typeof baseResp === 'object') {
      const statusCode = toMillisNumber(baseResp.status_code);
      if (statusCode !== null && statusCode !== 0) {
        const statusMsg = typeof baseResp.status_msg === 'string' ? baseResp.status_msg : 'unknown error';
        throw Object.assign(new Error(`MiniMax error (code ${statusCode}): ${statusMsg}`), { status: 'unavailable' });
      }
    }
    const windows = parseMinimaxTiers(data);
    const accountKey = hashKey('minimax', key);
    return normalizeLimitProvider({
      provider: 'minimax',
      accountKey,
      accountLabel: 'Token Plan',
      source: 'api',
      status: windows.length ? 'ok' : 'unavailable',
      updatedAt,
      windows
    });
  } catch (error) {
    return normalizeLimitProvider({
      provider: 'minimax',
      source: 'api',
      status: mapMinimaxErrorStatus(error),
      updatedAt,
      windows: []
    });
  }
}

function mapMinimaxErrorStatus(error) {
  const status = error && error.status;
  if (['disabled', 'notConfigured', 'unauthorized', 'rateLimited', 'sourceRateLimited', 'unavailable', 'error'].includes(status)) return status;
  return 'unavailable';
}

// Inline hashKey to keep this module dependency-free for tests. Must match
// `hashKey` in hashKey.js (sha256 of `part\0...` joined, prefixed
// with 'sha256:').
const { hashKey } = require('./hashKey');

module.exports = {
  MINIMAX_KEY_NAMES,
  MINIMAX_REMAINS_URL_CN,
  MINIMAX_REMAINS_URL_EN,
  minimaxToken,
  minimaxBaseUrl,
  parseMinimaxTiers,
  fetchMinimaxLimits
};