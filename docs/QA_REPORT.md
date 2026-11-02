# QA report: Vish-F26 redesign

Owner: qa-tester. Updated 2026-10-09. Everything here ran against local instances only
(sample data, a throwaway Postgres copy, and fake Google Sheets clients). No email was sent.

## Current status

| Suite | Result |
|---|---|
| pytest (backend, all files) | 346 passed, 0 failed |
| Jest (`src/*.test.js`, McMaster UI, round 3) | 400 passed, 2 skipped (live-snapshot only), 0 failed |
| `CI=true npm run build` | Compiled successfully, no warnings |
| Browser pass (Phase 2, Chrome, 1,137-row sample, final UI) | 30 checks passed; FE-07 to FE-10 found and fixed; console clean from page load |
| Production `/health` (read-only GET, once) | `{"ok": true}`, HTTP 200: the deployed backend predates this branch (no `source`/`email` fields) |

## How to rerun everything

```sh
# backend: use your own DB copy, since parallel runs of the default fixture drop the shared one
createdb -T b4p_v2 b4p_test_qa
TEST_DATABASE_URL=postgresql:///b4p_test_qa .venv/bin/python -m pytest -q
# optional: the availability test over all 1,137 live rows needs a local copy of /api/supplies
QA_SUPPLIES_JSON=/path/to/supplies.json TEST_DATABASE_URL=... .venv/bin/python -m pytest -q tests/test_flows.py

# frontend
cd my-dashboard
CI=true npm test -- --watchAll=false
CI=true npm run build
```

`tests/conftest.py` blanks every email variable. To run the servers by hand, blank them too:

```sh
GMAIL_USER= GMAIL_APP_PASSWORD= RESEND_API_KEY= BREVO_API_KEY= DATABASE_URL= USE_SAMPLE_DATA=1 \
  .venv/bin/uvicorn main:app --port 8000
cd my-dashboard && REACT_APP_API_URL=http://127.0.0.1:8000 npm start
```

## Test matrix

Backend tests marked "both" run once in sheet-sample mode and once in Postgres mode.
"Live sheet" means sheet mode with gspread replaced by an in-memory fake.

| Flow | Where | Mode | Result |
|---|---|---|---|
| `/health`, `/api/supplies`, `/inventory/availability`, `POST /requests`, `GET /requests?email=` response shapes | test_api_contract.py | both | pass |
| Quantity 0 / -1 / 1 / 10000 / 10001 / 1.5 / null / "abc" | test_api_contract.py | both | pass |
| Items 0 / 1 / 100 / 101 | test_api_contract.py | both | pass |
| Org name blank / whitespace / 200 / 201 chars, stored trimmed | test_api_contract.py | both | pass |
| Email: 16 good and bad cases, incl. header injection, 254/255 length | test_api_contract.py | both | pass |
| Item name blank / whitespace-only / 500 / 501 chars | test_api_contract.py | both | pass (after QA-03 fix) |
| Malformed bodies, non-JSON body | test_api_contract.py | both | pass |
| Rejected submissions send no email | test_api_contract.py | both | pass |
| Rate limit: 11th POST is 429; invalid POSTs also count | test_api_contract.py | both | pass |
| HQ PATCH: token missing / wrong / unset, bad status, unknown id 404, Shipped -> Approved 409 | test_api_contract.py | both | pass (after QA-04 fix) |
| CORS: localhost:3000 allowed, other origins not | test_api_contract.py | sheet | pass |
| Sheets errors on read and write: 503 for quota, 502 otherwise, no Google text leaked | test_api_contract.py | live sheet | pass (after QA-01, QA-02 fixes) |
| Database down: 503 "Database unavailable." on every endpoint, no DSN leaked, `/health` ok=false | test_api_contract.py | DB | pass |
| Full lifecycle: submit (1 clinic + 1 HQ email) -> list by email (case/space-insensitive) -> Approved (+1 email) -> repeat (no email, `changed: false`) -> Shipped (+1 email) -> stock released | test_flows.py | both + live sheet | pass (after QA-04, QA-05 fixes) |
| Orgs never see each other's requests; email filter is exact | test_flows.py | both | pass |
| Double submit creates two requests (API has no idempotency; UI must guard) | test_flows.py | both | pass (documents behavior) |
| 4th confirmation to one address in an hour skipped, HQ still alerted | test_flows.py | both | pass |
| `EMAIL_ON_SUBMIT=false` still sends status emails | test_flows.py | both | pass |
| Availability on the live data shape: duplicate names, "Unknown"/blank names, blank quantity, "1,200", "12.0", " 9 ", 5 vs 6 threshold, 0 in stock, over-request, Shipped released | test_flows.py | sheet | pass (after QA-07 fix) |
| Review=Yes items flagged for HQ in sheet modes | test_flows.py | sheet | pass (after QA-06 fix) |
| All 1,137 live rows: every row gets a status; holding one item changes only that item | test_flows.py | sheet | pass (skipped if sample absent) |
| Data helpers: quantity, expiry (boundaries, DST), Drive ID extraction (14 hostile URLs), normalize, search, filters, chip counts, sorts, request grouping | inventory.test.js | Jest | pass (after FE-01, FE-02 fixes) |
| Cart: add/step/cap/remove, unknown stock, 100-line limit, reload persistence, corrupt and tampered localStorage, reconcile, cross-tab sync; org memory | useCart.test.js | Jest | pass (after FE-04, FE-06 fixes) |
| API wrapper: network error, timeout, cold-start notice at 5s, 429/400/422/5xx messages, non-JSON error body, URL encoding; hash routes | api.test.js | Jest | pass (after FE-05 fix) |
| App: guest browse, search + empty state + clear, Escape clears search, chips, expired can't be added, layout remembered | App.test.js | Jest | pass |
| App: stepper capped at stock (button and typing), minus removes, slip persists across reload, expired/vanished lines removed with notice | App.test.js | Jest | pass |
| App: slip stepper raises quantity | App.test.js | Jest | pass (after FE-04 fix) |
| App: checkout validation and focus, submit -> confirmation (focus, ID, hash) -> My requests with status, double-click posts once, 429/400/503/422 shown with slip kept, network retry, empty-slip checkout | App.test.js | Jest | pass |
| App: "Unknown"-named row sent with identifying detail | App.test.js | Jest | pass (after FE-03 fix) |
| App: API down + retry, 502 plain message, availability down tolerated, On hold badge, cold-start message, empty inventory | App.test.js | Jest | pass |
| App: item detail via hash + Escape + focus restore, unknown item deep link, back from My requests, My requests bad email / empty / error + retry | App.test.js | Jest | pass |
| App at phone width: bottom bar, slip sheet focus + Escape, header count | App.test.js | Jest | pass |
| App: list default + grid remembered, 101st supply refused with toast, renamed row removed with notice, old line re-capped, Remove → Undo in place, `#/review` and `#/checkout`, forged `#/sent/...` links go to catalog, hex-suffix ID opens confirmation | App.test.js | Jest | pass |
| `applyAvailability` (remaining, holds, junk input, duplicate-name cap), `statusInfo` (Delivered, Denied, Cancelled), `restore` | inventory.test.js, useCart.test.js | Jest | pass (after FE-07 fix) |
| Every App test fails if React logs a console error | App.test.js | Jest | pass |

