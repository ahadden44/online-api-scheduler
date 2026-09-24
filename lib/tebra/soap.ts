import { XMLParser } from "fast-xml-parser";
import type { Location, Provider, VisitReason } from "@/lib/types";
import { formatTebraUtc, parseTebraDate } from "@/lib/time";

const NS = "http://www.kareo.com/api/schemas/";
const NS_LOCATIONS = "http://www.kareo.com/api/schemas";
const ENDPOINT = process.env.TEBRA_ENDPOINT || "https://webservice.kareo.com/services/soap/2.1/KareoServices.svc";

export type TebraConfig = {
  customerKey: string;
  user: string;
  password: string;
  practiceName: string;
  practiceId: string | null;
  endpoint: string;
};

export type TebraAppointment = {
  id: string;
  providerIds: string[];
  providerNames: string[];
  locationId: string;
  locationName: string;
  patientId: string;
  patientName: string;
  start: string | null;
  end: string | null;
  status: string;
  reasonName: string;
  allDay: boolean;
};

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
});

const lastCall = new Map<string, number>();
const MIN_GAP_MS: Record<string, number> = {
  GetAppointments: 1100,
  GetPatients: 1100,
  GetAppointment: 600,
  GetProviders: 600,
  GetPractices: 600,
  GetServiceLocations: 600,
  CreateAppointment: 600,
  CreatePatient: 600,
  UpdateAppointment: 600,
  UpdateAppointmentStatus: 600,
  DeleteAppointment: 600,
};

