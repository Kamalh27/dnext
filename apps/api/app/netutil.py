"""The address of the caller, for rate limits.

On Cloud Run every request arrives from Google's front end, so the socket address is the same for everybody and a per-address limit would be shared by all
visitors. The front end appends the caller's address to X-Forwarded-For. Anything a client puts in that header comes before it, so only the entry that
the trusted proxy added can be believed: the last one (TRUSTED_PROXY_HOPS=1). With no proxy in front (the default, 0) the header is ignored.
"""
from fastapi import Request

from app.settings import settings


def client_ip(request: Request) -> str:
    hops = settings().trusted_proxy_hops
    if hops > 0:
        parts = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if len(parts) >= hops:
            return parts[-hops][:64]
    return request.client.host if request.client else "anon"
