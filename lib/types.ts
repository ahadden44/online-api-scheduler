export type VisitMode = "InOffice" | "Telehealth";

export type Provider = {
  id: string;
  name: string;
  specialty: string;
};

export type Location = {
  id: string;
  name: string;
  address: string;
  phone?: string;
  color: string;
};

export type VisitReason = {
  id: string;
  name: string;
  durationMinutes: number;
  modes: VisitMode[];
  description: string;
};

export type PracticeProfile = {
  id: string;
  name: string;
  timezone: string;
  phone: string;
  address: string;
  slotMinutes: number;
  leadMinutes: number;
};

export type ScheduleBlock = {
  id: string;
  providerId: string;
  locationId: string | null;
  mode: VisitMode;
  /** Practice-local calendar day, YYYY-MM-DD. Specific to that date, never a repeating weekday. */
  date: string;
  startMinutes: number;
  endMinutes: number;
  origin: "preview" | "posted";
};

export type PatientRecord = {
  id: string;
  firstName: string;
  lastName: string;
  dob: string;
  phone: string;
  email: string;
};

export type StoredAppointment = {
  id: string;
  providerId: string;
  locationId: string | null;
  serviceLocationId: string | null;
  reasonId: string;
  reasonName: string;
  mode: VisitMode;
  patientId: string;
  patientName: string;
  start: string;
  end: string;
  status: string;
  notes: string;
  origin: "preview" | "widget" | "tebra";
};

export type MedSlotStore = {
  version: 1;
  practice: PracticeProfile;
  providers: Provider[];
  locations: Location[];
  reasons: VisitReason[];
  /** Live Tebra reason ids mapped to where that visit may be booked. */
  reasonModes: Record<string, VisitMode[]>;
  blocks: ScheduleBlock[];
  patients: PatientRecord[];
  appointments: StoredAppointment[];
};

export type OpenSlot = {
  start: string;
  end: string;
  date: string;
  startMinutes: number;
  providerId: string;
  locationId: string | null;
  mode: VisitMode;
};

export type BusyInterval = {
  id: string;
  providerId: string;
  locationId: string | null;
  start: string;
  end: string;
  status: string;
  reasonName: string;
};

export type SampleChart = {
  firstName: string;
  lastName: string;
  dob: string;
  reasonName: string;
};

export type Catalog = {
  mode: "preview" | "live";
  practice: PracticeProfile;
  providers: Provider[];
  locations: Location[];
  reasons: VisitReason[];
  notice: string | null;
  /** Preview charts that currently have an upcoming visit. Empty once Tebra is connected. */
  sampleCharts: SampleChart[];
};
