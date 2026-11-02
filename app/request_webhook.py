"""Send each submitted request to the clinic request sheet through its Apps Script web app: no
service-account key needed, just the web app's URL and a shared secret.

  REQUESTS_WEBHOOK_URL     the web app's /exec URL (https only)
  REQUESTS_WEBHOOK_SECRET  the same secret the script checks

The sheet and tab are fixed here, not in settings:
  - on Vercel (the live site): the "Requests" tab of the Requests spreadsheet, the real one,
    already holding requests since May 2026. That needs its own Apps Script deployment (from
    requests-apps-script.gs) made on the Requests spreadsheet, and its URL set on Vercel.
  - anywhere else (testing on a computer): "Sheet1" of the "temp request sheet".
Rows use exactly the Requests tab's existing columns and formats (ORG_REQ_HEADERS in main.py),
one per supply.

A failure never stops the request: it's logged, and /health reports the last attempt (time and
ok/error, never the URL, the secret or any clinic details).

Each Request ID is sent at most once per process: one attempt, plus one retry (after a short
pause) only when the first certainly never reached the script. A later call for the same ID gets
the first call's result and sends nothing. The Apps Script also refuses an ID already in the sheet.

Reading back: active_lines() asks the script for the request lines that still hold stock (Under
Review and Approved), so availability counts requests sent from any server. Cached for a minute.
A script deployed before that action existed answers with an error: then only this server's own
requests are counted.

Tests and QA runs (pytest, or B4P_QA=1) never reach a real Apps Script URL, whatever .env says.
"""
import logging
import os
import sys
import threading
import time
from collections import OrderedDict
from typing import Optional
from urllib.parse import urlsplit

import requests

logger = logging.getLogger(__name__)
TIMEOUT = 10  # seconds; Apps Script usually answers in 1-3
RETRIES = 1  # extra tries, only after a certain failure (never reached the script)
BACKOFF = 1.0  # seconds before the retry
REAL_HOSTS = ("script.google.com", "script.googleusercontent.com")

# (spreadsheet id, tab). The Apps Script only accepts these two pairs.
PRODUCTION = ("1k0rX_GZEkFppF8hC_JtN7pM9pRHEuHeYOXcsSJ23TTY", "Requests")  # "Requests" spreadsheet
TESTING = ("1MDJRufxw3AKp2pj4CoKegS1hbBAcjkqWOoHHleAKnCE", "Sheet1")  # "temp request sheet"

_last: dict = {}
_sent: "OrderedDict[str, str]" = OrderedDict()  # request id -> "sending", "ok", "failed" or "unknown"
_sent_lock = threading.Lock()
_SENT_MAX = 5000
LINES_TTL = 60  # seconds a read-back of the active request lines is reused
_lines_cache: dict = {}  # {"at": time, "lines": [...]} after a good read


def target() -> tuple[str, str]:
    """Vercel sets VERCEL=1 on every deployment; a run on a computer never has it."""
    return PRODUCTION if os.environ.get("VERCEL") else TESTING


def tab() -> str:
    return target()[1]


def configured() -> bool:
    url = os.environ.get("REQUESTS_WEBHOOK_URL", "").strip()
    return url.startswith("https://") and bool(os.environ.get("REQUESTS_WEBHOOK_SECRET", "").strip())


def _testing() -> bool:
    """A test or QA run: pytest is loaded, or B4P_QA is set (start a QA backend with B4P_QA=1)."""
    return ("pytest" in sys.modules or bool(os.environ.get("PYTEST_CURRENT_TEST"))
            or os.environ.get("B4P_QA", "").strip().lower() in ("1", "true", "yes"))


def _real_url(url: str) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    return any(host == h or host.endswith("." + h) for h in REAL_HOSTS)


def status() -> dict:
    """For /health: whether it's set up, which tab it writes to, and how the last send went."""
    return {"configured": configured(), "tab": tab(), **_last}


