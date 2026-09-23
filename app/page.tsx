import { BookingWidget } from "@/components/booking-widget";
import { SiteHeader } from "@/components/site-header";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 md:px-6">
        <BookingWidget />
      </main>
    </>
  );
}
