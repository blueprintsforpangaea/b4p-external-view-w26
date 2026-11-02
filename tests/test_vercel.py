"""Vercel serverless hosting: api/index.py wrapper, no pandas, inline email, preview/production modes."""
import importlib.util
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
BODY = {"org_name": "Clinic", "org_email": "c@example.org",
        "items": [{"item_name": "Gauze pads", "quantity": 1}]}


@pytest.fixture
def vercel_client(monkeypatch):
    """The Vercel entry point (api/index.py) in preview mode with no secrets: demo data."""
    import main
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("USE_SAMPLE_DATA", raising=False)
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("VERCEL_ENV", "preview")
    monkeypatch.setattr(main, "_sample_org_request_rows", [])
    spec = importlib.util.spec_from_file_location("vercel_entry", ROOT / "api" / "index.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return TestClient(module.app)


# --- 1. the /api mount ---------------------------------------------------------

def test_routes_are_served_under_api_prefix(vercel_client):
    assert vercel_client.get("/api/health").json()["ok"] is True
    rows = vercel_client.get("/api/api/supplies").json()  # frontend's /api/supplies, behind the mount
    assert rows and rows[0]["Name"]
    r = vercel_client.post("/api/requests", json=BODY)
    assert r.status_code == 200
    assert vercel_client.get("/api/requests", params={"email": "c@example.org"}).json()[0]["Request ID"] \
        == r.json()["request_id"]
    assert vercel_client.get("/health").status_code == 404  # only reachable through /api


# --- 3. no pandas ---------------------------------------------------------------

def test_pandas_is_gone():
    assert "pandas" not in (ROOT / "requirements.txt").read_text()
    assert "pandas" not in (ROOT / "main.py").read_text()


def test_header_cleaning_and_ragged_rows(monkeypatch):
    import main

    class WS:
        def get_all_values(self):
            return [[" Name ", "", "Qty", "Qty"], ["Gauze", "x"], ["Tape", "y", "3", "4", "extra"]]

    class SS:
        sheet1 = WS()

        def worksheet(self, title):  # no "Final Inventorying" tab here: the first tab is read
            import gspread
            raise gspread.WorksheetNotFound(title)

    class Client:
        def open_by_key(self, key):
            return SS()

    monkeypatch.setattr(main, "_gspread_client", lambda: Client())
    monkeypatch.setenv("GOOGLE_SHEET_ID", "id")
    monkeypatch.setenv("GOOGLE_CREDENTIALS_JSON", "{}")
    assert main._read_sheet_inventory() == [
        {"Name": "Gauze", "Unnamed_1": "x", "Qty": "", "Qty.1": "", "_sheet_row": 2},
        {"Name": "Tape", "Unnamed_1": "y", "Qty": "3", "Qty.1": "4", "_sheet_row": 3},
    ]


# --- 5. email inline on Vercel ----------------------------------------------------

def test_email_is_sent_inline_not_via_background_tasks(vercel_client, no_email, monkeypatch):
    from fastapi import BackgroundTasks
    monkeypatch.setenv("GOOGLE_CREDENTIALS_JSON", "{}")  # not a preview-with-demo-data setup
    monkeypatch.setenv("USE_SAMPLE_DATA", "1")
    monkeypatch.setenv("VERCEL_ENV", "development")
    monkeypatch.setenv("HQ_EMAIL", "hq@example.org")
    monkeypatch.setattr(BackgroundTasks, "add_task", lambda *a, **k: pytest.fail("used BackgroundTasks"))
    assert vercel_client.post("/api/requests", json=BODY).status_code == 200
    assert sorted(m[0] for m in no_email) == ["c@example.org", "hq@example.org"]


def test_slow_email_provider_cannot_hold_the_request_past_the_budget(vercel_client, monkeypatch):
    import main
    from app.services import email as email_svc
    monkeypatch.setenv("GOOGLE_CREDENTIALS_JSON", "{}")
    monkeypatch.setenv("USE_SAMPLE_DATA", "1")
    monkeypatch.setenv("VERCEL_ENV", "development")
    monkeypatch.setenv("HQ_EMAIL", "hq@example.org")
    monkeypatch.setattr(main, "SERVERLESS_EMAIL_BUDGET", 0.3)
    monkeypatch.setattr(email_svc, "_send", lambda *a, **k: time.sleep(1.5))
    start = time.monotonic()
    assert vercel_client.post("/api/requests", json=BODY).status_code == 200
    assert time.monotonic() - start < 1.2


def test_failing_email_provider_does_not_fail_the_request(vercel_client, monkeypatch):
    from app.services import email as email_svc

    def boom(*a, **k):
        raise RuntimeError("provider down")

    monkeypatch.setenv("GOOGLE_CREDENTIALS_JSON", "{}")
    monkeypatch.setenv("USE_SAMPLE_DATA", "1")
    monkeypatch.setenv("VERCEL_ENV", "development")
    monkeypatch.setenv("HQ_EMAIL", "hq@example.org")
    monkeypatch.setattr(email_svc, "_send", boom)
    assert vercel_client.post("/api/requests", json=BODY).status_code == 200


# --- 6. preview and production safety ---------------------------------------------

def test_preview_without_secrets_uses_demo_data_and_sends_no_email(vercel_client, no_email, monkeypatch):
    monkeypatch.setenv("HQ_EMAIL", "hq@example.org")
    assert vercel_client.post("/api/requests", json=BODY).status_code == 200
    assert no_email == []


def test_preview_is_sandboxed_even_when_real_secrets_are_in_scope(vercel_client, no_email, monkeypatch):
    import main
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@127.0.0.1:1/none")
    monkeypatch.setenv("GOOGLE_CREDENTIALS_JSON", "{}")
    monkeypatch.setenv("BREVO_API_KEY", "k")
    monkeypatch.setenv("HQ_EMAIL", "hq@example.org")
    assert main._use_sample_data() is True and main.db.enabled() is False
    assert vercel_client.post("/api/requests", json=BODY).status_code == 200  # saved to memory, not the DB
    assert no_email == [] and vercel_client.get("/api/health").json()["email"] is None


def test_preview_can_opt_in_to_real_data(monkeypatch):
    import main
    monkeypatch.delenv("USE_SAMPLE_DATA", raising=False)
    monkeypatch.setenv("VERCEL_ENV", "preview")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@127.0.0.1:1/none")
    monkeypatch.setenv("PREVIEW_ALLOW_REAL_DATA", "true")
    assert main._use_sample_data() is False and main.db.enabled() is True


@pytest.mark.parametrize("sample", [None, "1"])
def test_production_without_credentials_is_503_never_demo_data(monkeypatch, sample):
    import main
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("USE_SAMPLE_DATA", raising=False)
    monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)  # a local .env may set it
    if sample:
        monkeypatch.setenv("USE_SAMPLE_DATA", sample)
    monkeypatch.setenv("VERCEL_ENV", "production")
    c = TestClient(main.app)
    for url in ("/health", "/api/supplies", "/inventory/availability"):
        r = c.get(url)
        assert r.status_code == 503 and "not configured" in r.json()["detail"], url
    assert c.post("/requests", json=BODY).status_code == 503


