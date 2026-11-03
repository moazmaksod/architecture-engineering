/**
 * Calculator fixture for Execution Acceptance Testing.
 */
export function divide(a, b) {
  if (typeof a !== "number" || typeof b !== "number" || Number.isNaN(a) || Number.isNaN(b)) {
    throw new TypeError("Operands must be valid numbers");
  }
  if (b === 0) {
    throw new RangeError("Division by zero is prohibited");
  }
  return a / b;
}

export function safeDivide(a, b, fallback = 0) {
  try {
    return divide(a, b);
  } catch (err) {
    if (err instanceof RangeError) {
      return fallback;
    }
    throw err;
  }
}

