import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { assertStaff } from "@/lib/staff-auth";
import { resetPreview } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertStaff(request);
    await resetPreview();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
