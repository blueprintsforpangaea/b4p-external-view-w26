"""Outgoing email: one send() function, three providers, three templates.

Provider is picked from env vars (first match wins):
  RESEND_API_KEY              -> Resend HTTP API   (works on Render)
  BREVO_API_KEY               -> Brevo HTTP API    (works on Render)
  GMAIL_USER + GMAIL_APP_PASSWORD -> Gmail SMTP    (local dev only; Render blocks SMTP)
Nothing set -> a warning is logged and nothing is sent.

See docs/EMAIL.md. CLI:  python -m app.services.email check | test you@example.org
"""
import json
import logging
import os
import re
import smtplib
import sys
import time
import urllib.error
import urllib.request
from email.message import EmailMessage
from email.utils import parseaddr
from html import escape as _e

logger = logging.getLogger(__name__)

TIMEOUT = 10  # seconds; providers are called from background tasks, but never hang forever
BRAND = "#0337a3"
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


# --- configuration -------------------------------------------------------------

def provider_name() -> "str | None":
    """'resend' | 'brevo' | 'smtp' | None, based on which env vars are set."""
    if _env("RESEND_API_KEY"):
        return "resend"
    if _env("BREVO_API_KEY"):
        return "brevo"
    if _env("GMAIL_USER") and _env("GMAIL_APP_PASSWORD"):
        return "smtp"
    return None


def _hq_email() -> str:
    return _env("HQ_EMAIL")  # no default: unset means no HQ alerts


def _sender() -> str:
    # SMTP falls back to the Gmail address; Gmail rewrites other From addresses anyway.
    return _env("EMAIL_FROM") or _env("GMAIL_USER")


def _reply_to() -> str:
    return _env("EMAIL_REPLY_TO") or _hq_email()


# --- abuse limits ----------------------------------------------------------------
# POST /requests is public and emails whatever address is typed in, so cap the damage.
# In memory like the request rate limiter: resets on restart, per server instance.

CONFIRMATIONS_PER_ADDRESS = 3  # per rolling hour
_sent_at: list[float] = []  # every outgoing email, for the daily cap
_confirmed: dict[str, list[float]] = {}  # address -> confirmation times
_submit_mail_times: list[float] = []  # mail caused by anonymous submissions (confirmation + alert)
# Share of the daily cap anonymous confirmations may use. The rest is kept for status mail.
# HQ alerts (one fixed address) are NOT part of this budget, so a flood can't blind HQ.
CONFIRMATION_SHARE = 0.7
CONFIRMATIONS_PER_IP = 5  # per rolling hour
ALERTS_PER_HOUR = 30  # more than this are folded into one hourly digest
_confirmed_by_ip: dict[str, list[float]] = {}
_alert_times: list[float] = []
_alerts_pending = 0  # alerts held back since the last digest
_last_digest_at = 0.0


def reset_limits() -> None:
    _sent_at.clear()
    _confirmed.clear()
    _submit_mail_times.clear()
    _confirmed_by_ip.clear()
    _alert_times.clear()
    global _alerts_pending, _last_digest_at
    _alerts_pending, _last_digest_at = 0, 0.0


def _daily_limit() -> int:
    try:
        return int(_env("EMAIL_DAILY_LIMIT") or 200)
    except ValueError:
        return 200


def _under_daily_limit() -> bool:
    """True (and counts this email) if we are still under EMAIL_DAILY_LIMIT in the last 24h."""
    now = time.time()
    _sent_at[:] = [t for t in _sent_at if now - t < 86400]
    if len(_sent_at) >= _daily_limit():
        return False
    _sent_at.append(now)
    return True


def _address_key(address: str) -> str:
    """Collapse aliases that reach the same inbox (case, +tag, Gmail dots, googlemail)."""
    local, _, domain = address.strip().lower().rpartition("@")
    domain = domain.rstrip(".")
    local = local.split("+")[0]
    if domain in ("gmail.com", "googlemail.com"):
        domain, local = "gmail.com", local.replace(".", "")
    return f"{local}@{domain}"


def _under_submit_budget(share: float) -> bool:
    """Anonymous submissions may use only part of the daily cap, so they can't starve status mail."""
    now = time.time()
    _submit_mail_times[:] = [t for t in _submit_mail_times if now - t < 86400]
    if len(_submit_mail_times) >= int(_daily_limit() * share):
        return False
    _submit_mail_times.append(now)
    return True


def _ip_confirmation_allowed(client_ip: str) -> bool:
    """True (and counts it) if this client IP caused fewer than 5 confirmations in the last hour."""
    if not client_ip:
        return True
    now = time.time()
    recent = [t for t in _confirmed_by_ip.get(client_ip, []) if now - t < 3600]
    if len(recent) >= CONFIRMATIONS_PER_IP:
        _confirmed_by_ip[client_ip] = recent
        return False
    _confirmed_by_ip[client_ip] = recent + [now]
    if len(_confirmed_by_ip) > 10000:  # keep memory bounded
        for k in [k for k, v in _confirmed_by_ip.items() if not v or now - v[-1] >= 3600]:
            del _confirmed_by_ip[k]
    return True


