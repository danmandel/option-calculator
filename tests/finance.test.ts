import {
  bullCallSpreadProfit,
  bullCallSpreadBreakeven,
  bullCallSpreadMaxProfitPerContract,
  bullCallSpreadMaxLossPerContract,
  bullCallSpreadMaxProfitStrike,
  resolveContracts,
  underlyingPnL,
} from "../src/core";
import { describe, it, expect } from "bun:test";

const approx = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

describe("core finance", () => {
  it("calculates bull call spread PnL and metrics", () => {
    const K1 = 100;
    const K2 = 110;
    const debit = 3;
    const contractSize = 100;
    const contracts = 1;

    const cases: Array<[number, number]> = [
      [90, -300],
      [100, -300],
      [103, 0],
      [105, 200],
      [110, 700],
      [115, 700],
    ];
    for (const [S, expected] of cases) {
      const pnl = bullCallSpreadProfit({
        longStrike: K1,
        shortStrike: K2,
        priceAtExpiry: S,
        netDebitPerShare: debit,
        contractSize,
        contracts,
      });
      expect(approx(pnl, expected)).toBe(true);
    }

    const be = bullCallSpreadBreakeven({ longStrike: K1, netDebitPerShare: debit });
    expect(approx(be, 103)).toBe(true);

    const maxProfit = bullCallSpreadMaxProfitPerContract({ longStrike: K1, shortStrike: K2, netDebitPerShare: debit, contractSize });
    expect(approx(maxProfit, 700)).toBe(true);

    const maxLoss = bullCallSpreadMaxLossPerContract({ netDebitPerShare: debit, contractSize });
    expect(approx(maxLoss, -300)).toBe(true);

    const maxStrike = bullCallSpreadMaxProfitStrike({ longStrike: K1, shortStrike: K2 });
    expect(approx(maxStrike, K2)).toBe(true);

    const spot = 100;
    const shares = contractSize * contracts;
    const bench = underlyingPnL({ spot, priceAtExpiry: 105, shares });
    expect(approx(bench, (105 - 100) * shares)).toBe(true);

    const sized = resolveContracts({ contracts: undefined, portfolioSizeValue: 100000, netDebitPerShare: debit, contractSize });
    expect(sized).toBe(Math.floor(100000 / (debit * contractSize)));
  });
});

