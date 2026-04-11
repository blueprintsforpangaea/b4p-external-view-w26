import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import gspread
import pandas as pd
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials
from pydantic import BaseModel, Field

load_dotenv()
app = FastAPI()
logger = logging.getLogger(__name__)

# CRITICAL: Allow React (port 3000) to talk to Python (port 8000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_sheet_data():
    key_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
    scopes = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
    creds = Credentials.from_service_account_file(key_path, scopes=scopes)
    client = gspread.authorize(creds)
    
    sheet = client.open_by_key(os.environ.get('GOOGLE_SHEET_ID')).sheet1
    all_values = sheet.get_all_values()
    
    # Use Pandas to handle the headers/data
    df = pd.DataFrame(all_values[1:], columns=all_values[0])
    records = df.to_dict(orient='records')
    for index, record in enumerate(records, start=2):
        record["_sheet_row"] = index
    return records


def _find_supply_id_key(record: dict) -> Optional[str]:
    preferred_keys = [
        "Supply ID",
        "SupplyID",
        "Supply Id",
        "Item ID",
        "ItemID",
        "Item Id",
        "ID",
        "Id",
        "SKU",
        "Sku",
    ]
    for key in preferred_keys:
        if key in record:
            return key

    for key in record.keys():
        normalized = key.strip().lower().replace("_", " ")
        if normalized in {"supply id", "item id", "id", "sku"}:
            return key
    return None


def _send_email(to: str, subject: str, html: str) -> None:
    user = os.environ.get("GMAIL_USER", "").strip()
    password = os.environ.get("GMAIL_APP_PASSWORD", "").strip()

    if not user or not password or not to:
        logger.warning(
            "Skipping email send because GMAIL_USER, GMAIL_APP_PASSWORD, or recipient is missing."
        )
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = user
    msg["To"] = to
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP("smtp.gmail.com", 587) as smtp:
        smtp.starttls()
        smtp.login(user, password)
        smtp.sendmail(user, [to], msg.as_string())


def send_team_request_email(requester_name: str, notes: str, items: list[dict]) -> None:
    recipient = (
        os.environ.get("TEAM_REQUEST_EMAIL", "").strip()
        or os.environ.get("HQ_EMAIL", "").strip()
    )
    if not recipient:
        logger.warning("TEAM_REQUEST_EMAIL/HQ_EMAIL not configured; request email skipped.")
        return

    item_rows = "".join(
        (
            "<tr>"
            f"<td style='padding:8px;border:1px solid #d0d7de;'>{item['supply_id']}</td>"
            f"<td style='padding:8px;border:1px solid #d0d7de;'>{item['item_name']}</td>"
            f"<td style='padding:8px;border:1px solid #d0d7de;'>{item['sheet_row']}</td>"
            "</tr>"
        )
        for item in items
    )
    notes_html = f"<p><strong>Notes:</strong> {notes}</p>" if notes else ""
    html = f"""
    <p>A new external supply request was submitted.</p>
    <p><strong>Requester:</strong> {requester_name}</p>
    {notes_html}
    <p><strong>Requested supply IDs:</strong></p>
    <table style="border-collapse:collapse;border:1px solid #d0d7de;">
      <thead>
        <tr>
          <th style="padding:8px;border:1px solid #d0d7de;text-align:left;">Supply ID</th>
          <th style="padding:8px;border:1px solid #d0d7de;text-align:left;">Item</th>
          <th style="padding:8px;border:1px solid #d0d7de;text-align:left;">Sheet Row</th>
        </tr>
      </thead>
      <tbody>{item_rows}</tbody>
    </table>
    """

    try:
        _send_email(
            to=recipient,
            subject=f"New supply request: {len(items)} item(s)",
            html=html,
        )
    except Exception as exc:
        logger.exception("Failed to send team request email: %s", exc)
        raise HTTPException(status_code=502, detail="Request saved but email delivery failed.") from exc


class RequestItemIn(BaseModel):
    sheet_row: int = Field(ge=2)


class SubmitRequestBody(BaseModel):
    requester_name: str = Field(default="External User", min_length=1, max_length=200)
    notes: str = Field(default="", max_length=4000)
    items: list[RequestItemIn] = Field(min_length=1)

@app.get("/api/supplies")
async def supplies():
    data = get_sheet_data()
    return data


@app.post("/api/requests")
async def submit_request(body: SubmitRequestBody):
    inventory = get_sheet_data()
    row_lookup = {
        int(record["_sheet_row"]): record
        for record in inventory
        if record.get("_sheet_row") is not None
    }

    requested_items: list[dict] = []
    for line in body.items:
        record = row_lookup.get(line.sheet_row)
        if not record:
            raise HTTPException(
                status_code=400,
                detail=f"Inventory row {line.sheet_row} is no longer available.",
            )

        supply_id_key = _find_supply_id_key(record)
        supply_id = str(record.get(supply_id_key, "")).strip() if supply_id_key else ""
        if not supply_id:
            supply_id = f"ROW-{line.sheet_row}"

        name_key = next(
            (
                key
                for key in record.keys()
                if key != "_sheet_row"
                and any(token in key.lower() for token in ("name", "item", "description", "supply", "product"))
            ),
            None,
        )
        item_name = str(record.get(name_key, "")).strip() if name_key else supply_id

        requested_items.append(
            {
                "sheet_row": line.sheet_row,
                "supply_id": supply_id,
                "item_name": item_name,
            }
        )

    send_team_request_email(
        requester_name=body.requester_name.strip(),
        notes=body.notes.strip(),
        items=requested_items,
    )

    return {
        "ok": True,
        "requested_supply_ids": [item["supply_id"] for item in requested_items],
        "count": len(requested_items),
    }

# Run with: uvicorn main:app --reload
