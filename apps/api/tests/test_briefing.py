from app import briefing
from app.geo import service
from app.geo.areas import resolve


def _r():
    return service.run_scenario(resolve("Nan"), 250, 72)


def test_en_briefing_sections_and_numbers():
    r = _r()
    md = briefing.build_briefing(r, "en")
    for s in ("Headline estimates", "Top 10", "Assumptions", "Limitations", "Data sources", "tmd.go.th", "disaster.go.th"):
        assert s in md
    assert f"~{r['exposure']['people']:,.0f}" in md
    assert md.count("\n| ") >= 11 and "MOCK" in md.upper()


def test_th_briefing():
    md = briefing.build_briefing(_r(), "th")
    assert "สรุปการคัดกรอง" in md and "สมมติฐาน" in md and "น่าน" in md


def test_forecast_briefing_has_model_run():
    r = service.run_forecast(resolve("Nan"), 5)
    md = briefing.build_briefing(r, "en")
    assert r["forecast"]["model_run_time"] in md and "Observed + forecast" in md


def test_html():
    h = briefing.to_html(briefing.build_briefing(_r(), "en"))
    assert h.startswith("<!doctype html>") and "<table>" in h and "<script" not in h


def test_polish_disabled_in_mock(monkeypatch):
    from app.settings import settings
    monkeypatch.setattr(settings(), "briefing_model", "gemini-x")
    assert briefing._polish("a 1") == "a 1"
