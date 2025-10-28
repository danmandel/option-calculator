import { env, requireEnv } from "../../config";

export const DATA_BASE_URL = (env.ALPACA_DATA_BASE_URL ?? "https://data.alpaca.markets").replace(/\/+$/, "");

const headers = () => ({
  Accept: "application/json",
  "APCA-API-KEY-ID": requireEnv("ALPACA_API_KEY_ID"),
  "APCA-API-SECRET-KEY": requireEnv("ALPACA_API_SECRET_KEY"),
});

export const fetchJson = async (url: URL): Promise<unknown> => {
  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) {
    throw new Error(`Alpaca API request failed (${res.status} ${res.statusText}) for ${url.pathname}`);
  }
  return res.json() as Promise<unknown>;
};

