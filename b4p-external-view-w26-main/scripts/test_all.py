#!/usr/bin/env python3
"""
Full test suite for the Blueprints supply desk API.
Starts uvicorn with USE_SAMPLE_DATA=1, runs all tests, then stops.

Usage:
    python3 scripts/test_all.py          # run all tests
    python3 scripts/test_all.py --keep   # leave server running for manual inspection
"""

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]

# ── colours ───────────────────────────────────────────────────────────────────
GREEN = "\033[32m"
RED   = "\033[31m"
YELLOW= "\033[33m"
RESET = "\033[0m"
BOLD  = "\033[1m"

passed = failed = 0


def ok(label):
    global passed
    passed += 1
    print(f"  {GREEN}PASS{RESET}  {label}")


def fail(label, reason=""):
    global failed
    failed += 1
    tag = f" — {reason}" if reason else ""
    print(f"  {RED}FAIL{RESET}  {label}{tag}")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _get(url):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status, json.loads(r.read())


def _post(url, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def _patch(url, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="PATCH")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def wait_for_server(base, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"{base}/api/supplies", timeout=2)
            return True
        except Exception:
            time.sleep(0.4)
    return False


# ── test sections ─────────────────────────────────────────────────────────────

def test_inventory(base):
    print(f"\n{BOLD}GET /api/supplies{RESET}")
    status, body = _get(f"{base}/api/supplies")
    if status == 200 and isinstance(body, list) and len(body) > 0:
        ok(f"returns {len(body)} item(s)")
    else:
        fail("should return non-empty list", f"status={status}")
        return []

    first = body[0]
    if "_sheet_row" in first:
        ok("_sheet_row present in each record")
    else:
        fail("_sheet_row missing from records")
    return body


def test_availability(base, inventory):
    print(f"\n{BOLD}GET /inventory/availability{RESET}")
    status, body = _get(f"{base}/inventory/availability")
    if status == 200 and isinstance(body, list) and len(body) == len(inventory):
        ok(f"returns {len(body)} availability record(s)")
    else:
        fail("should match inventory length", f"status={status}, len={len(body) if isinstance(body, list) else '?'}")
        return

    expected_keys = {"sheet_row", "item_name", "category", "availability_status", "tags"}
    if expected_keys.issubset(set(body[0].keys())):
        ok("all expected fields present (sheet_row, item_name, category, availability_status, tags)")
    else:
        fail("missing fields", str(set(body[0].keys())))

    valid_statuses = {"Available", "Requested", "Limited", "Shipped"}
    all_valid = all(r["availability_status"] in valid_statuses for r in body)
    if all_valid:
        ok("all availability_status values are valid")
    else:
        fail("unexpected availability_status value")

    counts = {}
    for r in body:
        s = r["availability_status"]
        counts[s] = counts.get(s, 0) + 1
    print(f"         distribution: {counts}")


def test_internal_requests(base):
    print(f"\n{BOLD}GET /api/requests{RESET}")
    status, body = _get(f"{base}/api/requests")
    if status == 200 and isinstance(body, list):
        ok("returns list (empty in sample mode)")
    else:
        fail("should return []", f"status={status}")


def test_org_requests_empty(base):
    print(f"\n{BOLD}GET /requests (no email filter){RESET}")
    status, body = _get(f"{base}/requests")
    if status == 200 and isinstance(body, list):
        ok("returns list")
    else:
        fail("should return list", f"status={status}")


def test_submit_org_request(base, inventory):
    print(f"\n{BOLD}POST /requests — org submission{RESET}")

    first = inventory[0]
    name_key = next(
        (k for k in first if any(n in k.lower() for n in ["name", "item", "description"])),
        list(first.keys())[0],
    )
    item_name = str(first.get(name_key, "Test Item"))
    category = str(first.get("Category", first.get("category", "General")))

    payload = {
        "org_name": "Riverside Free Clinic",
        "org_email": "vishnavramesh06@gmail.com",
        "items": [
            {"item_name": item_name, "category": category, "quantity": 3},
            {"item_name": "Sterile Gauze 4x4", "category": "Wound Care", "quantity": 10},
        ],
    }
    status, body = _post(f"{base}/requests", payload)

    if status == 200 and body.get("status") == "Under Review":
        ok("returns status=Under Review")
    else:
        fail("should return 200 + Under Review", f"status={status} body={body}")
        return None

    req_id = body.get("request_id", "")
    if req_id.startswith("REQ-"):
        ok(f"request_id format correct ({req_id})")
    else:
        fail("request_id should start with REQ-", req_id)

    return req_id, payload["org_email"]


def test_org_request_filter(base, org_email):
    print(f"\n{BOLD}GET /requests?email={org_email}{RESET}")
    url = f"{base}/requests?email={urllib.parse.quote(org_email)}"
    status, body = _get(url)
    # Sample mode always returns []
    if status == 200 and isinstance(body, list):
        ok(f"returns list filtered by email (sample mode → {len(body)} rows)")
    else:
        fail("should return list", f"status={status}")


def test_status_patch(base, req_id):
    print(f"\n{BOLD}PATCH /requests/{req_id}/status{RESET}")

    # Approved
    status, body = _patch(f"{base}/requests/{req_id}/status", {"status": "Approved"})
    if status == 200 and body.get("status") == "Approved":
        ok("status updated to Approved")
    else:
        fail("should update to Approved", f"status={status} body={body}")

    # Shipped
    status, body = _patch(f"{base}/requests/{req_id}/status", {"status": "Shipped"})
    if status == 200 and body.get("status") == "Shipped":
        ok("status updated to Shipped")
    else:
        fail("should update to Shipped", f"status={status} body={body}")

    # Invalid status
    status, body = _patch(f"{base}/requests/{req_id}/status", {"status": "Rejected"})
    if status == 422:
        ok("rejects invalid status value (422)")
    else:
        fail("should reject invalid status with 422", f"status={status}")

    # Non-existent request ID (only in sample mode — returns 0 rows, not 404)
    status, body = _patch(f"{base}/requests/REQ-0000000000-999/status", {"status": "Approved"})
    if status in (200, 404):
        ok(f"non-existent request_id handled ({status})")
    else:
        fail("unexpected status for missing request_id", f"status={status}")


def test_org_request_validation(base):
    print(f"\n{BOLD}POST /requests — validation{RESET}")

    # Missing org_name
    status, _ = _post(f"{base}/requests", {
        "org_name": "", "org_email": "a@b.com",
        "items": [{"item_name": "X", "category": "Y", "quantity": 1}],
    })
    if status == 422:
        ok("empty org_name rejected (422)")
    else:
        fail("empty org_name should be 422", f"status={status}")

    # Missing items
    status, _ = _post(f"{base}/requests", {
        "org_name": "Clinic", "org_email": "a@b.com", "items": [],
    })
    if status == 422:
        ok("empty items list rejected (422)")
    else:
        fail("empty items should be 422", f"status={status}")

    # Quantity = 0
    status, _ = _post(f"{base}/requests", {
        "org_name": "Clinic", "org_email": "a@b.com",
        "items": [{"item_name": "X", "category": "Y", "quantity": 0}],
    })
    if status == 422:
        ok("quantity=0 rejected (422)")
    else:
        fail("quantity=0 should be 422", f"status={status}")


def test_internal_submit(base, inventory):
    print(f"\n{BOLD}POST /api/requests — internal clinic flow{RESET}")
    rows = [{"sheet_row": r["_sheet_row"], "quantity": 2} for r in inventory[:2]]
    import random, string
    cid = "test-" + "".join(random.choices(string.ascii_lowercase, k=8))
    status, body = _post(f"{base}/api/requests", {
        "nametag": "Test Clinic",
        "request_notes": "",
        "client_request_id": cid,
        "items": rows,
    })
    if status == 200 and body.get("ok"):
        ok(f"internal submit accepted, group_id={body.get('request_group_id', '')[:8]}…")
    else:
        fail("internal submit failed", f"status={status} body={body}")

    # Duplicate should 409
    status2, _ = _post(f"{base}/api/requests", {
        "nametag": "Test Clinic",
        "request_notes": "",
        "client_request_id": cid,
        "items": rows,
    })
    if status2 == 409:
        ok("duplicate client_request_id returns 409")
    else:
        fail("duplicate should be 409", f"status={status2}")


# ── email dry-run (no network) ────────────────────────────────────────────────

def test_email_functions():
    print(f"\n{BOLD}Email service (dry-run — no SMTP connection){RESET}")
    sys.path.insert(0, str(ROOT))
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    # Clear credentials so _send() warns + returns rather than trying to connect
    os.environ.pop("GMAIL_USER", None)
    os.environ.pop("GMAIL_APP_PASSWORD", None)

    from app.services import email as esvc

    hq = os.environ.get("HQ_EMAIL", "")
    if "vishnavramesh06@gmail.com" in hq:
        ok(f"HQ_EMAIL configured as {hq}")
    else:
        fail("HQ_EMAIL should be vishnavramesh06@gmail.com", hq)

    # These should silently skip (no credentials) rather than raise
    items = [{"item_name": "Gauze", "category": "Wound Care", "quantity": 5}]
    try:
        esvc.send_org_confirmation("Test Org", "vishnavramesh06@gmail.com", items, "REQ-9999-001")
        ok("send_org_confirmation runs without exception (skipped — no credentials)")
    except Exception as e:
        fail("send_org_confirmation raised", str(e))

    try:
        esvc.send_hq_alert("Test Org", "vishnavramesh06@gmail.com", items, "2024-01-01T00:00:00Z", ["Gauze"])
        ok("send_hq_alert runs without exception (skipped — no credentials)")
    except Exception as e:
        fail("send_hq_alert raised", str(e))

    try:
        esvc.send_status_update("Test Org", "vishnavramesh06@gmail.com", "Approved", items)
        ok("send_status_update runs without exception (skipped — no credentials)")
    except Exception as e:
        fail("send_status_update raised", str(e))


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    import urllib.parse  # noqa: F401 (used inside test functions)

    parser = argparse.ArgumentParser()
    parser.add_argument("--keep", action="store_true", help="Leave server running after tests")
    args = parser.parse_args()

    port = _free_port()
    base = f"http://127.0.0.1:{port}"

    print(f"\n{BOLD}Starting API (USE_SAMPLE_DATA=1) on port {port}…{RESET}")
    env = {**os.environ, "USE_SAMPLE_DATA": "1"}
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    if not wait_for_server(base):
        proc.terminate()
        print(f"{RED}Server failed to start within 20 s.{RESET}")
        sys.exit(1)
    print("Server ready.")

    # Run email tests first (no server needed, modifies env)
    test_email_functions()

    # API tests
    inventory = test_inventory(base)
    if inventory:
        test_availability(base, inventory)
    test_internal_requests(base)
    test_internal_submit(base, inventory or [])
    test_org_requests_empty(base)
    test_org_request_validation(base)

    result = test_submit_org_request(base, inventory or [])
    if result:
        req_id, org_email = result
        test_org_request_filter(base, org_email)
        test_status_patch(base, req_id)

    # Summary
    total = passed + failed
    print(f"\n{'─' * 50}")
    print(f"{BOLD}Results: {GREEN}{passed} passed{RESET}{BOLD}, {RED}{failed} failed{RESET}{BOLD} / {total} total{RESET}")
    print(f"{'─' * 50}\n")

    if not args.keep:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    else:
        print(f"Server still running at {base}  (kill PID {proc.pid} when done)")

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    import urllib.parse
    main()
