# B4P External View

React dashboard (`my-dashboard/`) + FastAPI backend (`main.py`). Both deploy together on Vercel (the API runs
as a serverless function from `api/index.py`): see [docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md). Locally,
run the backend with `uvicorn main:app`.

## Data source

By default the backend reads inventory from the Google Sheet and stores external
org requests in the Requests tab of the sheet.

Set the `DATABASE_URL` environment variable (a Postgres connection string; on
Render use the Supabase session-pooler URL) to switch to the Postgres database
instead. Unset it to go back to the sheet. Nothing else changes.

With `DATABASE_URL` set:

- `GET /api/supplies` and `GET /inventory/availability` read the `dash_supplies` view.
- `POST /requests`, `PATCH /requests/{id}/status` and `GET /requests[?email=]` use
  `create_request()`, `set_request_status()` and the `dash_requests` view.
- Internal clinic requests (`GET` and `POST /api/requests`, served as `/api/api/requests` on Vercel) are not affected
  and still use the sheet. Both are HQ-only (`X-HQ-Token`), and the POST is also rate limited per IP. The web UI does not call them.
- `GET /health` returns `{"source": "postgres"|"sheet", "ok": true|false, "email": "brevo"|"resend"|"smtp"|null}`.

All database access lives in `app/db.py` (views and functions are defined by the
database's dashboard contract; do not query other tables from here).

To import an old `org_requests.json` into the database (safe to re-run):

    DATABASE_URL=... python scripts/migrate_org_requests_to_db.py org_requests.json [--dry-run]

`USE_SAMPLE_DATA=1` runs the API on `sample_inventory.json` (a small demo inventory in the repo, with requests kept in memory);
set `SAMPLE_INVENTORY_PATH` to use a different file.

## Access control and limits

- `GET /requests?email=<address>` (what the dashboard uses) returns only that exact address's lines
  (case-insensitive). Listing all requests, and `PATCH /requests/{id}/status`, are HQ-only: set
  the `HQ_API_TOKEN` env var on Render and send it as the `X-HQ-Token` header. If `HQ_API_TOKEN`
  is unset these endpoints return 403. The web UI does not call them today; HQ uses curl, e.g.
  `curl -H "X-HQ-Token: $TOKEN" -X PATCH -H 'content-type: application/json' -d '{"status":"Shipped"}' $API/requests/REQ-.../status`.
- Status emails are sent only when the status actually changes; all user text in emails is HTML-escaped.
- Rate limiting uses the real client IP from `X-Forwarded-For` (last hop) only when behind a trusted proxy:
  this is on automatically on Render (it sets `RENDER`). `TRUST_PROXY=1` forces it on elsewhere and
  `TRUST_PROXY=0` forces it off, since clients can fake that header. IPv6 clients share one bucket per /64, and the
  limiter table is capped at 10,000 entries. One warning is logged if the
  header arrives while trust is off.
- Accepted risk: `POST /requests` does not check item names against inventory or requested quantity against stock, because HQ reviews every request.
- `GET /requests?email=` is limited to 20 lookups per IP per minute (separate from the POST limit).
- `POST /requests`: max 100 lines, quantity 1-10000, valid email, 10 requests/min per IP
  (in-memory, see `rate_limit_post` in `main.py`; delete it to remove).
- Availability = stock minus what HQ has **Approved**, matched by normalized item name (case, spacing
  and Unicode variants match; a name used by several inventory rows is applied to them in order).
  Under Review requests hold nothing, because anyone can submit one. 5 or fewer left is "Limited",
  0 left with an approval is "Requested". Shipped requests are not counted; HQ is expected to reduce
  the inventory quantity when something ships. Negative quantities count as 0.

## Performance

- Responses over 1 KB are gzipped (`GZipMiddleware`); `/api/supplies` is about 134 KB raw in production.
- `GET /api/supplies` and `GET /inventory/availability` send `Cache-Control: public, max-age=60,
  stale-while-revalidate=300` and a weak `ETag` (hash of the body). A request with a matching
  `If-None-Match` gets an empty `304`. Availability can therefore lag a new request by up to a minute.
- After HQ changes a status, that server instance drops its inventory cache at once. Other instances catch up within
  60 seconds, and browsers or the CDN may keep the cached availability for up to 60 seconds.
- `GET /requests` sends `Cache-Control: no-store` because it is per-clinic data.
- `/api/supplies` leaves out the `Image URL` field (photos are not shown and can show patient labels).
- In sheet mode the inventory read is also cached server-side for 60 seconds (`INVENTORY_CACHE_SECONDS` in `main.py`).

## Known limitation on serverless

The in-memory rate limits and email caps are per serverless instance (Vercel starts several and recycles them),
so they are softer than the numbers above. Durable counters in Postgres would fix that.

## Tests

    pip install -r requirements.txt pytest
    createdb -T b4p_v2 b4p_test_external   # throwaway copy of the database
    pytest                                  # DB tests skip if the test DB is missing

Tests never send email.

## Email

Submitting a request emails a confirmation to the org and an alert to HQ; status changes email the org.
Sent in the background via Brevo or Resend (HTTP; Render blocks SMTP). Env vars: `BREVO_API_KEY` or
`RESEND_API_KEY`, `EMAIL_FROM`, `HQ_EMAIL`, optional `EMAIL_REPLY_TO`, `EMAIL_ON_SUBMIT`. Setup, testing
and troubleshooting: [docs/EMAIL.md](docs/EMAIL.md). Template in `.env.example`.
