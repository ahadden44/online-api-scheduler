import type { ScheduleBlock, StoredAppointment, WeeklineStore } from "@/lib/types";
import { addDays, mondayOnOrBefore, zonedDateTimeToUtc } from "@/lib/time";
import { dateKeyInZone } from "@/lib/time";

const TIMEZONE = process.env.PRACTICE_TIMEZONE || "America/New_York";

type Draft = {
  providerId: string;
  locationId: string | null;
  mode: "InOffice" | "Telehealth";
  day: number;
  start: number;
  end: number;
};

function hours(start: number, end: number): { start: number; end: number } {
  return { start: start * 60, end: end * 60 };
}

const THIS_WEEK: Draft[] = [
  { providerId: "prov-shah", locationId: "loc-harbor", mode: "InOffice", day: 0, ...hours(8, 12) },
  { providerId: "prov-shah", locationId: "loc-ridge", mode: "InOffice", day: 0, ...hours(13, 17) },
  { providerId: "prov-shah", locationId: "loc-harbor", mode: "InOffice", day: 1, ...hours(9, 15) },
  { providerId: "prov-shah", locationId: "loc-ridge", mode: "InOffice", day: 2, ...hours(8, 12.5) },
  { providerId: "prov-shah", locationId: "loc-harbor", mode: "InOffice", day: 4, ...hours(10, 14) },
  { providerId: "prov-ellis", locationId: "loc-lincoln", mode: "InOffice", day: 0, ...hours(8, 15) },
  { providerId: "prov-ellis", locationId: "loc-lincoln", mode: "InOffice", day: 1, ...hours(8, 12) },
  { providerId: "prov-ellis", locationId: "loc-harbor", mode: "InOffice", day: 2, ...hours(13, 17) },
  { providerId: "prov-ellis", locationId: "loc-ridge", mode: "InOffice", day: 3, ...hours(8, 16) },
  { providerId: "prov-ellis", locationId: null, mode: "Telehealth", day: 4, ...hours(8, 11) },
  { providerId: "prov-ortiz", locationId: "loc-ridge", mode: "InOffice", day: 0, ...hours(9, 13) },
  { providerId: "prov-ortiz", locationId: "loc-harbor", mode: "InOffice", day: 1, ...hours(13, 18) },
  { providerId: "prov-ortiz", locationId: "loc-harbor", mode: "InOffice", day: 2, ...hours(8, 11.5) },
  { providerId: "prov-ortiz", locationId: null, mode: "Telehealth", day: 3, ...hours(16, 19) },
  { providerId: "prov-ortiz", locationId: "loc-ridge", mode: "InOffice", day: 4, ...hours(8, 12) },
];

const NEXT_WEEK: Draft[] = [
  { providerId: "prov-shah", locationId: "loc-ridge", mode: "InOffice", day: 0, ...hours(8, 12) },
  { providerId: "prov-shah", locationId: "loc-harbor", mode: "InOffice", day: 0, ...hours(13, 16) },
  { providerId: "prov-shah", locationId: "loc-lincoln", mode: "InOffice", day: 1, ...hours(8, 12) },
  { providerId: "prov-shah", locationId: "loc-ridge", mode: "InOffice", day: 3, ...hours(12, 17) },
  { providerId: "prov-shah", locationId: null, mode: "Telehealth", day: 4, ...hours(9, 12) },
  { providerId: "prov-ellis", locationId: "loc-harbor", mode: "InOffice", day: 0, ...hours(8, 12) },
  { providerId: "prov-ellis", locationId: "loc-harbor", mode: "InOffice", day: 1, ...hours(13, 17) },
  { providerId: "prov-ellis", locationId: "loc-lincoln", mode: "InOffice", day: 2, ...hours(8, 15) },
  { providerId: "prov-ellis", locationId: "loc-ridge", mode: "InOffice", day: 4, ...hours(9, 13) },
  { providerId: "prov-ortiz", locationId: "loc-lincoln", mode: "InOffice", day: 0, ...hours(9, 14) },
  { providerId: "prov-ortiz", locationId: "loc-ridge", mode: "InOffice", day: 2, ...hours(10, 16) },
  { providerId: "prov-ortiz", locationId: "loc-harbor", mode: "InOffice", day: 3, ...hours(8, 12) },
  { providerId: "prov-ortiz", locationId: null, mode: "Telehealth", day: 4, ...hours(13, 16) },
];

function materialize(monday: string, drafts: Draft[], origin: ScheduleBlock["origin"]): ScheduleBlock[] {
  return drafts.map((draft, index) => ({
    id: `block-${monday}-${index}-${draft.providerId}`,
    providerId: draft.providerId,
    locationId: draft.locationId,
    mode: draft.mode,
    date: addDays(monday, draft.day),
    startMinutes: draft.start,
    endMinutes: draft.end,
    origin,
  }));
}

function previewVisit(input: {
  id: string;
  providerId: string;
  locationId: string | null;
  reasonId: string;
  reasonName: string;
  mode: "InOffice" | "Telehealth";
  patientId: string;
  patientName: string;
  date: string;
  startMinutes: number;
  duration: number;
}): StoredAppointment {
  const start = zonedDateTimeToUtc(input.date, input.startMinutes, TIMEZONE);
  const end = zonedDateTimeToUtc(input.date, input.startMinutes + input.duration, TIMEZONE);
  return {
    id: input.id,
    providerId: input.providerId,
    locationId: input.locationId,
    serviceLocationId: input.locationId,
    reasonId: input.reasonId,
    reasonName: input.reasonName,
    mode: input.mode,
    patientId: input.patientId,
    patientName: input.patientName,
    start: start.toISOString(),
    end: end.toISOString(),
    status: "Scheduled",
    notes: "",
    origin: "preview",
  };
}

