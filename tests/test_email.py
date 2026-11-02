import io
import json
from pathlib import Path
import urllib.error

import pytest

from app.services import email as e

REAL_SEND = e._send  # captured at import, before the autouse no_email fixture patches it

ITEMS = [{"item_name": "Bandage", "quantity": 1}]  # 50 in stock: room for the many-request tests
ENV_VARS = ("RESEND_API_KEY", "BREVO_API_KEY", "GMAIL_USER", "GMAIL_APP_PASSWORD",
            "EMAIL_FROM", "EMAIL_REPLY_TO")


def _submit(c, org="Clinic One", email="clinic@example.org"):
    return c.post("/requests", json={"org_name": org, "org_email": email, "items": ITEMS})


# --- submit ----------------------------------------------------------------

def test_submit_sends_one_confirmation_and_one_hq_alert(sheet_client, no_email, monkeypatch):
    monkeypatch.setenv("HQ_EMAIL", "hq@example.org")
    assert _submit(sheet_client).status_code == 200
    assert sorted(m[0] for m in no_email) == ["clinic@example.org", "hq@example.org"]


def test_submit_emails_can_be_disabled(sheet_client, no_email, monkeypatch):
    monkeypatch.setenv("HQ_EMAIL", "hq@example.org")
    monkeypatch.setenv("EMAIL_ON_SUBMIT", "false")
    assert _submit(sheet_client).status_code == 200
    assert no_email == []


def test_no_hq_email_still_confirms_org(sheet_client, no_email):
    assert _submit(sheet_client).status_code == 200
    assert [m[0] for m in no_email] == ["clinic@example.org"]


def test_org_name_is_escaped_for_hq_and_absent_from_the_confirmation(sheet_client, no_email, monkeypatch):
    monkeypatch.setenv("HQ_EMAIL", "hq@example.org")
    assert _submit(sheet_client, org="<script>alert(1)</script>").status_code == 200
    assert len(no_email) == 2
    by_to = {to: html for to, _, html in no_email}
    assert "<script>" not in by_to["hq@example.org"] and "&lt;script&gt;" in by_to["hq@example.org"]
    assert "script" not in by_to["clinic@example.org"]  # fixed template, no submitter text


def test_db_submit_alert_lists_flagged_items(db_client, no_email, monkeypatch):
    import main
    monkeypatch.setenv("HQ_EMAIL", "hq@example.org")
    flagged = [r for r in main.get_inventory_records()
               if (r.get("Review") or "").strip().lower() in ("review needed", "yes")]
    if not flagged:
        pytest.skip("no review-flagged item in test data")
    name = flagged[0]["Name"]
    r = db_client.post("/requests", json={"org_name": "Flag Org", "org_email": "f@example.org",
                                          "items": [{"item_name": name, "quantity": 1}]})
    assert r.status_code == 200
    alert = next(m for m in no_email if m[0] == "hq@example.org")
    assert "Manual review required" in alert[2]


# --- abuse caps ----------------------------------------------------------------

def test_confirmations_capped_per_address_but_request_and_alert_still_happen(sheet_client, no_email, monkeypatch):
    monkeypatch.setenv("HQ_EMAIL", "hq@example.org")
    for _ in range(5):
        assert _submit(sheet_client, email="Victim@Example.org").status_code == 200
    to_victim = [m for m in no_email if m[0].lower() == "victim@example.org"]
    to_hq = [m for m in no_email if m[0] == "hq@example.org"]
    assert len(to_victim) == 3  # case-insensitive, 3 per hour
    assert len(to_hq) == 5  # HQ alerts are not capped per address
    monkeypatch.setattr(e, "CONFIRMATIONS_PER_IP", 100)  # this test is about the per-address cap
    assert _submit(sheet_client, email="other@example.org").status_code == 200
    assert any(m[0] == "other@example.org" for m in no_email)  # other addresses unaffected


def test_confirmations_stay_under_their_share_but_hq_alerts_never_do(sheet_client, no_email, monkeypatch, caplog):
    monkeypatch.setenv("HQ_EMAIL", "hq@example.org")
    monkeypatch.setenv("EMAIL_DAILY_LIMIT", "10")  # confirmations stop at 7
    monkeypatch.setattr(e, "CONFIRMATIONS_PER_IP", 100)
    for i in range(10):
        assert _submit(sheet_client, email=f"o{i}@example.org").status_code == 200
    assert sum(1 for m in no_email if m[0] != "hq@example.org") == 7
    assert sum(1 for m in no_email if m[0] == "hq@example.org") == 10  # a flood cannot blind HQ
    assert "EMAIL_DAILY_LIMIT" in caplog.text


