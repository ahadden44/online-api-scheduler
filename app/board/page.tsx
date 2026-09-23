import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { StaffGate } from "@/components/staff-gate";
import { WeekBoard } from "@/components/week-board";

export const metadata: Metadata = {
  title: "Staff hours",
  robots: { index: false, follow: false },
};

export default function BoardPage() {
  return (
    <>
      <SiteHeader staff />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 md:px-6">
        <StaffGate>
          <WeekBoard />
        </StaffGate>
      </main>
    </>
  );
}
