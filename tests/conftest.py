import os
import subprocess

# Never send real email from tests: empty values win over .env (load_dotenv does not override).
for _var in ("RESEND_API_KEY", "BREVO_API_KEY", "GMAIL_USER", "GMAIL_APP_PASSWORD",
             "EMAIL_FROM", "EMAIL_REPLY_TO", "HQ_EMAIL", "EMAIL_DAILY_LIMIT", "VERCEL", "VERCEL_ENV",
             "GOOGLE_CREDENTIALS_JSON", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_SHEET_ID",
             "REQUESTS_SHEET_ID", "PUBLIC_SHEET_READ", "INVENTORY_WORKSHEET_GID",
             "INVENTORY_WORKSHEET_TITLE", "MEMBER_ROSTER_PATH", "ROSTER_SHEET_ID", "ROSTER_TAB",
             # Never write to a real request sheet (a QA run once filled the temp sheet from .env).
             "REQUESTS_WEBHOOK_URL", "REQUESTS_WEBHOOK_SECRET"):
    os.environ[_var] = ""  # set (empty) before main is imported, so load_dotenv cannot refill them

os.environ["B4P_QA"] = "1"  # app/request_webhook.py also refuses real Apps Script URLs under tests

import psycopg
import pytest
from fastapi.testclient import TestClient

# One database per pytest process, so concurrent runs can't drop each other's copy.
TEST_DB = os.environ.get("TEST_DATABASE_URL", f"postgresql:///b4p_test_external_{os.getpid()}")
# Local Blueprints_DB database the throwaway test DB is copied from.
TEMPLATE_DB = os.environ.get("TEST_TEMPLATE_DB", "b4p_v2")


@pytest.fixture(scope="session", autouse=True)
def test_database():
    """Create a fresh copy of the template DB for this run, drop it afterwards.

    Skipped when TEST_DATABASE_URL is set (you manage that DB yourself).
    """
    if "TEST_DATABASE_URL" in os.environ:
        yield
        return
    name = TEST_DB.rsplit("/", 1)[-1]
    subprocess.run(["dropdb", "--if-exists", name], capture_output=True)
    made = subprocess.run(["createdb", "-T", TEMPLATE_DB, name], capture_output=True)
    yield
    if made.returncode == 0:
        subprocess.run(["dropdb", "--if-exists", name], capture_output=True)


@pytest.fixture(autouse=True)
def no_google_sheets(monkeypatch):
    """Tests must never reach the live Google Sheet. Tests that need sheet behaviour replace
    main._gspread_client with an in-memory fake, which bypasses this."""
    import main

    def refuse(*a, **k):
        raise RuntimeError("tests must not touch Google Sheets")

    monkeypatch.setattr(main, "_get_google_creds", refuse)


@pytest.fixture(autouse=True)
def no_request_sheet(monkeypatch):
    """No test reaches the Apps Script request sheet unless it fakes requests.post itself, and
    each test starts with no request ids marked as sent."""
    from app import request_webhook

    def refuse(*a, **k):
        raise RuntimeError("tests must not reach the request sheet web app")

    monkeypatch.setattr(request_webhook.requests, "post", refuse)
    monkeypatch.setattr(request_webhook, "BACKOFF", 0)
    request_webhook._sent.clear()
    request_webhook._last.clear()


@pytest.fixture(autouse=True)
def no_email(monkeypatch):
    """Capture every outgoing email instead of sending it."""
    from app.services import email as email_svc

    import main
    main._inventory_cache.clear()  # the 60s sheet-inventory cache would leak between tests
    email_svc.reset_limits()  # the caps are in memory and would leak between tests
    sent = []  # (to, subject, html) per email

    def fake(to, subject, html, text=None):
        sent.append((to, subject, html))
        return True

    monkeypatch.setattr(email_svc, "_send", fake)
    return sent


HQ = {"X-HQ-Token": "test-hq-token"}


@pytest.fixture(autouse=True)
def hq_token_and_rate_limit(monkeypatch):
    import main
    monkeypatch.setenv("HQ_API_TOKEN", "test-hq-token")
    main._hits.clear()


@pytest.fixture(params=["sheet", "db"])
def client(request):
    """The same test body runs in sheet mode (sample inventory) and DB mode."""
    return request.getfixturevalue(request.param + "_client")


@pytest.fixture
def db_client(monkeypatch):
    try:
        psycopg.connect(TEST_DB, connect_timeout=3).close()
    except Exception:
        pytest.skip("test database not available")
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    import main
    return TestClient(main.app)


@pytest.fixture
def sheet_client(monkeypatch, tmp_path):
    """Sheet mode (DATABASE_URL unset) backed by a small sample inventory file."""
    import json
    import main

    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("USE_SAMPLE_DATA", "1")
    sample = tmp_path / "sample.json"
    sample.write_text(json.dumps([
        {"Name": "Gauze", "Category": "Wound Care", "Quantity": "10", "Review": ""},
        {"Name": "Syringe", "Category": "Misc", "Quantity": "3", "Review": "Review needed"},
        {"Name": "Bandage", "Category": "Wound Care", "Quantity": "50", "Review": ""},
    ]))
    monkeypatch.setattr(main, "SAMPLE_PATH", sample)
    monkeypatch.setattr(main, "_sample_org_request_rows", [])
    return TestClient(main.app)


@pytest.fixture(autouse=True)
def local_accounts(monkeypatch, tmp_path):
    """Accounts go to a fresh local file per test: never the developer's own file or the database."""
    monkeypatch.setenv("ACCOUNTS_SQLITE_PATH", str(tmp_path / "accounts.sqlite3"))


@pytest.fixture(autouse=True)
def signed_in_for_email_lookups(request, monkeypatch):
    """The older tests read "My requests" as GET /requests?email=..., from before accounts. Here
    such a lookup counts as signed in as that email (an account older than every request), so those
    tests keep checking what they check: row shape, exact matching, caching. The real rules (a
    session is needed, only your own email, nothing from before the account) are in test_accounts.py,
    which this fixture leaves alone."""
    if request.module.__name__.endswith("test_accounts"):
        return
    import main

    real = main.current_account

    def current_account(req):
        account = real(req)
        email = req.query_params.get("email", "").strip()
        if account is None and req.method == "GET" and req.url.path.endswith("/requests") and email:
            return {"account_id": 0, "email": email, "org_name": "", "role": "clinic", "created_at": None}
        return account

    monkeypatch.setattr(main, "current_account", current_account)


@pytest.fixture(autouse=True)
def anonymous_submits_allowed(request, monkeypatch):
    """The deployed site needs sign-in to send a request; older tests post without an account, so
    that rule is off for them. tests/test_holds.py checks it."""
    if request.module.__name__.endswith("test_holds"):
        return
    import main
    monkeypatch.setattr(main, "_sign_in_required", lambda: False)
