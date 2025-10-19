export interface FetchSpreadDebitParams {
  symbol: string;
  longStrike: number;
  shortStrike: number;
  expiration?: string;
}

export interface FetchSpreadDebitResult {
  netDebitPerShare: number;
  longMid: number;
  shortMid: number;
  expiration: number;
}

type OptionType = "call" | "put" | undefined;

interface NormalizedQuote {
  ask?: number;
  bid?: number;
  last?: number;
  mid?: number;
}

interface NormalizedContract {
  symbol: string;
  strike: number;
  expiration: string;
  quote?: NormalizedQuote;
}

interface ChainMatch {
  expiration: string;
  long: NormalizedContract;
  short: NormalizedContract;
}

const DATA_BASE_URL = process.env.ALPACA_DATA_BASE_URL?.replace(/\/+$/, "") ?? "https://data.alpaca.markets";
const API_KEY = process.env.ALPACA_API_KEY_ID ?? process.env.ALPACA_API_KEY ?? process.env.APCA_API_KEY_ID;
const API_SECRET =
  process.env.ALPACA_API_SECRET_KEY ??
  process.env.ALPACA_API_SECRET ??
  process.env.APCA_API_SECRET_KEY ??
  process.env.ALPACA_SECRET_KEY;

const STRIKE_EPSILON = 1e-6;

const requireEnv = (name: string, value?: string): string => {
  if (value && value.trim()) return value;
  throw new Error(`Missing required environment variable ${name}. Add it to your .env file.`);
};

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const approxEqual = (a: number, b: number, epsilon = STRIKE_EPSILON): boolean => {
  return Math.abs(a - b) <= epsilon;
};

const sanitizeOptionSymbol = (symbol: string): string => symbol.replace(/\s+/g, "").toUpperCase();

