import assert from "node:assert/strict";
import test from "node:test";
import { insuranceNote, readInsurance } from "@/lib/insurance";

test("cash payment does not require member fields", () => {
  const details = readInsurance({ plan: "None/Cash Payment", groupId: "ignored" });
  assert.equal(details.groupId, "");
  assert.equal(insuranceNote(details), "Insurance: None/Cash Payment.");
});

test("an insurance plan requires group and member ids", () => {
  assert.throws(() => readInsurance({ plan: "Aetna" }), /Group ID is required/);
  const details = readInsurance({ plan: "VSP", groupId: "G1", memberId: "M2" });
  assert.match(insuranceNote(details), /Primary holder: self/);
});

test("a named primary holder needs a date of birth", () => {
  assert.throws(
    () => readInsurance({ plan: "Medica", groupId: "G1", memberId: "M2", primaryHolder: "Ada Lovelace" }),
    /date of birth/,
  );
});
