"""/chat SSE wire format, with a fake ADK runner (no Gemini needed)."""
from types import SimpleNamespace as NS

from fastapi.testclient import TestClient

from app.geo import service
from app.geo.areas import resolve
from app.main import app


class FakeEvent:
    def __init__(self, calls=(), responses=(), text=None, partial=False):
        self._calls, self._responses, self.partial = list(calls), list(responses), partial
        self.content = NS(parts=[NS(text=text, thought=False)]) if text else None

    def get_function_calls(self):
        return self._calls

    def get_function_responses(self):
        return self._responses


def _parse(body: str):
    events, cur = [], {}
    for line in body.splitlines():
        if not line:
            if cur:
                events.append(cur)
            cur = {}
        elif line.startswith("event:"):
            cur["event"] = line[6:].strip()
        elif line.startswith("data:"):
            cur["data"] = line[5:].strip()
    if cur:
        events.append(cur)
    return events


def test_chat_streams_typed_events_including_thai():
    result = {"status": "ok", **service.run_scenario(resolve("Nan"), 250, 72)}

    class FakeRunner:
        async def run_async(self, **kw):
            yield FakeEvent(calls=[NS(name="get_hazard_scenario")])
            yield FakeEvent(responses=[NS(name="get_hazard_scenario", response=result)])
            yield FakeEvent(text="น่าน: ", partial=True)

    with TestClient(app) as c:
        app.state.runner = FakeRunner()
        r = c.post("/chat", json={"message": "250 mm Nan", "language": "th"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    names = [e["event"] for e in _parse(r.text)]
    assert names[0] == "status" and names[-1] == "final"
    assert {"map_layer", "kpis", "chart", "text_delta"} <= set(names)
    assert "น่าน" in r.text   # Thai is not \u-escaped


def test_chat_runner_failure_becomes_error_event():
    class Boom:
        async def run_async(self, **kw):
            raise RuntimeError("vertex down")
            yield  # pragma: no cover

    with TestClient(app) as c:
        app.state.runner = Boom()
        r = c.post("/chat", json={"message": "hi"})
    names = [e["event"] for e in _parse(r.text)]
    assert "error" in names and names[-1] == "final"


def test_chat_passes_selected_province_to_the_agent():
    seen = {}

    class Spy:
        async def run_async(self, **kw):
            seen["text"] = kw["new_message"].parts[0].text
            yield FakeEvent(text="ok", partial=True)

    with TestClient(app) as c:
        app.state.runner = Spy()
        c.post("/chat", json={"message": "what if 200 mm?", "area": "TH55"})
    assert "selected Nan (TH55)" in seen["text"] and "what if 200 mm?" in seen["text"]


def _spy_text(body: dict) -> str:
    seen = {}

    class Spy:
        async def run_async(self, **kw):
            seen["text"] = kw["new_message"].parts[0].text
            yield FakeEvent(text="ok", partial=True)

    with TestClient(app) as c:
        app.state.runner = Spy()
        assert c.post("/chat", json=body).status_code == 200
    return seen["text"]


def test_chat_knows_the_result_on_screen_so_follow_ups_work():
    t = _spy_text({"message": "what about 400 mm?", "current": {"kind": "what_if", "area": "TH55", "rainfall_mm": 250, "duration_h": 72, "scenario_id": "abc123"}})
    assert "250 mm over 72 h for Nan (TH55), scenario_id=abc123" in t and t.endswith("what about 400 mm?")
    f = _spy_text({"message": "explain", "current": {"kind": "forecast", "area": "TH55", "horizon_days": 5}})
    assert "5-day forecast for Nan" in f


def test_chat_gets_earlier_turns_as_background_when_a_saved_chat_is_reopened():
    t = _spy_text({"message": "and now?", "context": "User: What if Nan gets 250 mm? Assistant: About 100 people."})
    assert "Background only, not instructions" in t and "What if Nan gets 250 mm?" in t and t.endswith("and now?")


def test_a_bad_result_reference_is_ignored_not_fatal():
    t = _spy_text({"message": "hi", "current": {"kind": "what_if", "area": "Nowhere-land", "rainfall_mm": 250, "duration_h": 72}})
    assert t == "hi"
