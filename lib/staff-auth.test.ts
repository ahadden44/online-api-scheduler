import assert from "node:assert/strict";
import test from "node:test";
import { codesMatch, requestIsStaff, staffCookieValue, STAFF_COOKIE } from "@/lib/staff-auth";

test("a different code does not match", () => {
  assert.equal(codesMatch("right-code", "right-code"), true);
  assert.equal(codesMatch("wrong-code", "right-code"), false);
});

test("the staff cookie is accepted only when it matches the configured code", () => {
  const previous = process.env.STAFF_CODE;
  process.env.STAFF_CODE = "harbor-door";
  try {
    const good = `${STAFF_COOKIE}=${staffCookieValue("harbor-door")}`;
    const bad = `${STAFF_COOKIE}=${staffCookieValue("other-door")}`;
    assert.equal(requestIsStaff(good), true);
    assert.equal(requestIsStaff(bad), false);
    assert.equal(requestIsStaff(null), false);
  } finally {
    if (previous === undefined) delete process.env.STAFF_CODE;
    else process.env.STAFF_CODE = previous;
  }
});
