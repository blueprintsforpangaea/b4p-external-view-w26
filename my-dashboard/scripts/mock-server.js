#!/usr/bin/env node
// Local-only stand-in for the backend, with SYNTHETIC inventory (no real rows, no patient IDs).
//   REACT_APP_API_URL=http://127.0.0.1:8765 npm run build && node scripts/mock-server.js
// Serves build/ on :3765 and the API on :8765 (GET /api/supplies, /inventory/availability, /requests; POST /requests).
const http = require('http');
const fs = require('fs');
const path = require('path');

const BUILD = path.resolve(__dirname, '..', 'build');
const WEB = Number(process.env.WEB_PORT || 3765);
const API = Number(process.env.API_PORT || 8765);
const DELAY = Number(process.env.API_DELAY || 0);

const { TYPES } = require('./synthetic-inventory');
const MFR = ['Acme Medical', 'Northwind Health', 'Contoso Supply', 'Globex Care', ''];
const rows = [];
let n = 2;
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
for (const [cat, names] of Object.entries(TYPES)) {
  for (const name of names) {
    for (let lot = 0; lot < 1 + Math.floor(rnd() * 3); lot += 1) {
      const r = rnd();
      rows.push({
        _sheet_row: n++, Name: name, Category: cat, Subcategory: cat, Quantity: String(r < 0.15 ? Math.floor(rnd() * 5) : 10 + Math.floor(rnd() * 400)),
        'Manufacturer Name': MFR[Math.floor(rnd() * MFR.length)], 'Lot Number': `LOT-${1000 + n}`,
        'Date of Expiration': r < 0.1 ? day(-30) : r < 0.25 ? day(45) : day(200 + Math.floor(rnd() * 700)),
        'Pallet Number': String(1 + Math.floor(rnd() * 9)), 'Box Number': String(1 + Math.floor(rnd() * 40)), Review: '', Notes: '',
      });
    }
  }
}
const HELD = new Set(['Pulse oximeter']); // every lot of these is approved to someone else: shows "On hold"
const avail = rows.map((r) => {
  const q = Number(r.Quantity);
  if (HELD.has(r.Name)) return { sheet_row: r._sheet_row, item_name: r.Name, category: r.Category, availability_status: 'Requested', tags: ['Requested'], remaining: 0, requesting_org: null, request_id: null };
  return { sheet_row: r._sheet_row, item_name: r.Name, category: r.Category, availability_status: q <= 5 ? 'Limited' : 'Available', tags: [q <= 5 ? 'Low Stock' : 'Available'], remaining: q, requesting_org: null, request_id: null };
});

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const json = (res, body, code = 200) => setTimeout(() => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ...cors });
  res.end(JSON.stringify(body));
}, DELAY);
http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (p === '/api/supplies') return json(res, rows);
  if (p === '/inventory/availability') return json(res, avail);
  if (p === '/requests' && req.method === 'GET') {
    const mk = (id, status, ts, items) => items.map(([n, q]) => ({ 'Request ID': id, Status: status, Timestamp: ts, 'Item Name': n, 'Quantity Requested': String(q) }));
    return json(res, [
      ...mk('R-1003', 'Pending', '2026-10-09T14:20:00Z', [['Syringe 5 mL', 40], ['Needle 21G', 100]]),
      ...mk('R-1002', 'Approved', '2026-10-02T09:05:00Z', [['Nitrile gloves (M)', 200]]),
      ...mk('R-1001', 'Delivered', '2026-09-20T16:40:00Z', [['Gauze pads 4x4', 60], ['Medical tape 1 in', 12], ['Elastic bandage 4 in', 10]]),
      ...mk('R-1000', 'Denied', '2026-09-01T11:00:00Z', [['Pulse oximeter', 5]]),
    ]);
  }
  if (p === '/requests') return json(res, { request_id: 'REQ-20261011-4F2A', status: 'Under Review' });
  return json(res, { detail: 'Not found' }, 404);
}).listen(API, '127.0.0.1');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
http.createServer((req, res) => {
  let f = path.join(BUILD, req.url.split('?')[0]);
  if (!f.startsWith(BUILD) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(BUILD, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(WEB, '127.0.0.1', () => console.log(`web http://127.0.0.1:${WEB}  api http://127.0.0.1:${API}  rows ${rows.length}`));
