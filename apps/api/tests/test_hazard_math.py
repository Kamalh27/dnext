import pytest

from app.geo.hazard_math import classify, hazard, trigger_ratio, validate_inputs


def test_trigger_ratio_monotonic_in_rain():
    assert trigger_ratio(300, 72) > trigger_ratio(150, 72)


def test_trigger_ratio_known_value():
    # I = 250/72 = 3.472 mm/h ; thr = 14.82 * 72^-0.39 ~= 2.8
    assert trigger_ratio(250, 72) == pytest.approx(1.24, abs=0.05)


def test_hazard_bounds_and_monotonic():
    assert 0 <= hazard(0.8, 1.0) <= 0.8
    assert hazard(0.8, 2.0) > hazard(0.8, 1.0)
    assert hazard(0.8, 1.0, wetness=1.0) > hazard(0.8, 1.0, wetness=0.0)


def test_classify_cutoffs():
    assert classify(0.0) == "Low"
    assert classify(0.2) == "Moderate"
    assert classify(0.4) == "High"
    assert classify(0.9) == "Very High"


@pytest.mark.parametrize("rain,dur", [(0, 24), (5000, 24), (100, 0)])
def test_absurd_inputs_rejected(rain, dur):
    with pytest.raises(ValueError):
        validate_inputs(rain, dur)
