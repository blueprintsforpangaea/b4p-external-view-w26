import json
import os
import random
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

import gspread
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.oauth2.service_account import Credentials
from pydantic import BaseModel, Field, field_validator

from app.services import email as email_svc

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
SAMPLE_PATH = BASE_DIR / "sample_inventory.json"

app = FastAPI()

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

REQ_HEADERS = [
    "request_id",
    "submitted_at_utc",
    "nametag",
    "inventory_sheet_row",
    "item_name",
    "manufacturer",
    "warehouse_category",
    "quantity_requested",
    "request_notes",
    "status",
    "client_request_id",
]

_sample_client_request_ids: set[str] = set()
_sample_org_request_rows: list[dict[str, str]] = []


def _use_sample_data() -> bool:
    return os.environ.get("USE_SAMPLE_DATA", "").strip().lower() in ("1", "true", "yes")


def _get_google_creds() -> Credentials:
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ]
    json_str = os.environ.get("GOOGLE_CREDENTIALS_JSON")
    if json_str:
        info = json.loads(json_str)
        return Credentials.from_service_account_info(info, scopes=scopes)
    key_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not key_path or not Path(key_path).is_file():
        raise HTTPException(
            status_code=500,
            detail="Server missing GOOGLE_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS.",
        )
    return Credentials.from_service_account_file(key_path, scopes=scopes)


def _gspread_client():
    return gspread.authorize(_get_google_creds())


def _clean_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [
        f"Unnamed_{i}" if str(col).strip() == "" else str(col).strip()
        for i, col in enumerate(df.columns)
    ]
    seen: dict[str, int] = {}
    new_cols = []
    for c in df.columns:
        if c in seen:
            seen[c] += 1
            new_cols.append(f"{c}.{seen[c]}")
        else:
            seen[c] = 0
            new_cols.append(c)
    df.columns = new_cols
    return df


def get_inventory_records() -> list[dict]:
    if _use_sample_data():
        raw = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
        out = []
        for i, row in enumerate(raw):
            rec = dict(row)
            rec["_sheet_row"] = i + 2
            out.append(rec)
        return out

    sheet_id = os.environ.get("GOOGLE_SHEET_ID")
    if not sheet_id:
        raise HTTPException(status_code=500, detail="Missing GOOGLE_SHEET_ID.")

    client = _gspread_client()
    sheet = client.open_by_key(sheet_id).sheet1
    all_values = sheet.get_all_values()
    if not all_values:
        return []

    df = pd.DataFrame(all_values[1:], columns=all_values[0])
    df = _clean_columns(df)
    records = df.to_dict(orient="records")
    for i, rec in enumerate(records):
        rec["_sheet_row"] = i + 2
    return records


def _open_spreadsheet():
    sheet_id = os.environ.get("GOOGLE_SHEET_ID")
    if not sheet_id:
        raise HTTPException(status_code=500, detail="Missing GOOGLE_SHEET_ID.")
    client = _gspread_client()
    return client.open_by_key(sheet_id)


def _open_requests_spreadsheet():
    sheet_id = os.environ.get("REQUESTS_SHEET_ID") or os.environ.get("GOOGLE_SHEET_ID")
    if not sheet_id:
        raise HTTPException(status_code=500, detail="Missing REQUESTS_SHEET_ID.")
    client = _gspread_client()
    return client.open_by_key(sheet_id)


def get_requests_worksheet(spreadsheet: gspread.Spreadsheet):
    title = os.environ.get("REQUESTS_WORKSHEET_TITLE", "Requests").strip()
    try:
        return spreadsheet.worksheet(title)
    except gspread.WorksheetNotFound:
        worksheets = spreadsheet.worksheets()
        if len(worksheets) >= 2:
            return worksheets[1]
        return spreadsheet.add_worksheet(title=title, rows=3000, cols=len(REQ_HEADERS) + 2)


def ensure_request_headers(ws: gspread.Worksheet) -> None:
    rows = ws.get_all_values()
    if not rows:
        ws.append_row(REQ_HEADERS, value_input_option="USER_ENTERED")
        return
    if rows[0][0] != REQ_HEADERS[0]:
        raise HTTPException(
            status_code=500,
            detail=(
                "Requests worksheet row 1 must be the header row starting with "
                f"'{REQ_HEADERS[0]}'. Fix the sheet or point REQUESTS_WORKSHEET_TITLE "
                "to an empty/new tab."
            ),
        )


def read_request_rows(ws: gspread.Worksheet) -> list[dict]:
    rows = ws.get_all_values()
    if len(rows) <= 1:
        return []
    header = rows[0]
    out = []
    for r in rows[1:]:
        if not any(cell.strip() for cell in r):
            continue
        row_dict = {}
        for i, key in enumerate(header):
            row_dict[key] = r[i] if i < len(r) else ""
        out.append(row_dict)
    return out


