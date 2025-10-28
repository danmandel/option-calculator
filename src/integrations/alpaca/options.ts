import { DATA_BASE_URL, fetchJson } from "./client";
import {
  approxEqual,
  buildOccOptionSymbol,
  computeMidFromQuote,
  normalizeExpirationInput,
  normalizeQuote,
  sanitizeOptionSymbol,
  type NormalizedContract,
  type NormalizedQuote,
  expirationToUnixSeconds,
  optionTypeFromSymbolOrField,
  toFiniteNumber,
} from "./normalize";

interface ChainMatch {
  expiration: string;
  long: NormalizedContract;
  short: NormalizedContract;
}

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
      const sanitized = sanitizeOptionSymbol(symbol);
      if (sanitized.length >= 15) {
        const year = Number(`20${sanitized.slice(-15, -13)}`);
        const month = Number(sanitized.slice(-13, -11));
        const day = Number(sanitized.slice(-11, -9));
        if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
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
      if (hasOptionFields && maybeQuoteFields) consider(record);
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
  const buckets = new Map<string, { long?: NormalizedContract; short?: NormalizedContract }>();

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
      candidates.push({ expiration, long: pair.long, short: pair.short });
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

    for (let page = 0; page < 4; page++) {
      const url = new URL(endpoint);
      if (pageToken) url.searchParams.set("page_token", pageToken);
      try {
        const payload = await fetchJson(url);
        const contracts = gatherContractsFromResponse(payload);
        collected.push(...contracts);
        const next = (payload as any)?.next_page_token ?? (payload as any)?.nextPageToken;
        pageToken = typeof next === "string" && next.trim() ? String(next) : undefined;
      } catch {
        break;
      }
      if (!pageToken) break;
    }

    const match = pickBestMatch(collected, longStrike, shortStrike, normalizedExpiration);
    if (match) return match;
  }
  return undefined;
};

const fetchLatestQuotes = async (symbols: string[]): Promise<Record<string, NormalizedQuote>> => {
  const uniqueSymbols = [...new Set(symbols.map((s) => sanitizeOptionSymbol(s)))];
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
    } catch {
      continue;
    }
    if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      const quotesNode = record.quotes ?? record.data ?? record.results;
      if (Array.isArray(quotesNode)) {
        for (const entry of quotesNode) {
          if (!entry || typeof entry !== "object") continue;
          const quoteRecord = entry as Record<string, unknown>;
          const symbolRaw = quoteRecord.symbol ?? quoteRecord.option_symbol ?? quoteRecord.occ_symbol ?? quoteRecord.contract_symbol;
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
    if (uniqueSymbols.every((sym) => accumulated[sym])) break;
  }
  return accumulated;
};

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
  expiration: number; // unix seconds
}

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
      const match = await fetchContractsFromChain(symbol, longStrike, shortStrike, normalizedExpiration);
      if (!match) throw new Error(`Unable to locate both strikes ${longStrike}/${shortStrike} for ${symbol} at expiration ${normalizedExpiration} via Alpaca.`);
      longContract = match.long;
      shortContract = match.short;
      resolvedExpiration = match.expiration;
    }
  } else {
    const match = await fetchContractsFromChain(symbol, longStrike, shortStrike);
    if (!match) throw new Error(`Unable to locate both strikes ${longStrike}/${shortStrike} for ${symbol} via Alpaca. Try providing --expiry (YYYY-MM-DD).`);
    longContract = match.long;
    shortContract = match.short;
    resolvedExpiration = match.expiration;
  }

  if (!longContract || !shortContract || !resolvedExpiration) throw new Error(`Failed to resolve contracts for ${symbol}.`);

  const missingSymbols: string[] = [];
  if (!longContract.quote) missingSymbols.push(longContract.symbol);
  if (!shortContract.quote) missingSymbols.push(shortContract.symbol);
  if (missingSymbols.length > 0) {
    const fetched = await fetchLatestQuotes(missingSymbols);
    if (!longContract.quote && fetched[longContract.symbol]) longContract.quote = fetched[longContract.symbol];
    if (!shortContract.quote && fetched[shortContract.symbol]) shortContract.quote = fetched[shortContract.symbol];
  }
  if (!longContract.quote) throw new Error(`Missing quote data for long strike ${longStrike} (${longContract.symbol}).`);
  if (!shortContract.quote) throw new Error(`Missing quote data for short strike ${shortStrike} (${shortContract.symbol}).`);

  const longMid = computeMidFromQuote(longContract.quote, `${symbol} ${longContract.symbol}`);
  const shortMid = computeMidFromQuote(shortContract.quote, `${symbol} ${shortContract.symbol}`);
  const netDebitPerShare = longMid - shortMid;
  const expirationSeconds = expirationToUnixSeconds(resolvedExpiration);
  return { netDebitPerShare, longMid, shortMid, expiration: expirationSeconds };
};