def _confirmation_allowed(address: str) -> bool:
    """True (and counts it) if this address got fewer than 3 confirmations in the last hour."""
    now = time.time()
    key = _address_key(address)
    recent = [t for t in _confirmed.get(key, []) if now - t < 3600]
    if len(recent) >= CONFIRMATIONS_PER_ADDRESS:
        _confirmed[key] = recent
        return False
    _confirmed[key] = recent + [now]
    if len(_confirmed) > 10000:  # keep memory bounded
        for k in [k for k, v in _confirmed.items() if not v or now - v[-1] >= 3600]:
            del _confirmed[k]
    return True


# --- sending -------------------------------------------------------------------

def _post_json(url: str, headers: dict, payload: dict) -> None:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        # Some providers (Resend, behind Cloudflare) reject urllib's default User-Agent.
        headers={"Content-Type": "application/json", "User-Agent": "b4p-backend/1.0", **headers},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT):
        pass  # urlopen raises HTTPError for non-2xx, so reaching here means success


def _send_resend(to, subject, html, text) -> None:
    payload = {"from": _sender(), "to": to, "subject": subject, "html": html, "text": text}
    if _reply_to():
        payload["reply_to"] = _reply_to()
    _post_json("https://api.resend.com/emails",
               {"Authorization": f"Bearer {_env('RESEND_API_KEY')}"}, payload)


def _send_brevo(to, subject, html, text) -> None:
    name, address = parseaddr(_sender())
    payload = {
        "sender": {"name": name, "email": address} if name else {"email": address},
        "to": [{"email": r} for r in to],
        "subject": subject,
        "htmlContent": html,
        "textContent": text,
    }
    if _reply_to():
        payload["replyTo"] = {"email": parseaddr(_reply_to())[1]}
    _post_json("https://api.brevo.com/v3/smtp/email", {"api-key": _env("BREVO_API_KEY")}, payload)


def _send_smtp(to, subject, html, text) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = _sender()
    msg["To"] = ", ".join(to)
    if _reply_to():
        msg["Reply-To"] = _reply_to()
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=TIMEOUT) as smtp:
        smtp.starttls()
        smtp.login(_env("GMAIL_USER"), _env("GMAIL_APP_PASSWORD"))
        smtp.send_message(msg)


_PROVIDERS = {"resend": _send_resend, "brevo": _send_brevo, "smtp": _send_smtp}


def _send(to, subject: str, html: str, text: "str | None" = None) -> bool:
    """Deliver one email with the configured provider. May raise; send() catches.

    This is the single hook tests replace, so no test can reach the network.
    """
    name = provider_name()
    if not name:
        logger.warning("No email provider configured (see docs/EMAIL.md) - not sending.")
        return False
    recipients = [to] if isinstance(to, str) else list(to)
    _PROVIDERS[name](recipients, _subject(subject), html, text or _strip_tags(html))
    return True


def send(to: "str | list[str]", subject: str, html: str, text: "str | None" = None,
         counts_toward_daily_limit: bool = True) -> bool:
    """Send one email. Returns True if the provider accepted it. Never raises."""
    if counts_toward_daily_limit and not _under_daily_limit():
        logger.warning("EMAIL_DAILY_LIMIT (%s) reached - not sending '%s'.", _daily_limit(), _subject(subject))
        return False
    try:
        return _send(to, subject, html, text) is not False
    except urllib.error.HTTPError as exc:
        # Log status and the provider's error body, never headers or keys.
        body = exc.read().decode("utf-8", "replace")[:300]
        logger.error("Email via %s failed: HTTP %s %s", provider_name(), exc.code, body)
    except Exception as exc:
        logger.error("Email via %s failed: %s: %s", provider_name(), type(exc).__name__, exc)
    return False


# --- templates -----------------------------------------------------------------

def _subject(text: str) -> str:
    """Header-safe single line (no CR/LF injection)."""
    return " ".join(str(text).split())


def _strip_tags(html: str) -> str:
    """Fallback plain text if a caller gives none."""
    return re.sub(r"<[^>]+>", "", html)


def _no_links(text: str) -> str:
    """Remove URLs and bare domains from submitter-typed text we mail to a third party.

    The confirmation goes to whatever address the submitter typed, so it must not be able to
    carry a phishing link in our branded email.
    """
    return re.sub(r"(?i)\b(?:https?://|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b\S*",
                  "[link removed]", str(text))


