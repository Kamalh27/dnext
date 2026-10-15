"""Caller address and response headers."""
from starlette.requests import Request

from app.netutil import client_ip


def _req(xff: str | None, peer="10.0.0.9") -> Request:
    headers = [(b"x-forwarded-for", xff.encode())] if xff is not None else []
    return Request({"type": "http", "headers": headers, "client": (peer, 1234), "method": "GET", "path": "/", "query_string": b""})


def test_header_is_ignored_without_a_trusted_proxy(monkeypatch):
    from app import settings as s
    monkeypatch.setattr(s.settings(), "trusted_proxy_hops", 0)
    assert client_ip(_req("1.2.3.4")) == "10.0.0.9"


def test_only_the_entry_added_by_the_proxy_is_believed(monkeypatch):
    from app import settings as s
    monkeypatch.setattr(s.settings(), "trusted_proxy_hops", 1)
    # a client can put anything first; the front end appends the real address last
    assert client_ip(_req("6.6.6.6, 203.0.113.7")) == "203.0.113.7"
    assert client_ip(_req("203.0.113.7")) == "203.0.113.7"
    assert client_ip(_req(None)) == "10.0.0.9"          # no header: fall back to the socket


def test_every_response_carries_the_security_headers():
    from fastapi.testclient import TestClient
    from app.main import app
    r = TestClient(app).get("/healthz")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert "max-age" in r.headers["strict-transport-security"]


def test_a_long_request_id_is_cut():
    from fastapi.testclient import TestClient
    from app.main import app
    r = TestClient(app).get("/healthz", headers={"x-request-id": "a" * 500})
    assert len(r.headers["x-request-id"]) == 64
