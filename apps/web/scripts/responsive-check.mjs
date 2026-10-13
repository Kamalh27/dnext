#!/usr/bin/env node
/**
 * Responsive audit harness for the DNext web app (layout, sizing, interaction, a11y basics).
 *
 * Needs `playwright-core` + a Chrome install; it is NOT a project dependency. Point it at any folder that has it:
 *   PLAYWRIGHT_CORE_DIR=/path/with/node_modules node apps/web/scripts/responsive-check.mjs [options]
 * (or `npm i -g playwright-core`; the script also tries a plain `import("playwright-core")`).
 *
 * The app must be running (`just dev`, web :3000 + api :8080) - it runs against the REAL API, including a real scenario run (Nan, 250 mm).
 *
 * Options
 *   --url http://localhost:3000   app URL
 *   --out DIR                     screenshots + resp-results.json go here (default ./shots)
 *   --viewports 360x740,1280x720  subset (default: all, see VIEWPORTS; "640x360z" = browser zoom 200% emulation)
 *   --states a,b,c,d,e,f,g        subset: a overview, b Thai, c province+scenario+layers, d dark, e about+legal modals,
 *                                 f chat input + on-screen keyboard, g info popover + panel collapse/expand + persistence
 *   --jobs 3                      viewports audited in parallel
 *   --resize                      instead of the matrix: live-resize test 1440 -> 800 -> 360 -> 1440 (state must survive)
 *   --full                        also print every FAIL message (default prints up to 3 per viewport/state/category)
 *
 * Checks per viewport x state x view (view = chat | map in tab mode, split otherwise):
 *   hscroll / vscroll    no page scroll
 *   offscreen            interactive element clipped by the viewport or an overflow:hidden ancestor
 *   overlap              map overlays (data-map-overlay=search|tools|layers|basemap|basemap-chooser|scale|legend|slider|tooltip)
 *                        must not intersect each other, leave the map, or cover > 35% of the map on phones
 *   glogo                nothing in the bottom-left 100x30 px (Google logo)
 *   target               tap target >= 44x44 (coarse pointer) / 32x32 (fine)
 *   textsize / inputsize text >= 12px; inputs/selects >= 16px on touch
 *   clip                 text truncated without a title, clipped by overflow:hidden, or spilling out of its box
 *   chrome               pinned header/tabs/scenario bar/composer share of the viewport (35% on short screens, 45% otherwise)
 *   mapmin               visible map >= 60% of viewport width and >= 45% of height
 *   kb                   (state f) composer stays inside the shrunken viewport
 *   panels / info        (state g) collapse + info popover behaviour
 * Exit code 1 when any check fails.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

async function loadPlaywright() {
  try { return await import("playwright-core"); } catch { /* fall through */ }
  const dirs = [process.env.PLAYWRIGHT_CORE_DIR, process.cwd()];
  try { dirs.push(execSync("npm root -g", { encoding: "utf8" }).trim() + "/..") } catch { /* no npm */ }
  for (const d of dirs.filter(Boolean)) {
    try { return createRequire(join(resolve(d), "noop.js"))("playwright-core"); } catch { /* try next */ }
  }
  console.error("playwright-core not found. Set PLAYWRIGHT_CORE_DIR to a folder whose node_modules has it.");
  process.exit(2);
}
const pw = await loadPlaywright();
const chromium = pw.chromium ?? pw.default?.chromium;

// ---------------------------------------------------------------- args
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? (args[i + 1]?.startsWith("--") || args[i + 1] == null ? true : args[i + 1]) : d; };
const URL_ = opt("url", "http://localhost:3000");
const OUT = resolve(opt("out", "shots"));
const JOBS = Number(opt("jobs", 3));
const FULL = !!opt("full", false);
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { w: 360, h: 740, touch: true }, { w: 390, h: 844, touch: true }, { w: 430, h: 932, touch: true },
  { w: 740, h: 360, touch: true }, { w: 844, h: 390, touch: true },
  { w: 768, h: 1024, touch: true }, { w: 1024, h: 768, touch: true },
  { w: 1280, h: 720 }, { w: 1440, h: 900 }, { w: 1920, h: 1080 }, { w: 2560, h: 1440 },
  { w: 640, h: 360, zoom: true },
].map((v) => ({ ...v, name: `${v.w}x${v.h}${v.zoom ? "z" : ""}` }));
const ALL_STATES = ["a", "b", "c", "d", "e", "f", "g"];
const wantVp = String(opt("viewports", "")).split(",").filter(Boolean);
const wantSt = String(opt("states", ALL_STATES.join(","))).split(",").filter(Boolean);
const vps = VIEWPORTS.filter((v) => wantVp.length === 0 ? true : wantVp.includes(v.name));

