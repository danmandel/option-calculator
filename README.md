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
# Fetch the spread from Alpaca (override the debit if desired)
bun run index.ts --symbol TSLA --long 600 --short 800 --price 750 --debit 70

# Auto-fetch the spread and expiry-specific quote
bun run index.ts --symbol TSLA --long 300 --short 800 --price 650 --expiry 2028-1-21

# Provide/override the underlying spot for benchmark comparisons
bun run index.ts --symbol TSLA --long 600 --short 800 --price 750 --debit 70 --spot 650
```

The CLI always queries the Alpaca Options API for the latest call option quotes to determine both the spread's net debit and the long-leg premium. Supplying `--debit` simply overrides the fetched debit. `--expiry` is optional—the CLI attempts to locate both strikes automatically when not provided, but supplying an explicit expiration can avoid extra API calls.

Provide `--spot` when you want to override the spot price used for benchmark comparisons. With sufficient inputs the CLI reports, alongside the spread analytics:
- an all-in underlying benchmark (deploy the entire portfolio into the stock)
- an all-in long-call benchmark (buy as many long-leg calls as the portfolio can fund)
