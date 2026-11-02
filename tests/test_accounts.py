"""Accounts: sign up (signed in at once, no codes), sign in, lockout, sign out, change password,
team reset links, team access, and "My requests" for the signed-in clinic only. Every test gets a
fresh local account file (conftest.local_accounts); nothing touches the database."""
import pytest
from fastapi.testclient import TestClient

import main
from app import accounts, auth

PASSWORD = "correct horse battery"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setenv("USE_SAMPLE_DATA", "1")
    monkeypatch.setattr(main, "_sample_org_request_rows", [])
    main._hits.clear()  # rate limits are per process
    return TestClient(main.app)


def signup(c, email="ana@riverside.org", org="Riverside Clinic", password=PASSWORD):
    return c.post("/api/auth/signup", json={"email": email, "org_name": org, "password": password})


def make_team(email="hq@b4pglobal.org"):
    store = accounts.store()
    store.create_account(email, "Blueprints for Pangaea", auth.hash_password(PASSWORD))
    store.set_role(email, "hq")


def login(c, email, password=PASSWORD):
    return c.post("/api/auth/login", json={"email": email, "password": password})


def send_request(c, email="ana@riverside.org"):
    return c.post("/requests", json={"org_name": "Typed Name", "org_email": email,
                                     "items": [{"item_name": "Gauze", "quantity": 1}]})


# --- signing up and in ------------------------------------------------------------------------

def test_sign_up_signs_in_at_once_with_an_httponly_cookie(client):
    r = signup(client)
    assert r.status_code == 200, r.text
    assert r.json() == {"email": "ana@riverside.org", "org_name": "Riverside Clinic", "role": "clinic"}
    cookie = r.headers["set-cookie"]
    assert "b4p_session=" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie
    assert "no-store" in r.headers["cache-control"]
    assert client.get("/api/auth/me").json()["org_name"] == "Riverside Clinic"


def test_the_password_is_stored_only_as_an_argon2id_hash(client):
    signup(client)
    import sqlite3
    row = sqlite3.connect(accounts.local_path()).execute("SELECT password_hash FROM account").fetchone()
    assert row[0].startswith("$argon2id$") and PASSWORD not in row[0]
    tokens = sqlite3.connect(accounts.local_path()).execute("SELECT token_hash FROM account_session").fetchall()
    assert all(len(t[0]) == 32 for t in tokens)  # a digest, never the cookie itself
    assert client.cookies.get("b4p_session") not in str(tokens)


@pytest.mark.parametrize("body,field", [
    ({"email": "not-an-email", "org_name": "C", "password": PASSWORD}, "email"),
    ({"email": "a@b.org", "org_name": "   ", "password": PASSWORD}, "org_name"),
    ({"email": "a@b.org", "org_name": "C", "password": "short"}, "password"),
    ({"email": "a@b.org", "org_name": "C", "password": "x" * 129}, "password"),
])
def test_sign_up_checks_the_form(client, body, field):
    r = client.post("/api/auth/signup", json=body)
    assert r.status_code == 422
    assert field in r.text


def test_an_email_can_have_only_one_account_any_case(client):
    assert signup(client).status_code == 200
    r = signup(client, email="ANA@Riverside.org", org="Someone Else")
    assert r.status_code == 409 and "Sign in instead" in r.json()["detail"]


def test_sign_in_any_case_and_a_wrong_password_says_the_same_for_every_case(client):
    signup(client)
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401
    assert login(client, "ANA@riverside.org").status_code == 200
    wrong = login(client, "ana@riverside.org", "not the password")
    nobody = login(client, "nobody@riverside.org")
    assert wrong.status_code == nobody.status_code == 401
    assert wrong.json()["detail"] == nobody.json()["detail"]  # never says which emails have accounts


def test_five_wrong_passwords_lock_the_account_even_for_the_right_one(client):
    signup(client)
    for _ in range(5):
        assert login(client, "ana@riverside.org", "wrong password!").status_code == 401
    assert login(client, "ana@riverside.org").status_code == 401  # locked for 15 minutes
    assert "locked" in login(client, "ana@riverside.org").json()["detail"]


def test_sign_out_ends_the_session_on_the_server_too(client):
    signup(client)
    cookie = client.cookies.get("b4p_session")
    client.post("/api/auth/logout")
    client.cookies.set("b4p_session", cookie)  # someone kept a copy of the cookie
    assert client.get("/api/auth/me").status_code == 401


def test_change_password_needs_the_current_one_and_signs_out_other_browsers(client):
    signup(client)
    other = TestClient(main.app)
    assert login(other, "ana@riverside.org").status_code == 200
    bad = client.post("/api/auth/password/change", json={"current_password": "nope", "new_password": "a brand new one"})
    assert bad.status_code == 403
    ok = client.post("/api/auth/password/change", json={"current_password": PASSWORD, "new_password": "a brand new one"})
    assert ok.status_code == 200
    assert client.get("/api/auth/me").status_code == 200   # this browser stays in
    assert other.get("/api/auth/me").status_code == 401    # the other one is signed out
    assert login(other, "ana@riverside.org", "a brand new one").status_code == 200


