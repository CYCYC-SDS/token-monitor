'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.join(__dirname, '..', '..');
const rendererDir = path.join(rootDir, 'src', 'electron', 'renderer');

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readRendererFile(name) {
  return readFile(path.join(rendererDir, name));
}

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} function should exist`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.notEqual(end, -1, `${nextName} function should follow ${name}`);
  return source.slice(start, end);
}

test('renderer includes a dedicated service status panel and Status view option', () => {
  const html = readRendererFile('index.html');
  const app = readRendererFile('app.js');

  assert.match(html, /<section id="serviceStatusPanel" class="service-status-panel hidden"><\/section>/);
  assert.match(html, /<script src="serviceStatusPresentation\.js"><\/script>/);
  assert.match(app, /\{ id: 'status', labelKey: 'views\.status' \}/);
  assert.match(app, /viewBreakdownValues = new Set\(\[\.\.\.baseBreakdownOrder, 'status', 'limits', 'trends'\]\)/);
  // Placeholders cover every provider so the rows render before the first fetch.
  assert.match(app, /label: 'Cursor'/);
  assert.match(app, /label: 'DeepSeek'/);
});

test('renderer surfaces affected component names through the presentation helper', () => {
  const app = readRendererFile('app.js');
  assert.match(app, /serviceStatusPresentationApi\.affectedComponentNames/);
});

test('the status description line leads with the active incident headline', () => {
  const app = readRendererFile('app.js');
  const renderBody = functionBody(app, 'renderServiceStatus', 'refreshServiceStatus');
  assert.match(renderBody, /serviceStatusPresentationApi\.statusHeadline/);
});

test('the meta line shows an affected-component count, not the verbose name list', () => {
  const app = readRendererFile('app.js');
  // The component names made the meta line overflow; the full list now lives only
  // in the row tooltip (meta.title), so the dedicated name-joining helper is gone.
  assert.doesNotMatch(app, /function serviceStatusComponentText/);
  const metaBody = functionBody(app, 'serviceStatusMeta', 'visibleServiceProviderIds');
  // A short count keeps the real scope visible (an incident title can understate
  // it) without reintroducing the overflow that the joined name list caused.
  assert.match(metaBody, /serviceStatus\.components/);
  assert.doesNotMatch(metaBody, /listSeparator/);
});

test('renderer fetches service status only through preload IPC', () => {
  const app = readRendererFile('app.js');
  const renderBody = functionBody(app, 'renderServiceStatus', 'refreshServiceStatus');
  const refreshBody = functionBody(app, 'refreshServiceStatus', 'formatAgo');

  assert.match(renderBody, /service-status-row/);
  assert.match(refreshBody, /window\.tokenMonitor\.getServiceStatus/);
  assert.doesNotMatch(app, /fetch\(['"]https:\/\/status\./);
});

test('preload and main expose service status IPC with status page allowlist', () => {
  const preload = readFile(path.join(rootDir, 'src', 'electron', 'preload.js'));
  const main = readFile(path.join(rootDir, 'src', 'electron', 'main.js'));

  assert.match(preload, /getServiceStatus: \(options\) => ipcRenderer\.invoke\('serviceStatus:get', options\)/);
  assert.match(main, /ipcMain\.handle\('serviceStatus:get'/);
  // The open-external allowlist is derived from the provider list rather than
  // duplicating each status hostname, so new providers stay openable for free.
  assert.match(main, /SERVICE_STATUS_PROVIDERS/);
  assert.match(main, /STATUS_PAGE_HOSTS/);
  // Hidden providers must not be fetched: the handler forwards providerIds and
  // the two preference keys are persisted.
  assert.match(main, /providerIds: Array\.isArray\(options\?\.providerIds\)/);
  assert.match(main, /serviceProviderDisplayOrder/);
  assert.match(main, /hiddenServiceProviders/);
  assert.match(main, /normalizeServiceStatusRefreshMs/);
});

test('statusProvider drag kind is wired into the preference helpers', () => {
  const app = readRendererFile('app.js');
  const html = readRendererFile('index.html');
  assert.match(app, /kind === 'statusProvider'/);
  // closest() used by the drag start must recognise the nested provider rows.
  assert.match(app, /\[data-status-provider\]/);
  assert.match(app, /onServiceProviderVisibilityToggle/);
  // The prefs module must be loaded before the renderer uses its API.
  assert.match(html, /<script src="serviceStatusProviderPreferences\.js"><\/script>/);
});

test('the 狀態 view row is expandable and renders a nested provider sub-list', () => {
  const app = readRendererFile('app.js');
  const css = readRendererFile('styles.css');
  assert.match(app, /serviceProvidersExpanded/);
  assert.match(app, /id = 'serviceProviderList'|id: 'serviceProviderList'|'serviceProviderList'/);
  assert.match(app, /status-provider-row/);
  assert.match(app, /function renderServiceProviderList/);
  // The chevron adds a third trailing control, so the status row needs an
  // extra grid column or its drag handle wraps to a new line.
  assert.match(app, /has-subgroup/);
  assert.match(css, /\.view-preference-row\.has-subgroup/);
  // The "show all" header uses the same CSS outline eye as the other lists,
  // not the filled visibilityIcon SVG (which renders as a solid blob here).
  assert.match(app, /tool-header-eye/);
});

test('view drag query does not select the nested status-provider rows', () => {
  // The sub-list rows use a distinct class/attribute, so the view selector skips them.
  const app = readRendererFile('app.js');
  assert.doesNotMatch(app, /\.view-preference-row\[data-status-provider\]/);
});

test('the Status panel passes the visible provider ids to the fetch and orders by prefs', () => {
  const app = readRendererFile('app.js');
  const refreshBody = functionBody(app, 'refreshServiceStatus', 'formatAgo');
  assert.match(refreshBody, /providerIds:/);
  assert.match(app, /function visibleServiceProviderIds/);
  assert.match(app, /serviceStatus\.allHidden/);
});

test('the status view uses a dedicated ticker and relative timestamps', () => {
  const app = readRendererFile('app.js');
  assert.match(app, /function ensureServiceStatusTicker/);
  assert.match(app, /function onServiceStatusTick/);
  assert.match(app, /service-status-checked/);
  assert.match(app, /function formatAgo/);
  // The old piggyback mechanism is gone.
  assert.doesNotMatch(app, /SERVICE_STATUS_MIN_REFRESH_MS/);
  assert.doesNotMatch(app, /function maybeRefreshServiceStatus/);
});

test('the provider sub-section includes a re-check interval select', () => {
  const app = readRendererFile('app.js');
  assert.match(app, /serviceStatusRefreshSelect/);
  assert.match(app, /serviceStatusRefreshMs: Number/);
});

test('status rows can show provider icons gated by showToolIcons', () => {
  const app = readRendererFile('app.js');
  assert.match(app, /function serviceStatusIconId/);
  assert.match(app, /showToolIcons/);
});
