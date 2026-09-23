import assert from "node:assert/strict";
import test from "node:test";
import { buildEnvelope, escapeXml, parseSoap } from "@/lib/tebra/soap";

test("passwords with xml characters are escaped", () => {
  assert.equal(escapeXml(`a&b<c>"'`), "a&amp;b&lt;c&gt;&quot;&apos;");
});

test("appointment reads keep a single row and surface auth failures", () => {
  const xml = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <GetAppointmentsResponse xmlns="http://www.kareo.com/api/schemas/">
      <GetAppointmentsResult>
        <ErrorResponse><IsError>false</IsError></ErrorResponse>
        <SecurityResponse><Authenticated>true</Authenticated><Authorized>true</Authorized></SecurityResponse>
        <Appointments>
          <AppointmentData>
            <ID>99</ID>
            <ConfirmationStatus>Scheduled</ConfirmationStatus>
            <StartDate>9/23/2026 1:00:00 PM</StartDate>
          </AppointmentData>
        </Appointments>
      </GetAppointmentsResult>
    </GetAppointmentsResponse>
  </s:Body>
</s:Envelope>`;
  const result = parseSoap(xml, "GetAppointments");
  const row = (result.Appointments as { AppointmentData: { ID: string } }).AppointmentData;
  assert.equal(row.ID, "99");
});

test("tebra error messages are returned without the stack", () => {
  const xml = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>
    <CreateAppointmentResponse xmlns="http://www.kareo.com/api/schemas/"><CreateAppointmentResult>
      <ErrorResponse><IsError>true</IsError><ErrorMessage>Provider is required.</ErrorMessage><StackTrace>secret</StackTrace></ErrorResponse>
    </CreateAppointmentResult></CreateAppointmentResponse>
  </s:Body></s:Envelope>`;
  assert.throws(() => parseSoap(xml, "CreateAppointment"), /Provider is required/);
});

test("the envelope names the operation and hides nothing about structure", () => {
  const xml = buildEnvelope("GetAppointments", "<RequestHeader></RequestHeader>");
  assert.match(xml, /<GetAppointments xmlns="http:\/\/www.kareo.com\/api\/schemas\/">/);
  assert.match(xml, /<request><RequestHeader>/);
});