export function tebraConfig(): TebraConfig | null {
  const customerKey = process.env.TEBRA_CUSTOMER_KEY?.trim();
  const user = process.env.TEBRA_USER?.trim();
  const password = process.env.TEBRA_PASSWORD ?? "";
  const practiceName = process.env.TEBRA_PRACTICE_NAME?.trim();
  if (!customerKey || !user || !password.trim() || !practiceName) return null;
  return {
    customerKey,
    user,
    password,
    practiceName,
    practiceId: process.env.TEBRA_PRACTICE_ID?.trim() || null,
    endpoint: ENDPOINT,
  };
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function tag(name: string, value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return `<${name}>${escapeXml(String(value))}</${name}>`;
}

function header(config: TebraConfig): string {
  return `<RequestHeader>${tag("CustomerKey", config.customerKey)}${tag("Password", config.password)}${tag("User", config.user)}</RequestHeader>`;
}

export function buildEnvelope(operation: string, requestInner: string, requestNamespace = NS): string {
  const request =
    requestNamespace === NS
      ? `<request>${requestInner}</request>`
      : `<request>${requestInner}</request>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${operation} xmlns="${NS}">
      ${requestNamespace === NS ? request : `<request xmlns="${requestNamespace}">${requestInner}</request>`}
    </${operation}>
  </soap:Body>
</soap:Envelope>`;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return text(value).toLowerCase() === "true";
}

type SoapBag = Record<string, unknown>;

export function parseSoap(xml: string, operation: string): SoapBag {
  let parsed: SoapBag;
  try {
    parsed = parser.parse(xml) as SoapBag;
  } catch {
    throw new Error("Tebra returned a response that could not be read.");
  }
  const envelope = (parsed.Envelope ?? parsed) as SoapBag;
  const body = (envelope.Body ?? envelope) as SoapBag;
  if (body.Fault) {
    const fault = body.Fault as SoapBag;
    throw new Error(text(fault.faultstring) || "Tebra rejected the request.");
  }
  const response = (body[`${operation}Response`] ?? {}) as SoapBag;
  const result = (response[`${operation}Result`] ?? response) as SoapBag;
  const error = result.ErrorResponse as SoapBag | undefined;
  if (error && asBool(error.IsError)) {
    throw new Error(text(error.ErrorMessage) || "Tebra returned an error.");
  }
  const security = result.SecurityResponse as SoapBag | undefined;
  if (security) {
    if (text(security.Authenticated).toLowerCase() === "false") {
      throw new Error(text(security.SecurityResult) || "Tebra could not authenticate this customer key.");
    }
    if (text(security.Authorized).toLowerCase() === "false") {
      throw new Error(text(security.SecurityResult) || "This Tebra user is not allowed to schedule.");
    }
  }
  return result;
}

async function call(config: TebraConfig, operation: string, inner: string, requestNamespace = NS): Promise<SoapBag> {
  const gap = MIN_GAP_MS[operation] ?? 500;
  const previous = lastCall.get(operation) ?? 0;
  const wait = previous + gap - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall.set(operation, Date.now());

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"${NS}KareoServices/${operation}"`,
    },
    body: buildEnvelope(operation, inner, requestNamespace),
    cache: "no-store",
  });
  const xml = await response.text();
  if (!response.ok && !xml.includes("Envelope")) {
    throw new Error(`Tebra responded with HTTP ${response.status}.`);
  }
  return parseSoap(xml, operation);
}

export async function getPracticeId(config: TebraConfig): Promise<{ id: string; name: string; phone: string; address: string }> {
  const fields = ["ID", "PracticeName", "Phone", "PracticeAddressLine1", "PracticeCity", "PracticeState", "Active"]
    .map((name) => tag(name, true))
    .join("");
  const result = await call(
    config,
    "GetPractices",
    `${header(config)}<Fields>${fields}</Fields><Filter>${tag("PracticeName", config.practiceName)}</Filter>`,
  );
  const practices = asArray((result.Practices as SoapBag | undefined)?.PracticeData as SoapBag | SoapBag[]);
  const match =
    practices.find((practice) => text(practice.PracticeName).toLowerCase() === config.practiceName.toLowerCase()) ??
    practices[0];
  if (!match) throw new Error(`No Tebra practice matched “${config.practiceName}”.`);
  const address = [text(match.PracticeAddressLine1), text(match.PracticeCity), text(match.PracticeState)]
    .filter(Boolean)
    .join(", ");
  return { id: text(match.ID), name: text(match.PracticeName) || config.practiceName, phone: text(match.Phone), address };
}

const LOCATION_COLORS = ["#0f6e6b", "#b8612e", "#2f4d8a", "#3f6b4a", "#8a5a2f", "#6d4d86"];

function colorFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return LOCATION_COLORS[hash % LOCATION_COLORS.length];
}

export async function getProviders(config: TebraConfig): Promise<Provider[]> {
  const fields = ["ID", "FullName", "FirstName", "LastName", "SpecialtyName", "Degree", "Active", "Type"]
    .map((name) => tag(name, true))
    .join("");
  const result = await call(
    config,
    "GetProviders",
    `${header(config)}<Fields>${fields}</Fields><Filter>${tag("PracticeName", config.practiceName)}${tag("Type", "Normal Provider")}</Filter>`,
  );
  return asArray((result.Providers as SoapBag | undefined)?.ProviderData as SoapBag | SoapBag[])
    .filter((provider) => text(provider.Active).toLowerCase() !== "false")
    .filter((provider) => !text(provider.Type).toLowerCase().includes("referring"))
    .map((provider) => ({
      id: text(provider.ID),
      name: text(provider.FullName) || [text(provider.FirstName), text(provider.LastName)].filter(Boolean).join(" "),
      specialty: text(provider.SpecialtyName) || text(provider.Degree) || "Clinician",
    }))
    .filter((provider) => provider.id && provider.name);
}

export async function getLocations(config: TebraConfig, practiceId: string): Promise<Location[]> {
  const fields = ["ID", "Name", "AddressLine1", "City", "State", "Phone", "PracticeID", "PracticeName"]
    .map((name) => tag(name, true))
    .join("");
  const filter = `${tag("PracticeName", config.practiceName)}${tag("PracticeID", practiceId)}`;
  const result = await call(
    config,
    "GetServiceLocations",
    `${header(config)}<Fields xmlns="${NS_LOCATIONS}">${fields}</Fields><Filter xmlns="${NS_LOCATIONS}">${filter}</Filter>`,
  );
  return asArray((result.ServiceLocations as SoapBag | undefined)?.ServiceLocationData as SoapBag | SoapBag[])
    .map((location) => ({
      id: text(location.ID),
      name: text(location.Name),
      address: [text(location.AddressLine1), text(location.City), text(location.State)].filter(Boolean).join(", "),
      phone: text(location.Phone) || undefined,
      color: colorFor(text(location.ID) || text(location.Name)),
    }))
    .filter((location) => location.id && location.name);
}

export async function getReasons(config: TebraConfig, practiceId: string): Promise<VisitReason[]> {
  const result = await call(config, "GetAppointmentReasons", `${header(config)}${tag("PracticeId", practiceId)}`);
  return asArray((result.AppointmentReasons as SoapBag | undefined)?.AppointmentReasonData as SoapBag | SoapBag[])
    .map((reason) => {
      const name = text(reason.Name);
      return {
        id: text(reason.AppointmentReasonId),
        name,
        durationMinutes: Number(text(reason.DefaultDurationMinutes)) || 30,
        modes: ["InOffice"] as VisitReason["modes"],
        description: "A 30-minute exam at the office where that clinician is posted that day.",
      };
    })
    .filter((reason) => reason.id && reason.name);
}

export async function getAppointments(
  config: TebraConfig,
  from: Date,
  to: Date,
): Promise<TebraAppointment[]> {
  const fields = [
    "ID",
    "StartDate",
    "EndDate",
    "AllDay",
    "ConfirmationStatus",
    "PatientID",
    "PatientFullName",
    "ServiceLocationID",
    "ServiceLocationName",
    "AppointmentReason1",
    "AppointmentDuration",
    "ResourceID1",
    "ResourceName1",
    "ResourceTypeID1",
    "ResourceID2",
    "ResourceName2",
    "ResourceTypeID2",
    "ResourceID3",
    "ResourceName3",
    "ResourceTypeID3",
  ]
    .map((name) => tag(name, true))
    .join("");
  const filter = [
    tag("PracticeName", config.practiceName),
    tag("StartDate", formatTebraUtc(from)),
    tag("EndDate", formatTebraUtc(to)),
    tag("TimeZoneOffsetFromGMT", "0"),
    tag("Type", "P"),
  ].join("");
  const result = await call(config, "GetAppointments", `${header(config)}<Fields>${fields}</Fields><Filter>${filter}</Filter>`);
  return asArray((result.Appointments as SoapBag | undefined)?.AppointmentData as SoapBag | SoapBag[]).map((row) => {
    const resources = [1, 2, 3].map((index) => ({
      id: text(row[`ResourceID${index}`]),
      name: text(row[`ResourceName${index}`]),
      type: text(row[`ResourceTypeID${index}`]),
    }));
    const start = parseTebraDate(text(row.StartDate));
    const end = parseTebraDate(text(row.EndDate));
    return {
      id: text(row.ID),
      providerIds: resources.filter((resource) => resource.id && resource.type !== "2").map((resource) => resource.id),
      providerNames: resources.filter((resource) => resource.name && resource.type !== "2").map((resource) => resource.name),
      locationId: text(row.ServiceLocationID),
      locationName: text(row.ServiceLocationName),
      patientId: text(row.PatientID),
      patientName: text(row.PatientFullName),
      start: start ? start.toISOString() : null,
      end: end ? end.toISOString() : null,
      status: text(row.ConfirmationStatus) || "Scheduled",
      reasonName: text(row.AppointmentReason1),
      allDay: text(row.AllDay).toLowerCase() === "true",
    };
  });
}

export type TebraPatient = {
  id: string;
  firstName: string;
  lastName: string;
  dob: string;
  email: string;
  phone: string;
};

export async function findPatients(
  config: TebraConfig,
  input: { firstName: string; lastName: string; dob: string },
): Promise<TebraPatient[]> {
  const fields = ["ID", "FirstName", "LastName", "DOB", "EmailAddress", "MobilePhone", "PatientFullName"]
    .map((name) => tag(name, true))
    .join("");
  const filter = [
    tag("PracticeName", config.practiceName),
    tag("FirstName", input.firstName),
    tag("LastName", input.lastName),
    tag("FromDateOfBirth", input.dob),
    tag("ToDateOfBirth", input.dob),
  ].join("");
  const result = await call(config, "GetPatients", `${header(config)}<Fields>${fields}</Fields><Filter>${filter}</Filter>`);
  return asArray((result.Patients as SoapBag | undefined)?.PatientData as SoapBag | SoapBag[]).map((patient) => ({
    id: text(patient.ID),
    firstName: text(patient.FirstName) || input.firstName,
    lastName: text(patient.LastName) || input.lastName,
    dob: input.dob,
    email: text(patient.EmailAddress),
    phone: text(patient.MobilePhone),
  }));
}

export async function createPatient(
  config: TebraConfig,
  practiceId: string,
  input: { firstName: string; lastName: string; dob: string; phone: string; email: string },
): Promise<string> {
  const patient = [
    tag("DateofBirth", `${input.dob}T00:00:00`),
    tag("EmailAddress", input.email),
    tag("FirstName", input.firstName),
    "<Gender>Unknown</Gender>",
    `<Guarantor><DifferentThanPatient>false</DifferentThanPatient><RelationshiptoGuarantor>Self</RelationshiptoGuarantor></Guarantor>`,
    tag("LastName", input.lastName),
    tag("MobilePhone", input.phone),
    `<Practice>${tag("PracticeID", practiceId)}${tag("PracticeName", config.practiceName)}</Practice>`,
  ].join("");
  const result = await call(config, "CreatePatient", `${header(config)}<Patient>${patient}</Patient>`);
  const id = text(result.PatientID);
  if (!id) throw new Error("Tebra created the patient without returning an id.");
  return id;
}

export async function createAppointment(
  config: TebraConfig,
  input: {
    practiceId: string;
    patientId: string;
    providerId: string;
    serviceLocationId: string;
    reasonId: string;
    start: Date;
    end: Date;
    mode: "InOffice" | "Telehealth";
    name: string;
    notes: string;
  },
): Promise<string> {
  const appointment = [
    tag("AppointmentMode", input.mode),
    tag("AppointmentName", input.name),
    tag("AppointmentReasonId", input.reasonId),
    tag("AppointmentStatus", "Tentative"),
    tag("AppointmentType", "P"),
    tag("EndTime", input.end.toISOString()),
    tag("IsRecurring", false),
    tag("Notes", input.notes),
    `<PatientSummary>${tag("PatientId", input.patientId)}</PatientSummary>`,
    tag("PracticeId", input.practiceId),
    tag("ProviderId", input.providerId),
    tag("ServiceLocationId", input.serviceLocationId),
    tag("StartTime", input.start.toISOString()),
    tag("WasCreatedOnline", true),
  ].join("");
  const result = await call(config, "CreateAppointment", `${header(config)}<Appointment>${appointment}</Appointment>`);
  const created = (result.Appointment ?? {}) as SoapBag;
  const id = text(created.AppointmentId);
  if (!id) throw new Error("Tebra did not return an appointment id.");
  return id;
}

export async function updateAppointment(
  config: TebraConfig,
  input: {
    appointmentId: string;
    patientId: string;
    providerId: string;
    serviceLocationId: string;
    reasonId: string;
    start: Date;
    end: Date;
    mode: "InOffice" | "Telehealth";
    name: string;
    notes: string;
    status: string;
  },
): Promise<void> {
  const appointment = [
    tag("AppointmentId", input.appointmentId),
    tag("AppointmentMode", input.mode),
    tag("AppointmentName", input.name),
    tag("AppointmentReasonId", input.reasonId),
    tag("AppointmentStatus", input.status || "Tentative"),
    tag("EndTime", input.end.toISOString()),
    tag("Notes", input.notes),
    tag("PatientId", input.patientId),
    tag("ProviderId", input.providerId),
    tag("ServiceLocationId", input.serviceLocationId),
    tag("StartTime", input.start.toISOString()),
  ].join("");
  await call(config, "UpdateAppointment", `${header(config)}<Appointment>${appointment}</Appointment>`);
}

export async function cancelAppointment(config: TebraConfig, appointmentId: string): Promise<void> {
  const appointment = `${tag("AppointmentId", appointmentId)}${tag("AppointmentStatus", "Cancelled")}`;
  await call(config, "UpdateAppointmentStatus", `${header(config)}<Appointment>${appointment}</Appointment>`);
}
