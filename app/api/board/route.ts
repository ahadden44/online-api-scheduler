import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { boardForWeek } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const result = await boardForWeek(url.searchParams.get("week") ?? "");
    return NextResponse.json(result);
  } catch (error) {
    return fail(error);
  }
}
