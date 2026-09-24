import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { bookVisit } from "@/lib/service";
import type { VisitMode } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      start?: string;
      providerId?: string;
      locationId?: string | null;
      mode?: VisitMode;
      reasonId?: string;
      notes?: string;
      insurance?: {
        plan?: string;
        groupId?: string;
        memberId?: string;
        primaryHolder?: string;
        primaryHolderDob?: string;
      };
      patient?: {
        firstName?: string;
        lastName?: string;
        dob?: string;
        phone?: string;
        email?: string;
        patientId?: string;
      };
    };
    const visit = await bookVisit({
      start: body.start ?? "",
      providerId: body.providerId ?? "",
      locationId: body.locationId ?? null,
      mode: body.mode === "Telehealth" ? "Telehealth" : "InOffice",
      reasonId: body.reasonId ?? "",
      notes: body.notes,
      insurance: body.insurance ?? {},
      patient: {
        firstName: body.patient?.firstName ?? "",
        lastName: body.patient?.lastName ?? "",
        dob: body.patient?.dob ?? "",
        phone: body.patient?.phone,
        email: body.patient?.email,
        patientId: body.patient?.patientId,
      },
    });
    return NextResponse.json({ visit });
  } catch (error) {
    return fail(error);
  }
}
