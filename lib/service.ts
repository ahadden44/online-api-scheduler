import { computeOpenSlots, isBlockingStatus, type BusySpan } from "@/lib/availability";
import { createPreviewStore } from "@/lib/seed";
import { readStore, updateStore } from "@/lib/store";
import {
  cancelAppointment,
  createAppointment,
  createPatient,
  findPatients,
  getAppointments,
  getLocations,
  getPracticeId,
  getProviders,
  getReasons,
  tebraConfig,
  updateAppointment,
  type TebraAppointment,
  type TebraConfig,
} from "@/lib/tebra/soap";
import { addDays, compareDates, dateKeyInZone, isDateKey, mondayOnOrBefore, zonedDateTimeToUtc } from "@/lib/time";
import type {
  BusyInterval,
  Catalog,
  Location,
  OpenSlot,
  PracticeProfile,
  Provider,
  ScheduleBlock,
  StoredAppointment,
  VisitMode,
  VisitReason,
  MedSlotStore,
} from "@/lib/types";

const CREDENTIALS = ["md", "do", "np", "pa", "dr", "phd", "fnp", "pac"];

export class ScheduleError extends Error {
  status: number;
  matches?: { id: string; label: string }[];

  constructor(message: string, status = 400, matches?: { id: string; label: string }[]) {
    super(message);
    this.status = status;
    this.matches = matches;
  }
}

type Working = {
  mode: "preview" | "live";
  practice: PracticeProfile;
  providers: Provider[];
  locations: Location[];
  reasons: VisitReason[];
  blocks: ScheduleBlock[];
  notice: string | null;
  config: TebraConfig | null;
  practiceId: string;
};

let catalogMemo: {
  key: string;
  at: number;
  value: Omit<Working, "blocks" | "config"> & { hiddenPreviewBlocks: number };
} | null = null;

function namesMatch(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token && !CREDENTIALS.includes(token))
      .sort()
      .join(" ");
  const a = normalize(left);
  const b = normalize(right);
  return a.length > 0 && a === b;
}

function applyReasonModes(reasons: VisitReason[], modes: Record<string, VisitMode[]>): VisitReason[] {
  return reasons.map((reason) => ({
    ...reason,
    modes: modes[reason.id]?.length ? modes[reason.id] : reason.modes,
  }));
}

async function liveCatalog(
  store: MedSlotStore,
  config: TebraConfig,
): Promise<Omit<Working, "blocks" | "config"> & { hiddenPreviewBlocks: number }> {
  const key = `${config.customerKey}:${config.practiceName}:${config.practiceId ?? ""}`;
  if (catalogMemo && catalogMemo.key === key && Date.now() - catalogMemo.at < 5 * 60_000) {
    return catalogMemo.value;
  }
  const practice = config.practiceId
    ? { id: config.practiceId, name: config.practiceName, phone: store.practice.phone, address: store.practice.address }
    : await getPracticeId(config);
  const [providers, locations, reasons] = await Promise.all([
    getProviders(config),
    getLocations(config, practice.id),
    getReasons(config, practice.id),
  ]);
  if (!providers.length) throw new ScheduleError(`Tebra returned no clinicians for ${config.practiceName}.`, 502);
  const value = {
    mode: "live" as const,
    practice: {
      ...store.practice,
      id: practice.id,
      name: practice.name || config.practiceName,
      phone: practice.phone || store.practice.phone,
      address: practice.address || store.practice.address,
      timezone: process.env.PRACTICE_TIMEZONE?.trim() || store.practice.timezone,
    },
    providers,
    locations,
    reasons: applyReasonModes(reasons, store.reasonModes),
    notice: null,
    practiceId: practice.id,
    hiddenPreviewBlocks: store.blocks.filter((block) => block.origin === "preview").length,
  };
  catalogMemo = { key, at: Date.now(), value };
  return value;
}

