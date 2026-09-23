import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { searchAvailability } from "@/lib/service";
import type { VisitMode } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode");
    const result = await searchAvailability({
      from: url.searchParams.get("from") ?? "",
      to: url.searchParams.get("to") ?? "",
      reasonId: url.searchParams.get("reasonId") ?? "",
      providerId: url.searchParams.get("providerId") || undefined,
      locationId: url.searchParams.get("locationId") || undefined,
      mode: mode === "InOffice" || mode === "Telehealth" ? (mode as VisitMode) : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return fail(error);
  }
}
