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

const YAHOO_BASE_URL = "https://query2.finance.yahoo.com/v7/finance/options/";
const STRIKE_EPSILON = 1e-6;

interface YahooOptionContract {
  strike: number;
  bid?: number | null;
  ask?: number | null;
  lastPrice?: number | null;
}

interface YahooOptionChainOption {
  expirationDate: number;
  calls?: YahooOptionContract[];
}

interface YahooOptionChainResult {
  expirationDates?: number[];
  options?: YahooOptionChainOption[];
}

interface YahooOptionChainResponse {
  optionChain?: {
    result?: YahooOptionChainResult[];
    error?: { code?: string; description?: string };
  };
}

const toFiniteNumber = (value: unknown): number | undefined => {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const midFromContract = (contract: YahooOptionContract): number => {
  const bid = toFiniteNumber(contract.bid);
  const ask = toFiniteNumber(contract.ask);
  if (bid !== undefined && ask !== undefined) {
    const mid = (bid + ask) / 2;
    if (Number.isFinite(mid)) return mid;
  }
  const lastPrice = toFiniteNumber(contract.lastPrice);
  if (lastPrice !== undefined) return lastPrice;
  if (ask !== undefined) return ask;
  if (bid !== undefined) return bid;
  throw new Error("Unable to determine mid price from Yahoo Finance data.");
};

const parseExpiration = (expiration: string): number => {
  const trimmed = expiration.trim();
  if (trimmed === "") throw new Error("Expiration cannot be empty.");

  // Allow passing a Unix timestamp directly.
  if (/^\d+$/.test(trimmed)) {
    const asNumber = Number(trimmed);
    if (!Number.isFinite(asNumber) || asNumber <= 0)
      throw new Error("Expiration timestamp must be a positive number.");
    return Math.floor(asNumber);
  }

  const date = new Date(trimmed);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) throw new Error(`Unable to parse expiration "${expiration}". Use YYYY-MM-DD or a Unix timestamp.`);
  return Math.floor(ms / 1000);
};

const fetchOptionChain = async (symbol: string, expiration?: number): Promise<YahooOptionChainResult> => {
  const url = new URL(`${YAHOO_BASE_URL}${encodeURIComponent(symbol)}`);
  if (expiration !== undefined) url.searchParams.set("date", String(Math.floor(expiration)));

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; option-calculator/1.0)",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance request failed (${res.status} ${res.statusText}).`);
  }

  const json = (await res.json()) as YahooOptionChainResponse;
  const result = json.optionChain?.result?.[0];
  if (!result) {
    const err = json.optionChain?.error;
    if (err?.description) throw new Error(`Yahoo Finance error: ${err.description}`);
    throw new Error("Unexpected Yahoo Finance response: missing option chain data.");
  }

  return result;
};

const findCallByStrike = (calls: YahooOptionContract[] | undefined, strike: number): YahooOptionContract | undefined => {
  if (!calls) return undefined;
  return calls.find((c) => Number.isFinite(c.strike) && Math.abs(c.strike - strike) < STRIKE_EPSILON);
};

const evaluateChainForStrikes = (
  chain: YahooOptionChainResult,
  longStrike: number,
  shortStrike: number
): { contract: YahooOptionChainOption; longCall: YahooOptionContract; shortCall: YahooOptionContract } | null => {
  if (!Array.isArray(chain.options)) return null;
  for (const option of chain.options) {
    const longCall = findCallByStrike(option.calls, longStrike);
    const shortCall = findCallByStrike(option.calls, shortStrike);
    if (longCall && shortCall) {
      return { contract: option, longCall, shortCall };
    }
  }
  return null;
};

export const fetchSpreadMidDebit = async (params: FetchSpreadDebitParams): Promise<FetchSpreadDebitResult> => {
  const { symbol, longStrike, shortStrike, expiration } = params;
  if (!symbol || !symbol.trim()) throw new Error("Symbol is required to fetch mid prices from Yahoo Finance.");
  if (!Number.isFinite(longStrike) || !Number.isFinite(shortStrike))
    throw new Error("Both longStrike and shortStrike must be finite numbers.");

  const normalizedSymbol = symbol.trim().toUpperCase();
  const explicitExpiration = expiration ? parseExpiration(expiration) : undefined;

  if (explicitExpiration !== undefined) {
    const chain = await fetchOptionChain(normalizedSymbol, explicitExpiration);
    const match = evaluateChainForStrikes(chain, longStrike, shortStrike);
    if (!match)
      throw new Error(
        `Could not locate both strikes ${longStrike}/${shortStrike} for ${normalizedSymbol} at expiration ${explicitExpiration}.`
      );
    const longMid = midFromContract(match.longCall);
    const shortMid = midFromContract(match.shortCall);
    return {
      netDebitPerShare: longMid - shortMid,
      longMid,
      shortMid,
      expiration: match.contract.expirationDate,
    };
  }

  const visitedExpirations = new Set<number>();
  const queue: number[] = [];

  const processChain = (
    chain: YahooOptionChainResult
  ): { longMid: number; shortMid: number; expiration: number } | null => {
    const match = evaluateChainForStrikes(chain, longStrike, shortStrike);
    if (match) {
      const longMid = midFromContract(match.longCall);
      const shortMid = midFromContract(match.shortCall);
      return { longMid, shortMid, expiration: match.contract.expirationDate };
    }
    if (Array.isArray(chain.options)) {
      for (const opt of chain.options) {
        if (Number.isFinite(opt.expirationDate)) {
          visitedExpirations.add(opt.expirationDate);
        }
      }
    }
    if (Array.isArray(chain.expirationDates)) {
      for (const ts of chain.expirationDates) {
        if (Number.isFinite(ts) && !visitedExpirations.has(ts)) {
          queue.push(ts);
          visitedExpirations.add(ts);
        }
      }
    }
    return null;
  };

  const initialChain = await fetchOptionChain(normalizedSymbol);
  const initialResult = processChain(initialChain);
  if (initialResult) {
    return {
      netDebitPerShare: initialResult.longMid - initialResult.shortMid,
      longMid: initialResult.longMid,
      shortMid: initialResult.shortMid,
      expiration: initialResult.expiration,
    };
  }

  while (queue.length > 0) {
    const nextExpiration = queue.shift();
    if (nextExpiration === undefined) continue;
    const chain = await fetchOptionChain(normalizedSymbol, nextExpiration);
    const result = processChain(chain);
    if (result) {
      return {
        netDebitPerShare: result.longMid - result.shortMid,
        longMid: result.longMid,
        shortMid: result.shortMid,
        expiration: result.expiration,
      };
    }
  }

  throw new Error(`Unable to locate strikes ${longStrike}/${shortStrike} for ${normalizedSymbol} in Yahoo Finance option chain.`);
};
