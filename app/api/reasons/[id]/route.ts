import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { setReasonModes } from "@/lib/service";
import type { VisitMode } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { modes?: VisitMode[] };
    const modes = (body.modes ?? []).filter((mode): mode is VisitMode => mode === "InOffice" || mode === "Telehealth");
    await setReasonModes(id, modes);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
