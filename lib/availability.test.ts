import assert from "node:assert/strict";
import test from "node:test";
import { computeOpenSlots, isBlockingStatus, mergeBlocks } from "@/lib/availability";
import type { ScheduleBlock } from "@/lib/types";
import { zonedDateTimeToUtc } from "@/lib/time";

const TZ = "America/New_York";

function block(partial: Partial<ScheduleBlock> & Pick<ScheduleBlock, "date" | "startMinutes" | "endMinutes" | "providerId">): ScheduleBlock {
  return {
    id: partial.id ?? `${partial.providerId}-${partial.date}-${partial.startMinutes}`,
    locationId: partial.locationId === undefined ? "harbor" : partial.locationId,
    mode: partial.mode ?? "InOffice",
    origin: "posted",
    ...partial,
  };
}

const NOW = Date.parse("2026-09-20T12:00:00.000Z");

test("a week with no posted hours has no openings", () => {
  const slots = computeOpenSlots({
    blocks: [],
    busy: [],
    fromDate: "2026-09-21",
    toDate: "2026-09-27",
    durationMinutes: 20,
    stepMinutes: 20,
    timeZone: TZ,
    nowMs: NOW,
    leadMinutes: 0,
  });
  assert.equal(slots.length, 0);
});

test("hours on one week do not open the next week", () => {
  const slots = computeOpenSlots({
    blocks: [block({ providerId: "amira", date: "2026-09-21", startMinutes: 8 * 60, endMinutes: 10 * 60 })],
    busy: [],
    fromDate: "2026-09-28",
    toDate: "2026-10-04",
    durationMinutes: 20,
    stepMinutes: 20,
    timeZone: TZ,
    nowMs: NOW,
    leadMinutes: 0,
  });
  assert.equal(slots.length, 0);
});

test("the same clinician can be at two places in one day, and a visit cannot cross the gap", () => {
  const slots = computeOpenSlots({
    blocks: [
      block({ providerId: "amira", locationId: "harbor", date: "2026-09-21", startMinutes: 8 * 60, endMinutes: 12 * 60 }),
      block({ providerId: "amira", locationId: "ridge", date: "2026-09-21", startMinutes: 13 * 60, endMinutes: 17 * 60 }),
    ],
    busy: [],
    fromDate: "2026-09-21",
    toDate: "2026-09-21",
    durationMinutes: 40,
    stepMinutes: 20,
    timeZone: TZ,
    nowMs: NOW,
    leadMinutes: 0,
    providerId: "amira",
  });
  const places = new Set(slots.map((slot) => `${slot.locationId}@${slot.startMinutes}`));
  assert.ok(places.has("harbor@680"));
  assert.equal(
    slots.some((slot) => slot.startMinutes === 11 * 60 + 40),
    false,
  );
  assert.ok(slots.every((slot) => (slot.locationId === "harbor" ? slot.startMinutes < 12 * 60 : slot.startMinutes >= 13 * 60)));
  assert.ok(slots.some((slot) => slot.locationId === "ridge" && slot.startMinutes === 13 * 60));
});

test("a booked visit blocks that clinician everywhere, including another location", () => {
  const start = zonedDateTimeToUtc("2026-09-21", 9 * 60, TZ).getTime();
  const slots = computeOpenSlots({
    blocks: [
      block({ providerId: "amira", locationId: "harbor", date: "2026-09-21", startMinutes: 8 * 60, endMinutes: 12 * 60 }),
      block({ providerId: "amira", locationId: "ridge", date: "2026-09-21", startMinutes: 9 * 60, endMinutes: 11 * 60 }),
    ],
    busy: [{ providerId: "amira", startMs: start, endMs: start + 40 * 60_000, status: "Scheduled" }],
    fromDate: "2026-09-21",
    toDate: "2026-09-21",
    durationMinutes: 20,
    stepMinutes: 20,
    timeZone: TZ,
    nowMs: NOW,
    leadMinutes: 0,
  });
  assert.equal(
    slots.some((slot) => slot.startMinutes === 9 * 60),
    false,
  );
  assert.equal(
    slots.some((slot) => slot.locationId === "ridge" && slot.startMinutes === 9 * 60),
    false,
  );
  assert.ok(slots.some((slot) => slot.locationId === "harbor" && slot.startMinutes === 8 * 60));
});

test("cancelled visits do not hold the time", () => {
  const start = zonedDateTimeToUtc("2026-09-21", 9 * 60, TZ).getTime();
  const slots = computeOpenSlots({
    blocks: [block({ providerId: "amira", date: "2026-09-21", startMinutes: 9 * 60, endMinutes: 10 * 60 })],
    busy: [{ providerId: "amira", startMs: start, endMs: start + 20 * 60_000, status: "Cancelled" }],
    fromDate: "2026-09-21",
    toDate: "2026-09-21",
    durationMinutes: 20,
    stepMinutes: 20,
    timeZone: TZ,
    nowMs: NOW,
    leadMinutes: 0,
  });
  assert.equal(slots.length, 3);
  assert.ok(slots.some((slot) => slot.startMinutes === 9 * 60));
  assert.equal(isBlockingStatus("No-show"), false);
  assert.equal(isBlockingStatus("Rescheduled"), true);
  assert.equal(isBlockingStatus("Tentative"), true);
});

test("touching blocks at the same place merge, and a different place does not", () => {
  const merged = mergeBlocks([
    block({ providerId: "maya", date: "2026-09-22", startMinutes: 13 * 60, endMinutes: 15 * 60, locationId: "harbor" }),
    block({ providerId: "maya", date: "2026-09-22", startMinutes: 15 * 60, endMinutes: 18 * 60, locationId: "harbor" }),
    block({ providerId: "maya", date: "2026-09-22", startMinutes: 18 * 60, endMinutes: 19 * 60, locationId: "ridge" }),
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.locationId === "harbor")?.endMinutes, 18 * 60);
});

test("eastern morning hours convert to UTC during daylight time", () => {
  const instant = zonedDateTimeToUtc("2026-09-23", 9 * 60, TZ);
  assert.equal(instant.toISOString(), "2026-09-23T13:00:00.000Z");
});
