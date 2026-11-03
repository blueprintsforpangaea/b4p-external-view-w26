"""Requests lower the available quantity (rhea, 2 Nov 2026): Under Review and Approved lines hold
their units, Denied and Cancelled give them back, Shipped and Delivered are left to the sheet's own
quantity. A submit re-checks what's left under a lock, so two clinics can't take the same last units."""
import threading

import main

HQ = {"X-HQ-Token": "test-hq-token"}


def _row(c, name):
    return next(a for a in c.get("/inventory/availability").json() if a["item_name"] == name)


def _ask(c, name, qty, email="a@example.org", cid=None, sheet_row=True):
    line = {"item_name": name, "quantity": qty}
    if sheet_row:
        line["sheet_row"] = _row(c, name)["sheet_row"]
    body = {"org_name": "Clinic", "org_email": email, "items": [line]}
    if cid:
        body["client_request_id"] = cid
    return c.post("/requests", json=body)


def test_a_request_lowers_what_others_see_and_a_denial_gives_it_back(sheet_client):
    c = sheet_client
    assert _row(c, "Bandage")["remaining"] == 50
    rid = _ask(c, "Bandage", 20).json()["request_id"]
    assert _row(c, "Bandage")["remaining"] == 30
    assert c.patch(f"/requests/{rid}/status", json={"status": "Approved"}, headers=HQ).status_code == 200
    assert _row(c, "Bandage")["remaining"] == 30  # still held
    rid2 = _ask(c, "Bandage", 5, email="b@example.org").json()["request_id"]
    assert _row(c, "Bandage")["remaining"] == 25
    assert c.patch(f"/requests/{rid2}/status", json={"status": "Cancelled"}, headers=HQ).status_code == 200
    assert _row(c, "Bandage")["remaining"] == 30
    assert c.patch(f"/requests/{rid}/status", json={"status": "Shipped"}, headers=HQ).status_code == 200
    assert _row(c, "Bandage")["remaining"] == 50  # the warehouse takes shipped units off the sheet itself


def test_asking_for_more_than_is_left_says_how_many(sheet_client):
    c = sheet_client
    assert _ask(c, "Gauze", 7).status_code == 200
    r = _ask(c, "Gauze", 4, email="late@example.org")
    assert r.status_code == 409
    assert "Gauze: only 3 left" in r.json()["detail"] and "Change the amounts" in r.json()["detail"]
    assert _row(c, "Gauze")["remaining"] == 3  # the refused request holds nothing
    assert _ask(c, "Gauze", 3, email="late@example.org").status_code == 200
    r = _ask(c, "Gauze", 1, email="later@example.org")
    assert r.status_code == 409 and "Gauze: none left" in r.json()["detail"]
    assert _row(c, "Gauze")["availability_status"] == "Requested"


def test_two_clinics_racing_for_the_last_units_cannot_both_get_them(sheet_client, monkeypatch):
    c = sheet_client
    row = _row(c, "Gauze")["sheet_row"]
    real = main._check_enough_left

    def slow_check(body):  # widen the race: both requests read "10 left" if nothing serializes them
        real(body)
        threading.Event().wait(0.05)

    monkeypatch.setattr(main, "_check_enough_left", slow_check)
    codes = []

    def send(i):
        r = c.post("/requests", json={"org_name": f"Clinic {i}", "org_email": f"c{i}@example.org",
                                      "items": [{"item_name": "Gauze", "quantity": 8, "sheet_row": row}]})
        codes.append(r.status_code)

    threads = [threading.Thread(target=send, args=(i,)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(codes) == [200, 409, 409, 409]
    assert _row(c, "Gauze")["remaining"] == 2


def test_a_retry_of_a_saved_request_is_not_refused_by_its_own_hold(sheet_client):
    c = sheet_client
    first = _ask(c, "Gauze", 10, cid="abcdef12-holds")
    assert first.status_code == 200
    again = _ask(c, "Gauze", 10, cid="abcdef12-holds")
    assert again.status_code == 200 and again.json()["request_id"] == first.json()["request_id"]
    assert _row(c, "Gauze")["remaining"] == 0


def test_statuses_typed_in_the_sheet_count_whatever_their_case(sheet_client):
    c = sheet_client
    for status, held in (("approved", 4), ("UNDER REVIEW", 4), ("", 4), ("denied", 0), ("Shipped", 0)):
        main._sample_org_request_rows.clear()
        main._sample_org_request_rows.append({"Request ID": "REQ-1-a", "Item Name": "Bandage",
                                              "Quantity Requested": "4", "Status": status})
        assert _row(c, "Bandage")["remaining"] == 50 - held, status


def test_a_line_without_a_batch_cannot_hold_more_than_the_name_has(sheet_client):
    c = sheet_client
    r = _ask(c, "Syringe", 4, sheet_row=False)  # 3 in stock
    assert r.status_code == 409 and "Syringe: only 3 left" in r.json()["detail"]
    assert _ask(c, "Syringe", 3, sheet_row=False).status_code == 200


def test_the_live_site_needs_sign_in_to_send_once_accounts_have_a_database(sheet_client, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setattr(main.db, "enabled", lambda: True)
    r = sheet_client.post("/requests", json={"org_name": "O", "org_email": "o@example.org",
                                             "items": [{"item_name": "Gauze", "quantity": 1}]})
    assert r.status_code == 401 and "sign in" in r.json()["detail"]
    assert main._sample_org_request_rows == []


def test_with_no_database_the_live_site_takes_a_name_and_email(sheet_client, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    assert _ask(sheet_client, "Gauze", 1).status_code == 200
