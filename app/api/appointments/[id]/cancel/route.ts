import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { cancelVisit } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
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