### Scroll smoothness and input latency (`scripts/perf-scroll.js`)

`node scripts/perf-scroll.js` (local only). Viewport 1440x900. A wheel-style `Input.synthesizeScrollGesture` at 2,400 px/s runs down each page while a rAF loop records frame times and a PerformanceObserver records long tasks. Frames are uncapped (headless and occluded windows pace at 30 Hz), so every frame time is that frame's real cost; anything over 16.7 ms would miss a 60 Hz deadline. INP is the Event Timing duration (input to next paint) for one Add click and five "+" clicks on a well-stocked row. Budgets: < 2% of frames over 33 ms, no long tasks at 1x, INP < 200 ms.

**Baseline BEFORE the smooth-scroll round** (build f628261 + working tree, two runs; second run in brackets):

| CPU | Page | Rows | DOM nodes | Scrolled px | fps capacity | frames > 17 ms | > 33 ms | p95 / worst | long tasks |
|---|---|---|---|---|---|---|---|---|---|
| 1x | All (landing) | 0 | 734 | 694 | 66 [66] | 3.3% [3.3%] | 0 | 18 / 18 ms | 0 |
| 1x | Biggest, `#/c/misc-surgical` | 133 | 2,994 | 14,453 | 71 [75] | 30.8% [16.4%] | 0 | 18 / 18 ms | 0 |
| 1x | Search "a" | 150 | 2,495 | 10,837 | 73 [71] | 28.6% [21.0%] | 0 | 18 / 18 ms | 0 |
| 4x | All (landing) | 0 | 734 | 694 | 65 [63] | 27.1% [29.3%] | 0 | 18 / 18 ms | 0 |
| 4x | Biggest | 133 | 3,003 | 14,455 | 68 [68] | 17.8% [22.7%] | 0 | 18 / 21 ms | 0 |
| 4x | Search "a" | 150 | 2,504 | 10,911 | 70 [70] | 21.9% [21.7%] | 0 | 18 / 23 ms | 0 |

| CPU | Add + five "+" clicks | INP (worst) | median |
|---|---|---|---|
| 1x | 5 interactions | 24 ms | 16 ms |
| 4x | 6 interactions | 56 ms | 24 ms |

How to read it: no long tasks and no frames over 33 ms at either CPU speed. Most frames finish just around the 16.7 ms line (p95 18 ms), so a laptop under load can drop single frames, but there are no visible stalls. The share of frames over 17 ms swings by about 10 points between runs, so compare p95, worst and long tasks rather than that percentage alone.

**AFTER round 3** (alphabetical order, expired items hidden, progressive rows, memoised rows, `content-visibility: auto` on type sections, Manrope; two runs, second in brackets):

| CPU | Page | Rows | DOM nodes | Scrolled px | fps capacity | p95 / worst | > 33 ms | long tasks |
|---|---|---|---|---|---|---|---|---|
| 1x | All (landing) | 0 | 824 | 646 | 66 [68] | 18 / 18 ms | 0 | 0 |
| 1x | Biggest, `#/c/misc-surgical` | 128 | 3,211 | 14,599 | 81 [83] | 18 / 24 [20] ms | 0 | 0 |
| 1x | Search "a" | 150 | 4,481 | 15,000 (cap) | 75 [78] | 18 / 24 ms | 0 | 0 |
| 4x | All (landing) | 0 | 824 | 646 | 65 [64] | 18 / 18 ms | 0 | 0 |
| 4x | Biggest | 128 | 3,220 | 14,601 | 77 [78] | 18 / 58 [57] ms | 0.2% (one frame) | 0 |
| 4x | Search "a" | 150 | 4,490 | 15,000 | 72 [73] | 18 / 23 [39] ms | 0 [0.2%] | 0 |

INP for Add plus five "+" clicks: 24 ms at 1x (median 16 ms); 16–24 ms at 4x (median 16 ms), down from 56 ms.

Before vs after:
- **Click latency** at 4x CPU dropped from 56 ms to 16–24 ms (memoised rows).
- **Frame capacity** on the biggest category rose from about 71-75 to 77-83 fps.
- **p95 frame** is unchanged at 18 ms. The synthetic 60 Hz gesture seems to set that floor, so the "< 16.7 ms" target can't be shown with this method.
- **Worst frame** got worse at 4x: one 35-58 ms frame near the top of the biggest category (y ≈ 500, all rows already rendered). It looks like the first type section rendering as it enters the viewport under `content-visibility: auto`. Baseline worst was 21 ms. Reported as FE-17 (Low).
- **Search "a"** builds a page with about 1.8x the DOM nodes, because every matching type now has a tile, and still has 0 long tasks.