def send(columns: list[str], rows: list[list], request_id: str = "") -> str:
    """POST the rows. Returns "ok" (saved), "failed" (certainly not saved: safe to save another
    way) or "unknown" (sent, but no clear answer: it may have been saved, so don't save again).
    A request id that was already sent (or is being sent) is not sent again: the answer is the
    first send's result, with "unknown" while that one is still going."""
    if not configured() or not rows:
        return "failed"
    url = os.environ["REQUESTS_WEBHOOK_URL"].strip()
    if _testing() and _real_url(url):
        logger.error("Request sheet webhook refused: a test or QA run must not reach a real Apps Script URL")
        return "failed"
    request_id = request_id or str(rows[0][0])
    with _sent_lock:
        if request_id in _sent:
            previous = _sent[request_id]
            return "unknown" if previous == "sending" else previous
        _sent[request_id] = "sending"
        while len(_sent) > _SENT_MAX:
            _sent.popitem(last=False)
    result = "failed"
    try:
        for attempt in range(1 + RETRIES):
            if attempt:
                time.sleep(BACKOFF)
            result, certain = _post_once(url, columns, rows, request_id)
            if result != "failed" or not certain:
                break  # only a send that never reached the script is tried again
    finally:
        with _sent_lock:
            _sent[request_id] = result
    return result


def _post_once(url: str, columns: list[str], rows: list[list], request_id: str) -> tuple[str, bool]:
    """One POST. Returns (result, whether a "failed" certainly never reached the script)."""
    started = time.time()
    unreached = False
    try:
        resp = requests.post(
            url,
            json={"secret": os.environ["REQUESTS_WEBHOOK_SECRET"].strip(), "sheet_id": target()[0],
                  "tab": target()[1], "request_id": request_id, "columns": columns, "rows": rows},
            timeout=TIMEOUT,
        )
        data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        if resp.status_code == 200 and data.get("ok") is True:
            result, error = "ok", None
        elif data.get("ok") is False:  # the script answered and refused: nothing was written
            result, error = "failed", data.get("error") or "refused"
        else:
            result, error = "unknown", f"HTTP {resp.status_code}"
    except (requests.ConnectionError, requests.ConnectTimeout) as exc:
        result, error = "failed", type(exc).__name__  # never reached the script
        # Only a connection that was never made is retried: a dropped one may have been read.
        unreached = isinstance(exc, requests.ConnectTimeout) or any(
            k in str(exc) for k in ("NewConnectionError", "NameResolutionError", "Failed to establish"))
    except (requests.RequestException, ValueError) as exc:
        result, error = "unknown", type(exc).__name__  # e.g. a read timeout: the script may have run
    _last.clear()
    _last.update({"last_attempt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started)),
                  "last_ok": result == "ok"})
    if result != "ok":
        _last["last_error"] = str(error)[:200]
        logger.warning("Request sheet webhook %s: %s", result, error)
    return result, unreached


def active_lines() -> Optional[list[dict]]:
    """The request sheet's lines that still hold stock, as Requests-tab dicts ("Request ID",
    "Item Name", "Quantity Requested", "Status"), or None when they can't be read."""
    if not configured():
        return None
    url = os.environ["REQUESTS_WEBHOOK_URL"].strip()
    if _testing() and _real_url(url):
        return None
    now = time.time()
    if _lines_cache and now - _lines_cache["at"] < LINES_TTL:
        return list(_lines_cache["lines"])
    try:
        resp = requests.post(
            url,
            json={"secret": os.environ["REQUESTS_WEBHOOK_SECRET"].strip(), "sheet_id": target()[0],
                  "tab": target()[1], "action": "totals"},
            timeout=TIMEOUT,
        )
        data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Request sheet read-back failed: %s", type(exc).__name__)
        return None
    raw = data.get("lines") if resp.status_code == 200 and data.get("ok") is True else None
    if not isinstance(raw, list):
        logger.warning("Request sheet read-back refused: %s", str(data.get("error") or resp.status_code)[:200])
        return None
    lines = [{"Request ID": str(r[0]), "Item Name": str(r[1]), "Quantity Requested": str(r[2]),
              "Status": str(r[3]) or "Under Review"}
             for r in raw if isinstance(r, list) and len(r) >= 4]
    _lines_cache.clear()
    _lines_cache.update({"at": now, "lines": lines})
    return list(lines)
