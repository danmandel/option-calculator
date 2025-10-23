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
  longCallProfit,
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

Debit inputs:
  --symbol <ticker>     Fetch current mid debit via Alpaca Options API (required)
  --debit <num>         Optional override for the fetched net debit per share
  --expiry <YYYY-MM-DD> Optional expiration date for Alpaca lookup (auto-detects if omitted)

Optional:
  --contracts <int>     Number of contracts (override auto sizing)
  --contractSize <int>  Shares per contract (default 100)
  --portfolio <num>     Portfolio size used to size contracts (default 100000)
  --spot <num>          Underlying entry price for benchmark (auto-fetched when possible)

Payoff table options (use one):
  --table "<p1,p2,...>"       Comma-separated prices
  --tableRange "start:end:step"  e.g., "500:900:50"

Examples:
  bun run index.ts --symbol TSLA --long 600 --short 800 --price 750 --debit 70
  bun run index.ts --symbol TSLA --long 200 --short 220 --price 215 --expiry 2024-09-20
  bun run index.ts --symbol TSLA --long 600 --short 800 --debit 70 --tableRange 500:900:50
`);
};

const formatUSD = (n: number): string => {
  const s = n < 0 ? "-$" : "$";
  return s + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
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
    const manualSpotPrice = toNum("spot", args["spot"]);
    if (manualSpotPrice !== undefined && manualSpotPrice <= 0)
      throw new Error("--spot must be a positive number.");
    // Spot price for stock benchmark will be auto-fetched via Alpaca when symbol is provided unless overridden by --spot.
    let netDebitPerShare = toNum("debit", args["debit"]);
    const explicitContracts = toNum("contracts", args["contracts"]);
    const contractSize = toNum("contractSize", args["contractSize"]) ?? 100;
    const portfolio = toNum("portfolio", args["portfolio"]) ?? defaultPortfolioSize;
    const contractsDerivedFromPortfolio = explicitContracts === undefined;
    const rawSymbol = typeof args["symbol"] === "string" ? (args["symbol"] as string).trim() : undefined;
    const symbol = rawSymbol && rawSymbol.length > 0 ? rawSymbol : undefined;
    if (!symbol) {
      printUsage();
      throw new Error("Provide --symbol to fetch spread pricing and benchmarks.");
    }
    const rawExpiry = typeof args["expiry"] === "string" ? (args["expiry"] as string).trim() : undefined;
    const expiry = rawExpiry && rawExpiry.length > 0 ? rawExpiry : undefined;

    // If table flags are present, we build a payoff table; otherwise single-point P&L.
    const tableCsv = typeof args["table"] === "string" ? (args["table"] as string) : undefined;
    const tableRange = typeof args["tableRange"] === "string" ? (args["tableRange"] as string) : undefined;

    if (longStrike === undefined || shortStrike === undefined) {
      printUsage();
      throw new Error("Missing required --long or --short strike.");
    }

    const spreadQuote = await fetchSpreadMidDebit({
      symbol,
      longStrike,
      shortStrike,
      expiration: expiry,
    });
    const quotedDebit = spreadQuote.netDebitPerShare;
    if (!Number.isFinite(quotedDebit)) {
      throw new Error(
        `Unable to obtain a valid net debit from Alpaca for ${symbol.toUpperCase()}.`
      );
    }
    if (netDebitPerShare === undefined) {
      netDebitPerShare = quotedDebit;
    }
    const longCallPremium = spreadQuote.longMid;
    if (!Number.isFinite(longCallPremium) || longCallPremium <= 0) {
      throw new Error(
        `Unable to obtain a valid long call premium for ${symbol.toUpperCase()} via Alpaca.`
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
    const spreadBreakevenPrice = bullCallSpreadBreakeven({ longStrike, netDebitPerShare: debit });
    const sizedContracts = resolveContracts({
      contracts: explicitContracts,
      portfolioSizeValue: portfolio,
      netDebitPerShare: debit,
      contractSize,
    });

    // Try to resolve the latest stock price for benchmark sizing if symbol is provided
    let spotPrice: number | undefined = manualSpotPrice;
    if (spotPrice === undefined) {
      try {
        spotPrice = await fetchLatestStockPrice(symbol);
       
      } catch {
        console.warn(`Warning: unable to fetch latest stock price for ${symbol}. Provide --spot to enable benchmark.`);
      }
    }

    const stockBenchmarkShares =
      spotPrice !== undefined && spotPrice > 0 ? portfolio / spotPrice : undefined;
    const stockBenchmarkAvailable = stockBenchmarkShares !== undefined && spotPrice !== undefined;

    const longCallCostPerContract = longCallPremium * contractSize;
    const longCallContracts = Math.floor(portfolio / longCallCostPerContract);
    if (longCallContracts <= 0) {
      console.warn(
        "Warning: portfolio too small to purchase a single long call contract; skipping long-call benchmark."
      );
    }
    const longCallBenchmarkAvailable =
      Number.isFinite(longCallContracts) && longCallContracts > 0;
    const longCallCapitalDeployed =
      longCallBenchmarkAvailable ? longCallCostPerContract * longCallContracts : undefined;
    const longCallCashRemaining =
      longCallBenchmarkAvailable && longCallCapitalDeployed !== undefined
        ? portfolio - longCallCapitalDeployed
        : undefined;
    const longCallBreakevenPrice = longStrike + longCallPremium;

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
      const includeStockBenchmark = stockBenchmarkAvailable;
      const includeLongCallBenchmark = longCallBenchmarkAvailable;
      const headers = ["Price", "Spread profit", "Spread value"];
      if (includeStockBenchmark) {
        headers.push("Stock value", "Stock profit");
      }
      if (includeLongCallBenchmark) {
        headers.push("Long call value", "Long call profit");
      }
      console.log(headers.join("\t"));
      for (const r of rows) {
        const spreadValue = portfolio + r.profit;
        const row = [String(r.price), formatUSD(r.profit), formatUSD(spreadValue)];
        if (includeStockBenchmark && spotPrice !== undefined && stockBenchmarkShares !== undefined) {
          const stockProfit = underlyingPnL({
            spot: spotPrice,
            priceAtExpiry: r.price,
            shares: stockBenchmarkShares,
          });
          const stockValue = portfolio + stockProfit;
          row.push(formatUSD(stockValue), formatUSD(stockProfit));
        }
        if (includeLongCallBenchmark) {
          const longCallBenchmarkProfit = longCallProfit({
            strike: longStrike,
            priceAtExpiry: r.price,
            premiumPerShare: longCallPremium,
            contractSize,
            contracts: longCallContracts,
          });
          const longCallValue = portfolio + longCallBenchmarkProfit;
          row.push(formatUSD(longCallValue), formatUSD(longCallBenchmarkProfit));
        }
        console.log(row.join("\t"));
      }

      const maxProfitStrike = bullCallSpreadMaxProfitStrike({ longStrike, shortStrike });
      const maxProfit = bullCallSpreadMaxProfitPerContract({
        longStrike,
        shortStrike,
        netDebitPerShare: debit,
        contractSize,
      });
      const maxLoss = bullCallSpreadMaxLossPerContract({ netDebitPerShare: debit, contractSize });
      const totalMaxProfit = maxProfit * sizedContracts;
      const totalMaxLoss = maxLoss * sizedContracts;
      // const spreadMaxPortfolioValue = portfolio + totalMaxProfit;
      const highestPrice = Math.max(...prices);
      const stockProfitAtHighest =
        includeStockBenchmark && spotPrice !== undefined && stockBenchmarkShares !== undefined
          ? underlyingPnL({
              spot: spotPrice,
              priceAtExpiry: highestPrice,
              shares: stockBenchmarkShares,
            })
          : undefined;
      const longCallProfitAtHighest = includeLongCallBenchmark
        ? longCallProfit({
            strike: longStrike,
            priceAtExpiry: highestPrice,
            premiumPerShare: longCallPremium,
            contractSize,
            contracts: longCallContracts,
          })
        : undefined;
      console.log("\nSpread breakeven price:", formatUSD(spreadBreakevenPrice));
      console.log("Long call breakeven price:", formatUSD(longCallBreakevenPrice));
      console.log("Max profit strike:", maxProfitStrike);
      console.log("Max profit per contract:", formatUSD(maxProfit));
      console.log("Spread portfolio max potential profit:", formatUSD(totalMaxProfit));
      if (includeStockBenchmark && spotPrice !== undefined && stockBenchmarkShares !== undefined) {
        console.log("Stock benchmark entry price:", formatUSD(spotPrice));
        console.log(
          "Stock benchmark shares (full allocation):",
          stockBenchmarkShares.toLocaleString(undefined, { maximumFractionDigits: 4 })
        );
        if (stockProfitAtHighest !== undefined) {
          const stockValueAtHighest = portfolio + stockProfitAtHighest;
          console.log(
            `Stock benchmark value at highest table price (${highestPrice}):`,
            formatUSD(stockValueAtHighest)
          );
          console.log(
            "Stock benchmark profit at highest table price:",
            formatUSD(stockProfitAtHighest)
          );
        }
      }
      if (includeLongCallBenchmark) {
        console.log("Long call premium per share:", formatUSD(longCallPremium));
        console.log(
          "Long call contracts (full allocation):",
          longCallContracts.toLocaleString(undefined, { maximumFractionDigits: 0 })
        );
        console.log("Long call cost per contract:", formatUSD(longCallCostPerContract));
        if (longCallCapitalDeployed !== undefined && longCallCashRemaining !== undefined) {
          console.log("Long call capital deployed:", formatUSD(longCallCapitalDeployed));
          console.log("Long call cash remaining:", formatUSD(longCallCashRemaining));
        }
        if (longCallProfitAtHighest !== undefined) {
          const longCallValueAtHighest = portfolio + longCallProfitAtHighest;
          console.log(
            `Long call portfolio value at highest table price (${highestPrice}):`,
            formatUSD(longCallValueAtHighest)
          );
          console.log(
            "Long call profit at highest table price:",
            formatUSD(longCallProfitAtHighest)
          );
        }
      }
      console.log("Max loss per contract:", formatUSD(maxLoss));
      console.log("Spread portfolio loss:", formatUSD(totalMaxLoss));
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

      const spreadPortfolioValueAtExpiry = portfolio + pnl;
      let stockBenchmarkValueAtExpiry: number | undefined;
      if (
        stockBenchmarkAvailable &&
        spotPrice !== undefined &&
        stockBenchmarkShares !== undefined &&
        priceAtExpiry !== undefined
      ) {
        const stockProfitAtExpiry = underlyingPnL({
          spot: spotPrice,
          priceAtExpiry: priceAtExpiry as number,
          shares: stockBenchmarkShares,
        });
        stockBenchmarkValueAtExpiry = portfolio + stockProfitAtExpiry;
      }

      let longCallValueAtExpiry: number | undefined;
      if (longCallBenchmarkAvailable && priceAtExpiry !== undefined) {
        const longCallProfitAtExpiry = longCallProfit({
          strike: longStrike,
          priceAtExpiry: priceAtExpiry as number,
          premiumPerShare: longCallPremium,
          contractSize,
          contracts: longCallContracts,
        });
        longCallValueAtExpiry = portfolio + longCallProfitAtExpiry;
      }

      const maxProfit = bullCallSpreadMaxProfitPerContract({
        longStrike,
        shortStrike,
        netDebitPerShare: debit,
        contractSize,
      });
      const totalMaxProfit = maxProfit * sizedContracts;
      const spreadMaxPortfolioValue = portfolio + totalMaxProfit;

  
      console.log("Spread portfolio value at expiry:", formatUSD(spreadPortfolioValueAtExpiry));
      // console.log("Spread portfolio value at max profit:", formatUSD(spreadMaxPortfolioValue));
      if (stockBenchmarkValueAtExpiry !== undefined) {
        console.log("Stock benchmark portfolio value at expiry:", formatUSD(stockBenchmarkValueAtExpiry));
      }
      if (longCallValueAtExpiry !== undefined) {
        console.log("Long call portfolio value at expiry:", formatUSD(longCallValueAtExpiry));
      }

      console.log(
        `Benchmark spot price for ${symbol.toUpperCase()}: ${
          spotPrice !== undefined ? formatUSD(spotPrice) : "N/A"
        }`
      );
      console.log("Spread breakeven price:", formatUSD(spreadBreakevenPrice));
      console.log("Long call breakeven price:", formatUSD(longCallBreakevenPrice));
      console.log("Spread portfolio value at max profit:", formatUSD(spreadMaxPortfolioValue));
      console.log(
        `Spread summary: ${longStrike}/${shortStrike} @ $${priceAtExpiry} (debit $${debit} per share, contractSize=${contractSize}, contracts=${sizedContracts}${contractNote}, portfolioSize=${portfolio})`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error:", msg);
    process.exit(1);
  }
};

if (require.main === module) void main();
