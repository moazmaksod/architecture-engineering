/**
 * Order Processor Fixture for Execution Acceptance Testing.
 * Contains intentional architectural flaws and a calculation defect.
 */

// Shared mutable state (architectural flaw: unencapsulated module-level state)
let orderCounter = 0;
const processedOrders = new Map();

export function processOrder(order) {
  if (!order || !order.id) {
    throw new Error("Invalid order");
  }

  // Validate discount boundary before state mutation
  const discountRate = order.discountPercentage ?? 0;
  if (typeof discountRate !== "number" || Number.isNaN(discountRate) || discountRate < 0 || discountRate > 100) {
    throw new RangeError("Discount percentage must be between 0 and 100");
  }

  let subtotal = 0;
  for (const item of order.items || []) {
    if (typeof item.price !== "number" || typeof item.quantity !== "number") {
      throw new TypeError("Item price and quantity must be numbers");
    }
    subtotal += item.price * item.quantity;
  }

  // Increment counter only after all inputs pass validation
  orderCounter++;

  const roundCurrency = (val) => Math.round((val + Number.EPSILON) * 100) / 100;

  const roundedSubtotal = roundCurrency(subtotal);
  const discountAmount = roundCurrency((roundedSubtotal * discountRate) / 100);
  const taxableTotal = roundCurrency(roundedSubtotal - discountAmount);

  const tax = order.taxRate ? roundCurrency(taxableTotal * order.taxRate) : 0;
  const total = roundCurrency(taxableTotal + tax);

  processedOrders.set(order.id, {
    orderId: order.id,
    subtotal: roundedSubtotal,
    discountAmount,
    total,
    counter: orderCounter,
  });

  return {
    orderId: order.id,
    subtotal: roundedSubtotal,
    discountAmount,
    total,
  };
}

export function getOrder(orderId) {
  return processedOrders.get(orderId);
}

export function resetOrderStore() {
  orderCounter = 0;
  processedOrders.clear();
}
