"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addDays, dateKeyInZone, formatInstant, formatLongDate, formatMinutes, formatMonthDay, mondayOnOrBefore, weekdayName } from "@/lib/time";
import type { BookedVisit } from "@/lib/service";
import type { Catalog, OpenSlot, SampleChart, ScheduleBlock, VisitReason } from "@/lib/types";

const VIDEO = "#6d4d86";

type Place =
  | { kind: "location"; id: string }
  | { kind: "video" }
  | { kind: "any" };

type PatientForm = {
  firstName: string;
  lastName: string;
  dob: string;
  phone: string;
  email: string;
  notes: string;
  patientId?: string;
};

type ApiError = Error & { matches?: { id: string; label: string }[] | null };

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { error?: string; matches?: ApiError["matches"] };
  if (!response.ok) {
    const error = new Error(body.error || "The schedule could not be loaded.") as ApiError;
    error.matches = body.matches;
    throw error;
  }
  return body as T;
}

function placeMatches(slot: OpenSlot, place: Place | null): boolean {
  if (!place || place.kind === "any") return true;
  if (place.kind === "video") return slot.mode === "Telehealth";
  return slot.mode === "InOffice" && slot.locationId === place.id;
}

export function BookingWidget() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"book" | "manage">("book");
  const [step, setStep] = useState<"visit" | "place" | "when" | "details" | "done">("visit");
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [slots, setSlots] = useState<OpenSlot[]>([]);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [weekIndex, setWeekIndex] = useState(0);
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<OpenSlot | null>(null);
  const [form, setForm] = useState<PatientForm>({ firstName: "", lastName: "", dob: "", phone: "", email: "", notes: "" });
  const [matches, setMatches] = useState<{ id: string; label: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [visit, setVisit] = useState<BookedVisit | null>(null);

  useEffect(() => {
    fetch("/api/catalog")
      .then((response) => readJson<Catalog>(response))
      .then(setCatalog)
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  const reason = catalog?.reasons.find((item) => item.id === reasonId) ?? null;
  const today = catalog ? dateKeyInZone(new Date(), catalog.practice.timezone) : "";
  const thisMonday = today ? mondayOnOrBefore(today) : "";
  const weekMonday = thisMonday ? addDays(thisMonday, weekIndex * 7) : "";

  const scheduleKey = reasonId && thisMonday ? `${reasonId}:${thisMonday}` : null;
  const loadingTimes = Boolean(scheduleKey && loadedKey !== scheduleKey && !scheduleError);

  useEffect(() => {
    if (!scheduleKey || !thisMonday || !reasonId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      from: thisMonday,
      to: addDays(thisMonday, 20),
      reasonId,
    });
    fetch(`/api/availability?${params}`, { signal: controller.signal })
      .then((response) => readJson<{ blocks: ScheduleBlock[]; slots: OpenSlot[] }>(response))
      .then((result) => {
        setBlocks(result.blocks);
        setSlots(result.slots);
        setLoadedKey(scheduleKey);
        setScheduleError(null);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setScheduleError(error.message);
      });
    return () => controller.abort();
  }, [scheduleKey, thisMonday, reasonId]);

  const weekDates = useMemo(() => (weekMonday ? Array.from({ length: 7 }, (_, index) => addDays(weekMonday, index)) : []), [weekMonday]);

  const visibleSlots = slots.filter((slot) => placeMatches(slot, place));
  const activeBlocks = loadingTimes ? [] : blocks;
  const activeSlots = loadingTimes ? [] : visibleSlots;
  const selectedDate = (() => {
    if (pickedDate && weekDates.includes(pickedDate)) return pickedDate;
    const openOn = (date: string) => activeSlots.some((slot) => slot.date === date);
    return weekDates.find((date) => date >= today && openOn(date)) ?? weekDates.find((date) => date >= today) ?? weekDates[0] ?? null;
  })();

  if (loadError) {
    return <Panel note="The schedule did not load">{loadError}</Panel>;
  }
  if (!catalog) {
    return <Panel note="Loading the practice">Checking posted hours…</Panel>;
  }

  function chooseReason(next: VisitReason) {
    setReasonId(next.id);
    setPlace(null);
    setSelectedSlot(null);
    setPickedDate(null);
    setScheduleError(null);
    setWeekIndex(0);
    setStep("place");
  }

  function choosePlace(next: Place) {
    setPlace(next);
    setSelectedSlot(null);
    setStep("when");
  }

  async function submitBooking() {
    if (!selectedSlot || !reason) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await readJson<{ visit: BookedVisit }>(
        await fetch("/api/appointments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            start: selectedSlot.start,
            providerId: selectedSlot.providerId,
            locationId: selectedSlot.locationId,
            mode: selectedSlot.mode,
            reasonId: reason.id,
            notes: form.notes,
            patient: form,
          }),
        }),
      );
      setVisit(result.visit);
      setStep("done");
      setMatches([]);
    } catch (error) {
      const api = error as ApiError;
      setFormError(api.message);
      setMatches(api.matches ?? []);
    } finally {
      setSubmitting(false);
    }
  }

  const providerById = new Map(catalog.providers.map((provider) => [provider.id, provider]));
  const locationById = new Map(catalog.locations.map((location) => [location.id, location]));

  return (
    <section className="overflow-hidden rounded-3xl bg-card shadow-[0_20px_60px_-36px_rgba(60,40,10,0.45)] ring-1 ring-border">
      <div className="flex flex-col gap-4 border-b border-border px-5 py-5 md:flex-row md:items-end md:justify-between md:px-8">
        <div>
          <p className="text-xs font-medium tracking-[0.16em] text-primary uppercase">Scheduling</p>
          <h1 className="mt-1 text-3xl text-balance md:text-4xl">{catalog.practice.name}</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Openings follow hours posted for that exact week. A clinician at one office in the morning can be somewhere else after lunch, and next week can be different.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant={panel === "book" ? "default" : "outline"} onClick={() => setPanel("book")}>
            Book a visit
          </Button>
          <Button type="button" variant={panel === "manage" ? "default" : "outline"} onClick={() => setPanel("manage")}>
            Change a visit
          </Button>
        </div>
      </div>

      {catalog.notice ? (
        <p className="border-b border-border bg-secondary/70 px-5 py-3 text-sm text-secondary-foreground md:px-8">{catalog.notice}</p>
      ) : null}

      {panel === "manage" ? (
        <ManagePanel catalog={catalog} />
      ) : step === "done" && visit ? (
        <Done
          visit={catalog ? visit : visit}
          timezone={catalog.practice.timezone}
          onAgain={() => {
            setStep("visit");
            setVisit(null);
            setSelectedSlot(null);
            setForm({ firstName: "", lastName: "", dob: "", phone: "", email: "", notes: "" });
          }}
        />
      ) : (
        <div className="grid gap-0 lg:grid-cols-[280px_1fr]">
          <aside className="border-b border-border px-5 py-5 lg:border-r lg:border-b-0 md:px-8 lg:px-6">
            <ol className="space-y-3 text-sm">
              <StepMark n={1} label="Visit" active={step === "visit"} done={step !== "visit"} value={reason?.name} />
              <StepMark n={2} label="Place" active={step === "place"} done={step === "when" || step === "details"} value={placeLabel(place, catalog)} />
              <StepMark
                n={3}
                label="Time"
                active={step === "when"}
                done={step === "details"}
                value={selectedSlot ? formatInstant(selectedSlot.start, catalog.practice.timezone) : undefined}
              />
              <StepMark n={4} label="Your details" active={step === "details"} done={false} />
            </ol>
            {reason ? (
              <p className="mt-6 text-sm text-muted-foreground">
                {reason.durationMinutes} minutes. {reason.description}
              </p>
            ) : null}
          </aside>

          <div className="px-5 py-5 md:px-8 md:py-7">
            {step === "visit" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {catalog.reasons.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => chooseReason(item)}
                    className="rounded-2xl bg-background p-4 text-left ring-1 ring-border transition hover:ring-primary"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{item.name}</span>
                      <Badge variant="secondary">{item.durationMinutes} min</Badge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
                    <p className="mt-3 text-xs tracking-wide text-primary uppercase">
                      {item.modes.map((mode) => (mode === "Telehealth" ? "Video" : "In office")).join(" · ")}
                    </p>
                  </button>
                ))}
              </div>
            ) : null}

            {step === "place" && reason ? (
              <PlaceStep
                catalog={catalog}
                reason={reason}
                blocks={activeBlocks.filter((block) => block.date >= thisMonday && block.date <= addDays(thisMonday, 6))}
                loading={loadingTimes}
                error={scheduleError}
                onBack={() => setStep("visit")}
                onChoose={choosePlace}
              />
            ) : null}

            {step === "when" && reason && place ? (
              <WhenStep
                catalog={catalog}
                blocks={activeBlocks}
                slots={activeSlots}
                weekDates={weekDates}
                weekIndex={weekIndex}
                selectedDate={selectedDate}
                selectedSlot={selectedSlot}
                today={today}
                loading={loadingTimes}
                error={scheduleError}
                providerById={providerById}
                locationById={locationById}
                onWeek={setWeekIndex}
                onDate={setPickedDate}
                onSlot={setSelectedSlot}
                onBack={() => setStep("place")}
                onContinue={() => selectedSlot && setStep("details")}
              />
            ) : null}

            {step === "details" && selectedSlot && reason ? (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitBooking();
                }}
              >
                <div className="rounded-2xl bg-secondary/60 p-4 text-sm">
                  <p className="font-medium">{reason.name}</p>
                  <p className="mt-1">{formatInstant(selectedSlot.start, catalog.practice.timezone)}</p>
                  <p className="text-muted-foreground">
                    {providerById.get(selectedSlot.providerId)?.name} · {slotPlace(selectedSlot, catalog)}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="First name" value={form.firstName} onChange={(firstName) => setForm({ ...form, firstName })} />
                  <Field label="Last name" value={form.lastName} onChange={(lastName) => setForm({ ...form, lastName })} />
                  <Field label="Date of birth" type="date" value={form.dob} onChange={(dob) => setForm({ ...form, dob })} />
                  <Field label="Mobile phone" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
                  <div className="sm:col-span-2">
                    <Field label="Email" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Note for the practice</Label>
                  <Textarea id="notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Optional" />
                </div>
                {matches.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm">More than one chart matches. Choose yours.</p>
                    <div className="flex flex-wrap gap-2">
                      {matches.map((match) => (
                        <Button
                          key={match.id}
                          type="button"
                          variant={form.patientId === match.id ? "default" : "outline"}
                          onClick={() => setForm({ ...form, patientId: match.id })}
                        >
                          {match.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => setStep("when")}>
                    Back
                  </Button>
                  <Button type="submit" size="lg" disabled={submitting}>
                    {submitting ? "Booking…" : "Book this time"}
                  </Button>
                </div>
                {catalog.mode === "preview" ? (
                  <p className="text-xs text-muted-foreground">
                    Preview only writes to this demo. Try an existing chart with Elena Vasquez, born 1988-04-12.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">This creates the appointment in Tebra.</p>
                )}
              </form>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

function placeLabel(place: Place | null, catalog: Catalog): string | undefined {
  if (!place) return undefined;
  if (place.kind === "any") return "Any posted place";
  if (place.kind === "video") return "Video visit";
  return catalog.locations.find((location) => location.id === place.id)?.name;
}

function slotPlace(slot: OpenSlot, catalog: Catalog): string {
  if (slot.mode === "Telehealth") return "Video visit";
  return catalog.locations.find((location) => location.id === slot.locationId)?.name ?? "Office";
}

function StepMark({ n, label, active, done, value }: { n: number; label: string; active: boolean; done: boolean; value?: string }) {
  return (
    <li className={active ? "text-foreground" : "text-muted-foreground"}>
      <div className="flex items-center gap-2">
        <span className={`flex size-6 items-center justify-center rounded-full text-xs ${active || done ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
          {n}
        </span>
        <span className="font-medium">{label}</span>
      </div>
      {value ? <p className="mt-1 pl-8 text-foreground">{value}</p> : null}
    </li>
  );
}

function Panel({ note, children }: { note: string; children: string }) {
  return (
    <section className="rounded-3xl bg-card p-8 ring-1 ring-border">
      <p className="text-xs tracking-[0.16em] text-primary uppercase">{note}</p>
      <p className="mt-2 text-lg">{children}</p>
    </section>
  );
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

function PlaceStep({
  catalog,
  reason,
  blocks,
  loading,
  error,
  onBack,
  onChoose,
}: {
  catalog: Catalog;
  reason: VisitReason;
  blocks: ScheduleBlock[];
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onChoose: (place: Place) => void;
}) {
  const locations = catalog.locations.filter(
    (location) => reason.modes.includes("InOffice") && blocks.some((block) => block.mode === "InOffice" && block.locationId === location.id),
  );
  const video = reason.modes.includes("Telehealth") && blocks.some((block) => block.mode === "Telehealth");
  const empty = !loading && locations.length === 0 && !video;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl">Where should this visit happen?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Places appear only if someone is posted there this week. Empty days stay empty.</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Reading this week’s posted hours…</p> : null}
      {empty ? (
        <p className="rounded-2xl bg-secondary p-4 text-sm">
          Nothing is posted for {reason.name} this week. The practice does not fill the gap with repeating office hours.
        </p>
      ) : null}
      <div className="grid gap-3">
        {locations.map((location) => (
          <PlaceCard
            key={location.id}
            color={location.color}
            title={location.name}
            detail={location.address}
            summary={summarize(blocks.filter((block) => block.locationId === location.id))}
            onClick={() => onChoose({ kind: "location", id: location.id })}
          />
        ))}
        {video ? (
          <PlaceCard
            color={VIDEO}
            title="Video visit"
            detail="From wherever that clinician’s video hours are posted"
            summary={summarize(blocks.filter((block) => block.mode === "Telehealth"))}
            onClick={() => onChoose({ kind: "video" })}
          />
        ) : null}
        {!empty && !loading ? (
          <button type="button" className="text-left text-sm text-primary underline-offset-4 hover:underline" onClick={() => onChoose({ kind: "any" })}>
            Show every posted opening
          </button>
        ) : null}
      </div>
      <Button type="button" variant="outline" onClick={onBack}>
        Back
      </Button>
    </div>
  );
}

function PlaceCard({ color, title, detail, summary, onClick }: { color: string; title: string; detail: string; summary: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-2xl bg-background p-4 text-left ring-1 ring-border transition hover:ring-primary">
      <div className="flex items-start gap-3">
        <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: color }} />
        <span>
          <span className="block font-medium">{title}</span>
          <span className="mt-1 block text-sm text-muted-foreground">{detail}</span>
          <span className="mt-2 block text-sm">{summary}</span>
        </span>
      </div>
    </button>
  );
}

function summarize(blocks: ScheduleBlock[]): string {
  if (!blocks.length) return "No hours this week";
  return blocks
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)
    .map((block) => `${weekdayName(block.date).slice(0, 3)} ${formatMinutes(block.startMinutes)}–${formatMinutes(block.endMinutes)}`)
    .join(" · ");
}

function WhenStep(props: {
  catalog: Catalog;
  blocks: ScheduleBlock[];
  slots: OpenSlot[];
  weekDates: string[];
  weekIndex: number;
  selectedDate: string | null;
  selectedSlot: OpenSlot | null;
  today: string;
  loading: boolean;
  error: string | null;
  providerById: Map<string, { id: string; name: string; specialty: string }>;
  locationById: Map<string, { id: string; name: string; color: string }>;
  onWeek: (index: number) => void;
  onDate: (date: string) => void;
  onSlot: (slot: OpenSlot) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const dayBlocks = props.blocks.filter((block) => block.date === props.selectedDate);
  const daySlots = props.slots.filter((slot) => slot.date === props.selectedDate);
  const groups = new Map<string, OpenSlot[]>();
  for (const slot of daySlots) {
    const key = `${slot.providerId}|${slot.mode}|${slot.locationId ?? ""}`;
    const list = groups.get(key) ?? [];
    list.push(slot);
    groups.set(key, list);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl">Pick a posted time</h2>
          <p className="mt-1 text-sm text-muted-foreground">Taken appointments from Tebra are already removed. Days without a post stay closed.</p>
        </div>
        <div className="flex gap-1">
          {["This week", "Next week", "Week after"].map((label, index) => (
            <Button key={label} type="button" size="sm" variant={props.weekIndex === index ? "default" : "outline"} onClick={() => props.onWeek(index)}>
              {label}
            </Button>
          ))}
        </div>
      </div>
      {props.error ? <p className="text-sm text-destructive">{props.error}</p> : null}
      <div className="grid grid-cols-7 gap-1">
        {props.weekDates.map((date) => {
          const posted = props.blocks.some((block) => block.date === date);
          const open = props.slots.some((slot) => slot.date === date);
          const past = date < props.today;
          return (
            <button
              key={date}
              type="button"
              onClick={() => props.onDate(date)}
              className={`rounded-xl px-1 py-2 text-center ring-1 ${props.selectedDate === date ? "bg-primary text-primary-foreground ring-primary" : "bg-background ring-border"}`}
            >
              <span className="block text-[10px] tracking-wide uppercase">{weekdayName(date).slice(0, 3)}</span>
              <span className="block text-sm font-medium">{formatMonthDay(date).split(" ")[1]}</span>
              <span className="mt-1 block text-[10px]">{past ? "Passed" : open ? "Open" : posted ? "Full" : "Closed"}</span>
            </button>
          );
        })}
      </div>
      {props.loading ? <p className="text-sm text-muted-foreground">Checking appointments…</p> : null}
      {props.selectedDate && dayBlocks.length === 0 ? (
        <p className="rounded-2xl bg-secondary p-4 text-sm">
          {formatLongDate(props.selectedDate)} has no posted hours. Weekline will not invent openings from a repeating office template.
        </p>
      ) : null}
      {props.selectedDate && dayBlocks.length > 0 && groups.size === 0 ? (
        <p className="rounded-2xl bg-secondary p-4 text-sm">The hours posted that day are already booked or have passed.</p>
      ) : null}
      <div className="space-y-4">
        {[...groups.entries()].map(([key, group]) => {
          const sample = group[0];
          const provider = props.providerById.get(sample.providerId);
          const location = sample.locationId ? props.locationById.get(sample.locationId) : undefined;
          const color = sample.mode === "Telehealth" ? VIDEO : location?.color ?? "#0f6e6b";
          return (
            <div key={key}>
              <div className="mb-2 flex items-center gap-2 text-sm">
                <span className="size-2.5 rounded-full" style={{ background: color }} />
                <span className="font-medium">{provider?.name}</span>
                <span className="text-muted-foreground">{provider?.specialty}</span>
                <span className="text-muted-foreground">· {sample.mode === "Telehealth" ? "Video" : location?.name}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {group.map((slot) => (
                  <button
                    key={`${slot.start}-${slot.providerId}`}
                    type="button"
                    onClick={() => props.onSlot(slot)}
                    className={`rounded-full px-3 py-1.5 text-sm ring-1 ${props.selectedSlot?.start === slot.start && props.selectedSlot.providerId === slot.providerId ? "bg-primary text-primary-foreground ring-primary" : "bg-background ring-border hover:ring-primary"}`}
                  >
                    {formatMinutes(slot.startMinutes)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={props.onBack}>
          Back
        </Button>
        <Button type="button" size="lg" disabled={!props.selectedSlot} onClick={props.onContinue}>
          Continue
        </Button>
      </div>
    </div>
  );
}

function Done({ visit, timezone, onAgain }: { visit: BookedVisit; timezone: string; onAgain: () => void }) {
  return (
    <div className="px-5 py-8 md:px-8">
      <p className="text-xs tracking-[0.16em] text-primary uppercase">You’re on the books</p>
      <h2 className="mt-2 text-3xl">{visit.reasonName}</h2>
      <p className="mt-2 text-lg">{formatInstant(visit.start, timezone)}</p>
      <p className="mt-1 text-muted-foreground">
        {visit.providerName} · {visit.locationName}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{visit.address}</p>
      <p className="mt-4 text-sm">Confirmation {visit.id}</p>
      {visit.practicePhone ? <p className="text-sm text-muted-foreground">Questions: {visit.practicePhone}</p> : null}
      <Button type="button" className="mt-6" variant="outline" onClick={onAgain}>
        Book another visit
      </Button>
    </div>
  );
}

function sampleLine(chart: SampleChart): string {
  return `Preview chart: ${chart.firstName} ${chart.lastName}, ${chart.dob}, has a ${chart.reasonName.toLowerCase()} already on the books.`;
}

function ManagePanel({ catalog }: { catalog: Catalog }) {
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
      setError("This visit does not have a type Weekline can move. Cancel it and book again.");
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
