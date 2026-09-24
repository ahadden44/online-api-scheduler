"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addDays, dateKeyInZone, formatLongDate, formatMinutes, formatMonthDay, minutesInZone, mondayOnOrBefore, weekdayName } from "@/lib/time";
import type { BusyInterval, Catalog, ScheduleBlock, VisitMode } from "@/lib/types";

const VIDEO = "#6d4d86";
const DAY_START = 7 * 60;
const DAY_END = 19 * 60;
const HOUR_PX = 36;

type Draft = {
  id?: string;
  providerId: string;
  locationId: string;
  mode: VisitMode;
  date: string;
  startMinutes: number;
  endMinutes: number;
};

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "The board could not be saved.");
  return body;
}

export function WeekBoard() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [holds, setHolds] = useState<BusyInterval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [week, setWeek] = useState<string>("");
  const [day, setDay] = useState<string>("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);

  const today = catalog ? dateKeyInZone(new Date(), catalog.practice.timezone) : "";

  useEffect(() => {
    fetch("/api/catalog")
      .then((response) => readJson<Catalog>(response))
      .then((next) => {
        setCatalog(next);
        const monday = mondayOnOrBefore(dateKeyInZone(new Date(), next.practice.timezone));
        setWeek(monday);
        setDay(dateKeyInZone(new Date(), next.practice.timezone));
      })
      .catch((caught: Error) => setError(caught.message));
  }, []);

  useEffect(() => {
    if (!week) return;
    fetch(`/api/board?week=${week}`)
      .then((response) => readJson<{ blocks: ScheduleBlock[]; holds: BusyInterval[]; catalog: Catalog }>(response))
      .then((result) => {
        setBlocks(result.blocks);
        setHolds(result.holds);
        setCatalog(result.catalog);
      })
      .catch((caught: Error) => setError(caught.message));
  }, [week]);

  const dates = useMemo(() => (week ? Array.from({ length: 7 }, (_, index) => addDays(week, index)) : []), [week]);

  async function reload() {
    if (!week) return;
    const result = await readJson<{ blocks: ScheduleBlock[]; holds: BusyInterval[]; catalog: Catalog }>(await fetch(`/api/board?week=${week}`));
    setBlocks(result.blocks);
    setHolds(result.holds);
    setCatalog(result.catalog);
  }

  async function saveDraft() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...draft,
        locationId: draft.mode === "Telehealth" ? null : draft.locationId,
      };
      await readJson(
        await fetch(draft.id ? `/api/blocks/${draft.id}` : "/api/blocks", {
          method: draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
      setDraft(null);
      await reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setSaving(true);
    setError(null);
    try {
      await readJson(await fetch(`/api/blocks/${id}`, { method: "DELETE" }));
      setDraft(null);
      await reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function copyPrevious(replace: boolean) {
    if (!week) return;
    setSaving(true);
    setError(null);
    try {
      await readJson(
        await fetch("/api/blocks/copy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: addDays(week, -7), to: week, replace }),
        }),
      );
      setReplaceOpen(false);
      await reload();
    } catch (caught) {
      const message = (caught as Error).message;
      if (!replace && /replace/i.test(message)) setReplaceOpen(true);
      else setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleMode(reasonId: string, mode: VisitMode) {
    if (!catalog) return;
    const reason = catalog.reasons.find((item) => item.id === reasonId);
    if (!reason) return;
    const modes = reason.modes.includes(mode) ? reason.modes.filter((item) => item !== mode) : [...reason.modes, mode];
    if (!modes.length) return;
    await readJson(
      await fetch(`/api/reasons/${reasonId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modes }),
      }),
    );
    setCatalog({
      ...catalog,
      reasons: catalog.reasons.map((item) => (item.id === reasonId ? { ...item, modes } : item)),
    });
  }

  if (!catalog || !week) {
    return <section className="rounded-3xl bg-card p-8 ring-1 ring-border">{error ?? "Loading the week…"}</section>;
  }

  const focusDay = dates.includes(day) ? day : dates[0];

  return (
    <section className="space-y-5">
      <div className="rounded-3xl bg-card p-5 ring-1 ring-border md:p-7">
        <p className="text-xs font-medium tracking-[0.16em] text-primary uppercase">Week board</p>
        <h1 className="mt-1 text-3xl md:text-4xl">Hours for this week only</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Post where each clinician will be. These blocks do not repeat next Monday. Tebra appointments show up as booked time and are subtracted from what patients can take.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => setWeek(addDays(week, -7))}>
            Previous
          </Button>
          <p className="min-w-40 text-sm font-medium">
            {formatMonthDay(week)} – {formatMonthDay(addDays(week, 6))}
          </p>
          <Button type="button" variant="outline" onClick={() => setWeek(addDays(week, 7))}>
            Next
          </Button>
          <Button type="button" variant="secondary" disabled={saving} onClick={() => copyPrevious(false)}>
            Copy previous week
          </Button>
          {catalog.mode === "preview" ? (
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                await readJson(await fetch("/api/preview/reset", { method: "POST" }));
                window.location.reload();
              }}
            >
              Restore sample weeks
            </Button>
          ) : null}
        </div>
        {catalog.notice ? <p className="mt-3 text-sm text-muted-foreground">{catalog.notice}</p> : null}
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      </div>

      <div className="flex gap-2 overflow-x-auto md:hidden">
        {dates.map((date) => (
          <Button key={date} type="button" size="sm" variant={focusDay === date ? "default" : "outline"} onClick={() => setDay(date)}>
            {weekdayName(date).slice(0, 3)} {formatMonthDay(date).split(" ").at(-1)}
          </Button>
        ))}
      </div>

      <div className="space-y-4 md:hidden">
        {catalog.providers.map((provider) => (
          <DayCard
            key={provider.id}
            catalog={catalog}
            providerId={provider.id}
            date={focusDay}
            blocks={blocks}
            holds={holds}
            timezone={catalog.practice.timezone}
            onEdit={setDraft}
            onAdd={() =>
              setDraft({
                providerId: provider.id,
                locationId: catalog.locations[0]?.id ?? "",
                mode: "InOffice",
                date: focusDay,
                startMinutes: 9 * 60,
                endMinutes: 12 * 60,
              })
            }
          />
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-3xl bg-card ring-1 ring-border md:block">
        <div className="min-w-[920px]">
          <div className="grid grid-cols-[160px_repeat(7,1fr)] border-b border-border">
            <div className="p-3 text-xs text-muted-foreground">Clinician</div>
            {dates.map((date) => (
              <div key={date} className="border-l border-border p-3 text-sm">
                <div className="font-medium">{weekdayName(date).slice(0, 3)}</div>
                <div className="text-muted-foreground">{formatMonthDay(date)}</div>
              </div>
            ))}
          </div>
          {catalog.providers.map((provider) => (
            <div key={provider.id} className="grid grid-cols-[160px_repeat(7,1fr)] border-b border-border last:border-b-0">
              <div className="p-3">
                <p className="font-medium">{provider.name}</p>
                <p className="text-xs text-muted-foreground">{provider.specialty}</p>
              </div>
              {dates.map((date) => (
                <DayColumn
                  key={date}
                  catalog={catalog}
                  providerId={provider.id}
                  date={date}
                  blocks={blocks}
                  holds={holds}
                  timezone={catalog.practice.timezone}
                  today={today}
                  onEdit={setDraft}
                  onAdd={() =>
                    setDraft({
                      providerId: provider.id,
                      locationId: catalog.locations[0]?.id ?? "",
                      mode: "InOffice",
                      date,
                      startMinutes: 9 * 60,
                      endMinutes: 12 * 60,
                    })
                  }
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        {catalog.locations.map((location) => (
          <span key={location.id} className="inline-flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: location.color }} />
            {location.name}
          </span>
        ))}
        <span className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ background: VIDEO }} />
          Video
        </span>
      </div>

      <div className="rounded-3xl bg-card p-5 ring-1 ring-border">
        <h2 className="text-xl">How openings are cut</h2>
        <p className="mt-1 text-sm text-muted-foreground">Patients book one visit: a 30-minute Comprehensive Eye Exam. Openings start every 30 minutes inside a posted block.</p>
        <div className="mt-4 space-y-2">
          {catalog.reasons.map((reason) => (
            <div key={reason.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-40 font-medium">{reason.name}</span>
              <Button type="button" size="sm" variant={reason.modes.includes("InOffice") ? "default" : "outline"} onClick={() => toggleMode(reason.id, "InOffice")}>
                In office
              </Button>
              <Button type="button" size="sm" variant={reason.modes.includes("Telehealth") ? "default" : "outline"} onClick={() => toggleMode(reason.id, "Telehealth")}>
                Video
              </Button>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={draft != null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit posted hours" : "Post hours"}</DialogTitle>
            <DialogDescription>{draft ? formatLongDate(draft.date) : ""} These hours apply to this date only.</DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Clinician</Label>
                <Select value={draft.providerId} onValueChange={(value) => setDraft({ ...draft, providerId: value ?? draft.providerId })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.providers.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Place</Label>
                <Select
                  value={draft.mode === "Telehealth" ? "video" : draft.locationId}
                  onValueChange={(value) => {
                    if (!value) return;
                    if (value === "video") setDraft({ ...draft, mode: "Telehealth", locationId: "" });
                    else setDraft({ ...draft, mode: "InOffice", locationId: value });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Where they will be" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.locations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.name}
                      </SelectItem>
                    ))}
                    <SelectItem value="video">Video visit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TimeField label="Starts" value={draft.startMinutes} onChange={(startMinutes) => setDraft({ ...draft, startMinutes })} />
                <TimeField label="Ends" value={draft.endMinutes} onChange={(endMinutes) => setDraft({ ...draft, endMinutes })} />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            {draft?.id ? (
              <Button type="button" variant="destructive" disabled={saving} onClick={() => draft.id && remove(draft.id)}>
                Remove
              </Button>
            ) : null}
            <Button type="button" disabled={saving || !draft} onClick={saveDraft}>
              {saving ? "Saving…" : "Save this day"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={replaceOpen} onOpenChange={setReplaceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace this week’s hours?</DialogTitle>
            <DialogDescription>Copying the previous week will remove the hours already posted for this one.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReplaceOpen(false)}>
              Keep them
            </Button>
            <Button type="button" disabled={saving} onClick={() => copyPrevious(true)}>
              Replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const options = Array.from({ length: ((20 * 60) - 7 * 60) / 30 + 1 }, (_, index) => 7 * 60 + index * 30);
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={String(value)} onValueChange={(next) => next && onChange(Number(next))}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((minutes) => (
            <SelectItem key={minutes} value={String(minutes)}>
              {formatMinutes(minutes)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DayCard(props: {
  catalog: Catalog;
  providerId: string;
  date: string;
  blocks: ScheduleBlock[];
  holds: BusyInterval[];
  timezone: string;
  onEdit: (draft: Draft) => void;
  onAdd: () => void;
}) {
  const provider = props.catalog.providers.find((item) => item.id === props.providerId);
  const blocks = props.blocks.filter((block) => block.providerId === props.providerId && block.date === props.date);
  return (
    <article className="rounded-2xl bg-card p-4 ring-1 ring-border">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-medium">{provider?.name}</p>
          <p className="text-xs text-muted-foreground">{formatLongDate(props.date)}</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={props.onAdd}>
          Add hours
        </Button>
      </div>
      <div className="mt-3 space-y-2">
        {blocks.length === 0 ? <p className="text-sm text-muted-foreground">Nothing posted.</p> : null}
        {blocks.map((block) => (
          <BlockButton key={block.id} catalog={props.catalog} block={block} onEdit={props.onEdit} />
        ))}
        {props.holds
          .filter((hold) => hold.providerId === props.providerId && dateKeyInZone(new Date(hold.start), props.timezone) === props.date)
          .map((hold) => (
            <p key={hold.id + hold.start} className="text-xs text-muted-foreground">
              Booked {formatMinutes(minutesInZone(hold.start, props.timezone))}–{formatMinutes(minutesInZone(hold.end, props.timezone))}
              {hold.reasonName ? ` · ${hold.reasonName}` : ""}
            </p>
          ))}
      </div>
    </article>
  );
}

function DayColumn(props: {
  catalog: Catalog;
  providerId: string;
  date: string;
  blocks: ScheduleBlock[];
  holds: BusyInterval[];
  timezone: string;
  today: string;
  onEdit: (draft: Draft) => void;
  onAdd: () => void;
}) {
  const height = ((DAY_END - DAY_START) / 60) * HOUR_PX;
  const blocks = props.blocks.filter((block) => block.providerId === props.providerId && block.date === props.date);
  const holds = props.holds.filter(
    (hold) => hold.providerId === props.providerId && dateKeyInZone(new Date(hold.start), props.timezone) === props.date,
  );
  return (
    <div className="relative border-l border-border" style={{ height: height + 36 }}>
      <div
        className="relative"
        style={{
          height,
          backgroundImage: "repeating-linear-gradient(to bottom, transparent, transparent 35px, var(--border) 36px)",
        }}
      >
        {blocks.map((block) => {
          const top = ((Math.max(block.startMinutes, DAY_START) - DAY_START) / 60) * HOUR_PX;
          const bottom = ((Math.min(block.endMinutes, DAY_END) - DAY_START) / 60) * HOUR_PX;
          const location = props.catalog.locations.find((item) => item.id === block.locationId);
          const color = block.mode === "Telehealth" ? VIDEO : location?.color ?? "#0f6e6b";
          return (
            <button
              key={block.id}
              type="button"
              onClick={() =>
                props.onEdit({
                  id: block.id,
                  providerId: block.providerId,
                  locationId: block.locationId ?? "",
                  mode: block.mode,
                  date: block.date,
                  startMinutes: block.startMinutes,
                  endMinutes: block.endMinutes,
                })
              }
              className="absolute right-1 left-1 overflow-hidden rounded-md px-1.5 py-1 text-left text-[11px] leading-tight text-white"
              style={{ top, height: Math.max(22, bottom - top), background: color }}
            >
              <span className="block font-medium">{block.mode === "Telehealth" ? "Video" : location?.name}</span>
              <span>
                {formatMinutes(block.startMinutes)}–{formatMinutes(block.endMinutes)}
              </span>
            </button>
          );
        })}
        {holds.map((hold) => {
          const start = minutesInZone(hold.start, props.timezone);
          const end = minutesInZone(hold.end, props.timezone);
          const top = ((Math.max(start, DAY_START) - DAY_START) / 60) * HOUR_PX;
          const heightPx = Math.max(16, ((Math.min(end, DAY_END) - Math.max(start, DAY_START)) / 60) * HOUR_PX);
          return (
            <div
              key={`${hold.id}-${hold.start}`}
              className="pointer-events-none absolute right-1 left-1 rounded-sm bg-foreground/80 px-1 text-[10px] text-background"
              style={{ top, height: heightPx }}
            >
              Booked
            </div>
          );
        })}
      </div>
      <button type="button" className="absolute right-1 bottom-1 left-1 text-[11px] text-primary" onClick={props.onAdd}>
        Add hours
      </button>
    </div>
  );
}

function BlockButton({ catalog, block, onEdit }: { catalog: Catalog; block: ScheduleBlock; onEdit: (draft: Draft) => void }) {
  const location = catalog.locations.find((item) => item.id === block.locationId);
  const color = block.mode === "Telehealth" ? VIDEO : location?.color ?? "#0f6e6b";
  return (
    <button
      type="button"
      onClick={() =>
        onEdit({
          id: block.id,
          providerId: block.providerId,
          locationId: block.locationId ?? "",
          mode: block.mode,
          date: block.date,
          startMinutes: block.startMinutes,
          endMinutes: block.endMinutes,
        })
      }
      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-white"
      style={{ background: color }}
    >
      <span>{block.mode === "Telehealth" ? "Video" : location?.name}</span>
      <span>
        {formatMinutes(block.startMinutes)}–{formatMinutes(block.endMinutes)}
      </span>
    </button>
  );
}
