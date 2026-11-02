#!/usr/bin/env node
// Scroll smoothness and input latency on a LOCAL build + LOCAL backend (headless Chrome, no deps).
//
//   APP_URL=http://127.0.0.1:3765/ node scripts/perf-scroll.js        # 1x and 4x CPU, 1440x900
//
// Scroll: a real wheel-style gesture (Input.synthesizeScrollGesture, so the compositor and
// main thread both work as they would for a user) down each page, while a rAF loop records
// frame-to-frame times and a PerformanceObserver records long tasks (> 50 ms).
// Pages: the All landing, the biggest category, and a broad search ("a").
// Input: Event Timing durations (input -> next paint, the INP measure) for clicking a row's
// Add button and then its "+" five times.

const fs = require('fs');
// Uncap frame pacing (headless and occluded windows run at 30 Hz), so each frame time is the
// real cost of that frame: > 16.7 ms would drop a frame on a 60 Hz laptop. UNCAPPED=0 to disable.
if (process.env.UNCAPPED === undefined) process.env.UNCAPPED = '1';
const { CDP, launch, shutdown, sleep, assertLocal } = require('./cdp');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:3765/').replace(/#.*$/, '');
const API_ORIGIN = (process.env.API_ORIGIN || 'http://127.0.0.1:8765').replace(/\/$/, '');
const W = Number(process.env.WIDTH || 1440);
const H = Number(process.env.HEIGHT || 900);
const CPUS = (process.env.CPUS || '1,4').split(',').map(Number);
const SPEED = Number(process.env.SCROLL_SPEED || 2400); // px/s, a brisk trackpad flick
const MAX_SCROLL = Number(process.env.MAX_SCROLL || 15000);
const ROW = 'tr.item-row';
// Pass/fail: what "smooth" means here. Report numbers either way.
const BUDGET = { jank33Pct: 2, longTasks: 0, inpMs: 200 };

assertLocal(APP_URL, API_ORIGIN);

const OBSERVE = `
  window.__scroll = { frames: [], longTasks: [], running: false };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__scroll.longTasks.push(Math.round(e.duration)); })
    .observe({ type: 'longtask', buffered: false });
  window.__events = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (['pointerdown', 'pointerup', 'click', 'keydown'].includes(e.name)) {
        window.__events.push({ name: e.name, duration: e.duration, id: e.interactionId });
      }
    }
  }).observe({ type: 'event', durationThreshold: 16, buffered: true });
`;

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception || {}).description);
  return r.result.value;
}

async function waitFor(cdp, expression, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await evaluate(cdp, expression)) return true; } catch { /* navigating */ }
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${expression}`);
}

async function open(cdp, hash) {
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  await cdp.send('Page.navigate', { url: APP_URL + hash });
  await waitFor(cdp, 'document.querySelector("main h1") && !document.querySelector(".skeleton, [aria-busy=true]")');
  await sleep(500); // let the background refresh land
}

async function search(cdp, q) {
  await evaluate(cdp, `(() => { const s = document.getElementById('supply-search'); s.focus(); s.select(); })()`);
  await cdp.send('Input.insertText', { text: q });
  await waitFor(cdp, `(document.querySelector('main h1') || {}).textContent?.includes(${JSON.stringify(q)})`);
  await sleep(400);
}

async function scrollTest(cdp, label) {
  const info = await evaluate(cdp, `({ height: document.documentElement.scrollHeight, rows: document.querySelectorAll('${ROW}').length,
    nodes: document.getElementsByTagName('*').length })`);
  const distance = Math.min(MAX_SCROLL, Math.max(0, info.height - H));
  await evaluate(cdp, `(() => {
    window.scrollTo(0, 0);
    const s = window.__scroll; s.frames = []; s.longTasks = []; s.running = true;
    let last = performance.now();
    s.slow = [];
    const tick = (t) => { const d = t - last; s.frames.push(d);
      if (d > 33.4) s.slow.push({ atMs: Math.round(t - s.t0), ms: Math.round(d), y: Math.round(window.scrollY), rows: document.querySelectorAll('${ROW}').length });
      last = t; if (s.running) requestAnimationFrame(tick); };
    s.t0 = performance.now();
    requestAnimationFrame(tick);
  })()`);
  await sleep(300);
  const t0 = Date.now();
  await cdp.send('Input.synthesizeScrollGesture', {
    x: Math.round(W / 2), y: Math.round(H / 2), yDistance: -distance, speed: SPEED,
    gestureSourceType: 'mouse', preventFling: true,
  });
  const ms = Date.now() - t0;
  await sleep(300);
  const r = await evaluate(cdp, `(() => { const s = window.__scroll; s.running = false;
    return { frames: s.frames.slice(2), longTasks: s.longTasks, y: Math.round(window.scrollY), slow: s.slow }; })()`);
  const f = r.frames;
  const pct = (limit) => (f.length ? (100 * f.filter((d) => d > limit).length) / f.length : 0);
  const sorted = [...f].sort((a, b) => a - b);
  return {
    label,
    rows: info.rows,
    domNodes: info.nodes,
    scrolledPx: r.y,
    ms,
    frames: f.length,
    fps: f.length ? Math.round((1000 * f.length) / f.reduce((a, b) => a + b, 0)) : 0,
    over16: Number(pct(16.7 + 1).toFixed(1)), // 1 ms tolerance for vsync jitter
    over33: Number(pct(33.4).toFixed(1)),
    p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] || 0),
    worst: Math.round(sorted[sorted.length - 1] || 0),
    longTasks: r.longTasks.length,
    longestTask: Math.max(0, ...r.longTasks),
    slowFrames: r.slow,
  };
}

async function clickCenter(cdp, selectorExpr) {
  const box = await evaluate(cdp, `(() => { const el = ${selectorExpr}; if (!el) return null;
    el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!box) throw new Error(`nothing to click: ${selectorExpr}`);
  await sleep(150);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }
  await sleep(250);
}

