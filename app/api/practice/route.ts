import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { updatePracticeSettings } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { slotMinutes?: number; leadMinutes?: number };
    const practice = await updatePracticeSettings(body);
    return NextResponse.json({ practice });
  } catch (error) {
    return fail(error);
  }
}