// ---------------------------------------------------------------- page-side audit
/* Runs inside the page. Returns [{cat, msg}] */
function auditPage({ coarse, view }) {
  const out = [];
  const add = (cat, msg) => out.push({ cat, msg });
  const iw = innerWidth, ih = innerHeight;
  const visible = (el) => { try { return el.checkVisibility({ checkOpacity: true, opacityProperty: true, checkVisibilityCSS: true, visibilityProperty: true }); } catch { return el.getClientRects().length > 0; } };
  const desc = (el) => {
    const label = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("data-testid") || (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28);
    return `${el.tagName.toLowerCase()}[${label}]`;
  };
  const R = (el) => el.getBoundingClientRect();
  const dlg = document.querySelector("dialog[open]");
  const root = dlg || document.body;
  const skip = (el) => el.closest(".gm-style, .gmnoprint, nextjs-portal, [data-nextjs-toast]") || el.closest("[inert]");

  // page scroll
  const de = document.documentElement;
  if (de.scrollWidth > iw + 1) add("hscroll", `documentElement.scrollWidth ${de.scrollWidth} > innerWidth ${iw}`);
  if (document.body.scrollWidth > iw + 1) add("hscroll", `body.scrollWidth ${document.body.scrollWidth} > ${iw}`);
  if (de.scrollHeight > ih + 1 && !dlg) add("vscroll", `documentElement.scrollHeight ${de.scrollHeight} > innerHeight ${ih}`);

  const all = [...root.querySelectorAll("*")].filter((e) => !skip(e) && visible(e));

  // interactive: size, clipping
  const sel = "button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=switch],[role=radio],[role=slider]";
  const min = coarse ? 44 : 32;
  const seen = new Set();
  for (const el of all) {
    if (!el.matches(sel)) continue;
    if (el.closest("[data-slot=slider-thumb]") && el.tagName === "INPUT") continue;
    if (el.closest("[aria-hidden=true]")) continue;
    let r = R(el);
    if (r.width < 1 || r.height < 1) continue;
    if (el.matches("[data-slot=slider-thumb]")) { const c = el.parentElement; if (c) r = R(c); }
    if (el.matches("[role=separator]")) continue;
    // offscreen / clipped
    let scrollX = false, scrollY = false, clipped = null;
    for (let p = el.parentElement; p && p !== de; p = p.parentElement) {
      const cs = getComputedStyle(p), pr = R(p);
      const ox = cs.overflowX, oy = cs.overflowY;
      if (!scrollX && (ox === "hidden" || ox === "clip") && (r.left < pr.left - 2 || r.right > pr.right + 2)) clipped ??= `clipped horizontally by ${p.tagName.toLowerCase()}.${String(p.className).split(" ")[0]}`;
      if (!scrollY && (oy === "hidden" || oy === "clip") && p !== document.body && (r.top < pr.top - 2 || r.bottom > pr.bottom + 2)) clipped ??= `clipped vertically by ${p.tagName.toLowerCase()}.${String(p.className).split(" ")[0]}`;
      if (ox === "auto" || ox === "scroll") scrollX = true;
      if (oy === "auto" || oy === "scroll") scrollY = true;
    }
    if (clipped) add("offscreen", `${desc(el)} ${clipped} (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})`);
    if (!scrollX && (r.left < -1 || r.right > iw + 1)) add("offscreen", `${desc(el)} outside viewport x (${Math.round(r.left)}..${Math.round(r.right)} of ${iw})`);
    if (!scrollY && (r.top < -1 || r.bottom > ih + 1)) add("offscreen", `${desc(el)} outside viewport y (${Math.round(r.top)}..${Math.round(r.bottom)} of ${ih})`);
    // target size
    if (r.width < min - 0.5 || r.height < min - 0.5) {
      const key = `${el.tagName}|${el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 12)}|${Math.round(r.width)}x${Math.round(r.height)}`;
      if (!seen.has(key)) { seen.add(key); add("target", `${desc(el)} ${Math.round(r.width)}x${Math.round(r.height)} < ${min}`); }
    }
    // input font
    if (coarse && el.matches("input:not([type=range]):not([type=checkbox]):not([type=radio]),select,textarea") && parseFloat(getComputedStyle(el).fontSize) < 15.99)
      add("inputsize", `${desc(el)} font ${getComputedStyle(el).fontSize} < 16px (iOS zoom)`);
  }

  // text size + clipping
  const seenText = new Set();
  for (const el of all) {
    if (["SCRIPT", "STYLE", "OPTION", "svg", "path", "NOSCRIPT"].includes(el.tagName)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    if (fs < 11.99) {
      const k = `${el.tagName}.${String(el.className)}`;
      if (!seenText.has(k)) { seenText.add(k); add("textsize", `${desc(el)} ${fs}px < 12`); }
    }
    const overX = el.scrollWidth - el.clientWidth > 1, overY = el.scrollHeight - el.clientHeight > 1;
    if (cs.textOverflow === "ellipsis" && overX) {
      let t = false; for (let p = el, n = 0; p && n < 5; p = p.parentElement, n++) if (p.getAttribute("title") || p.getAttribute("aria-label")) t = true;
      if (!t) add("clip", `${desc(el)} truncated without title/aria-label`);
    } else if ((cs.overflowX === "hidden" || cs.overflowX === "clip") && overX && cs.display !== "inline") add("clip", `${desc(el)} text clipped horizontally (${el.scrollWidth}>${el.clientWidth})`);
    else if ((cs.overflowY === "hidden" || cs.overflowY === "clip") && overY && cs.display !== "inline") add("clip", `${desc(el)} text clipped vertically (${el.scrollHeight}>${el.clientHeight})`);
    else if (el.matches("button,a,label,select,[role=tab],[role=button]") && overX && cs.overflowX === "visible") add("clip", `${desc(el)} text overflows its box (${el.scrollWidth}>${el.clientWidth})`);
  }

  // map: overlays, logo, min size
  const wrap = document.querySelector("[data-selected-province]");
  const wr = wrap && visible(wrap) ? R(wrap) : null;
  if (wr && !dlg) {
    if (wr.width < 0.6 * iw - 1 || wr.height < 0.45 * ih - 1) add("mapmin", `map ${Math.round(wr.width)}x${Math.round(wr.height)} < 60%x45% of ${iw}x${ih}`);
    const ovs = [...wrap.querySelectorAll("[data-map-overlay]")].filter((e) => visible(e) && R(e).width > 0 && R(e).height > 0)
      .map((e) => ({ el: e, k: e.getAttribute("data-map-overlay"), r: R(e) }));
    const inter = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    for (let i = 0; i < ovs.length; i++) for (let j = i + 1; j < ovs.length; j++) if (inter(ovs[i].r, ovs[j].r)) add("overlap", `${ovs[i].k} x ${ovs[j].k}`);
    const logo = { left: wr.left, right: wr.left + 100, bottom: wr.bottom, top: wr.bottom - 30 };
    const real = [...wrap.querySelectorAll("a[href*='maps.google.com'], a[href*='google.com/maps']")].filter((a) => a.closest(".gm-style")).map(R).filter((r) => r.left < wr.left + 200 && r.top > wr.bottom - 80);
    for (const o of ovs) {
      if (inter(o.r, logo) || real.some((r) => inter(o.r, r))) add("glogo", `${o.k} covers the Google logo area`);
      if (o.r.left < wr.left - 1 || o.r.right > wr.right + 1 || o.r.top < wr.top - 1 || o.r.bottom > wr.bottom + 1) add("overlap", `${o.k} leaves the map (${Math.round(o.r.left - wr.left)},${Math.round(o.r.top - wr.top)} ${Math.round(o.r.width)}x${Math.round(o.r.height)} in ${Math.round(wr.width)}x${Math.round(wr.height)})`);
    }
    const nonTip = ovs.filter((o) => !["tooltip", "basemap-chooser", "layers", "tools-menu"].includes(o.k));   // transient popovers / the layers panel that takes over the map
    const area = nonTip.reduce((s, o) => s + o.r.width * o.r.height, 0) / (wr.width * wr.height);
    const compact = iw < 640 || ih < 500;
    const expanded = !!wrap.querySelector("[data-panel-toggle][aria-expanded=true]");
    const cap = compact ? (expanded ? 0.45 : 0.35) : 0.5;   // a card the user expanded on a phone may use a bit more; the default (collapsed) state must stay <= 35%
    if (area > cap) add("overlap", `overlays cover ${(area * 100).toFixed(0)}% of the map (> ${cap * 100}%)`);
    for (const o of ovs) if (o.k === "tooltip" && (o.r.left < 0 || o.r.right > iw || o.r.top < 0 || o.r.bottom > ih)) add("overlap", "tooltip overflows the viewport");
    out.meta = { overlays: ovs.map((o) => o.k), area: +(area * 100).toFixed(0) };
  }

  // pinned chrome share
  // "pinned" = stays on screen while the content scrolls: not inside a scrolling ancestor, or position: sticky
  const pinned = (el) => {
    if (!el || !visible(el)) return false;
    if (getComputedStyle(el).position === "sticky") return true;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const oy = getComputedStyle(p).overflowY; if (oy === "auto" || oy === "scroll") return false; }
    return true;
  };
  if (!dlg && view !== "kb") {   // with the on-screen keyboard up the pinned chrome is inherent (state f checks the composer instead)
    let h = 0; const parts = [];
    const header = document.querySelector("header"); if (header && visible(header)) { h += R(header).height; parts.push("header"); }
    for (const tl of document.querySelectorAll("[role=tablist]")) if (visible(tl) && !tl.closest("header")) { h += R(tl).height; parts.push("tabs"); }
    for (const [sel2, name] of [["[data-testid=scenario-bar]", "scenario"], ["[data-testid=chat-composer]", "composer"], ["[data-testid=chat-legal]", "legal"]]) {
      const e = document.querySelector(sel2); if (pinned(e)) { h += R(e).height; parts.push(name); }
    }
    const lim = ih < 500 ? 0.35 : 0.45;
    if (h > lim * ih) add("chrome", `pinned chrome ${Math.round(h)}px = ${(h / ih * 100).toFixed(0)}% of ${ih} (> ${lim * 100}%): ${parts.join("+")}`);
  }
  return out;
}