async function inpTest(cdp, label) {
  await evaluate(cdp, 'window.__events = []');
  // A row with plenty of stock, so "+" stays enabled for all five clicks.
  await evaluate(cdp, `(() => { const tr = [...document.querySelectorAll('${ROW}')].find((r) => {
      const n = Number((r.querySelector('.spec__stock [aria-hidden]') || {}).textContent?.replace(/,/g, ''));
      return n >= 10 && r.querySelector('.spec__qty button[aria-label^="Add"]'); });
    tr.setAttribute('data-qa-inp', ''); return true; })()`);
  await clickCenter(cdp, `document.querySelector('[data-qa-inp] .spec__qty button[aria-label^="Add"]')`);
  for (let i = 0; i < 5; i += 1) {
    await clickCenter(cdp, `[...document.querySelectorAll('[data-qa-inp] .stepper__btn')].pop()`);
  }
  await sleep(300);
  const ev = await evaluate(cdp, 'window.__events');
  // One number per interaction: the longest event in it.
  const byId = new Map();
  for (const e of ev) if (e.id) byId.set(e.id, Math.max(byId.get(e.id) || 0, e.duration));
  const d = [...byId.values()].sort((a, b) => a - b);
  return { label, interactions: d.length, inpMs: Math.round(d[d.length - 1] || 0), medianMs: Math.round(d[Math.floor(d.length / 2)] || 0) };
}

(async () => {
  const { chrome, profile, wsUrl } = await launch(Number(process.env.CDP_PORT || 9334), `${W},${H}`);
  const cdp = new CDP(wsUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVE });

  const results = [];
  try {
    await open(cdp, '#/'); // warm the inventory cache once
    const biggest = await evaluate(cdp, `(() => { const links = [...document.querySelectorAll('.tree a[href^="#/c/"]')];
      const n = (a) => Number((a.textContent.match(/(\\d[\\d,]*)\\s*$/) || [0, '0'])[1].replace(/,/g, ''));
      return links.sort((a, b) => n(b) - n(a))[0].getAttribute('href'); })()`);
    for (const cpu of CPUS) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
      await open(cdp, '#/');
      results.push({ cpu, ...(await scrollTest(cdp, 'All (landing)')) });
      await open(cdp, biggest);
      results.push({ cpu, ...(await scrollTest(cdp, `Biggest ${biggest}`)) });
      await search(cdp, 'a');
      results.push({ cpu, ...(await scrollTest(cdp, 'Search "a"')) });
      await open(cdp, biggest);
      await evaluate(cdp, 'localStorage.removeItem("b4p.cart.v1")');
      await open(cdp, biggest);
      results.push({ cpu, ...(await inpTest(cdp, `Add/+ on ${biggest}`)) });
    }
  } finally {
    await shutdown(chrome, profile);
  }

  const fails = [];
  console.log(`viewport ${W}x${H}, scroll ${SPEED} px/s (max ${MAX_SCROLL} px), frames ${process.env.UNCAPPED === '1' ? 'uncapped (fps = capacity)' : 'vsync-paced'}`);
  console.log('cpu page                              rows  nodes  px      fps  >17ms%  >33ms%  p95  worst  longtasks(max)');
  for (const r of results.filter((x) => x.fps !== undefined)) {
    console.log(`${String(r.cpu).padEnd(3)}x ${r.label.padEnd(32)} ${String(r.rows).padStart(5)} ${String(r.domNodes).padStart(6)} ${String(r.scrolledPx).padStart(6)}  ${String(r.fps).padStart(4)}  ${String(r.over16).padStart(6)}  ${String(r.over33).padStart(6)}  ${String(r.p95).padStart(3)}  ${String(r.worst).padStart(5)}  ${r.longTasks} (${r.longestTask} ms)`);
    if (process.env.VERBOSE && r.slowFrames.length) console.log(`      slow frames: ${JSON.stringify(r.slowFrames)}`);
    if (r.over33 > BUDGET.jank33Pct) fails.push(`${r.cpu}x ${r.label}: ${r.over33}% of frames > 33 ms`);
    if (r.longTasks > BUDGET.longTasks && r.cpu === 1) fails.push(`${r.cpu}x ${r.label}: ${r.longTasks} long tasks while scrolling`);
  }
  for (const r of results.filter((x) => x.inpMs !== undefined)) {
    console.log(`${r.cpu}x ${r.label}: ${r.interactions} interactions, INP ${r.inpMs} ms, median ${r.medianMs} ms`);
    if (r.inpMs > BUDGET.inpMs) fails.push(`${r.cpu}x ${r.label}: INP ${r.inpMs} ms > ${BUDGET.inpMs} ms`);
  }
  fails.forEach((f) => console.log(`FAIL  ${f}`));
  if (!fails.length) console.log('PASS  scroll and input budgets');
  if (process.env.PERF_JSON) fs.writeFileSync(process.env.PERF_JSON, JSON.stringify(results, null, 2));
  process.exit(fails.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
