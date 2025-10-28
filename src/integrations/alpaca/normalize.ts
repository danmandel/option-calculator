export type OptionType = "call" | "put" | undefined;

export interface NormalizedQuote {
  ask?: number;
  bid?: number;
  last?: number;
  mid?: number;
}

export interface NormalizedContract {
  symbol: string;
  strike: number;
  expiration: string; // YYYY-MM-DD
  quote?: NormalizedQuote;
}

export const STRIKE_EPSILON = 1e-6;

export const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

export const approxEqual = (a: number, b: number, epsilon = STRIKE_EPSILON): boolean => Math.abs(a - b) <= epsilon;

export const sanitizeOptionSymbol = (symbol: string): string => symbol.replace(/\s+/g, "").toUpperCase();

export const normalizeExpirationInput = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Expiration value cannot be empty.");
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    const date = new Date(numeric * (numeric > 10_000_000_000 ? 1 : 1000));
    if (!Number.isFinite(date.getTime())) throw new Error(`Unable to interpret expiration "${input}".`);
    return date.toISOString().slice(0, 10);
  }
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Unable to interpret expiration "${input}". Use YYYY-MM-DD.`);
  return parsed.toISOString().slice(0, 10);
};

export const expirationToUnixSeconds = (expiration: string): number => {
  const ms = Date.parse(expiration);
  if (!Number.isFinite(ms)) throw new Error(`Unable to parse expiration date "${expiration}".`);
  return Math.floor(ms / 1000);
};

export const buildOccOptionSymbol = (
  underlying: string,
  expiration: string,
  strike: number,
  type: "C" | "P"
): string => {
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

export const optionTypeFromSymbolOrField = (symbol: string | undefined, field: unknown): OptionType => {
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

export const extractQuoteFields = (raw: Record<string, unknown> | undefined): NormalizedQuote | undefined => {
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

export const normalizeQuote = (raw: unknown): NormalizedQuote | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
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

export const computeMidFromQuote = (quote: NormalizedQuote, description: string): number => {
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