const mkAudit = (page, coarse, view) => page.evaluate(auditPage, { coarse, view }).then((r) => r);

// ---------------------------------------------------------------- driver
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

async function newPage(browser, vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h }, hasTouch: !!vp.touch, isMobile: !!vp.touch, deviceScaleFactor: vp.touch ? 2 : 1,
    permissions: [], geolocation: { latitude: 18.78, longitude: 100.78 },
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message.slice(0, 140)));
  return { ctx, page };
}

async function load(page, vp) {
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-selected-province]", { state: "attached", timeout: 30000 });
  await page.waitForSelector('[data-overview="on"]', { state: "attached", timeout: 30000 }).catch(() => page.errors.push("overview never turned on"));
  await sleep(1800);
  vp.tabs = (await page.locator("[role=tab]:visible").count()) > 0;   // tab mode is whatever the app actually rendered
}

const isTabs = (vp) => vp.tabs ?? vp.w < 1024;
async function showView(page, vp, v) {
  if (!isTabs(vp)) return;
  await page.locator("[role=tab]:visible").nth(v === "chat" ? 0 : 1).click();
  await sleep(700);
}

async function probe(page, vp, state, label, view, extra) {
  await sleep(350);
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  let fails = await mkAudit(page, coarse, view);
  if (extra) fails = fails.concat(await extra(page, coarse));
  const meta = fails.meta;
  const file = `resp-${vp.name}-${state}-${label}.png`;
  await page.screenshot({ path: join(OUT, file) });
  for (const e of page.errors.splice(0)) fails.push({ cat: "pageerror", msg: e });
  results.push({ vp: vp.name, state, probe: label, fails, meta, file });
  process.stdout.write(`${fails.length ? "F" : "."}`);
}

