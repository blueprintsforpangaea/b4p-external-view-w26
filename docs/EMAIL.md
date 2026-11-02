# Email maintainer guide

The backend sends three emails: a confirmation to the org when it submits a request,
an alert to HQ for the same request, and a status update to the org when HQ changes
the status. All code is in `app/services/email.py`.

## How it works

    POST /requests  ->  save request  ->  return response to the browser
                                     \->  (background) send_org_confirmation -> org
                                     \->  (background) send_hq_alert         -> HQ_EMAIL
    PATCH /requests/{id}/status -> save -> return -> (background) send_status_update -> org

    send() picks a provider from env vars:
        RESEND_API_KEY set?                 -> Resend HTTP API
        else BREVO_API_KEY set?             -> Brevo HTTP API
        else GMAIL_USER + GMAIL_APP_PASSWORD -> Gmail SMTP (local only)
        else                                -> log a warning, send nothing

Emails are sent after the response, so a slow or broken provider never slows or fails
a request. A failed email is logged (provider and HTTP status, never keys) and dropped;
it is not retried.

## Which provider

| Provider | Pick it when | Notes |
|---|---|---|
| Brevo | You have no custom domain (recommended) | Free tier (about 300 emails/day). Verify one sender address by clicking a link sent to a normal inbox. |
| Resend | You own a domain and can add DNS records | Free tier (about 100 emails/day). Sends only from a verified domain. |
| Gmail SMTP | Local development only | Render's free tier blocks SMTP ports 25/465/587, so this cannot work in production. |

Both HTTP providers use HTTPS, which Render allows.

## Set up on Render

1. Create a Brevo (or Resend) account and an API key.
   - Brevo: Senders, Domains & Dedicated IPs -> Senders -> add the address you want to send from and click the verification link. Then SMTP & API -> API keys -> create a key.
   - Resend: Domains -> add and verify your domain (DNS records). Then API Keys -> create a key.
2. In Render, open the backend service -> Environment and add:

| Name | Required? | Example | What it does |
|---|---|---|---|
| `BREVO_API_KEY` | One of Brevo/Resend | `xkeysib-...` | Selects Brevo. |
| `RESEND_API_KEY` | One of Brevo/Resend | `re_...` | Selects Resend (wins if both are set). |
| `EMAIL_FROM` | Yes | `Blueprints for Pangaea <requests@example.org>` | Sender. Must be the verified sender (Brevo) or on the verified domain (Resend). |
| `HQ_EMAIL` | Yes, for HQ alerts | `hq@example.org` | Receives new-request alerts. No default; unset means no alerts. Also the default Reply-To. |
| `EMAIL_REPLY_TO` | No | `help@example.org` | Where org replies go. Defaults to `HQ_EMAIL`. |
| `EMAIL_ON_SUBMIT` | No | `false` | `false` turns off the two submit emails. Default is on. Status emails are unaffected. |
| `EMAIL_DAILY_LIMIT` | No | `200` | Max emails sent per 24 hours across all mail. Default 200. |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Local only | `you@gmail.com`, app password | SMTP fallback for your laptop. |

3. Save. Render redeploys.

## Verify

- `python -m app.services.email check` shows the provider and any missing variables (reads `.env`).
- `python -m app.services.email test you@example.org` sends a real test email; exit code is non-zero on failure.
- `GET /health` returns `"email": "brevo"` (or `resend`, `smtp`, `null`). It shows the name only.
- Submit a request from the site with your own address and check both inboxes (org and HQ).

## Abuse limits

`POST /requests` is public and emails the address the submitter types, so there are two in-memory caps
(reset on restart):

- At most 3 confirmation emails per address per rolling hour, and 5 per client IP per hour. Address aliases
  count as one address: case, `+tag`, dots in Gmail addresses and `googlemail.com`.
- `EMAIL_DAILY_LIMIT` (default 200) emails per rolling 24 hours. Confirmations stop at 70% of it, so
  anonymous traffic cannot use up the status emails.
- HQ alerts (one fixed address) are not part of that budget, so a flood cannot blind HQ. After 30 alerts
  in an hour, the rest are folded into one digest email ("N more supply requests"). There is no timer or
  background thread (serverless has no long-lived process): the digest is sent by the next alert after
  the hour, or by any incoming request once an hour has passed since the last digest. Nothing guarantees
  delivery if the whole server gets no requests, or if the instance holding the count is recycled first;
  the requests themselves are always saved and visible in the HQ view.
- Confirmation and status emails are fixed templates: request ID, number of items and (for status) the
  new status. They never contain the org name, item names or categories, because they go to an address
  the submitter typed and could otherwise carry a phishing message. The HQ alert has the details.

When a cap is hit the request is still saved and the email is skipped with a logged warning.


On Vercel the abuse limits are per serverless instance (see [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md)), so
they are best-effort, softer than the numbers above, and the Vercel firewall rate-limit rule is the real
control. A shared counter (Upstash Redis or Vercel KV) is a possible future option. Email is also sent before the response there (waiting at most
5 seconds), because the function may be frozen once the response is sent.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/health` shows `"email": null` | No API key in the environment | Add `BREVO_API_KEY` or `RESEND_API_KEY` and redeploy. |
| Logs: "No email provider configured" | Same as above | Same as above. |
| Logs: `HTTP 401` or `403` from the provider | Wrong or revoked API key; Resend domain not verified | Create a new key; finish domain verification. |
| Logs: `HTTP 400` mentioning sender or from | `EMAIL_FROM` is not a verified sender | Verify that exact address (Brevo) or use an address on your verified domain (Resend). |
| Request works but no HQ alert | `HQ_EMAIL` not set | Set `HQ_EMAIL`. |
| No emails on submit, status emails work | `EMAIL_ON_SUBMIT=false` | Remove it or set it to `true`. |
| Emails land in spam | Unverified domain or generic sender | Use Resend with a verified domain (SPF/DKIM), or ask recipients to mark "not spam". |
| SMTP works locally, not on Render | Render blocks SMTP ports | Use Brevo or Resend there. |
| Confirmation not received | The address already got 3 confirmations in the last hour, or the daily cap was hit | Expected abuse protection (see below). The request is still saved and HQ is still alerted. Wait an hour, or raise `EMAIL_DAILY_LIMIT`. The log says which cap fired. |
| Status email not sent | Status did not actually change, or the org has no email on file | Expected; only real changes email. |

## Change the templates

All three are functions in `app/services/email.py`: `send_org_confirmation`, `send_hq_alert`,
`send_status_update`. Each builds an HTML body and a plain-text copy; edit both. The shared
layout (header colour, width) is `_wrap()`. Rules to keep:

- Escape every user-provided value with `_e(...)` in HTML. Never paste raw text into HTML, and keep submitter text out of mail that goes to the submitter (only the HQ alert shows it).
- Keep styles inline (email clients ignore `<style>` blocks).
- Pass subjects through `_subject()` so line breaks cannot inject headers.

After editing, run `python -m app.services.email test you@example.org`, then `pytest`.
Tests never send email: `tests/conftest.py` replaces `email._send` and clears all email variables.
