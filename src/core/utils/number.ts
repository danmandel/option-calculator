export const range = (start: number, end: number, step: number): number[] => {
  if (![start, end, step].every(Number.isFinite)) throw new Error("range args must be finite numbers.");
  if (step === 0) throw new Error("range step cannot be 0.");
  const out: number[] = [];
  const dir = Math.sign(step);
  for (let x = start; dir > 0 ? x <= end : x >= end; x += step) {
    out.push(Number(x.toFixed(10)));
  }
  return out;
};

