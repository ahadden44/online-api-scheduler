# Weekline

Weekline is a scheduling widget for practices whose clinicians do not keep the same hours every week. Tebra’s own online scheduling only knows repeating office hours. Weekline ignores those. Staff post a fresh week — who is where, and for which hours — and patients book inside that week only.

Appointments still live in Tebra. The widget calls the Tebra SOAP API to read who is already booked, then creates, moves, or cancels the visit there.

## How a time becomes bookable

1. Someone posts a block on the week board: clinician, place (or video), date, start, and end. A block is that calendar day. It does not roll into next week.
2. Weekline asks Tebra for appointments in that range (`GetAppointments`) and treats anything that is not cancelled or a no-show as busy. A clinician booked at one place is busy everywhere at that time.
3. Openings are cut from the posted block using the visit length (`GetAppointmentReasons`) and the practice’s grid (10, 15, 20, or 30 minutes). A visit cannot cross from one place into another.
4. Booking calls `CreateAppointment` with `WasCreatedOnline` set. New patients are found with `GetPatients` or added with `CreatePatient`. Moves use `UpdateAppointment`. Cancels use `UpdateAppointmentStatus`.

If the next week has no posts, patients see a closed week. There is no fallback to a weekly template.

## Preview

With no credentials, the app runs as Northline Family Medicine. This week and next week are posted differently on purpose: Harbor, Ridge, and the school clinic trade clinicians. The week after that is empty. A few visits are already on the books so you can see times disappear.

An existing preview chart is Elena Vasquez, born 1988-04-12.

## Connect Tebra

A system administrator creates a customer key and an API user (Tebra Desktop: Settings → User Accounts → Permissions → Account Administrator). Put the values in `.env.local`:

```
TEBRA_CUSTOMER_KEY=
TEBRA_USER=
TEBRA_PASSWORD=
TEBRA_PRACTICE_NAME=
TEBRA_PRACTICE_ID=
PRACTICE_TIMEZONE=America/New_York
```

`TEBRA_PRACTICE_ID` is optional; Weekline looks it up with `GetPractices` when the name matches. Video visits still need a Tebra service location, so set `TEBRA_DEFAULT_SERVICE_LOCATION_ID` or the practice’s first location is used.

The endpoint is `https://webservice.kareo.com/services/soap/2.1/KareoServices.svc`. Passwords are XML-escaped. Credentials stay on the server.

After connecting, sample preview hours are hidden. Post the real week on the board against the clinicians and service locations returned by `GetProviders` and `GetServiceLocations`. “Copy previous week” is explicit — nothing is copied unless you ask.

## Run

```
npm install
npm run dev
```

The patient page is `/`. That is the only address to put on the practice website. The week board is `/board`, and it is not linked from the patient page.

## On the practice website

Publish this app, then add a button on the practice site that opens the patient address in a new tab. Do not link `/board`. Staff keep that address as their own bookmark and post each week there.

```html
<a href="https://schedule.example.com">Schedule an appointment</a>
```

```
npm test
```

checks the slot rules: no posts means no openings, one week does not leak into the next, a clinician can sit in two places in a day, and a Tebra appointment blocks them in both.
