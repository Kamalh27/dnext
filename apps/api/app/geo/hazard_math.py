"""Pure hazard math (no EE): trigger ratio and classification. Mirrors the EE pixel expression."""
import math

from app.settings import load_yaml


def trigger_ratio(rainfall_mm: float, duration_h: float) -> float:
    t = load_yaml("thresholds.yaml")["intensity_duration"]
    intensity = rainfall_mm / duration_h
    return intensity / (t["alpha"] * duration_h ** t["beta"])


def hazard(s: float, tr: float, wetness: float = 0.0) -> float:
    h = load_yaml("thresholds.yaml")["hazard"]
    return s * (1 - math.exp(-h["k"] * tr * (1 + h["antecedent_gain"] * wetness)))


def classify(value: float) -> str:
    h = load_yaml("thresholds.yaml")["hazard"]
    idx = sum(value >= c for c in h["class_cutoffs"])
    return h["class_names"][idx]


def validate_inputs(rainfall_mm: float, duration_h: float) -> None:
    lim = load_yaml("thresholds.yaml")["limits"]
    if not (0 < rainfall_mm <= lim["rainfall_mm_max"]):
        raise ValueError(f"rainfall_mm must be in (0, {lim['rainfall_mm_max']}]")
    if not (lim["duration_h_min"] <= duration_h <= lim["duration_h_max"]):
        raise ValueError(f"duration_h must be in [{lim['duration_h_min']}, {lim['duration_h_max']}]")
