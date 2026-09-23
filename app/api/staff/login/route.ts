import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { ScheduleError } from "@/lib/service";
import { codesMatch, cookieIsSecure, staffCode, staffCookieValue, STAFF_COOKIE } from "@/lib/staff-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const expected = staffCode();
    if (!expected) throw new ScheduleError("Staff access is not configured.", 503);
    const body = (await request.json().catch(() => ({}))) as { code?: string };
    if (!codesMatch(body.code?.trim() ?? "", expected)) throw new ScheduleError("That code is not right.", 401);
    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: STAFF_COOKIE,
      value: staffCookieValue(expected),
      httpOnly: true,
      sameSite: "lax",
      secure: cookieIsSecure(request),
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
    return response;
  } catch (error) {
    return fail(error);
  }
}
