import type { OpenSlot, ScheduleBlock, VisitMode } from "@/lib/types";
import { addDays, compareDates, zonedDateTimeToUtc } from "@/lib/time";

export type BusySpan = {
  providerId: string;
  startMs: number;
  endMs: number;
  status: string;
};

const RELEASED = new Set(["cancelled", "canceled", "noshow", "no-show", "no show"]);

export function isBlockingStatus(status: string): boolean {
  const key = status.trim().toLowerCase().replace(/\s+/g, " ");
  return !RELEASED.has(key);
}

export function rangesOverlap(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && end > otherStart;
}

function blockKey(block: ScheduleBlock): string {
  return `${block.providerId}|${block.mode}|${block.locationId ?? ""}|${block.date}`;
}

/** Join abutting blocks so a visit can start near the end of the first stretch. Different places stay separate. */
export function mergeBlocks(blocks: ScheduleBlock[]): ScheduleBlock[] {
  const groups = new Map<string, ScheduleBlock[]>();
  for (const block of blocks) {
    const key = blockKey(block);
    const list = groups.get(key) ?? [];
    list.push(block);
    groups.set(key, list);
  }
  const merged: ScheduleBlock[] = [];
  for (const list of groups.values()) {
    const ordered = [...list].sort((a, b) => a.startMinutes - b.startMinutes);
    let current = { ...ordered[0] };
    for (const next of ordered.slice(1)) {
      if (next.startMinutes <= current.endMinutes) {
        current.endMinutes = Math.max(current.endMinutes, next.endMinutes);
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
  }
  return merged;
}

export function computeOpenSlots(input: {
  blocks: ScheduleBlock[];
  busy: BusySpan[];
  fromDate: string;
  toDate: string;
  durationMinutes: number;
  stepMinutes: number;
  timeZone: string;
  nowMs: number;
  leadMinutes: number;
  providerId?: string;
  locationId?: string;
  mode?: VisitMode;
}): OpenSlot[] {
  const earliest = input.nowMs + input.leadMinutes * 60_000;
  const step = Math.max(5, input.stepMinutes);
  const duration = input.durationMinutes;
  const slots: OpenSlot[] = [];

  const blocks = mergeBlocks(
    input.blocks.filter((block) => {
      if (compareDates(block.date, input.fromDate) < 0 || compareDates(block.date, input.toDate) > 0) return false;
      if (input.providerId && block.providerId !== input.providerId) return false;
      if (input.mode && block.mode !== input.mode) return false;
      if (input.locationId && block.locationId !== input.locationId) return false;
      if (block.endMinutes - block.startMinutes < duration) return false;
      return true;
    }),
  );

  for (const block of blocks) {
    const providerBusy = input.busy.filter(
      (span) => span.providerId === block.providerId && isBlockingStatus(span.status),
    );
    for (let minute = block.startMinutes; minute + duration <= block.endMinutes; minute += step) {
      const start = zonedDateTimeToUtc(block.date, minute, input.timeZone);
      const end = zonedDateTimeToUtc(block.date, minute + duration, input.timeZone);
      const startMs = start.getTime();
      const endMs = end.getTime();
      if (startMs < earliest) continue;
      const taken = providerBusy.some((span) => rangesOverlap(startMs, endMs, span.startMs, span.endMs));
      if (taken) continue;
      slots.push({
        start: start.toISOString(),
        end: end.toISOString(),
        date: block.date,
        startMinutes: minute,
        providerId: block.providerId,
        locationId: block.locationId,
        mode: block.mode,
      });
    }
  }

  slots.sort((a, b) => a.start.localeCompare(b.start) || a.providerId.localeCompare(b.providerId));
  return slots;
}

export function eachDate(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  let cursor = fromDate;
  while (compareDates(cursor, toDate) <= 0) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}