function previewHolds(upcoming: ScheduleBlock[], now: Date): StoredAppointment[] {
  const holds: StoredAppointment[] = [];
  const elenaBlock = upcoming.find((block) => block.endMinutes - block.startMinutes >= 80 && block.mode === "InOffice");
  if (elenaBlock) {
    const startMinutes = elenaBlock.startMinutes + 60;
    if (zonedDateTimeToUtc(elenaBlock.date, startMinutes, TIMEZONE).getTime() > now.getTime()) {
      holds.push(
        previewVisit({
          id: "apt-preview-elena",
          providerId: elenaBlock.providerId,
          locationId: elenaBlock.locationId,
          reasonId: "reason-follow",
          reasonName: "Follow-up",
          mode: "InOffice",
          patientId: "pat-elena",
          patientName: "Elena Vasquez",
          date: elenaBlock.date,
          startMinutes,
          duration: 20,
        }),
      );
    }
  }
  const samirBlock = upcoming.find(
    (block) => block.providerId === "prov-ellis" && block.mode === "InOffice" && block.id !== elenaBlock?.id && block.endMinutes - block.startMinutes >= 90,
  );
  if (samirBlock) {
    const startMinutes = samirBlock.startMinutes + 30;
    if (zonedDateTimeToUtc(samirBlock.date, startMinutes, TIMEZONE).getTime() > now.getTime()) {
      holds.push(
        previewVisit({
          id: "apt-preview-samir",
          providerId: samirBlock.providerId,
          locationId: samirBlock.locationId,
          reasonId: "reason-well",
          reasonName: "Well-child visit",
          mode: "InOffice",
          patientId: "pat-samir",
          patientName: "Samir Adeyemi",
          date: samirBlock.date,
          startMinutes,
          duration: 30,
        }),
      );
    }
  }
  return holds;
}

export function createPreviewStore(now = new Date()): WeeklineStore {
  const today = dateKeyInZone(now, TIMEZONE);
  const thisMonday = mondayOnOrBefore(today);
  const nextMonday = addDays(thisMonday, 7);
  const blocks = [...materialize(thisMonday, THIS_WEEK, "preview"), ...materialize(nextMonday, NEXT_WEEK, "preview")];
  const upcoming = blocks
    .filter((block) => zonedDateTimeToUtc(block.date, block.endMinutes, TIMEZONE).getTime() > now.getTime() + 45 * 60_000)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes);

  return {
    version: 1,
    practice: {
      id: "practice-northline",
      name: "Northline Family Medicine",
      timezone: TIMEZONE,
      phone: "(410) 555-0148",
      address: "410 Pier Street, Baltimore, MD",
      slotMinutes: 20,
      leadMinutes: 30,
    },
    providers: [
      { id: "prov-shah", name: "Amira Shah, MD", specialty: "Family medicine" },
      { id: "prov-ellis", name: "Jonah Ellis, MD", specialty: "Pediatrics" },
      { id: "prov-ortiz", name: "Maya Ortiz, NP", specialty: "Women's health" },
    ],
    locations: [
      {
        id: "loc-harbor",
        name: "Harbor Office",
        address: "410 Pier Street, Baltimore",
        phone: "(410) 555-0148",
        color: "#0f6e6b",
      },
      {
        id: "loc-ridge",
        name: "Ridge Clinic",
        address: "88 Summit Avenue, Towson",
        phone: "(410) 555-0172",
        color: "#b8612e",
      },
      {
        id: "loc-lincoln",
        name: "Lincoln School clinic",
        address: "15 Schoolhouse Road, Baltimore",
        phone: "(410) 555-0190",
        color: "#2f4d8a",
      },
    ],
    reasons: [
      {
        id: "reason-new",
        name: "New patient visit",
        durationMinutes: 40,
        modes: ["InOffice"],
        description: "First visit at whichever office that clinician is posted to.",
      },
      {
        id: "reason-follow",
        name: "Follow-up",
        durationMinutes: 20,
        modes: ["InOffice", "Telehealth"],
        description: "A short return visit, in the office or by video when video hours are posted.",
      },
      {
        id: "reason-well",
        name: "Well-child visit",
        durationMinutes: 30,
        modes: ["InOffice"],
        description: "Checkup where pediatrics is posted that day, including the school clinic.",
      },
      {
        id: "reason-video",
        name: "Video visit",
        durationMinutes: 20,
        modes: ["Telehealth"],
        description: "Only during hours marked as video. Those hours move week to week too.",
      },
    ],
    reasonModes: {},
    blocks,
    patients: [
      {
        id: "pat-elena",
        firstName: "Elena",
        lastName: "Vasquez",
        dob: "1988-04-12",
        phone: "(410) 555-0119",
        email: "elena.vasquez@example.com",
      },
      {
        id: "pat-samir",
        firstName: "Samir",
        lastName: "Adeyemi",
        dob: "2014-02-02",
        phone: "(410) 555-0164",
        email: "samir.adeyemi@example.com",
      },
    ],
    appointments: previewHolds(upcoming, now),
  };
}
