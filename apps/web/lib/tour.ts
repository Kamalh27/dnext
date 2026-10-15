/** First-visit guided tour: the steps, their text, where the card goes and whether it has been seen. */
import { useSyncExternalStore } from "react";
import type { Lang } from "./types";

export const TOUR_KEY = "dnext-tour-v1";

export interface TourStep { id: string; selector: string; tab?: "chat" | "map" }

/** In the order a new visitor needs them. A step whose element is not on screen (for example the slider outside the national overview) is skipped. */
export const STEPS: TourStep[] = [
  { id: "province", selector: '[data-tour="province"]', tab: "chat" },
  { id: "chat", selector: '[data-tour="chat"]', tab: "chat" },
  { id: "report", selector: '[data-tour="report"]', tab: "chat" },
  { id: "layers", selector: '[data-tour="layers"]', tab: "map" },
  { id: "slider", selector: '[data-tour="slider"]', tab: "map" },
  { id: "safe", selector: '[data-tour="safe"]', tab: "map" },
  { id: "community", selector: '[data-tour="community"]', tab: "map" },
  { id: "lang", selector: '[data-tour="lang"]' },
  { id: "alerts", selector: '[data-tour="alerts"]' },
  { id: "help", selector: '[data-tour="help"]' },
];

export const TEXT: Record<Lang, Record<string, { title: string; body: string }>> = {
  en: {
    province: { title: "Pick a province", body: "Choose a province to see its tambons, or leave it empty to look at the whole country." },
    chat: { title: "Ask in your own words", body: "Try “250 mm in 3 days, Chiang Rai” or “compare 150 and 300 mm in Nan”. Every number in the answer comes from a calculation." },
    report: { title: "Make a report", body: "Open a report of the result on screen, or of the national overview. You can edit the text and save it as a PDF." },
    layers: { title: "Choose what the map shows", body: "Switch the risk map, rainfall, reference layers and the affected buildings and roads on or off, and change how see-through they are." },
    slider: { title: "Look ahead", body: "Move through the next five days of forecast, or play them one after another." },
    safe: { title: "Safe places and routes", body: "Find nearby places on very-low-risk ground and preview a route to one of them. They are candidates from open data, so confirm locally." },
    community: { title: "Report what you see", body: "Send a photo of a landslide or a blocked road. It is checked by AI before it appears on the map." },
    lang: { title: "English or Thai", body: "Switch the language of the whole app here." },
    alerts: { title: "Alerts", body: "Sign in and watch a province to be told when its risk goes up." },
    help: { title: "Need this again?", body: "Open the tour any time from this button." },
  },
  th: {
    province: { title: "เลือกจังหวัด", body: "เลือกจังหวัดเพื่อดูตำบลต่าง ๆ หรือปล่อยว่างไว้เพื่อดูทั้งประเทศ" },
    chat: { title: "ถามด้วยภาษาของคุณเอง", body: "ลอง “ฝน 250 มม. ใน 3 วัน เชียงราย” หรือ “เปรียบเทียบ 150 กับ 300 มม. ที่น่าน” ตัวเลขทุกตัวในคำตอบมาจากการคำนวณ" },
    report: { title: "สร้างรายงาน", body: "เปิดรายงานของผลที่แสดงอยู่ หรือของภาพรวมทั้งประเทศ แก้ไขข้อความได้และบันทึกเป็น PDF" },
    layers: { title: "เลือกสิ่งที่แผนที่แสดง", body: "เปิดหรือปิดแผนที่ความเสี่ยง ปริมาณฝน ชั้นข้อมูลอ้างอิง และอาคารกับถนนที่ได้รับผลกระทบ รวมทั้งปรับความโปร่งใส" },
    slider: { title: "ดูล่วงหน้า", body: "เลื่อนดูการคาดการณ์ 5 วันข้างหน้า หรือกดเล่นต่อเนื่อง" },
    safe: { title: "สถานที่ปลอดภัยและเส้นทาง", body: "ค้นหาสถานที่ใกล้เคียงบนพื้นที่เสี่ยงต่ำมาก และดูตัวอย่างเส้นทางไปยังที่นั้น เป็นตัวเลือกจากข้อมูลเปิด โปรดยืนยันกับพื้นที่อีกครั้ง" },
    community: { title: "แจ้งสิ่งที่คุณเห็น", body: "ส่งภาพดินถล่มหรือถนนถูกปิด AI จะตรวจก่อนแสดงบนแผนที่" },
    lang: { title: "อังกฤษหรือไทย", body: "สลับภาษาของทั้งแอปได้ที่นี่" },
    alerts: { title: "การแจ้งเตือน", body: "ลงชื่อเข้าใช้และติดตามจังหวัด เพื่อรับแจ้งเมื่อความเสี่ยงสูงขึ้น" },
    help: { title: "ต้องการดูอีกครั้ง?", body: "เปิดทัวร์นี้ได้ทุกเมื่อจากปุ่มนี้" },
  },
};

export interface Box { left: number; top: number; width: number; height: number }

/** Where the card goes: below the target, else above, else to the right, else to the left, else pinned inside the screen. Always clamped to the viewport. */
export function placeCard(target: Box, card: { w: number; h: number }, vp: { w: number; h: number }, gap = 14, pad = 8): { left: number; top: number } {
  const clampX = (x: number) => Math.max(pad, Math.min(x, vp.w - card.w - pad));
  const clampY = (y: number) => Math.max(pad, Math.min(y, vp.h - card.h - pad));
  const midX = target.left + target.width / 2 - card.w / 2;
  const midY = target.top + target.height / 2 - card.h / 2;
  const below = target.top + target.height + gap;
  if (below + card.h <= vp.h - pad) return { left: clampX(midX), top: below };
  const above = target.top - gap - card.h;
  if (above >= pad) return { left: clampX(midX), top: above };
  const right = target.left + target.width + gap;
  if (right + card.w <= vp.w - pad) return { left: right, top: clampY(midY) };
  const left = target.left - gap - card.w;
  if (left >= pad) return { left, top: clampY(midY) };
  return { left: clampX(midX), top: clampY(vp.h - card.h - pad) };
}

// --- seen / not seen (browser storage, with a fallback for the visit when storage is blocked) ---
let seenInMemory = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function readSeen(): boolean {
  if (seenInMemory) return true;
  try { return localStorage.getItem(TOUR_KEY) === "done"; } catch { return false; }
}
export function markTourSeen() {
  seenInMemory = true;
  try { localStorage.setItem(TOUR_KEY, "done"); } catch { /* blocked storage: it will show again next visit */ }
  notify();
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => { listeners.delete(cb); window.removeEventListener("storage", cb); };
}
/** True until the visitor has finished or skipped the tour once. False on the server, so the page renders the same before and after hydration. */
export const useTourPending = () => useSyncExternalStore(subscribe, () => !readSeen(), () => false);
