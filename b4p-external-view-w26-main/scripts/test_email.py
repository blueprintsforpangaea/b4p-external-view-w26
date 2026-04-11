#!/usr/bin/env python3
"""make email-test — send a test HQ alert email via Gmail SMTP."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
load_dotenv()

gmail_user = os.environ.get("GMAIL_USER", "").strip()
gmail_pass = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
hq = os.environ.get("HQ_EMAIL", "").strip()

if not gmail_user or not gmail_pass:
    print("ERROR: GMAIL_USER or GMAIL_APP_PASSWORD not set in .env")
    print("  1. Enable 2-Step Verification on your Google account")
    print("  2. Go to myaccount.google.com/apppasswords")
    print("  3. Generate a 16-char App Password and add it to .env")
    sys.exit(1)

if not hq:
    print("ERROR: HQ_EMAIL not set in .env")
    sys.exit(1)

print(f"Sending test email from {gmail_user} to {hq} ...")

from app.services.email import send_hq_alert

send_hq_alert(
    org_name="Test Organization",
    org_email="test@example.com",
    items=[
        {"item_name": "Nitrile Gloves (M)", "category": "Gloves & PPE", "quantity": 10},
        {"item_name": "Sterile Gauze 4x4", "category": "Wound Care", "quantity": 5},
    ],
    timestamp="2024-01-01T00:00:00Z",
    review_flagged=["Sterile Gauze 4x4"],
)
print(f"Done — check {hq}")
