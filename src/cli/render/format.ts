export const formatUSD = (n: number): string => {
  const s = n < 0 ? "-$" : "$";
  return s + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
};

