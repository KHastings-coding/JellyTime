// Screen-time balance math and ledger operations. Minutes may be fractional
// because playback is tracked in fractions of a minute.

// What the kid can still watch today. Negative after a large removal.
export function availableMinutes({ daily, carryIn, net, used }) {
  return daily + carryIn + net - used;
}

// Earned balance carried out of a finished day. The allotment is spent first and
// whatever is left of it expires; leftover earned time carries (up to the cap);
// a negative total carries as debt.
export function settleCarry({ daily, carryIn, net, used, bankCap = null }) {
  const end = availableMinutes({ daily, carryIn, net, used });
  const unusedAllotment = Math.max(0, daily - used);
  let carry = end >= 0 ? Math.max(0, end - unusedAllotment) : end;
  if (bankCap !== null && bankCap !== undefined && carry > bankCap) carry = bankCap;
  return carry;
}

// Carry-in for the next day. 'forgive' wipes any debt beyond one day's allotment.
export function applyDebtMode(carry, debtMode, nextDaily) {
  return debtMode === 'forgive' ? Math.max(carry, -nextDaily) : carry;
}
