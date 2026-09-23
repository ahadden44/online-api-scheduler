import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 md:px-6">
      <Link href="/" className="group flex items-baseline gap-3">
        <span className="font-heading text-2xl tracking-tight text-foreground">Weekline</span>
        <span className="hidden text-sm text-muted-foreground sm:inline">Posted hours, not office hours</span>
      </Link>
      <nav className="flex items-center gap-1 rounded-full bg-card p-1 ring-1 ring-border">
        <Link href="/" className="rounded-full px-3 py-1.5 text-sm font-medium hover:bg-secondary">
          Book
        </Link>
        <Link href="/board" className="rounded-full px-3 py-1.5 text-sm font-medium hover:bg-secondary">
          Week board
        </Link>
      </nav>
    </header>
  );
}