export async function loadWorking(): Promise<Working> {
  const store = await readStore();
  const config = tebraConfig();
  if (!config) {
    return {
      mode: "preview",
      practice: { ...store.practice, timezone: process.env.PRACTICE_TIMEZONE?.trim() || store.practice.timezone },
      providers: store.providers,
      locations: store.locations,
      reasons: applyReasonModes(store.reasons, store.reasonModes),
      blocks: store.blocks,
      notice:
        "Preview practice. Hours below are a sample week, not Tebra office hours. Add API credentials to book into your own practice.",
      config: null,
      practiceId: store.practice.id,
    };
  }
  const live = await liveCatalog(store, config);
  const knownProviders = new Set(live.providers.map((provider) => provider.id));
  const knownLocations = new Set(live.locations.map((location) => location.id));
  const blocks = store.blocks.filter(
    (block) =>
      block.origin !== "preview" &&
      knownProviders.has(block.providerId) &&
      (block.mode === "Telehealth" || (block.locationId != null && knownLocations.has(block.locationId))),
  );
  const notice =
    live.hiddenPreviewBlocks > 0
      ? "Sample preview hours are hidden while Tebra is connected. Post this week’s hours on the board."
      : null;
  return { ...live, blocks, notice, config };
}

export function toCatalog(working: Working): Catalog {
  return {
    mode: working.mode,
    practice: working.practice,
    providers: working.providers,
    locations: working.locations,
    reasons: working.reasons,
    notice: working.notice,
    sampleCharts: [],
  };
}

export async function loadCatalog(): Promise<Catalog> {
  const working = await loadWorking();
  const catalog = toCatalog(working);
  if (working.mode !== "preview") return catalog;
  const store = await readStore();
  const horizon = Date.now() - 60 * 60_000;
  const reasonByPatient = new Map<string, string>();
  for (const appointment of [...store.appointments].sort((a, b) => a.start.localeCompare(b.start))) {
    if (!isBlockingStatus(appointment.status)) continue;
    if (Date.parse(appointment.end) < horizon) continue;
    if (!reasonByPatient.has(appointment.patientId)) reasonByPatient.set(appointment.patientId, appointment.reasonName);
  }
  return {
    ...catalog,
    sampleCharts: store.patients.flatMap((patient) => {
      const reasonName = reasonByPatient.get(patient.id);
      return reasonName ? [{ firstName: patient.firstName, lastName: patient.lastName, dob: patient.dob, reasonName }] : [];
    }),
  };
}

function providerName(working: Working, id: string): string {
  return working.providers.find((provider) => provider.id === id)?.name ?? "Clinician";
}

function locationName(working: Working, id: string | null, mode: VisitMode): string {
  if (mode === "Telehealth" || !id) return "Video visit";
  return working.locations.find((location) => location.id === id)?.name ?? "Office";
}

async function previewAppointments(from: Date, to: Date): Promise<StoredAppointment[]> {
  const store = await readStore();
  return store.appointments.filter((appointment) => {
    const start = Date.parse(appointment.start);
    return start >= from.getTime() - 86_400_000 && start <= to.getTime() + 86_400_000;
  });
}

function matchProvider(appointment: TebraAppointment, providers: Provider[]): string[] {
  const ids = new Set<string>();
  for (const id of appointment.providerIds) {
    if (providers.some((provider) => provider.id === id)) ids.add(id);
  }
  for (const name of appointment.providerNames) {
    const found = providers.find((provider) => namesMatch(provider.name, name));
    if (found) ids.add(found.id);
  }
  return [...ids];
}

