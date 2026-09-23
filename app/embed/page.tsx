import type { Metadata } from "next";
import { EmbedShell } from "@/components/embed-shell";

export const metadata: Metadata = {
  title: "Schedule a visit",
  robots: { index: false, follow: false },
};

export default function EmbedPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-2 py-2">
      <EmbedShell />
    </main>
  );
}
