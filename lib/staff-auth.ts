import { createHmac, timingSafeEqual } from "node:crypto";
import { ScheduleError } from "@/lib/service";

export const STAFF_COOKIE = "weekline_staff";

export function staffCode(): string | null {
  const code = process.env.STAFF_CODE?.trim();
  return code ? code : null;
}

export function codesMatch(input: string, expected: string): boolean {
  const left = createHmac("sha256", "weekline-staff-login").update(input).digest();
  const right = createHmac("sha256", "weekline-staff-login").update(expected).digest();
  return timingSafeEqual(left, right);
}

export function staffCookieValue(code: string): string {
  return createHmac("sha256", code).update("weekline-staff-v1").digest("base64url");
}

export function requestIsStaff(cookieHeader: string | null): boolean {
  const code = staffCode();
  if (!code || !cookieHeader) return false;
  const expected = staffCookieValue(code);
  const pair = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${STAFF_COOKIE}=`));
  if (!pair) return false;
  const value = decodeURIComponent(pair.slice(STAFF_COOKIE.length + 1));
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function assertStaff(request: Request): void {
  if (!staffCode()) throw new ScheduleError("Staff access is not configured.", 503);
  if (!requestIsStaff(request.headers.get("cookie"))) {
    throw new ScheduleError("Enter the staff code to change hours.", 401);
  }
}

export function cookieIsSecure(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0]?.trim() === "https";
  return new URL(request.url).protocol === "https:";
}