**Load timing, round 3:** first row cold 74 ms, warm 49 ms, warm with API +3 s 48 ms. Search 103-109 ms. One self-hosted font request (`/fonts/manrope-latin-var.woff2`, 24 KB, preloaded); 0 images, 0 external hosts, CLS 0.000.

**Round 3 final (with Manrope and the word-start type matching):** budget JS 73.6 / CSS 12.6 / sprite 6.4 KB, self-hosted font 24 KB, external fonts 0. Load: first row cold 77 ms, warm 56 ms, warm with API +3 s 48 ms; search 103-106 ms; CLS 0; 0 images. Scroll at 1x: worst frame 18-19 ms on every page, 0 long tasks. At 4x: biggest category has one 41 ms frame at y ≈ 519 (FE-17), search "a" worst 23 ms, and its DOM fell from 4,481 to 3,089 nodes now that "a" no longer lights up every tile. INP 24 ms at 1x, 16 ms at 4x.

Browser (real Chrome, 1,137-row snapshot):
- Title, brand and footer mailto are right. Body and h1 are Manrope 300; buttons and stock are 700.
- Add, then the drawer (focus on Close), Review, Submit: the backend line is "<sheet name> [Lot —, Box 2, Pallet 2]". The confirmation says "1 supply, 1 unit", and My requests says the same.
- 360px: no overflow on 7 routes, including a type anchor and an item deep link.
- Console clean.

Notes for the lead (UX, not bugs):
- With every type tile shown, a phone has to scroll 2,313 px (about 3 screens of 43 tiles) on Misc Surgical before the first product row. Tapping a tile does jump straight to its table.
- The landing page still truncates each category to 8 type links plus "N more types".
- The landing grid flows down columns, so it reads A-Z down each column, not across rows.

**After the FE-17 fix** (`content-visibility` removed; 5 runs at 4x, 2 at 1x): misc-surgical worst frame 19-23 ms at 4x and 22-24 ms at 1x, 0 frames over 33 ms. Search "a" worst 19-24 ms. 0 long tasks anywhere. INP 24 ms (median 16 ms) at 1x and 4x. Frame capacity on misc-surgical is 68-71 fps at 4x, a few fps below the content-visibility build, as frontend-engineer expected. One landing run in 5 at 4x had a single 57 ms frame after the gesture had ended (scrollY at the bottom, 929 ms in), so it happened after scrolling stopped. It didn't reproduce in the other 4 runs. Load: cold 83 ms, warm 58 ms, search 103-110 ms. Budget: JS 73.6, CSS 12.5 KB.

**Landing shows every type; compact phone tiles** (fresh build): budget JS 73.5 / CSS 12.6 KB; Jest 399 passed / 2 skipped. 360px load: cold 82 ms, warm 58 ms, CLS 0.
- Landing: 226 type links and no "N more types" link.
- Misc Surgical, 43 tiles:

| Width | Tile layout | Tile min height | Tile block | First product row | Overflow |
|---|---|---|---|---|---|
| 360 | compact, 2 columns | 44 px | 1,023 px | 1,410 px (was 2,313) | 0 |
| 375 | compact, 2 columns | 44 px | 1,023 px | 1,410 px | 0 |
| 600 | compact, 2 columns | 44 px | 968 px | 1,311 px | 0 |
| 601 | desktop tiles, 2 columns | 64 px | 1,584 px | 1,928 px | 0 |

- 360px: no overflow on `#/`, `#/review`, `#/requests`, `#/slip`, `#/item/2`, a type anchor, or search "syringe". Search shows 7 type tiles, and " in <Category>" is hidden.
- Note: from 601 px up to the 900 px tree breakpoint (tablets in portrait), the large tiles still sit in 2 columns, so the first product row is lower there (1,928 px) than on a phone.

**Landing in row order; search tiles show their category** (fresh build; budget JS 73.5 / CSS 12.7 KB; Jest 400 passed / 2 skipped):
- The landing reads A-Z across rows at every width:
  - 1440 px: 3 columns, first row Airway & Oxygen / Apparel / Catheters & Briefs.
  - 1000 px: 2 columns.
  - 360 px: 1 column.
  - No overflow and no "more types" link at any width.
- Search tiles show `.tile__cat`: at 375 px, "gauze" gives "Gauze sponges & pads" with "in Misc Surgical" and again with "in Wound Care & Bandages". At 360 px, "syringe" lines read "in Needles & Syringes" / "in IV Supplies", and the smallest tile is 45 px. Category-page tiles never render the line (new Jest test).
- 360 / 375 px: no overflow on `#/`, a category, a type anchor, `#/item/2`, `#/slip`, `#/review`, `#/requests`, or either search. No console errors.

