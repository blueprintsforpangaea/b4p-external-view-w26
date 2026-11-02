import concurrent.futures
import csv
import io
import hashlib
import ipaddress
import unicodedata
from collections import OrderedDict
import hmac
import json
import logging
import os
import re
import secrets
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

import gspread
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from google.oauth2.service_account import Credentials
from pydantic import BaseModel, Field, field_validator

import psycopg
import requests
from fastapi.responses import JSONResponse

from app import db
from app import accounts, auth
from app import email_check
from app import request_webhook
from app.services import email as email_svc

# .env is for local development only; hosted platforms provide real environment variables.
# Never override variables that are already set (tests and scripts rely on that).
if not os.environ.get("VERCEL") and not os.environ.get("RENDER"):
    load_dotenv(override=False)

BASE_DIR = Path(__file__).resolve().parent
SAMPLE_PATH = Path(os.environ.get("SAMPLE_INVENTORY_PATH") or BASE_DIR / "sample_inventory.json")

logger = logging.getLogger(__name__)

def _docs_disabled() -> bool:
    """API docs list every route and the HQ header: off on deployed servers unless ENABLE_API_DOCS=1."""
    deployed = (bool(os.environ.get("VERCEL") or os.environ.get("RENDER"))
                or os.environ.get("VERCEL_ENV", "").strip().lower() == "production")
    return deployed and os.environ.get("ENABLE_API_DOCS", "").strip() != "1"


_NO_DOCS = {"docs_url": None, "redoc_url": None, "openapi_url": None} if _docs_disabled() else {}
app = FastAPI(**_NO_DOCS)

