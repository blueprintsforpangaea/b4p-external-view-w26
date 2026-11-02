"""End-to-end request flows: submit -> list by email -> HQ status changes -> availability,
with the exact emails each step should send, plus availability against the live data shape.

Background tasks (emails) run synchronously inside TestClient, so `no_email` is complete
as soon as each call returns.
"""
import json
import os
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from conftest import HQ
from fixtures.real_shape_supplies import ROWS
from test_api_contract import live_sheet  # noqa: F401  (fixture)

HQ_ADDR = "hq@example.org"
FULL_SAMPLE = os.environ.get(
    "QA_SUPPLIES_JSON",
    "/private/tmp/claude-501/-Users-vishnavramesh/58e68f47-4f75-457e-9ebd-fe0388286306/scratchpad/supplies.json",
)


@pytest.fixture(autouse=True)
def fresh_email_limits():
    from app.services import email as email_svc
    if hasattr(email_svc, "reset_limits"):
        email_svc.reset_limits()


def _email():
    return f"Flow.{uuid.uuid4().hex[:10]}@Example.org"


def _status(c, name):
    return {a["item_name"]: a["availability_status"] for a in c.get("/inventory/availability").json()}[name]


def _statuses(c):
    return {a["sheet_row"]: a["availability_status"] for a in c.get("/inventory/availability").json()}


def _patch(c, rid, status):
    return c.patch(f"/requests/{rid}/status", json={"status": status}, headers=HQ)


def _pick_two(c):
    """Two item names with 6+ in stock that no open request touches and that are unique by name."""
    if c.get("/health").json()["source"] == "sample":
        return ("Gauze", 10), ("Bandage", 50)
    inv = c.get("/api/supplies").json()
    used = {r["Item Name"].strip().lower() for r in c.get("/requests", headers=HQ).json()}
    counts = {}
    for r in inv:
        k = (r["Name"] or "").strip().lower()
        counts[k] = counts.get(k, 0) + 1
    picks = [(r["Name"], int(r["Quantity"])) for r in inv
             if (r["Name"] or "").strip() and (r["Quantity"] or "").isdigit() and 6 <= int(r["Quantity"]) <= 500
             and counts[r["Name"].strip().lower()] == 1 and r["Name"].strip().lower() not in used]
    assert len(picks) >= 2, "test DB has no unused items left"
    return picks[0], picks[1]


# --- the whole lifecycle -------------------------------------------------------------

def test_full_lifecycle_with_emails(client, no_email, monkeypatch):
    monkeypatch.setenv("HQ_EMAIL", HQ_ADDR)
    (a, a_stock), (b, _) = _pick_two(client)
    email = _email()
    org = f"Lifecycle Clinic {uuid.uuid4().hex[:6]}"
    assert _status(client, a) == "Available"

    r = client.post("/requests", json={"org_name": org, "org_email": email, "items": [
        {"item_name": a, "category": "X", "quantity": a_stock},
        {"item_name": b, "category": "Y", "quantity": 1},
    ]})
    assert r.status_code == 200, r.text
    rid = r.json()["request_id"]

    # submit: one confirmation to the clinic and one alert to HQ
    assert sorted(m[0].lower() for m in no_email) == sorted([HQ_ADDR, email.lower()])
    clinic = next(m for m in no_email if m[0].lower() == email.lower())
    hq = next(m for m in no_email if m[0] == HQ_ADDR)
    # the clinic email is a fixed template: request ID, count, status; no org or item names
    assert rid in clinic[1] + clinic[2]
    for secret in (org, a, b):
        assert secret not in clinic[1] + clinic[2]
    # the HQ alert keeps the details
    assert rid in hq[1] + hq[2] and a in hq[2]

    # the clinic sees both lines, regardless of case/whitespace in the email they type
    mine = client.get("/requests", params={"email": f"  {email.upper()} "}).json()
    assert {x["Item Name"] for x in mine} == {a, b} and {x["Request ID"] for x in mine} == {rid}
    assert {x["Status"] for x in mine} == {"Under Review"}
    assert client.get("/requests", params={"email": "someone.else@example.org"}).json() == []
    assert _status(client, a) == "Requested"  # Under Review holds it: all of a was asked for

    # Approved: one status email to the clinic, and now the stock is held
    assert _patch(client, rid, "Approved").status_code == 200
    assert len(no_email) == 3 and no_email[-1][0].lower() == email.lower()
    assert "Approved" in no_email[-1][1] + no_email[-1][2]
    assert a not in no_email[-1][1] + no_email[-1][2]
    assert {x["Status"] for x in client.get("/requests", params={"email": email}).json()} == {"Approved"}
    assert _status(client, a) == "Requested"

    # repeating the same status is a no-op and sends nothing
    again = _patch(client, rid, "Approved")
    assert again.status_code == 200 and again.json().get("changed") is False
    assert len(no_email) == 3

    # Shipped: one more email; shipped requests no longer hold stock
    assert _patch(client, rid, "Shipped").status_code == 200
    assert len(no_email) == 4 and "Shipped" in no_email[-1][1] + no_email[-1][2]
    assert {x["Status"] for x in client.get("/requests", params={"email": email}).json()} == {"Shipped"}
    assert _status(client, a) == "Available"

    # Delivered is the last step; nothing moves backwards or gets denied after shipping
    assert _patch(client, rid, "Delivered").status_code == 200 and len(no_email) == 5
    for back in ("Shipped", "Approved", "Denied", "Cancelled"):
        assert _patch(client, rid, back).status_code == 409, back
    assert len(no_email) == 5


