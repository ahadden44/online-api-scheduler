import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { loadCatalog } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await loadCatalog());
  } catch (error) {
    return fail(error);
  }
}