def _item_label(item: dict, plain: bool = False) -> str:
    key = str(item.get("inventory_key", "")).strip()
    name = _no_links(item["item_name"]) if plain else item["item_name"]
    return f"{name}{f' [Key: {key}]' if key else ''} ({item['category']}) x {item['quantity']}"


def _items_html(items: list[dict], plain: bool = False) -> str:
    rows = "".join(f'<li style="margin:0 0 6px;">{_e(_item_label(i, plain))}</li>' for i in items)
    return f'<ul style="padding-left:20px;margin:0 0 16px;">{rows}</ul>'


def _items_text(items: list[dict], plain: bool = False) -> str:
    return "\n".join(f"- {_item_label(i, plain)}" for i in items)


def _wrap(title: str, body: str) -> str:
    """Shared branded layout. Inline styles only: email clients ignore <style> blocks."""
    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f6fb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;"><tr><td align="center" style="padding:16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;">
<tr><td style="background:{BRAND};color:#ffffff;padding:16px 24px;font-size:18px;font-weight:bold;border-radius:8px 8px 0 0;">Blueprints for Pangaea</td></tr>
<tr><td style="padding:24px;">
<h1 style="font-size:20px;margin:0 0 16px;color:{BRAND};">{_e(title)}</h1>
{body}
</td></tr>
</table>
</td></tr></table>
</body></html>"""


def send_org_confirmation(org_name: str, org_email: str, items: list[dict], request_id: str,
                          client_ip: str = "") -> bool:
    """Confirmation to the requesting org right after submission.

    It goes to an address the submitter typed, so it is a FIXED template: no org name, item
    names or categories (they could carry a phishing message in our branded email).
    """
    if not _ip_confirmation_allowed(client_ip):
        logger.warning("Too many confirmations caused by one client IP in the last hour - skipping.")
        return False
    if not _confirmation_allowed(org_email):
        logger.warning("Already sent %s confirmations to this address in the last hour - skipping.",
                       CONFIRMATIONS_PER_ADDRESS)
        return False
    if not _under_submit_budget(CONFIRMATION_SHARE):
        logger.warning("Confirmation share of EMAIL_DAILY_LIMIT used up - skipping confirmation.")
        return False
    lines = len(items)
    html = _wrap("We received your request", f"""
<p>Thanks for your supply request.</p>
<p style="margin:0 0 4px;"><strong>Request ID:</strong> {_e(str(request_id))}</p>
<p style="margin:0 0 16px;"><strong>Items requested:</strong> {lines}</p>
<p><strong>What happens next:</strong> our team will check availability and reply
within 48 hours. You will get another email when the status changes. You can see the
details any time under <strong>My requests</strong> on the dashboard.</p>
<p>If you didn't request this, you can ignore this email.</p>
<p>Thank you,<br><strong>Blueprints HQ</strong></p>""")
    text = (f"Thanks for your supply request.\n\nRequest ID: {request_id}\nItems requested: {lines}\n\n"
            "What happens next: our team will check availability and reply within 48 hours. "
            "You will get another email when the status changes. You can see the details any time "
            "under My requests on the dashboard.\n\n"
            "If you didn't request this, you can ignore this email.\n\nThank you,\nBlueprints HQ")
    return send(org_email, "Your supply request has been received - Blueprints HQ", html, text)


def send_hq_alert(org_name: str, org_email: str, items: list[dict], request_id: str,
                  review_flagged: list[str]) -> bool:
    """Internal alert to HQ_EMAIL for a new request. Skipped when HQ_EMAIL is unset."""
    hq = _hq_email()
    if not hq:
        logger.warning("HQ_EMAIL not set - skipping HQ alert.")
        return False
    if not _alert_slot_free(hq):
        return False
    flagged_html = flagged_text = ""
    if review_flagged:
        lis = "".join(f"<li>{_e(str(n))}</li>" for n in review_flagged)
        flagged_html = (f'<p style="color:#c0392b;"><strong>Manual review required</strong> before '
                        f'approval:</p><ul style="color:#c0392b;padding-left:20px;">{lis}</ul>')
        flagged_text = "\n\nMANUAL REVIEW REQUIRED before approval:\n" + "\n".join(
            f"- {n}" for n in review_flagged)
    html = _wrap("New supply request", f"""
