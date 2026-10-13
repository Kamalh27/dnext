"""Firebase Authentication (Google provider): verify the Firebase ID token the browser sends, and gate expensive endpoints.

Flow: the web app signs the user in with the Firebase SDK ("Continue with Google"); the SDK keeps the session and refreshes the ID token
(1 h lifetime) by itself. Every gated request carries `Authorization: Bearer <Firebase ID token>`. We verify it here against Firebase's public
certificates (audience = the Firebase project id, verified Google email) and use a one-way hash of the Firebase uid as the account id for
the usage counters. We store no password and no token. With AUTH_REQUIRED=false (local dev/tests) nothing is gated and nobody is counted.
"""
import hashlib
import logging
import threading
import time
from dataclasses import dataclass

from fastapi import HTTPException, Request

from app.settings import settings

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class User:
    uid: str
    email: str = ""
    name: str = ""
    picture: str = ""
    anonymous: bool = False


ANONYMOUS = User(uid="anonymous", anonymous=True)


def account_id(firebase_uid: str) -> str:
    return hashlib.sha256(f"dnext:{firebase_uid}".encode()).hexdigest()[:24]


def firebase_project() -> str:
    s = settings()
    return s.firebase_project_id or s.project_id or s.ee_project


def public_config() -> dict | None:
    """The Firebase web config for the UI (public identifiers), or None when sign-in is not configured."""
    s = settings()
    if not (s.firebase_api_key and s.firebase_auth_domain and s.firebase_app_id and firebase_project()):
        return None
    return {"apiKey": s.firebase_api_key, "authDomain": s.firebase_auth_domain, "projectId": firebase_project(), "appId": s.firebase_app_id}


_certs: dict[str, tuple[float, object]] = {}
_certs_lock = threading.Lock()


def _cached_request():
    """google-auth transport that caches Google's public-certificate downloads (otherwise every request would fetch them)."""
    import google.auth.transport.requests as g

    class Cached(g.Request):
        def __call__(self, url, method="GET", body=None, headers=None, timeout=10, **kwargs):
            if method == "GET":
                with _certs_lock:
                    hit = _certs.get(url)
                if hit and time.time() - hit[0] < 3600:
                    return hit[1]
            resp = super().__call__(url, method=method, body=body, headers=headers, timeout=timeout, **kwargs)
            if method == "GET" and getattr(resp, "status", 0) == 200:
                with _certs_lock:
                    _certs[url] = (time.time(), resp)
            return resp

    return Cached()


def verify_firebase_token(id_token: str) -> dict:
    """Validate a Firebase ID token: signature, expiry, issuer/audience = our project, Google provider, verified email. Raises ValueError."""
    project = firebase_project()
    if not project:
        raise ValueError("Firebase project is not configured (FIREBASE_PROJECT_ID)")
    from google.oauth2 import id_token as g_id_token
    claims = g_id_token.verify_firebase_token(id_token, _cached_request(), audience=project)
    if not claims:
        raise ValueError("invalid token")
    if (claims.get("firebase") or {}).get("sign_in_provider") != "google.com":
        raise ValueError("only Google sign-in is accepted")
    if not claims.get("email_verified"):
        raise ValueError("Google account email is not verified")
    return claims


def user_from_claims(claims: dict) -> User:
    return User(uid=account_id(claims.get("user_id") or claims["sub"]), email=claims.get("email", ""), name=claims.get("name", ""),
                picture=claims.get("picture", ""))


def bearer(request: Request) -> str:
    h = request.headers.get("authorization", "")
    return h[7:].strip() if h.lower().startswith("bearer ") else ""


def current_user(request: Request) -> User | None:
    token = bearer(request)
    if not token:
        return None
    try:
        return user_from_claims(verify_firebase_token(token))
    except Exception as e:  # noqa: BLE001 - bad, expired, foreign or unverifiable token
        log.info("rejected ID token: %s", str(e)[:100])
        return None


def gate(kind: str):
    """Dependency factory. kind: 'chat' | 'run' (counted per day + burst) | 'light' (sign-in + burst only)."""
    def dependency(request: Request) -> User:
        if not settings().auth_required:
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
