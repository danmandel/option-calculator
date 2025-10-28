import { DATA_BASE_URL, fetchJson } from "./client";
import { computeMidFromQuote, normalizeQuote, sanitizeOptionSymbol, toFiniteNumber } from "./normalize";

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

const fetchLatestEquityQuote = async (symbol: string) => {
  const endpoints = [
    `${DATA_BASE_URL}/v2/stocks/quotes/latest`,
    `${DATA_BASE_URL}/v1beta1/stocks/quotes/latest`,
  ];
  const normalized = sanitizeOptionSymbol(symbol);
  for (const endpoint of endpoints) {
    const url = new URL(endpoint);
    url.searchParams.set("symbols", normalized);
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
        const maybe = (root as Record<string, unknown>)[normalized] ?? root;
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
      continue;
    }
  }
  const quote = await fetchLatestEquityQuote(normalized);
  if (quote) return computeMidFromQuote(quote, `${normalized} equity quote`);
  throw new Error(`Unable to fetch latest stock price for ${normalized} via Alpaca.`);
};

