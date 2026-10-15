// Run: node --test lib/safe.test.ts   (Node type stripping)
import test from "node:test";
import assert from "node:assert/strict";
import { compass, directionsUrl, formatDistance, formatDuration, reportReasonKey, timeAgo } from "./safe.ts";

test("distances and durations read naturally", () => {
  assert.equal(formatDistance(430), "430 m");
  assert.equal(formatDistance(1530), "1.5 km");
  assert.equal(formatDistance(17001), "17 km");
  assert.equal(formatDuration(29), "1 min");
  assert.equal(formatDuration(2107), "35 min");
  assert.equal(formatDuration(5400), "1 h 30 min");
});

test("bearings become compass points", () => {
  assert.deepEqual([0, 44, 90, 181, 270, 359].map(compass), ["N", "NE", "E", "S", "W", "N"]);
});

test("the hand-off link carries the places and the travel mode", () => {
  const u = new URL(directionsUrl({ lat: 18.79, lng: 98.98 }, { lat: 18.8, lng: 98.95 }, "WALK"));
  assert.equal(u.origin + u.pathname, "https://www.google.com/maps/dir/");
  assert.equal(u.searchParams.get("destination"), "18.8,98.95");
  assert.equal(u.searchParams.get("origin"), "18.79,98.98");
  assert.equal(u.searchParams.get("travelmode"), "walking");
  assert.ok(!new URL(directionsUrl(null, { lat: 1, lng: 2 })).searchParams.has("origin"));
});

test("a rejected report always gets a reason the person can read", () => {
  assert.equal(reportReasonKey("not_slope_scene"), "reportWhyNot_slope");
  assert.equal(reportReasonKey("data_disagrees"), "reportWhyData");
  assert.equal(reportReasonKey("low_confidence"), "reportWhyLow");
  assert.equal(reportReasonKey("anything else"), "reportWhyLow");
});

test("report age is short and in the right language", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  assert.equal(timeAgo("2026-10-15T11:55:00Z", "en", now), "5 min ago");
  assert.equal(timeAgo("2026-10-15T09:00:00Z", "en", now), "3 h ago");
  assert.equal(timeAgo("2026-10-13T12:00:00Z", "en", now), "2 d ago");
  assert.equal(timeAgo("2026-10-15T11:55:00Z", "th", now), "5 นาที ที่แล้ว");
});
