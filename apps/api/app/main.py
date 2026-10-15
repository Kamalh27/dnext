import asyncio
import contextvars
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, HTMLResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.agent.agent import build_agent
from app import briefing as briefing_mod
from app.agent.events import events_for_tool_result, forecast_events, scenario_events, status_for
from app.geo import service, storage
from app.geo.areas import AreaError, resolve
from app.auth import gate
from app.settings import settings

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        d = {"severity": record.levelname, "message": record.getMessage(), "logger": record.name,
             "request_id": request_id_var.get()}
        if record.exc_info:
            d["exception"] = self.formatException(record.exc_info)
        return json.dumps(d, ensure_ascii=False)


_h = logging.StreamHandler()
_h.setFormatter(JsonFormatter())
logging.basicConfig(level=logging.INFO, handlers=[_h], force=True)
log = logging.getLogger("api")
APP_NAME = "landslidewatch"
limiter = Limiter(key_func=get_remote_address, default_limits=[settings().rate_limit])


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.sessions = InMemorySessionService()
    app.state.runner = Runner(agent=build_agent(), app_name=APP_NAME, session_service=app.state.sessions)
    if settings().geo_backend == "ee" and settings().hazard_model == "tambon":
        from app.geo import overview
        asyncio.create_task(asyncio.to_thread(overview.warm))   # first visitor after a restart should not wait for the national numbers
    yield


app = FastAPI(title="LandslideWatch TH API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(CORSMiddleware, allow_origins=settings().allowed_origins.split(","),
                   allow_methods=["GET", "POST"], allow_headers=["*"])


@app.middleware("http")
async def guard(request: Request, call_next):
    """Request id, size cap, 60 s timeout (SSE /chat exempt), access log."""
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
    request_id_var.set(rid)
    t0 = time.monotonic()
    try:
        if int(request.headers.get("content-length") or 0) > settings().max_request_bytes:
            resp = JSONResponse({"detail": "request too large"}, status_code=413)
        elif request.url.path == "/chat":
            resp = await call_next(request)
        else:
            try:
                resp = await asyncio.wait_for(call_next(request), settings().request_timeout_s)
            except asyncio.TimeoutError:
                resp = JSONResponse({"detail": "request timed out"}, status_code=504)
    except Exception:
        log.exception("unhandled error")
        resp = JSONResponse({"detail": "internal error"}, status_code=500)
    resp.headers["X-Request-ID"] = rid
    log.info("%s %s -> %s %.0fms", request.method, request.url.path, resp.status_code,
             (time.monotonic() - t0) * 1000)
    return resp


class ChatIn(BaseModel):
    message: str = Field(max_length=2000)
    area: str | None = Field(default=None, max_length=40)      # province the user selected in the UI (name or admin code)
    session_id: str | None = None
    language: str = "en"


class ScenarioIn(BaseModel):
    area: str
    rainfall_mm: float
    duration_h: float = 72


class ForecastIn(BaseModel):
    area: str
    horizon_days: int = 5


def sse(event: str, data: dict) -> ServerSentEvent:
    return ServerSentEvent(event=event, raw_data=json.dumps(data, ensure_ascii=False))


@app.get("/overview")
async def overview(horizon_days: int = 0):
    """National current conditions by province (observed, or observed + GFS forecast), from the daily precomputes. No scenario needed."""
    from app.geo import overview as ov
    if not (0 <= horizon_days <= 10):
        raise HTTPException(422, "horizon_days must be between 0 and 10")
    try:
        return await asyncio.to_thread(ov.national, horizon_days)
    except ov.OverviewUnavailable as e:
        raise HTTPException(503, str(e))


@app.get("/overview/series")
async def overview_series(days: int = 5):
    """Slider data: national current conditions for day 0 (observed) .. +days (forecast), by province. Instant after the first call."""
    from app.geo import overview as ov
    if not (1 <= days <= 10):
        raise HTTPException(422, "days must be between 1 and 10")
    try:
        return await asyncio.to_thread(ov.series, days)
    except ov.OverviewUnavailable as e:
        raise HTTPException(503, str(e))


@app.get("/layers/static")
async def static_layers():
    """Reference layers (susceptibility, vulnerability, exposure, population) for the Layers panel; no scenario needed."""
    if settings().geo_backend == "ee" and settings().hazard_model == "tambon":
        return await asyncio.to_thread(__import__("app.geo.tambon_risk", fromlist=["static_layers"]).static_layers)
    from app.geo.mock import legend as _l
    names = {"susceptibility": "Susceptibility class (1-5)", "vulnerability": "Vulnerability class (1-5)", "exposure": "Exposure class (1-5)",
             "population": "Population (WorldPop 2020)"}
    return {"layers": [{"id": f"static-{k}", "key": k, "name": n, "tile_url": "", "opacity": 0.7, "visible": False, "legend": _l(), "group": "static"}
                       for k, n in names.items()], "expires_in_s": 3600}


