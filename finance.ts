export interface BullCallSpreadArgs {
  /** Lower strike (the call you buy) */
  longStrike: number;
  /** Upper strike (the call you sell) */
  shortStrike: number;
  /** Underlying price at expiration */
  priceAtExpiry: number;
  /** Net premium paid per share (debit), e.g. 7.5 for $7.50 */
  netDebitPerShare: number;
  /** Shares per contract (default 100) */
  contractSize?: number;
  /** Number of option contracts (default 1) */
  contracts?: number;
}

/**
 * Profit (in dollars) for a bull call spread at expiration.
 * Returns the P/L across all contracts (positive = profit, negative = loss).
 */
export const bullCallSpreadProfit = (opts: BullCallSpreadArgs): number => {
  const {
    longStrike,
    shortStrike,
    priceAtExpiry,
    netDebitPerShare,
    contractSize = 100,
    contracts = 1,
  } = opts;

  // Basic validation
  if (![longStrike, shortStrike, priceAtExpiry, netDebitPerShare].every(Number.isFinite))
    throw new Error("All numeric inputs must be finite numbers.");
  if (longStrike >= shortStrike)
    throw new Error("For a bull call spread, longStrike must be LESS than shortStrike.");
  if (netDebitPerShare < 0)
    throw new Error("netDebitPerShare (debit) cannot be negative.");
  if (!Number.isInteger(contractSize) || contractSize <= 0)
    throw new Error("contractSize must be a positive integer.");
  if (!Number.isInteger(contracts) || contracts <= 0)
    throw new Error("contracts must be a positive integer.");

  // Intrinsic value of the vertical at expiry, per share:
  const width = shortStrike - longStrike;
  const intrinsicPerShare = Math.max(0, Math.min(priceAtExpiry - longStrike, width));

  // Profit per share = intrinsic - debit
  const profitPerShare = intrinsicPerShare - netDebitPerShare;

  // Scale to contracts
  return profitPerShare * contractSize * contracts;
};

export interface MaxProfitArgs {
  longStrike: number;
  shortStrike: number;
  netDebitPerShare: number;
  contractSize?: number; 
}

/** Max possible profit (if price >= shortStrike at expiry), per contract */
export const bullCallSpreadMaxProfitPerContract = (opts: MaxProfitArgs): number => {
  const { longStrike, shortStrike, netDebitPerShare, contractSize = 100 } = opts;
  if (![longStrike, shortStrike, netDebitPerShare].every(Number.isFinite))
    throw new Error("All numeric inputs must be finite numbers.");
  if (longStrike >= shortStrike)
    throw new Error("longStrike must be LESS than shortStrike.");
  if (netDebitPerShare < 0)
    throw new Error("netDebitPerShare (debit) cannot be negative.");
  const width = shortStrike - longStrike;
  return (width - netDebitPerShare) * contractSize;
};

export interface MaxLossArgs {
  netDebitPerShare: number;
  contractSize?: number; 
}

/** Max possible loss (your debit), per contract. Negative indicates a loss. */
export const bullCallSpreadMaxLossPerContract = (opts: MaxLossArgs): number => {
  const { netDebitPerShare, contractSize = 100 } = opts;
  if (!Number.isFinite(netDebitPerShare) || netDebitPerShare < 0)
    throw new Error("netDebitPerShare must be a non-negative finite number.");
  if (!Number.isInteger(contractSize) || contractSize <= 0)
    throw new Error("contractSize must be a positive integer.");
  return netDebitPerShare * contractSize * -1;
};

export interface BreakevenArgs {
  longStrike: number;
  netDebitPerShare: number;
}

/** Breakeven price at expiry */
export const bullCallSpreadBreakeven = (opts: BreakevenArgs): number => {
  const { longStrike, netDebitPerShare } = opts;
  if (![longStrike, netDebitPerShare].every(Number.isFinite))
    throw new Error("All numeric inputs must be finite numbers.");
  if (netDebitPerShare < 0)
    throw new Error("netDebitPerShare (debit) cannot be negative.");
  return longStrike + netDebitPerShare;
};

/* =========================
   Payoff Table Utilities
   ========================= */

export interface PayoffPoint {
  price: number;
  profit: number; // total across all contracts
}

export const payoffTable = (
  base: Omit<BullCallSpreadArgs, "priceAtExpiry">,
  prices: number[]
): PayoffPoint[] =>
  prices.map((p) => ({
    price: p,
    profit: bullCallSpreadProfit({ ...base, priceAtExpiry: p }),
  }));

export const range = (start: number, end: number, step: number): number[] => {
  if (![start, end, step].every(Number.isFinite)) throw new Error("range args must be finite numbers.");
  if (step === 0) throw new Error("range step cannot be 0.");
  const out: number[] = [];
  const dir = Math.sign(step);
  for (let x = start; dir > 0 ? x <= end : x >= end; x += step) {
    // Fix FP drift
    out.push(Number(x.toFixed(10)));
  }
  return out;
};
