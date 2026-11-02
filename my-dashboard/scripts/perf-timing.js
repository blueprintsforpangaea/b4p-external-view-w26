#!/usr/bin/env node
// Headless-Chrome speed check against a LOCAL build + LOCAL backend (no npm deps; Node >= 22).
//
//   APP_URL=http://127.0.0.1:3765/ API_ORIGIN=http://127.0.0.1:8765 node scripts/perf-timing.js
//
// Runs four loads in a throwaway Chrome profile and reports, for each:
//   first row  ms from navigation start until the first catalog row is in the DOM
//   requests   by type, plus external hosts; budget: 0 image and 0 font requests
//   CLS        cumulative layout shift up to 2 s after the first row
// Loads: cold (no HTTP cache, empty localStorage), warm (HTTP cache + localStorage),
// warm with the API delayed 3 s (proves the cached inventory renders first), and
// cold with the API delayed 3 s (what a Render cold start looks like on a first visit).

const fs = require('fs');
const { CDP, launch, sleep } = require('./cdp');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:3765/#/c/needles-and-syringes'; // a category page has rows
const API_ORIGIN = (process.env.API_ORIGIN || 'http://127.0.0.1:8765').replace(/\/$/, '');
const ROW = process.env.ROW_SELECTOR || 'tr.item-row, [data-row]';
const API_DELAY = 3000;
const BUDGET = { warmFirstRowMs: 1000, coldFirstRowMs: 2500, images: 0, fonts: 0, localFonts: 0, cls: 0.1 };

for (const u of [APP_URL, API_ORIGIN]) {
  const host = new URL(u).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
    console.error(`Refusing to run against non-local host ${host}.`);
    process.exit(2);
  }
}


const INSTRUMENT = `
  window.__perf = { cls: 0, shifts: [], firstRow: null };
  try { window.__storedAtStart = Object.keys(localStorage).filter((k) => k.startsWith('b4p.')); } catch (e) { window.__storedAtStart = []; }
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (!e.hadRecentInput) {
        window.__perf.cls += e.value;
        window.__perf.shifts.push(Math.round(e.startTime));
        window.__perf.sources = (window.__perf.sources || []).concat((e.sources || []).map((src) => {
          const n = src.node;
          const desc = n && n.nodeType === 1 ? n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\\s+/).join('.') : '') : String(n && n.nodeName);
          return desc + ' ' + JSON.stringify({ from: [src.previousRect.x, src.previousRect.y, src.previousRect.width, src.previousRect.height].map(Math.round), to: [src.currentRect.x, src.currentRect.y, src.currentRect.width, src.currentRect.height].map(Math.round) });
        }));
      }
    }
  }).observe({ type: 'layout-shift', buffered: true });
  const seen = () => {
    if (window.__perf.firstRow == null && document.querySelector(${JSON.stringify(ROW)})) {
      window.__perf.firstRow = performance.now();
      return true;
    }
    return false;
  };
  new MutationObserver((_, obs) => { if (seen()) obs.disconnect(); })
    .observe(document, { childList: true, subtree: true });
`;

async function load(cdp, { label, cacheDisabled, clearStorage, delayApi }) {
  const requests = [];
  const listener = (msg) => {
    // Only real network traffic: skip data:, blob: and browser-internal schemes.
    if (msg.method === 'Network.requestWillBeSent' && /^https?:/.test(msg.params.request.url)) {
      requests.push({ url: msg.params.request.url, type: msg.params.type || 'Other' });
    }
    if (msg.method === 'Fetch.requestPaused') {
      const { requestId } = msg.params;
      setTimeout(() => cdp.send('Fetch.continueRequest', { requestId }).catch(() => {}), API_DELAY);
    }
  };
  cdp.handlers = [listener];

  // Leave the app first: a page being unloaded can write localStorage again after a clear.
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  const origin = new URL(APP_URL).origin;
  if (clearStorage) {
    await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
    await cdp.send('Network.clearBrowserCache');
  }
  await cdp.send('Network.setCacheDisabled', { cacheDisabled });
  if (delayApi) await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${API_ORIGIN}/*` }] });
  else await cdp.send('Fetch.disable');

  requests.length = 0;
  await cdp.send('Page.navigate', { url: APP_URL });
  let perf = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    await sleep(50);
    try {
      const r = await cdp.send('Runtime.evaluate', { expression: 'window.__perf && window.__perf.firstRow', returnByValue: true });
      if (r.result.value != null) break;
    } catch { /* navigating */ }
  }
  await sleep(2000); // let late shifts and refreshes land
  const r = await cdp.send('Runtime.evaluate', {
    expression: 'JSON.stringify({ ...window.__perf, storedAtStart: window.__storedAtStart, rows: document.querySelectorAll(' + JSON.stringify(ROW) + ').length })',
    returnByValue: true,
  });
  perf = JSON.parse(r.result.value || '{}');
  if (delayApi) await cdp.send('Fetch.disable');

  const byType = {};
  for (const q of requests) byType[q.type] = (byType[q.type] || 0) + 1;
  const local = new Set([new URL(APP_URL).host, new URL(API_ORIGIN).host]);
  const external = [...new Set(requests.map((q) => { try { return new URL(q.url).host; } catch { return ''; } }))]
    .filter((h) => h && !local.has(h));
  const isFont = (q) => q.type === 'Font' || /fonts\.(googleapis|gstatic)\.com/.test(q.url);
  const appHost = new URL(APP_URL).host;
  const fonts = requests.filter((q) => isFont(q) && new URL(q.url).host !== appHost).length; // external
  const localFonts = requests.filter((q) => isFont(q) && new URL(q.url).host === appHost).length;
  const images = requests.filter((q) => q.type === 'Image').length;
  return {
    label,
    firstRowMs: perf.firstRow == null ? null : Math.round(perf.firstRow),
    rows: perf.rows,
    storedAtStart: perf.storedAtStart,
    shiftSources: perf.sources || [],
    cls: Number((perf.cls || 0).toFixed(4)),
    shiftsAtMs: perf.shifts,
    requests: requests.length,
    byType,
    images,
    fonts,
    localFonts,
    imageUrls: requests.filter((q) => q.type === 'Image').map((q) => q.url),
    external,
  };
}

