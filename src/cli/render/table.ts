import { computePayoffPoints, underlyingPnL, longCallProfit } from "../../core";
import type { BullCallSpreadArgs } from "../../core";
import { formatUSD } from "./format";

export interface BuildPayoffTableOptions {
  prices: number[];
  // Spread inputs
  longStrike: number;
  shortStrike: number;
  debit: number; // netDebitPerShare
  contractSize: number;
  spreadContracts: number;
  portfolio: number;

  // Benchmarks
  includeStockBenchmark: boolean;
  includeLongCallBenchmark: boolean;
  spotPrice?: number;
  stockBenchmarkShares?: number;
  longCallPremium?: number;
  longCallContracts?: number;
}

export interface BuiltPayoffTable {
  headers: string[];
  rows: string[][]; // already formatted strings ready to join with "\t"
}

export const buildPayoffTable = (opts: BuildPayoffTableOptions): BuiltPayoffTable => {
  const {
    prices,
    longStrike,
    shortStrike,
    debit,
    contractSize,
    spreadContracts,
    portfolio,
    includeStockBenchmark,
    includeLongCallBenchmark,
    spotPrice,
    stockBenchmarkShares,
    longCallPremium,
    longCallContracts,
  } = opts;

  const base: Omit<BullCallSpreadArgs, "priceAtExpiry"> = {
    longStrike,
    shortStrike,
    netDebitPerShare: debit,
    contractSize,
    contracts: spreadContracts,
    portfolioSize: portfolio,
  };

  const points = computePayoffPoints(base, prices);

  const headers = ["Price", "Spread profit", "Spread value"] as string[];
  if (includeStockBenchmark) headers.push("Stock value", "Stock profit");
  if (includeLongCallBenchmark) headers.push("Long call value", "Long call profit");

  const formattedRows: string[][] = [];
  for (const r of points) {
    const spreadValue = portfolio + r.profit;
    const row: string[] = [String(r.price), formatUSD(r.profit), formatUSD(spreadValue)];

    if (includeStockBenchmark && spotPrice !== undefined && stockBenchmarkShares !== undefined) {
      const stockProfit = underlyingPnL({ spot: spotPrice, priceAtExpiry: r.price, shares: stockBenchmarkShares });
      const stockValue = portfolio + stockProfit;
      row.push(formatUSD(stockValue), formatUSD(stockProfit));
    }

    if (includeLongCallBenchmark && longCallPremium !== undefined && longCallContracts !== undefined) {
      const lcProfit = longCallProfit({
        strike: longStrike,
        priceAtExpiry: r.price,
        premiumPerShare: longCallPremium,
        contractSize,
        contracts: longCallContracts,
      });
      const lcValue = portfolio + lcProfit;
      row.push(formatUSD(lcValue), formatUSD(lcProfit));
    }

    formattedRows.push(row);
  }

  return { headers, rows: formattedRows };
};