# Exact origins only: the sign-in cookie is allowed on cross-origin calls (credentials), so a
# wildcard would let any site act as a signed-in clinic. On Vercel the site and API share one origin.
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get(
    "ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if o.strip() and o.strip() != "*"]
app.add_middleware(GZipMiddleware, minimum_size=1000)  # inventory JSON is ~134 KB raw
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
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


def _vercel_env() -> str:
    return os.environ.get("VERCEL_ENV", "").strip().lower()  # production | preview | development


def _has_google_creds() -> bool:
    if os.environ.get("GOOGLE_CREDENTIALS_JSON"):
        return True
    key_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    return bool(key_path) and Path(key_path).is_file()


def _auto_sample_preview() -> bool:
    """Preview deploys never touch real data or send email, even if secrets are in their scope,
    unless PREVIEW_ALLOW_REAL_DATA=true."""
    return db.preview_sandboxed()


def _use_sample_data() -> bool:
    if _vercel_env() == "production":
        return False  # production must never silently serve demo data
    explicit = os.environ.get("USE_SAMPLE_DATA", "").strip().lower() in ("1", "true", "yes")
    return explicit or _auto_sample_preview()


def _public_sheet() -> bool:
    """Local, read-only use of a sheet shared as "Anyone with the link can view": the inventory
    comes from Google's CSV export, so no service-account key is needed. Requests are kept in
    memory like sample mode, so nothing is ever written to the sheet. Never on production."""
    if _vercel_env() == "production":
        return False
    on = os.environ.get("PUBLIC_SHEET_READ", "").strip().lower() in ("1", "true", "yes")
    return on and bool(os.environ.get("GOOGLE_SHEET_ID", "").strip())


def _requests_in_memory() -> bool:
    """Requests are kept in this process, never written to the sheet."""
    return _use_sample_data() or _public_sheet()


def _check_configured() -> None:
    """Production with no database and no Google credentials is a deploy mistake: say so (503)."""
    if _vercel_env() == "production" and not db.enabled() and not _has_google_creds():
        raise HTTPException(
            status_code=503,
            detail="Server is not configured: set DATABASE_URL or GOOGLE_CREDENTIALS_JSON.",
        )


app.router.dependencies.append(Depends(_check_configured))  # runs before every route

_DOC_PATHS = ("/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect")


@app.middleware("http")
async def _hide_api_docs_in_production(request: Request, call_next):
    """Same rule at request time, in case the environment changes after import (tests, hot config)."""
    if _docs_disabled() and request.url.path.rstrip("/").endswith(_DOC_PATHS):
        return JSONResponse(status_code=404, content={"detail": "Not Found"})
    return await call_next(request)


def _flush_alert_digest(tasks: BackgroundTasks) -> None:
    """Opportunistic: the HQ digest has no timer, so any request after the hour sends it."""
    if email_svc.digest_due():
        _deliver(tasks, (email_svc.flush_digest_if_due,))


app.router.dependencies.append(Depends(_flush_alert_digest))


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
    if _public_sheet():  # read-only mode: the Sheets API (and so any write) is never used
        raise RuntimeError("PUBLIC_SHEET_READ is on: the Google Sheets API is not used.")
    return gspread.authorize(_get_google_creds())


def _clean_header(header: list) -> list[str]:
    """Trim names, name blank columns, and de-duplicate repeats ("Qty", "Qty.1", ...)."""
    seen: dict[str, int] = {}
    out = []
    for i, col in enumerate(header):
        name = str(col).strip() or f"Unnamed_{i}"
        if name in seen:
            seen[name] += 1
            name = f"{name}.{seen[name]}"
        else:
            seen[name] = 0
        out.append(name)
    return out


@app.exception_handler(gspread.exceptions.APIError)
async def _sheets_error(_, exc: gspread.exceptions.APIError):
    # Google's error text can name our project, so it never reaches the client.
    if getattr(exc.response, "status_code", None) == 429:
        return JSONResponse(status_code=503,
                            content={"detail": "Inventory service busy, try again in a minute."})
    return JSONResponse(status_code=502, content={"detail": "Google Sheets error."})


@app.exception_handler(psycopg.Error)
async def _db_error(_, exc: psycopg.Error):
    # Never echo raw database text to clients. Input the database refuses (RAISE EXCEPTION,
    # CHECK, too-long value, ...) is the caller's fault; anything else is an outage.
    if isinstance(exc, (psycopg.errors.RaiseException, psycopg.errors.CheckViolation,
                        psycopg.errors.DataError)):
        return JSONResponse(status_code=400, content={"detail": "Request rejected."})
    if isinstance(exc, psycopg.errors.IntegrityError):
        return JSONResponse(status_code=409, content={"detail": "Request conflicts with existing data."})
    return JSONResponse(status_code=503, content={"detail": "Database unavailable."})


def require_hq(request: Request, x_hq_token: Optional[str] = Header(default=None)) -> None:
    """HQ-only endpoints: a signed-in Blueprints team account (role "hq"), or the shared secret
    (env HQ_API_TOKEN) in the X-HQ-Token header, for scripts."""
    account = current_account(request)
    if account and account["role"] == "hq":
        return
    expected = os.environ.get("HQ_API_TOKEN", "").strip()
    if not expected:
        raise HTTPException(status_code=403, detail="HQ access is disabled.")
    if not hmac.compare_digest((x_hq_token or "").encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Invalid HQ token.")


# Simple per-IP rate limit for anonymous writes (in memory, per process). To remove it,
# delete this block and the `Depends(rate_limit_post)` on POST /requests.
RATE_LIMIT = 10  # requests per IP per minute
_hits: "OrderedDict[str, list[float]]" = OrderedDict()  # least recently used first; capped in _check_rate
MAX_RATE_KEYS = 10000


_warned_xff = False


def _trust_proxy() -> bool:
    """TRUST_PROXY=1/0 forces it; otherwise on when running on Render or Vercel (their proxies
    set X-Forwarded-For to the real client IP)."""
    setting = os.environ.get("TRUST_PROXY", "").strip()
    if setting in ("0", "1"):
        return setting == "1"
    return bool(os.environ.get("RENDER") or os.environ.get("VERCEL"))


def _client_ip(request: Request) -> str:
    """X-Forwarded-For is client-controlled, so read it only behind our own proxy.

    Render's proxy appends the real client IP as the LAST hop, so we use that one.
    """
    global _warned_xff
    if os.environ.get("VERCEL"):
        # Vercel sets this one itself; unlike X-Forwarded-For the client cannot add to it.
        first = request.headers.get("x-vercel-forwarded-for", "").split(",")[0].strip()
        if first:
            return _ip_bucket(first)
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd and not _trust_proxy():
        if not _warned_xff and request.client and request.client.host not in ("testclient", "127.0.0.1"):
            _warned_xff = True
            logger.warning("X-Forwarded-For received but proxy trust is off, so all users may share one "
                           "rate limit. If you are behind a proxy, set TRUST_PROXY=1.")
        fwd = ""
    ip = fwd.split(",")[-1].strip() or (request.client.host if request.client else "?")
    return _ip_bucket(ip)


def _ip_bucket(ip: str) -> str:
    """One IPv6 /64 is a single customer's allocation, so share one bucket per /64."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    if addr.version == 6:
        return str(ipaddress.ip_network(f"{addr}/64", strict=False))
    return ip


def _check_rate(key: str, limit: int) -> None:
    now = time.monotonic()
    recent = [t for t in _hits.get(key, []) if now - t < 60]
    if len(recent) >= limit:
        _hits[key] = recent
        _hits.move_to_end(key)
        raise HTTPException(status_code=429, detail="Too many requests. Try again in a minute.")
    recent.append(now)
    _hits[key] = recent
    _hits.move_to_end(key)
    while len(_hits) > MAX_RATE_KEYS:  # bounded memory even under a flood of distinct keys
        _hits.popitem(last=False)


def rate_limit_post(request: Request) -> None:
    _check_rate(_client_ip(request), RATE_LIMIT)


# Looser separate bucket for GET /requests?email=: the address is the only access check, so
# unlimited lookups would let someone guess clinic addresses and read their history.
LOOKUP_LIMIT = 20  # per IP per minute; a page load is one lookup


def _load_inventory_records() -> list[dict]:
    if db.enabled():
        return db.get_supplies()

    if _use_sample_data():
        raw = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
        out = []
        for i, row in enumerate(raw):
            rec = dict(row)
            rec["_sheet_row"] = i + 2
            out.append(rec)
        return out

    # Live sheet: cache briefly so page loads and submits don't each cost a Sheets read (quota).
    cached = _inventory_cache.get("records")
    if cached is not None and time.monotonic() - _inventory_cache["at"] < INVENTORY_CACHE_SECONDS:
        return list(cached)
    records = _read_public_sheet_inventory() if _public_sheet() else _read_sheet_inventory()
    _inventory_cache.update(records=records, at=time.monotonic())
    return list(records)


# --- patient data in inventory text (specimen-tube labels, free-text notes) --------------------
# Conservative on purpose: every pattern needs a keyword (Pt ID, MRN, DOB, Patient:, phone) so lot
# numbers and product codes ("REF 302995", "Lot 6106151", "18G") are left alone.
_ID = r"(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]*"  # an identifier token that contains a digit
_WORD = r"(?-i:[A-ZÀ-Þ](?:[^\W\d_]|['’.-])*)"  # a capitalised name word, accents and apostrophes included
_NAME = rf"{_WORD}(?:[ ,]+{_WORD}){{0,3}}"
_DATE = (r"(?:\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}"
         r"|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{2,4})")
_PHI_PATTERNS = [
    # (a) Pt ID, PtID, pt.id, Pat ID, Patient ID followed by an id
    (re.compile(rf"\b(?:pt|pat|patient)\.?\s*id(?![a-z])[\s:#.]*{_ID}", re.I), "Pt. ID [removed]"),
    # (b) MRN / Med Rec # / medical record followed by an id
    (re.compile(rf"\b(?:mrn|med\.?\s*rec\.?(?:\s*(?:#|no\.?|number))?|medical\s+record(?:\s*(?:#|no\.?|number))?)"
                rf"[\s:#.]*{_ID}", re.I), "MRN [removed]"),
    # (c) DOB / D.O.B. / date of birth followed by a date
    (re.compile(rf"\b(?:dob|d\.o\.b\.?|date\s+of\s+birth)[\s:\-]*{_DATE}", re.I), "DOB [removed]"),
    # (e) Patient: Name / Pt name Name
    # "Pt name Test Person" (no colon); the colon forms are handled by PATIENT_NAME_PATTERN below
    (re.compile(rf"\bpt\.?\s+name\s+{_NAME}", re.I), "Patient: [removed]"),
]
_PT_ID_RE = re.compile(rf"\b(?:pt|pat|patient)\.?\s*id(?![a-z])[\s:#.]*({_ID})", re.I)
_PHONE_PATTERNS = [  # (d) only applied to Notes, and only phone-shaped text (bare digit runs are product codes)
    re.compile(r"\b(?:tel|phone|ph|call|fax|cell)\.?\s*[:#]?\s*[\d(+][\d\s().+-]{5,}\d", re.I),
    re.compile(r"(?<![\w-])(?:\+?\d{1,2}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w-])"),
]


# Same spans as the database's redact_phi() (see b4p/normalize.py in Blueprints_DB, copied below;
# tests/test_phi_parity.py runs one table of cases through both). Patterns use \b where Postgres uses \y.
# --- copied from Blueprints_DB b4p/normalize.py (keep in step) ---
def _ci(pattern: str) -> str:
    """Make the letters of a simple word pattern case-insensitive without (?i), so a pattern can
    mix case-insensitive words with a case-sensitive keyword (Postgres has no (?i:...) groups)."""
    return re.sub(r"[A-Za-z]", lambda m: f"[{m.group().upper()}{m.group().lower()}]", pattern)


# A patient identifier on a specimen-tube label, e.g. "Pt. ID <number> <code>",
# "Patient XX 1234", "patient ID: <4 digits> <4 digits>". Mirrors b4p_patient_id_pattern()
# in sql/schema.sql (tests/test_privacy.py checks they agree).
# a size or count, not an ID: "Pt. 16 oz"
_UNITS = _ci("(?:oz|ml|mg|mcg|g|kg|lb|lbs|cc|l|ct|pk|pack|pcs|pc|in|cm|mm|fr|ga|gauge|inch|inches|count|ea|each)")
_ID_TOKEN = r"(?:(?!ID\b)[A-Z]{1,3}\b(?:\.[A-Z]{1,3}\b)*\.?(?![\'\u2019-]|\.?\s+[A-Z][a-z])|[A-Za-z0-9-]*[0-9][A-Za-z0-9-]*)"
PATIENT_ID_RE = re.compile(
    r"\b(?:[Pp][Tt]\b\.?|[Pp][Aa][Tt][Ii][Ee][Nn][Tt]\b)"
    r"(?:\s*(?:[Ii][Dd]\b|#|[Nn][Oo]\b\.?))?[\s:#,.]*"
    r"(?![0-9]{1,4}\s*" + _UNITS + r"\b)"
    + _ID_TOKEN + r"(?:[\s,]+" + _ID_TOKEN + r"){0,3}")


# Research-subject / specimen ID on trial sample tubes ("A00-000", "a00 - 000").
# Mirrors b4p_subject_id_pattern() in sql/schema.sql.
SUBJECT_ID_PATTERN = r"\b[A-Za-z][0-9]{2}\s*-\s*[0-9]{3}\b"
SUBJECT_ID_RE = re.compile(SUBJECT_ID_PATTERN)

# Letters of any common script (written out so it does not depend on the database locale)
_L = r"A-Za-zÀ-ɏͰ-ϿЀ-ӿḀ-ỿ"
_T = r"[" + _L + r"][" + _L + r"'\u2019.-]*"        # one name token: José, O'Brien, J., Smith-Jones

# Ordinary supply words that follow "Patient" in product names ("Patient Gait Belt").
# They are never taken for a surname. Matching is case-insensitive; a plural -s/-es is allowed.
_STOP_WORDS = (
    "id|name|return|starter|slipper|use|used|monitoring|monitor|disposable|reusable|single|sterile|belonging|"
    "lift|lifter|lifting|transfer|care|controlled|warming|warmer|gown|bed|safety|restraint|positioning|"
    "positioner|wedge|education|comfort|handling|ready|preoperative|preparation|specimen|sample|identification|"
    "information|wristband|armband|bracelet|band|wipe|isolation|support|cart|chair|hygiene|bathing|bath|skin|"
    "cleanser|slide|sheet|sling|aid|kit|supply|supplies|access|contact|cooling|heating|side|port|cable|circuit|"
    "interface|sitter|cuff|line|hose|tubing|mask|wound|dressing|glove|drape|cover|pillow|blanket|bag|cap|label|"
    "chart|record|data|room|left|right|instruction|tray|scale|thermometer|electrode|hoist|board|belt|shoe|sock|"
    "brief|diaper|underpad|pad|urinal|bedpan|commode|walker|wheelchair|stretcher|mattress|towel|washcloth|"
    "cloth|wash|hand|basin|item|product|set|pack|call|cord|alarm|garment|scrub|cushion|table|folder|transport|"
    "oxygen|suction|canister|gait|fall|mat|protection|turn|assist|valuable|pressure|simulator|gauze|needle|"
    "syringe|bandage|tape|hearing|hair|bib|temperature|probe|sensor|lead|system|pump|analgesia|catheter|"
    "bottle|container|cup|pitcher|tube|valve|filter|adapter|connector|clip|strap|harness|vest|garment|sleeve|"
    "stocking|boot|splint|brace|collar|rail|pole|stand|lamp|light|camera|phone|remote|control|button|switch|"
    "screen|display|software|program|plan|form|sticker|stamp|marker|pen|pencil|paper|envelope|file|binder|"
    "stool|charting|holder|privacy|weighing|compression|positioning|prep|device|lateral|resuscitator|vest|"
    "skin|safety|satisfaction|survey|bill|rights|portal|identification|armband|hospital|info|admission|shower|"
    "nasal|dental|dignity|swab|vomit|sharp|disposal|handbook|wt|spirometer")
_STOP = r"(?:" + _STOP_WORDS + r")(?:e?s)?"
_NAMEWORD = r"[" + _L + r"][" + _L + r"'\u2019-]*"

_STOP_CI = _ci(_STOP)

# After an explicit label ("Patient:", "Pt. Name:", or a dash) whatever comes next IS the name:
# the next one to three words, in any script. After a plain dash a product word doesn't count.
# Mirrors b4p_patient_name_pattern() in sql/schema.sql.
_ANYWORDS = r"\S+(?:\s+\S+){0,2}"
PATIENT_NAME_PATTERN = (r"(?i)(?<![0-9])(?<![0-9]\s)\b(?:pt\b\.?|patient\b)(?:\s+name)?\s*"
                        r"(?::\s*(?!id\b)" + _ANYWORDS + r"|-\s*(?!(?:" + _STOP + r"|id)\b)" + _ANYWORDS + r")")
PATIENT_NAME_RE = re.compile(PATIENT_NAME_PATTERN)

# A name straight after Patient / Pt. with no label ("Patient Smith bed 3", "Pt J. Smith",
# "Pt van der Berg", "Patient 山田 太郎"): up to three capitalised words (initials and
# particles allowed) whatever follows, unless the first word is an ordinary supply word
# ("Patient Gait Belt"). A lower-case name ("pt. smith") only counts at the end of the text, before a
# comma, DOB/MRN/ID or a number. Lower-case "pt" needs its period ("12 pt font" is a size); never after a digit.
# Mirrors b4p_patient_surname_pattern() in sql/schema.sql.
_PT_KEYWORD = r"(?:" + _ci("patient") + r"\b|(?:Pt|PT)\b\.?|pt\b\.)"
_CJK = r"぀-ヿ㐀-鿿가-힯"
_UPPER = r"A-ZÀ-ÞΑ-ΩА-Я" + _CJK
_CAPWORD = r"[" + _UPPER + r"][" + _L + _CJK + r"'\u2019/.-]*"
_PARTICLE = _ci("(?:de|la|del|della|van|der|den|von|da|di|le|du|ter|al|el|bin|ibn)")
_NOSTOP = r"(?!" + _STOP_CI + r"\b)"
_LOWWORD = r"[" + _L + r"'\u2019-]+(?![" + _L + r"0-9])"
PATIENT_SURNAME_PATTERN = (
    r"(?<![0-9])(?<![0-9]\s)\b" + _PT_KEYWORD + r"\s+(?:"
    r"(?:" + _PARTICLE + r"\s+){0,2}" + _NOSTOP + _CAPWORD
    + r"(?:\s+(?:" + _PARTICLE + r"\s+){0,2}" + _NOSTOP + _CAPWORD + r"){0,2}"
    + r"|" + _NOSTOP + _LOWWORD + r"(?:\s+" + _NOSTOP + _LOWWORD + r")?"
    + r"(?=\.?\s*$|\s*[,;]|\s+(?:" + _ci("dob") + "|" + _ci("mrn") + "|" + _ci("id") + r")\b|\s*[0-9]))")
PATIENT_SURNAME_RE = re.compile(PATIENT_SURNAME_PATTERN)

# Date of birth: numeric, "March 3 1980" or "3rd March 1980", after DOB / born (on)
_MON = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
DOB_PATTERN = (r"(?i)\b(?:dob|d\.o\.b\.?|date of birth|born(?:\s+on)?)[\s:]*(?:[0-9]{1,4}[-/.][0-9]{1,2}[-/.][0-9]{1,4}"
               r"|" + _MON + r"\s+[0-9]{1,2}(?:st|nd|rd|th)?,?\s+[0-9]{2,4}"
               r"|[0-9]{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?" + _MON + r",?\s+[0-9]{2,4})")
DOB_RE = re.compile(DOB_PATTERN)
SSN_PATTERN = r"\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b"
SSN_RE = re.compile(SSN_PATTERN)

# Zero-width / bidi / soft-hyphen characters people (or scanners) slip into text
_INVISIBLE_RE = re.compile("[­؜​-‏‪-‮⁠-⁤⁦-⁩﻿]")
# Dash look-alikes -> '-', and Cyrillic/Greek letters that look like Latin ones -> Latin
_DASH_FROM = "‐‑‒–—―−"
_HOMOGLYPHS = {  # Cyrillic and Greek letters -> the Latin letter they look like
    "\u0430\u0435\u043e\u0440\u0441\u0445\u0443\u0456\u0458\u0455\u043a\u043c\u0442\u043d\u0432": "aeopcxyijskmtnb",
    "\u0410\u0412\u0415\u041a\u041c\u041d\u041e\u0420\u0421\u0422\u0425\u0423\u0406\u0408\u0405": "ABEKMHOPCTXYIJS",
    "\u03bf\u03c1\u03bd\u03c4\u03b1\u03b5\u03b9\u03ba\u03c5\u03c7": "opvtaeikux",
    "\u0391\u0392\u0395\u0396\u0397\u0399\u039a\u039c\u039d\u039f\u03a1\u03a4\u03a5\u03a7": "ABEZHIKMNOPTYX",
}
HOMOGLYPH_FROM = "".join(_HOMOGLYPHS)
HOMOGLYPH_TO = "".join(_HOMOGLYPHS.values())
assert len(HOMOGLYPH_FROM) == len(HOMOGLYPH_TO)
_FOLD_TABLE = str.maketrans(_DASH_FROM + HOMOGLYPH_FROM, "-" * len(_DASH_FROM) + HOMOGLYPH_TO)
# --- end copy ---
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_MRN_RE = re.compile(r"\b(?:[Mm][Rr][Nn]|[Mm][Rr]#|[Mm]ed(?:ical)?\s*[Rr]ec(?:ord)?\s*(?:#|[Nn]o\.?|[Nn]umber))"
                     r"[\s:#.]*[A-Za-z0-9-]*[0-9][A-Za-z0-9-]*")
_US_PHONE_RE = re.compile(r"(?:\+?1[\s.-]?)?(?:\([0-9]{3}\)\s?|\b[0-9]{3}[\s.-])[0-9]{3}[\s.-][0-9]{4}\b")
_INVISIBLE = re.compile("[\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]")
_FOLD_TABLE = str.maketrans(_DASH_FROM + HOMOGLYPH_FROM, "-" * len(_DASH_FROM) + HOMOGLYPH_TO)
_PHI_SHARED = [  # applied in this order, after the labelled-ID patterns above
    (_EMAIL_RE, "[email removed]"),
    (_MRN_RE, "MRN [removed]"),
    (re.compile(DOB_PATTERN), "DOB [removed]"),
    (PATIENT_ID_RE, "Pt. ID [removed]"),
    (re.compile(PATIENT_NAME_PATTERN), "Pt. [name removed]"),
    (re.compile(PATIENT_SURNAME_PATTERN), "Pt. [name removed]"),
    (re.compile(SUBJECT_ID_PATTERN), "[id removed]"),
    (re.compile(SSN_PATTERN), "[ssn removed]"),
    # phones: the database redacts them everywhere; sheet mode only in Notes (below), where bare number
    # runs elsewhere are product codes and tests/test_email.py pins that.
]


def _redact_phi(text: str, notes: bool = False) -> str:
    """Remove patient identifiers: Pt ID, MRN, DOB, patient names, subject IDs, SSNs, emails, phones.

    Hidden characters are dropped and look-alike forms (full-width, Unicode dashes, Cyrillic and Greek
    letters) folded before matching. Text with nothing to remove comes back exactly as it was."""
    folded = unicodedata.normalize("NFKC", _INVISIBLE.sub("", text)).translate(_FOLD_TABLE)
    out = folded
    for pattern, replacement in _PHI_PATTERNS:
        out = pattern.sub(replacement, out)
    for pattern, replacement in _PHI_SHARED:
        out = pattern.sub(replacement, out)
    if notes:
        for pattern in (*_PHONE_PATTERNS, _US_PHONE_RE):
            out = pattern.sub("[phone removed]", out)
    return text if out == folded else out


_PT_ID_SHAPE = re.compile(r"\b[A-Z]?\d{9,10}-[0-9A-Z]{1,2}\b")  # the shape of a patient ID, label or not
# A product code that directly follows one of these labels is kept ("REF 1234567890-1").
_CODE_LABEL = re.compile(r"(?:ref|cat(?:alog)?|item|model|part|lot)\.?\s*(?:no\.?|#|number)?[\s:#]*$", re.I)


def _redact_id_shaped(text: str) -> str:
    """Patient IDs are often copied unlabelled into lot or notes cells, so every ID-shaped token goes
    unless it directly follows REF / Cat / Catalog / Item / Model / Part / Lot."""
    def replace(m):
        return m.group(0) if _CODE_LABEL.search(text[max(0, m.start() - 16):m.start()]) else "[removed]"
    return _PT_ID_SHAPE.sub(replace, text)


def _redact_row(rec: dict) -> dict:
    """Redact one inventory row. A labelled Pt ID is also removed where the same number is copied
    into another column (e.g. Lot Number) without its label."""
    ids = {m.group(1) for v in rec.values() if isinstance(v, str) for m in _PT_ID_RE.finditer(v)}
    ids = [i for i in ids if len(i) >= 5]  # too-short tokens would eat unrelated text
    # Also catch copies typed without the dash ("000000000412") or without the "-12" suffix.
    forms = set(ids)
    for patient_id in ids:
        for variant in (patient_id.replace("-", ""), patient_id.split("-")[0]):
            if len(variant) >= 8:  # long enough that a match elsewhere is not a coincidence
                forms.add(variant)
    ids = sorted(forms, key=len, reverse=True)  # longest first so a long form is replaced whole
    out = {}
    for key, value in rec.items():
        if isinstance(value, str):
            value = _redact_phi(value, notes=key.strip().lower() in ("notes", "note"))
            for patient_id in ids:
                value = re.sub(re.escape(patient_id), "[removed]", value, flags=re.I)
            value = _redact_id_shaped(value)
        out[key] = value
    return out


def get_inventory_records() -> list[dict]:
    """Inventory from the active source, with patient identifiers removed from every text field."""
    return [_redact_row(rec) for rec in _load_inventory_records()]


INVENTORY_CACHE_SECONDS = 60
_inventory_cache: dict = {}


def _read_sheet_inventory() -> list[dict]:
    sheet_id = os.environ.get("GOOGLE_SHEET_ID")
    if not sheet_id:
        raise HTTPException(status_code=500, detail="Missing GOOGLE_SHEET_ID.")

    client = _gspread_client()
    spreadsheet = client.open_by_key(sheet_id)
    # The "Final Inventorying" tab unless INVENTORY_WORKSHEET_TITLE names another (the read-only
    # public path uses the same default). A tab named in the setting must exist; without the setting
    # and without that tab, the first tab is read and a warning logged.
    title = os.environ.get("INVENTORY_WORKSHEET_TITLE", "").strip()
    try:
        sheet = spreadsheet.worksheet(title or "Final Inventorying")
    except gspread.WorksheetNotFound:
        if title:
            raise HTTPException(status_code=500, detail=f"Inventory tab '{title}' not found.")
        logger.warning("No 'Final Inventorying' tab: reading the first tab of the inventory sheet.")
        sheet = spreadsheet.sheet1
    all_values = sheet.get_all_values()
    if not all_values:
        return []

    header = _clean_header(all_values[0])
    records = []
    for i, row in enumerate(all_values[1:]):
        rec = {name: (row[j] if j < len(row) else "") for j, name in enumerate(header)}
        rec["_sheet_row"] = i + 2
        records.append(rec)
    return records


def _parse_inventory_csv(text: str) -> list[dict]:
    """CSV text (header row first) to records shaped like _read_sheet_inventory's."""
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return []
    header = list(rows[0])
    while header and not str(header[-1]).strip():  # gviz pads the header with empty columns
        header.pop()
    header = _clean_header(header)
    records = []
    for i, row in enumerate(rows[1:]):
        rec = {name: (row[j] if j < len(row) else "") for j, name in enumerate(header)}
        rec["_sheet_row"] = i + 2
        records.append(rec)
    return records


def _read_public_sheet_inventory() -> list[dict]:
    """The inventory tab of a link-shared sheet, read-only. With INVENTORY_WORKSHEET_GID the exact
    CSV export is used; otherwise the tab is found by name through gviz, which can blank out cells
    whose type differs from the rest of their column."""
    sheet_id = os.environ.get("GOOGLE_SHEET_ID", "").strip()
    gid = os.environ.get("INVENTORY_WORKSHEET_GID", "").strip()
    base = f"https://docs.google.com/spreadsheets/d/{sheet_id}"
    if gid:
        url, params = f"{base}/export", {"format": "csv", "gid": gid}
    else:
        title = os.environ.get("INVENTORY_WORKSHEET_TITLE", "").strip() or "Final Inventorying"
        url, params = f"{base}/gviz/tq", {"tqx": "out:csv", "sheet": title}
    try:
        resp = requests.get(url, params=params, timeout=20)
    except requests.RequestException:
        raise HTTPException(status_code=503, detail="Couldn't reach the inventory sheet. Try again shortly.")
    if resp.status_code != 200 or "text/csv" not in resp.headers.get("content-type", ""):
        # A sign-in page (HTML) means the sheet isn't shared by link.
        raise HTTPException(status_code=503, detail="Couldn't read the inventory sheet. It must be shared "
                                                    "as 'Anyone with the link can view'.")
    return _parse_inventory_csv(resp.content.decode("utf-8-sig"))


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
        ws.append_row(REQ_HEADERS, value_input_option="RAW")
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
        out.append(_row_dict(header, r))
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


def _health_email():
    return None if _auto_sample_preview() else email_svc.provider_name()


# --- Accounts: email + password for clinics and the Blueprints team (docs/AUTH_PLAN.md) ----------
# Sign up gives a working account at once (no emailed code or link). Stored by app/accounts.py: the
# database when DATABASE_URL is set, a local file on a computer, nothing when deployed without it.
# The session is an HttpOnly cookie holding a random token; the store keeps only its SHA-256 digest,
# so a session can be ended (sign out, password change or reset) and a database copy can't sign in.
# Forgot password: a team member makes a one-time link on the team dashboard and sends it.

SESSION_DAYS = 30
RESET_HOURS = 24
LOGIN_LIMIT = 10   # sign-in attempts per IP per minute (the per-account lock is in the store)
SIGNUP_LIMIT = 5   # accounts made per IP per minute
# One message for every failed sign-in, so it never says whether the email has an account.
LOGIN_FAILED = ("Wrong email or password. After 5 wrong tries in a row the account is locked "
                "for 15 minutes.")
BAD_LINK = "This reset link has expired or was already used. Ask the Blueprints team for a new one."
_ACCOUNT_EMAIL_RE = re.compile(r"^[^@\s<>\",;]+@[^@\s<>\",;]+\.[^@\s<>\",;]+$")


def _deployed() -> bool:
    return bool(os.environ.get("VERCEL") or os.environ.get("RENDER"))


def _store():
    try:
        return accounts.store()
    except accounts.Unavailable:
        raise HTTPException(status_code=503, detail="Accounts aren’t available right now. Email the Blueprints team.")


def _session_cookie() -> str:
    # The __Host- prefix makes browsers refuse the cookie unless it is Secure, host-only and
    # Path=/. Plain http://localhost cannot hold a Secure cookie in every browser, hence two names.
    return "__Host-b4p_session" if _deployed() else "b4p_session"


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(_session_cookie(), token, max_age=SESSION_DAYS * 86400, path="/",
                        httponly=True, secure=_deployed(), samesite="lax")


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(_session_cookie(), path="/", httponly=True, secure=_deployed(), samesite="lax")


def _session_token(request: Request) -> str:
    token = request.cookies.get(_session_cookie(), "")
    return token if 0 < len(token) <= 200 else ""


def current_account(request: Request) -> Optional[dict]:
    """The signed-in account ({"account_id", "email", "org_name", "role", "created_at"}) or None.
    Never raises: without a store nobody is signed in."""
    token = _session_token(request)
    if not token:
        return None
    try:
        return accounts.store().session_account(auth.token_hash(token))
    except accounts.Unavailable:
        return None


def require_account(request: Request, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"  # per-account data must never be cached
    account = current_account(request)
    if account is None:
        raise HTTPException(status_code=401, detail="Please sign in again.", headers={"Cache-Control": "no-store"})
    return account


def _me(account: dict) -> dict:
    return {"email": account["email"], "org_name": account["org_name"], "role": account["role"]}


def _clean_account_email(v: str) -> str:
    v = unicodedata.normalize("NFKC", v).strip()
    if not _ACCOUNT_EMAIL_RE.match(v) or len(v) > 254:
        raise ValueError("must be an email address")
    return v


class SignupBody(BaseModel):
    email: str = Field(max_length=254)
    org_name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=auth.MIN_PASSWORD, max_length=auth.MAX_PASSWORD)

    @field_validator("email")
    @classmethod
    def email_shape(cls, v: str) -> str:
        return _clean_account_email(v)

    @field_validator("org_name")
    @classmethod
    def org_not_blank(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("cannot be empty")
        return _redact_phi(v)


class LoginBody(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=1, max_length=auth.MAX_PASSWORD)


class ResetBody(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=auth.MIN_PASSWORD, max_length=auth.MAX_PASSWORD)


class ChangePasswordBody(BaseModel):
    current_password: str = Field(min_length=1, max_length=auth.MAX_PASSWORD)
    new_password: str = Field(min_length=auth.MIN_PASSWORD, max_length=auth.MAX_PASSWORD)


class ResetLinkBody(BaseModel):
    email: str = Field(max_length=254)


@app.post("/api/auth/signup")
def auth_signup(body: SignupBody, request: Request, response: Response):
    """Make the account and sign in. An email that already has an account gets a clear message:
    with nothing emailed, there's no way to hide that and still help the person."""
    _check_rate("signup:" + _client_ip(request), SIGNUP_LIMIT)
    response.headers["Cache-Control"] = "no-store"
    store = _store()
    account_id = store.create_account(body.email, body.org_name, auth.hash_password(body.password))
    if account_id is None:
        raise HTTPException(status_code=409, detail="That email already has an account. Sign in instead.")
    token, digest = auth.new_token()
    store.start_session(account_id, digest, SESSION_DAYS)
    _set_session_cookie(response, token)
    return _me(store.session_account(digest))


@app.post("/api/auth/login")
def auth_login(body: LoginBody, request: Request, response: Response):
    _check_rate("login:" + _client_ip(request), LOGIN_LIMIT)
    response.headers["Cache-Control"] = "no-store"
    failed = HTTPException(status_code=401, detail=LOGIN_FAILED, headers={"Cache-Control": "no-store"})
    store = _store()
    row = store.login_row(body.email.strip())
    if row is None or row["locked"] or row["disabled"]:
        auth.burn(body.password)  # take as long as a real check would
        raise failed
    if not auth.verify_password(body.password, row["password_hash"]):
        store.record_failed_login(row["account_id"])
        raise failed
    token, digest = auth.new_token()
    store.start_session(row["account_id"], digest, SESSION_DAYS)
    _set_session_cookie(response, token)
    return _me(store.session_account(digest))


@app.post("/api/auth/logout")
def auth_logout(request: Request, response: Response):
    token = _session_token(request)
    if token:
        try:
            accounts.store().end_session(auth.token_hash(token))
        except accounts.Unavailable:
            pass
    _clear_session_cookie(response)
    return {"ok": True}


@app.get("/api/auth/me")
def auth_me(account: dict = Depends(require_account)):
    return _me(account)


@app.post("/api/auth/password/change")
def auth_change_password(body: ChangePasswordBody, request: Request, response: Response,
                         account: dict = Depends(require_account)):
    """Needs the current password, so a borrowed browser can't take the account over. Wrong
    guesses count toward the same lock as sign-in. Other browsers are signed out; this one stays in."""
    _check_rate("login:" + _client_ip(request), LOGIN_LIMIT)
    store = _store()
    row = store.login_row(account["email"])
    wrong = HTTPException(status_code=403, detail="Your current password isn’t right.",
                          headers={"Cache-Control": "no-store"})
    if row is None or row["locked"]:
        auth.burn(body.current_password)
        raise wrong
    if not auth.verify_password(body.current_password, row["password_hash"]):
        store.record_failed_login(row["account_id"])
        raise wrong
    store.set_password(row["account_id"], auth.hash_password(body.new_password))
    token, digest = auth.new_token()
    store.start_session(row["account_id"], digest, SESSION_DAYS)
    _set_session_cookie(response, token)
    return {"ok": True}


@app.post("/api/auth/password/reset")
def auth_reset_password(body: ResetBody, request: Request, response: Response):
    """Redeem a team-made reset link: set the new password (every other session ends) and sign in."""
    _check_rate("login:" + _client_ip(request), LOGIN_LIMIT)
    response.headers["Cache-Control"] = "no-store"
    store = _store()
    account_id = store.reset_password(auth.token_hash(body.token), auth.hash_password(body.password))
    if account_id is None:
        raise HTTPException(status_code=400, detail=BAD_LINK)
    token, digest = auth.new_token()
    store.start_session(account_id, digest, SESSION_DAYS)
    _set_session_cookie(response, token)
    return _me(store.session_account(digest))


# Blueprints team: accounts with role "hq" (made with `python -m app.create_team_account`).
@app.get("/api/team/accounts", dependencies=[Depends(require_hq)])
def team_list_accounts(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return [{**a, "created_at": str(a.get("created_at") or ""), "last_login_at": str(a.get("last_login_at") or "")}
            for a in _store().list_accounts()]


@app.post("/api/team/accounts/reset-link", dependencies=[Depends(require_hq)])
def team_reset_link(body: ResetLinkBody, response: Response):
    """A one-time password reset link for one account, good for RESET_HOURS. Only the token is
    returned; the page builds the link from its own address, and the store keeps only a digest."""
    response.headers["Cache-Control"] = "no-store"
    token, digest = auth.new_token()
    if not _store().create_reset_token(body.email.strip(), digest, RESET_HOURS):
        raise HTTPException(status_code=404, detail="No account has that email.")
    return {"token": token, "hours": RESET_HOURS}


# Is this email domain real? Sent the domain only (not the address); see app/email_check.py.
# The page shows a friendly warning for "no-domain", "no-mail" and "disposable", and never stops
# anyone on "unknown". Plain def: FastAPI runs it in a thread, so a slow lookup blocks nothing.
@app.get("/api/auth/check-email")
def clinic_check_email(domain: str, request: Request, response: Response):
    _check_rate("check:" + _client_ip(request), 30)
    response.headers["Cache-Control"] = "no-store"
    if len(domain) > 253 or not re.fullmatch(r"[A-Za-z0-9.-]+", domain.strip()):
        return {"domain": domain[:253], "result": "no-domain"}
    return {"domain": domain.strip().lower(), "result": email_check.check_domain(domain)}


@app.get("/health")
def health():
    if db.enabled():
        out = {"source": "postgres", "ok": db.ping(), "email": _health_email()}
        if request_webhook.configured():
            out["requests_sheet"] = request_webhook.status()
        return out
    if _use_sample_data():
        source = "sample"
    elif _public_sheet():
        source = "sheet-public"  # the live sheet, read-only through its CSV export
    else:
        source = "sheet"
    out = {"source": source, "ok": True, "email": _health_email()}
    if request_webhook.configured():
        out["requests_sheet"] = request_webhook.status()
    return out


PUBLIC_CACHE = "public, max-age=60, stale-while-revalidate=300"


def _cached_json(request: Request, data) -> Response:
    """JSON with a short browser/CDN cache and a weak ETag, so repeat loads can be a 304."""
    body = json.dumps(jsonable_encoder(data), separators=(",", ":"), ensure_ascii=False).encode()
    etag = 'W/"' + hashlib.sha1(body).hexdigest() + '"'
    headers = {"Cache-Control": PUBLIC_CACHE, "ETag": etag}
    # If-None-Match may list several tags and may carry the W/ prefix; compare without it.
    sent = {t.strip().removeprefix("W/") for t in request.headers.get("if-none-match", "").split(",")}
    if "*" in sent or etag.removeprefix("W/") in sent:  # "*" matches any existing representation
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)


# --- product photos (Google Drive links in the sheet's Image URL column) -----------------------
_DRIVE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{20,100}$")
_DRIVE_HOSTS = ("drive.google.com", "docs.google.com")
# Words that mean a row is about a patient or trial-subject sample: its photo may show the label.
# "Patient" on its own is product wording ("single patient use", "patient preoperative skin
# preparation", "patient drape"), so it counts only next to something that identifies a person or
# a sample taken from one. The short forms (pt, pat) still always count.
_PATIENT_WORDS_RE = re.compile(
    r"\b(?:pt|pat)\b|\bpatient(?:'s|s)?\s*(?:id\b|identifier|name|number|no\b|no\.|#|label|sticker|"
    r"info|record|chart|initials?|\bdob\b|mrn|sample|specimen|blood|urine|plasma|serum|tissue)"
    r"|\bmrn\b|\bmed\.?\s*rec|medical\s+record|\bd\.?o\.?b\b|date\s+of\s+birth"
    r"|\bsubj(?:ect)?s?\b|\bparticipant|\bpre-?dose|\bpost-?dose|\bscreening\b|\bC\d{1,2}D\d{1,2}\b", re.I)
# Containers that may hold a used sample (and so carry a patient or subject label): no photo at all.
_SAMPLE_CONTAINER_RE = re.compile(
    r"\b(?:sample|specimen|test|blood\s+collection|urine|culture)\s+(?:collection\s+)?"
    r"(?:tubes?|vials?|containers?|cups?|bottles?)\b", re.I)


def _is_image_col(key: str) -> bool:
    return key.strip().lower() == "image url"


def _drive_file_id(url) -> Optional[str]:
    """The file ID of a Google Drive link (/file/d/ID/..., open?id=ID, uc?id=ID); None for anything else."""
    if not isinstance(url, str):
        return None
    m = re.match(r"^https://([a-z.]+)/(.*)$", url.strip())
    if not m or m.group(1) not in _DRIVE_HOSTS:
        return None
    path = m.group(2)
    found = re.match(r"^file/d/([^/?#]+)", path) or re.search(r"[?&]id=([^&#]+)", path)
    file_id = found.group(1) if found else ""
    return file_id if _DRIVE_ID_RE.match(file_id) else None


def _photo_may_show_patient(raw: dict, redacted: dict) -> bool:
    """True when a row's text had patient details removed, its Name or Notes talk about a patient or
    trial subject, or it is a sample container (tube, vial...): a photo of it can show a label with
    the same details, so it is never sent."""
    for key, value in raw.items():
        if isinstance(value, str) and not _is_image_col(key) and redacted.get(key) != value:
            return True
    text = " ".join(str(raw.get(k) or "") for k in raw if k.strip().lower() in ("name", "notes", "note"))
    kind = " ".join(str(raw.get(k) or "") for k in raw if k.strip().lower() in ("name", "general"))
    name = next((str(v or "").strip() for k, v in raw.items() if k.strip().lower() == "name"), "")
    # A name that is only a code ("K012762892", "AP237146K01") is usually a sample's accession label.
    code_only = bool(re.fullmatch(r"[A-Za-z]{0,4}\d[A-Za-z0-9-]{5,}", name)) and sum(c.isdigit() for c in name) >= 6
    return bool(_PATIENT_WORDS_RE.search(text) or _SAMPLE_CONTAINER_RE.search(kind) or code_only)


def _with_safe_photo(raw: dict, redacted: dict) -> dict:
    """The redacted row, with Image URL replaced by a clean Drive link, or removed when there is
    no usable link or the photo might show patient details."""
    out = {k: v for k, v in redacted.items() if not _is_image_col(k)}
    url = next((v for k, v in raw.items() if _is_image_col(k)), None)
    file_id = _drive_file_id(url)
    if file_id and not _photo_may_show_patient(raw, redacted):
        out["Image URL"] = f"https://drive.google.com/file/d/{file_id}/view"
    return out


# The only inventory columns the site uses. Anything else in the sheet (a new column, notes for
# the team, "Overflow", ...) is never sent to the public, and the download stays smaller.
PUBLIC_SUPPLY_COLUMNS = {
    "Manufacturer Name", "Category", "Subcategory", "General", "Name", "Lot Number", "Notes", "Quantity",
    "Date of Expiration", "Pallet Number", "Box Number", "Review", "Image URL", "_sheet_row",
}


@app.get("/api/supplies")
async def supplies(request: Request):
    raw_rows = _load_inventory_records()
    rows = [{k: v for k, v in _with_safe_photo(raw, _redact_row(raw)).items() if k in PUBLIC_SUPPLY_COLUMNS}
            for raw in raw_rows]
    return _cached_json(request, rows)


@app.get("/api/requests", dependencies=[Depends(require_hq)])  # the whole internal tab: HQ only
async def list_requests():
    if _requests_in_memory():
        return []

    spreadsheet = _open_requests_spreadsheet()
    ws = get_requests_worksheet(spreadsheet)
    ensure_request_headers(ws)
    return read_request_rows(ws)


@app.post("/api/requests", dependencies=[Depends(rate_limit_post), Depends(require_hq)])  # legacy internal form: HQ only
async def submit_request(body: SubmitRequestBody):
    inventory = get_inventory_records()
    valid_rows = {int(r["_sheet_row"]) for r in inventory if "_sheet_row" in r}
    for line in body.items:
        if line.sheet_row not in valid_rows:
            raise HTTPException(
                status_code=400,
                detail=f"inventory_sheet_row {line.sheet_row} is not a current inventory row.",
            )

    if _requests_in_memory():
        cid = (body.client_request_id or "").strip()
        if cid:
            if cid in _sample_client_request_ids:
                raise HTTPException(status_code=409, detail="Duplicate submission.")
            _sample_client_request_ids.add(cid)
        return {
            "ok": True,
            "message": "Kept in memory only (sample or read-only sheet mode); nothing was written to Google Sheets.",
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
        batch.append([_sheet_safe(c) for c in [
            group_id, ts, body.nametag, line.sheet_row,
            str(name), str(mfr), str(cat), line.quantity,
            body.request_notes.strip(), "Pending",
            (body.client_request_id or "").strip(),
        ]])

    ws.append_rows(batch, value_input_option="RAW")

    return {"ok": True, "request_group_id": group_id, "lines": len(batch), "submitted_at_utc": ts}


ORG_REQ_HEADERS = [
    "Request ID", "Org Name", "Org Email", "Item Name",
    "Category", "Quantity Requested", "Status", "Timestamp", "Review Flag",
]


MAX_ITEMS = 100
EMAIL_RE = re.compile(r"^[^@\s<>\",;]+@[^@\s<>\",;]+\.[^@\s<>\",;]+$")  # no , or ; : the To header is comma-joined


class OrgCartItemIn(BaseModel):
    item_name: str = Field(min_length=1, max_length=500)
    category: str = Field(default="", max_length=200)
    quantity: int = Field(strict=True, ge=1, le=10000)  # the DB contract wants a JSON number
    sheet_row: Optional[int] = Field(default=None, ge=2, le=500000)

    @field_validator("category")
    @classmethod
    def category_redacted(cls, v: str) -> str:
        return _redact_phi(v.strip())  # stored, emailed to HQ and returned by /requests

    @field_validator("item_name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        v = _redact_phi(v.strip())  # clinics submit the display name, which may carry a patient ID
        if not v:  # a blank name would match every blank-named inventory row
            raise ValueError("cannot be empty")
        return v


class OrgRequestBody(BaseModel):
    org_name: str = Field(min_length=1, max_length=200)
    org_email: str = Field(min_length=1, max_length=254)
    items: list[OrgCartItemIn] = Field(min_length=1, max_length=MAX_ITEMS)
    # Made once per checkout in the browser and reused on retry, so a retry never makes a second request.
    client_request_id: Optional[str] = Field(default=None, pattern=r"^[A-Za-z0-9-]{8,80}$")

    @field_validator("org_name", "org_email")
    @classmethod
    def strip_nonempty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("cannot be empty")
        return v

    @field_validator("org_name")
    @classmethod
    def org_name_redacted(cls, v: str) -> str:
        return _redact_phi(v)  # the clinic name is stored, emailed and returned by /requests too

    @field_validator("org_email")
    @classmethod
    def valid_email(cls, v: str) -> str:
        if not EMAIL_RE.match(v):
            raise ValueError("invalid email address")
        return v


class StatusUpdateBody(BaseModel):
    status: Literal["Approved", "Shipped", "Delivered", "Denied", "Cancelled"]


# Same rules the database enforces in set_request_status(): a request only moves forward, and can be
# Denied or Cancelled only while it is Under Review or Approved.
STATUS_ORDER = ["Under Review", "Approved", "Shipped", "Delivered"]


def _check_transition(current: set[str], new: str) -> None:
    """409 unless every line can move to `new` (lines already at `new` are fine)."""
    for old in current - {new}:
        if new in ("Denied", "Cancelled"):
            allowed = old in ("Under Review", "Approved")
        else:
            allowed = old in STATUS_ORDER and STATUS_ORDER.index(old) < STATUS_ORDER.index(new)
        if not allowed:
            raise HTTPException(status_code=409, detail="That status change is not allowed.")


_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def _sheet_safe(v):
    """Defense in depth for user text written to the sheet (we also write with RAW).

    A leading apostrophe makes Sheets treat a cell starting with = + - @ as plain text.
    Numbers pass through untouched. _sheet_unsafe() undoes this when reading back.
    """
    if isinstance(v, str) and v[:1] in _FORMULA_START:
        return "'" + v
    return v


def _sheet_unsafe(v):
    """Remove the apostrophe _sheet_safe added, so it never shows up in the UI."""
    if isinstance(v, str) and v[:1] == "'" and v[1:2] in _FORMULA_START:
        return v[1:]
    return v


def _row_dict(header: list[str], row: list[str]) -> dict:
    return {header[j]: _sheet_unsafe(row[j] if j < len(row) else "") for j in range(len(header))}


def _make_request_id() -> str:
    ts = int(datetime.now(timezone.utc).timestamp())
    suffix = secrets.token_hex(3)  # unguessable; PATCH is keyed on this id in sheet mode
    return f"REQ-{ts}-{suffix}"


def _request_id_for(client_request_id: Optional[str]) -> str:
    """The same client id always maps to the same request id; no client id gives a fresh random one."""
    if not client_request_id:
        return _make_request_id()
    digest = hashlib.sha256(client_request_id.encode()).hexdigest()
    return f"REQ-{1_000_000_000 + int(digest[:9], 16) % 9_000_000_000}-{digest[9:15]}"  # same shape as _make_request_id


def _item_id_for(line: "OrgCartItemIn", item_ids: dict) -> dict:
    """{"item_id": ...} only if the sheet row still holds the item the clinic picked: rows shift when
    someone inserts or deletes in the sheet between loading the catalog and submitting.

    The line name must be the row's name (or general name) with the lot suffix stripped, or, for items
    shown as "Name (Maker)", that name followed by the row's own manufacturer. A line that names its lot
    ("[Lot X, Box Y, Pallet Z]") must match the row's lot, box and pallet. A bare name with no lot and no
    maker is accepted only if exactly one active row has that name; otherwise another lot would match."""
    row = item_ids.get(line.sheet_row) if line.sheet_row else None
    if not row:
        return {}
    base = _norm_name(_base_item_name(line.item_name))
    names = {_norm_name(n) for n in row["names"] if n}
    maker = _norm_name(row["maker"]) if row["maker"] else ""
    with_maker = bool(maker) and any(base == f"{n} ({maker})" for n in names)
    if base not in names and not with_maker:
        return {}
    parts = _lot_parts(line.item_name)
    if parts:
        have = (_norm_name(row["lot"]), _norm_name(row["box"]), _norm_name(row["pallet"]))
        if any(want and want != got for want, got in zip(parts, have)):
            return {}
    elif not with_maker and row["same_name"] != 1:
        return {}
    return {"item_id": row["id"]}


def _same_request(rows: list[dict], body: "OrgRequestBody") -> bool:
    """True if the stored lines of a request are exactly what this body asks for (same clinic, same items)."""
    if not rows:
        return False
    first = rows[0]
    if (first.get("Org Name", "").strip() != body.org_name.strip()
            or first.get("Org Email", "").strip().lower() != body.org_email.strip().lower()):
        return False
    stored = sorted((r.get("Item Name", "").strip(), str(r.get("Quantity Requested", "")).strip()) for r in rows)
    asked = sorted((i.item_name.strip(), str(i.quantity)) for i in body.items)
    return stored == asked


def _client_id_conflict() -> HTTPException:
    # Deliberately says nothing about the other request (its id, clinic or items).
    return HTTPException(status_code=409, detail="This request id was already used for a different request. Reload and submit again.")


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
        ws.append_row(ORG_REQ_HEADERS, value_input_option="RAW")
    elif first_row[0] != ORG_REQ_HEADERS[0]:
        raise HTTPException(
            status_code=500,
            detail=f"Worksheet '{title}' has unexpected headers. Expected 'Request ID'.",
        )
    return ws


LOT_SUFFIX_RE = re.compile(r"\s*\[Lot [^\]]*\]$")


def _base_item_name(name: str) -> str:
    """Drop the trailing "[Lot X, Box Y, Pallet Z]" the UI appends so HQ knows what to pull.

    The full name is stored and emailed; only matching against inventory uses the base name.
    """
    return LOT_SUFFIX_RE.sub("", name.strip(), count=1)


LOT_PARTS_RE = re.compile(r"\[Lot (.*?), Box (.*?), Pallet (.*?)\]$")


def _lot_parts(name: str) -> Optional[tuple[str, str, str]]:
    """(lot, box, pallet) from the UI's trailing "[Lot X, Box Y, Pallet Z]"; None without one."""
    m = LOT_PARTS_RE.search(name.strip())
    if not m:
        return None
    return tuple("" if p.strip() in ("", "—", "-") else _norm_name(p) for p in m.groups())  # type: ignore[return-value]


def _norm_name(name: str) -> str:
    """Compare item names ignoring case, padding, inner whitespace and NBSP-style variants."""
    return " ".join(unicodedata.normalize("NFKC", name).casefold().split())


def _review_flag(inventory: list[dict], item_name: str) -> bool:
    needle = _norm_name(_base_item_name(item_name))
    for rec in inventory:
        if _norm_name(rec.get("Name") or rec.get("name") or "") == needle:
            review = (rec.get("Review") or "").strip()
            return review.lower() in ("review needed", "yes")
    return False


def _inventory_primary_key(record: dict) -> str:
    for key, value in record.items():
        if key == "_sheet_row":
            continue
        return str(value).strip()
    return ""


SERVERLESS_EMAIL_BUDGET = 5  # seconds in total per request on Vercel


def _deliver(tasks: BackgroundTasks, *jobs: tuple) -> None:
    """Run (function, *args) email jobs. Never raises: email must not fail a saved request.

    Normally they run after the response (BackgroundTasks). On Vercel the function may be frozen
    once the response is sent, so send now, in parallel, waiting at most a few seconds.
    """
    if _auto_sample_preview():
        return  # preview with demo data: never email anyone
    if not os.environ.get("VERCEL"):
        for fn, *args in jobs:
            tasks.add_task(fn, *args)
        return
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=max(len(jobs), 1))
    try:
        concurrent.futures.wait([pool.submit(fn, *args) for fn, *args in jobs],
                                timeout=SERVERLESS_EMAIL_BUDGET)
    except Exception:
        logger.exception("email delivery failed")
    finally:
        pool.shutdown(wait=False)


def _queue_submit_emails(tasks: BackgroundTasks, body: OrgRequestBody, request_id: str,
                         flagged: list[str], client_ip: str = "") -> None:
    """Confirmation + HQ alert run after the response, so a slow provider never blocks users."""
    if os.environ.get("EMAIL_ON_SUBMIT", "true").strip().lower() in ("false", "0", "no", "off"):
        return
    items = [{"item_name": i.item_name, "category": i.category, "quantity": i.quantity}
             for i in body.items]
    _deliver(tasks,
             (email_svc.send_org_confirmation, body.org_name, body.org_email, items, request_id, client_ip),
             (email_svc.send_hq_alert, body.org_name, body.org_email, items, request_id, flagged))


def _review_flags(body: OrgRequestBody) -> list[bool]:
    """Which requested items the inventory marks 'Review needed' (HQ must check them)."""
    try:
        inventory = get_inventory_records()
    except Exception:  # a flaky inventory read must not block saving the request
        return [False] * len(body.items)
    return [_review_flag(inventory, i.item_name) for i in body.items]


def _org_request_rows(request_id: str, body: "OrgRequestBody", flags: list[bool], ts: str) -> list[list]:
    """A request as rows of the Requests tab (ORG_REQ_HEADERS), one per supply."""
    return [
        [_sheet_safe(c) for c in [request_id, body.org_name, body.org_email, item.item_name,
                                  item.category, item.quantity, "Under Review", ts, "TRUE" if flag else "FALSE"]]
        for item, flag in zip(body.items, flags)
    ]


def _copy_to_request_sheet(request_id: str, body: "OrgRequestBody", flags: list[bool], ts: str) -> str:
    """Send the request to the Apps Script request sheet, when one is set up ("ok", "failed" or
    "unknown"; see request_webhook.send). Never raises: a sheet problem is only logged."""
    if not request_webhook.configured():
        return "failed"
    try:
        return request_webhook.send(ORG_REQ_HEADERS, _org_request_rows(request_id, body, flags, ts), request_id)
    except Exception:
        logger.exception("Couldn't copy request %s to the request sheet", request_id)
        return "unknown"


def _sign_in_required() -> bool:
    return accounts._deployed()


@app.post("/requests")
def submit_org_request(body: OrgRequestBody, tasks: BackgroundTasks, request: Request,
                       _rl: None = Depends(rate_limit_post)):
    client_ip = _client_ip(request)
    account = current_account(request)
    if account is None and _sign_in_required():  # live site: only signed-in clinics can hold supplies
        raise HTTPException(status_code=401, detail="Please sign in to send a request.")
    if account:  # signed in: the account says who this is, not the browser
        body = body.model_copy(update={"org_name": _redact_phi(account["org_name"]), "org_email": account["email"]})
    if db.enabled():
        request_id = _request_id_for(body.client_request_id)
        with _claim_lock:
            if body.client_request_id and db.request_exists(request_id):  # already saved: a retry, or a clash
                if not _same_request(db.request_lines(request_id), body):
                    raise _client_id_conflict()
                return {"request_id": request_id, "status": "Under Review"}  # a true retry: no second email
            _check_enough_left(body)
            flags = _review_flags(body)
            try:  # the inventory item each line was picked from; a lookup failure never blocks the request
                item_ids = db.item_ids_for_rows([i.sheet_row for i in body.items if i.sheet_row])
            except Exception:
                item_ids = {}
            request_id = db.create_request(body.org_name, body.org_email, [
                {"item_name": i.item_name, "category": i.category, "quantity": i.quantity,
                 "review_flag": flag,
                 **_item_id_for(i, item_ids)}
                for i, flag in zip(body.items, flags)
            ], request_id=request_id if body.client_request_id else None)
        _copy_to_request_sheet(request_id, body, flags, datetime.now(timezone.utc).isoformat())
        _queue_submit_emails(tasks, body, request_id,
                             [i.item_name for i, flag in zip(body.items, flags) if flag], client_ip)
        return {"request_id": request_id, "status": "Under Review"}

    flags = _review_flags(body)
    flagged = [i.item_name for i, f in zip(body.items, flags) if f]

    if _requests_in_memory():
        request_id = _request_id_for(body.client_request_id)
        with _claim_lock:
            existing = [r for r in _sample_org_request_rows if r["Request ID"] == request_id]
            if body.client_request_id and existing:
                if not _same_request(existing, body):
                    raise _client_id_conflict()
                return {"request_id": request_id, "status": "Under Review", "message": "Kept in memory only."}
            _check_enough_left(body)
            ts = datetime.now(timezone.utc).isoformat()
            for item, flag in zip(body.items, flags):
                _sample_org_request_rows.append({
                    "Request ID": request_id, "Org Name": body.org_name,
                    "Org Email": body.org_email, "Item Name": item.item_name,
                    "Category": item.category, "Quantity Requested": str(item.quantity),
                    "Status": "Under Review", "Timestamp": ts, "Review Flag": "TRUE" if flag else "FALSE",
                })
        _copy_to_request_sheet(request_id, body, flags, ts)
        _queue_submit_emails(tasks, body, request_id, flagged, client_ip)
        return {"request_id": request_id, "status": "Under Review", "message": "Kept in memory only."}

    request_id = _request_id_for(body.client_request_id)
    ts = datetime.now(timezone.utc).isoformat()

    batch = _org_request_rows(request_id, body, flags, ts)

    spreadsheet = _open_requests_spreadsheet()
    ws = _org_requests_worksheet(spreadsheet)
    with _claim_lock:  # here the sheet is the store, so the lock covers writing it
        if body.client_request_id:
            values = ws.get_all_values()
            header = values[0] if values else []
            existing = [_row_dict(header, r) for r in values[1:] if r and r[0] == request_id]
            if existing:  # already saved: a retry, or a clash
                if not _same_request(existing, body):
                    raise _client_id_conflict()
                return {"request_id": request_id, "status": "Under Review"}
        _check_enough_left(body)
        # One writer per request, never both: the request sheet's web app when it's set up, else (or
        # when the web app certainly didn't save it) the service account. "unknown" (e.g. a timeout
        # after sending) may already be saved, so it isn't written again; /health shows the error.
        if _copy_to_request_sheet(request_id, body, flags, ts) == "failed":
            ws.append_rows(batch, value_input_option="RAW")

    _queue_submit_emails(tasks, body, request_id, flagged, client_ip)
    return {"request_id": request_id, "status": "Under Review"}


@app.patch("/requests/{request_id}/status", dependencies=[Depends(require_hq)])
async def update_org_request_status(request_id: str, body: StatusUpdateBody, tasks: BackgroundTasks):
    if db.enabled():
        rows = [r for r in db.get_requests() if r["Request ID"].strip() == request_id]
        if not rows:
            raise HTTPException(status_code=404, detail=f"Request ID '{request_id}' not found.")
        if all(r["Status"].strip() == body.status for r in rows):
            return {"request_id": request_id, "status": body.status, "changed": False}
        try:
            found = db.set_request_status(request_id, body.status)
        except psycopg.errors.NoDataFound:  # SQLSTATE P0002: unknown id
            raise HTTPException(status_code=404, detail=f"Request ID '{request_id}' not found.")
        except psycopg.errors.RaiseException as exc:
            # "cannot change request ..." is a refused transition; anything else is bad input (400).
            if str(exc).startswith("cannot change request"):
                raise HTTPException(status_code=409, detail="That status change is not allowed.")
            raise
        except psycopg.errors.CheckViolation:
            raise HTTPException(status_code=409, detail="That status change is not allowed.")
        if not found:
            raise HTTPException(status_code=404, detail=f"Request ID '{request_id}' not found.")
        if rows[0]["Org Email"]:
            items = [
                {"item_name": r["Item Name"], "category": r["Category"], "quantity": r["Quantity Requested"]}
                for r in rows
            ]
            _deliver(tasks, (email_svc.send_status_update, rows[0]["Org Name"], rows[0]["Org Email"],
                             body.status, items, request_id))
        _inventory_cache.clear()
        return {"request_id": request_id, "status": body.status}

    if _requests_in_memory():
        rows = [r for r in _sample_org_request_rows if r.get("Request ID", "").strip() == request_id]
        if not rows:
            raise HTTPException(status_code=404, detail=f"Request ID '{request_id}' not found.")
        current = {r["Status"].strip() for r in rows}
        if current == {body.status}:
            return {"request_id": request_id, "status": body.status, "changed": False}
        _check_transition(current, body.status)
        for row in rows:
            row["Status"] = body.status
        _inventory_cache.clear()
        if rows[0]["Org Email"]:
            items = [{"item_name": r["Item Name"], "category": r["Category"],
                      "quantity": r["Quantity Requested"]} for r in rows]
            _deliver(tasks, (email_svc.send_status_update, rows[0]["Org Name"], rows[0]["Org Email"],
                             body.status, items, request_id))
        return {"request_id": request_id, "status": body.status, "updated_rows": len(rows)}

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
    current_statuses: set[str] = set()

    for i, row in enumerate(all_rows[1:], start=2):
        if len(row) > id_col and row[id_col].strip() == request_id:
            matching_sheet_rows.append(i)
            current_statuses.add(row[status_col].strip() if len(row) > status_col else "")
            if not org_name and len(row) > org_name_col:
                org_name = _sheet_unsafe(row[org_name_col])
            if not org_email and len(row) > org_email_col:
                org_email = row[org_email_col]
            items.append({
                "item_name": _sheet_unsafe(row[item_name_col]) if len(row) > item_name_col else "",
                "category": _sheet_unsafe(row[category_col]) if len(row) > category_col else "",
                "quantity": row[qty_col] if len(row) > qty_col else "",
            })

    if not matching_sheet_rows:
        raise HTTPException(status_code=404, detail=f"Request ID '{request_id}' not found.")

    if current_statuses == {body.status}:
        return {"request_id": request_id, "status": body.status, "changed": False}
    _check_transition(current_statuses, body.status)

    sheet_status_col = status_col + 1
    ws.batch_update([
        {"range": gspread.utils.rowcol_to_a1(r, sheet_status_col), "values": [[body.status]]}
        for r in matching_sheet_rows
    ])

    _inventory_cache.clear()  # HQ sees the effect on this instance at once (others: within 60s)
    if org_email:
        _deliver(tasks, (email_svc.send_status_update, org_name, org_email, body.status, items, request_id))

    return {"request_id": request_id, "status": body.status}


# Units a request holds until the team acts on it: shown availability is the sheet quantity minus
# every Under Review and Approved line. Denied and Cancelled give the units back. Shipped and
# Delivered are counted by the warehouse taking them off the sheet's quantity, so they don't hold
# anything here (holding them too would count those units twice).
HOLDING_STATUSES = ("Under Review", "Approved")
_HOLDING = {s.casefold() for s in HOLDING_STATUSES}  # the team edits the sheet by hand
_claim_lock = threading.Lock()  # one submit at a time between "how many are left" and saving it


def _request_rows_for_holds() -> list[dict]:
    """Every request line this server can see (all statuses), as Requests-tab dicts."""
    org_requests: list[dict] = []
    if db.enabled():
        try:
            org_requests = db.get_requests()
        except Exception:
            pass
    elif _requests_in_memory():
        org_requests = list(_sample_org_request_rows)
        if not _use_sample_data() and request_webhook.configured():
            # Requests sent from other servers (or before a restart) are only in the request sheet.
            here = {r.get("Request ID") for r in org_requests}
            org_requests += [r for r in (request_webhook.active_lines() or []) if r.get("Request ID") not in here]
    else:
        try:
            spreadsheet = _open_requests_spreadsheet()
            ws = _org_requests_worksheet(spreadsheet)
            all_rows = ws.get_all_values()
            if len(all_rows) > 1:
                header = all_rows[0]
                for r in all_rows[1:]:
                    if any(cell.strip() for cell in r):
                        org_requests.append(_row_dict(header, r))
        except Exception:
            pass
    return org_requests


def _stock(rec: dict) -> Optional[int]:
    try:
        # float() first: Sheets can export whole numbers as "12.0"
        return max(int(float(str(rec.get("Quantity") or rec.get("quantity") or "").strip().replace(",", ""))), 0)
    except (ValueError, OverflowError):
        return None


def _remaining_by_row(inventory: list[dict], org_requests: list[dict]) -> tuple[list[Optional[int]], set]:
    """Per inventory row: units left after the holding requests (None when the sheet has no
    count), and the names that have any hold."""
    held_by_name: dict[str, int] = {}
    held_exact: dict[tuple, int] = {}  # (name, (lot, box, pallet)) -> qty, for lines naming their lot
    for r in org_requests:
        status = (r.get("Status") or "").strip() or "Under Review"
        if status.casefold() not in _HOLDING:
            continue
        full = r.get("Item Name", "")
        key = _norm_name(_base_item_name(full))
        try:
            qty_asked = int(float(str(r.get("Quantity Requested", "0")).strip()))
        except (ValueError, OverflowError):
            qty_asked = 1
        qty_asked = max(qty_asked, 0)
        held_by_name[key] = held_by_name.get(key, 0) + qty_asked
        parts = _lot_parts(full)
        if parts:
            held_exact[(key, parts)] = held_exact.get((key, parts), 0) + qty_asked

    # A request line that names its lot ("[Lot X, Box Y, Pallet Z]") holds that exact row, so it does
    # not reduce another manufacturer's or lot's row of the same name. Whatever is left, and lines
    # without a lot, are spread over the name's rows in order (first lot first), so a small lot reads 0
    # after a small request and a big lot is not reduced by it.
    def _row_key(rec: dict):
        name = _norm_name((rec.get("Name") or rec.get("name") or "").strip())
        parts = tuple(_norm_name(str(rec.get(col) or "").strip()) for col in ("Lot Number", "Box Number", "Pallet Number"))
        return name, parts

    held_by_row: dict[int, int] = {}
    left_to_hold = dict(held_by_name)
    exact_left = dict(held_exact)
    for idx, rec in enumerate(inventory):
        qty = _stock(rec)
        rk = _row_key(rec)
        if qty is None or not exact_left.get(rk):
            continue
        held_by_row[idx] = min(qty, exact_left[rk])
        exact_left[rk] -= held_by_row[idx]
        left_to_hold[rk[0]] -= held_by_row[idx]
    remaining: list[Optional[int]] = []
    for idx, rec in enumerate(inventory):
        qty = _stock(rec)
        key = _norm_name((rec.get("Name") or rec.get("name") or "").strip())
        held = held_by_row.get(idx, 0)
        if qty is not None and left_to_hold.get(key) and qty - held > 0:
            extra = min(qty - held, left_to_hold[key])
            held += extra
            left_to_hold[key] -= extra
        remaining.append(None if qty is None else qty - held)
    return remaining, {k for k, v in held_by_name.items() if v}


def _check_enough_left(body: "OrgRequestBody") -> None:
    """Refuse (409) a request for more than is left of a batch, saying how many are left. Run under
    _claim_lock, together with saving the request, so two clinics can't take the same last units."""
    try:
        inventory = get_inventory_records()
        remaining, _ = _remaining_by_row(inventory, _request_rows_for_holds())
    except Exception:  # the list can't be read right now: never block a request over it
        logger.warning("Couldn't check what's left before saving a request", exc_info=True)
        return
    by_row = {rec.get("_sheet_row"): idx for idx, rec in enumerate(inventory) if rec.get("_sheet_row") is not None}
    rows_named: dict[str, list[int]] = {}
    for idx, rec in enumerate(inventory):
        rows_named.setdefault(_norm_name((rec.get("Name") or rec.get("name") or "").strip()), []).append(idx)
    # A line names its batch (sheet_row) and is checked against that row; a line without one is
    # checked against everything left under its name, so no request holds more than exists.
    wanted: dict[tuple, int] = {}
    labels: dict[tuple, str] = {}
    for item in body.items:
        idx = by_row.get(item.sheet_row) if item.sheet_row is not None else None
        if idx is not None:
            key = (idx,)
        else:
            key = tuple(rows_named.get(_norm_name(_base_item_name(item.item_name)), ()))
            if not key:
                continue  # not in the inventory: nothing to check against
        if any(remaining[i] is None for i in key):
            continue  # the sheet has no count for it
        wanted[key] = wanted.get(key, 0) + item.quantity
        labels[key] = _base_item_name(item.item_name)
    left_for = {key: sum(max(remaining[i], 0) for i in key) for key in wanted}
    short = [(labels[key], left_for[key]) for key, n in wanted.items() if n > left_for[key]]
    if not short:
        return
    parts = [f"{name}: {'none left' if left == 0 else f'only {left} left'}" for name, left in short]
    raise HTTPException(status_code=409, detail=(
        "Not enough left for this request (another clinic may have just asked for some). "
        + "; ".join(parts) + ". Change the amounts on your list, or remove those supplies, then send again."))


@app.get("/inventory/availability")
async def inventory_availability(request: Request):
    inventory = get_inventory_records()
    remaining_rows, held_names = _remaining_by_row(inventory, _request_rows_for_holds())
    result = []
    for idx, rec in enumerate(inventory):
        item_name = (rec.get("Name") or rec.get("name") or "").strip()
        category = (rec.get("Category") or rec.get("category") or "").strip()
        sheet_row = rec.get("_sheet_row")
        remaining = remaining_rows[idx]
        if remaining is None:  # blank or unparseable stock: unknown, not low
            availability_status, tags = "Available", ["Available"]
        elif _norm_name(item_name) in held_names and remaining <= 0:
            availability_status, tags = "Requested", ["Requested"]
        elif remaining <= 5:
            availability_status, tags = "Limited", ["Low Stock"]
        else:
            availability_status, tags = "Available", ["Available"]

        # Org names stay in the sheet for HQ; don't expose them to other clinics.
        result.append({
            "sheet_row": sheet_row, "item_name": item_name, "category": category,
            "availability_status": availability_status, "tags": tags, "remaining": remaining,
            "requesting_org": None, "request_id": None,
        })

    return _cached_json(request, result)


def _sent_since(timestamp, since) -> bool:
    """Was this request line sent at or after `since` (the account's creation)? A line with no
    readable time counts as older, so it stays hidden."""
    if since is None:
        return True
    try:
        sent = timestamp if isinstance(timestamp, datetime) else datetime.fromisoformat(str(timestamp).strip())
    except ValueError:
        return False
    if sent.tzinfo is None:
        sent = sent.replace(tzinfo=timezone.utc)
    return sent >= since


@app.get("/requests")
def list_org_requests(request: Request, response: Response, email: Optional[str] = None,
                      x_hq_token: Optional[str] = Header(default=None)):
    """Clinic view (?email=): only for the signed-in account with that email, and only requests
    sent after the account was made. Sign-up proves nothing about the inbox, so someone who
    signs up with another clinic's address must not see that clinic's earlier requests.

    Without a non-empty email this is the HQ view of ALL requests: a team account, or the
    X-HQ-Token header (disabled with 403 when HQ_API_TOKEN is not set).
    """
    response.headers["Cache-Control"] = "no-store"  # per-clinic data must never be cached
    wanted = (email or "").strip().lower()
    since = None
    if not wanted:
        require_hq(request, x_hq_token)
    else:
        _check_rate("lookup:" + _client_ip(request), LOOKUP_LIMIT)
        account = current_account(request)
        if account is None:
            raise HTTPException(status_code=401, detail="Please sign in to see your requests.")
        if account["email"].strip().lower() != wanted:
            raise HTTPException(status_code=403, detail="You can only see your own requests.")
        since = account.get("created_at")

    def mine(rows: list[dict]) -> list[dict]:
        if not wanted:
            return rows
        return [r for r in rows if r.get("Org Email", "").strip().lower() == wanted
                and _sent_since(r.get("Timestamp"), since)]

    if db.enabled():
        return mine(db.get_requests())

    if _requests_in_memory():
        return mine(list(_sample_org_request_rows))

    spreadsheet = _open_requests_spreadsheet()
    ws = _org_requests_worksheet(spreadsheet)
    all_rows = ws.get_all_values()

    if len(all_rows) <= 1:
        return []

    header = all_rows[0]
    return mine([
        _row_dict(header, r)
        for r in all_rows[1:]
        if any(cell.strip() for cell in r)
    ])
