export interface BullCallSpreadArgs {
  longStrike: number;
  shortStrike: number;
  priceAtExpiry: number;
  netDebitPerShare: number;
  contractSize?: number;
  contracts?: number;
  portfolioSize?: number;
}

export interface MaxProfitArgs {
  longStrike: number;
  shortStrike: number;
  netDebitPerShare: number;
  contractSize?: number;
}

export interface MaxProfitStrikeArgs {
  longStrike: number;
  shortStrike: number;
}

export interface BreakevenArgs {
  longStrike: number;
  netDebitPerShare: number;
}

import { resolveContracts } from "../sizing/contracts";

export const bullCallSpreadProfit = (opts: BullCallSpreadArgs): number => {
  const {
    longStrike,
    shortStrike,
    priceAtExpiry,
    netDebitPerShare,
    contractSize = 100,
    contracts,
    portfolioSize: targetPortfolioSize,
  } = opts;

  if (![longStrike, shortStrike, priceAtExpiry, netDebitPerShare].every(Number.isFinite))
    throw new Error("All numeric inputs must be finite numbers.");
  if (longStrike >= shortStrike)
    throw new Error("For a bull call spread, longStrike must be LESS than shortStrike.");
  if (netDebitPerShare < 0)
    throw new Error("netDebitPerShare (debit) cannot be negative.");
  if (!Number.isInteger(contractSize) || contractSize <= 0)
    throw new Error("contractSize must be a positive integer.");

  const effectiveContracts = resolveContracts({
    contracts,
    portfolioSizeValue: targetPortfolioSize,
    netDebitPerShare,
    contractSize,
  });

  const width = shortStrike - longStrike;
  const intrinsicPerShare = Math.max(0, Math.min(priceAtExpiry - longStrike, width));
  const profitPerShare = intrinsicPerShare - netDebitPerShare;
  return profitPerShare * contractSize * effectiveContracts;
};

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

export const bullCallSpreadMaxProfitStrike = (opts: MaxProfitStrikeArgs): number => {
  const { longStrike, shortStrike } = opts;
  if (![longStrike, shortStrike].every(Number.isFinite))
    throw new Error("All numeric inputs must be finite numbers.");
  if (longStrike >= shortStrike)
    throw new Error("longStrike must be LESS than shortStrike.");
  return shortStrike;
};

export const bullCallSpreadMaxLossPerContract = (opts: { netDebitPerShare: number; contractSize?: number }): number => {
  const { netDebitPerShare, contractSize = 100 } = opts;
  if (!Number.isFinite(netDebitPerShare) || netDebitPerShare < 0)
    throw new Error("netDebitPerShare must be a non-negative finite number.");
  if (!Number.isInteger(contractSize) || contractSize <= 0)
    throw new Error("contractSize must be a positive integer.");
  return netDebitPerShare * contractSize * -1;
};

export const bullCallSpreadBreakeven = (opts: BreakevenArgs): number => {
  const { longStrike, netDebitPerShare } = opts;
  if (![longStrike, netDebitPerShare].every(Number.isFinite))
    throw new Error("All numeric inputs must be finite numbers.");
  if (netDebitPerShare < 0)
    throw new Error("netDebitPerShare (debit) cannot be negative.");
  return longStrike + netDebitPerShare;
};