def test_production_with_database_url_passes_the_guard(monkeypatch):
    import main
    monkeypatch.setenv("VERCEL_ENV", "production")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@127.0.0.1:1/none")
    r = TestClient(main.app).get("/health")
    assert r.status_code == 200 and r.json()["ok"] is False  # DB is unreachable, but not a config error


def test_tests_cannot_reach_the_live_sheet(monkeypatch):
    import os
    import main
    for var in ("GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CREDENTIALS_JSON", "GOOGLE_SHEET_ID", "REQUESTS_SHEET_ID"):
        assert os.environ[var] == "", var
    with pytest.raises(RuntimeError, match="must not touch Google Sheets"):
        main._gspread_client()


def test_dotenv_is_not_loaded_on_hosted_platforms(tmp_path):
    """Run main in a subprocess with a .env that would set a variable: only local runs read it."""
    import subprocess
    import sys
    env_file = tmp_path / ".env"
    env_file.write_text("DOTENV_PROBE=from-dotenv\n")
    code = ("import os, dotenv; dotenv.load_dotenv = (lambda *a, **k: os.environ.setdefault('DOTENV_PROBE', 'loaded'));"
            "import sys; sys.path.insert(0, %r); import main; print(os.environ.get('DOTENV_PROBE'))" % str(ROOT))
    base = {k: v for k, v in os.environ.items() if k not in ("VERCEL", "RENDER", "DOTENV_PROBE")}
    local = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=base, cwd=tmp_path)
    hosted = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                            env={**base, "VERCEL": "1"}, cwd=tmp_path)
    assert local.stdout.strip() == "loaded" and hosted.stdout.strip() == "None", (local.stderr, hosted.stderr)


