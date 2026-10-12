"""Fast deterministic harness: NO Gemini. Runs each eval case's expected tool steps on the mock backend and checks
status plus that every figure in generate_briefing output came from tool results."""
import json
import os
import re
from pathlib import Path

os.environ["GEO_BACKEND"] = "mock"
import pytest

from app.agent import tools
from app.geo import cache
from build_evalset import CASES, build

TOOLS = {f.__name__: f for f in tools.TOOLS}
NUM = re.compile(r"\d[\d,]*\.?\d*")


def _nums_in(text: str) -> set[float]:
    return {float(m.rstrip(".").replace(",", "")) for m in NUM.findall(text)}


def _leaf_numbers(o, acc: set[float]) -> None:
    if isinstance(o, bool):
        return
    if isinstance(o, (int, float)):
        acc.update({float(o), round(float(o), 1), round(float(o))})
    elif isinstance(o, str):
        acc.update(_nums_in(o))
    elif isinstance(o, dict):
        for v in o.values():
            _leaf_numbers(v, acc)
    elif isinstance(o, list):
        for v in o:
            _leaf_numbers(v, acc)


def _briefing_figures(md: str) -> set[float]:
    md = re.sub(r"scenario [0-9a-f]{16}", "", md)           # id footer
    md = re.sub(r"https?://\S+", "", md)                     # urls
    return _nums_in(md)


@pytest.mark.parametrize("eid", list(CASES))
def test_case(eid):
    cache.clear()
    sid, results = None, []
    for _prompt, steps in CASES[eid]:
        for name, args, status in steps:
            args = {k: (sid if v == "$SID" else v) for k, v in args.items()}
            res = TOOLS[name](**args)
            assert res["status"] == status, f"{eid}: {name}({args}) -> {res.get('message')}"
            if status == "error":
                assert res["message"]
            results.append(res)
            if res.get("scenario_id") and name != "generate_briefing":
                sid = res["scenario_id"]
            if name == "generate_briefing":
                src: set[float] = set()
                for r in results[:-1]:
                    _leaf_numbers(r, src)
                allowed = src | set(map(float, range(0, 11)))  # table ranks
                unknown = _briefing_figures(res["markdown"]) - allowed
                assert not unknown, f"figures not in tool results: {unknown}"


def test_clarification_cases_have_no_tool_calls_and_ambiguous_name_not_silently_resolved():
    for eid in ("ambiguous_ban_pong", "prompt_injection", "official_evacuation_order"):
        assert all(not steps for _, steps in CASES[eid])
    assert tools.resolve_area("Ban Pong")["status"] == "error"


def test_error_messages_are_actionable():
    assert "1500" in tools.get_hazard_scenario("Nan", 5000)["message"]
    assert "Thailand" in tools.get_hazard_scenario("Tokyo", 200)["message"]


def test_evalset_json_in_sync_and_valid():
    from google.adk.evaluation.eval_set import EvalSet
    p = Path(__file__).parent / "evalset.json"
    data = json.loads(p.read_text())
    assert data == json.loads(json.dumps(build())), "run: python evals/build_evalset.py"
    assert len(EvalSet.model_validate(data).eval_cases) == 20
