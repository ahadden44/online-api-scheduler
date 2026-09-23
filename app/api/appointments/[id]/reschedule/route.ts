import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { rescheduleVisit } from "@/lib/service";
import type { VisitMode } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
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
