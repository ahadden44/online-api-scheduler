import { NextResponse } from "next/server";
import { requestIsStaff, staffCode } from "@/lib/staff-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json({
    configured: Boolean(staffCode()),
    signedIn: requestIsStaff(request.headers.get("cookie")),
  });
}
