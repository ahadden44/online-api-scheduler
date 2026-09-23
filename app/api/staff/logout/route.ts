import { NextResponse } from "next/server";
import { STAFF_COOKIE } from "@/lib/staff-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: STAFF_COOKIE, value: "", path: "/", maxAge: 0 });
  return response;
}
