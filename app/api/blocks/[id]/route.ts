import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { removeBlock, saveBlock } from "@/lib/service";
import type { VisitMode } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      providerId?: string;
      locationId?: string | null;
      mode?: VisitMode;
      date?: string;
      startMinutes?: number;
      endMinutes?: number;
    };
    const block = await saveBlock({
      id,
      providerId: body.providerId ?? "",
      locationId: body.locationId ?? null,
      mode: body.mode === "Telehealth" ? "Telehealth" : "InOffice",
      date: body.date ?? "",
      startMinutes: Number(body.startMinutes),
      endMinutes: Number(body.endMinutes),
    });
    return NextResponse.json({ block });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await removeBlock(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
