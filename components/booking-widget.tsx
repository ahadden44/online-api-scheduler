"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addDays, dateKeyInZone, formatInstant, formatLongDate, formatMinutes, formatMonthDay, mondayOnOrBefore, weekdayName } from "@/lib/time";
import { CASH_PLAN, INSURANCE_PLANS, readInsurance } from "@/lib/insurance";
import type { BookedVisit } from "@/lib/service";
import type { Catalog, OpenSlot, ScheduleBlock, VisitReason } from "@/lib/types";

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
  insurance: string;
  groupId: string;
  memberId: string;
  primaryHolder: string;
  primaryHolderDob: string;
  patientId?: string;
};

const emptyForm = (): PatientForm => ({
  firstName: "",
  lastName: "",
  dob: "",
  phone: "",
  email: "",
  notes: "",
  insurance: "",
  groupId: "",
  memberId: "",
  primaryHolder: "",
  primaryHolderDob: "",
});

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

function blockMatches(block: ScheduleBlock, place: Place | null): boolean {
  if (!place || place.kind === "any") return true;
  if (place.kind === "video") return block.mode === "Telehealth";
  return block.mode === "InOffice" && block.locationId === place.id;
}

export function BookingWidget() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const [form, setForm] = useState<PatientForm>(emptyForm);
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

  const activeReasonId = reasonId ?? (catalog?.reasons.length === 1 ? catalog.reasons[0].id : null);
  const reason = catalog?.reasons.find((item) => item.id === activeReasonId) ?? null;
  const today = catalog ? dateKeyInZone(new Date(), catalog.practice.timezone) : "";
  const thisMonday = today ? mondayOnOrBefore(today) : "";
  const weekMonday = thisMonday ? addDays(thisMonday, weekIndex * 7) : "";

  const scheduleKey = activeReasonId && thisMonday ? `${activeReasonId}:${thisMonday}` : null;
  const loadingTimes = Boolean(scheduleKey && loadedKey !== scheduleKey && !scheduleError);

  useEffect(() => {
    if (!scheduleKey || !thisMonday || !activeReasonId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      from: thisMonday,
      to: addDays(thisMonday, 20),
      reasonId: activeReasonId,
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
  }, [scheduleKey, thisMonday, activeReasonId]);

  const weekDates = useMemo(() => (weekMonday ? Array.from({ length: 7 }, (_, index) => addDays(weekMonday, index)) : []), [weekMonday]);
  const shownStep = catalog && catalog.reasons.length === 1 && step === "visit" ? "place" : step;

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
      readInsurance({
        plan: form.insurance,
        groupId: form.groupId,
        memberId: form.memberId,
        primaryHolder: form.primaryHolder,
        primaryHolderDob: form.primaryHolderDob,
      });
    } catch (error) {
      setFormError((error as Error).message);
      setSubmitting(false);
      return;
    }
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
            insurance: {
              plan: form.insurance,
              groupId: form.groupId,
              memberId: form.memberId,
              primaryHolder: form.primaryHolder,
              primaryHolderDob: form.primaryHolderDob,
            },
            patient: {
              firstName: form.firstName,
              lastName: form.lastName,
              dob: form.dob,
              phone: form.phone,
              email: form.email,
              patientId: form.patientId,
            },
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
      </div>

      {catalog.notice ? (
        <p className="border-b border-border bg-secondary/70 px-5 py-3 text-sm text-secondary-foreground md:px-8">{catalog.notice}</p>
      ) : null}

      {shownStep === "done" && visit ? (
        <Done
          visit={catalog ? visit : visit}
          timezone={catalog.practice.timezone}
          onAgain={() => {
            setStep("visit");
            setVisit(null);
            setSelectedSlot(null);
            setForm(emptyForm());
          }}
        />
      ) : (
        <div className="grid gap-0 lg:grid-cols-[280px_1fr]">
          <aside className="border-b border-border px-5 py-5 lg:border-r lg:border-b-0 md:px-8 lg:px-6">
            <ol className="space-y-3 text-sm">
              <StepMark n={1} label="Visit" active={shownStep === "visit"} done={shownStep !== "visit"} value={reason?.name} />
              <StepMark n={2} label="Place" active={shownStep === "place"} done={shownStep === "when" || shownStep === "details"} value={placeLabel(place, catalog)} />
              <StepMark
                n={3}
                label="Time"
                active={shownStep === "when"}
                done={shownStep === "details"}
                value={selectedSlot ? formatInstant(selectedSlot.start, catalog.practice.timezone) : undefined}
              />
              <StepMark n={4} label="Your details" active={shownStep === "details"} done={false} />
            </ol>
            {reason ? (
              <p className="mt-6 text-sm text-muted-foreground">
                {reason.durationMinutes} minutes. {reason.description}
              </p>
            ) : null}
          </aside>

          <div className="px-5 py-5 md:px-8 md:py-7">
            {shownStep === "visit" ? (
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

            {shownStep === "place" && reason ? (
              <PlaceStep
                catalog={catalog}
                reason={reason}
                error={scheduleError}
                onBack={catalog.reasons.length === 1 ? null : () => setStep("visit")}
                onChoose={choosePlace}
              />
            ) : null}

            {shownStep === "when" && reason && place ? (
              <WhenStep
                catalog={catalog}
                blocks={activeBlocks.filter((block) => blockMatches(block, place))}
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

            {shownStep === "details" && selectedSlot && reason ? (
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
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="insurance">Type of insurance</Label>
                    <select
                      id="insurance"
                      required
                      value={form.insurance}
                      onChange={(event) => setForm({ ...form, insurance: event.target.value })}
                      className="h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <option value="">Choose a plan</option>
                      {INSURANCE_PLANS.map((plan) => (
                        <option key={plan} value={plan}>
                          {plan}
                        </option>
                      ))}
                    </select>
                  </div>
                  {form.insurance && form.insurance !== CASH_PLAN ? (
                    <>
                      <Field label="Group ID" value={form.groupId} onChange={(groupId) => setForm({ ...form, groupId })} />
                      <Field label="Member ID" value={form.memberId} onChange={(memberId) => setForm({ ...form, memberId })} />
                      <Field
                        label="Primary Holder (leave blank if self)"
                        value={form.primaryHolder}
                        onChange={(primaryHolder) => setForm({ ...form, primaryHolder })}
                        required={false}
                      />
                      <Field
                        label="Primary Holder DOB (leave blank if self)"
                        type="date"
                        value={form.primaryHolderDob}
                        onChange={(primaryHolderDob) => setForm({ ...form, primaryHolderDob })}
                        required={false}
                      />
                    </>
                  ) : null}
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
                    {submitting ? "Requesting…" : "Request this time"}
                  </Button>
                </div>
                {catalog.mode === "preview" ? (
                  <p className="text-xs text-muted-foreground">
                    Preview only writes to this demo. Try an existing chart with Elena Vasquez, born 1988-04-12.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">This holds the time in Tebra as tentative until the practice confirms it.</p>
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

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="h-10" type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required ?? type !== "email"} />
    </div>
  );
}

function PlaceStep({
  catalog,
  reason,
  error,
  onBack,
  onChoose,
}: {
  catalog: Catalog;
  reason: VisitReason;
  error: string | null;
  onBack: (() => void) | null;
  onChoose: (place: Place) => void;
}) {
  const locations = catalog.locations;
  const video = reason.modes.includes("Telehealth");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl">Where should this visit happen?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Choose an office. Open times for that office are on the next step.</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {locations.length === 0 && !video ? (
        <p className="rounded-2xl bg-secondary p-4 text-sm">This practice has no offices on file yet.</p>
      ) : null}
      <div className="grid gap-3">
        {locations.map((location) => (
          <PlaceCard
            key={location.id}
            color={location.color}
            title={location.name}
            detail={location.address}
            onClick={() => onChoose({ kind: "location", id: location.id })}
          />
        ))}
        {video ? (
          <PlaceCard
            color={VIDEO}
            title="Video visit"
            detail="A video visit with the clinician"
            onClick={() => onChoose({ kind: "video" })}
          />
        ) : null}
      </div>
      {onBack ? (
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
      ) : null}
    </div>
  );
}

function PlaceCard({ color, title, detail, onClick }: { color: string; title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-2xl bg-background p-4 text-left ring-1 ring-border transition hover:ring-primary">
      <div className="flex items-start gap-3">
        <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: color }} />
        <span>
          <span className="block font-medium">{title}</span>
          <span className="mt-1 block text-sm text-muted-foreground">{detail}</span>
        </span>
      </div>
    </button>
  );
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
          {formatLongDate(props.selectedDate)} has no posted hours. MedSlot will not invent openings from a repeating office template.
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
      <p className="text-xs tracking-[0.16em] text-primary uppercase">Request received</p>
      <h2 className="mt-2 text-3xl">{visit.reasonName}</h2>
      <p className="mt-2 text-lg">{formatInstant(visit.start, timezone)}</p>
      <p className="mt-1 text-muted-foreground">
        {visit.providerName} · {visit.locationName}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{visit.address}</p>
      <p className="mt-4 text-sm">The visit is tentative until the practice confirms it. Reference {visit.id}</p>
      {visit.practicePhone ? <p className="text-sm text-muted-foreground">Questions: {visit.practicePhone}</p> : null}
      <Button type="button" className="mt-6" variant="outline" onClick={onAgain}>
        Book another visit
      </Button>
    </div>
  );
}