def test_confirmations_capped_per_client_ip(sheet_client, no_email):
    for i in range(7):
        assert _submit(sheet_client, email=f"ip{i}@example.org").status_code == 200
    assert len(no_email) == e.CONFIRMATIONS_PER_IP  # 5 an hour from one client


def test_hq_alerts_beyond_30_an_hour_become_one_digest(no_email, monkeypatch):
    monkeypatch.setenv("HQ_EMAIL", "hq@example.org")
    for _ in range(35):
        e.send_hq_alert("Org", "o@example.org", [{"item_name": "Gauze", "category": "C", "quantity": 1}], "REQ-1", [])
    subjects = [m[1] for m in no_email]
    assert sum(s.startswith("New supply request") for s in subjects) == 30
    assert sum("more supply request" in s for s in subjects) == 1  # not one per extra alert


def test_daily_cap_counts_every_send(monkeypatch):
    monkeypatch.setenv("EMAIL_DAILY_LIMIT", "2")
    e.reset_limits()
    assert [e._under_daily_limit() for _ in range(3)] == [True, True, False]


# --- provider selection ------------------------------------------------------

@pytest.fixture
def clean_env(monkeypatch):
    for v in ENV_VARS:
        monkeypatch.setenv(v, "")


@pytest.mark.parametrize("env,expected", [
    ({}, None),
    ({"GMAIL_USER": "a@gmail.com"}, None),  # needs both SMTP vars
    ({"GMAIL_USER": "a@gmail.com", "GMAIL_APP_PASSWORD": "x"}, "smtp"),
    ({"BREVO_API_KEY": "k", "GMAIL_USER": "a@gmail.com", "GMAIL_APP_PASSWORD": "x"}, "brevo"),
    ({"RESEND_API_KEY": "k", "BREVO_API_KEY": "k"}, "resend"),
])
def test_provider_selection(clean_env, monkeypatch, env, expected):
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    assert e.provider_name() == expected


def test_health_reports_provider_name(sheet_client, clean_env, monkeypatch):
    monkeypatch.setenv("BREVO_API_KEY", "secret-key")
    body = sheet_client.get("/health").json()
    assert body["email"] == "brevo" and "secret-key" not in json.dumps(body)


# --- provider payloads (the autouse fixture patches _send, so restore it) ------

@pytest.fixture
def real_send(monkeypatch, clean_env):
    """Undo the no_email patch and capture what would go to urlopen."""
    monkeypatch.setattr(e, "_send", REAL_SEND)
    calls = []

    class Resp:
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def fake_urlopen(req, timeout=None):
        calls.append({"url": req.full_url, "headers": {k.lower(): v for k, v in req.header_items()},
                      "body": json.loads(req.data), "timeout": timeout})
        return Resp()

    monkeypatch.setattr(e.urllib.request, "urlopen", fake_urlopen)
    return calls


