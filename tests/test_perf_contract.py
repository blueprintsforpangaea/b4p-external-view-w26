"""Speed contract for the McMaster-style frontend (docs/REDESIGN_PLAN.md, "Speed budget"):
gzip, Cache-Control, ETag/304 on the public inventory endpoints, no photo URLs, and
private endpoints that are never publicly cacheable.
"""
import json

import pytest
from fastapi.testclient import TestClient

from conftest import HQ
from fixtures.real_shape_supplies import ROWS

CACHE = "public, max-age=60, stale-while-revalidate=300"
PUBLIC = ["/api/supplies", "/inventory/availability"]


@pytest.fixture
def big(monkeypatch, tmp_path):
    """Sample mode with ~40 KB of inventory, well above any gzip minimum size."""
    import main
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("USE_SAMPLE_DATA", "1")
    rows = [dict(r) for _ in range(6) for r in ROWS]
    f = tmp_path / "inventory.json"
    f.write_text(json.dumps(rows))
    monkeypatch.setattr(main, "SAMPLE_PATH", f)
    monkeypatch.setattr(main, "_sample_org_request_rows", [])
    return TestClient(main.app)


def _cc(r):
    return r.headers.get("cache-control", "").lower()


# --- no photos ------------------------------------------------------------------

def test_supplies_have_no_image_url(client):
    rows = client.get("/api/supplies").json()
    assert rows and all("Image URL" not in r for r in rows)
    assert "drive.google.com" not in json.dumps(rows)


# --- gzip -------------------------------------------------------------------------

@pytest.mark.parametrize("url", PUBLIC)
def test_large_responses_are_gzipped(big, url):
    r = big.get(url, headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"
    assert "accept-encoding" in r.headers.get("vary", "").lower()
    assert isinstance(r.json(), list)  # httpx decodes; body is still valid JSON


@pytest.mark.parametrize("url", PUBLIC)
def test_no_gzip_when_client_does_not_ask(big, url):
    r = big.get(url, headers={"Accept-Encoding": "identity"})
    assert r.status_code == 200 and "content-encoding" not in r.headers


def test_gzip_actually_shrinks_inventory(big):
    raw = big.get("/api/supplies", headers={"Accept-Encoding": "identity"})
    gz = big.get("/api/supplies", headers={"Accept-Encoding": "gzip"})
    wire = int(gz.headers.get("content-length") or len(gz.content))
    assert wire < len(raw.content) / 3


# --- Cache-Control ---------------------------------------------------------------

@pytest.mark.parametrize("url", PUBLIC)
def test_inventory_cache_control(client, url):
    assert _cc(client.get(url)) == CACHE


@pytest.mark.parametrize("method,url,kw", [
    ("get", "/requests?email=a@b.org", {}),
    ("post", "/requests", {"json": {"org_name": "O", "org_email": "a@b.org",
                                    "items": [{"item_name": "Gauze", "quantity": 1}]}}),
    ("post", "/requests", {"json": {}}),  # 422
])
def test_private_responses_are_never_publicly_cached(client, method, url, kw):
    """A shared cache must never hand one clinic's requests to another."""
    r = getattr(client, method)(url, **kw)
    cc = _cc(r)
    assert "public" not in cc and "max-age=60" not in cc
    assert "etag" not in {k.lower() for k in r.headers}


def test_my_requests_is_no_store(client):
    assert "no-store" in _cc(client.get("/requests", params={"email": "a@b.org"}))


@pytest.mark.parametrize("url", PUBLIC)
def test_errors_are_not_cached(monkeypatch, url):
    import main
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@127.0.0.1:1/nope")
    r = TestClient(main.app, raise_server_exceptions=False).get(url)
    assert r.status_code == 503
    assert "public" not in _cc(r) and "etag" not in {k.lower() for k in r.headers}


# --- ETag / 304 --------------------------------------------------------------------

@pytest.mark.parametrize("url", PUBLIC)
def test_etag_and_304(client, url):
    first = client.get(url)
    tag = first.headers.get("etag")
    assert tag and tag.strip('W/').startswith('"') and tag.endswith('"')
    again = client.get(url, headers={"If-None-Match": tag})
    assert again.status_code == 304 and again.content == b""
    assert again.headers.get("etag") == tag
    assert _cc(again) == CACHE
    other = client.get(url, headers={"If-None-Match": '"not-the-tag"'})
    assert other.status_code == 200 and other.json() == first.json()


@pytest.mark.parametrize("url", PUBLIC)
def test_etag_is_stable_for_same_data(client, url):
    assert client.get(url).headers["etag"] == client.get(url).headers["etag"]


@pytest.mark.parametrize("url", PUBLIC)
def test_etag_list_and_star(client, url):
    tag = client.get(url).headers["etag"]
    assert client.get(url, headers={"If-None-Match": f'"x", {tag}'}).status_code == 304
    assert client.get(url, headers={"If-None-Match": "*"}).status_code == 304


def test_availability_etag_changes_after_a_request(big):
    before = big.get("/inventory/availability")
    tag = before.headers["etag"]
    rid = big.post("/requests", json={"org_name": "E", "org_email": "e@example.org",
                                      "items": [{"item_name": "Synthetic exam glove small", "quantity": 79}]}).json()["request_id"]
    # The request holds stock straight away, so a cached copy is stale at once...
    after = big.get("/inventory/availability", headers={"If-None-Match": tag})
    assert after.status_code == 200 and after.headers["etag"] != tag
    assert after.json() != before.json()
    # ...and denying it gives the units back: the first representation again
    assert big.patch(f"/requests/{rid}/status", json={"status": "Denied"}, headers=HQ).status_code == 200
    assert big.get("/inventory/availability", headers={"If-None-Match": tag}).status_code == 304


def test_etag_same_for_gzip_and_identity_or_weak(big):
    """A strong ETag must differ per encoding; a weak one may be shared."""
    gz = big.get("/api/supplies", headers={"Accept-Encoding": "gzip"}).headers["etag"]
    raw = big.get("/api/supplies", headers={"Accept-Encoding": "identity"}).headers["etag"]
    assert gz != raw or gz.startswith("W/")


@pytest.mark.parametrize("url", PUBLIC)
def test_cors_preflight_and_conditional_get_from_frontend(client, url):
    tag = client.get(url).headers["etag"]
    r = client.get(url, headers={"Origin": "http://localhost:3000", "If-None-Match": tag})
    assert r.status_code == 304
    assert r.headers.get("access-control-allow-origin") == "http://localhost:3000"