@pytest.mark.parametrize("path,final,ok", [
    (["Denied"], "Denied", True),
    (["Cancelled"], "Cancelled", True),
    (["Approved", "Denied"], "Denied", True),
    (["Approved", "Cancelled"], "Cancelled", True),
    (["Approved", "Shipped", "Cancelled"], "Shipped", False),
    (["Denied", "Approved"], "Denied", False),
])
def test_deny_and_cancel_rules(client, no_email, path, final, ok):
    name, _ = _pick_two(client)[0]
    email = _email()
    rid = client.post("/requests", json={"org_name": "Rules", "org_email": email,
                                         "items": [{"item_name": name, "quantity": 1}]}).json()["request_id"]
    codes = [_patch(client, rid, st).status_code for st in path]
    assert codes[:-1] == [200] * (len(codes) - 1)
    assert codes[-1] == (200 if ok else 409)
    assert {x["Status"] for x in client.get("/requests", params={"email": email}).json()} == {final}
    assert _status(client, name) == "Available"  # denied/cancelled requests hold nothing


def test_two_orgs_never_see_each_other(client):
    e1, e2 = _email(), _email()
    for e in (e1, e2):
        client.post("/requests", json={"org_name": "Org " + e, "org_email": e,
                                       "items": [{"item_name": _pick_two(client)[0][0], "quantity": 1}]})
    for mine, other in ((e1, e2), (e2, e1)):
        rows = client.get("/requests", params={"email": mine}).json()
        assert rows and all(r["Org Email"].lower() == mine.lower() for r in rows)
        assert other.lower() not in json.dumps(rows).lower()
    # the email filter is exact, not a substring/prefix match
    assert client.get("/requests", params={"email": e1[:-4]}).json() == []
    assert client.get("/requests", params={"email": "%"}).json() == []


def test_double_submit_creates_two_requests(client, no_email):
    """The API has no idempotency key for /requests: the UI must block double clicks."""
    body = {"org_name": "Double", "org_email": _email(),
            "items": [{"item_name": _pick_two(client)[0][0], "quantity": 1}]}
    r1, r2 = client.post("/requests", json=body), client.post("/requests", json=body)
    assert r1.status_code == r2.status_code == 200
    assert r1.json()["request_id"] != r2.json()["request_id"]


def test_fourth_confirmation_in_an_hour_is_skipped_but_hq_still_alerted(client, no_email, monkeypatch):
    monkeypatch.setenv("HQ_EMAIL", HQ_ADDR)
    email = _email()
    for _ in range(4):
        assert client.post("/requests", json={"org_name": "Busy", "org_email": email, "items": [
            {"item_name": _pick_two(client)[0][0], "quantity": 1}]}).status_code == 200
    to = [m[0].lower() for m in no_email]
    assert to.count(email.lower()) == 3 and to.count(HQ_ADDR) == 4