@app.get("/readyz")
async def readyz():
    """Deep check: can this identity read every Earth Engine asset the active hazard model needs? (Cloud Run SA vs public assets)"""
    if settings().geo_backend != "ee":
        return {"ok": True, "backend": settings().geo_backend, "assets": {}}

    def check() -> dict:
        from app.geo import tambon_risk
        from app.geo.ee_init import init
        import ee
        init()
        wanted = dict(tambon_risk.cfg()["assets"]) if settings().hazard_model == "tambon" else {}
        out = {}
        for k, a in wanted.items():   # report readability only: asset paths and error details stay out of the public response
            try:
                out[k] = {"readable": bool(a and ee.data.getAsset(a))}
            except Exception as e:  # noqa: BLE001
                log.warning("readyz: layer %s not readable: %s", k, str(e)[:200])
                out[k] = {"readable": False}
        return out

    res = await asyncio.to_thread(check)
    return {"ok": all(v["readable"] for v in res.values()), "model": settings().hazard_model, "assets": res}


@app.get("/healthz")
async def healthz():
    return {"ok": True, "backend": settings().geo_backend}


@app.get("/auth/config")
async def auth_config():
    """Public: tells the web app whether sign-in is required and gives it the (public) Firebase web config, so no rebuild per environment."""
    from app import auth, usage
    return {"auth_required": settings().auth_required, "firebase": auth.public_config(), "limits": usage.limits()}


@app.get("/me")
async def me(request: Request):
    """The signed-in user and today's usage (does not count against the limits)."""
    from app import auth, usage
    user = auth.current_user(request)
    if user is None:
        raise HTTPException(401, {"code": "auth_required", "message": "Not signed in."}, headers={"WWW-Authenticate": "Bearer"})
    return {"user": {"name": user.name, "email": user.email, "picture": user.picture},
            "usage": await asyncio.to_thread(usage.snapshot, user.uid), "limits": usage.limits()}


@app.post("/chat", response_class=EventSourceResponse)
@limiter.limit("20/minute")
async def chat(request: Request, body: ChatIn, account=Depends(gate("chat"))):
    sid = body.session_id or uuid.uuid4().hex
    user = account.uid if not account.anonymous else "web"
    sessions: InMemorySessionService = request.app.state.sessions
    if not await sessions.get_session(app_name=APP_NAME, user_id=user, session_id=sid):
        await sessions.create_session(app_name=APP_NAME, user_id=user, session_id=sid)
    text = body.message if body.language == "en" else f"[reply in Thai] {body.message}"
    if body.area:
        try:       # context from the UI's province selector: used when the user does not name another place
            sel = resolve(body.area)
            text = f"[The user has selected {sel.name} ({sel.pcode}) in the app; use it when they do not name another place] {text}"
        except AreaError:
            pass
    msg = types.Content(role="user", parts=[types.Part(text=text)])
    yield sse("status", {"stage": "thinking", "label": "Thinking…"})
    try:
        async for ev in request.app.state.runner.run_async(
            user_id=user, session_id=sid, new_message=msg,
            run_config=RunConfig(streaming_mode=StreamingMode.SSE),
        ):
            for fc in ev.get_function_calls():
                yield sse("status", status_for(fc.name))
            for fr in ev.get_function_responses():
                for name, data in events_for_tool_result(fr.name, fr.response or {}):
                    yield sse(name, data)
            if ev.partial and ev.content and ev.content.parts:
                t = "".join(p.text or "" for p in ev.content.parts if not getattr(p, "thought", False))
                if t:
                    yield sse("text_delta", {"text": t})
    except Exception as e:  # surface to UI instead of dropping the stream
        log.exception("chat failed")
        yield sse("error", {"message": f"{type(e).__name__}: {e}"[:300]})
    yield sse("final", {"session_id": sid})


def _payload(events) -> dict:
    d = dict(events)
    out = {k: d[k] for k in ("map_layer", "map_layers", "kpis", "chart", "map_markers", "table") if k in d}
    out["tables"] = [data for name, data in events if name == "table"]        # every table (a forecast has two)
    return out


@app.post("/scenario")
async def scenario(body: ScenarioIn, account=Depends(gate("run"))):
    try:
        r = await asyncio.to_thread(service.run_scenario, resolve(body.area), body.rainfall_mm, body.duration_h)
    except (AreaError, ValueError) as e:
        raise HTTPException(422, str(e))
    return _payload(scenario_events(r))


@app.post("/forecast")
async def forecast(body: ForecastIn, account=Depends(gate("run"))):
    try:
        r = await asyncio.to_thread(service.run_forecast, resolve(body.area), body.horizon_days)
    except (AreaError, ValueError) as e:
        raise HTTPException(422, str(e))
    return _payload(forecast_events(r))


@app.get("/explain")
async def explain(lat: float, lng: float, scenario_id: str | None = None, account=Depends(gate("light"))):
    return await asyncio.to_thread(service.explain_point, lat, lng, scenario_id)


@app.get("/briefing/{scenario_id}")
async def briefing(scenario_id: str, language: str = "en", format: str = "md", print: int = 0, account=Depends(gate("light"))):
    if language not in ("en", "th") or format not in ("md", "html"):
        raise HTTPException(422, "language must be en|th and format md|html")
    sc = service.get_cached(scenario_id)
    if sc is None:
        raise HTTPException(404, "Unknown or expired scenario_id")
    md = await asyncio.to_thread(briefing_mod.build_briefing, sc, language)
    name = f"{scenario_id}-{language}"
    path = await asyncio.to_thread(storage.upload, f"{name}.md", md)
    log.info("briefing stored at %s", path)
    if format == "html":
        return HTMLResponse(briefing_mod.to_html(md, language, auto_print=bool(print)))
    return PlainTextResponse(md, media_type="text/markdown; charset=utf-8")