async function views(page, vp, state, fn) {
  if (isTabs(vp)) {
    await showView(page, vp, "chat"); await probe(page, vp, state, "chat", "chat");
    await showView(page, vp, "map"); await probe(page, vp, state, "map", "map");
    if (fn) await fn("map");
  } else {
    await probe(page, vp, state, "split", "split");
    if (fn) await fn("split");
  }
}

async function openChooser(page, vp, state) {
  const b = page.locator("[data-map-overlay=basemap] button").first();
  if (!(await b.count())) return;
  await b.click(); await sleep(300);
  await probe(page, vp, state, "chooser", "map");
  await page.keyboard.press("Escape"); await sleep(200);
}

async function hoverProbes(page, vp, state) {
  if (vp.touch) return;
  const wr = await page.locator("[data-selected-province]").first().boundingBox();
  if (!wr) return;
  const hits = [];
  for (const fx of [0.3, 0.45, 0.6, 0.75, 0.9]) for (const fy of [0.2, 0.35, 0.5, 0.65, 0.8, 0.92]) {
    await page.mouse.move(wr.x + wr.width * fx, wr.y + wr.height * fy); await sleep(160);
    if (await page.locator("[data-map-overlay=tooltip]").count()) hits.push([fx, fy]);
  }
  const pick = [hits.sort((a, b) => a[1] - b[1])[0], hits.sort((a, b) => b[1] - a[1])[0], hits.sort((a, b) => b[0] - a[0])[0]].filter(Boolean);
  const done = new Set();
  for (const [fx, fy] of pick) {
    const k = `${fx},${fy}`; if (done.has(k)) continue; done.add(k);
    await page.mouse.move(wr.x + wr.width * fx, wr.y + wr.height * fy); await sleep(300);
    await probe(page, vp, state, `hover-${done.size}`, "map");
  }
  await page.mouse.move(2, 2);
  if (!hits.length) results.push({ vp: vp.name, state, probe: "hover", fails: [{ cat: "note", msg: "no province tooltip reachable by hover (not scored)" }], file: "" });
}

