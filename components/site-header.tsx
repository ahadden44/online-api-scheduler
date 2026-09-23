import Link from "next/link";

export function SiteHeader({ staff = false }: { staff?: boolean }) {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 md:px-6">
      <Link href="/" className="group flex items-baseline gap-3">
        <span className="font-heading text-2xl tracking-tight text-foreground">Weekline</span>
        {staff ? <span className="hidden text-sm text-muted-foreground sm:inline">Staff hours</span> : null}
      </Link>
      {staff ? (
        <Link href="/" className="rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-border hover:bg-secondary">
          Patient view
        </Link>
      ) : null}
    </header>
  );
}
