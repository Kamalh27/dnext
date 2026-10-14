"""Thai text for server-built strings. The API sends English and Thai side by side (`*_th` fields); the UI picks by language.

Only fixed, reviewed phrases are translated here (a native Thai speaker should review them). Anything unknown falls back to the
English text, so a missing translation never shows a wrong one.
"""
import re

LIMITATIONS: dict[str, str] = {
    "Screening-level estimate of rainfall-triggered landslide risk using the DMR/ADPC method; not a forecast.":
        "ประมาณการคัดกรองความเสี่ยงดินถล่มจากฝนด้วยวิธี DMR/ADPC ไม่ใช่ผลพยากรณ์",
    "Risk = trigger x susceptibility x vulnerability x exposure / 125, on 1-5 classes; classes are relative, not probabilities.":
        "ความเสี่ยง = ตัวกระตุ้นจากฝน × ความอ่อนไหว × ความเปราะบาง × การรับสัมผัส ÷ 125 ในระดับ 1-5 ระดับเหล่านี้เป็นค่าสัมพัทธ์ ไม่ใช่ความน่าจะเป็น",
    "Trigger compares each tambon's 30-day rainfall with its own DMR percentile thresholds (P60-P95); rainfall is assumed uniform within a what-if scenario.":
        "ตัวกระตุ้นเปรียบเทียบปริมาณฝนสะสม 30 วันของแต่ละตำบลกับเกณฑ์เปอร์เซ็นไทล์ฝนของตำบลนั้นตาม DMR (P60-P95) และสมมติว่าฝนในสถานการณ์จำลองตกสม่ำเสมอ",
    "Susceptibility is ADPC's static CNN map (12 m); vulnerability and exposure are DMR indices. Tambon statistics are computed at ~100 m.":
        "ความอ่อนไหวมาจากแผนที่ CNN แบบคงที่ของ ADPC (12 ม.) ความเปราะบางและการรับสัมผัสเป็นดัชนีของ DMR สถิติระดับตำบลคำนวณที่ความละเอียดประมาณ 100 ม.",
    "People are WorldPop 2020 living where the risk class is Moderate or higher (risk >= 2; rounded); households are an estimate.":
        "จำนวนคนมาจาก WorldPop 2020 ที่อาศัยในพื้นที่ที่ระดับความเสี่ยงปานกลางขึ้นไป (ความเสี่ยง >= 2 ปัดเศษ) ส่วนจำนวนครัวเรือนเป็นค่าประมาณ",
    "Observed rainfall is NASA IMERG; the DMR thresholds were derived from JAXA GSMaP, so classes may be biased slightly high or low.":
        "ฝนตรวจวัดมาจาก NASA IMERG ขณะที่เกณฑ์ของ DMR สร้างจาก JAXA GSMaP ระดับที่ได้จึงอาจสูงหรือต่ำกว่าความเป็นจริงเล็กน้อย",
    "Buildings are estimated from the GHSL 2020 built-up surface (100 m) divided by an average footprint of 60 m2; hospitals, schools and main roads "
    "(motorway to tertiary) come from OpenStreetMap, which can be incomplete. All counts are for the Moderate-or-higher risk zone.":
        "จำนวนอาคารประมาณจากพื้นที่ก่อสร้าง GHSL ปี 2020 (100 ม.) หารด้วยขนาดฐานอาคารเฉลี่ย 60 ตร.ม. ส่วนโรงพยาบาล โรงเรียน และถนนสายหลัก (มอเตอร์เวย์ถึงทางหลวงสายรอง) มาจาก OpenStreetMap ซึ่งอาจไม่ครบถ้วน ตัวเลขทั้งหมดเป็นของพื้นที่ที่มีความเสี่ยงระดับปานกลางขึ้นไป",
    "Buildings, roads and facilities are not part of the DMR layers and are not reported in this mode.":
        "อาคาร ถนน และสิ่งอำนวยความสะดวก ไม่อยู่ในชั้นข้อมูลของ DMR จึงไม่แสดงในโหมดนี้",
}
_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"^Forecast part is GFS accumulated rainfall over (\d+) day\(s\) from model run (\S+); the observed part is the preceding (\d+) days\. "
                r"There can be a gap of about a day between the newest observation and the forecast start\.$"),
     r"ส่วนพยากรณ์คือปริมาณฝนสะสมจาก GFS ใน \1 วันข้างหน้า (รอบการคำนวณ \2) ส่วนที่ตรวจวัดคือ \3 วันก่อนหน้า อาจมีช่องว่างประมาณหนึ่งวันระหว่างข้อมูลตรวจวัดล่าสุดกับจุดเริ่มต้นของการพยากรณ์"),
    (re.compile(r"^GFS run covers only (\d+) h of the requested (\d+) h\.$"), r"รอบ GFS ครอบคลุมเพียง \1 จาก \2 ชั่วโมงที่ขอ"),
]


def limitation(s: str) -> str:
    """Thai for a known limitation sentence, else the English text unchanged."""
    if s in LIMITATIONS:
        return LIMITATIONS[s]
    for pat, rep in _PATTERNS:
        if pat.match(s):
            return pat.sub(rep, s)
    return s


def limitations(items: list[str]) -> list[str]:
    return [limitation(s) for s in items]


# ---- fixed words used in titles, headers and labels
TAMBON_COLUMNS = ["ตำบล (อำเภอ)", "ตัวกระตุ้นฝน 0-5", "ฝน 30 วัน (มม.)", "ความเสี่ยงสูงสุด 0-5", "การรับสัมผัส 1-5", "ประชากรในพื้นที่เสี่ยงปานกลางขึ้นไป (ประมาณ)"]
OBS_FC_COLUMNS = ["ฝนตรวจวัด (มม.)", "ฝนพยากรณ์ (มม.)", "ช่วงพยากรณ์ (วัน)", "เวลารอบการคำนวณ"]
COMPARE_COLUMNS = ["ปริมาณฝน", "ประชากร (ประมาณ)", "ครัวเรือน (ประมาณ)", "อาคาร", "ถนน กม."]
TRIGGER_SOURCE = "เกณฑ์เปอร์เซ็นไทล์ฝนระดับตำบลของ DMR"


def rain_window(n) -> str:
    return f"ฝนตรวจวัด {n} วัน + สถานการณ์จำลอง"