<p style="margin:0 0 4px;"><strong>Organization:</strong> {_e(str(org_name))}</p>
<p style="margin:0 0 4px;"><strong>Email:</strong> {_e(str(org_email))}</p>
<p style="margin:0 0 16px;"><strong>Request ID:</strong> {_e(str(request_id))}</p>
<p style="margin:0 0 8px;"><strong>Items:</strong></p>
{_items_html(items)}
{flagged_html}""")
    text = (f"New supply request\n\nOrganization: {org_name}\nEmail: {org_email}\n"
            f"Request ID: {request_id}\n\nItems:\n{_items_text(items)}{flagged_text}")
    ok = send(hq, _subject(f"New supply request from {_no_links(org_name)}"), html, text,
              counts_toward_daily_limit=False)
    _flush_digest_if_quiet(hq)
    return ok


def _alert_slot_free(hq: str) -> bool:
    """HQ alerts bypass the daily cap, but after 30 an hour the rest become one digest email."""
    global _alerts_pending, _last_digest_at
    now = time.time()
    _alert_times[:] = [t for t in _alert_times if now - t < 3600]
    if len(_alert_times) < ALERTS_PER_HOUR:
        _alert_times.append(now)
        return True
    _alerts_pending += 1
    if now - _last_digest_at >= 3600:  # at most one digest per hour
        _send_digest(hq)
    return False


def _flush_digest_if_quiet(hq: str) -> None:
    """Alerts are flowing again: tell HQ about any that were held back."""
    if _alerts_pending:
        _send_digest(hq)


def digest_due() -> bool:
    """Held-back alerts exist and an hour has passed since the last digest. Cheap, no I/O."""
    return bool(_alerts_pending) and bool(_hq_email()) and time.time() - _last_digest_at >= 3600


def flush_digest_if_due() -> None:
    """Send the held-back summary. There is no timer or thread (serverless has no long-lived
    process), so the app calls this on incoming requests and after the next alert."""
    if digest_due():
        _send_digest(_hq_email())


def _send_digest(hq: str) -> None:
    global _alerts_pending, _last_digest_at
    count, _alerts_pending, _last_digest_at = _alerts_pending, 0, time.time()
    html = _wrap("More supply requests", f"""
<p>{count} more supply request(s) arrived after the hourly limit of {ALERTS_PER_HOUR} individual alerts.</p>
<p>Open the HQ view to see them all.</p>""")
    text = (f"{count} more supply request(s) arrived after the hourly limit of {ALERTS_PER_HOUR} "
            "individual alerts. Open the HQ view to see them all.")
    send(hq, f"{count} more supply request(s) - Blueprints HQ", html, text, counts_toward_daily_limit=False)


def send_status_update(org_name: str, org_email: str, status: str, items: list[dict],
                       request_id: str = "") -> bool:
    """Tell the org their request changed status. Fixed template, no free text from the submitter."""
    lines = len(items)
    ref = f" ({_e(str(request_id))})" if request_id else ""
    html = _wrap("Your request was updated", f"""
<p>Your supply request{ref} is now <strong>{_e(str(status))}</strong>.</p>
<p style="margin:0 0 16px;"><strong>Items in this request:</strong> {lines}</p>
<p>See the details under <strong>My requests</strong> on the dashboard. If you have questions,
just reply to this email.</p>
<p>Thank you,<br><strong>Blueprints HQ</strong></p>""")
    text = (f"Your supply request{f' ({request_id})' if request_id else ''} is now {status}.\n"
            f"Items in this request: {lines}\n\nSee the details under My requests on the dashboard. "
            "If you have questions, just reply to this email.\n\nThank you,\nBlueprints HQ")
    return send(org_email, _subject(f"Update on your supply request - {status}"), html, text)


# --- CLI -----------------------------------------------------------------------

def _check() -> int:
    name = provider_name()
    print(f"Provider: {name or 'none (emails will NOT be sent)'}")
    wanted = {
        "resend": ["RESEND_API_KEY", "EMAIL_FROM"],
        "brevo": ["BREVO_API_KEY", "EMAIL_FROM"],
        "smtp": ["GMAIL_USER", "GMAIL_APP_PASSWORD"],
    }
    if name:
        missing = [v for v in wanted[name] if not (_env(v) or (v == "EMAIL_FROM" and _env("GMAIL_USER")))]
    else:
        missing = ["RESEND_API_KEY or BREVO_API_KEY (or GMAIL_USER + GMAIL_APP_PASSWORD for local dev)"]
    missing += [v for v in ("HQ_EMAIL",) if not _env(v)]
    print("Missing: " + (", ".join(missing) if missing else "nothing"))
    print(f"Reply-To: {_reply_to() or '(not set)'}")
    return 0 if name else 1


def _test(to: str) -> int:
    html = _wrap("Test email", "<p>If you can read this, email is working.</p>")
    ok = send(to, "Test email - Blueprints HQ", html, "Test email. If you can read this, email is working.")
    print(f"Sent via {provider_name()} to {to}" if ok else "FAILED - see log lines above")
    return 0 if ok else 1


def main(argv: list[str]) -> int:
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if argv[:1] == ["check"]:
        return _check()
    if len(argv) == 2 and argv[0] == "test":
        return _test(argv[1])
    print("usage: python -m app.services.email check | test you@example.org")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
