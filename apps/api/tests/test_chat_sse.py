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