**Compact type list up to 899 px, 2 columns** (lead's call; fresh build, JS 73.5 / CSS 12.7 KB). Misc Surgical, 43 tiles:

| Width | Columns | Min tile height | Tile block | First product row | Overflow |
|---|---|---|---|---|---|
| 360 | 2 | 44 | 1,023 | 1,410 | 0 |
| 600 | 2 | 44 | 968 | 1,311 | 0 |
| 700 | 2 | 44 | 968 | 1,311 | 0 |
| 768 | 2 | 44 | 968 | 1,361 | 0 |
| 899 | 2 | 44 | 968 | 1,361 (was 1,928) | 0 |
| 900 (tree appears) | 3, desktop tiles | 78 | 1,431 | 1,772 | 0 |

The tablet note is resolved. At 900-~1100 px the desktop tiles sit next to the tree, so the first product row is at about 1,770 px. That's the existing desktop design, not a regression.

## Round 4: collapsible landing cards, one-line title, sizing

`node scripts/layout-check.js` (headless, local) plus a per-width title probe. Budget JS 73.9/75 (1.1 KB left), CSS 12.8/15, sprite 6.4, font 24 KB. Jest 409 passed / 2 skipped; pytest 298.

| Check | 1920 | 1440 | 1280 | 1180 | 1179 | 1024 | 1000 | 761 | 375 / 360 |
|---|---|---|---|---|---|---|---|---|---|
| Collapsed card height (all cards) | — | 300 px | 300 | — | — | — | 300 | — | 300 / 300 |
| Height spread in a row | — | 0 (3 cols) | 0 (3) | — | — | — | 0 (2) | — | 0 (1) |
| Visible title | full name | full name | full name | full name | "Supply Requests" | "Supply Requests" | — | "Supply Requests" | hidden (≤760) |
| Title height / line height | 24/24 (1 line) | 1 line | 1 line | 1 line | 1 line | 1 line | — | 1 line | — |
| Title clipped | no | no | no | no | no | no | — | no | — |
| Header height | 65 | 65 | 65 | 65 | 65 | 65 | — | 113 (2 rows) | — |
| Overflow | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 on 7 routes |

Toggles:
- "Show all 17 types": `aria-expanded` goes false → true, `aria-controls="cat-types-airway-and-oxygen"` exists, and the card goes from 6 to 17 links. Focus stays on the button, and the label changes to "Show fewer".
- Real Enter and Space key events both toggle it.
- Expand all opens all 9 togglable cards and becomes "Collapse all", which closes them.
- State is in `b4p.landing.open.v1`, kept across a reload, and a new session starts collapsed.
- Jest covers bad saved values (`{bad`, numbers, `__proto__`/`constructor`, unknown slugs): all ignored.

Speed: first row cold 73 ms, warm 37 ms; search 105-112 ms; CLS 0; 0 images, 1 self-hosted font. Scroll at 1440x900, two runs: landing, biggest category and search "a" all have 0 long tasks and 0 frames over 33 ms. Worst frame 19-23 ms at 1x and 4x, p95 19 ms (18 ms before; within run-to-run noise). INP 24 ms (median 16 ms) at 1x and 4x.

**Spec table re-balance** (month-only Expires, 136 px action column). Probed headless on Needles & Syringes and Misc Surgical:

| Width | Supply / Maker / Lot / Expires / In stock / Qty (px) | Overflowing cells | Lot ellipsized (titled) | Name lines 1/2/3/4 |
|---|---|---|---|---|
| 1024 | 242 / 103 / 76 / 83 / 48 / 136 | **Expires 27, In stock 1** (FE-18) | 53 | 42/41/31/7 |
| 1280 | 383 / 142 / 104 / 113 / 66 / 136 | 0 | 3 | 78/41/3/0 |
| 1440 | 405 / 148 / 108 / 118 / 69 / 136 | 0 | 2 | 81/40/1/0 |
| 1920 | same as 1440 | 0 | 2 | 81/40/1/0 |

- Columns line up across every type table (one x-position per column).
- Expires is month-only, with the full date in `title`.
- Stepper is 124 px inside the 136 px column; Add is 88x44.
- Page overflow is 0.
- Stepper input text box is 28 px: "999" fits (26 px), "1000" (33 px) and "10000" (42 px) don't (FE-19).

**FE-18 / FE-19 re-verify** (tree at ≥1100, action column 148 px). Both categories, 0 overflowing cells at every width:

| Width | Supply / Maker / Lot / Exp / Stock / Qty (px) | Name lines 1/2/3/4 (needles) | Tree / Categories button | Header | Search box |
|---|---|---|---|---|---|
| 899 | (compact) | — | drawer | 113 px (2 rows) | 851 |
| 900 | 326 / 128 / 94 / 92 / 64 / 148 | 63/45/13/1 | drawer | 65 px | 164 |
| 1024 | 418 / 146 / 107 / 92 / 64 / 148 | 81/40/1/0 | drawer | 65 | — |
| 1099 | 474 / 158 / 116 / 92 / 64 / 148 | 83/39/0/0 | drawer | 65 | 363 |
| 1100 | 261 / 115 / 84 / 92 / 64 / 148 | 45/40/34/3 | tree | 65 | 526 |
| 1279 | 394 / 141 / 104 / 92 / 64 / 148 | 80/41/1/0 | tree | 65 | 605 |
| 1280 | 371 / 142 / 104 / 113 / 66 / 148 | 76/40/6/0 | tree | 65 | — |
| 1440 / 1920 | 393 / 148 / 108 / 118 / 69 / 148 | 80/41/1/0 | tree | 65 | 462+ |

- Columns line up across tables at every width, and page overflow is 0.
- Stepper input is 48 px: 99 through 10000 all fit (42 px max in a 46 px box).
- Landing cards are still equal height at 1440/1280/1100 (3 columns) and 1099/1000 (2 columns).
- Title is one line at 900-1920 ("Supply Requests" below 1180).
- Toggles all pass. Budget JS 73.9 / CSS 12.9 KB; Jest 409 passed / 2 skipped.
- Notes:
  - At 1100 the tree takes room, so Supply is 261 px and names reach 3-4 lines (37 rows on Needles & Syringes).
  - At 900 the search box is 164 px wide.

**Stepper follow-up** (input `min-width: 5.5ch`, buttons `flex: none`, action column 150 px): 0 overflowing cells in both categories at 900/1024/1099/1100/1179/1279/1280/1440/1920. Columns aligned, page overflow 0. Stepper is 138 px in the 150 px column: input 49 px, buttons 44x44 and 44x44. 99 through 10000 all fit (42 px of text in a 47 px box). Phone card layout at 360/375/600: stepper 260 px (input 170 px, buttons 44x44), Add 88x44, no overflow. Jest 409 passed / 2 skipped; budget JS 73.9 / CSS 12.9 KB.

**Tree at ≥1280** (Categories drawer at 900-1279; narrow column overrides at ≤1099). Both categories have 0 overflowing cells at every width; columns aligned; stepper 44x44 x2 fits; page overflow 0.

| Width | Supply / Maker / Lot / Exp / Stock / Qty | Name lines 1/2/3/4 (needles) | Tree | Header / search | Title |
|---|---|---|---|---|---|
| 899 | (compact) | — | drawer | 113 px / 851 | Supply Requests |
| 900 | 376 / 102 / 68 / 92 / 64 / 150 | 77/39/6/0 | drawer | 65 / 164 | Supply Requests |
| 1024 | 475 / 117 / 78 / 92 / 64 / 150 | 83/39/0/0 | drawer | 65 / — | Supply Requests |
| 1099 | 535 / 126 / 84 / 92 / 64 / 150 | 89/33/0/0 | drawer | 65 / 363 | Supply Requests |
| 1100 | 429 / 158 / 116 / 126 / 74 / 150 | 82/39/1/0 | drawer | 65 / 364 | Supply Requests |
| 1179 | 472 / 170 / 124 / 136 / 79 / 150 | 83/39/0/0 | drawer | 65 / 443 | Supply Requests |
| 1180 | — | — | drawer | 65 / 300 | full name |
| 1279 | 527 / 185 / 135 / 148 / 86 / 150 | 89/33/0/0 | drawer | 65 / 399 | full name |
| 1280 | 378 / 144 / 106 / 115 / 67 / 150 | 77/39/6/0 | tree | 65 / 562 | full name |
| 1440 / 1920 | 400 / 150 / 110 / 120 / 70 / 150 | 80/41/1/0 | tree | 65 / 602 | full name |

- Landing cards are 300 px each with 0 spread per row: 3 columns at 1100/1279/1280/1440, 2 at 1024, 1 at 360.
- Title is one line everywhere; toggles pass.
- Budget JS 73.9 / CSS 12.9 KB; Jest 409 passed / 2 skipped.
- The narrowest Supply column is now 376 px at 900 (it was 261 px at 1100 under the old breakpoint).

**System font stack** (Manrope removed; font budget set to 0, perf-timing allows 0 font requests):
- Budget: JS 73.9 / CSS 12.9 / sprite 6.4 KB, fonts 0 / 0.
- Load: cold 77 ms, warm 59 ms, warm with API +3 s 55 ms; search 103-111 ms; 0 font and 0 image requests; CLS 0.
- Every text node renders in system-ui with no FontFace loaded; tabular-nums kept. Weights in use: 400/500/600, plus 700 on 12-20 elements per page and one 650 on review (no 300).
- Tables: 0 overflow in Supply/Maker/Expires/In stock at 900-1920. Supply widths: 376 (900), 475 (1024), 535 (1099), 429 (1100), 472 (1179), 527 (1279), 378 (1280), 400 (1440+).
- **Qty: 1-2 cells per page overflow by 2 px** (FE-20).
- Title is one line, 24 px, 600 16px; header 65 px. Landing cards 300 px, 0 spread at 1440/1280/1180/1024/360; toggles pass.
- Jest 409 passed / 2 skipped.

**FE-20 fix + weight normalisation:**
- 0 overflowing cells in any column at 900-1920, and the qty probe finds nothing at 900/1440.
- Stepper is 138 px: input 48 px, buttons 44x44 x2. 99 through 10000 fit (44 px of text in 46 px).
- Weights are now only 400/500/600 on the landing, category, drawer, review (2 items), confirmation and My requests.
- Budget JS 73.9 / CSS 12.9 KB; Jest 409 passed / 2 skipped.

## Backend semantics change (N1/N2/N8/N9/N12)

I rewrote the 14 tests that encoded the old behaviour, and added new ones. pytest: 346 passed.
- **Holds.** Only **Approved** requests hold stock.
  - `test_under_review_holds_nothing`: availability is byte-identical after a submit.
  - The approved quantity fills same-named rows in order, first lot first. Two approved on rows of 3 and 4 gives `remaining` [1, 4]; two more gives [0, 3] and Requested/Limited.
  - Full-width / NFKC / casefold names match.
  - An approval for an unknown name changes nothing, and negative stock reads as 0.
  - Denied, Cancelled and Shipped all release the hold.
- **Lifecycle (sheet, DB, live sheet).**
  - Submit: 1 clinic + 1 HQ email.
  - The clinic email carries the request ID but no org name or item names; the HQ alert keeps the details.
  - Approved, a repeat Approved (no-op, no email), Shipped, then Delivered (5 emails in total). After that, Shipped/Approved/Denied/Cancelled each return 409.
- **Deny and cancel rules.**
  - Allowed from Under Review and from Approved.
  - 409 after Shipped and from Denied.
  - Only values outside the five statuses return 422 (Under Review, lowercase, DENIED, empty, null, Pending, Bogus).
- **ETag.** Unchanged (304) after a submit, and changes after Approved.
- **Strict `quantity`.** "5", true, false, 5.5, [5] and {"n":5} all return 422. Whole-number floats (5.0) also return 422; email-engineer is keeping that, since the UI always sends integers.
- **Email limits.** The confirmation cap (5 per client IP per hour) and the HQ digest (after 30 an hour) are covered by email-engineer's `tests/test_email.py`; I confirmed those 3 tests run and pass.
- **pytest:** 361 passed, 0 failed.

## Browser pass (McMaster layout)

Chrome against the local build and 1,137-row snapshot; 360px checks in an iframe.

| Check | Result |
|---|---|
| Landing: 12 categories, 890 products, type links, "54 unlabelled items aren't shown" footnote, 0 `<img>` | pass |
| Category tree: link sets `aria-current`, counts match | pass |
| Category page: h1, 10 type tiles + "Show all 20 types", 20 type sections, 126 product rows in `table.spec` | pass |
| Tile link `#/c/needles-and-syringes/needles` scrolls the section to the top and focuses it | pass |
| Multi-lot product: "9 lots" toggle (`aria-expanded`) shows 9 lot rows | pass |
| Search: "Results for ..." h1, Matching types, 26 rows; no-match empty state; clearing returns to the page | pass |
| Drawer: "Your request" dialog, focus on Close, 25 units of a 9-lot product; Review request closes it and goes to `#/review` | pass |
| Double-click Submit: 1 POST; FEFO split into lot lines 1 + 24 (checked via `/requests?email`) | pass; FE-13 / FE-14 found |
| Confirmation: h1 focused, ID, "1 supply, 25 units" | pass |
| My requests: request shown with the status track | pass |
| 360px: zero horizontal overflow on `#/`, category, type anchor, `#/item/2`, `#/slip`, `#/review`, `#/requests` | pass |
| 360px: 6 tiles; Categories drawer (13 links, focus on Close, Escape closes); table rows become labelled cards; no target under 44px | pass |
| Console | no app messages |
| Nits: long lot numbers wrapped mid-number; the empty `#/review` page had no h1 | fixed and re-verified (`white-space: nowrap`; h1 "Your request is empty") |

## Browser pass (Phase 2)

Setup: backend in sample mode with `SAMPLE_INVENTORY_PATH` pointed at the 1,137-row snapshot on 127.0.0.1:8765 (email vars blank, `HQ_API_TOKEN` local), and a `CI=true` build pointed at it, served on 127.0.0.1:3765. Desktop is 1243px wide; phone checks ran in a 360px iframe, since Chrome won't size a window that small.

| Check | Result |
|---|---|
| Catalog loads 1,137 supplies in the default list layout (In stock / Expires columns), chips with counts, "Show all 13 types" | pass |
| Search "gauze" gives 26 results; the first is Kerlix Roll | pass |
| Add turns into a stepper; typing 99999 caps at 20 in stock, and [+] is disabled at the cap | pass |
| Remove on the slip shows the toast "Removed ... from your request." with Undo; Undo restores the line in its old position | pass |
| Reload keeps the slip (2 lines, 21 units on the review page) | pass |
| `#/review` with empty fields: both field errors shown, focus moves to the name field, no POST sent | pass |
| Real 429 (local limit used up): "Too many requests from this connection..." shown, slip kept, button re-enabled | pass |
| Three rapid clicks on Submit send 1 POST (checked in the server log) | pass |
| Confirmation: focus on the h1, title "Request submitted", hex ID `REQ-<epoch>-<6 hex>`, item summary, email line, Print button | pass |
| My requests after HQ PATCHes Approved and then Shipped: track reads "Status: Shipped", earlier steps say ", done" | pass |
| Back button: My requests goes back to the confirmation | pass |
| "Expiring soonest" sort: expired rows show "Expired, can’t be requested" with no Add button | pass (FE-09/10 found and fixed) |
| 360px: no horizontal overflow; after Add the bar reads "1 supply added / View request" | pass |
| 360px: View request opens the sheet (labelled, focus on Close, body locked); Escape closes it and returns to `#/` | pass |
| 360px: a row title opens the `#/item/<row>` detail with location and lot facts; browser Back closes it | pass |
| 360px touch targets: steppers are 42px tall (2px under 44) | note |
| Preliminary pass (before the research changes): photos lazy-load, API down then Try again recovers, keyboard focus ring visible | pass |
| Final UI recheck: header logo link 67x44; one scrolling chip row with "Scroll types right" (tabIndex -1); picking the last chip "Other supplies" scrolls it into view and presses it | pass |
| Final UI recheck: header "Request 2" button appears on desktop after scrolling | pass |
| Final UI recheck: 360px and 390px iframes (inner 356/386) show zero horizontal overflow on `#/`, after Add, and on `#/slip`, `#/review`, `#/requests`, `#/item/2`; chips scroll inside their row; steppers 44px | pass |
| Final UI recheck: the backend now masks patient IDs ("Pt. ID [removed]") and no raw Pt. ID text renders | pass |
| Console (tracking attached before a reload) | no messages from the app |

## Browser pass (preliminary)

Setup: the 1,137-row sample served in sample mode on 127.0.0.1:8765, and a `CI=true` build pointed at it, served on 127.0.0.1:3765.

| Check | Result |
|---|---|
| Catalog loads all 1,137 supplies; chips show counts; Drive photos lazy-load (no broken images) | pass |
| Searching "telfa" narrows the list to 1 result with a matching chip count | pass |
| Add turns into a stepper; typing 99 caps at 16 in stock | pass |
| Phone width shows a bottom bar; "View slip" opens the sheet with focus on Close; Escape closes it and returns to `#/` | pass |
| Slip [+] after [-] (16 -> 15 -> +) | **fail: stays 15 (FE-04, since fixed; recheck in Phase 2)** |
| Checkout: double-clicking Send makes one POST (checked in the server log); confirmation shows the ID, Copy button and next steps | pass |
| My requests shows the new request as Under review; after an HQ PATCH to Approved, Refresh shows Approved | pass |
| Availability after the request: Telfa `remaining: 1`, Limited | pass |
| At 375px (iframe) the page has no horizontal overflow and no element wider than the viewport | pass |
| Keyboard Tab shows a visible focus ring on cards | pass |
| Backend stopped: "Couldn’t load the supply list" with Try again; backend restarted, then Try again loads 48 cards | pass |
| Console: no app errors or warnings (only an unrelated extension warning) | pass |
| Touch targets: the header logo link is 36px tall; card title links are 20px tall text buttons (the card's Add button is 44px) | note |

Chrome won't resize a window below about 500px, so the 375px checks ran in a 375px iframe. Media queries respond to the iframe's width.

## Speed gate (McMaster redesign)

Run on every build. All three are local only: the timing script refuses non-local hosts.

```sh
cd my-dashboard
CI=true npm run build && node scripts/check-budget.js          # gzip budgets + no web fonts
APP_URL=http://127.0.0.1:3765/ API_ORIGIN=http://127.0.0.1:8765 node scripts/perf-timing.js
cd .. && TEST_DATABASE_URL=postgresql:///b4p_test_qa .venv/bin/python -m pytest -q tests/test_perf_contract.py
```

| Budget | Limit | Last result (McMaster build, 1,137 rows → 890 products, local backend, headless Chrome) |
|---|---|---|
| JS, all chunks, gzip -9 | 75 KB | 73.6 KB, pass (1.9% headroom) |
| CSS gzip | 15 KB | 12.4 KB, pass |
| Icon sprite gzip (`src/productIcons/sprite.js`) | 12 KB | 5.5 KB, pass |
| Web fonts | none (system stack), external 0 | 0 / 0, pass (Manrope removed at the user's request) |
| First table row, cold, 1280px (`#/c/needles-and-syringes`, 126 products) | < 2,500 ms | 167 ms |
| First table row, warm | < 1,000 ms | 70 ms |
| Warm with the API delayed 3 s | < 1,000 ms | 78 ms (saved copy renders first) |
| Cold with the API delayed 3 s | none | 3,135 ms (expected) |
| Landing `#/` first category heading, cold / warm | none | 81 / 43 ms |
| 360px, 4x CPU: cold / warm / warm with API +3 s | < 2,500 / 1,000 / 1,000 ms | 286 / 170 / 158 ms |
| 360px, 4x CPU, Fast-3G network: cold / warm | none | 2,908 / 585 ms (pre-rebuild build) |
| Search to rendered results ("gauze" 26 rows, "syringe 10ml", no match), includes the 120 ms debounce | < 300 ms | 154 / 141 / 131 ms; 179 ms at 4x CPU |
| Image / font / external requests per load | 0 | 0 / 0 / 0 (7-8 requests in total) |
| CLS | < 0.1 | 0.000 on every load (FE-12 fixed) |
| API payloads, gzip | none | `/api/supplies` 96 KB (510 KB raw, Notes is 30%), `/inventory/availability` 29 KB |
| Backend contract | contract | 39/39 pass |

Options: `WIDTH=360`, `CPU=4`, `SLOW_NET=1`, `SEARCH=a,b`, `VERBOSE=1` (layout-shift sources), `PERF_JSON=out.json`.

## Bugs

| ID | Sev | Owner | Summary | Status |
|---|---|---|---|---|
| QA-01 | Medium | email-engineer | Legacy `POST /api/requests` echoed gspread error text in its 502 detail | Fixed, verified |
| QA-02 | Medium | email-engineer | Sheet read errors on `/api/supplies`, `/inventory/availability`, `/requests?email=` were a plain-text 500; now JSON 503 (quota) / 502 | Fixed, verified |
| QA-03 | Medium | email-engineer | Whitespace-only `item_name` accepted (sheet: 200 and held stock for all 28 blank-named rows; DB: 400) | Fixed, verified (422) |
| QA-04 | Low-Med | email-engineer | Sample-mode PATCH: unknown id 200, no no-op detection, no status email, backwards allowed | Fixed, verified |
| QA-05 | Medium | email-engineer | Live-sheet mode allowed Shipped -> Approved and emailed the clinic | Fixed, verified (409) |
| QA-06 | Medium | email-engineer | Review flag only computed in DB mode; sheet modes never told HQ about the 36 Review=Yes items | Fixed, verified |
| QA-07 | Low | email-engineer | Availability treated "12.0" as unknown stock | Fixed, verified |
| FE-01 | Low | frontend-engineer | `parseQuantity('12.0')` returns null ("Stock not listed") | Fixed, verified by Jest |
| FE-02 | Low | frontend-engineer | `parseExpiry` accepts impossible dates like 2027-02-30 | Fixed, verified by Jest |
| FE-03 | Medium | frontend-engineer | Request lines send the display name; for the 81 "Unknown"/blank-named rows that is "Gauze roll" / "Unnamed supply", which HQ can't trace to a row and availability never matches | Fixed, verified by Jest |
| FE-04 | Medium | frontend-engineer | Slip stepper [+] can never raise a quantity: `setQuantity(line, n)` caps at `line.quantity` | Fixed, verified by Jest |
| FE-05 | Low | frontend-engineer | `parseHash` throws on a malformed escape (`#/sent/%E0%A4%A`), blank page (same as bug-hunter's EXP-09) | Fixed, verified by Jest |
| FE-06 | Low | frontend-engineer | Loading the cart doesn't dedupe ids or cap at 100 lines / 10,000 units, so a tampered cart can submit duplicates | Fixed, verified by Jest |

| FE-07 | Medium | frontend-engineer | `applyAvailability` gave each duplicate-name row the name-pooled `remaining`, so a row with 3 showed and allowed 5 | Fixed (capped at row stock), verified by Jest |
| FE-08 | Low | frontend-engineer | Confirmation line rendered a stray space before the period after the email | Fixed, verified in code |
| FE-09 | Low | frontend-engineer | Expired rows also showed "Only N left" badges | Fixed, verified by Jest |
| FE-10 | Low | frontend-engineer | "Expiring soonest" listed the 43 expired rows first | Fixed (expired last), verified by Jest |
| FE-11 | Low | frontend-engineer | `nameFromNotes` turns placeholder notes ("N/A", "-", "none", "...") into item names, so junk rows escape the unlabelled filter | Fixed, verified |
| FE-12 | Medium | frontend-engineer | Cold load layout shift 0.122: the category tree column mounts after data arrives and pushes `.shop__main` from x=120 w=220 to x=380 w=1012 | Fixed, verified (CLS 0.000) |
| FE-13 | Medium | frontend-engineer / email-engineer | FEFO split one product into POST lines with identical item names, so HQ couldn't tell lots apart | Fixed, verified: lines read "Name [Lot X, Box Y, Pallet Z]"; backend strips the trailing suffix for availability and the review flag (tests in test_flows.py) |
| FE-14 | Low | frontend-engineer | Confirmation said "1 supply", My requests "2 supplies" for one FEFO-split request | Fixed, verified: both say "1 supply (2 lots), 25 units" |
| FE-15 | Low | frontend-engineer (from bug-hunter) | Category/type slugs could collide ("Gloves & Masks" vs "Gloves and Masks", non-ASCII names) | Fixed (`uniqueSlugs`), verified by Jest |
| FE-16 | Low | frontend-engineer (from bug-hunter) | `productKey` "|" collision; cart lines whose product vanished were silently dropped from the POST | Fixed, verified by Jest (stale-tab submit shows an inline error, 0 POSTs) |
| FE-17 | Low | frontend-engineer | Round 3: one 35-58 ms frame (41 ms on the final build) at 4x CPU near the top of the biggest category, likely `content-visibility: auto` sections rendering on entry (baseline worst 21 ms) | Fixed (content-visibility removed), verified: misc-surgical worst 19-23 ms at 4x in 5 runs |
| FE-18 | Low-Med | frontend-engineer | At 900-~1100 px (1024 measured) Expires (83 px) overflowed on "from Mon YYYY" (needs 109 px; 27 of 92 cells), and In stock (48 px) overflowed once | Fixed, verified: tree moved to ≥1100; Expires 92 / In stock 64 px at ≤1279; 0 overflowing cells at 900/1024/1099/1100/1279/1280/1440/1920 |
| FE-19 | Low-Med | frontend-engineer | Table stepper input was 34 px (28 px of text): quantities of 1000 or more (33-42 px) were clipped | Fixed, verified: input 5.5ch = 49 px (47 px of text), "10000" (42 px) fits; both stepper buttons a full 44x44 (they had shrunk to ~37 px); action column 150 px |
| FE-20 | Low | frontend-engineer | System font: the table stepper (44 + 5.5ch input + 44 = 152 px) stuck 2 px out of the 150 px Qty cell at every width | Fixed, verified: input min-width 0 → 48 px, stepper 138 px, 0 Qty overflow at 9 widths, "10000" (44 px) fits in 46 px |
| QA-09 | Low | email-engineer | `If-None-Match: *` returned 200 instead of 304 | Fixed, verified |
| QA-08 | Low | email-engineer | README and the run instructions say `USE_SAMPLE_DATA=1 uvicorn main:app`, but `sample_inventory.json` is missing and `*.json` is gitignored, so `/api/supplies` fails on a fresh clone | Fixed, verified (repo `sample_inventory.json`, `SAMPLE_INVENTORY_PATH`) |

Notes that are not bugs:

- Test data is fully synthetic now (`tests/fixtures/real_shape_supplies.py`, Jest rows): no real inventory rows in the repo.

- Data quality: 54 of the 1,137 live rows have a blank or "Unknown" Name, no General and no Subcategory, so they show as "Unnamed supply" under "Other supplies", with only a photo to identify them. HQ should fill these in the sheet.

- The API accepts quantities above stock and unknown item names; the UI caps at stock. A direct POST can over-request and mark an item On hold for every clinic (raised by bug-hunter). Decision: accepted risk (EXP-10, in the README), because HQ reviews every request; the backend will not check stock.
- Items with blank stock show as "Available" with `remaining: null` (unknown, not low). In the UI they can be requested up to 10,000.
- Concurrent pytest runs share and drop `b4p_test_external`; give each run its own `TEST_DATABASE_URL`.
- The email module's daily cap and per-address counters are process-wide; my test files reset them per test.

## How to verify a deploy

1. `curl -s $API/health`: expect `{"source": "postgres" | "sheet", "ok": true, "email": "brevo" | "resend"}`. `email: null` means nobody gets mail.
2. `curl -s $API/api/supplies | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))'`: about 1,137 rows.
3. `curl -s $API/inventory/availability | head -c 300`: JSON with `availability_status` and `remaining`.
4. Rate limiting: the backend trusts `X-Forwarded-For` automatically when `RENDER` is set. Verify once in the Render logs that rate-limit keys are real client IPs, not the proxy's.
5. `curl -si $API/requests | head -1`: 401 or 403, never 200 without the HQ token.
6. `curl -si -X OPTIONS -H 'Origin: https://<frontend host>' -H 'Access-Control-Request-Method: POST' $API/requests`: `access-control-allow-origin` echoes the frontend host. Repeat with a random origin: no header.
7. Open the frontend in a private window: photos load, chips show counts, search "syringe" narrows the list, and the console has no errors.
8. Add an item, reload, and check that it is still on the slip. Send one request to a test address you own. The confirmation shows a `REQ-` ID, the email arrives, and HQ gets the alert.
9. My requests with that email shows the request as Under review. HQ PATCHes it to Approved, then refresh: status and email update.
10. On a 375px-wide phone: the bottom bar appears after adding an item, the slip sheet opens, and Escape or the close button dismisses it.
11. Delete or ship the test request so it doesn't hold stock.
