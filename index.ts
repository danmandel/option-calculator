#!/usr/bin/env bun

/**
 * index.ts — Bull Call (Vertical Long Call) CLI entry point.
 *
 * Usage examples:
 *   bun run index.ts --long 600 --short 800 --price 750 --debit 70
 *   bun run index.ts --long 600 --short 800 --debit 70 --tableRange 500:900:50
 *
 */

import {
  type BullCallSpreadArgs,
  bullCallSpreadBreakeven,
  bullCallSpreadMaxLossPerContract,
  bullCallSpreadMaxProfitPerContract,
  bullCallSpreadProfit,
  payoffTable,
  range,
} from "./finance";

/* =========================
   Minimal CLI
   ========================= */

type ArgMap = Record<string, string | boolean>;

const parseArgs = (argv: string[]): ArgMap => {
  const out: ArgMap = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = true; // boolean flag
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
};

const toNum = (name: string, v: unknown): number | undefined => {
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    throw new Error(`--${name} must be a finite number`);
  }
  return undefined;
};

const printUsage = (): void => {
  console.log(`
Bull Call (Vertical Call) Spread CLI

Required for single-point P&L:
  --long <num>          Lower strike (buy)
  --short <num>         Upper strike (sell)
  --debit <num>         Net debit per share (e.g., 7.5 for $7.50)
  --price <num>         Underlying price at expiry

Optional:
  --contracts <int>     Number of contracts (default 1)
  --contractSize <int>  Shares per contract (default 100)

Payoff table options (use one):
  --table "<p1,p2,...>"       Comma-separated prices
  --tableRange "start:end:step"  e.g., "500:900:50"

Examples:
  bun run index.ts --long 600 --short 800 --price 750 --debit 70
  bun run index.ts --long 600 --short 800 --debit 70 --tableRange 500:900:50
`);
};

const formatUSD = (n: number): string => {
  const s = n < 0 ? "-$" : "$";
  return s + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));

  // Show usage if no args
  if (Object.keys(args).length === 0 || args["help"]) {
    printUsage();
    console.log("Example:");
    const demo = bullCallSpreadProfit({
      longStrike: 600,
      shortStrike: 800,
      priceAtExpiry: 750,
      netDebitPerShare: 70,
    });
    console.log(`  600/800 @ $750, debit $70 → ${formatUSD(demo)} per contract`);
    return;
  }

  try {
    const longStrike = toNum("long", args["long"]);
    const shortStrike = toNum("short", args["short"]);
    const priceAtExpiry = toNum("price", args["price"]);
    const netDebitPerShare = toNum("debit", args["debit"]);
    const contracts = toNum("contracts", args["contracts"]) ?? 1;
    const contractSize = toNum("contractSize", args["contractSize"]) ?? 100;

    // If table flags are present, we build a payoff table; otherwise single-point P&L.
    const tableCsv = typeof args["table"] === "string" ? (args["table"] as string) : undefined;
    const tableRange = typeof args["tableRange"] === "string" ? (args["tableRange"] as string) : undefined;

    if (
      longStrike === undefined ||
      shortStrike === undefined ||
      netDebitPerShare === undefined ||
      (priceAtExpiry === undefined && !tableCsv && !tableRange)
    ) {
      printUsage();
      throw new Error("Missing required arguments.");
    }

    if (tableCsv || tableRange) {
      let prices: number[] = [];
      if (tableCsv) {
        prices = tableCsv
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n));
        if (prices.length === 0) throw new Error("--table must contain numbers");
      } else if (tableRange) {
        const parts = tableRange.split(":").map((s) => Number(s.trim()));
        if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n)))
          throw new Error('--tableRange must be "start:end:step" with numeric values');
        const [start, end, step] = parts as [number, number, number];
        prices = range(start, end, step);
      }

      const base = {
        longStrike,
        shortStrike,
        netDebitPerShare,
        contractSize,
        contracts,
      };

      const rows = payoffTable(
        base as Omit<BullCallSpreadArgs, "priceAtExpiry">,
        prices
      );

      console.log(`\nPayoff table — Bull Call Spread ${longStrike}/${shortStrike}, debit ${formatUSD(netDebitPerShare)} per share`);
      console.log(`(contractSize=${contractSize}, contracts=${contracts})\n`);
      console.log(["Price", "Profit (total)"].join("\t"));
      for (const r of rows) {
        console.log(`${r.price}\t${formatUSD(r.profit)}`);
      }

      const breakeven = bullCallSpreadBreakeven({ longStrike, netDebitPerShare });
      const maxProfit = bullCallSpreadMaxProfitPerContract({ longStrike, shortStrike, netDebitPerShare, contractSize });
      const maxLoss = bullCallSpreadMaxLossPerContract({ netDebitPerShare, contractSize });
      console.log("\nBreakeven:", breakeven);
      console.log("Max profit per contract:", formatUSD(maxProfit));
      console.log("Max loss per contract:", formatUSD(maxLoss));
    } else {
      // Single point P&L
      const pnl = bullCallSpreadProfit({
        longStrike,
        shortStrike,
        priceAtExpiry: priceAtExpiry as number,
        netDebitPerShare,
        contractSize,
        contracts,
      });
      console.log(
        `P&L for ${longStrike}/${shortStrike} @ $${priceAtExpiry} (debit $${netDebitPerShare} per share, contractSize=${contractSize}, contracts=${contracts}): ${formatUSD(pnl)}`
      );

      const breakeven = bullCallSpreadBreakeven({ longStrike, netDebitPerShare });
      const maxProfit = bullCallSpreadMaxProfitPerContract({ longStrike, shortStrike, netDebitPerShare, contractSize });
      const maxLoss = bullCallSpreadMaxLossPerContract({ netDebitPerShare, contractSize });
      console.log("Breakeven:", breakeven);
      console.log("Max profit per contract:", formatUSD(maxProfit));
      console.log("Max loss per contract:", formatUSD(maxLoss));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error:", msg);
    process.exit(1);
  }
};

if (require.main === module) main();