def _ip_headers_client(monkeypatch):
    import main
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("VERCEL_ENV", "development")
    monkeypatch.setenv("USE_SAMPLE_DATA", "1")
    monkeypatch.delenv("TRUST_PROXY", raising=False)
    main._hits.clear()
    return main


def _fake_request(headers, host="10.0.0.1"):
    from starlette.requests import Request
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "headers": raw, "client": (host, 1), "method": "GET", "path": "/"})


def test_vercel_client_ip_prefers_vercel_header_over_spoofable_xff(monkeypatch):
    main = _ip_headers_client(monkeypatch)
    spoofed = {"x-vercel-forwarded-for": "203.0.113.9, 10.1.1.1", "x-forwarded-for": "1.2.3.4, 5.6.7.8"}
    assert main._client_ip(_fake_request(spoofed)) == "203.0.113.9"
    # no Vercel header: fall back to the last X-Forwarded-For hop, then the socket address
    assert main._client_ip(_fake_request({"x-forwarded-for": "1.2.3.4, 5.6.7.8"})) == "5.6.7.8"
    assert main._client_ip(_fake_request({})) == "10.0.0.1"


def test_vercel_header_is_ignored_off_vercel(monkeypatch):
    import main
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.delenv("TRUST_PROXY", raising=False)
    assert main._client_ip(_fake_request({"x-vercel-forwarded-for": "203.0.113.9"})) == "10.0.0.1"


def test_rate_limit_uses_the_vercel_header(monkeypatch, sheet_client):
    main = _ip_headers_client(monkeypatch)
    monkeypatch.setenv("USE_SAMPLE_DATA", "1")
    codes = [sheet_client.post("/requests", json={**BODY, "org_email": f"o{i}@example.org"},
                               headers={"x-vercel-forwarded-for": "203.0.113.9",
                                        "x-forwarded-for": f"9.9.9.{i}"}).status_code for i in range(12)]
    assert codes[:10] == [200] * 10 and set(codes[10:]) == {429}


@pytest.mark.parametrize("vercel,render,enable,hidden", [
    (None, None, None, False), ("1", None, None, True), (None, "true", None, True), ("1", None, "1", False),
])
def test_api_docs_are_off_when_deployed_unless_enabled(sheet_client, monkeypatch, vercel, render, enable, hidden):
    for name, val in (("VERCEL", vercel), ("RENDER", render), ("ENABLE_API_DOCS", enable)):
        monkeypatch.delenv(name, raising=False) if val is None else monkeypatch.setenv(name, val)
    assert (sheet_client.get("/docs").status_code == 404) is hidden


def test_internal_requests_list_needs_the_hq_token(sheet_client):
    assert sheet_client.get("/api/requests").status_code == 401
    assert sheet_client.get("/api/requests", headers={"X-HQ-Token": "wrong"}).status_code == 401
    assert sheet_client.get("/api/requests", headers={"X-HQ-Token": "test-hq-token"}).status_code == 200


def test_vercelignore_keeps_secrets_out_but_allows_the_example():
    text = (ROOT / ".vercelignore").read_text()
    for pattern in (".env*", "!.env.example", "*.pem", "*.key", "*.p12", "*credentials*.json", "*gcreds*", ".git", ".venv"):
        assert pattern in text.splitlines(), pattern


def test_internal_post_is_rate_limited_and_hq_gated(sheet_client):
    import main
    main._hits.clear()
    body = {"nametag": "N", "items": [{"sheet_row": 2, "quantity": 1}]}
    assert sheet_client.post("/api/requests", json=body).status_code == 401
    ok = {"X-HQ-Token": "test-hq-token"}
    codes = [sheet_client.post("/api/requests", json=body, headers=ok).status_code for _ in range(12)]
    assert 429 in codes and codes[0] != 401
