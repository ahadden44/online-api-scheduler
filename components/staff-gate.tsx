"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function StaffGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "locked" | "open" | "unconfigured">("loading");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/staff/session")
      .then((response) => response.json())
      .then((body: { configured?: boolean; signedIn?: boolean }) => {
        if (!body.configured) setStatus("unconfigured");
        else setStatus(body.signedIn ? "open" : "locked");
      })
      .catch(() => setStatus("locked"));
  }, []);

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error || "That code is not right.");
        return;
      }
      setCode("");
      setStatus("open");
    } catch {
      setError("The staff page could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  async function lock() {
    await fetch("/api/staff/logout", { method: "POST" });
    setStatus("locked");
  }

  if (status === "loading") {
    return <section className="rounded-3xl bg-card p-8 ring-1 ring-border">Checking staff access…</section>;
  }

  if (status === "unconfigured") {
    return (
      <section className="rounded-3xl bg-card p-8 ring-1 ring-border">
        <h1 className="text-3xl">Staff hours are locked</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          Set STAFF_CODE on the scheduler before anyone can post hours. The code is not stored in the practice website.
        </p>
      </section>
    );
  }

  if (status === "locked") {
    return (
      <section className="rounded-3xl bg-card p-8 ring-1 ring-border">
        <p className="text-xs font-medium tracking-[0.16em] text-primary uppercase">Staff only</p>
        <h1 className="mt-1 text-3xl">Enter the staff code</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          This page changes the hours patients can book. The address is not a secret by itself.
        </p>
        <form className="mt-6 max-w-sm space-y-3" onSubmit={unlock}>
          <div className="space-y-2">
            <Label htmlFor="staff-code">Staff code</Label>
            <Input id="staff-code" type="password" autoComplete="current-password" value={code} onChange={(event) => setCode(event.target.value)} />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy || code.trim().length === 0}>
            {busy ? "Checking…" : "Open the week board"}
          </Button>
        </form>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={lock}>
          Sign out
        </Button>
      </div>
      {children}
    </div>
  );
}