def test_accounts_need_the_database_when_deployed(client, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    r = signup(client)
    assert r.status_code == 503 and "aren’t available" in r.json()["detail"]
    assert client.get("/api/auth/me").status_code == 401  # nobody is signed in, nothing crashes


# --- the team: reset links and access ---------------------------------------------------------

def test_a_team_reset_link_works_once_signs_in_and_ends_other_sessions(client):
    signup(client)
    clinic_browser = TestClient(main.app)
    login(clinic_browser, "ana@riverside.org")
    team = TestClient(main.app)
    make_team()
    login(team, "hq@b4pglobal.org")
    r = team.post("/api/team/accounts/reset-link", json={"email": "ana@riverside.org"})
    assert r.status_code == 200 and r.json()["hours"] == 24
    token = r.json()["token"]
    fresh = TestClient(main.app)
    done = fresh.post("/api/auth/password/reset", json={"token": token, "password": "reset password 1"})
    assert done.status_code == 200 and done.json()["email"] == "ana@riverside.org"
    assert fresh.get("/api/auth/me").status_code == 200        # signed in with the new password
    assert clinic_browser.get("/api/auth/me").status_code == 401  # old sessions ended
    again = fresh.post("/api/auth/password/reset", json={"token": token, "password": "another one 12"})
    assert again.status_code == 400 and "Ask the Blueprints team" in again.json()["detail"]
    assert login(fresh, "ana@riverside.org", "reset password 1").status_code == 200


def test_a_newer_reset_link_cancels_the_older_one(client):
    signup(client)
    make_team()
    team = TestClient(main.app)
    login(team, "hq@b4pglobal.org")
    first = team.post("/api/team/accounts/reset-link", json={"email": "ana@riverside.org"}).json()["token"]
    second = team.post("/api/team/accounts/reset-link", json={"email": "ana@riverside.org"}).json()["token"]
    c = TestClient(main.app)
    assert c.post("/api/auth/password/reset", json={"token": first, "password": "reset password 1"}).status_code == 400
    assert c.post("/api/auth/password/reset", json={"token": second, "password": "reset password 1"}).status_code == 200


def test_only_team_accounts_make_reset_links_or_see_all_accounts_and_requests(client, monkeypatch):
    monkeypatch.delenv("HQ_API_TOKEN", raising=False)
    signup(client)  # a clinic
    assert client.post("/api/team/accounts/reset-link", json={"email": "ana@riverside.org"}).status_code in (401, 403)
    assert client.get("/api/team/accounts").status_code in (401, 403)
    assert client.get("/requests").status_code in (401, 403)
    make_team()
    team = TestClient(main.app)
    login(team, "hq@b4pglobal.org")
    listed = team.get("/api/team/accounts").json()
    assert {a["email"] for a in listed} == {"ana@riverside.org", "hq@b4pglobal.org"}
    assert all("password" not in str(a) for a in listed)
    assert team.get("/requests").status_code == 200
    assert team.post("/api/team/accounts/reset-link", json={"email": "nobody@x.org"}).status_code == 404


def test_the_hq_token_still_works_for_scripts(client, monkeypatch):
    monkeypatch.setenv("HQ_API_TOKEN", "script-token")
    assert client.get("/requests", headers={"X-HQ-Token": "script-token"}).status_code == 200
    assert client.get("/requests", headers={"X-HQ-Token": "wrong"}).status_code == 401


def test_the_one_line_command_makes_a_team_account(monkeypatch, capsys):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("VERCEL", "")  # skip .env loading in the command
    from app import create_team_account
    answers = iter([PASSWORD, PASSWORD])
    monkeypatch.setattr(create_team_account.getpass, "getpass", lambda prompt="": next(answers))
    assert create_team_account.main(["Team@B4PGlobal.org"]) == 0
    row = accounts.store().login_row("team@b4pglobal.org")
    assert row and auth.verify_password(PASSWORD, row["password_hash"])
    assert {a["email"]: a["role"] for a in accounts.store().list_accounts()}["Team@B4PGlobal.org"] == "hq"
    # an existing clinic account can be made a team account without a password prompt
    accounts.store().create_account("ops@b4pglobal.org", "B4P", auth.hash_password(PASSWORD))
    assert create_team_account.main(["ops@b4pglobal.org"]) == 0
    assert "now a Blueprints team account" in capsys.readouterr().out


# --- requests and "My requests" ----------------------------------------------------------------

def test_my_requests_needs_a_session_for_that_same_email(client):
    assert client.get("/requests", params={"email": "ana@riverside.org"}).status_code == 401
    signup(client)
    assert client.get("/requests", params={"email": "someone@else.org"}).status_code == 403
    assert client.get("/requests", params={"email": "ANA@riverside.org"}).status_code == 200


def test_requests_sent_before_the_account_existed_stay_hidden(client):
    # Someone (not this person) sent a request as ana@riverside.org before any account existed.
    assert send_request(client).status_code == 200
    signup(client)  # anyone can sign up with that address: nothing proves they own the inbox
    assert client.get("/requests", params={"email": "ana@riverside.org"}).json() == []
    rid = send_request(client).json()["request_id"]
    mine = client.get("/requests", params={"email": "ana@riverside.org"}).json()
    assert [r["Request ID"] for r in mine] == [rid]


def test_a_signed_in_request_uses_the_account_not_what_the_page_sent(client):
    signup(client)
    client.post("/requests", json={"org_name": "Someone Else", "org_email": "victim@other.org",
                                   "items": [{"item_name": "Gauze", "quantity": 1}]})
    row = main._sample_org_request_rows[-1]
    assert (row["Org Name"], row["Org Email"]) == ("Riverside Clinic", "ana@riverside.org")
