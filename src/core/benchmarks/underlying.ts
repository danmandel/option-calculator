export interface UnderlyingBenchmarkArgs {
  spot: number;
  priceAtExpiry: number;
  shares: number;
}

export const underlyingPnL = (opts: UnderlyingBenchmarkArgs): number => {
  const { spot, priceAtExpiry, shares } = opts;
  if (![spot, priceAtExpiry, shares].every(Number.isFinite))
    throw new Error("underlyingPnL inputs must be finite numbers.");
  return (priceAtExpiry - spot) * shares;
};

