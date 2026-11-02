// Records the "how to request supplies" walkthrough (public/demo.webm) against the local site, with
// a caption for each step and a visible cursor. Re-run it whenever the screens change:
//   npm i --no-save playwright-core@1.50 && node scripts/record-demo.js /tmp/demo
//   then copy /tmp/demo/demo.webm to public/ (and pick a poster frame for public/demo.jpg).
// Needs the frontend on :3000 and the backend on :8000 in sample or read-only sheet mode
// (USE_SAMPLE_DATA=1 or PUBLIC_SHEET_READ=1), and Google Chrome installed.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const OUT = path.resolve(process.argv[2] || 'out');
const APP = 'http://localhost:3000/';
const W = 1280;
const H = 800;
fs.mkdirSync(OUT, { recursive: true });

// Caption bar, a visible cursor, and hides the preview-only notices and the empty video slot.
const OVERLAY = `
(() => {
  if (document.getElementById('__rec')) return;
  const css = document.createElement('style');
  css.textContent = \`
    .mock-note, .footer__source, .home__video { display: none !important; }
    .home { grid-template-columns: 1fr !important; max-width: 760px; }
    #__cap { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 99999;
      max-width: 1000px; padding: 14px 26px; border-radius: 12px; background: rgba(0,14,63,.94); color: #fff;
      font: 600 24px/1.35 system-ui, -apple-system, sans-serif; text-align: center; box-shadow: 0 6px 24px rgba(0,0,0,.25);
      transition: opacity .3s; pointer-events: none; }
    #__cap:empty { opacity: 0; }
    #__cap b { color: #ffd65c; }
    #__cur { position: fixed; z-index: 100000; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%;
      background: rgba(223,49,49,.35); border: 3px solid #df3131; pointer-events: none; transition: transform .12s; left: -50px; top: -50px; }
    #__cur.down { transform: scale(.7); }
    * { caret-color: transparent !important; }
  \`;
  document.head.appendChild(css);
  const cap = document.createElement('div'); cap.id = '__cap'; document.body.appendChild(cap);
  const cur = document.createElement('div'); cur.id = '__cur'; cur.id = '__cur'; document.body.appendChild(cur);
  const r = document.createElement('i'); r.id = '__rec'; r.hidden = true; document.body.appendChild(r);
  addEventListener('mousemove', (e) => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => cur.classList.add('down'), true);
  addEventListener('mouseup', () => cur.classList.remove('down'), true);
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mouse = { x: W / 2, y: H / 2 };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: W, height: H } },
    reducedMotion: 'no-preference',
  });
  await context.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* fine */ } });
  const page = await context.newPage();

  const overlay = () => page.evaluate(OVERLAY);
  const caption = async (html, ms = 0) => {
    await overlay();
    await page.evaluate((h) => { document.getElementById('__cap').innerHTML = h; }, html);
    if (ms) await sleep(ms);
  };
  const moveTo = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    let box = await locator.boundingBox();
    if (box.y + box.height > H - 150) { // keep it clear of the caption bar
      await locator.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      await sleep(700);
      box = await locator.boundingBox();
    }
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y, { steps: 25 });
    mouse = { x, y };
    await sleep(250);
  };
  const click = async (locator, pause = 500) => {
    await moveTo(locator);
    await page.mouse.down();
    await sleep(90);
    await page.mouse.up();
    await sleep(pause);
  };
  const type = async (locator, text, delay = 85) => {
    await click(locator, 200);
    await page.keyboard.type(text, { delay });
    await sleep(400);
  };

  // Home
  await page.goto(APP + '#/');
  await page.getByRole('heading', { name: /Welcome/ }).waitFor();
  await overlay();
  await page.mouse.move(mouse.x, mouse.y);
  await caption('How to request supplies from <b>Blueprints for Pangaea</b>', 3200);
  await caption('Free donated medical supplies for partner clinics', 2600);

  // Sign in
  await caption('<b>Step 1.</b> Click <b>Sign in</b>');
  await click(page.getByRole('link', { name: 'Sign in', exact: true }).first(), 900);
  await caption('<b>Step 1.</b> Type your work email. No password needed.');
  await type(page.getByLabel('Your work email'), 'ana@riversideclinic.org');
  await click(page.getByRole('button', { name: 'Email me a code' }), 1200);
  const code = (await page.locator('.mock-note code').textContent()).trim();
  await caption('<b>Step 2.</b> Type the 6-digit code from the email we send you');
  await type(page.getByLabel('Code from the email'), code, 160);
  await click(page.getByRole('button', { name: 'Sign in' }), 1000);
  await caption('The first time only: type your clinic’s name');
  await type(page.getByLabel('Clinic name'), 'Riverside Community Clinic', 60);
  await click(page.getByRole('button', { name: 'Continue' }), 900);

  // Find supplies
  await page.getByLabel('Search').waitFor();
  await sleep(1200);
  await caption('<b>Step 3.</b> Find what you need: search, or use the two filters', 2600);
  await caption('<b>Step 3.</b> Type in <b>Search</b>, for example “gloves”');
  await type(page.getByLabel('Search'), 'gloves', 140);
  await sleep(1400);
  await caption('<b>Step 3.</b> Or narrow it down with <b>Warehouse category</b> and <b>Supply type</b>');
  await click(page.getByLabel('Supply type'), 300);
  await page.getByLabel('Supply type').selectOption({ label: (await page.getByLabel('Supply type').locator('option', { hasText: /^Gloves/ }).first().textContent()).trim() });
  await sleep(2000);

  // Add to list
  await caption('<b>Step 4.</b> Click <b>Add to list</b> next to what you need');
  const gloves = page.locator('.item-row', { hasText: /glove/i });
  const first = gloves.nth(0);
  await click(first.locator('.btn--add'), 2200);
  await caption('<b>Step 4.</b> Use <b>+</b> and <b>−</b> to change how many');
  const plus = first.locator('.spec__qty button').last();
  if (await plus.isEnabled()) {
    await click(plus, 500);
    await click(plus, 900);
  } else {
    await sleep(1200);
  }
  await click(gloves.nth(1).locator('.btn--add'), 1400);

  // Your list → review → send
  await caption('<b>Step 5.</b> Open <b>Your list</b> (top right) to check it');
  await click(page.locator('.header__slip'), 1800);
  await caption('<b>Step 5.</b> Click <b>Review and send</b>');
  await click(page.getByRole('button', { name: 'Review and send' }), 1500);
  await caption('<b>Step 6.</b> Check your clinic and the amounts, then click <b>Send request</b>', 2600);
  await click(page.getByRole('button', { name: /^Send request/ }), 400);
  await page.getByRole('heading', { name: 'Request submitted' }).waitFor({ timeout: 15000 })
    .catch(async (e) => { await page.screenshot({ path: path.join(OUT, 'fail.png'), fullPage: true }); throw e; });
  await sleep(500);
  await caption('Done! We review it, pack it and ship it, and email you at each step', 3600);

  // My requests
  await caption('Check on your requests any time under <b>My requests</b>');
  await click(page.getByRole('button', { name: 'View my requests' }), 2200);
  await page.locator('.req').first().waitFor({ timeout: 20000 }).catch(() => {});
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT, 'poster-requests.jpg'), type: 'jpeg', quality: 85 });
  await caption('Questions? Email the Blueprints team. The address is at the bottom of every page.', 3500);
  await caption('', 600);

  const video = page.video();
  await context.close();
  await browser.close();
  const file = await video.path();
  fs.renameSync(file, path.join(OUT, 'demo.webm'));
  console.log('saved', path.join(OUT, 'demo.webm'), 'code was', code);
})().catch((e) => { console.error(e); process.exit(1); });
