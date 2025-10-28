import type { BullCallSpreadArgs } from "../spreads/bullCall";
import { bullCallSpreadProfit } from "../spreads/bullCall";

export interface PayoffPoint {
  price: number;
  profit: number;
}

export const computePayoffPoints = (
  base: Omit<BullCallSpreadArgs, "priceAtExpiry">,
  prices: number[]
): PayoffPoint[] =>
  prices.map((p) => ({
    price: p,
    profit: bullCallSpreadProfit({ ...base, priceAtExpiry: p }),
  }));