const normalizeExpirationInput = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Expiration value cannot be empty.");

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    const date = new Date(numeric * (numeric > 10_000_000_000 ? 1 : 1000)); // detect ms vs sec
    if (!Number.isFinite(date.getTime())) throw new Error(`Unable to interpret expiration "${input}".`);
    return date.toISOString().slice(0, 10);
  }

  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Unable to interpret expiration "${input}". Use YYYY-MM-DD.`);
  return parsed.toISOString().slice(0, 10);
};

const expirationToUnixSeconds = (expiration: string): number => {
  const ms = Date.parse(expiration);
  if (!Number.isFinite(ms)) throw new Error(`Unable to parse expiration date "${expiration}".`);
  return Math.floor(ms / 1000);
};

const buildOccOptionSymbol = (underlying: string, expiration: string, strike: number, type: "C" | "P"): string => {
  const upper = underlying.trim().toUpperCase();
  if (!upper) throw new Error("Underlying symbol cannot be empty.");
  const parsed = new Date(`${expiration}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid expiration date "${expiration}".`);

  const year = String(parsed.getUTCFullYear()).slice(-2);
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");

  const strikeInt = Math.round(strike * 1000);
  if (!Number.isFinite(strikeInt)) throw new Error(`Invalid strike price "${strike}".`);
  const strikeStr = String(strikeInt).padStart(8, "0");

  return `${upper}${year}${month}${day}${type}${strikeStr}`;
};

const optionTypeFromSymbolOrField = (symbol: string | undefined, field: unknown): OptionType => {
  if (typeof field === "string") {
    const normalized = field.trim().toLowerCase();
    if (normalized === "call" || normalized === "c" || normalized === "buy_call") return "call";
    if (normalized === "put" || normalized === "p" || normalized === "buy_put") return "put";
  }
  if (symbol) {
    const sanitized = sanitizeOptionSymbol(symbol);
    const typeChar = sanitized.slice(-9, -8);
    if (typeChar === "C") return "call";
    if (typeChar === "P") return "put";
  }
  return undefined;
};

const ensureHeaders = (): Record<string, string> => ({
  Accept: "application/json",
  "APCA-API-KEY-ID": requireEnv("ALPACA_API_KEY_ID", API_KEY),
  "APCA-API-SECRET-KEY": requireEnv("ALPACA_API_SECRET_KEY", API_SECRET),
});

const fetchJson = async (url: URL): Promise<unknown> => {
  const res = await fetch(url.toString(), { headers: ensureHeaders() });
  if (!res.ok) {
    throw new Error(`Alpaca API request failed (${res.status} ${res.statusText}) for ${url.pathname}`);
  }
  return res.json() as Promise<unknown>;
};

const extractQuoteFields = (raw: Record<string, unknown> | undefined): NormalizedQuote | undefined => {
  if (!raw) return undefined;
  const ask =
    toFiniteNumber(raw.ask_price) ??
    toFiniteNumber(raw.ask) ??
    toFiniteNumber(raw.ap) ??
    toFiniteNumber(raw.askPrice) ??
    toFiniteNumber(raw.ask_value);
  const bid =
    toFiniteNumber(raw.bid_price) ??
    toFiniteNumber(raw.bid) ??
    toFiniteNumber(raw.bp) ??
    toFiniteNumber(raw.bidPrice) ??
    toFiniteNumber(raw.bid_value);
  const last =
    toFiniteNumber(raw.last_price) ??
    toFiniteNumber(raw.last) ??
    toFiniteNumber(raw.lp) ??
    toFiniteNumber(raw.lastPrice) ??
    toFiniteNumber(raw.trade_price);
  const mid =
    toFiniteNumber(raw.mid_price) ??
    toFiniteNumber(raw.mid) ??
    toFiniteNumber(raw.mark_price) ??
    toFiniteNumber(raw.mark) ??
    toFiniteNumber(raw.theoretical);

  if (ask !== undefined || bid !== undefined || last !== undefined || mid !== undefined) {
    return { ask, bid, last, mid };
  }
  return undefined;
};

const normalizeQuote = (raw: unknown): NormalizedQuote | undefined => {
  if (!raw || typeof raw !== "object") return undefined;

  // Common Alpaca response shapes
  const direct = extractQuoteFields(raw as Record<string, unknown>);
  if (direct) return direct;

  const maybeQuote =
    (raw as Record<string, unknown>).quote ??
    (raw as Record<string, unknown>).quotes ??
    (raw as Record<string, unknown>).last_quote ??
    (raw as Record<string, unknown>).latestQuote ??
    (raw as Record<string, unknown>).latest_quote;

  if (maybeQuote && typeof maybeQuote === "object") {
    return extractQuoteFields(maybeQuote as Record<string, unknown>);
  }
  return undefined;
};

const computeMidFromQuote = (quote: NormalizedQuote, description: string): number => {
  const { ask, bid, mid, last } = quote;
  if (bid !== undefined && ask !== undefined) {
    const mean = (bid + ask) / 2;
    if (Number.isFinite(mean)) return mean;
  }
  if (mid !== undefined && Number.isFinite(mid)) return mid;
  if (last !== undefined && Number.isFinite(last)) return last;
  if (ask !== undefined && Number.isFinite(ask)) return ask;
  if (bid !== undefined && Number.isFinite(bid)) return bid;
  throw new Error(`No usable quote data available for ${description}.`);
};

const gatherContractsFromResponse = (payload: unknown): NormalizedContract[] => {
  const results: NormalizedContract[] = [];
  const seen = new Set<string>();

  const consider = (candidate: Record<string, unknown>): void => {
    const rawSymbol =
      candidate.symbol ??
      candidate.option_symbol ??
      candidate.occ_symbol ??
      candidate.OCCSymbol ??
      candidate.contract_symbol;
    const symbol = typeof rawSymbol === "string" ? rawSymbol : undefined;
    if (!symbol) return;

    const optionType = optionTypeFromSymbolOrField(symbol, candidate.type ?? candidate.option_type ?? candidate.class);
    if (optionType !== "call") return;

    const strike =
      toFiniteNumber(candidate.strike_price) ??
      toFiniteNumber(candidate.strike) ??
      toFiniteNumber(candidate.strikePrice) ??
      toFiniteNumber(candidate.strike_price_value);
    if (strike === undefined) return;

    const expirationRaw =
      candidate.expiration_date ??
      candidate.expiration ??
      candidate.expiry ??
      candidate.expirationDate ??
      candidate.exp_date ??
      candidate.option_expiration;

    let expiration: string | undefined =
      typeof expirationRaw === "string" && expirationRaw.trim()
        ? expirationRaw.trim()
        : expirationRaw && typeof expirationRaw === "number"
        ? new Date((expirationRaw > 10_000_000_000 ? expirationRaw : expirationRaw * 1000)).toISOString()
        : undefined;

    if (!expiration) {
      // Try deriving from the OCC symbol.
      const sanitized = sanitizeOptionSymbol(symbol);
      if (sanitized.length >= 15) {
        const year = Number(`20${sanitized.slice(-15, -13)}`);
        const month = Number(sanitized.slice(-13, -11));
        const day = Number(sanitized.slice(-11, -9));
        if (
          Number.isFinite(year) &&
          Number.isFinite(month) &&
          Number.isFinite(day) &&
          month >= 1 &&
          month <= 12 &&
          day >= 1 &&
          day <= 31
        ) {
          expiration = new Date(Date.UTC(year, month - 1, day)).toISOString();
        }
      }
    }

    if (!expiration) return;
    const expirationIso = expiration.includes("T") ? expiration.slice(0, 10) : normalizeExpirationInput(expiration);

    const normalizedSymbol = sanitizeOptionSymbol(symbol);
    if (seen.has(`${normalizedSymbol}-${expirationIso}-${strike}`)) return;
    seen.add(`${normalizedSymbol}-${expirationIso}-${strike}`);

    const quote = normalizeQuote(candidate);

    results.push({
      symbol: normalizedSymbol,
      strike,
      expiration: expirationIso,
      quote,
    });
  };

  const traverse = (value: unknown): void => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) traverse(item);
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      const hasOptionFields =
        ("symbol" in record || "occ_symbol" in record || "option_symbol" in record) &&
        ("strike" in record || "strike_price" in record || "strikePrice" in record);
      const maybeQuoteFields = "ask" in record || "bid" in record || "ask_price" in record || "bid_price" in record;

      if (hasOptionFields && maybeQuoteFields) {
        consider(record);
      }

      for (const key of Object.keys(record)) {
        const child = record[key];
        if (child && typeof child === "object") traverse(child);
      }
    }
  };

  traverse(payload);
  return results;
};

const pickBestMatch = (
  contracts: NormalizedContract[],
  longStrike: number,
  shortStrike: number,
  explicitExpiration?: string
): ChainMatch | undefined => {
  const buckets = new Map<
    string,
    {
      long?: NormalizedContract;
      short?: NormalizedContract;
    }
  >();

  for (const contract of contracts) {
    if (explicitExpiration && normalizeExpirationInput(contract.expiration) !== explicitExpiration) continue;

    if (approxEqual(contract.strike, longStrike)) {
      const bucket = buckets.get(contract.expiration) ?? {};
      bucket.long = contract;
      buckets.set(contract.expiration, bucket);
    } else if (approxEqual(contract.strike, shortStrike)) {
      const bucket = buckets.get(contract.expiration) ?? {};
      bucket.short = contract;
      buckets.set(contract.expiration, bucket);
    }
  }

  const candidates: ChainMatch[] = [];
  for (const [expiration, pair] of buckets) {
    if (pair.long && pair.short) {
      candidates.push({
        expiration,
        long: pair.long,
        short: pair.short,
      });
    }
  }

  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => Date.parse(a.expiration) - Date.parse(b.expiration));
  return candidates[0];
};

const fetchContractsFromChain = async (
  symbol: string,
  longStrike: number,
  shortStrike: number,
  expiration?: string
): Promise<ChainMatch | undefined> => {
  const normalizedExpiration = expiration ? normalizeExpirationInput(expiration) : undefined;
  const endpoints = [
    `${DATA_BASE_URL}/v2/options/chain/${encodeURIComponent(symbol)}`,
    `${DATA_BASE_URL}/v1beta1/options/chain/${encodeURIComponent(symbol)}`,
  ];

  for (const endpoint of endpoints) {
    let pageToken: string | undefined;
    const collected: NormalizedContract[] = [];

    try {
      do {
        const url = new URL(endpoint);
        if (normalizedExpiration) url.searchParams.set("expiration", normalizedExpiration);
        if (pageToken) url.searchParams.set("page_token", pageToken);
        url.searchParams.set("limit", "1000");

        const payload = await fetchJson(url);
        collected.push(...gatherContractsFromResponse(payload));

        const nextToken =
          typeof (payload as { next_page_token?: unknown }).next_page_token === "string"
            ? ((payload as { next_page_token?: unknown }).next_page_token as string)
            : undefined;
        pageToken = nextToken && nextToken.trim() !== "" ? nextToken : undefined;
      } while (pageToken);
    } catch (err) {
      // Try next endpoint if first fails.
      continue;
    }

    const match = pickBestMatch(collected, longStrike, shortStrike, normalizedExpiration);
    if (match) return match;
  }
  return undefined;
};

const fetchLatestQuotes = async (symbols: string[]): Promise<Record<string, NormalizedQuote>> => {
  const uniqueSymbols = Array.from(new Set(symbols.map((s) => sanitizeOptionSymbol(s))));
  if (uniqueSymbols.length === 0) return {};

  const endpoints = [
    `${DATA_BASE_URL}/v2/options/quotes/latest`,
    `${DATA_BASE_URL}/v1beta1/options/quotes/latest`,
  ];

  const accumulated: Record<string, NormalizedQuote> = {};

  for (const endpoint of endpoints) {
    const url = new URL(endpoint);
    url.searchParams.set("symbols", uniqueSymbols.join(","));

    let payload: unknown;
    try {
      payload = await fetchJson(url);
    } catch (err) {
      continue;
    }

    if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      const quotesNode = record.quotes ?? record.data ?? record.results;

      if (Array.isArray(quotesNode)) {
        for (const entry of quotesNode) {
          if (!entry || typeof entry !== "object") continue;
          const quoteRecord = entry as Record<string, unknown>;
          const symbolRaw =
            quoteRecord.symbol ??
            quoteRecord.option_symbol ??
            quoteRecord.occ_symbol ??
            quoteRecord.contract_symbol;
          const symbol = typeof symbolRaw === "string" ? sanitizeOptionSymbol(symbolRaw) : undefined;
          if (!symbol) continue;
          const quote = normalizeQuote(entry);
          if (quote) accumulated[symbol] = quote;
        }
      } else if (quotesNode && typeof quotesNode === "object") {
        for (const [key, value] of Object.entries(quotesNode as Record<string, unknown>)) {
          if (!key) continue;
          const normalizedKey = sanitizeOptionSymbol(key);
          const quote = normalizeQuote(value);
          if (quote) accumulated[normalizedKey] = quote;
        }
      }
    }

    // Early exit if we have all symbols.
    if (uniqueSymbols.every((sym) => accumulated[sym])) break;
  }

  return accumulated;
};

export const fetchSpreadMidDebit = async (params: FetchSpreadDebitParams): Promise<FetchSpreadDebitResult> => {
  const { symbol: rawSymbol, longStrike, shortStrike, expiration } = params;

  if (!rawSymbol || !rawSymbol.trim()) throw new Error("Symbol is required for Alpaca lookup.");
  if (!Number.isFinite(longStrike) || !Number.isFinite(shortStrike))
    throw new Error("Both longStrike and shortStrike must be finite numbers.");

  const symbol = rawSymbol.trim().toUpperCase();

  const normalizedExpiration = expiration ? normalizeExpirationInput(expiration) : undefined;

  let longContract: NormalizedContract | undefined;
  let shortContract: NormalizedContract | undefined;
  let resolvedExpiration: string | undefined = normalizedExpiration;

  if (normalizedExpiration) {
    const longSymbol = buildOccOptionSymbol(symbol, normalizedExpiration, longStrike, "C");
    const shortSymbol = buildOccOptionSymbol(symbol, normalizedExpiration, shortStrike, "C");

    const quotes = await fetchLatestQuotes([longSymbol, shortSymbol]);

    const longQuote = quotes[sanitizeOptionSymbol(longSymbol)];
    const shortQuote = quotes[sanitizeOptionSymbol(shortSymbol)];

    if (longQuote && shortQuote) {
      longContract = { symbol: sanitizeOptionSymbol(longSymbol), strike: longStrike, expiration: normalizedExpiration, quote: longQuote };
      shortContract = { symbol: sanitizeOptionSymbol(shortSymbol), strike: shortStrike, expiration: normalizedExpiration, quote: shortQuote };
    } else {
      // Fall back to chain lookup (maybe the contract symbol rounding differs).
      const match = await fetchContractsFromChain(symbol, longStrike, shortStrike, normalizedExpiration);
      if (!match) {
        throw new Error(
          `Unable to locate both strikes ${longStrike}/${shortStrike} for ${symbol} at expiration ${normalizedExpiration} via Alpaca.`
        );
      }
      longContract = match.long;
      shortContract = match.short;
      resolvedExpiration = match.expiration;
    }
  } else {
    const match = await fetchContractsFromChain(symbol, longStrike, shortStrike);
    if (!match) {
      throw new Error(
        `Unable to locate both strikes ${longStrike}/${shortStrike} for ${symbol} via Alpaca. Try providing --expiry (YYYY-MM-DD).`
      );
    }
    longContract = match.long;
    shortContract = match.short;
    resolvedExpiration = match.expiration;
  }

  if (!longContract || !shortContract || !resolvedExpiration) {
    throw new Error(`Failed to resolve contracts for ${symbol}.`);
  }

  // Ensure we have quote data; fetch missing quotes explicitly if necessary.
  const missingSymbols: string[] = [];
  if (!longContract.quote) missingSymbols.push(longContract.symbol);
  if (!shortContract.quote) missingSymbols.push(shortContract.symbol);

  if (missingSymbols.length > 0) {
    const fetched = await fetchLatestQuotes(missingSymbols);
    if (!longContract.quote && fetched[longContract.symbol]) longContract.quote = fetched[longContract.symbol];
    if (!shortContract.quote && fetched[shortContract.symbol]) shortContract.quote = fetched[shortContract.symbol];
  }

  if (!longContract.quote) {
    throw new Error(`Missing quote data for long strike ${longStrike} (${longContract.symbol}).`);
  }
  if (!shortContract.quote) {
    throw new Error(`Missing quote data for short strike ${shortStrike} (${shortContract.symbol}).`);
  }

  const longMid = computeMidFromQuote(longContract.quote, `${symbol} ${longContract.symbol}`);
  const shortMid = computeMidFromQuote(shortContract.quote, `${symbol} ${shortContract.symbol}`);

  const netDebitPerShare = longMid - shortMid;
  const expirationSeconds = expirationToUnixSeconds(resolvedExpiration);

  return {
    netDebitPerShare,
    longMid,
    shortMid,
    expiration: expirationSeconds,
  };
};

/* =========================
   Latest Stock Price (Spot)
   ========================= */

const extractTradePrice = (raw: unknown): number | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const trade = (obj.trade ?? obj.last_trade ?? obj.latest_trade ?? obj.t) as unknown;
  const direct =
    toFiniteNumber(obj.price) ??
    toFiniteNumber(obj.p) ??
    toFiniteNumber(obj.last) ??
    toFiniteNumber(obj.last_price) ??
    toFiniteNumber(obj.close);
  if (direct !== undefined) return direct;
  if (trade && typeof trade === "object") {
    const tObj = trade as Record<string, unknown>;
    return (
      toFiniteNumber(tObj.price) ??
      toFiniteNumber(tObj.p) ??
      toFiniteNumber(tObj.last) ??
      toFiniteNumber(tObj.last_price) ??
      undefined
    );
  }
  return undefined;
};

const fetchLatestEquityQuote = async (symbol: string): Promise<NormalizedQuote | undefined> => {
  const endpoints = [
    `${DATA_BASE_URL}/v2/stocks/quotes/latest`,
    `${DATA_BASE_URL}/v1beta1/stocks/quotes/latest`,
  ];
  for (const endpoint of endpoints) {
    const url = new URL(endpoint);
    url.searchParams.set("symbols", sanitizeOptionSymbol(symbol));
    let payload: unknown;
    try {
      payload = await fetchJson(url);
    } catch {
      continue;
    }
    if (payload && typeof payload === "object") {
      const rec = payload as Record<string, unknown>;
      const root = rec.quotes ?? rec.data ?? rec.results ?? rec;
      if (root && typeof root === "object") {
        // Object keyed by symbol
        const maybe = (root as Record<string, unknown>)[sanitizeOptionSymbol(symbol)] ?? root;
        const quote = normalizeQuote(maybe);
        if (quote) return quote;
      }
    }
  }
  return undefined;
};

export const fetchLatestStockPrice = async (symbol: string): Promise<number> => {
  const normalized = sanitizeOptionSymbol(symbol);
  const tradeEndpoints = [
    `${DATA_BASE_URL}/v2/stocks/trades/latest`,
    `${DATA_BASE_URL}/v1beta1/stocks/trades/latest`,
  ];

  for (const endpoint of tradeEndpoints) {
    const url = new URL(endpoint);
    url.searchParams.set("symbols", normalized);
    try {
      const payload = await fetchJson(url);
      if (payload && typeof payload === "object") {
        const rec = payload as Record<string, unknown>;
        const root = rec.trades ?? rec.data ?? rec.results ?? rec;
        if (Array.isArray(root)) {
          for (const item of root) {
            const price = extractTradePrice(item);
            if (price !== undefined) return price;
          }
        } else if (root && typeof root === "object") {
          const entry = (root as Record<string, unknown>)[normalized] ?? root;
          const price = extractTradePrice(entry);
          if (price !== undefined) return price;
        }
      }
    } catch {
      // try next endpoint
      continue;
    }
  }

  // Fallback to quote mid or last
  const quote = await fetchLatestEquityQuote(normalized);
  if (quote) return computeMidFromQuote(quote, `${normalized} equity quote`);

  throw new Error(`Unable to fetch latest stock price for ${normalized} via Alpaca.`);
};