async function collectAppointments(working: Working, from: Date, to: Date): Promise<StoredAppointment[]> {
  if (!working.config) return previewAppointments(from, to);
  const remote = await getAppointments(working.config, from, to);
  const mapped: StoredAppointment[] = [];
  for (const appointment of remote) {
    const providers = matchProvider(appointment, working.providers);
    if (!providers.length || !appointment.start) continue;
    const start = new Date(appointment.start);
    const end = appointment.end
      ? new Date(appointment.end)
      : new Date(start.getTime() + 20 * 60_000);
    const location = working.locations.find(
      (item) => item.id === appointment.locationId || namesMatch(item.name, appointment.locationName),
    );
    for (const providerId of providers) {
      mapped.push({
        id: appointment.id || `${providerId}-${appointment.start}`,
        providerId,
        locationId: location?.id ?? null,
        serviceLocationId: location?.id ?? null,
        reasonId: "",
        reasonName: appointment.reasonName,
        mode: "InOffice",
        patientId: appointment.patientId,
        patientName: appointment.patientName,
        start: start.toISOString(),
        end: (appointment.allDay
          ? new Date(zonedDateTimeToUtc(dateKeyInZone(start, working.practice.timezone), 24 * 60, working.practice.timezone))
          : end
        ).toISOString(),
        status: appointment.status || "Scheduled",
        notes: "",
        origin: "tebra",
      });
    }
  }
  const store = await readStore();
  const seen = new Set(mapped.map((appointment) => appointment.id));
  for (const local of store.appointments) {
    if (local.origin === "preview" || seen.has(local.id)) continue;
    const start = Date.parse(local.start);
    if (start >= from.getTime() - 86_400_000 && start <= to.getTime() + 86_400_000) mapped.push(local);
  }
  return mapped;
}

