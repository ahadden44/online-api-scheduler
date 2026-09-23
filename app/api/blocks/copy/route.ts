import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { assertStaff } from "@/lib/staff-auth";
import { copyWeek } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertStaff(request);
    const body = (await request.json()) as { from?: string; to?: string; replace?: boolean };
    const count = await copyWeek(body.from ?? "", body.to ?? "", Boolean(body.replace));
    return NextResponse.json({ count });
  } catch (error) {
    return fail(error);
  }
}
