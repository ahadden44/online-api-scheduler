import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { resetPreview } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await resetPreview();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
