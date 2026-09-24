"use client";

// Stored for later. Nothing on the site imports this, so patients cannot look up, move, or cancel a visit.
// To turn it on, render <ManageVisit catalog={catalog} /> from the booking page and wire
// lib/manage-visit-routes.ts back into app/api/appointments.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BookedVisit } from "@/lib/service";
import { addDays, dateKeyInZone, formatInstant, mondayOnOrBefore } from "@/lib/time";
import type { Catalog, OpenSlot, SampleChart } from "@/lib/types";

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error || "The schedule could not be loaded.");
  return body as T;
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="h-10" type={type} value={value} onChange={(event) => onChange(event.target.value)} required={type !== "email"} />
    </div>
  );
}

function sampleLine(chart: SampleChart): string {
  return `Preview chart: ${chart.firstName} ${chart.lastName}, ${chart.dob}, has a ${chart.reasonName.toLowerCase()} already on the books.`;
}

export function ManageVisit({ catalog }: { catalog: Catalog }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", dob: "" });
  const [result, setResult] = useState<{ matched: boolean; visits: BookedVisit[] } | null>(null);
  const [samples, setSamples] = useState(catalog.sampleCharts);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [moving, setMoving] = useState<BookedVisit | null>(null);
  const [options, setOptions] = useState<OpenSlot[]>([]);
  const [busy, setBusy] = useState(false);

  function dropSampleIfEmpty(visits: BookedVisit[]) {
    if (visits.length > 0) return;
    const first = form.firstName.trim().toLowerCase();
    const last = form.lastName.trim().toLowerCase();
    setSamples((current) =>
      current.filter(
        (chart) => chart.firstName.toLowerCase() !== first || chart.lastName.toLowerCase() !== last || chart.dob !== form.dob,
      ),
    );
  }

  async function lookup(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMoving(null);
    try {
      const params = new URLSearchParams(form);
      const lookupResult = await readJson<{ matched: boolean; visits: BookedVisit[] }>(await fetch(`/api/appointments?${params}`));
      setResult(lookupResult);
      if (lookupResult.matched) dropSampleIfEmpty(lookupResult.visits);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function cancel(visit: BookedVisit) {
    setBusy(true);
    setError(null);
    try {
      await readJson(await fetch(`/api/appointments/${visit.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      }));
      const remaining = result?.visits.filter((item) => item.id !== visit.id) ?? [];
      setResult({ matched: result?.matched ?? true, visits: remaining });
      dropSampleIfEmpty(remaining);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function startMove(visit: BookedVisit) {
    setMoving(visit);
    setError(null);
    const reasonId = visit.reasonId || catalog.reasons.find((reason) => reason.name === visit.reasonName)?.id;
    if (!reasonId) {
      setError("This visit does not have a type MedSlot can move. Cancel it and book again.");
      return;
    }
    const monday = mondayOnOrBefore(dateKeyInZone(new Date(), catalog.practice.timezone));
    const params = new URLSearchParams({ from: monday, to: addDays(monday, 20), reasonId });
    try {
      const result = await readJson<{ slots: OpenSlot[] }>(await fetch(`/api/availability?${params}`));
      setOptions(result.slots.slice(0, 12));
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function moveTo(slot: OpenSlot) {
    if (!moving) return;
    setBusy(true);
    setError(null);
    try {
      const result = await readJson<{ visit: BookedVisit }>(
        await fetch(`/api/appointments/${moving.id}/reschedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, start: slot.start, providerId: slot.providerId, locationId: slot.locationId, mode: slot.mode }),
        }),
      );
      setResult((current) => ({
        matched: current?.matched ?? true,
        visits: current?.visits.map((item) => (item.id === moving.id ? result.visit : item)) ?? [result.visit],
      }));
      setMoving(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 px-5 py-6 md:px-8">
      <h2 className="text-2xl">Find a visit</h2>
      <p className="text-sm text-muted-foreground">Use the name and date of birth on the chart. You can cancel or move it into another posted hour.</p>
      {samples.map((chart) => (
        <p key={`${chart.firstName}-${chart.lastName}-${chart.dob}`} className="text-sm text-muted-foreground">
          {sampleLine(chart)}
        </p>
      ))}
      <form className="grid gap-3 sm:grid-cols-4" onSubmit={lookup}>
        <Field label="First name" value={form.firstName} onChange={(firstName) => setForm({ ...form, firstName })} />
        <Field label="Last name" value={form.lastName} onChange={(lastName) => setForm({ ...form, lastName })} />
        <Field label="Date of birth" type="date" value={form.dob} onChange={(dob) => setForm({ ...form, dob })} />
        <div className="flex items-end">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Looking…" : "Find visits"}
          </Button>
        </div>
      </form>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {result && result.visits.length === 0 ? (
        <p className="text-sm">
          {result.matched ? "That chart is on file, and it has no upcoming visits." : "No chart matched that name and date of birth."}
        </p>
      ) : null}
      <div className="space-y-3">
        {result?.visits.map((item) => (
          <article key={item.id} className="rounded-2xl bg-background p-4 ring-1 ring-border">
            <p className="font-medium">{item.reasonName}</p>
            <p className="text-sm">{formatInstant(item.start, catalog.practice.timezone)}</p>
            <p className="text-sm text-muted-foreground">
              {item.providerName} · {item.locationName}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => startMove(item)}>
                Move
              </Button>
              <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => cancel(item)}>
                Cancel
              </Button>
            </div>
            {moving?.id === item.id ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {options.length === 0 ? <p className="text-sm text-muted-foreground">No other posted hours are open.</p> : null}
                {options.map((slot) => (
                  <Button key={`${slot.start}-${slot.providerId}`} type="button" size="sm" variant="secondary" disabled={busy} onClick={() => moveTo(slot)}>
                    {formatInstant(slot.start, catalog.practice.timezone)}
                  </Button>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
