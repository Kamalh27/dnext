"""General landslide-safety guidance for the report.

This is generic advice adapted from published landslide safety guidance (for example from the USGS). It is not a local plan and
it never tells anyone to evacuate: that decision belongs to the local authorities. Sections are chosen from the scenario result
(elevated zone present, named hospitals or schools listed), the wording is fixed text, and no figure is generated here.
"""

TEXT = {
    "en": {
        "title": "General guidance",
        "note": "General advice adapted from published landslide safety guidance. It is not a local plan and not an evacuation order: "
                "follow your local authorities.",
        "basics": ("Before and during heavy rain", [
            "Follow announcements and instructions from your local authorities. Decisions to evacuate are theirs to make.",
            "Know the warning signs on and around slopes: new cracks in the ground, walls or roads; tilting trees, poles or fences; "
            "new springs or seepage; streams turning muddy or suddenly rising or falling; unusual sounds such as cracking or rumbling; "
            "doors and windows that suddenly jam.",
            "Keep at least two routes out of the area in mind, because roads can be blocked.",
            "Keep drains, ditches and culverts near buildings and slopes clear of debris.",
            "Stay away from steep slopes and drainage channels during heavy rain, and avoid unnecessary travel on mountain roads.",
        ]),
        "places": ("For the places and communities listed above", [
            "Let the managers of the listed hospitals and schools know that their tambon is in a higher-risk zone, so they can review "
            "their own plans, contact lists and supplies.",
            "Hospitals: check backup power, water, medicines and how ambulances would reach the site if a road is cut.",
            "Schools: check how children and parents would be contacted and how pupils would get home if roads close.",
            "Check on households far from services, older people and people who have difficulty moving.",
        ]),
        "during": ("If a landslide starts", [
            "Leave the area quickly, but only if it is safe to do so. If a slide is already reaching a building, moving to the highest floor "
            "away from the slope can be safer than going outside.",
            "Do not cross swollen streams or drainage channels. After a slide, keep away from the area, because more movement can follow.",
        ]),
        "tier_high": "Peak risk in this area reaches the High range, so review the preparations above early and keep in close contact with the local authorities.",
    },
    "th": {
        "title": "แนวทางทั่วไป",
        "note": "คำแนะนำทั่วไปปรับจากแนวทางความปลอดภัยด้านดินถล่มที่เผยแพร่แล้ว ไม่ใช่แผนของพื้นที่และไม่ใช่คำสั่งอพยพ "
                "โปรดปฏิบัติตามหน่วยงานท้องถิ่น",
        "basics": ("ก่อนและระหว่างฝนตกหนัก", [
            "ติดตามประกาศและคำแนะนำจากหน่วยงานท้องถิ่น การตัดสินใจอพยพเป็นของหน่วยงานเหล่านั้น",
            "รู้จักสัญญาณเตือนบริเวณเนินเขาและโดยรอบ เช่น รอยแตกใหม่บนพื้นดิน ผนังหรือถนน ต้นไม้ เสาไฟหรือรั้วที่เอียง "
            "น้ำซึมหรือน้ำพุผุดใหม่ ลำธารขุ่นหรือระดับน้ำขึ้นลงผิดปกติ เสียงผิดปกติ เช่น เสียงแตกร้าวหรือเสียงดังครืน "
            "และประตูหน้าต่างที่ฝืดหรือติดขึ้นมาทันที",
            "จดจำเส้นทางออกจากพื้นที่อย่างน้อยสองเส้นทาง เพราะถนนอาจถูกตัดขาดได้",
            "ดูแลท่อระบายน้ำ ร่องน้ำและท่อลอดใกล้อาคารและเนินเขาไม่ให้มีเศษวัสดุอุดตัน",
            "อยู่ห่างจากเนินชันและทางน้ำไหลในช่วงฝนตกหนัก และหลีกเลี่ยงการเดินทางบนถนนบนภูเขาที่ไม่จำเป็น",
        ]),
        "places": ("สำหรับสถานที่และชุมชนที่ระบุข้างต้น", [
            "แจ้งผู้บริหารโรงพยาบาลและโรงเรียนที่อยู่ในรายการว่าตำบลของตนอยู่ในพื้นที่เสี่ยงสูง เพื่อให้ทบทวนแผน รายชื่อติดต่อ และสิ่งของสำรอง",
            "โรงพยาบาล: ตรวจสอบไฟฟ้าสำรอง น้ำ ยา และเส้นทางที่รถพยาบาลจะเข้าถึงได้หากถนนถูกตัดขาด",
            "โรงเรียน: ตรวจสอบวิธีติดต่อนักเรียนและผู้ปกครอง และวิธีส่งนักเรียนกลับบ้านหากถนนปิด",
            "ตรวจสอบครัวเรือนที่อยู่ไกลจากบริการ ผู้สูงอายุ และผู้ที่เคลื่อนไหวลำบาก",
        ]),
        "during": ("หากเกิดดินถล่ม", [
            "ออกจากพื้นที่อย่างรวดเร็ว แต่เฉพาะเมื่อปลอดภัยเท่านั้น หากดินถล่มกำลังเข้าถึงอาคาร "
            "การขึ้นไปยังชั้นบนสุดที่อยู่ห่างจากเนินอาจปลอดภัยกว่าการออกไปข้างนอก",
            "อย่าข้ามลำธารหรือทางน้ำที่น้ำเอ่อ หลังเกิดดินถล่มให้อยู่ห่างจากพื้นที่ เพราะอาจมีการเคลื่อนตัวต่อได้",
        ]),
        "tier_high": "ความเสี่ยงสูงสุดในพื้นที่นี้ถึงระดับสูง ควรทบทวนการเตรียมความพร้อมข้างต้นแต่เนิ่น ๆ และติดต่อหน่วยงานท้องถิ่นอย่างใกล้ชิด",
    },
}


def sections(r: dict, language: str = "en") -> dict:
    """{'title', 'note', 'sections': [(heading, [bullets])]} for a scenario result."""
    t = TEXT["th" if language == "th" else "en"]
    x = r["exposure"]
    table = x.get("tambon_table") or x.get("top_admin_units") or []
    peak = max((u.get("risk_max") or 0 for u in table), default=0)
    named = bool(x.get("facilities")) and any("risk" in f for f in x["facilities"])
    out = [t["basics"]]
    if peak >= 3:
        out[0] = (t["basics"][0], [t["tier_high"]] + t["basics"][1])
    if named or (x.get("people") or 0) > 0:
        out.append(t["places"])
    out.append(t["during"])
    return {"title": t["title"], "note": t["note"], "sections": out}
