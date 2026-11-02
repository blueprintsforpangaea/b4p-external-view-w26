#!/usr/bin/env node
// Layout checks on a LOCAL build in headless Chrome (no deps):
//   APP_URL=http://127.0.0.1:3765/ node scripts/layout-check.js
// - landing cards: equal heights per visual row when collapsed, at several widths
// - header title: one line (height ~ one line-height) at several widths
// - no horizontal overflow on the main routes at 360 px
// - card toggles: aria-expanded, Enter/Space, Expand all / Collapse all, sessionStorage persistence

const { CDP, launch, shutdown, sleep, assertLocal } = require('./cdp');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:3765/').replace(/#.*$/, '');
const CARD = process.env.CARD_SELECTOR || '.landing section.cat';
const TITLE = process.env.TITLE_SELECTOR || '.header__name, .header__title';
assertLocal(APP_URL);

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${(r.exceptionDetails.exception || {}).description || ''}`);
  return r.result.value;
}

async function open(cdp, width, hash, { height = 900, clearSession = false } = {}) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 900 });
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(150);
  await cdp.send('Page.navigate', { url: APP_URL + hash });
  for (let i = 0; i < 200; i += 1) {
    try { if (await evaluate(cdp, '!!document.querySelector("main h1")')) break; } catch { /* loading */ }
    await sleep(50);
  }
  if (clearSession) await evaluate(cdp, 'sessionStorage.clear(), 1');
  await sleep(400);
}

const CARD_ROWS = `(() => {
  const cards = [...document.querySelectorAll(${JSON.stringify(CARD)})].map((c) => {
    const r = c.getBoundingClientRect();
    return { name: (c.querySelector('h2') || c).textContent.replace(/\\s*\\d[\\d,]*\\s*$/, '').trim(), top: Math.round(r.top + scrollY), h: Math.round(r.height * 10) / 10 };
  });
  const rows = new Map();
  for (const c of cards) { const k = c.top; if (!rows.has(k)) rows.set(k, []); rows.get(k).push(c); }
  const out = [...rows.values()].map((r) => ({ n: r.length, heights: r.map((c) => c.h), spread: Math.round((Math.max(...r.map((c) => c.h)) - Math.min(...r.map((c) => c.h))) * 10) / 10 }));
  return { cards: cards.length, rows: out, maxSpread: Math.max(0, ...out.map((r) => r.spread)),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
})()`;

const TITLE_INFO = `(() => {
  const el = document.querySelector(${JSON.stringify(TITLE)});
  if (!el) return { missing: true };
  const cs = getComputedStyle(el);
  const lh = cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight);
  const r = el.getBoundingClientRect();
  return { text: el.textContent.trim(), visible: cs.display !== 'none' && r.width > 0, height: Math.round(r.height * 10) / 10,
    lineHeight: Math.round(lh * 10) / 10, lines: r.height ? Math.round(r.height / lh) : 0, whiteSpace: cs.whiteSpace,
    clipped: el.scrollWidth > el.clientWidth + 1 };
})()`;

(async () => {
  const { chrome, profile, wsUrl } = await launch(0, '1440,900');
  const cdp = new CDP(wsUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  const fails = [];
  try {
    // 1. collapsed card heights per visual row
    console.log('Landing cards (collapsed): equal height per row');
    for (const w of (process.env.CARD_WIDTHS || '1440,1280,1000,360').split(',').map(Number)) {
      await open(cdp, w, '#/', { clearSession: true });
      await open(cdp, w, '#/'); // reload with a clean session state
      const r = await evaluate(cdp, CARD_ROWS);
      console.log(`  ${w}px: ${r.cards} cards in ${r.rows.length} rows, columns ${[...new Set(r.rows.map((x) => x.n))].join('/')}, max height spread in a row ${r.maxSpread}px, overflow ${r.overflow}`);
      if (r.rows.some((x) => x.n > 1) && r.maxSpread > 1) fails.push(`${w}px: card heights differ by ${r.maxSpread}px in a row ${JSON.stringify(r.rows.find((x) => x.spread === r.maxSpread))}`);
      if (r.overflow > 0) fails.push(`${w}px: landing overflows by ${r.overflow}px`);
    }

    // 2. header title on one line
    console.log('Header title');
    for (const w of (process.env.TITLE_WIDTHS || '1024,1180,1280,1440,1920').split(',').map(Number)) {
      await open(cdp, w, '#/');
      const t = await evaluate(cdp, TITLE_INFO);
      console.log(`  ${w}px: ${t.missing ? 'missing' : `"${t.text}" visible=${t.visible} height ${t.height} / line ${t.lineHeight} -> ${t.lines} line(s), clipped=${t.clipped}`}`);
      if (t.missing) fails.push(`${w}px: no title element (${TITLE})`);
      else if (t.visible && (t.lines !== 1 || t.clipped)) fails.push(`${w}px: title "${t.text}" is ${t.lines} lines${t.clipped ? ', clipped' : ''}`);
    }

    // 3. no overflow at 360
    console.log('Overflow at 360px');
    for (const h of ['#/', '#/c/misc-surgical', '#/c/misc-surgical/sutures', '#/item/2', '#/slip', '#/review', '#/requests']) {
      await open(cdp, 360, h, { height: 740 });
      const o = await evaluate(cdp, 'document.documentElement.scrollWidth - document.documentElement.clientWidth');
      console.log(`  ${h}: ${o}`);
      if (o > 0) fails.push(`360px ${h}: overflow ${o}px`);
    }

    // 4. toggles
    console.log('Card toggles');
    await open(cdp, 1440, '#/', { clearSession: true });
    await open(cdp, 1440, '#/');
    const t = await evaluate(cdp, `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const card = [...document.querySelectorAll(${JSON.stringify(CARD)})].find((c) => c.querySelector('button[aria-expanded]'));
      if (!card) return { error: 'no card with an aria-expanded toggle' };
      const btn = card.querySelector('button[aria-expanded]');
      const links = () => card.querySelectorAll('a[href^="#/c/"]').length;
      const r = { label: btn.textContent.trim(), expanded0: btn.getAttribute('aria-expanded'), links0: links(), controls: btn.getAttribute('aria-controls') };
      r.controlsExists = !!(r.controls && document.getElementById(r.controls));
      btn.focus(); r.focusable = document.activeElement === btn;
      btn.click(); await sleep(150);
      r.expanded1 = btn.getAttribute('aria-expanded'); r.links1 = links(); r.label1 = btn.textContent.trim();
      r.focusKept = document.activeElement === btn;
      r.session = Object.keys(sessionStorage).map((k) => k + '=' + sessionStorage.getItem(k).slice(0, 80));
      return r;
    })()`);
    console.log('  ' + JSON.stringify(t));
    if (t.error) fails.push(t.error);
    else {
      if (t.expanded0 !== 'false' || t.expanded1 !== 'true') fails.push(`toggle aria-expanded ${t.expanded0} -> ${t.expanded1}`);
      if (!(t.links1 > t.links0)) fails.push(`toggle did not show more links (${t.links0} -> ${t.links1})`);
      if (!t.focusKept) fails.push('focus lost after toggling');
      if (t.controls && !t.controlsExists) fails.push(`aria-controls="${t.controls}" points at nothing`);
    }
    if (!t.error) {
      // keyboard: real key events on a native button
      const kb = await evaluate(cdp, `(() => { const b = [...document.querySelectorAll(${JSON.stringify(CARD)} + ' button[aria-expanded]')][1]; b.focus(); return b.getAttribute('aria-expanded'); })()`);
      for (const key of ['Enter']) {
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: 13, text: '\r' });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: 13 });
      }
      await sleep(150);
      const kbAfterEnter = await evaluate(cdp, 'document.activeElement.getAttribute("aria-expanded")');
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      await sleep(150);
      const kbAfterSpace = await evaluate(cdp, 'document.activeElement.getAttribute("aria-expanded")');
      console.log(`  keyboard: ${kb} -Enter-> ${kbAfterEnter} -Space-> ${kbAfterSpace}`);
      if (kb === kbAfterEnter || kbAfterEnter === kbAfterSpace) fails.push('Enter/Space did not toggle the card');

      // persistence across reload (same tab session), reset in a new session
      const before = await evaluate(cdp, `[...document.querySelectorAll(${JSON.stringify(CARD)} + ' button[aria-expanded]')].map((b) => b.getAttribute('aria-expanded')).join('')`);
      await cdp.send('Page.reload');
      await sleep(1200);
      const after = await evaluate(cdp, `[...document.querySelectorAll(${JSON.stringify(CARD)} + ' button[aria-expanded]')].map((b) => b.getAttribute('aria-expanded')).join('')`);
      console.log(`  reload keeps state: ${before === after}`);
      if (before !== after) fails.push('card open/closed state not kept across reload (sessionStorage)');

      // Expand all / Collapse all
      const all = await evaluate(cdp, `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const find = (re) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent.trim()));
        const states = () => [...document.querySelectorAll(${JSON.stringify(CARD)} + ' button[aria-expanded]')].map((b) => b.getAttribute('aria-expanded'));
        let b = find(/^Expand all$/i);
        if (!b) { const c = find(/^Collapse all$/i); if (!c) return { error: 'no Expand all / Collapse all button' }; c.click(); await sleep(150); b = find(/^Expand all$/i); }
        b.click(); await sleep(200);
        const afterExpand = states(); const label1 = (find(/^(Expand|Collapse) all$/i) || {}).textContent;
        find(/^Collapse all$/i).click(); await sleep(200);
        const afterCollapse = states();
        return { allOpen: afterExpand.every((s) => s === 'true'), label1, allClosed: afterCollapse.every((s) => s === 'false'), n: afterExpand.length };
      })()`);
      console.log('  ' + JSON.stringify(all));
      if (all.error) fails.push(all.error);
      else if (!all.allOpen || !all.allClosed) fails.push(`Expand all / Collapse all did not set every card (${JSON.stringify(all)})`);

      // new session starts collapsed
      await evaluate(cdp, 'sessionStorage.clear(), 1');
      await cdp.send('Page.reload');
      await sleep(1200);
      const fresh = await evaluate(cdp, `[...document.querySelectorAll(${JSON.stringify(CARD)} + ' button[aria-expanded]')].every((b) => b.getAttribute('aria-expanded') === 'false')`);
      console.log(`  new session starts collapsed: ${fresh}`);
      if (!fresh) fails.push('a new session does not start collapsed');
    }
  } finally {
    await shutdown(chrome, profile);
  }
  fails.forEach((f) => console.log(`FAIL  ${f}`));
  if (!fails.length) console.log('PASS  layout checks');
  process.exit(fails.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
