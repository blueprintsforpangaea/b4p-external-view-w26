# Deploy on Vercel (frontend and backend together)

One Vercel project serves the React app and the API from this repo. Every `git push` deploys both,
and the API is same-origin (no CORS, no separate server).

## How it fits together

    browser  ->  https://<project>.vercel.app/            static React build (my-dashboard/build)
             ->  https://<project>.vercel.app/api/...     api/index.py  (FastAPI from main.py)

- `vercel.json` builds the frontend with `REACT_APP_API_URL=/api` and rewrites `/api/*` to the
  function in `api/index.py`.
- `api/index.py` mounts the app from `main.py` under `/api`. So the frontend's `/api/supplies` is
  served at `/api/api/supplies`, `/requests` at `/api/requests`, `/health` at `/api/health`.
- `main.py` still runs on its own (`uvicorn main:app`) for local development.

## Environment variables

Add these in Vercel -> Project -> Settings -> Environment Variables. Scope: P = Production,
Pv = Preview, both = P and Pv.

| Name | Scope | What it is |
|---|---|---|
| `GOOGLE_CREDENTIALS_JSON` | P (Pv optional) | The whole service-account key JSON as one value. Sheet mode only. Leave it out of Preview to get demo data. |
| `GOOGLE_SHEET_ID` | P (Pv optional) | Inventory spreadsheet ID. Sheet mode only. |
| `REQUESTS_SHEET_ID` | P, optional | Separate spreadsheet for requests. Defaults to `GOOGLE_SHEET_ID`. |
| `DATABASE_URL` | P (Pv optional) | Postgres connection string (Supabase session-pooler URL). If set, the database is used instead of the sheet. |
| `HQ_API_TOKEN` | both | Secret for HQ-only endpoints (`X-HQ-Token` header). Unset means those endpoints return 403. |
| `BREVO_API_KEY` or `RESEND_API_KEY` | P | Email provider. See [EMAIL.md](EMAIL.md). Leave out of Preview. |
| `EMAIL_FROM` | P | Verified sender, e.g. `Blueprints for Pangaea <requests@example.org>`. |
| `HQ_EMAIL` | P | Receives new-request alerts. |
| `EMAIL_REPLY_TO`, `EMAIL_ON_SUBMIT`, `EMAIL_DAILY_LIMIT` | P, optional | See [EMAIL.md](EMAIL.md). |
| `PUBLIC_SHEET_READ` | P, optional | `1` reads the inventory through the sheet's public CSV export (no service-account key). The sheet must be shared "anyone with the link can view". |
| `INVENTORY_WORKSHEET_GID` or `INVENTORY_WORKSHEET_TITLE` | P, optional | Which inventory tab to read (its `gid` from the sheet URL, or its name). |
| `REQUESTS_WORKSHEET_TITLE` | P, optional | Name of the requests tab when the service account writes it. |
| `REQUESTS_WEBHOOK_URL`, `REQUESTS_WEBHOOK_SECRET` | P only | The Requests spreadsheet's own Apps Script deployment (from `requests-apps-script.gs`, made on that spreadsheet) and its secret. On Vercel each request goes to the "Requests" tab. Never put the temp sheet's URL here, and never set these in Preview. |

Vercel sets `VERCEL`, `VERCEL_ENV` (`production`, `preview`, `development`) by itself. Do not set
`USE_SAMPLE_DATA` or `TRUST_PROXY` in Vercel. The rate limit takes the client IP from Vercel's
`x-vercel-forwarded-for` header (which clients cannot set), then the last `X-Forwarded-For` hop, then the socket address.
The API docs (`/api/docs`) are off on Vercel; `ENABLE_API_DOCS=1` turns them on.

You need `DATABASE_URL` in Production: clinics sign in to send a request, and accounts are kept
only in the database when deployed (without it, sign-in answers "Accounts aren’t available right now"). The
inventory comes from the database, or from the sheet (`GOOGLE_CREDENTIALS_JSON` + `GOOGLE_SHEET_ID`,
or `PUBLIC_SHEET_READ=1` + `GOOGLE_SHEET_ID`).

Never set `B4P_QA` on Vercel: it switches the request sheet off (it is for test and QA runs).

## Safety behaviour

- **Previews are always sandboxed:** with `VERCEL_ENV=preview` the app uses `sample_inventory.json`, keeps
  requests in memory and sends no email, even if `DATABASE_URL`, Google credentials or email keys are
  visible to Preview. `PREVIEW_ALLOW_REAL_DATA=true` turns the sandbox off; don't. Still scope
  `DATABASE_URL`, `GOOGLE_CREDENTIALS_JSON` and the email keys to Production only.
- **Production never uses demo data:** with no `DATABASE_URL` and no credentials, every endpoint
  (including `/api/health`) returns `503 Server is not configured`. `USE_SAMPLE_DATA` is ignored in
  production.
- **Email:** the function can be frozen as soon as the response is sent, so email is sent before
  responding, in parallel, waiting at most 5 seconds in total. A failing or slow provider never
  fails the request.

## Required: rate-limit rule in the Vercel firewall

The app's own rate limits live in memory, so each serverless instance counts separately. The real
control for the public submit endpoint is Vercel's:

Vercel -> Project -> Firewall -> Rate limiting rule: paths `/api/requests` and `/api/api/requests`
(the org endpoint and the internal one, which is also HQ-token only), method `POST`,
10 requests per minute per IP, action deny (429). Do the same for `GET /api/requests` if your plan
allows several rules (the lookup limit is 20 per minute per IP in the app).

If your plan has no firewall rate limiting, ask for a database function
`rate_limit_hit(key, limit, window_seconds)` to be added to the DB contract, and wire it into
`_check_rate` in `main.py`. Do not add tables from here.

On Vercel, `X-Forwarded-For` holds the real client IP (Vercel replaces what the client sent), so the
app's last-hop rule is correct there.

## Known limitations

- **The in-memory limits are best-effort on serverless.** Each instance counts on its own, so the real
  protection is the firewall rule above. A shared counter (Upstash Redis or Vercel KV) is a possible
  future option; there is no such dependency today.

- The inventory cache (60 seconds) is per instance too. That only costs extra Sheets reads.
- Function limit: `maxDuration` is 15 seconds (set in `vercel.json`).

## Deploy and verify

1. Import the repo in Vercel (root directory = repo root; the build settings come from `vercel.json`).
2. Add the variables above and redeploy.
3. Open `https://<project>.vercel.app/api/health`. Expect
   `{"source": "...", "ok": true, "email": "brevo"}`. A `503` means the production variables are
   missing. `"email": null` means no email provider key is set.
4. Open the site, check the inventory loads, and submit a test request with your own address.
5. Check the function logs (Vercel -> Deployments -> Functions) for `Email via ... failed` lines.

The old Render service can stay up until you have checked this; the frontend no longer calls it
once `REACT_APP_API_URL=/api` is built in. The CSP in `vercel.json` still allows the Render origin
until you remove it.
