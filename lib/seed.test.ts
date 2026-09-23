import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewStore } from "@/lib/seed";
import { dateKeyInZone } from "@/lib/time";

const ZONE = "America/New_York";

function holdDate(now: Date, patientId: string): string {
  const store = createPreviewStore(now);
  const visit = store.appointments.find((appointment) => appointment.patientId === patientId);
  assert.ok(visit, `${patientId} should have a sample visit`);
  return dateKeyInZone(new Date(visit.start), ZONE);
}

test("sample visits are booked on a later calendar day", () => {
  const now = new Date("2026-09-23T20:00:00.000Z");
  const today = dateKeyInZone(now, ZONE);
  assert.ok(holdDate(now, "pat-elena") > today);
  assert.ok(holdDate(now, "pat-samir") > today);
});

test("a Thursday morning reset does not park the sample visit on Thursday", () => {
  const now = new Date("2026-09-24T12:00:00.000Z");
  const today = dateKeyInZone(now, ZONE);
  assert.equal(today, "2026-09-24");
  assert.ok(holdDate(now, "pat-elena") > today);
});
