export interface LongCallBenchmarkArgs {
  strike: number;
  priceAtExpiry: number;
  premiumPerShare: number;
  contractSize?: number;
  contracts?: number;
}

export const longCallProfit = (opts: LongCallBenchmarkArgs): number => {
  const { strike, priceAtExpiry, premiumPerShare, contractSize = 100, contracts = 1 } = opts;
  if (![strike, priceAtExpiry, premiumPerShare].every(Number.isFinite))
    throw new Error("longCallProfit inputs must be finite numbers.");
  if (premiumPerShare < 0) throw new Error("premiumPerShare cannot be negative.");
  if (!Number.isInteger(contractSize) || contractSize <= 0)
    throw new Error("contractSize must be a positive integer.");
  if (!Number.isInteger(contracts) || contracts <= 0)
    throw new Error("contracts must be a positive integer.");

  const intrinsic = Math.max(0, priceAtExpiry - strike);
  const profitPerShare = intrinsic - premiumPerShare;
  return profitPerShare * contractSize * contracts;
};

