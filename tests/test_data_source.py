import psycopg
import pytest

from conftest import HQ


def test_sheet_mode_health(sheet_client):
    assert sheet_client.get("/health").json() == {"source": "sample", "ok": True, "email": None}


def test_sheet_mode_unchanged_lifecycle(sheet_client):
    inv = sheet_client.get("/api/supplies").json()
    assert [r["_sheet_row"] for r in inv] == [2, 3, 4]
    r = sheet_client.post("/requests", json={"org_name": "O", "org_email": "o@x.org",
                                             "items": [{"item_name": "Gauze", "quantity": 1}]})
    rid = r.json()["request_id"]
    assert sheet_client.get("/requests", params={"email": " O@X.ORG "}).json()[0]["Request ID"] == rid
    av = {a["item_name"]: a for a in sheet_client.get("/inventory/availability").json()}
    assert av["Gauze"]["availability_status"] == "Available"  # 10 - 1 open = 9 left
    assert av["Syringe"]["availability_status"] == "Limited"


def test_db_health(db_client):
    assert db_client.get("/health").json() == {"source": "postgres", "ok": True, "email": None}


def test_db_health_down(monkeypatch):
    import main
    from fastapi.testclient import TestClient
    monkeypatch.setenv("DATABASE_URL", "postgresql://127.0.0.1:1/nope")
    c = TestClient(main.app)
    assert c.get("/health").json() == {"source": "postgres", "ok": False, "email": None}
    assert c.get("/api/supplies").status_code == 503


def test_db_supplies_shape(db_client):
    rows = db_client.get("/api/supplies").json()
    assert rows and {"Name", "Category", "Quantity", "Review", "_sheet_row"} <= set(rows[0])
    assert all(isinstance(r["_sheet_row"], int) for r in rows)


def test_db_request_lifecycle(db_client, no_email):
    inv = db_client.get("/api/supplies").json()
    used = {r["Item Name"].strip().lower() for r in db_client.get("/requests", headers=HQ).json()}
    counts = {}
    for r in inv:
        counts[r["Name"].strip().lower()] = counts.get(r["Name"].strip().lower(), 0) + 1
    # availability matches by item name: pick an unused, unique name with a small stock
    pick = next(r for r in inv if r["Name"] and r["Quantity"].isdigit() and 1 <= int(r["Quantity"]) <= 5
                and r["Name"].strip().lower() not in used and counts[r["Name"].strip().lower()] == 1)
    name, stock = pick["Name"], int(pick["Quantity"])
    email = f"Lifecycle.{__import__('uuid').uuid4().hex[:8]}@Example.org"
    r = db_client.post("/requests", json={"org_name": "Lifecycle " + email, "org_email": email,
                                          "items": [{"item_name": name, "category": "X", "quantity": stock}]})
    assert r.status_code == 200 and r.json()["status"] == "Under Review"
    rid = r.json()["request_id"]
    assert rid.startswith("REQ-")

    assert any(x["Request ID"] == rid for x in db_client.get("/requests", headers=HQ).json())
    mine = db_client.get("/requests", params={"email": email.lower()}).json()
    assert [x["Request ID"] for x in mine] == [rid] and mine[0]["Quantity Requested"] == str(stock)
    assert db_client.get("/requests", params={"email": "nobody@x.org"}).json() == []

    def status_of(n):
        return next(a for a in db_client.get("/inventory/availability").json() if a["item_name"] == n)["availability_status"]

    assert status_of(name) != "Requested"  # Under Review holds nothing: anonymous, unvetted
    assert len(no_email) == 1  # submission sends the org confirmation (HQ_EMAIL is unset in tests)

    def patch(i, s):
        return db_client.patch(f"/requests/{i}/status", json={"status": s}, headers=HQ)

    assert patch(rid, "Approved").status_code == 200
    assert db_client.get("/requests", params={"email": email}).json()[0]["Status"] == "Approved"
    assert status_of(name) == "Requested"  # only Approved holds the stock

    assert patch(rid, "Shipped").status_code == 200
    assert status_of(name) == "Limited"  # shipped stock is assumed deducted from inventory; no permanent brand
    assert len(no_email) == 3  # confirmation + one status email per real status change

    assert patch("REQ-nope", "Shipped").status_code == 404
    assert patch(rid, "Bogus").status_code == 422


def test_db_review_flag(db_client):
    inv = db_client.get("/api/supplies").json()
    flagged = next((r["Name"] for r in inv if r["Review"].strip().lower() in ("review needed", "yes")), None)
    if not flagged:
        pytest.skip("no 'Review needed' rows in test DB")
    rid = db_client.post("/requests", json={"org_name": "Flag Org", "org_email": "f@x.org",
                                            "items": [{"item_name": flagged, "quantity": 1}]}).json()["request_id"]
    row = next(x for x in db_client.get("/requests", headers=HQ).json() if x["Request ID"] == rid)
    assert row["Review Flag"] == "TRUE"