def test_email_on_submit_off_still_sends_status_mail(client, no_email, monkeypatch):
    monkeypatch.setenv("EMAIL_ON_SUBMIT", "false")
    email = _email()
    rid = client.post("/requests", json={"org_name": "Quiet", "org_email": email, "items": [
        {"item_name": _pick_two(client)[0][0], "quantity": 1}]}).json()["request_id"]
    assert no_email == []
    _patch(client, rid, "Approved")
    assert [m[0].lower() for m in no_email] == [email.lower()]


def test_live_sheet_lifecycle(live_sheet, no_email, monkeypatch):  # noqa: F811
    """Production sheet mode (gspread faked): same email moments as DB mode."""
    monkeypatch.setenv("HQ_EMAIL", HQ_ADDR)
    c, _, req = live_sheet
    email = _email()
    rid = c.post("/requests", json={"org_name": "Sheet Clinic", "org_email": email,
                                    "items": [{"item_name": "Gauze", "quantity": 8}]}).json()["request_id"]
    assert len(no_email) == 2
    assert _status(c, "Gauze") == "Requested"  # 10 - 2 (seeded, Under Review) - 8 = 0
    assert _patch(c, rid, "Approved").status_code == 200 and len(no_email) == 3
    assert _status(c, "Gauze") == "Requested"  # still held once Approved
    assert _patch(c, rid, "Approved").json().get("changed") is False and len(no_email) == 3
    assert _patch(c, rid, "Shipped").status_code == 200 and len(no_email) == 4
    assert _status(c, "Gauze") == "Available"
    assert _patch(c, rid, "Approved").status_code == 409  # Shipped -> Approved is not allowed
    assert _patch(c, rid, "Cancelled").status_code == 409


# --- availability against the real data shape -----------------------------------------

EXTRA = [
    {"Name": "Bulk Gloves", "Quantity": "1,200"},
    {"Name": "Five Left", "Quantity": "5"},
    {"Name": "Six Left", "Quantity": "6"},
    {"Name": "Zero Left", "Quantity": "0"},
    {"Name": "  Spaced Name ", "Quantity": "8"},
    {"Name": "Twin", "Quantity": "3"},
    {"Name": "twin", "Quantity": "4"},
    {"Name": "Decimal", "Quantity": "12.0"},
    {"Name": "Padded Qty", "Quantity": " 9 "},
]


def _client_with(monkeypatch, tmp_path, rows):
    import main
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("USE_SAMPLE_DATA", "1")
    f = tmp_path / "inventory.json"
    f.write_text(json.dumps(rows))
    monkeypatch.setattr(main, "SAMPLE_PATH", f)
    monkeypatch.setattr(main, "_sample_org_request_rows", [])
    return TestClient(main.app)


@pytest.fixture
def shaped(monkeypatch, tmp_path):
    rows = [dict(r) for r in ROWS] + [{"Category": "", "Review": "No", **r} for r in EXTRA]
    return _client_with(monkeypatch, tmp_path, rows), rows


def _req(c, name, qty, approve=True):
    """Submit a request and (by default) approve it. Under Review and Approved both hold stock."""
    r = c.post("/requests", json={"org_name": "Shape", "org_email": "shape@example.org",
                                  "items": [{"item_name": name, "quantity": qty}]})
    assert r.status_code == 200, r.text
    rid = r.json()["request_id"]
    if approve:
        assert _patch(c, rid, "Approved").status_code == 200
    return rid


def _by_name(c, name):
    return [a["availability_status"] for a in c.get("/inventory/availability").json()
            if a["item_name"].lower() == name.strip().lower()]


def test_real_shape_without_requests(shaped):
    c, rows = shaped
    av = c.get("/inventory/availability").json()
    assert len(av) == len(rows)
    blank_qty = [a for a, r in zip(av, rows) if not str(r.get("Quantity", "")).strip()]
    # unknown stock is shown as available (the UI shows no number), never as low
    assert blank_qty and all(a["availability_status"] == "Available" and a.get("remaining") is None
                             for a in blank_qty)
    assert _by_name(c, "Bulk Gloves") == ["Available"]  # "1,200" parses
    assert _by_name(c, "Five Left") == ["Limited"]       # 5 is the Limited threshold
    assert _by_name(c, "Six Left") == ["Available"]
    assert _by_name(c, "Zero Left") == ["Limited"]       # 0 in stock with no request: not "Requested"
    assert _by_name(c, "Padded Qty") == ["Available"]
    assert _by_name(c, "Spaced Name") == ["Available"]   # item_name is trimmed
    assert _by_name(c, "twin") == ["Limited", "Limited"]  # 3 and 4, judged per row


