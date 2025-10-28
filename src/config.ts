const trim = (s: string | undefined): string | undefined => (s && s.trim() ? s.trim() : undefined);

export const env = {
  ALPACA_DATA_BASE_URL: trim(process.env.ALPACA_DATA_BASE_URL) ?? "https://data.alpaca.markets",
  ALPACA_API_KEY_ID: trim(process.env.ALPACA_API_KEY_ID ?? process.env.ALPACA_API_KEY ?? process.env.APCA_API_KEY_ID),
  ALPACA_API_SECRET_KEY: trim(
    process.env.ALPACA_API_SECRET_KEY ??
      process.env.ALPACA_API_SECRET ??
      process.env.APCA_API_SECRET_KEY ??
      process.env.ALPACA_SECRET_KEY
  ),
};

export const requireEnv = (name: keyof typeof env): string => {
  const v = env[name];
  if (v) return v;
  throw new Error(`Missing required environment variable ${name}. Add it to your .env file.`);
};