async function runScenario(page, vp) {
  await showView(page, vp, "chat");
  const sel = page.locator("[data-testid=scenario-bar] select:visible").first();
  await sel.selectOption({ label: "Nan" });
  await sleep(1500);
  await page.getByRole("button", { name: /^(Run scenario|คำนวณ)$/ }).first().click();
  await page.waitForFunction(() => !!document.querySelector("[data-testid=kpi-triggered]") || Number(document.querySelector("[data-selected-province]")?.getAttribute("data-overlay-count")) > 0, null, { timeout: 150000 });
  await sleep(2500);
}

async function stateRun(browser, vp, st) {
  const { ctx, page } = await newPage(browser, vp);
  try {
    await load(page, vp);
    if (st === "a") {
      await views(page, vp, "a");
      if (isTabs(vp)) await showView(page, vp, "map");
      await openChooser(page, vp, "a");
      await hoverProbes(page, vp, "a");
      // short screens: the "more tools" popover (open next to an expanded slider card = the tightest case)
      const more = page.locator("button[aria-haspopup=true][aria-label*='ore']:visible, button[aria-label='More map tools']:visible").first();
      if (await more.count()) {
        const sl = page.locator("[data-panel-toggle=slider]:visible").first();
        if ((await sl.getAttribute("aria-expanded")) !== "true") { await sl.click(); await sleep(400); }
        await more.click(); await sleep(350);
        await probe(page, vp, "a", "tools-menu", "map");
        await page.keyboard.press("Escape");
      }
      // dashboard accordions: defaults per breakpoint (desktop: all but the footnote; otherwise only Key figures)
      if (isTabs(vp)) await showView(page, vp, "chat");
      const acc = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-section] > h3 > button")].map((b) => [b.closest("[data-section]").getAttribute("data-section"), b.getAttribute("aria-expanded") === "true"])));
      const desk = vp.w >= 1024;
      const want = desk ? { key: true, trend: true, breakdown: true, about: false } : { key: true, trend: false, breakdown: false, about: false };
      const bad = Object.entries(want).filter(([k, v]) => acc[k] !== v).map(([k, v]) => ({ cat: "panels", msg: `accordion ${k} should default ${v ? "open" : "closed"} (got ${acc[k]})` }));
      results.push({ vp: vp.name, state: "a", probe: "accordions", fails: bad, file: "" });
    }
    if (st === "b") {
      await page.locator("header [role=group] button", { hasText: "ไทย" }).click(); await sleep(800);
      await views(page, vp, "b");
    }
    if (st === "c") {
      await runScenario(page, vp);
      const layersBtn = () => page.getByRole("button", { name: /^(Map layers|ชั้นข้อมูลแผนที่)$/ }).first();
      if (isTabs(vp)) {
        await probe(page, vp, "c", "chat", "chat");
        await showView(page, vp, "map"); await probe(page, vp, "c", "map", "map");
        await layersBtn().click(); await sleep(500); await probe(page, vp, "c", "map+layers", "map");
        await page.keyboard.press("Escape");
      } else {
        await probe(page, vp, "c", "split", "split");
        await layersBtn().click(); await sleep(500); await probe(page, vp, "c", "split+layers", "split");
        await page.keyboard.press("Escape");
      }
      await openChooser(page, vp, "c");
    }
    if (st === "d") {
      await page.locator("header button[aria-pressed]:not([aria-label=''])").filter({ has: page.locator("svg") }).last().click(); await sleep(700);
      const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
      if (!dark) results.push({ vp: vp.name, state: "d", probe: "theme", fails: [{ cat: "pageerror", msg: "theme toggle did not switch to dark" }], file: "" });
      await views(page, vp, "d");
    }
    if (st === "e") {
      await showView(page, vp, "chat");
      await page.locator("header button[aria-label]").first().waitFor();
      await page.getByRole("button", { name: /About this project|เกี่ยวกับโครงการ/ }).click(); await sleep(600);
      await probe(page, vp, "e", "about", "modal");
      await page.keyboard.press("Escape"); await sleep(300);
      await page.getByRole("button", { name: /^(Privacy|ความเป็นส่วนตัว)$/ }).click(); await sleep(600);
      await probe(page, vp, "e", "legal", "modal");
      await page.keyboard.press("Escape");
    }
    if (st === "f") {
      await showView(page, vp, "chat");
      const kb = vp.touch ? (vp.h > 500 ? 320 : Math.round(vp.h * 0.5)) : 0;
      if (kb) await page.setViewportSize({ width: vp.w, height: vp.h - kb });
      await page.locator("[data-chat-input]").focus(); await sleep(600);
      await probe(page, vp, "f", kb ? "keyboard" : "focus", kb ? "kb" : "chat", async (p) => p.evaluate(() => {
        const o = [], i = document.querySelector("[data-chat-input]")?.getBoundingClientRect(), h = document.querySelector("header")?.getBoundingClientRect();
        if (!i) return [{ cat: "kb", msg: "chat input missing" }];
        if (i.bottom > innerHeight + 1 || i.top < 0) o.push({ cat: "kb", msg: `composer outside the viewport (${Math.round(i.top)}..${Math.round(i.bottom)} of ${innerHeight})` });
        if (h && h.top < -1) o.push({ cat: "kb", msg: "header scrolled off" });
        if (document.activeElement !== document.querySelector("[data-chat-input]")) o.push({ cat: "kb", msg: "input lost focus" });
        return o;
      }));
      if (kb) await page.setViewportSize({ width: vp.w, height: vp.h });
    }
    if (st === "g") await panelsState(page, vp);
  } catch (e) {
    results.push({ vp: vp.name, state: st, probe: "run", fails: [{ cat: "pageerror", msg: `state aborted: ${String(e.message).split("\n").filter((l) => l.trim()).slice(0, 6).join(" | ").slice(0, 1200)}` }], file: "" });
    process.stdout.write("X");
  } finally { await ctx.close(); }
}