class CartLineIn(BaseModel):
    sheet_row: int = Field(ge=2, le=500000)
    quantity: int = Field(ge=1, le=99999)


class SubmitRequestBody(BaseModel):
    nametag: str = Field(min_length=1, max_length=200)
    items: list[CartLineIn] = Field(min_length=1)
    request_notes: str = Field(default="", max_length=4000)
    client_request_id: Optional[str] = Field(default=None, max_length=80)

    @field_validator("nametag")
    @classmethod
    def nametag_strip(cls, v: str) -> str:
        t = v.strip()
        if not t:
            raise ValueError("nametag cannot be empty")
        return t


def _snapshot_row(inventory: list[dict], sheet_row: int) -> Optional[dict]:
    for rec in inventory:
        if int(rec.get("_sheet_row", -1)) == sheet_row:
            return rec
    return None


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/api/supplies")
async def supplies():
    return get_inventory_records()


@app.get("/api/requests")
async def list_requests():
    if _use_sample_data():
        return []

    spreadsheet = _open_requests_spreadsheet()
    ws = get_requests_worksheet(spreadsheet)
    ensure_request_headers(ws)
    return read_request_rows(ws)


@app.post("/api/requests")
async def submit_request(body: SubmitRequestBody):
    inventory = get_inventory_records()
    valid_rows = {int(r["_sheet_row"]) for r in inventory if "_sheet_row" in r}
    for line in body.items:
        if line.sheet_row not in valid_rows:
            raise HTTPException(
                status_code=400,
                detail=f"inventory_sheet_row {line.sheet_row} is not a current inventory row.",
            )

    if _use_sample_data():
        cid = (body.client_request_id or "").strip()
        if cid:
            if cid in _sample_client_request_ids:
                raise HTTPException(status_code=409, detail="Duplicate submission.")
            _sample_client_request_ids.add(cid)
        return {
            "ok": True,
            "message": "USE_SAMPLE_DATA is on — nothing was written to Google Sheets.",
            "request_group_id": str(uuid.uuid4()),
            "lines": len(body.items),
        }

    spreadsheet = _open_requests_spreadsheet()
    ws = get_requests_worksheet(spreadsheet)
    ensure_request_headers(ws)

    if body.client_request_id:
        existing = read_request_rows(ws)
        cid = body.client_request_id.strip()
        for row in existing:
            if row.get("client_request_id", "").strip() == cid:
                raise HTTPException(status_code=409, detail="Duplicate submission.")

    group_id = str(uuid.uuid4())
    ts = datetime.now(timezone.utc).isoformat()
    batch: list[list] = []

    for line in body.items:
        snap = _snapshot_row(inventory, line.sheet_row) or {}
        name = snap.get("Name") or snap.get("name") or snap.get("Description") or ""
        mfr = snap.get("Manufacturer Name") or snap.get("Manufacturer") or ""
        cat = snap.get("Category") or ""
        batch.append([
            group_id, ts, body.nametag, line.sheet_row,
            str(name), str(mfr), str(cat), line.quantity,
            body.request_notes.strip(), "Pending",
            (body.client_request_id or "").strip(),
        ])

    try:
        ws.append_rows(batch, value_input_option="USER_ENTERED")
    except gspread.exceptions.APIError as e:
        raise HTTPException(status_code=502, detail=f"Google Sheets error: {e}") from e

    return {"ok": True, "request_group_id": group_id, "lines": len(batch), "submitted_at_utc": ts}


ORG_REQ_HEADERS = [
    "Request ID", "Org Name", "Org Email", "Item Name",
    "Category", "Quantity Requested", "Status", "Timestamp", "Review Flag",
]


class OrgCartItemIn(BaseModel):
    item_name: str = Field(min_length=1, max_length=200)
    category: str = Field(default="", max_length=200)
    quantity: int = Field(ge=1, le=99999)
    sheet_row: Optional[int] = Field(default=None, ge=2, le=500000)


class OrgRequestBody(BaseModel):
    org_name: str = Field(min_length=1, max_length=200)
    org_email: str = Field(min_length=1, max_length=254)
    items: list[OrgCartItemIn] = Field(min_length=1)


class StatusUpdateBody(BaseModel):
    status: Literal["Approved", "Shipped"]


def _make_request_id() -> str:
    ts = int(datetime.now(timezone.utc).timestamp())
    suffix = f"{random.randint(0, 999):03d}"
    return f"REQ-{ts}-{suffix}"


