import json
import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
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
from app.agent.events import events_for_tool_result, scenario_events, status_for
from app.geo import service
from app.geo.areas import AreaError, resolve
from app.settings import settings

logging.basicConfig(level=logging.INFO, format='{"severity":"%(levelname)s","message":"%(message)s"}')
log = logging.getLogger("api")
APP_NAME = "landslidewatch"
limiter = Limiter(key_func=get_remote_address, default_limits=[settings().rate_limit])


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.sessions = InMemorySessionService()
    app.state.runner = Runner(agent=build_agent(), app_name=APP_NAME, session_service=app.state.sessions)
    yield


app = FastAPI(title="LandslideWatch TH API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(CORSMiddleware, allow_origins=settings().allowed_origins.split(","),
                   allow_methods=["GET", "POST"], allow_headers=["*"])


@app.middleware("http")
async def size_cap(request: Request, call_next):
    if int(request.headers.get("content-length") or 0) > settings().max_request_bytes:
        return __import__("fastapi").responses.JSONResponse({"detail": "request too large"}, status_code=413)
    return await call_next(request)


class ChatIn(BaseModel):
    message: str = Field(max_length=2000)
    session_id: str | None = None
    language: str = "en"


class ScenarioIn(BaseModel):
    area: str
    rainfall_mm: float
    duration_h: float = 72


def sse(event: str, data: dict) -> ServerSentEvent:
    return ServerSentEvent(event=event, data=json.dumps(data, ensure_ascii=False), raw_data=True)


@app.get("/healthz")
async def healthz():
    return {"ok": True, "backend": settings().geo_backend}


@app.post("/chat", response_class=EventSourceResponse)
@limiter.limit("20/minute")
async def chat(request: Request, body: ChatIn):
    sid = body.session_id or uuid.uuid4().hex
    user = "web"
    sessions: InMemorySessionService = request.app.state.sessions
    if not await sessions.get_session(app_name=APP_NAME, user_id=user, session_id=sid):
        await sessions.create_session(app_name=APP_NAME, user_id=user, session_id=sid)
    text = body.message if body.language == "en" else f"[reply in Thai] {body.message}"
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


@app.post("/scenario")
async def scenario(body: ScenarioIn):
    try:
        r = service.run_scenario(resolve(body.area), body.rainfall_mm, body.duration_h)
    except (AreaError, ValueError) as e:
        raise HTTPException(422, str(e))
    d = dict(scenario_events(r))
    return {"map_layer": d["map_layer"], "kpis": d["kpis"], "chart": d["chart"]}


@app.get("/explain")
async def explain(lat: float, lng: float, scenario_id: str | None = None):
    return service.explain_point(lat, lng)
