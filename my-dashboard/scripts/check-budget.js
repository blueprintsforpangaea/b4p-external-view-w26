#!/usr/bin/env node
// Speed budget for every build (docs/REDESIGN_PLAN.md, "Speed budget").
// Usage: CI=true npm run build && node scripts/check-budget.js [buildDir]
// Exits 1 if any budget is exceeded. Sizes are gzip level 9, like most CDNs.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const KB = 1024;
const BUDGET = { js: 80 * KB, css: 15 * KB, sprite: 12 * KB, font: 0 }; // system font stack: no font files

const root = path.resolve(__dirname, '..');
const build = path.resolve(process.argv[2] || process.env.BUILD_PATH || path.join(root, 'build'));

const gz = (file) => zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
const list = (dir, re) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => path.join(dir, f)) : []);
const fmt = (n) => `${(n / KB).toFixed(1)} KB`;

function walk(dir, re, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, re, out);
    else if (re.test(entry.name)) out.push(p);
  }
  return out;
}

// The sprite may ship as its own SVG file or as a JS module inlined into the bundle.
function findSprite() {
  if (process.env.SPRITE_PATH) return [path.resolve(process.env.SPRITE_PATH)];
  const built = list(path.join(build, 'static', 'media'), /sprite.*\.svg$/i);
  if (built.length) return built;
  const owned = list(path.join(root, 'src', 'productIcons'), /^sprite\.(svg|js)$/i); // icon-designer's module
  if (owned.length) return owned;
  return walk(path.join(root, 'src'), /^(sprite|icons?)[^/]*\.(svg|js)$/i).filter((f) => !/\.test\.js$/.test(f));
}

if (!fs.existsSync(path.join(build, 'index.html'))) {
  console.error(`No build at ${build}. Run CI=true npm run build first.`);
  process.exit(2);
}

const rows = [];
const check = (name, files, budget) => {
  const size = files.reduce((sum, f) => sum + gz(f), 0);
  rows.push({ name, size, budget, files: files.map((f) => path.relative(root, f)), ok: size <= budget });
};

check('JS (all chunks)', list(path.join(build, 'static', 'js'), /\.js$/), BUDGET.js);
check('CSS', list(path.join(build, 'static', 'css'), /\.css$/), BUDGET.css);
const sprite = findSprite();
if (sprite.length) check('Icon sprite', sprite, BUDGET.sprite);
else rows.push({ name: 'Icon sprite', size: 0, budget: BUDGET.sprite, files: [], ok: true, note: 'not found yet (set SPRITE_PATH)' });

// Fonts: system stack only, so no font files at all, and nothing from a font CDN or any other host.
const html = fs.readFileSync(path.join(build, 'index.html'), 'utf8');
const css = list(path.join(build, 'static', 'css'), /\.css$/).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const external = [
  ...(html.match(/https?:\/\/[^"')\s]*\.(woff2?|ttf|otf)|fonts\.(googleapis|gstatic)\.com[^"')\s]*/g) || []),
  ...(css.match(/url\(\s*["']?https?:[^)]*\)|fonts\.(googleapis|gstatic)\.com/g) || []),
];
const fontFiles = walk(build, /\.(woff2?|ttf|otf|eot)$/i);
const fontBytes = fontFiles.reduce((n, f) => n + fs.statSync(f).size, 0); // woff2 is already compressed
rows.push({ name: 'Self-hosted fonts', size: fontBytes, budget: BUDGET.font, files: fontFiles.map((f) => path.relative(root, f)), ok: fontBytes <= BUDGET.font, note: `${fontFiles.length} file(s), raw bytes` });
rows.push({ name: 'External fonts', size: external.length, budget: 0, files: [...new Set(external)], ok: external.length === 0, count: true });

let failed = false;
for (const r of rows) {
  failed = failed || !r.ok;
  const value = r.count ? `${r.size} found` : `${fmt(r.size)} / ${fmt(r.budget)}`;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(16)} ${value}${r.note ? `  (${r.note})` : ''}`);
  if (!r.ok || process.env.VERBOSE) r.files.forEach((f) => console.log(`        ${f}`));
}
if (process.env.BUDGET_JSON) fs.writeFileSync(process.env.BUDGET_JSON, JSON.stringify(rows, null, 2));
process.exit(failed ? 1 : 0);