def _org_requests_worksheet(spreadsheet: gspread.Spreadsheet) -> gspread.Worksheet:
    title = os.environ.get("ORG_REQUESTS_WORKSHEET_TITLE", "Requests").strip()
    try:
        ws = spreadsheet.worksheet(title)
    except gspread.WorksheetNotFound:
        ws = spreadsheet.add_worksheet(title=title, rows=3000, cols=len(ORG_REQ_HEADERS) + 2)

    rows = ws.get_all_values()
    first_row = rows[0] if rows else []
    has_header_row = bool(first_row) and any(str(cell).strip() for cell in first_row)

    if not has_header_row:
        ws.append_row(ORG_REQ_HEADERS, value_input_option="USER_ENTERED")
    elif first_row[0] != ORG_REQ_HEADERS[0]:
        raise HTTPException(
            status_code=500,
            detail=f"Worksheet '{title}' has unexpected headers. Expected 'Request ID'.",
        )
    return ws


def _review_flag(inventory: list[dict], item_name: str) -> bool:
    needle = item_name.strip().lower()
    for rec in inventory:
        name = (rec.get("Name") or rec.get("name") or "").strip().lower()
        if name == needle:
            review = (rec.get("Review") or "").strip()
            return review.lower() == "review needed"
    return False


def _inventory_primary_key(record: dict) -> str:
    for key, value in record.items():
        if key == "_sheet_row":
            continue
        return str(value).strip()
    return ""


@app.post("/requests")
async def submit_org_request(body: OrgRequestBody):
    if _use_sample_data():
        request_id = _make_request_id()
        ts = datetime.now(timezone.utc).isoformat()
        for item in body.items:
            _sample_org_request_rows.append({
                "Request ID": request_id, "Org Name": body.org_name,
                "Org Email": body.org_email, "Item Name": item.item_name,
                "Category": item.category, "Quantity Requested": str(item.quantity),
                "Status": "Under Review", "Timestamp": ts, "Review Flag": "FALSE",
            })
        return {"request_id": request_id, "status": "Under Review", "message": "USE_SAMPLE_DATA mode."}

    inventory = get_inventory_records()
    request_id = _make_request_id()
    ts = datetime.now(timezone.utc).isoformat()

    normalized_items: list[dict] = []
    for item in body.items:
        snap = _snapshot_row(inventory, item.sheet_row) if item.sheet_row else None
        item_name = (str(snap.get("Name") or snap.get("name") or item.item_name).strip() if snap else item.item_name)
        category = (str(snap.get("Category") or snap.get("category") or item.category).strip() if snap else item.category)
        normalized_items.append({
            "item_name": item_name, "category": category,
            "quantity": item.quantity, "sheet_row": item.sheet_row,
            "inventory_key": _inventory_primary_key(snap) if snap else "",
        })

    items_payload = [
        {"item_name": i["item_name"], "category": i["category"], "quantity": i["quantity"], "inventory_key": i["inventory_key"]}
        for i in normalized_items
    ]
    review_flagged = [i["item_name"] for i in normalized_items if _review_flag(inventory, i["item_name"])]

    batch: list[list] = []
    for item in normalized_items:
        flag = item["item_name"] in review_flagged
        batch.append([
            request_id, body.org_name, body.org_email, item["item_name"],
            item["category"], item["quantity"], "Under Review", ts,
            "TRUE" if flag else "FALSE",
        ])

    spreadsheet = _open_requests_spreadsheet()
    ws = _org_requests_worksheet(spreadsheet)
    try:
        ws.append_rows(batch, value_input_option="USER_ENTERED")
    except gspread.exceptions.APIError as exc:
        raise HTTPException(status_code=502, detail=f"Google Sheets error: {exc}") from exc

    email_svc.send_org_confirmation(body.org_name, body.org_email, items_payload, request_id)
    email_svc.send_hq_alert(body.org_name, body.org_email, items_payload, ts, review_flagged)

    return {"request_id": request_id, "status": "Under Review"}


