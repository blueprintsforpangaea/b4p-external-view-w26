"""Regression tests for the debugger findings. Every test runs in sheet mode and DB mode."""
import json
import uuid

import pytest

from conftest import HQ


def _post(c, items=None, email=None, org="Org", **kw):
    email = email or f"{uuid.uuid4().hex[:8]}@example.org"
    body = {"org_name": org + " " + email, "org_email": email,
            "items": items or [{"item_name": "Gauze", "quantity": 1}], **kw}
    return c.post("/requests", json=body), email


def _name(c):
    """An inventory item name that is safe to request in either mode."""
    return "Gauze" if c.get("/health").json()["source"] == "sample" else next(
        r["Name"] for r in c.get("/api/supplies").json() if r["Name"])


def test_all_requests_listing_needs_hq_token(client, monkeypatch):
    _, email = _post(client, items=[{"item_name": _name(client), "quantity": 1}])
    for url in ("/requests", "/requests?email=", "/requests?email=%20%20"):
        r = client.get(url)
        assert r.status_code == 401, url  # HQ_API_TOKEN set, header missing
        assert "@" not in r.text
        assert client.get(url, headers={"X-HQ-Token": "wrong"}).status_code == 401
    assert client.get("/requests", headers=HQ).status_code == 200
    assert client.get("/requests", params={"email": email.upper()}).json()[0]["Org Email"] == email
    monkeypatch.delenv("HQ_API_TOKEN")
    assert client.get("/requests").status_code == 403  # listing disabled when no token configured
    assert client.get("/requests", headers=HQ).status_code == 403
    assert client.get("/requests", params={"email": email}).status_code == 200  # org view unaffected


def test_org_filter_is_exact_not_substring(client):
    _, email = _post(client)
    assert client.get("/requests", params={"email": email[1:]}).json() == []
    assert client.get("/requests", params={"email": "%"}).json() == []


def test_patch_requires_hq_token(client, monkeypatch, no_email):
    r, _ = _post(client, items=[{"item_name": _name(client), "quantity": 1}])
    rid = r.json()["request_id"]
    url = f"/requests/{rid}/status"
    assert client.patch(url, json={"status": "Shipped"}).status_code == 401
    assert client.patch(url, json={"status": "Shipped"}, headers={"X-HQ-Token": "x"}).status_code == 401
    assert len(no_email) == 1  # only the submit confirmation; rejected PATCHes sent nothing
    assert client.patch(url, json={"status": "Shipped"}, headers=HQ).status_code == 200
    monkeypatch.delenv("HQ_API_TOKEN")
    assert client.patch(url, json={"status": "Approved"}, headers=HQ).status_code == 403


def test_status_email_only_on_real_change(db_client, no_email):
    c = db_client
    r, _ = _post(c, items=[{"item_name": _name(c), "quantity": 1}])
    url = f"/requests/{r.json()['request_id']}/status"
    assert c.patch(url, json={"status": "Approved"}, headers=HQ).status_code == 200
    assert len(no_email) == 2  # submit confirmation + status email
    for _ in range(3):
        assert c.patch(url, json={"status": "Approved"}, headers=HQ).json()["changed"] is False
    assert len(no_email) == 2


def test_email_html_is_escaped_and_subject_single_line(monkeypatch):
    from app.services import email as e
    monkeypatch.setenv("HQ_EMAIL", "hq@example.org")
    sent = []
    monkeypatch.setattr(e, "_send", lambda to, subject, html, text=None: sent.append((subject, html)))
    evil = '<a href="https://evil.test">x</a>'
    items = [{"item_name": evil, "category": "<img src=x>", "quantity": "<b>1</b>", "inventory_key": "<i>k</i>"}]
    e.send_status_update("<b>HQ</b>", "v@x.org", "<script>", items)
    e.send_org_confirmation("<b>HQ</b>", "v@x.org", items, "<u>REQ</u>")
    e.send_hq_alert("<b>HQ</b>\r\nBcc: z@z", "<s>e@x.org</s>", items, "<t>", ["<flag>"])
    assert len(sent) == 3
    for subject, html in sent:
        assert "<a " not in html and "<img" not in html and "<b>" not in html and "<script" not in html
        assert "<i>" not in html and "<u>" not in html and "<flag>" not in html and "<s>" not in html
        assert "&lt;" in html
        assert "\n" not in subject and "\r" not in subject