def test_threshold_moves_with_requests(shaped):
    c, _ = shaped
    _req(c, "Six Left", 1)
    assert _by_name(c, "Six Left") == ["Limited"]
    _req(c, "six left", 5)  # case-insensitive match
    assert _by_name(c, "Six Left") == ["Requested"]


def test_comma_quantity_with_requests(shaped):
    c, _ = shaped
    _req(c, "Bulk Gloves", 1195)
    assert _by_name(c, "Bulk Gloves") == ["Limited"]
    _req(c, "Bulk Gloves", 5)
    assert _by_name(c, "Bulk Gloves") == ["Requested"]


def test_duplicate_names_fill_rows_in_order(shaped):
    c, _ = shaped
    _req(c, "TWIN", 2)  # 3 + 4 - 2 = 5 left across both rows
    assert _by_name(c, "twin") == ["Limited", "Limited"]
    _req(c, "Twin", 5)
    assert _by_name(c, "twin") == ["Requested", "Requested"]


def test_spaced_inventory_name_matches_plain_request(shaped):
    c, _ = shaped
    _req(c, "spaced name", 8)
    assert _by_name(c, "Spaced Name") == ["Requested"]


def test_decimal_quantity_is_parsed(shaped):
    """Sheets can export whole numbers as '12.0'; treating that as unknown shows it as Limited."""
    c, _ = shaped
    row = next(a for a in c.get("/inventory/availability").json() if a["item_name"] == "Decimal")
    assert row["availability_status"] == "Available" and row["remaining"] == 12


def test_asking_for_more_than_exists_is_refused_and_holds_nothing(shaped):
    """No request holds more than exists: the clinic is told how many are left instead."""
    c, _ = shaped
    before = c.get("/inventory/availability").json()
    r = c.post("/requests", json={"org_name": "Shape", "org_email": "shape@example.org",
                                  "items": [{"item_name": "Five Left", "quantity": 10000}]})
    assert r.status_code == 409 and "Five Left: only 5 left" in r.json()["detail"]
    assert c.get("/inventory/availability").json() == before
    _req(c, "Five Left", 5, approve=False)  # exactly what's left is fine
    assert _by_name(c, "Five Left") == ["Requested"]


def test_blank_and_unknown_named_rows_are_not_touched_by_other_requests(shaped):
    c, rows = shaped
    before = _statuses(c)
    _req(c, "Bulk Gloves", 1)
    after = _statuses(c)
    blank_rows = [i + 2 for i, r in enumerate(rows) if not r["Name"].strip() or r["Name"].strip().lower() == "unknown"]
    assert blank_rows and all(before[n] == after[n] for n in blank_rows)


def test_shipped_requests_release_stock(shaped):
    c, _ = shaped
    rid = _req(c, "Six Left", 6)
    assert _by_name(c, "Six Left") == ["Requested"]
    _patch(c, rid, "Shipped")
    assert _by_name(c, "Six Left") == ["Available"]


def test_review_flag_recorded_in_sheet_mode(shaped, no_email, monkeypatch):
    """Review=Yes items must be flagged for HQ in every mode, not only Postgres (QA-05)."""
    monkeypatch.setenv("HQ_EMAIL", HQ_ADDR)
    c, rows = shaped
    flagged = next(r["Name"] for r in rows if r["Review"] == "Yes" and r["Name"].strip())
    email = _email()
    c.post("/requests", json={"org_name": "Flag", "org_email": email,
                              "items": [{"item_name": flagged, "quantity": 1}]})
    assert c.get("/requests", params={"email": email}).json()[0]["Review Flag"] == "TRUE"
    alert = next(m for m in no_email if m[0] == HQ_ADDR)
    assert "Manual review required" in alert[2]


