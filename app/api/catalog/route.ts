import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { loadWorking, toCatalog } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const working = await loadWorking();
    return NextResponse.json(toCatalog(working));
  } catch (error) {
    return fail(error);
  }
}