def test_availability_is_stock_minus_open_requests(sheet_client):
    c = sheet_client

    def st(n):
        return next(a for a in c.get("/inventory/availability").json() if a["item_name"] == n)["availability_status"]

    def approve(r):
        url = f"/requests/{r.json()['request_id']}/status"
        assert c.patch(url, json={"status": "Approved"}, headers=HQ).status_code == 200

    assert st("Bandage") == "Available"
    r, _ = _post(c, items=[{"item_name": "Bandage", "quantity": 49}])
    assert st("Bandage") == "Limited"  # Under Review holds it: 1 left
    approve(r)
    assert st("Bandage") == "Limited"  # still 1 left once Approved
    r, _ = _post(c, items=[{"item_name": "Bandage", "quantity": 1}])
    approve(r)
    assert st("Bandage") == "Requested"  # 0 left


def test_limits(client):
    ok = {"item_name": "Gauze", "quantity": 1}
    bad_bodies = [
        {"items": [ok] * 101},
        {"items": [{**ok, "quantity": 10001}]},
        {"items": [{**ok, "quantity": 0}]},
        {"items": [{**ok, "item_name": "x" * 501}]},
        {"org_name": "x" * 201},
        {"org_email": "not-an-email"},
        {"org_email": "a@b.co\r\nBcc: x@y.z"},
        {"org_email": "<b>@x.org"},
        {"org_email": "a" * 250 + "@x.org"},
    ]
    for extra in bad_bodies:
        body = {"org_name": "O", "org_email": "o@x.org", "items": [ok], **extra}
        assert client.post("/requests", json=body).status_code == 422, str(extra)[:60]
    body = {"org_name": "O", "org_email": "o@x.org",  # an unstocked supply: this checks the 100-line cap, not stock
            "items": [{"item_name": "Not stocked", "quantity": 1}] * 100}
    assert client.post("/requests", json=body).status_code == 200


def test_rate_limit(client):
    codes = [_post(client)[0].status_code for _ in range(12)]
    assert codes[:10] == [200] * 10 and codes[10:] == [429, 429]


def test_db_errors_are_generic(db_client, monkeypatch):
    import psycopg
    import main
    from fastapi.testclient import TestClient

    def boom(*a, **k):
        raise psycopg.errors.RaiseException("secret table shipment_x violates trigger")
    monkeypatch.setattr(main.db, "create_request", boom)
    c = TestClient(main.app, raise_server_exceptions=False)
    r = c.post("/requests", json={"org_name": "O", "org_email": "o@x.org", "items": [{"item_name": "Gauze", "quantity": 1}]})
    assert r.status_code == 400 and "secret" not in r.text

    def conflict(*a, **k):
        raise psycopg.errors.UniqueViolation("duplicate key value violates unique constraint secret")
    monkeypatch.setattr(main.db, "create_request", conflict)
    r = c.post("/requests", json={"org_name": "O", "org_email": "o@x.org", "items": [{"item_name": "Gauze", "quantity": 1}]})
    assert r.status_code == 409 and "secret" not in r.text


def test_invalid_transition_maps_to_409(db_client, monkeypatch):
    import psycopg
    import main
    r, _ = _post(db_client, items=[{"item_name": _name(db_client), "quantity": 1}])

    def refuse(*a, **k):
        raise psycopg.errors.RaiseException("cannot change request R from Shipped to Approved (internal detail)")
    monkeypatch.setattr(main.db, "set_request_status", refuse)
    res = db_client.patch(f"/requests/{r.json()['request_id']}/status", json={"status": "Approved"}, headers=HQ)
    assert res.status_code == 409 and "internal" not in res.text


@pytest.mark.parametrize("exc,status", [
    ("NoDataFound", 404),  # SQLSTATE P0002: unknown id
    ("RaiseException", 400),  # any other RAISE is bad input, not a refused transition
])
def test_db_errors_on_status_change_map_to_404_and_400(db_client, monkeypatch, exc, status):
    import psycopg
    import main
    r, _ = _post(db_client, items=[{"item_name": _name(db_client), "quantity": 1}])

    def fail(*a, **k):
        raise getattr(psycopg.errors, exc)("unknown status (internal detail)")
    monkeypatch.setattr(main.db, "set_request_status", fail)
    res = db_client.patch(f"/requests/{r.json()['request_id']}/status", json={"status": "Approved"}, headers=HQ)
    assert res.status_code == status and "internal" not in res.text


def test_quantity_must_be_a_json_number(sheet_client):
    for qty in ("5", True, 5.5):
        body = {"org_name": "O", "org_email": "o@x.org", "items": [{"item_name": "Gauze", "quantity": qty}]}
        assert sheet_client.post("/requests", json=body).status_code == 422, qty