(async () => {
  const { chrome, profile, wsUrl } = await launch();
  const cdp = new CDP(wsUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT });
  if (process.env.CPU) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU) }); // e.g. 4 = mid phone
  if (process.env.SLOW_NET) { // roughly "Fast 3G": 150 ms RTT, 1.6 Mbps down, 750 kbps up
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 94000 });
  }
  if (process.env.WIDTH) { // e.g. WIDTH=360 for a phone; height scales 2:1
    const width = Number(process.env.WIDTH);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width * 2, deviceScaleFactor: 2, mobile: width < 900 });
  }

  const results = [];
  try {
    results.push(await load(cdp, { label: 'cold', cacheDisabled: true, clearStorage: true }));
    results.push(await load(cdp, { label: 'warm', cacheDisabled: false, clearStorage: false }));
    results.push(await load(cdp, { label: 'warm, API +3s', cacheDisabled: false, clearStorage: false, delayApi: true }));
    results.push(await load(cdp, { label: 'cold, API +3s', cacheDisabled: true, clearStorage: true, delayApi: true }));
    // Instant search: time from typing to result rows on screen (includes the debounce).
    for (const q of (process.env.SEARCH || 'gauze,syringe 10ml,zzqx').split(',')) {
      await cdp.send('Runtime.evaluate', { expression: `(() => { const s = document.getElementById('supply-search'); s.focus(); s.select(); })()` });
      await cdp.send('Runtime.evaluate', {
        expression: `window.__searchT0 = performance.now(); window.__searchDone = null;
          new MutationObserver((_, o) => { const h = document.querySelector('main h1');
            if (h && h.textContent.includes(${JSON.stringify(q)})) { window.__searchDone = performance.now(); o.disconnect(); } })
            .observe(document.querySelector('main'), { childList: true, subtree: true, characterData: true }); 1`,
      });
      await cdp.send('Input.insertText', { text: q });
      let done = null;
      for (let i = 0; i < 100 && done == null; i += 1) {
        await sleep(20);
        done = (await cdp.send('Runtime.evaluate', { expression: 'window.__searchDone && Math.round(window.__searchDone - window.__searchT0)', returnByValue: true })).result.value;
      }
      const rows = (await cdp.send('Runtime.evaluate', { expression: 'document.querySelectorAll("tr.item-row").length', returnByValue: true })).result.value;
      results.push({ label: `search "${q}"`, searchMs: done, rows });
    }
  } finally {
    const exited = new Promise((r) => chrome.once('exit', r));
    chrome.kill();
    await Promise.race([exited, sleep(5000)]);
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch { /* temp dir; the OS cleans it up */ }
  }

  const fails = [];
  const searches = results.filter((r) => r.searchMs !== undefined);
  for (const r of searches) {
    if (r.searchMs == null || r.searchMs > 300) fails.push(`${r.label}: ${r.searchMs ?? 'no result'} ms > 300 ms`);
  }
  results.splice(0, results.length, ...results.filter((r) => r.searchMs === undefined));
  for (const r of results) {
    const limit = r.label.startsWith('warm') ? BUDGET.warmFirstRowMs : r.label === 'cold' ? BUDGET.coldFirstRowMs : null;
    if (r.firstRowMs == null) fails.push(`${r.label}: no row matched ${ROW}`);
    else if (limit != null && r.firstRowMs > limit) fails.push(`${r.label}: first row ${r.firstRowMs} ms > ${limit} ms`);
    if (r.images > BUDGET.images) fails.push(`${r.label}: ${r.images} image requests (${r.imageUrls.join(', ')})`);
    if (r.fonts > BUDGET.fonts) fails.push(`${r.label}: ${r.fonts} external font requests`);
    if (r.localFonts > BUDGET.localFonts) fails.push(`${r.label}: ${r.localFonts} self-hosted font requests (max ${BUDGET.localFonts})`);
    if (r.cls > BUDGET.cls) fails.push(`${r.label}: CLS ${r.cls}`);
    if (r.external.length) fails.push(`${r.label}: external hosts ${r.external.join(', ')}`);
  }

  console.log('load            first row   rows   CLS      req  images fonts  types');
  for (const r of results) {
    if (process.env.VERBOSE) console.log(`  ${r.label}: localStorage at start ${JSON.stringify(r.storedAtStart)}, shifts at ${JSON.stringify(r.shiftsAtMs)} ms ${JSON.stringify(r.shiftSources)}`);
    console.log(`${r.label.padEnd(15)} ${String(r.firstRowMs ?? '-').padStart(6)} ms ${String(r.rows ?? '-').padStart(6)}  ${r.cls.toFixed(3).padStart(6)}  ${String(r.requests).padStart(4)}  ${String(r.images).padStart(5)} ${String(r.fonts).padStart(5)}  ${JSON.stringify(r.byType)}`);
  }
  for (const r of searches) console.log(`${r.label.padEnd(24)} ${String(r.searchMs ?? '-').padStart(5)} ms  ${r.rows} rows`);
  fails.forEach((f) => console.log(`FAIL  ${f}`));
  if (!fails.length) console.log('PASS  all speed budgets');
  if (process.env.PERF_JSON) fs.writeFileSync(process.env.PERF_JSON, JSON.stringify([...results, ...searches], null, 2));
  process.exit(fails.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
