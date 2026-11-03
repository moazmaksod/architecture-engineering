import test from "node:test";
import assert from "node:assert/strict";
import { processOrder, getOrder, resetOrderStore } from "./fixtures/order_processor.mjs";

test("Order Processor Test Suite", async (t) => {
  t.beforeEach(() => {
    resetOrderStore();
  });

  await t.test("calculates valid order total", () => {
    const result = processOrder({
      id: "ord_1",
      items: [
        { price: 10, quantity: 2 },
        { price: 5, quantity: 1 },
      ],
      discountPercentage: 10,
      taxRate: 0.1,
    });

    assert.equal(result.subtotal, 25);
    assert.equal(result.discountAmount, 2.5);
    // (25 - 2.5) * 1.1 = 22.5 * 1.1 = 24.75
    assert.equal(result.total, 24.75);
    assert.equal(getOrder("ord_1").total, 24.75);
    assert.equal(getOrder("ord_1").counter, 1);
  });

  await t.test("rejects invalid item types without incrementing counter", () => {
    assert.throws(
      () =>
        processOrder({
          id: "ord_2",
          items: [{ price: "invalid", quantity: 1 }],
        }),
      { name: "TypeError" }
    );

    // Verify next valid order starts at counter 1 (no leak)
    const valid = processOrder({
      id: "ord_valid",
      items: [{ price: 10, quantity: 1 }],
    });
    assert.equal(getOrder("ord_valid").counter, 1);
  });

  await t.test("rejects negative discount rate with RangeError", () => {
    assert.throws(
      () =>
        processOrder({
          id: "ord_neg_discount",
          items: [{ price: 10, quantity: 1 }],
          discountPercentage: -5,
        }),
      { name: "RangeError" }
    );
  });

  await t.test("rejects discount rate > 100 with RangeError", () => {
    assert.throws(
      () =>
        processOrder({
          id: "ord_excess_discount",
          items: [{ price: 10, quantity: 1 }],
          discountPercentage: 105,
        }),
      { name: "RangeError" }
    );
  });

  await t.test("rounds financial totals to 2 decimal places without binary float drift", () => {
    const result = processOrder({
      id: "ord_float_drift",
      items: [
        { price: 10.05, quantity: 3 },
      ],
      discountPercentage: 15,
      taxRate: 0.0825,
    });

    // Subtotal: 30.15, Discount: 4.52, Taxable: 25.63, Tax: 2.11 -> Total: 27.74
    assert.equal(result.total, 27.74);
  });
});
