import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587


def _item_key_suffix(item: dict) -> str:
    key = str(item.get("inventory_key", "")).strip()
    return f" [Key: {key}]" if key else ""


def _send(to: "str | list[str]", subject: str, html: str) -> None:
    """Send an HTML email via Gmail SMTP (App Password auth)."""
    user = os.environ.get("GMAIL_USER", "").strip()
    password = os.environ.get("GMAIL_APP_PASSWORD", "").strip()

    if not user or not password:
        logger.warning("GMAIL_USER or GMAIL_APP_PASSWORD not set — skipping email.")
        return

    recipients = [to] if isinstance(to, str) else to

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = user
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as smtp:
        smtp.starttls()
        smtp.login(user, password)
        smtp.sendmail(user, recipients, msg.as_string())


def _hq_email() -> str:
    return os.environ.get("HQ_EMAIL", "").strip()


def send_org_confirmation(
    org_name: str,
    org_email: str,
    items: list[dict],
    request_id: str,
) -> None:
    """Confirmation email to the requesting org after submission."""
    items_html = "".join(
        f"<li><strong>{item['item_name']}</strong>{_item_key_suffix(item)} "
        f"(Category: {item['category']}) — Qty: {item['quantity']}</li>"
        for item in items
    )
    html = f"""
<p>Hi {org_name},</p>
<p>We've received your supply request (<strong>{request_id}</strong>).
Here is a summary of what was submitted:</p>
<ul>
{items_html}
</ul>
<p>Our team at Blueprints HQ will follow up within <strong>48 hours</strong>
to confirm availability and next steps.</p>
<p>Thank you,<br><strong>Blueprints HQ</strong></p>
"""
    try:
        _send(
            to=org_email,
            subject="Your supply request has been received — Blueprints HQ",
            html=html,
        )
    except Exception as exc:
        logger.error("send_org_confirmation failed: %s", exc)


def send_hq_alert(
    org_name: str,
    org_email: str,
    items: list[dict],
    timestamp: str,
    review_flagged: list[str],
) -> None:
    """Internal alert to HQ when a new org request is submitted."""
    hq = _hq_email()
    if not hq:
        logger.warning("HQ_EMAIL not set — skipping HQ alert.")
        return

    items_html = "".join(
        f"<li><strong>{item['item_name']}</strong>{_item_key_suffix(item)} "
        f"(Category: {item['category']}) — Qty: {item['quantity']}</li>"
        for item in items
    )

    warning_section = ""
    if review_flagged:
        flagged_html = "".join(f"<li>{name}</li>" for name in review_flagged)
        warning_section = f"""
<hr>
<p><strong style="color:#c0392b;">&#9888; WARNING — Manual Review Required</strong><br>
The following items are flagged and must be manually verified before approval:</p>
<ul style="color:#c0392b;">
{flagged_html}
</ul>
"""

    html = f"""
<p><strong>New supply request received.</strong></p>
<table cellpadding="4">
  <tr><td><strong>Org Name:</strong></td><td>{org_name}</td></tr>
  <tr><td><strong>Org Email:</strong></td><td>{org_email}</td></tr>
  <tr><td><strong>Timestamp:</strong></td><td>{timestamp}</td></tr>
</table>
<p><strong>Items Requested:</strong></p>
<ul>
{items_html}
</ul>
{warning_section}
"""
    try:
        _send(
            to=hq,
            subject=f"New supply request from {org_name}",
            html=html,
        )
    except Exception as exc:
        logger.error("send_hq_alert failed: %s", exc)


def send_status_update(
    org_name: str,
    org_email: str,
    status: str,
    items: list[dict],
) -> None:
    """Status update email to the org when their request is Approved or Shipped."""
    items_html = "".join(
        f"<li><strong>{item['item_name']}</strong>{_item_key_suffix(item)} "
        f"(Category: {item['category']}) — Qty: {item['quantity']}</li>"
        for item in items
    )
    html = f"""
<p>Hi {org_name},</p>
<p>There is an update on your supply request. The following items are now marked as
<strong>{status}</strong>:</p>
<ul>
{items_html}
</ul>
<p>If you have any questions, please reach out to Blueprints HQ.</p>
<p>Thank you,<br><strong>Blueprints HQ</strong></p>
"""
    try:
        _send(
            to=org_email,
            subject=f"Update on your supply request — {status}",
            html=html,
        )
    except Exception as exc:
        logger.error("send_status_update failed: %s", exc)