def test_resend_payload(real_send, monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_123")
    monkeypatch.setenv("EMAIL_FROM", "B4P <requests@example.org>")
    monkeypatch.setenv("HQ_EMAIL", "hq@example.org")
    assert e.send("a@example.org", "Hi\r\nBcc: x@y.z", "<p>Hi</p>", "Hi") is True
    call = real_send[0]
    assert call["url"] == "https://api.resend.com/emails" and call["timeout"] == 10
    assert call["headers"]["authorization"] == "Bearer re_123"
    assert call["body"] == {"from": "B4P <requests@example.org>", "to": ["a@example.org"],
                            "subject": "Hi Bcc: x@y.z", "html": "<p>Hi</p>", "text": "Hi",
                            "reply_to": "hq@example.org"}


def test_brevo_payload(real_send, monkeypatch):
    monkeypatch.setenv("BREVO_API_KEY", "xkeysib-1")
    monkeypatch.setenv("EMAIL_FROM", "B4P <requests@example.org>")
    monkeypatch.setenv("EMAIL_REPLY_TO", "help@example.org")
    assert e.send("a@example.org", "Hi", "<p>Hi</p>", "Hi") is True
    call = real_send[0]
    assert call["url"] == "https://api.brevo.com/v3/smtp/email"
    assert call["headers"]["api-key"] == "xkeysib-1"
    assert call["body"] == {"sender": {"name": "B4P", "email": "requests@example.org"},
                            "to": [{"email": "a@example.org"}], "subject": "Hi",
                            "htmlContent": "<p>Hi</p>", "textContent": "Hi",
                            "replyTo": {"email": "help@example.org"}}


def test_send_returns_false_without_provider(real_send):
    assert e.send("a@example.org", "Hi", "<p>Hi</p>") is False
    assert real_send == []


def test_send_never_raises_and_does_not_log_secrets(real_send, monkeypatch, caplog):
    monkeypatch.setenv("RESEND_API_KEY", "re_supersecret")
    monkeypatch.setenv("EMAIL_FROM", "x@example.org")

    def boom(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 403, "Forbidden", {}, io.BytesIO(b'{"message":"bad domain"}'))

    monkeypatch.setattr(e.urllib.request, "urlopen", boom)
    assert e.send("a@example.org", "Hi", "<p>Hi</p>") is False
    assert "403" in caplog.text and "bad domain" in caplog.text and "re_supersecret" not in caplog.text

    def timeout(req, timeout=None):
        raise TimeoutError("timed out")

    monkeypatch.setattr(e.urllib.request, "urlopen", timeout)
    assert e.send("a@example.org", "Hi", "<p>Hi</p>") is False


def test_address_aliases_share_one_confirmation_budget(sheet_client, no_email):
    for a in ["victim@gmail.com", "v.ictim+1@gmail.com", "VICTIM@googlemail.com", "victim+x@gmail.com."]:
        assert _submit(sheet_client, email=a).status_code == 200
    assert len(no_email) == 3


def test_confirmation_has_fixed_subject_and_no_links(sheet_client, no_email):
    r = sheet_client.post("/requests", json={
        "org_name": "Verify at https://evil.test/login", "org_email": "v@example.org",
        "items": [{"item_name": "see www.evil.test", "quantity": 1}]})
    assert r.status_code == 200
    (to, subject, html), = no_email
    assert "evil.test" not in subject + html and "ignore this email" in html


# --- patient identifiers (specimen-tube labels in the inventory) -----------------

PHI_NAME = "UR IMMUNO, UPEP FROZEN Pt. ID " "0000000006-1 ST15"


def test_redact_phi_variants():
    import main
    assert main._redact_phi(PHI_NAME) == "UR IMMUNO, UPEP FROZEN Pt. ID [removed] ST15"
    assert main._redact_phi("pt id " "0000000007-1") == "Pt. ID [removed]"
    assert main._redact_phi("PT.ID  A1") == "Pt. ID [removed]"
    assert main._redact_phi("Gauze pads") == "Gauze pads"


def test_inventory_endpoints_never_return_patient_ids(sheet_client, monkeypatch):
    import main
    rec = {"Name": PHI_NAME, "Category": "Lab", "Quantity": "9", "Review": "",
           "Notes": "label Pt. ID " "0000000008-1", "_sheet_row": 2}
    monkeypatch.setattr(main, "_load_inventory_records", lambda: [dict(rec)])
    for url in ("/api/supplies", "/inventory/availability"):
        body = sheet_client.get(url).text
        assert "0000000001" not in body and "C000000002" not in body, url
    assert "Pt. ID [removed]" in sheet_client.get("/api/supplies").text


def test_submitted_item_name_is_redacted_in_storage_and_email(sheet_client, no_email, monkeypatch):
    monkeypatch.setenv("HQ_EMAIL", "hq@example.org")
    r = sheet_client.post("/requests", json={"org_name": "Lab", "org_email": "lab@example.org",
                                             "items": [{"item_name": PHI_NAME, "quantity": 1}]})
    assert r.status_code == 200
    assert no_email and all("0000000001" not in html for _, _, html in no_email)
    rows = sheet_client.get("/requests", params={"email": "lab@example.org"}).json()
    assert "0000000001" not in rows[0]["Item Name"]


# --- performance: gzip, cache headers, ETag, no photos ---------------------------

@pytest.fixture
def big_inventory(sheet_client, monkeypatch):
    import main
    rows = [{"Name": f"Item {i}", "Category": "Cat", "Quantity": "20", "Review": "",
             "Image URL": "https://example.test/photo", "_sheet_row": i + 2} for i in range(60)]
    monkeypatch.setattr(main, "_load_inventory_records", lambda: [dict(r) for r in rows])
    return sheet_client


def test_large_responses_are_gzipped(big_inventory):
    r = big_inventory.get("/api/supplies", headers={"Accept-Encoding": "gzip"})
    assert r.headers["content-encoding"] == "gzip" and len(r.json()) == 60


@pytest.mark.parametrize("url", ["/api/supplies", "/inventory/availability"])
def test_public_endpoints_have_cache_header_and_etag(big_inventory, url):
    r = big_inventory.get(url)
    assert r.headers["cache-control"] == "public, max-age=60, stale-while-revalidate=300"
    etag = r.headers["etag"]
    assert etag.startswith('W/"')
    again = big_inventory.get(url, headers={"If-None-Match": etag})
    assert again.status_code == 304 and again.content == b"" and again.headers["etag"] == etag
    assert big_inventory.get(url, headers={"If-None-Match": '"other", ' + etag}).status_code == 304
    assert big_inventory.get(url, headers={"If-None-Match": 'W/"stale"'}).status_code == 200


def test_etag_changes_when_data_changes(big_inventory, monkeypatch):
    import main
    first = big_inventory.get("/api/supplies").headers["etag"]
    main._inventory_cache.clear()
    monkeypatch.setattr(main, "_load_inventory_records", lambda: [{"Name": "Other", "_sheet_row": 2}])
    assert big_inventory.get("/api/supplies").headers["etag"] != first


def test_supplies_drop_image_url_but_keep_other_fields(big_inventory):
    rows = big_inventory.get("/api/supplies").json()
    assert all("Image URL" not in r for r in rows)
    assert rows[0]["Name"] == "Item 0" and rows[0]["_sheet_row"] == 2


def test_org_request_lookup_is_never_cached(sheet_client):
    r = sheet_client.get("/requests", params={"email": "someone@example.org"})
    assert r.headers["cache-control"] == "no-store"


# --- lot suffix on requested item names -------------------------------------------

def test_base_item_name_strips_one_trailing_lot_suffix():
    import main
    assert main._base_item_name("Gauze [Lot A1, Box 2, Pallet 3]") == "Gauze"
    assert main._base_item_name("Gauze") == "Gauze"
    assert main._base_item_name("BD 10ml Syringe [Lot 1234567, Box —, Pallet 1]") == "BD 10ml Syringe"  # em dash
    assert main._base_item_name("Gauze [Lot A] [Lot B]") == "Gauze [Lot A]"  # only one suffix
    assert main._base_item_name("Gauze [Lot A] extra") == "Gauze [Lot A] extra"


def _status_of(client, name):
    return next(a for a in client.get("/inventory/availability").json() if a["item_name"] == name)["availability_status"]


def test_suffixed_approved_request_holds_stock_like_a_plain_one(sheet_client, no_email, monkeypatch):
    import main
    monkeypatch.setattr(e, "CONFIRMATIONS_PER_IP", 100)
    for n, (suffix, qty, expected) in enumerate(((("", 10, "Requested")),
                                                   (" [Lot L1, Box 2, Pallet 3]", 10, "Requested"),
                                                   (" [Lot L1, Box 2, Pallet 3]", 6, "Limited")), start=1):
        main._sample_org_request_rows.clear()
        main._hits.clear()
        assert _status_of(sheet_client, "Gauze") == "Available"  # 10 in stock
        rid = sheet_client.post("/requests", json={
            "org_name": "O", "org_email": f"o{n}@example.org",
            "items": [{"item_name": "Gauze" + suffix, "quantity": qty}]}).json()["request_id"]
        assert _status_of(sheet_client, "Gauze") == expected  # Under Review already holds it
        r = sheet_client.patch(f"/requests/{rid}/status", json={"status": "Approved"},
                               headers={"X-HQ-Token": "test-hq-token"})
        assert r.status_code == 200
        assert _status_of(sheet_client, "Gauze") == expected


def test_review_flag_matches_suffixed_name_and_full_name_is_kept(sheet_client, no_email, monkeypatch):
    monkeypatch.setenv("HQ_EMAIL", "hq@example.org")
    full = "Syringe [Lot L9, Box 1, Pallet 1]"  # Syringe is Review needed in the sample inventory
    r = sheet_client.post("/requests", json={"org_name": "O", "org_email": "r@example.org",
                                             "items": [{"item_name": full, "quantity": 1}]})
    assert r.status_code == 200
    rows = sheet_client.get("/requests", params={"email": "r@example.org"}).json()
    assert rows[0]["Review Flag"] == "TRUE" and rows[0]["Item Name"] == full
    alert = next(m for m in no_email if m[0] == "hq@example.org")
    assert "Manual review required" in alert[2] and "Lot L9" in alert[2]
    assert all("Lot L9" not in m[2] for m in no_email if m[0] == "r@example.org")  # fixed template


# --- digest without a timer; cache clear on status change ---------------------------

def _flood_alerts(n):
    items = [{"item_name": "Gauze", "category": "C", "quantity": 1}]
    for _ in range(n):
        e.send_hq_alert("Org", "o@example.org", items, "REQ-1", [])


def test_held_back_digest_is_sent_by_the_next_request_after_the_hour(sheet_client, no_email, monkeypatch):
    monkeypatch.setenv("HQ_EMAIL", "hq@example.org")
    _flood_alerts(31)  # 30 alerts + the 31st triggers the first digest at once
    digests = lambda: [m for m in no_email if "more supply request" in m[1]]  # noqa: E731
    assert len(digests()) == 1
    _flood_alerts(4)  # held back, and a digest was just sent, so it must wait
    assert len(digests()) == 1 and e.digest_due() is False
    sheet_client.get("/health")
    assert len(digests()) == 1  # not due yet

    real_time = e.time.time
    monkeypatch.setattr(e.time, "time", lambda: real_time() + 3700)  # an hour later, no timer ran
    assert e.digest_due() is True
    sheet_client.get("/health")  # any request flushes it
    assert len(digests()) == 2 and e.digest_due() is False
    sheet_client.get("/health")
    assert len(digests()) == 2  # only once


def test_email_module_has_no_timers_or_threads():
    source = (Path(__file__).resolve().parent.parent / "app" / "services" / "email.py").read_text()
    assert "threading" not in source and "Timer" not in source and "sched" not in source


def test_status_change_clears_this_instances_inventory_cache(sheet_client, no_email):
    import main
    rid = _submit(sheet_client).json()["request_id"]
    main._inventory_cache.update(records=[{"Name": "stale"}], at=main.time.monotonic())
    r = sheet_client.patch(f"/requests/{rid}/status", json={"status": "Approved"},
                           headers={"X-HQ-Token": "test-hq-token"})
    assert r.status_code == 200 and main._inventory_cache == {}


# --- broader patient-data redaction (synthetic strings only) -------------------------

@pytest.mark.parametrize("text,expected", [
    ("Pt ID " "0000000001-1", "Pt. ID [removed]"),
    ("PtID" "0000000002", "Pt. ID [removed]"),
    ("pt.id: C000000003", "Pt. ID [removed]"),
    ("Patient ID #A0000004", "Pt. ID [removed]"),
    ("Pat ID " "0000000005", "Pt. ID [removed]"),
    ("MRN " "0000006", "MRN [removed]"),
    ("Med Rec # 0000007", "MRN [removed]"),
    ("medical record number: 0000008", "MRN [removed]"),
    ("DOB 01/02/1900", "DOB [removed]"),
    ("D.O.B. 1900-01-02", "DOB [removed]"),
    ("date of birth: Jan 2, 1900", "DOB [removed]"),
    ("Patient: Test Person", "Pt. [name removed]"),
    ("Pt name Test Person", "Pt. [name removed]"),
    ("UR TEST FROZEN pt id " "0000000009 ST15 and DOB 1/2/1900", "UR TEST FROZEN Pt. ID [removed] ST15 and DOB [removed]"),
])
def test_patient_identifiers_are_redacted(text, expected):
    import main
    assert main._redact_phi(text) == expected


@pytest.mark.parametrize("text", [
    "REF 302995", "Lot 6106151", "18G x 1.5 in", "Sterile EO, expiration date 2030-11-07, quantity one",
    "Patient-ready kit", "patient safety valve", "Pt ID label", "Lot 1234567890123", "Box 12 of 40",
    "call before use", "Model DOB-100", "Reorder REF 3829991234 or lot number 0012345678", "Medical record keeping supplies",
])
def test_product_text_is_not_redacted(text):
    import main
    assert main._redact_phi(text, notes=True) == text


@pytest.mark.parametrize("text,expected", [
    ("Call 555-123-4567 for pickup", "[phone removed] for pickup"),
    ("(555) 123 4567", "[phone removed]"),
    ("+1 555.123.4567", "[phone removed]"),
    ("Tel: 555 1234", "[phone removed]"),
])
def test_phone_numbers_are_redacted_in_notes_only(text, expected):
    import main
    assert main._redact_phi(text, notes=True) == expected
    assert main._redact_phi(text) == text  # not in other fields: product codes live there


def test_inventory_output_redacts_notes_and_names_but_keeps_product_codes(sheet_client, monkeypatch):
    import main
    rec = {"Name": "UR TEST Pt. ID " "0000000001-1 ST15", "Category": "Lab", "Quantity": "9", "Review": "",
           "Notes": "Patient: Test Person, MRN " "0000006, call 555-123-4567. REF 302995 Lot 6106151",
           "Lot Number": "5551234567", "_sheet_row": 2}
    monkeypatch.setattr(main, "_load_inventory_records", lambda: [dict(rec)])
    row = sheet_client.get("/api/supplies").json()[0]
    assert "Test Person" not in row["Notes"] and "0000006" not in row["Notes"] and "555-123" not in row["Notes"]
    assert "REF 302995" in row["Notes"] and "Lot 6106151" in row["Notes"]
    assert "0000000001" not in row["Name"] and row["Lot Number"] == "5551234567"  # only Notes get phone rules


def test_emails_never_include_notes():
    source = (Path(__file__).resolve().parent.parent / "app" / "services" / "email.py").read_text().lower()
    assert "notes" not in source


# --- row-level and specimen-row patient ID redaction ----------------------------------

def _redacted(monkeypatch, rec):
    import main
    monkeypatch.setattr(main, "_load_inventory_records", lambda: [dict(rec)])
    return main.get_inventory_records()[0]


def test_labelled_id_is_removed_from_every_column_of_its_row(monkeypatch):
    row = _redacted(monkeypatch, {"Name": "Gauze Pt. ID " "0000000003-1", "Lot Number": "0000000003-1",
                                  "Notes": "ref 0000000003-1 box", "Quantity": "2"})
    assert "0000000003" not in str(row)
    other = _redacted(monkeypatch, {"Name": "Gauze", "Lot Number": "0000000003-1"})
    assert other["Lot Number"] == "[removed]"  # unlabelled but ID-shaped: removed on any row


@pytest.mark.parametrize("name", ["Blood collection tube", "Urine sample cup", "Serum separator", "Sample vial",
                                  "Specimen tube", "Plasma tube"])
def test_specimen_rows_lose_unlabelled_patient_id_shaped_tokens(monkeypatch, name):
    row = _redacted(monkeypatch, {"Name": name, "Lot Number": "C000000004-12", "Notes": "keep REF 1234567890",
                                  "Subcategory": "", "Quantity": "1"})
    assert row["Lot Number"] == "[removed]" and "REF 1234567890" in row["Notes"]


def test_id_shaped_tokens_are_removed_on_every_row_unless_they_follow_a_code_label(monkeypatch):
    row = _redacted(monkeypatch, {"Name": "Gauze pads", "Lot Number": "0000000005-1", "Quantity": "1",
                                  "Notes": "REF 1234567890-1, Cat. no 2345678901-2, item #3456789012-3, model 4567890123-4, part no 6789012345-6, "
                                           "seen 5678901234-5"})
    assert row["Lot Number"] == "[removed]"
    assert "1234567890-1" in row["Notes"] and "2345678901-2" in row["Notes"]
    assert "3456789012-3" in row["Notes"] and "4567890123-4" in row["Notes"] and "6789012345-6" in row["Notes"]
    assert "5678901234" not in row["Notes"]  # unlabelled: removed


def test_ref_number_in_notes_survives():
    import main
    assert main._redact_phi("REF 1234567890", notes=True) == "REF 1234567890"


def test_dashless_and_suffixless_copies_of_a_labelled_id_are_removed(monkeypatch):
    row = _redacted(monkeypatch, {"Name": "Gauze Pt. ID " "0000000004-12", "Notes": "tube 000000000412 and 0000000004 only",
                                  "Lot Number": "x0000000004-12y", "Quantity": "1"})
    assert "0000000004" not in str(row)
    short = _redacted(monkeypatch, {"Name": "Gauze Pt. ID " "12345-6", "Notes": "box 123456 of 12345-6", "Quantity": "1"})
    assert short["Notes"] == "box 123456 of [removed]"  # short IDs only match as written