function toBusy(appointments: StoredAppointment[]): BusySpan[] {
  return appointments.flatMap((appointment) => {
    const startMs = Date.parse(appointment.start);
    const endMs = Date.parse(appointment.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
    return [{ providerId: appointment.providerId, startMs, endMs, status: appointment.status }];
  });
}

export async function searchAvailability(query: {
  from: string;
  to: string;
  reasonId: string;
  providerId?: string;
  locationId?: string;
  mode?: VisitMode;
}): Promise<{ catalog: Catalog; blocks: ScheduleBlock[]; slots: OpenSlot[] }> {
  if (!isDateKey(query.from) || !isDateKey(query.to) || compareDates(query.from, query.to) > 0) {
    throw new ScheduleError("Choose a valid date range.");
  }
  const working = await loadWorking();
  const reason = working.reasons.find((item) => item.id === query.reasonId);
  if (!reason) throw new ScheduleError("Choose a visit type.");
  const mode = query.mode && reason.modes.includes(query.mode) ? query.mode : undefined;
  const allowed = new Set(reason.modes);
  const blocks = working.blocks.filter((block) => allowed.has(block.mode));
  const fromInstant = zonedDateTimeToUtc(query.from, 0, working.practice.timezone);
  const toInstant = zonedDateTimeToUtc(addDays(query.to, 1), 0, working.practice.timezone);
  const appointments = await collectAppointments(working, new Date(fromInstant.getTime() - 86_400_000), toInstant);
  const ranged = blocks.filter((block) => block.date >= query.from && block.date <= query.to);
  const slots = computeOpenSlots({
    blocks: ranged,
    busy: toBusy(appointments),
    fromDate: query.from,
    toDate: query.to,
    durationMinutes: reason.durationMinutes,
    stepMinutes: working.practice.slotMinutes,
    timeZone: working.practice.timezone,
    nowMs: Date.now(),
    leadMinutes: working.practice.leadMinutes,
    providerId: query.providerId,
    locationId: query.locationId,
    mode,
  });
  return { catalog: toCatalog(working), blocks: ranged, slots };
}

export async function boardForWeek(monday: string): Promise<{
  catalog: Catalog;
  blocks: ScheduleBlock[];
  holds: BusyInterval[];
}> {
  if (!isDateKey(monday)) throw new ScheduleError("Choose a week.");
  const start = mondayOnOrBefore(monday);
  const working = await loadWorking();
  const from = zonedDateTimeToUtc(start, 0, working.practice.timezone);
  const to = zonedDateTimeToUtc(addDays(start, 7), 0, working.practice.timezone);
  const appointments = await collectAppointments(working, from, to);
  const holds: BusyInterval[] = appointments
    .filter((appointment) => isBlockingStatus(appointment.status))
    .map((appointment) => ({
      id: appointment.id,
      providerId: appointment.providerId,
      locationId: appointment.locationId,
      start: appointment.start,
      end: appointment.end,
      status: appointment.status,
      reasonName: appointment.reasonName,
    }));
  const blocks = working.blocks.filter((block) => block.date >= start && block.date <= addDays(start, 6));
  return { catalog: toCatalog(working), blocks, holds };
}

type Identity = {
  firstName: string;
  lastName: string;
  dob: string;
  phone?: string;
  email?: string;
  patientId?: string;
};

function cleanIdentity(input: Identity): Identity {
  const firstName = input.firstName?.trim() ?? "";
  const lastName = input.lastName?.trim() ?? "";
  const dob = input.dob?.trim() ?? "";
  if (firstName.length < 1 || lastName.length < 1) throw new ScheduleError("Enter the patient’s first and last name.");
  if (!isDateKey(dob)) throw new ScheduleError("Enter a date of birth as YYYY-MM-DD.");
  return {
    firstName,
    lastName,
    dob,
    phone: input.phone?.trim() ?? "",
    email: input.email?.trim() ?? "",
    patientId: input.patientId?.trim() || undefined,
  };
}

async function resolvePatient(working: Working, identity: Identity): Promise<{ id: string; name: string }> {
  const person = cleanIdentity(identity);
  if (!working.config) {
    const store = await readStore();
    const matches = store.patients.filter(
      (patient) =>
        patient.firstName.toLowerCase() === person.firstName.toLowerCase() &&
        patient.lastName.toLowerCase() === person.lastName.toLowerCase() &&
        patient.dob === person.dob,
    );
    if (person.patientId) {
      const chosen = matches.find((patient) => patient.id === person.patientId);
      if (!chosen) throw new ScheduleError("That chart does not match this name and date of birth.");
      return { id: chosen.id, name: `${chosen.firstName} ${chosen.lastName}` };
    }
    if (matches.length > 1) {
      throw new ScheduleError(
        "More than one chart matches that name and date of birth.",
        409,
        matches.map((patient) => ({ id: patient.id, label: `${patient.firstName} ${patient.lastName}` })),
      );
    }
    if (matches.length === 1) return { id: matches[0].id, name: `${matches[0].firstName} ${matches[0].lastName}` };
    if (!person.phone) throw new ScheduleError("A mobile phone is required for a new patient.");
    const created = {
      id: `pat-${crypto.randomUUID()}`,
      firstName: person.firstName,
      lastName: person.lastName,
      dob: person.dob,
      phone: person.phone,
      email: person.email ?? "",
    };
    await updateStore((store) => {
      store.patients.push(created);
    });
    return { id: created.id, name: `${created.firstName} ${created.lastName}` };
  }

  const matches = await findPatients(working.config, person);
  if (person.patientId) {
    const chosen = matches.find((patient) => patient.id === person.patientId) ?? matches[0];
    if (!matches.some((patient) => patient.id === person.patientId)) {
      throw new ScheduleError("That chart does not match this name and date of birth.");
    }
    return { id: person.patientId, name: `${chosen.firstName} ${chosen.lastName}` };
  }
  if (matches.length > 1) {
    throw new ScheduleError(
      "More than one chart matches that name and date of birth.",
      409,
      matches.map((patient) => ({ id: patient.id, label: `${patient.firstName} ${patient.lastName}` })),
    );
  }
  if (matches.length === 1) {
    return { id: matches[0].id, name: `${matches[0].firstName} ${matches[0].lastName}` };
  }
  if (!person.phone) throw new ScheduleError("A mobile phone is required to add a new patient in Tebra.");
  const id = await createPatient(working.config, working.practiceId, {
    firstName: person.firstName,
    lastName: person.lastName,
    dob: person.dob,
    phone: person.phone,
    email: person.email ?? "",
  });
  return { id, name: `${person.firstName} ${person.lastName}` };
}

async function requireOpenSlot(working: Working, input: { start: string; providerId: string; locationId: string | null; mode: VisitMode; reasonId: string }): Promise<{ slot: OpenSlot; reason: VisitReason }> {
  const reason = working.reasons.find((item) => item.id === input.reasonId);
  if (!reason) throw new ScheduleError("Choose a visit type.");
  if (!reason.modes.includes(input.mode)) throw new ScheduleError("That visit type is not offered this way.");
  const date = dateKeyInZone(new Date(input.start), working.practice.timezone);
  const appointments = await collectAppointments(
    working,
    new Date(Date.parse(input.start) - 86_400_000),
    new Date(Date.parse(input.start) + 86_400_000),
  );
  const slots = computeOpenSlots({
    blocks: working.blocks.filter((block) => reason.modes.includes(block.mode)),
    busy: toBusy(appointments),
    fromDate: date,
    toDate: date,
    durationMinutes: reason.durationMinutes,
    stepMinutes: working.practice.slotMinutes,
    timeZone: working.practice.timezone,
    nowMs: Date.now(),
    leadMinutes: working.practice.leadMinutes,
    providerId: input.providerId,
    locationId: input.mode === "InOffice" ? input.locationId ?? undefined : undefined,
    mode: input.mode,
  });
  const wanted = new Date(input.start).getTime();
  const slot = slots.find(
    (item) =>
      new Date(item.start).getTime() === wanted &&
      item.providerId === input.providerId &&
      item.mode === input.mode &&
      (input.mode === "Telehealth" || item.locationId === input.locationId),
  );
  if (!slot) throw new ScheduleError("That time is no longer open. Pick another posted hour.", 409);
  return { slot, reason };
}

export type BookedVisit = {
  id: string;
  providerId: string;
  providerName: string;
  locationId: string | null;
  locationName: string;
  address: string;
  reasonId: string;
  reasonName: string;
  mode: VisitMode;
  start: string;
  end: string;
  status: string;
  practicePhone: string;
};

function present(working: Working, appointment: StoredAppointment): BookedVisit {
  const location = appointment.locationId ? working.locations.find((item) => item.id === appointment.locationId) : undefined;
  return {
    id: appointment.id,
    providerId: appointment.providerId,
    providerName: providerName(working, appointment.providerId),
    locationId: appointment.locationId,
    locationName: locationName(working, appointment.locationId, appointment.mode),
    address: appointment.mode === "Telehealth" ? "A video link is sent from the practice." : location?.address ?? working.practice.address,
    reasonId: appointment.reasonId,
    reasonName: appointment.reasonName,
    mode: appointment.mode,
    start: appointment.start,
    end: appointment.end,
    status: appointment.status,
    practicePhone: working.practice.phone,
  };
}

export async function bookVisit(input: {
  start: string;
  providerId: string;
  locationId: string | null;
  mode: VisitMode;
  reasonId: string;
  notes?: string;
  patient: Identity;
}): Promise<BookedVisit> {
  if (!input.start || Number.isNaN(Date.parse(input.start))) throw new ScheduleError("Choose a time.");
  const working = await loadWorking();
  const { slot, reason } = await requireOpenSlot(working, {
    ...input,
    start: new Date(input.start).toISOString(),
  });
  const patient = await resolvePatient(working, input.patient);
  const serviceLocationId =
    slot.mode === "InOffice"
      ? slot.locationId
      : process.env.TEBRA_DEFAULT_SERVICE_LOCATION_ID || working.locations[0]?.id || null;
  if (!serviceLocationId) throw new ScheduleError("Add a Tebra service location before booking video visits.");
  const notes = [input.notes?.trim(), "Requested from the MedSlot widget. Held as tentative until the practice confirms it."].filter(Boolean).join(" ");
  const name = `${reason.name} — ${patient.name}`;
  let id = `apt-${crypto.randomUUID()}`;
  if (working.config) {
    id = await createAppointment(working.config, {
      practiceId: working.practiceId,
      patientId: patient.id,
      providerId: slot.providerId,
      serviceLocationId,
      reasonId: reason.id,
      start: new Date(slot.start),
      end: new Date(slot.end),
      mode: slot.mode,
      name,
      notes,
    });
  }
  const stored: StoredAppointment = {
    id,
    providerId: slot.providerId,
    locationId: slot.locationId,
    serviceLocationId,
    reasonId: reason.id,
    reasonName: reason.name,
    mode: slot.mode,
    patientId: patient.id,
    patientName: patient.name,
    start: slot.start,
    end: slot.end,
    status: "Tentative",
    notes,
    origin: working.config ? "widget" : "widget",
  };
  if (!working.config) stored.origin = "widget";
  await updateStore((store) => {
    store.appointments = store.appointments.filter((appointment) => appointment.id !== stored.id);
    store.appointments.push(stored);
  });
  return present(working, stored);
}

export type VisitLookup = {
  matched: boolean;
  visits: BookedVisit[];
};

export async function lookupVisits(identity: Identity): Promise<VisitLookup> {
  const person = cleanIdentity(identity);
  const working = await loadWorking();
  const today = dateKeyInZone(new Date(), working.practice.timezone);
  const from = zonedDateTimeToUtc(addDays(today, -1), 0, working.practice.timezone);
  const to = zonedDateTimeToUtc(addDays(today, 90), 0, working.practice.timezone);
  const appointments = await collectAppointments(working, from, to);
  let patientIds: string[] = [];
  if (!working.config) {
    const store = await readStore();
    patientIds = store.patients
      .filter(
        (patient) =>
          patient.firstName.toLowerCase() === person.firstName.toLowerCase() &&
          patient.lastName.toLowerCase() === person.lastName.toLowerCase() &&
          patient.dob === person.dob,
      )
      .map((patient) => patient.id);
  } else {
    patientIds = (await findPatients(working.config, person)).map((patient) => patient.id);
    if (person.patientId) patientIds = patientIds.filter((id) => id === person.patientId);
  }
  const visits = appointments
    .filter((appointment) => patientIds.includes(appointment.patientId) && isBlockingStatus(appointment.status))
    .filter((appointment) => Date.parse(appointment.end) >= Date.now() - 60 * 60_000)
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((appointment) => present(working, appointment));
  return { matched: patientIds.length > 0, visits };
}

async function ownedAppointment(identity: Identity, appointmentId: string): Promise<{ working: Working; appointment: StoredAppointment; patientId: string }> {
  const person = cleanIdentity(identity);
  const working = await loadWorking();
  const store = await readStore();
  let patientIds: string[] = [];
  if (!working.config) {
    patientIds = store.patients
      .filter(
        (patient) =>
          patient.firstName.toLowerCase() === person.firstName.toLowerCase() &&
          patient.lastName.toLowerCase() === person.lastName.toLowerCase() &&
          patient.dob === person.dob,
      )
      .map((patient) => patient.id);
  } else {
    patientIds = (await findPatients(working.config, person)).map((patient) => patient.id);
  }
  const from = new Date(Date.now() - 2 * 86_400_000);
  const to = new Date(Date.now() + 120 * 86_400_000);
  const appointments = await collectAppointments(working, from, to);
  const appointment = appointments.find((item) => item.id === appointmentId && patientIds.includes(item.patientId));
  if (!appointment) throw new ScheduleError("That visit does not match this name and date of birth.", 404);
  if (!/^\d+$/.test(appointment.id) && working.config) {
    throw new ScheduleError("This repeating visit has to be changed in Tebra.");
  }
  return { working, appointment, patientId: appointment.patientId };
}

export async function cancelVisit(appointmentId: string, identity: Identity): Promise<BookedVisit> {
  const { working, appointment } = await ownedAppointment(identity, appointmentId);
  if (working.config) await cancelAppointment(working.config, appointment.id);
  const updated = { ...appointment, status: "Cancelled" };
  await updateStore((store) => {
    const index = store.appointments.findIndex((item) => item.id === appointment.id);
    if (index >= 0) store.appointments[index] = { ...store.appointments[index], status: "Cancelled" };
    else store.appointments.push(updated);
  });
  return present(working, updated);
}

export async function rescheduleVisit(
  appointmentId: string,
  identity: Identity,
  next: { start: string; providerId: string; locationId: string | null; mode: VisitMode },
): Promise<BookedVisit> {
  const { working, appointment, patientId } = await ownedAppointment(identity, appointmentId);
  const reasonId = appointment.reasonId || working.reasons.find((reason) => reason.name === appointment.reasonName)?.id;
  if (!reasonId) throw new ScheduleError("Tebra did not include a visit type we can move. Cancel and book again.");
  const appointmentsForSlot = (await collectAppointments(
    working,
    new Date(Date.parse(next.start) - 86_400_000),
    new Date(Date.parse(next.start) + 86_400_000),
  )).map((item) => (item.id === appointment.id ? { ...item, status: "Cancelled" } : item));
  const reason = working.reasons.find((item) => item.id === reasonId);
  if (!reason) throw new ScheduleError("Choose a visit type.");
  const date = dateKeyInZone(new Date(next.start), working.practice.timezone);
  const slots = computeOpenSlots({
    blocks: working.blocks.filter((block) => reason.modes.includes(block.mode)),
    busy: toBusy(appointmentsForSlot),
    fromDate: date,
    toDate: date,
    durationMinutes: reason.durationMinutes,
    stepMinutes: working.practice.slotMinutes,
    timeZone: working.practice.timezone,
    nowMs: Date.now(),
    leadMinutes: working.practice.leadMinutes,
    providerId: next.providerId,
    locationId: next.mode === "InOffice" ? next.locationId ?? undefined : undefined,
    mode: next.mode,
  });
  const wanted = new Date(next.start).getTime();
  const slot = slots.find(
    (item) => new Date(item.start).getTime() === wanted && item.providerId === next.providerId && item.mode === next.mode,
  );
  if (!slot) throw new ScheduleError("That time is no longer open.", 409);
  const serviceLocationId =
    slot.mode === "InOffice" ? slot.locationId : appointment.serviceLocationId || working.locations[0]?.id;
  if (!serviceLocationId) throw new ScheduleError("A service location is required to move this visit.");
  const name = `${reason.name} — ${appointment.patientName}`;
  if (working.config) {
    await updateAppointment(working.config, {
      appointmentId: appointment.id,
      patientId,
      providerId: slot.providerId,
      serviceLocationId,
      reasonId,
      start: new Date(slot.start),
      end: new Date(slot.end),
      mode: slot.mode,
      name,
      notes: appointment.notes || "Moved from the MedSlot widget.",
      status: appointment.status || "Tentative",
    });
  }
  const updated: StoredAppointment = {
    ...appointment,
    providerId: slot.providerId,
    locationId: slot.locationId,
    serviceLocationId,
    reasonId,
    reasonName: reason.name,
    mode: slot.mode,
    start: slot.start,
    end: slot.end,
    status: appointment.status || "Tentative",
  };
  await updateStore((store) => {
    const index = store.appointments.findIndex((item) => item.id === appointment.id);
    if (index >= 0) store.appointments[index] = updated;
    else store.appointments.push(updated);
  });
  return present(working, updated);
}

function assertBlock(working: Working, block: Omit<ScheduleBlock, "id" | "origin">): void {
  if (!isDateKey(block.date)) throw new ScheduleError("Choose a date.");
  if (!working.providers.some((provider) => provider.id === block.providerId)) throw new ScheduleError("Choose a clinician.");
  if (block.mode === "InOffice") {
    if (!block.locationId || !working.locations.some((location) => location.id === block.locationId)) {
      throw new ScheduleError("Choose the place they will actually be.");
    }
  }
  if (block.startMinutes < 0 || block.endMinutes > 24 * 60 || block.endMinutes - block.startMinutes < 15) {
    throw new ScheduleError("Hours need a start and end at least 15 minutes apart.");
  }
  if (block.startMinutes % 5 !== 0 || block.endMinutes % 5 !== 0) {
    throw new ScheduleError("Use 5-minute increments.");
  }
  const clash = working.blocks.some(
    (existing) =>
      existing.providerId === block.providerId &&
      existing.date === block.date &&
      existing.startMinutes < block.endMinutes &&
      existing.endMinutes > block.startMinutes,
  );
  if (clash) throw new ScheduleError("Those hours overlap time already posted for that clinician.");
}

export async function saveBlock(input: Omit<ScheduleBlock, "id" | "origin"> & { id?: string }): Promise<ScheduleBlock> {
  const working = await loadWorking();
  const others = working.blocks.filter((block) => block.id !== input.id);
  assertBlock({ ...working, blocks: others }, input);
  const saved: ScheduleBlock = {
    id: input.id || crypto.randomUUID(),
    providerId: input.providerId,
    locationId: input.mode === "Telehealth" ? null : input.locationId,
    mode: input.mode,
    date: input.date,
    startMinutes: input.startMinutes,
    endMinutes: input.endMinutes,
    origin: "posted",
  };
  await updateStore((store) => {
    store.blocks = store.blocks.filter((block) => block.id !== saved.id);
    store.blocks.push(saved);
  });
  catalogMemo = null;
  return saved;
}

export async function removeBlock(id: string): Promise<void> {
  await updateStore((store) => {
    store.blocks = store.blocks.filter((block) => block.id !== id);
  });
}

export async function copyWeek(fromMonday: string, toMonday: string, replace: boolean): Promise<number> {
  if (!isDateKey(fromMonday) || !isDateKey(toMonday)) throw new ScheduleError("Choose two weeks.");
  const from = mondayOnOrBefore(fromMonday);
  const to = mondayOnOrBefore(toMonday);
  if (from === to) throw new ScheduleError("Pick a different week to copy into.");
  const working = await loadWorking();
  const fromEnd = addDays(from, 6);
  const toEnd = addDays(to, 6);
  const source = working.blocks.filter((block) => block.date >= from && block.date <= fromEnd);
  const target = working.blocks.filter((block) => block.date >= to && block.date <= toEnd);
  if (!source.length) throw new ScheduleError("That week has no posted hours to copy.");
  if (target.length && !replace) {
    throw new ScheduleError("This week already has hours. Replace them if the copy should win.");
  }
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const shift = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
  const remove = new Set(target.map((block) => block.id));
  const created: ScheduleBlock[] = source.map((block) => ({
    ...block,
    id: crypto.randomUUID(),
    date: addDays(block.date, shift),
    origin: "posted",
  }));
  await updateStore((store) => {
    store.blocks = store.blocks.filter((block) => !remove.has(block.id));
    store.blocks.push(...created);
  });
  return created.length;
}

export async function resetPreview(): Promise<void> {
  if (tebraConfig()) throw new ScheduleError("Preview reset is only available before Tebra credentials are set.");
  const fresh = createPreviewStore();
  await updateStore((store) => {
    Object.assign(store, fresh);
  });
}

export async function updatePracticeSettings(input: { slotMinutes?: number; leadMinutes?: number }): Promise<PracticeProfile> {
  const slot = input.slotMinutes;
  const lead = input.leadMinutes;
  if (slot != null && ![10, 15, 20, 30].includes(slot)) throw new ScheduleError("Slot length must be 10, 15, 20, or 30 minutes.");
  if (lead != null && (lead < 0 || lead > 24 * 60)) throw new ScheduleError("Lead time looks off.");
  const store = await updateStore((current) => {
    if (slot != null) current.practice.slotMinutes = slot;
    if (lead != null) current.practice.leadMinutes = lead;
  });
  catalogMemo = null;
  return store.practice;
}

export async function setReasonModes(reasonId: string, modes: VisitMode[]): Promise<void> {
  if (!modes.length) throw new ScheduleError("A visit type needs at least one place it can be booked.");
  const working = await loadWorking();
  if (!working.reasons.some((reason) => reason.id === reasonId)) throw new ScheduleError("Unknown visit type.");
  await updateStore((store) => {
    store.reasonModes[reasonId] = modes;
    const local = store.reasons.find((reason) => reason.id === reasonId);
    if (local) local.modes = modes;
  });
  catalogMemo = null;
}
