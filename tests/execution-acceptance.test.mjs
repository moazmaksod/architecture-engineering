import test from "node:test";
import assert from "node:assert/strict";
import { divide, safeDivide } from "./fixtures/calculator.mjs";

test("Execution Acceptance Test — Calculator Module Verification", async (t) => {
  await t.test("divide: calculates valid quotients", () => {
    assert.equal(divide(10, 2), 5);
    assert.equal(divide(-9, 3), -3);
  });

  await t.test("divide: throws RangeError on division by zero", () => {
    assert.throws(() => divide(10, 0), {
      name: "RangeError",
      message: /Division by zero is prohibited/,
    });
  });

  await t.test("divide: throws TypeError on non-numeric inputs", () => {
    assert.throws(() => divide("10", 2), { name: "TypeError" });
    assert.throws(() => divide(10, NaN), { name: "TypeError" });
  });

  await t.test("safeDivide: returns fallback on division by zero", () => {
    assert.equal(safeDivide(10, 0, 999), 999);
    assert.equal(safeDivide(10, 0), 0);
  });

  await t.test("safeDivide: propagates non-RangeError exceptions", () => {
    assert.throws(() => safeDivide(10, "invalid"), { name: "TypeError" });
  });
});

