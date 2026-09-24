// Stored for later. These handlers are not mounted under app/api, so the site has no lookup, cancel, or reschedule calls.
// To turn them on, export them again from:
//   app/api/appointments/route.ts as GET
//   app/api/appointments/[id]/cancel/route.ts as POST
//   app/api/appointments/[id]/reschedule/route.ts as POST

import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { cancelVisit, lookupVisits, rescheduleVisit } from "@/lib/service";
import type { VisitMode } from "@/lib/types";

export async function lookupAppointments(request: Request) {
  try {
    const url = new URL(request.url);
    const lookup = await lookupVisits({
      firstName: url.searchParams.get("firstName") ?? "",
      lastName: url.searchParams.get("lastName") ?? "",
      dob: url.searchParams.get("dob") ?? "",
      patientId: url.searchParams.get("patientId") || undefined,
    });
    return NextResponse.json(lookup);
  } catch (error) {
    return fail(error);
  }
}

export async function cancelAppointmentRoute(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { firstName?: string; lastName?: string; dob?: string; patientId?: string };
    const visit = await cancelVisit(id, {
      firstName: body.firstName ?? "",
      lastName: body.lastName ?? "",
      dob: body.dob ?? "",
      patientId: body.patientId,
    });
    return NextResponse.json({ visit });
  } catch (error) {
    return fail(error);
  }
}

export async function rescheduleAppointmentRoute(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      start?: string;
      providerId?: string;
      locationId?: string | null;
      mode?: VisitMode;
      firstName?: string;
      lastName?: string;
      dob?: string;
      patientId?: string;
    };
    const visit = await rescheduleVisit(
      id,
      {
        firstName: body.firstName ?? "",
        lastName: body.lastName ?? "",
        dob: body.dob ?? "",
        patientId: body.patientId,
      },
      {
        start: body.start ?? "",
        providerId: body.providerId ?? "",
        locationId: body.locationId ?? null,
        mode: body.mode === "Telehealth" ? "Telehealth" : "InOffice",
      },
    );
    return NextResponse.json({ visit });
  } catch (error) {
    return fail(error);
  }
}