@pytest.mark.skipif(not Path(FULL_SAMPLE).is_file(), reason="full inventory sample not available")
def test_full_live_inventory_sample(monkeypatch, tmp_path):
    """All 1,137 live rows: every row gets a status, and holding each unique name works."""
    rows = json.loads(Path(FULL_SAMPLE).read_text())
    for r in rows:
        r.pop("_sheet_row", None)
    c = _client_with(monkeypatch, tmp_path, rows)
    av = c.get("/inventory/availability").json()
    assert len(av) == len(rows) and {a["availability_status"] for a in av} <= {"Available", "Limited"}
    assert [a["sheet_row"] for a in av] == list(range(2, len(rows) + 2))
    big = next(r for r in rows if r["Name"].strip() and r["Quantity"].isdigit() and int(r["Quantity"]) > 50
               and sum(x["Name"].strip().lower() == r["Name"].strip().lower() for x in rows) == 1)
    _req(c, big["Name"], int(big["Quantity"]))
    after = c.get("/inventory/availability").json()
    changed = [a for a, b in zip(av, after) if a["availability_status"] != b["availability_status"]]
    assert [a["item_name"] for a in changed] == [big["Name"].strip()]


def test_lot_suffixed_request_names_still_hold_stock(shaped):
    """The UI sends "Name [Lot X, Box Y, Pallet Z]"; availability must match the base name."""
    c, _ = shaped
    _req(c, "Six Left [Lot L1, Box 2, Pallet 1]", 6)
    assert _by_name(c, "Six Left") == ["Requested"]


def test_only_a_trailing_lot_suffix_is_stripped(shaped):
    c, _ = shaped
    _req(c, "Six Left [Lot L1] extra", 6)  # not a trailing suffix: no match
    assert _by_name(c, "Six Left") == ["Available"]


def test_lot_suffix_keeps_review_flag(shaped, no_email, monkeypatch):
    monkeypatch.setenv("HQ_EMAIL", HQ_ADDR)
    c, rows = shaped
    flagged = next(r["Name"] for r in rows if r["Review"] == "Yes" and r["Name"].strip())
    email = _email()
    c.post("/requests", json={"org_name": "Flag", "org_email": email,
                              "items": [{"item_name": f"{flagged} [Lot X, Box 1, Pallet 1]", "quantity": 1}]})
    row = c.get("/requests", params={"email": email}).json()[0]
    assert row["Review Flag"] == "TRUE" and row["Item Name"].endswith("[Lot X, Box 1, Pallet 1]")


def _remaining(c, name):
    return [a["remaining"] for a in c.get("/inventory/availability").json()
            if a["item_name"].lower() == name.strip().lower()]


def test_under_review_holds_stock_until_denied(shaped):
    c, _ = shaped
    before = c.get("/inventory/availability").json()
    rid = _req(c, "Six Left", 6, approve=False)
    assert _by_name(c, "Six Left") == ["Requested"]  # a clinic asked for all 6: none left for others
    assert _patch(c, rid, "Denied").status_code == 200
    assert c.get("/inventory/availability").json() == before  # denied: the 6 are back


def test_approved_quantity_fills_same_named_rows_first_lot_first(shaped):
    c, _ = shaped
    _req(c, "twin", 2)  # rows: Twin 3, twin 4
    assert _remaining(c, "twin") == [1, 4]
    assert _by_name(c, "twin") == ["Limited", "Limited"]
    _req(c, "TWIN", 2)
    assert _remaining(c, "twin") == [0, 3]
    assert _by_name(c, "twin") == ["Requested", "Limited"]


def test_unicode_and_spacing_variants_match(shaped):
    c, _ = shaped
    _req(c, "\uff33\uff49\uff58\u3000\uff2c\uff45\uff46\uff54", 6)  # full-width "Six Left"
    assert _by_name(c, "Six Left") == ["Requested"]


def test_approval_for_an_unknown_name_changes_nothing(shaped):
    c, _ = shaped
    before = c.get("/inventory/availability").json()
    _req(c, "Nothing by this name", 5)
    assert c.get("/inventory/availability").json() == before


def test_negative_stock_reads_as_zero(monkeypatch, tmp_path):
    c = _client_with(monkeypatch, tmp_path, [{"Name": "Neg", "Quantity": "-4", "Review": "No"}])
    row = c.get("/inventory/availability").json()[0]
    assert row["remaining"] == 0 and row["availability_status"] == "Limited"


@pytest.mark.parametrize("status", ["Denied", "Cancelled", "Shipped"])
def test_closed_requests_release_stock(shaped, status):
    c, _ = shaped
    rid = _req(c, "Six Left", 6)
    assert _by_name(c, "Six Left") == ["Requested"]
    assert _patch(c, rid, status).status_code == 200
    assert _by_name(c, "Six Left") == ["Available"]