/** State g: info popover (hover/focus/click/Esc/outside), collapse + expand of slider and legend cards, persistence across reload, Thai text. */
async function panelsState(page, vp) {
  if (isTabs(vp)) await showView(page, vp, "map");
  const tog = (k) => page.locator(`[data-panel-toggle=${k}]:visible`).first();
  const exp = async (k) => (await tog(k).getAttribute("aria-expanded")) === "true";
  const info = () => page.locator("[data-info-btn]:visible").first();
  const bad = (msg) => ({ cat: "panels", msg });
  const need = async () => {
    const o = [];
    for (const k of ["slider", "legend"]) if (!(await tog(k).count())) o.push(bad(`no collapse toggle for ${k}`));
    return o;
  };
  const checks = await need();
  if (checks.length) { results.push({ vp: vp.name, state: "g", probe: "missing", fails: checks, file: "" }); return; }

  // On phones / short screens the two cards are mutually exclusive (a small map), elsewhere both can be open.
  const compact = vp.w < 640 || vp.h < 500;
  const setOpen = async (k, want) => { if ((await exp(k)) !== want) { await tog(k).click(); await sleep(400); } };
  const reloadMap = async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-overview="on"]', { state: "attached", timeout: 30000 }); await sleep(1500);
    if (isTabs(vp)) await showView(page, vp, "map");
  };
  if (compact) { await setOpen("legend", false); await setOpen("slider", true); } else { await setOpen("slider", true); await setOpen("legend", true); }
  if (!(await info().count())) { results.push({ vp: vp.name, state: "g", probe: "missing", fails: [bad("no info button on the expanded slider card")], file: "" }); return; }
  await probe(page, vp, "g", compact ? "expanded-slider" : "expanded", "map");
  // info: click opens, popover inside viewport, Esc closes, outside press closes
  const popBox = async () => page.locator("[role=tooltip]:visible").first().boundingBox({ timeout: 3000 }).catch(() => null);
  const inView = async (label) => {
    const b = await popBox(); const f = [];
    if (!b) return [bad(`${label}: popover not visible`)];
    if (b.x < 0 || b.y < 0 || b.x + b.width > vp.w + 0.5 || b.y + b.height > vp.h + 0.5) f.push(bad(`${label}: popover clipped (${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)} in ${vp.w}x${vp.h})`));
    if (b.width > 300) f.push(bad(`${label}: popover wider than 300px (${Math.round(b.width)})`));
    return f;
  };
  await info().click(); await sleep(350);
  await probe(page, vp, "g", "info-click", "map", async () => {
    const f = await inView("click");
    if ((await info().getAttribute("aria-expanded")) !== "true") f.push(bad("info aria-expanded not true after click"));
    return f;
  });
  await page.keyboard.press("Escape"); await sleep(250);
  if (await page.locator("[role=tooltip]:visible").count()) results.push({ vp: vp.name, state: "g", probe: "info-esc", fails: [bad("Esc did not close the info popover")], file: "" });
  await info().click(); await sleep(250);
  await page.mouse.move(3, 3);
  await page.evaluate(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }))); await sleep(250);   // a press outside the popover (a real map press would also select a province)
  if (await page.locator("[role=tooltip]:visible").count()) results.push({ vp: vp.name, state: "g", probe: "info-outside", fails: [bad("outside click did not close the info popover")], file: "" });
  if (!vp.touch) {
    await page.mouse.move(3, 3); await sleep(200);
    await info().hover(); await sleep(450);
    const f = await inView("hover");
    if (f.length) results.push({ vp: vp.name, state: "g", probe: "info-hover", fails: f, file: "" });
    await page.mouse.move(3, 3); await sleep(300);
    await info().focus(); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab"); await sleep(300);   // keyboard-driven focus (matches :focus-visible)
    const f2 = await inView("focus");
    if (f2.length) results.push({ vp: vp.name, state: "g", probe: "info-focus", fails: f2, file: "" });
    await page.keyboard.press("Escape");
  }
  if (compact) { await setOpen("slider", false); await setOpen("legend", true); await probe(page, vp, "g", "expanded-legend", "map"); }
  await setOpen("slider", false); await setOpen("legend", false);
  await probe(page, vp, "g", "collapsed", "map");
  // persistence across reload (default is collapsed on compact, expanded elsewhere)
  const wants = compact ? [{ slider: true, legend: false }, { slider: false, legend: true }] : [{ slider: false, legend: false }, { slider: true, legend: true }];
  const pf = [];
  for (const w of wants) {
    for (const k of ["slider", "legend"]) if (!w[k]) await setOpen(k, false);   // close first, then open (opening one closes the other on compact screens)
    for (const k of ["slider", "legend"]) if (w[k]) await setOpen(k, true);
    await reloadMap();
    for (const k of ["slider", "legend"]) if ((await exp(k)) !== w[k]) pf.push(bad(`${k} should be ${w[k] ? "expanded" : "collapsed"} after reload`));
  }
  results.push({ vp: vp.name, state: "g", probe: "persist", fails: pf, file: "" });
  // Thai text in the popover
  await page.locator("header [role=group] button", { hasText: "ไทย" }).click(); await sleep(600);
  if (isTabs(vp)) await showView(page, vp, "map");
  if (compact) await setOpen("legend", false);
  await setOpen("slider", true);
  await info().click(); await sleep(400);
  await probe(page, vp, "g", "info-th", "map", async () => {
    const f = await inView("th");
    const txt = (await page.locator("[role=tooltip]:visible").first().textContent().catch(() => "")) || "";
    if (!/[฀-๿]/.test(txt)) f.push(bad("popover text is not Thai"));
    return f;
  });
}

