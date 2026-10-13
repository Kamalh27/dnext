"""Sign in with Google -> our own short-lived session token; FastAPI dependencies that gate expensive endpoints.

Flow: the browser gets a Google ID token (Google Identity Services), POSTs it to /auth/google, we verify it against Google's public keys
(audience = our OAuth client id, email verified) and return a signed session token (HS256, `session_secret`). The UI sends it as
`Authorization: Bearer ...`. We keep no password or Google token; the account id is a one-way hash of Google's stable `sub`.
With AUTH_REQUIRED=false (local dev/tests) nothing is gated and nobody is counted.
"""
import hashlib
import logging
import time
from dataclasses import dataclass

import jwt
from fastapi import HTTPException, Request

from app.settings import settings

log = logging.getLogger(__name__)
_ISSUER = "dnext-landslidewatch"


@dataclass(frozen=True)
class User:
    uid: str
    email: str = ""
    name: str = ""
    picture: str = ""
    anonymous: bool = False


ANONYMOUS = User(uid="anonymous", anonymous=True)


def account_id(google_sub: str) -> str:
    return hashlib.sha256(f"dnext:{google_sub}".encode()).hexdigest()[:24]


def verify_google_id_token(credential: str) -> dict:
    """Validate a Google ID token (signature, expiry, audience = our client id, verified email). Raises ValueError if invalid."""
    cid = settings().google_oauth_client_id
    if not cid:
        raise ValueError("Google sign-in is not configured (GOOGLE_OAUTH_CLIENT_ID)")
    from google.auth.transport import requests as g_requests
    from google.oauth2 import id_token
    info = id_token.verify_oauth2_token(credential, g_requests.Request(), cid)
    if info.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise ValueError("wrong issuer")
    if not info.get("email_verified"):
        raise ValueError("Google account email is not verified")
    return info


def issue_session(profile: dict) -> tuple[str, User]:
    s = settings()
    if not s.session_secret:
        raise RuntimeError("SESSION_SECRET is not configured")
    user = User(uid=account_id(profile["sub"]), email=profile.get("email", ""), name=profile.get("name", ""), picture=profile.get("picture", ""))
    now = int(time.time())
    token = jwt.encode({"iss": _ISSUER, "sub": user.uid, "email": user.email, "name": user.name, "picture": user.picture,
                        "iat": now, "exp": now + s.session_ttl_s}, s.session_secret, algorithm="HS256")
    return token, user


def read_session(token: str) -> User | None:
    s = settings()
    if not token or not s.session_secret:
        return None
    try:
        c = jwt.decode(token, s.session_secret, algorithms=["HS256"], issuer=_ISSUER, options={"require": ["exp", "sub"]})
    except jwt.PyJWTError:
        return None
    return User(uid=c["sub"], email=c.get("email", ""), name=c.get("name", ""), picture=c.get("picture", ""))


def bearer(request: Request) -> str:
    h = request.headers.get("authorization", "")
    return h[7:].strip() if h.lower().startswith("bearer ") else ""


def current_user(request: Request) -> User | None:
    return read_session(bearer(request))


def gate(kind: str):
    """Dependency factory. kind: 'chat' | 'run' (counted per day + burst) | 'light' (sign-in + burst only)."""
    def dependency(request: Request) -> User:
        s = settings()
        if not s.auth_required:
            return ANONYMOUS
        user = current_user(request)
        if user is None:
            raise HTTPException(401, {"code": "auth_required", "message": "Sign in with Google to use this feature."},
                                headers={"WWW-Authenticate": "Bearer"})
        from app import usage
        res = usage.consume(user.uid, kind)
        if not res.ok:
            raise HTTPException(429, res.detail(kind), headers={"Retry-After": str(max(1, res.retry_after_s))})
        return user
    return dependency