@app.patch("/requests/{request_id}/status")
async def update_org_request_status(request_id: str, body: StatusUpdateBody):
    if _use_sample_data():
        updated_rows = 0
        for row in _sample_org_request_rows:
            if row.get("Request ID", "").strip() == request_id:
                row["Status"] = body.status
                updated_rows += 1
        return {"request_id": request_id, "status": body.status, "updated_rows": updated_rows}

    spreadsheet = _open_requests_spreadsheet()
    ws = _org_requests_worksheet(spreadsheet)
    all_rows = ws.get_all_values()

    if len(all_rows) <= 1:
        raise HTTPException(status_code=404, detail=f"Request ID '{request_id}' not found.")

    header = all_rows[0]
    try:
        id_col = header.index("Request ID")
        status_col = header.index("Status")
        org_name_col = header.index("Org Name")
        org_email_col = header.index("Org Email")
        item_name_col = header.index("Item Name")
        category_col = header.index("Category")
        qty_col = header.index("Quantity Requested")
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=f"Unexpected sheet headers: {exc}") from exc

    matching_sheet_rows: list[int] = []
    org_name = ""
    org_email = ""
    items: list[dict] = []

    for i, row in enumerate(all_rows[1:], start=2):
        if len(row) > id_col and row[id_col].strip() == request_id:
            matching_sheet_rows.append(i)
            if not org_name and len(row) > org_name_col:
                org_name = row[org_name_col]
            if not org_email and len(row) > org_email_col:
                org_email = row[org_email_col]
            items.append({
                "item_name": row[item_name_col] if len(row) > item_name_col else "",
                "category": row[category_col] if len(row) > category_col else "",
                "quantity": row[qty_col] if len(row) > qty_col else "",
            })

    if not matching_sheet_rows:
        raise HTTPException(status_code=404, detail=f"Request ID '{request_id}' not found.")

    sheet_status_col = status_col + 1
    try:
        ws.batch_update([
            {"range": gspread.utils.rowcol_to_a1(r, sheet_status_col), "values": [[body.status]]}
            for r in matching_sheet_rows
        ])
    except gspread.exceptions.APIError as exc:
        raise HTTPException(status_code=502, detail=f"Google Sheets error: {exc}") from exc

    if org_email:
        email_svc.send_status_update(org_name, org_email, body.status, items)

    return {"request_id": request_id, "status": body.status}


@app.get("/inventory/availability")
async def inventory_availability():
    inventory = get_inventory_records()

    org_requests: list[dict] = []
    if not _use_sample_data():
        try:
            spreadsheet = _open_requests_spreadsheet()
            ws = _org_requests_worksheet(spreadsheet)
            all_rows = ws.get_all_values()
            if len(all_rows) > 1:
                header = all_rows[0]
                for r in all_rows[1:]:
                    if any(cell.strip() for cell in r):
                        org_requests.append({header[j]: (r[j] if j < len(r) else "") for j in range(len(header))})
        except Exception:
            pass

    result = []
    for rec in inventory:
        item_name = (rec.get("Name") or rec.get("name") or "").strip()
        category = (rec.get("Category") or rec.get("category") or "").strip()
        qty_raw = str(rec.get("Quantity") or rec.get("quantity") or "").strip()
        sheet_row = rec.get("_sheet_row")

        try:
            qty = int(qty_raw.replace(",", ""))
        except (ValueError, AttributeError):
            qty = None

        is_limited = qty is None or qty <= 5 or qty_raw in ("N/A", "-", "")
        needle = item_name.lower()
        item_reqs = [r for r in org_requests if r.get("Item Name", "").strip().lower() == needle]
        shipped = [r for r in item_reqs if r.get("Status", "").strip() == "Shipped"]
        pending = [r for r in item_reqs if r.get("Status", "").strip() == "Under Review"]

        if shipped:
            availability_status, tags, requesting_org, request_id = "Shipped", ["Shipped"], None, None
        elif pending:
            availability_status = "Requested"
            requesting_org = pending[0].get("Org Name", "")
            request_id = pending[0].get("Request ID", "")
            tags = [f"Requested by {requesting_org}"]
        elif is_limited:
            availability_status, tags, requesting_org, request_id = "Limited", ["Low Stock"], None, None
        else:
            availability_status, tags, requesting_org, request_id = "Available", ["Available"], None, None

        result.append({
            "sheet_row": sheet_row, "item_name": item_name, "category": category,
            "availability_status": availability_status, "tags": tags,
            "requesting_org": requesting_org, "request_id": request_id,
        })

    return result


@app.get("/requests")
async def list_org_requests(email: Optional[str] = None):
    if _use_sample_data():
        if not email:
            return list(_sample_org_request_rows)
        return [r for r in _sample_org_request_rows if r.get("Org Email", "").strip().lower() == email.strip().lower()]

    spreadsheet = _open_requests_spreadsheet()
    ws = _org_requests_worksheet(spreadsheet)
    all_rows = ws.get_all_values()

    if len(all_rows) <= 1:
        return []

    header = all_rows[0]
    result = []
    for r in all_rows[1:]:
        if not any(cell.strip() for cell in r):
            continue
        row_dict = {header[j]: (r[j] if j < len(r) else "") for j in range(len(header))}
        if email and row_dict.get("Org Email", "").strip().lower() != email.strip().lower():
            continue
        result.append(row_dict)

    return result