async function resizeTest(browser) {
  const vp = { w: 1440, h: 900, name: "1440x900" };
  const { ctx, page } = await newPage(browser, vp);
  const fails = [];
  const snap = () => page.evaluate(() => ({
    prov: document.querySelector("[data-selected-province]")?.getAttribute("data-selected-province"),
    layers: document.querySelector("[data-selected-province]")?.getAttribute("data-overlay-count"),
    dark: document.documentElement.classList.contains("dark"),
    th: [...document.querySelectorAll("header [role=group] button")].some((b) => b.textContent === "ไทย" && b.getAttribute("aria-pressed") === "true"),
    results: !!document.querySelector("[data-testid=kpi-triggered]"),
    hscroll: document.documentElement.scrollWidth > innerWidth + 1,
  }));
  await load(page, vp);
  await runScenario(page, vp);
  await page.locator("header [role=group] button", { hasText: "ไทย" }).click();
  await page.locator("header button[aria-pressed]").filter({ has: page.locator("svg") }).last().click(); await sleep(800);
  const base = await snap();
  console.log("baseline", JSON.stringify(base));
  for (const [w, h] of [[800, 1000], [360, 740], [1440, 900]]) {
    await page.setViewportSize({ width: w, height: h }); await sleep(1200);
    const s = await snap();
    const diff = ["prov", "dark", "th", "results"].filter((k) => s[k] !== base[k]);
    if (diff.length) fails.push(`${w}x${h}: lost ${diff.join(",")}`);
    if (s.hscroll) fails.push(`${w}x${h}: horizontal scroll`);
    if (Number(s.layers) < 1) fails.push(`${w}x${h}: map layers gone`);
    await page.screenshot({ path: join(OUT, `resp-resize-${w}x${h}.png`) });
    console.log(`${w}x${h}`, JSON.stringify(s));
  }
  await ctx.close();
  console.log(fails.length ? `RESIZE FAIL\n  ${fails.join("\n  ")}` : "RESIZE PASS (province, results, language, theme survived 1440 -> 800 -> 360 -> 1440)");
  process.exit(fails.length ? 1 : 0);
}

