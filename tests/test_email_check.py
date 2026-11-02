"""The email domain check: format, disposable inboxes, DNS answers, timeouts and the cache.
DNS is faked: tests never touch the network."""
import socket

from fastapi.testclient import TestClient

import main
from app import email_check


def fake_dns(monkeypatch, mx=None, address=True, calls=None):
    def query(domain, qtype=15):
        if calls is not None:
            calls.append(domain)
        return mx
    monkeypatch.setattr(email_check, "_query", query)
    monkeypatch.setattr(email_check, "_has_address", lambda d: address)
    email_check._CACHE.clear()


def test_domain_with_mail_servers_is_ok(monkeypatch):
    fake_dns(monkeypatch, mx=(0, 2))
    assert email_check.check_domain("Clinic.org") == "ok"


def test_unknown_domain_is_flagged(monkeypatch):
    fake_dns(monkeypatch, mx=(3, 0))
    assert email_check.check_domain("gmial.con") == "no-domain"


def test_no_mail_servers_falls_back_to_the_address(monkeypatch):
    fake_dns(monkeypatch, mx=(0, 0), address=True)
    assert email_check.check_domain("small-clinic.org") == "ok"
    fake_dns(monkeypatch, mx=(0, 0), address=False)
    assert email_check.check_domain("parked.org") == "no-mail"


def test_disposable_inboxes_are_flagged_without_a_lookup(monkeypatch):
    calls = []
    fake_dns(monkeypatch, mx=(0, 1), calls=calls)
    assert email_check.check_domain("mailinator.com") == "disposable"
    assert calls == []


def test_no_answer_or_server_failure_is_unknown_and_not_cached(monkeypatch):
    calls = []
    fake_dns(monkeypatch, mx=None, calls=calls)
    assert email_check.check_domain("clinic.org") == "unknown"
    fake_dns(monkeypatch, mx=(2, 0), calls=calls)  # SERVFAIL
    assert email_check.check_domain("clinic.org") == "unknown"
    assert len(calls) == 2


def test_a_timeout_is_unknown(monkeypatch):
    def slow(domain, qtype=15):
        raise socket.timeout("timed out")
    monkeypatch.setattr(email_check, "_query", slow)
    email_check._CACHE.clear()
    assert email_check.check_domain("clinic.org") == "unknown"


def test_answers_are_cached(monkeypatch):
    calls = []
    fake_dns(monkeypatch, mx=(0, 1), calls=calls)
    email_check.check_domain("clinic.org")
    email_check.check_domain("CLINIC.org.")
    assert calls == ["clinic.org"]


def test_no_nameserver_is_unknown(monkeypatch, tmp_path):
    empty = tmp_path / "resolv.conf"
    empty.write_text("# nothing here\n")
    monkeypatch.setenv("RESOLV_CONF", str(empty))
    assert email_check._query("clinic.org") is None


def test_endpoint_takes_the_domain_only(monkeypatch):
    fake_dns(monkeypatch, mx=(3, 0))
    client = TestClient(main.app)
    r = client.get("/api/auth/check-email", params={"domain": "gmial.con"})
    assert r.status_code == 200
    assert r.json() == {"domain": "gmial.con", "result": "no-domain"}
    assert client.get("/api/auth/check-email", params={"domain": "bad domain!"}).json()["result"] == "no-domain"
    assert r.headers["cache-control"] == "no-store"
