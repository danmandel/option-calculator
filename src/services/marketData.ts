import { fetchSpreadMidDebit, type FetchSpreadDebitParams, type FetchSpreadDebitResult } from "../integrations/alpaca/options";
import { fetchLatestStockPrice } from "../integrations/alpaca/equities";

export interface MarketDataProvider {
  getSpreadMidDebit(params: FetchSpreadDebitParams): Promise<FetchSpreadDebitResult>;
  getSpot(symbol: string): Promise<number>;
}

export class AlpacaMarketDataProvider implements MarketDataProvider {
  async getSpreadMidDebit(params: FetchSpreadDebitParams): Promise<FetchSpreadDebitResult> {
    return fetchSpreadMidDebit(params);
  }
  async getSpot(symbol: string): Promise<number> {
    return fetchLatestStockPrice(symbol);
  }
}

export type { FetchSpreadDebitParams, FetchSpreadDebitResult };

