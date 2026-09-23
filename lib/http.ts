import { NextResponse } from "next/server";
import { ScheduleError } from "@/lib/service";

export function fail(error: unknown) {
  if (error instanceof ScheduleError) {
    return NextResponse.json({ error: error.message, matches: error.matches ?? null }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Something went wrong talking to the schedule.";
  const status = /authenticate|authorized|customer key|password/i.test(message) ? 401 : 502;
  return NextResponse.json({ error: message }, { status });
}
