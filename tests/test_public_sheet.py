"""PUBLIC_SHEET_READ: the inventory comes from a link-shared sheet's CSV export, read-only."""
import pytest
from fastapi.testclient import TestClient

import main

CSV = (
    '"Manufacturer Name","Category","Subcategory","General","Name","Lot Number","Notes","Quantity",'
    '"Date of Expiration","Pallet Number","Box Number","Image URL","Review","",""\n'
    '"Medline","PH/PPE","Gloves","nitrile gloves","Nitrile gloves (M)","L1","","40","2030-01-01","1","4","","No","",""\n'
    '"Cardinal","ST/N","Wound Care & Bandages","gauze","Gauze pads, 4x4","L2","Pt ID 12345 box","12","","2","Separate","","",""\n'
)


class FakeResponse:
    def __init__(self, text, status=200, ctype="text/csv; charset=utf-8"):
        self.content = text.encode("utf-8")
        self.status_code = status
        self.headers = {"content-type": ctype}


@pytest.fixture
def public_client(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("USE_SAMPLE_DATA", raising=False)
    monkeypatch.setenv("PUBLIC_SHEET_READ", "1")
    monkeypatch.setenv("GOOGLE_SHEET_ID", "sheet-123")
    monkeypatch.setenv("INVENTORY_WORKSHEET_GID", "42")
    monkeypatch.setattr(main, "_sample_org_request_rows", [])
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append((url, params))
        return FakeResponse(CSV)

    monkeypatch.setattr(main.requests, "get", fake_get)
    return TestClient(main.app), calls


def test_csv_parsing_matches_the_sheet_reader():
    rows = main._parse_inventory_csv(CSV)
    assert [r["_sheet_row"] for r in rows] == [2, 3]
    # The empty padding columns gviz adds are dropped, not turned into Unnamed_N keys.
    assert set(rows[0]) == {
        "Manufacturer Name", "Category", "Subcategory", "General", "Name", "Lot Number", "Notes",
        "Quantity", "Date of Expiration", "Pallet Number", "Box Number", "Image URL", "Review", "_sheet_row",
    }
    assert rows[1]["Name"] == "Gauze pads, 4x4"  # quoted comma kept in one field
    assert rows[1]["Box Number"] == "Separate"
    assert main._parse_inventory_csv("") == []


def test_supplies_come_from_the_export_url_and_are_redacted(public_client):
    client, calls = public_client
    rows = client.get("/api/supplies").json()
    assert [r["Name"] for r in rows] == ["Nitrile gloves (M)", "Gauze pads, 4x4"]
    assert "12345" not in rows[1]["Notes"]  # patient ids removed as on the normal sheet path
    assert all("Image URL" not in r for r in rows)
    assert calls[0] == ("https://docs.google.com/spreadsheets/d/sheet-123/export", {"format": "csv", "gid": "42"})


def test_without_a_gid_the_tab_is_read_by_name(public_client, monkeypatch):
    client, calls = public_client
    monkeypatch.delenv("INVENTORY_WORKSHEET_GID")
    monkeypatch.setenv("INVENTORY_WORKSHEET_TITLE", "CLASSIFIED Inventorying Responses")
    client.get("/api/supplies")
    assert calls[0] == ("https://docs.google.com/spreadsheets/d/sheet-123/gviz/tq",
                        {"tqx": "out:csv", "sheet": "CLASSIFIED Inventorying Responses"})


def test_inventory_is_cached(public_client):
    client, calls = public_client
    client.get("/api/supplies")
    client.get("/api/supplies")
    assert len(calls) == 1


def test_health_says_read_only_sheet(public_client):
    client, _ = public_client
    assert client.get("/health").json() == {"source": "sheet-public", "ok": True, "email": None}


def test_a_sign_in_page_is_a_clear_error(public_client, monkeypatch):
    client, _ = public_client
    monkeypatch.setattr(main.requests, "get", lambda *a, **k: FakeResponse("<html>Sign in</html>", ctype="text/html"))
    r = client.get("/api/supplies")
    assert r.status_code == 503
    assert "Anyone with the link" in r.json()["detail"]


def test_requests_never_touch_the_sheets_api(public_client, monkeypatch):
    client, _ = public_client

    def refuse(*a, **k):
        raise AssertionError("gspread must not be used in PUBLIC_SHEET_READ mode")

    monkeypatch.setattr(main.gspread, "authorize", refuse)
    r = client.post("/requests", json={"org_name": "Clinic", "org_email": "c@x.org",
                                       "items": [{"item_name": "Nitrile gloves (M)", "quantity": 2}]})
    assert r.status_code == 200, r.text
    rid = r.json()["request_id"]
    assert client.get("/requests", params={"email": "c@x.org"}).json()[0]["Request ID"] == rid
    assert client.get("/inventory/availability").status_code == 200
    with pytest.raises(RuntimeError):
        main._gspread_client()


def test_never_on_production(monkeypatch):
    monkeypatch.setenv("PUBLIC_SHEET_READ", "1")
    monkeypatch.setenv("GOOGLE_SHEET_ID", "sheet-123")
    monkeypatch.setenv("VERCEL_ENV", "production")
    assert not main._public_sheet()


def test_only_the_columns_the_site_uses_are_sent(public_client, monkeypatch):
    client, _ = public_client
    extra = CSV.replace('"Review","",""', '"Review","Overflow","Team notes"').replace('"No","",""', '"No","x","call Dr. Smith 555-0100"')
    monkeypatch.setattr(main.requests, "get", lambda url, params=None, timeout=None: FakeResponse(extra))
    main._inventory_cache.clear()
    row = client.get("/api/supplies").json()[0]
    assert "Overflow" not in row and "Team notes" not in row and "555-0100" not in str(row)
    assert set(row) <= main.PUBLIC_SUPPLY_COLUMNS