// ---------------------------------------------------------------- main
const browser = await chromium.launch({ channel: "chrome", headless: true });
if (opt("resize", false)) await resizeTest(browser);

const queue = [...vps];
async function worker() {
  while (queue.length) {
    const vp = queue.shift();
    for (const st of wantSt) await stateRun(browser, vp, st);
  }
}
await Promise.all(Array.from({ length: Math.max(1, JOBS) }, worker));
await browser.close();
console.log("\n");

const order = (a, b) => VIEWPORTS.findIndex((v) => v.name === a.vp) - VIEWPORTS.findIndex((v) => v.name === b.vp) || a.state.localeCompare(b.state);
results.sort(order);
const scored = (r) => r.fails.filter((f) => f.cat !== "note");
const failing = results.filter((r) => scored(r).length);
const byCat = {};
for (const r of results) for (const f of scored(r)) byCat[f.cat] = (byCat[f.cat] || 0) + 1;

console.log(`PROBES ${results.length}  PASS ${results.length - failing.length}  FAIL ${failing.length}`);
console.log("FAIL counts by category:", Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ") || "none");
if (failing.length) {
  console.log("\nviewport   state probe          FAIL categories");
  for (const r of failing) {
    const cats = {};
    for (const f of scored(r)) cats[f.cat] = (cats[f.cat] || 0) + 1;
    console.log(`${r.vp.padEnd(10)} ${r.state}     ${r.probe.padEnd(14)} ${Object.entries(cats).map(([k, v]) => `${k}${v > 1 ? "x" + v : ""}`).join(", ")}`);
  }
  console.log("\nDETAILS");
  for (const r of failing) {
    const per = {};
    for (const f of scored(r)) (per[f.cat] ??= []).push(f.msg);
    for (const [c, ms] of Object.entries(per)) for (const m of FULL ? ms : [...new Set(ms)].slice(0, 3)) console.log(`  ${r.vp} ${r.state}/${r.probe} [${c}] ${m}`);
  }
}
writeFileSync(join(OUT, "resp-results.json"), JSON.stringify(results, null, 1));
console.log(`\nscreenshots + resp-results.json in ${OUT}`);
process.exit(failing.length ? 1 : 0);
