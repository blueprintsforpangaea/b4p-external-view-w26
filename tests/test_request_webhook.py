"""Sending each request to the Apps Script request sheet (REQUESTS_WEBHOOK_URL). The web app is
faked: these tests never reach Google."""
import pytest
import requests as real_requests
from fastapi.testclient import TestClient

import main
from app import request_webhook

CSV = (
    '"Manufacturer Name","Category","Subcategory","General","Name","Lot Number","Notes","Quantity",'
    '"Date of Expiration","Pallet Number","Box Number","Image URL","Review"\n'
    '"Medline","PH/PPE","Gloves","nitrile gloves","Nitrile gloves (M)","L1","","40","2030-01-01","1","4","","No"\n'
    '"Cardinal","ST/N","Wound Care & Bandages","gauze","Gauze pads, 4x4","L2","","3","","2","5","","Yes"\n'
)
URL = "https://webhook.test/macros/s/FAKE/exec"  # real Apps Script hosts are refused under tests


class Reply:
    def __init__(self, status=200, data=None, ctype="application/json; charset=utf-8", text=None):
        self.status_code = status
        self.headers = {"content-type": ctype}
        self._data = data
        self.content = (text or "").encode()

    def json(self):
        if self._data is None:
            raise ValueError("not json")
        return self._data


