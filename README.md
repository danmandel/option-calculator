# option-calculator
A calculator to help determine optimal trade structure. 99% written by chatgpt5-pro and codex.

## Usage

Create a `.env` file with your Alpaca credentials before querying live data:

```
ALPACA_API_KEY_ID=your-key-id
ALPACA_API_SECRET_KEY=your-secret
# Optional: override the data base URL
# ALPACA_DATA_BASE_URL=https://data.alpaca.markets
```

```bash
# Provide the debit explicitly
bun run index.ts --long 600 --short 800 --price 750 --debit 70

# Or auto-fetch the current mid debit from Alpaca (requires .env credentials)
bun run index.ts --symbol TSLA --long 200 --short 220 --price 215 --expiry 2024-09-20

# Provide/override the underlying spot for benchmark comparisons
bun run index.ts --long 600 --short 800 --price 750 --debit 70 --spot 650

# Supply long call premium manually (when not using --symbol)
bun run index.ts --long 600 --short 800 --price 750 --debit 70 --longPremium 72.5
```

If `--debit` is omitted, the CLI queries the Alpaca Options API for the latest call option quotes, computes the mid prices for each leg, and uses their difference as the spread's net debit per share. `--expiry` is optional—the CLI attempts to locate both strikes automatically when not provided, but supplying an explicit expiration can avoid extra API calls.

Provide `--spot` and/or `--longPremium` when not using `--symbol` to feed the benchmark calculators. With sufficient inputs the CLI reports, alongside the spread analytics:
- an all-in underlying benchmark (deploy the entire portfolio into the stock)
- an all-in long-call benchmark (buy as many long-leg calls as the portfolio can fund)