def test_db_validation(db_client):
    assert db_client.post("/requests", json={"org_name": "", "org_email": "a@b.c", "items": []}).status_code == 422


def test_migration_script_idempotent(db_client, tmp_path):
    import json
    import subprocess
    import sys
    rid = "REQ-1700000000-001"
    f = tmp_path / "o.json"
    base = {"Request ID": rid, "Org Name": "Migrated Org", "Org Email": "m@x.org", "Category": "C",
            "Quantity Requested": "4", "Status": "Shipped", "Timestamp": "2026-04-15T17:01:05+00:00",
            "Review Flag": "TRUE"}
    f.write_text(json.dumps([{**base, "Item Name": "A"}, {**base, "Item Name": "B"}]))
    for _ in range(2):  # second run must be a no-op
        subprocess.run([sys.executable, "scripts/migrate_org_requests_to_db.py", str(f)], check=True,
                       env={**__import__("os").environ})
    rows = [r for r in db_client.get("/requests", headers=HQ).json() if r["Request ID"] == rid]
    assert [r["Item Name"] for r in rows] == ["A", "B"]
    assert rows[0]["Status"] == "Shipped" and rows[0]["Review Flag"] == "TRUE"
    assert rows[0]["Timestamp"].startswith("2026-04-15T17:01:05")


def _holds(monkeypatch, inventory, approved):
    import main
    from fastapi.testclient import TestClient
    monkeypatch.setattr(main, "get_inventory_records", lambda: inventory)
    monkeypatch.setattr(main.db, "enabled", lambda: False)
    monkeypatch.setattr(main, "_use_sample_data", lambda: True)
    monkeypatch.setattr(main, "_sample_org_request_rows", [
        {"Request ID": "REQ-1", "Status": "Approved", "Item Name": n, "Quantity Requested": str(q)} for n, q in approved])
    main._inventory_cache.clear()
    r = TestClient(main.app).get("/inventory/availability").json()
    return {a["sheet_row"]: a["remaining"] for a in r}


def _row(n, lot, qty):
    return {"_sheet_row": n, "Name": "Gloves", "Category": "PPE", "Quantity": str(qty),
            "Lot Number": lot, "Box Number": "1", "Pallet Number": "2"}


def test_approved_hold_lands_on_the_lot_it_names(monkeypatch):
    inv = [_row(2, "A", 10), _row(3, "B", 10)]
    got = _holds(monkeypatch, inv, [("Gloves [Lot B, Box 1, Pallet 2]", 4)])
    assert got == {2: 10, 3: 6}


def test_approved_hold_without_lot_keeps_first_lot_first(monkeypatch):
    inv = [_row(2, "A", 10), _row(3, "B", 10)]
    assert _holds(monkeypatch, inv, [("Gloves", 4)]) == {2: 6, 3: 10}


def test_named_lot_overflow_spills_to_other_rows_of_the_name(monkeypatch):
    inv = [_row(2, "A", 10), _row(3, "B", 3)]
    assert _holds(monkeypatch, inv, [("Gloves [Lot B, Box 1, Pallet 2]", 5)]) == {2: 8, 3: 0}


def test_service_account_mode_reads_the_final_inventorying_tab_by_default(monkeypatch):
    """Without INVENTORY_WORKSHEET_TITLE, the "Final Inventorying" tab, not whichever tab is first."""
    import gspread
    import main

    class Tab:
        def __init__(self, rows):
            self.rows = rows

        def get_all_values(self):
            return self.rows

    final = Tab([["Name", "Quantity"], ["Gauze", "3"]])

    class Book:
        sheet1 = Tab([["Old tab"], ["not the inventory"]])

        def worksheet(self, title):
            if title == "Final Inventorying":
                return final
            raise gspread.WorksheetNotFound(title)

    class Client:
        def open_by_key(self, key):
            return Book()

    monkeypatch.setenv("GOOGLE_SHEET_ID", "sheet-123")
    monkeypatch.delenv("INVENTORY_WORKSHEET_TITLE", raising=False)
    monkeypatch.setattr(main, "_gspread_client", lambda: Client())
    assert [r["Name"] for r in main._read_sheet_inventory()] == ["Gauze"]
    final.rows = None
    Book.worksheet = lambda self, title: (_ for _ in ()).throw(gspread.WorksheetNotFound(title))
    assert main._read_sheet_inventory()[0]["Old tab"] == "not the inventory"  # no such tab: the first one
