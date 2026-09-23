import { SiteHeader } from "@/components/site-header";
import { WeekBoard } from "@/components/week-board";

export default function BoardPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 md:px-6">
        <WeekBoard />
      </main>
    </>
  );
}
