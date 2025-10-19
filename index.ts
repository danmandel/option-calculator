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
  bullCallSpreadMaxProfitStrike,
  bullCallSpreadProfit,
  underlyingPnL,
  payoffTable,
  range,
  portfolioSize as defaultPortfolioSize,
  resolveContracts,
} from "./finance";
import { fetchSpreadMidDebit, fetchLatestStockPrice } from "./alpaca";

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
  --price <num>         Underlying price at expiry

Debit input options (choose one):
  --debit <num>         Net debit per share (e.g., 7.5 for $7.50)
  --symbol <ticker>     Fetch current mid debit via Alpaca Options API (requires --long/--short)
  --expiry <YYYY-MM-DD> Optional expiration date for Alpaca lookup (auto-detects if omitted)

Optional:
  --contracts <int>     Number of contracts (override auto sizing)
  --contractSize <int>  Shares per contract (default 100)
  --portfolio <num>     Portfolio size used to size contracts (default 150000)

Payoff table options (use one):
  --table "<p1,p2,...>"       Comma-separated prices
  --tableRange "start:end:step"  e.g., "500:900:50"

Examples:
  bun run index.ts --long 600 --short 800 --price 750 --debit 70
  bun run index.ts --symbol TSLA --long 200 --short 220 --price 215 --expiry 2024-09-20
  bun run index.ts --long 600 --short 800 --debit 70 --tableRange 500:900:50
