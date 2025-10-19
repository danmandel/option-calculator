# option-calculator

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.8. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

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
bun run index.ts --symbol TSLA --long 300 --short 800 --price 550 --expiry 2027-01-15
```

If `--debit` is omitted, the CLI queries the Alpaca Options API for the latest call option quotes, computes the mid prices for each leg, and uses their difference as the spread's net debit per share. `--expiry` is optional—the CLI attempts to locate both strikes automatically when not provided, but supplying an explicit expiration can avoid extra API calls.