@pytest.fixture
def app(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("USE_SAMPLE_DATA", raising=False)
    monkeypatch.setenv("PUBLIC_SHEET_READ", "1")
    monkeypatch.setenv("GOOGLE_SHEET_ID", "sheet-123")
    monkeypatch.setenv("INVENTORY_WORKSHEET_GID", "42")
    monkeypatch.setenv("REQUESTS_WEBHOOK_URL", URL)
    monkeypatch.setenv("REQUESTS_WEBHOOK_SECRET", "s3cret")
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.setattr(main, "_sample_org_request_rows", [])
    main._inventory_cache.clear()
    request_webhook._last.clear()
    monkeypatch.setattr(main.requests, "get", lambda url, params=None, timeout=None: Reply(ctype="text/csv", text=CSV))
    posts = []  # appends only; read-backs ("totals") go to state["reads"]
    state = {"reply": Reply(data={"ok": True, "added": 2}), "lines": [], "reads": []}
    request_webhook._lines_cache.clear()

    def fake_post(url, json=None, timeout=None):
        if json and json.get("action") == "totals":
            state["reads"].append(json)
            return Reply(data={"ok": True, "lines": state["lines"]})
        posts.append({"url": url, "json": json, "timeout": timeout})
        if isinstance(state["reply"], Exception):
            raise state["reply"]
        return state["reply"]

    monkeypatch.setattr(request_webhook.requests, "post", fake_post)
    return TestClient(main.app), posts, state


def submit(client, **over):
    body = {"org_name": "Riverside Clinic", "org_email": "ana@riverside.org", "items": [
        {"item_name": "Nitrile gloves (M)", "category": "PH/PPE", "quantity": 4, "sheet_row": 2},
        {"item_name": "Gauze pads, 4x4", "category": "ST/N", "quantity": 1, "sheet_row": 3},
    ], **over}
    return client.post("/requests", json=body)


# The production Requests tab's header row, as it is in the sheet today.
PRODUCTION_HEADERS = ["Request ID", "Org Name", "Org Email", "Item Name", "Category",
                      "Quantity Requested", "Status", "Timestamp", "Review Flag"]


def test_rows_match_the_existing_requests_tab_exactly(app):
    client, posts, _ = app
    r = submit(client)
    assert r.status_code == 200, r.text
    assert len(posts) == 1
    sent = posts[0]
    assert sent["url"] == URL and sent["timeout"] == request_webhook.TIMEOUT
    assert sent["json"]["secret"] == "s3cret"
    assert sent["json"]["sheet_id"] == "1MDJRufxw3AKp2pj4CoKegS1hbBAcjkqWOoHHleAKnCE"  # temp request sheet
    assert sent["json"]["columns"] == PRODUCTION_HEADERS  # no extra columns
    rows = [dict(zip(PRODUCTION_HEADERS, row)) for row in sent["json"]["rows"]]
    rid = r.json()["request_id"]
    assert [row["Item Name"] for row in rows] == ["Nitrile gloves (M)", "Gauze pads, 4x4"]
    first, second = rows
    assert first["Request ID"] == rid and rid.startswith("REQ-")
    assert (first["Org Name"], first["Org Email"]) == ("Riverside Clinic", "ana@riverside.org")
    assert (first["Category"], first["Quantity Requested"]) == ("PH/PPE", 4)
    assert {row["Status"] for row in rows} == {"Under Review"}
    assert (first["Review Flag"], second["Review Flag"]) == ("FALSE", "TRUE")
    assert first["Timestamp"].endswith("+00:00") and "T" in first["Timestamp"]  # ISO, like the May rows
    # The same rows the in-memory copy keeps.
    assert len(main._sample_org_request_rows) == 2
    health = client.get("/health").json()["requests_sheet"]
    assert health["configured"] is True and health["last_ok"] is True and health["tab"] == "Sheet1"
    assert URL not in str(health) and "s3cret" not in str(health)


def test_local_runs_write_to_sheet1_and_vercel_to_requests(app, monkeypatch):
    client, posts, _ = app
    submit(client)
    monkeypatch.setenv("VERCEL", "1")
    assert request_webhook.tab() == "Requests"
    monkeypatch.setattr(main, "_sample_org_request_rows", [])
    submit(client)  # (the in-memory store still answers; only the tab name matters here)
    assert [(p["json"]["sheet_id"], p["json"]["tab"]) for p in posts] == [
        ("1MDJRufxw3AKp2pj4CoKegS1hbBAcjkqWOoHHleAKnCE", "Sheet1"),  # testing: temp request sheet
        ("1k0rX_GZEkFppF8hC_JtN7pM9pRHEuHeYOXcsSJ23TTY", "Requests"),  # live site: the Requests sheet
    ]


@pytest.mark.parametrize("reply,result", [
    (real_requests.ConnectionError("down"), "failed"),
    (real_requests.ConnectTimeout("no route"), "failed"),
    (Reply(data={"ok": False, "error": "wrong secret"}), "failed"),
    (real_requests.ReadTimeout("slow"), "unknown"),
    (Reply(status=500, data=None, ctype="text/html"), "unknown"),
])
def test_a_failed_send_never_stops_the_request(app, reply, result):
    client, posts, state = app
    state["reply"] = reply
    r = submit(client)
    assert r.status_code == 200, r.text
    assert len(main._sample_org_request_rows) == 2
    health = client.get("/health").json()["requests_sheet"]
    assert health["last_ok"] is False and health["last_error"]
    assert request_webhook.send(main.ORG_REQ_HEADERS, [["x"]]) == result


def test_a_retry_with_the_same_id_is_not_sent_twice(app):
    client, posts, _ = app
    cid = "abcdef12-retry"
    assert submit(client, client_request_id=cid).status_code == 200
    assert submit(client, client_request_id=cid).status_code == 200
    assert len(posts) == 1


def test_formula_like_text_is_kept_as_text(app):
    client, posts, _ = app
    submit(client, org_name="=HYPERLINK(\"http://x\")")
    assert posts[0]["json"]["rows"][0][1].startswith("'=")


def test_off_without_both_settings_and_never_over_plain_http(app, monkeypatch):
    client, posts, _ = app
    monkeypatch.delenv("REQUESTS_WEBHOOK_SECRET")
    submit(client)
    monkeypatch.setenv("REQUESTS_WEBHOOK_SECRET", "s3cret")
    monkeypatch.setenv("REQUESTS_WEBHOOK_URL", "http://script.google.com/x")
    submit(client)
    assert posts == []
    assert "requests_sheet" not in client.get("/health").json()


# Service-account sheet mode (no database, not the read-only public sheet): exactly one writer.
class FakeWorksheet:
    def __init__(self):
        self.appended = []

    def get_all_values(self):
        return [list(main.ORG_REQ_HEADERS)]

    def append_rows(self, rows, value_input_option=None):
        self.appended.extend(rows)


@pytest.fixture
def sheet_mode(app, monkeypatch):
    client, posts, state = app
    monkeypatch.delenv("PUBLIC_SHEET_READ")
    monkeypatch.setattr(main, "_requests_in_memory", lambda: False)
    ws = FakeWorksheet()
    monkeypatch.setattr(main, "_open_requests_spreadsheet", lambda: object())
    monkeypatch.setattr(main, "_org_requests_worksheet", lambda spreadsheet: ws)
    return client, posts, state, ws


def test_with_the_web_app_set_up_the_service_account_does_not_also_write(sheet_mode):
    client, posts, _, ws = sheet_mode
    assert submit(client, client_request_id="abcdef12-one").status_code == 200
    assert len(posts) == 1 and ws.appended == []


def test_when_the_web_app_certainly_failed_the_service_account_saves_it(sheet_mode):
    client, posts, state, ws = sheet_mode
    state["reply"] = real_requests.ConnectionError("down")
    assert submit(client).status_code == 200
    assert len(ws.appended) == 2
    assert ws.appended == posts[0]["json"]["rows"]  # the same rows either way


def test_when_it_may_have_saved_it_is_not_written_a_second_time(sheet_mode):
    client, posts, state, ws = sheet_mode
    state["reply"] = real_requests.ReadTimeout("slow")
    assert submit(client).status_code == 200
    assert ws.appended == []


def test_without_the_web_app_the_service_account_writes_as_before(sheet_mode, monkeypatch):
    client, posts, _, ws = sheet_mode
    monkeypatch.delenv("REQUESTS_WEBHOOK_URL")
    assert submit(client).status_code == 200
    assert posts == [] and len(ws.appended) == 2


# --- Each request is sent once (a QA run once wrote a test request's 100 lines and many others
# to the real temp sheet; these make sure no retry or re-read path ever multiplies a request).

def test_a_slow_answer_is_never_sent_again(app):
    client, posts, state = app
    state["reply"] = real_requests.ReadTimeout("slow")  # the script may have saved it
    r = submit(client)
    assert r.status_code == 200 and len(posts) == 1
    rid = r.json()["request_id"]
    for _ in range(5):  # /health and later reads send nothing
        client.get("/health")
        client.get("/requests", params={"email": "ana@riverside.org"})
    rows = posts[0]["json"]["rows"]
    assert request_webhook.send(main.ORG_REQ_HEADERS, rows, rid) == "unknown"
    assert len(posts) == 1


def test_a_connection_never_made_is_tried_once_more_then_given_up(app):
    client, posts, state = app
    state["reply"] = real_requests.ConnectTimeout("no route")
    assert submit(client).status_code == 200
    assert len(posts) == 1 + request_webhook.RETRIES == 2
    assert len({p["json"]["request_id"] for p in posts}) == 1


def test_an_error_answer_is_not_retried(app):
    client, posts, state = app
    for reply in (Reply(status=500, data=None, ctype="text/html"), Reply(data={"ok": False, "error": "x"}),
                  real_requests.ConnectionError("Connection aborted.")):  # dropped: may have been read
        state["reply"] = reply
        posts.clear()
        assert submit(client).status_code == 200
        assert len(posts) == 1


def test_many_sends_of_one_id_post_it_once(app):
    import threading
    client, posts, state = app
    rows = [["REQ-1-abc", "o", "e", "Gauze", "", 1, "Under Review", "t", "FALSE"]] * 100  # 100 lines
    results = []
    threads = [threading.Thread(target=lambda: results.append(
        request_webhook.send(main.ORG_REQ_HEADERS, rows, "REQ-1-abc"))) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(posts) == 1 and len(posts[0]["json"]["rows"]) == 100
    assert set(results) <= {"ok", "unknown"}  # "unknown" for the ones that came while it was going
    assert request_webhook.send(main.ORG_REQ_HEADERS, rows, "REQ-1-abc") == "ok" and len(posts) == 1


def test_sheet_mode_retries_with_a_slow_answer_write_nothing_more(sheet_mode):
    client, posts, state, ws = sheet_mode
    state["reply"] = real_requests.ReadTimeout("slow")
    cid = "abcdef12-slow"
    for _ in range(3):
        assert submit(client, client_request_id=cid).status_code == 200
    assert len(posts) == 1 and ws.appended == []


@pytest.mark.parametrize("url", ["https://script.google.com/macros/s/REAL/exec",
                                 "https://SCRIPT.google.com/macros/s/REAL/exec",
                                 "https://script.googleusercontent.com/macros/echo?x=1"])
def test_tests_and_qa_never_reach_a_real_apps_script(app, monkeypatch, url):
    client, posts, _ = app
    monkeypatch.setenv("REQUESTS_WEBHOOK_URL", url)
    assert submit(client).status_code == 200
    assert posts == []


def test_qa_flag_alone_refuses_real_urls(monkeypatch):
    monkeypatch.setattr(request_webhook, "sys", type("S", (), {"modules": {}})())  # as if not under pytest
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.setenv("B4P_QA", "")
    assert request_webhook._testing() is False
    monkeypatch.setenv("B4P_QA", "1")
    assert request_webhook._testing() is True


def test_the_suite_has_no_webhook_from_env():
    import os
    assert not os.environ.get("REQUESTS_WEBHOOK_URL") and not os.environ.get("REQUESTS_WEBHOOK_SECRET")


# --- Reading back what other servers sent (availability counts every request) -------------

def test_lines_in_the_request_sheet_lower_availability(app):
    client, posts, state = app
    state["lines"] = [["REQ-9-x", "Nitrile gloves (M) [Lot L1, Box 4, Pallet 1]", 30, "Under Review"],
                      ["REQ-9-y", "Nitrile gloves (M)", 5, "Approved"]]
    rows = {a["item_name"]: a for a in client.get("/inventory/availability").json()}
    assert rows["Nitrile gloves (M)"]["remaining"] == 40 - 35
    assert state["reads"] and state["reads"][0]["action"] == "totals" and state["reads"][0]["secret"] == "s3cret"
    assert posts == []  # reading back never adds rows


def test_the_read_back_is_cached_for_a_minute(app, monkeypatch):
    client, posts, state = app
    for _ in range(3):
        client.get("/inventory/availability")
    assert len(state["reads"]) == 1
    monkeypatch.setattr(request_webhook, "LINES_TTL", 0)
    client.get("/inventory/availability")
    assert len(state["reads"]) == 2


def test_a_request_sent_here_is_not_counted_twice_once_it_is_in_the_sheet(app):
    client, posts, state = app
    rid = submit(client).json()["request_id"]
    state["lines"] = [[rid, "Nitrile gloves (M)", 4, "Under Review"]]
    request_webhook._lines_cache.clear()
    rows = {a["item_name"]: a for a in client.get("/inventory/availability").json()}
    assert rows["Nitrile gloves (M)"]["remaining"] == 40 - 4


def test_a_script_without_the_read_back_still_works(app, monkeypatch):
    client, posts, state = app
    old = Reply(data={"ok": False, "error": "nothing to add"})  # what a script deployed before answers

    def old_script(url, json=None, timeout=None):
        if json.get("action") == "totals":
            return old
        posts.append({"url": url, "json": json, "timeout": timeout})
        return Reply(data={"ok": True, "added": 2})

    monkeypatch.setattr(request_webhook.requests, "post", old_script)
    rows = {a["item_name"]: a for a in client.get("/inventory/availability").json()}
    assert rows["Nitrile gloves (M)"]["remaining"] == 40
    assert submit(client).status_code == 200 and len(posts) == 1


def test_no_read_back_from_a_real_script_in_tests(app, monkeypatch):
    client, posts, state = app
    monkeypatch.setenv("REQUESTS_WEBHOOK_URL", "https://script.google.com/macros/s/REAL/exec")
    client.get("/inventory/availability")
    assert state["reads"] == []