\n+Notes:
- If you pass --symbol, the CLI also fetches the latest stock price via Alpaca and prints an underlying benchmark using shares = floor(portfolio / spot).
`);
};

const formatUSD = (n: number): string => {
  const s = n < 0 ? "-$" : "$";
  return s + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const formatExpirationDate = (timestampSeconds: number): string => {
  if (!Number.isFinite(timestampSeconds)) return "unknown expiry";
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10);
};

const main = async (): Promise<void> => {
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
      contracts: 1,
    });
    console.log(`  600/800 @ $750, debit $70 → ${formatUSD(demo)} per contract`);
    return;
  }

  try {
    const longStrike = toNum("long", args["long"]);
    const shortStrike = toNum("short", args["short"]);
    const priceAtExpiry = toNum("price", args["price"]);
    // Spot price for stock benchmark will be auto-fetched via Alpaca when symbol is provided.
    let netDebitPerShare = toNum("debit", args["debit"]);
    const explicitContracts = toNum("contracts", args["contracts"]);
    const contractSize = toNum("contractSize", args["contractSize"]) ?? 100;
    const portfolio = toNum("portfolio", args["portfolio"]) ?? defaultPortfolioSize;
    const contractsDerivedFromPortfolio = explicitContracts === undefined;
    const rawSymbol = typeof args["symbol"] === "string" ? (args["symbol"] as string).trim() : undefined;
    const symbol = rawSymbol && rawSymbol.length > 0 ? rawSymbol : undefined;
    const rawExpiry = typeof args["expiry"] === "string" ? (args["expiry"] as string).trim() : undefined;
    const expiry = rawExpiry && rawExpiry.length > 0 ? rawExpiry : undefined;

    // If table flags are present, we build a payoff table; otherwise single-point P&L.
    const tableCsv = typeof args["table"] === "string" ? (args["table"] as string) : undefined;
    const tableRange = typeof args["tableRange"] === "string" ? (args["tableRange"] as string) : undefined;

    if (longStrike === undefined || shortStrike === undefined) {
      printUsage();
      throw new Error("Missing required --long or --short strike.");
    }

    if (netDebitPerShare === undefined) {
      if (!symbol) {
        printUsage();
        throw new Error("Provide --debit or specify --symbol to auto-fetch the debit.");
      }
      const spreadQuote = await fetchSpreadMidDebit({
        symbol,
        longStrike, 
        shortStrike,
        expiration: expiry,
      });
      netDebitPerShare = spreadQuote.netDebitPerShare;
      const expiryText = formatExpirationDate(spreadQuote.expiration);
      console.log(
        `Fetched Alpaca mid debit for ${symbol.toUpperCase()} ${expiryText}: ${formatUSD(
          spreadQuote.longMid
        )} (long) - ${formatUSD(spreadQuote.shortMid)} (short) = ${formatUSD(netDebitPerShare)} per share`
      );
    }

    if (
      netDebitPerShare === undefined ||
      (priceAtExpiry === undefined && !tableCsv && !tableRange)
    ) {
      printUsage();
      throw new Error("Missing required arguments.");
    }

    const debit = netDebitPerShare as number;
    const sizedContracts = resolveContracts({
      contracts: explicitContracts,
      portfolioSizeValue: portfolio,
      netDebitPerShare: debit,
      contractSize,
    });

    // Try to resolve the latest stock price for benchmark sizing if symbol is provided
    let spotPrice: number | undefined;
    if (symbol) {
      try {
        spotPrice = await fetchLatestStockPrice(symbol);
      } catch (e) {
        console.warn(`Warning: unable to fetch latest stock price for ${symbol}. Skipping underlying benchmark.`);
      }
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
        netDebitPerShare: debit,
        contractSize,
        contracts: sizedContracts,
        portfolioSize: portfolio,
      };

      const rows = payoffTable(
        base as Omit<BullCallSpreadArgs, "priceAtExpiry">,
        prices
      );

      console.log(`\nPayoff table — Bull Call Spread ${longStrike}/${shortStrike}, debit ${formatUSD(debit)} per share`);
      const contractNote = contractsDerivedFromPortfolio ? " (derived from portfolio)" : "";
      console.log(`(contractSize=${contractSize}, contracts=${sizedContracts}${contractNote}, portfolioSize=${portfolio})\n`);
      const spotNum = Number.isFinite(spotPrice ?? NaN) ? (spotPrice as number) : undefined;
      const sharesForBenchmark = spotNum ? Math.floor(portfolio / spotNum) : undefined;
      const includeBenchmark = sharesForBenchmark !== undefined && sharesForBenchmark > 0;
      console.log(
        includeBenchmark
          ? ["Price", "Profit (total)", "Portfolio value", "Underlying P&L (portfolio)"]
              .join("\t")
          : ["Price", "Profit (total)"].join("\t")
      );
      for (const r of rows) {
        if (includeBenchmark && spotNum && sharesForBenchmark) {
          const bench = underlyingPnL({ spot: spotNum, priceAtExpiry: r.price, shares: sharesForBenchmark });
          console.log(`${r.price}\t${formatUSD(r.profit)}\t${formatUSD(bench)}`);
        } else {
          const value = portfolio + r.profit;
        console.log(`${r.price}\t${formatUSD(r.profit)}\t${formatUSD(value)}`);
        }
      }

      const breakeven = bullCallSpreadBreakeven({ longStrike, netDebitPerShare: debit });
      const maxProfitStrike = bullCallSpreadMaxProfitStrike({ longStrike, shortStrike });
      const maxProfit = bullCallSpreadMaxProfitPerContract({ longStrike, shortStrike, netDebitPerShare: debit, contractSize });
      const maxLoss = bullCallSpreadMaxLossPerContract({ netDebitPerShare: debit, contractSize });
      const totalMaxProfit = maxProfit * sizedContracts;
      const totalMaxLoss = maxLoss * sizedContracts;
      const maxPortfolioValue = portfolio + totalMaxProfit;
      console.log("\nBreakeven:", breakeven);
      console.log("Max profit strike:", maxProfitStrike);
      console.log("Max profit per contract:", formatUSD(maxProfit));
      console.log("Max profit total:", formatUSD(totalMaxProfit));
      console.log("Portfolio value at max profit:", formatUSD(maxPortfolioValue));
      console.log("Max loss per contract:", formatUSD(maxLoss));
      console.log("Max loss total:", formatUSD(totalMaxLoss));
    } else {
      // Single point P&L
      const pnl = bullCallSpreadProfit({
        longStrike,
        shortStrike,
        priceAtExpiry: priceAtExpiry as number,
        netDebitPerShare: debit,
        contractSize,
        contracts: sizedContracts,
        portfolioSize: portfolio,
      });
      const contractNote = contractsDerivedFromPortfolio ? " (derived from portfolio)" : "";
      console.log(
        `P&L for ${longStrike}/${shortStrike} @ $${priceAtExpiry} (debit $${debit} per share, contractSize=${contractSize}, contracts=${sizedContracts}${contractNote}, portfolioSize=${portfolio}): ${formatUSD(pnl)}\n`
      );

      if (Number.isFinite(spotPrice ?? NaN)) {
        const s = spotPrice as number;
        const sharesForBenchmark = Math.floor(portfolio / s);
        if (sharesForBenchmark > 0) {
          const bench = underlyingPnL({ spot: s, priceAtExpiry: priceAtExpiry as number, shares: sharesForBenchmark });
          console.log(
            `Underlying benchmark P&L (buy with portfolio @ $${s} → $${priceAtExpiry}, shares=${sharesForBenchmark}): ${formatUSD(bench)}`
          );
        }
      }

      const breakeven = bullCallSpreadBreakeven({ longStrike, netDebitPerShare: debit });
      const maxProfitStrike = bullCallSpreadMaxProfitStrike({ longStrike, shortStrike });
      const maxProfit = bullCallSpreadMaxProfitPerContract({ longStrike, shortStrike, netDebitPerShare: debit, contractSize });
      const maxLoss = bullCallSpreadMaxLossPerContract({ netDebitPerShare: debit, contractSize });
      const totalMaxProfit = maxProfit * sizedContracts;
      const totalMaxLoss = maxLoss * sizedContracts;
      const maxPortfolioValue = portfolio + totalMaxProfit;
      const portfolioValueAtExpiry = portfolio + pnl;
      console.log("Breakeven:", breakeven);
      console.log("Max profit strike:", maxProfitStrike);
      console.log("Max profit per contract:", formatUSD(maxProfit));
      console.log("Max Portfolio profit:", formatUSD(totalMaxProfit));
      console.log("Portfolio value at expiry:", formatUSD(portfolioValueAtExpiry));
      console.log("Portfolio value at max profit:", formatUSD(maxPortfolioValue));
      console.log("Max loss per contract:", formatUSD(maxLoss));
      console.log("Max Portfolio loss:", formatUSD(totalMaxLoss));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error:", msg);
    process.exit(1);
  }
};

if (require.main === module) void main();
