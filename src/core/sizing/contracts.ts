export const portfolioSize = 100000;

interface ResolveContractsArgs {
  contracts?: number;
  portfolioSizeValue?: number;
  netDebitPerShare: number;
  contractSize: number;
}

export const resolveContracts = ({
  contracts,
  portfolioSizeValue = portfolioSize,
  netDebitPerShare,
  contractSize,
}: ResolveContractsArgs): number => {
  if (!Number.isInteger(contractSize) || contractSize <= 0)
    throw new Error("contractSize must be a positive integer.");
  if (!Number.isFinite(netDebitPerShare))
    throw new Error("netDebitPerShare must be a finite number.");
  if (netDebitPerShare < 0)
    throw new Error("netDebitPerShare (debit) cannot be negative.");

  if (contracts !== undefined) {
    if (!Number.isInteger(contracts) || contracts <= 0)
      throw new Error("contracts must be a positive integer.");
    return contracts;
  }

  if (portfolioSizeValue === undefined) return 1;
  if (!Number.isFinite(portfolioSizeValue) || portfolioSizeValue <= 0)
    throw new Error("portfolioSize must be a positive finite number.");

  const perContractCost = netDebitPerShare * contractSize;
  if (!Number.isFinite(perContractCost))
    throw new Error("Unable to determine contract cost.");

  if (perContractCost <= 0) return 1;

  const maxContracts = Math.floor(portfolioSizeValue / perContractCost);
  if (maxContracts <= 0)
    throw new Error("Portfolio size too small to fund a single contract at this debit.");

  return maxContracts;
};

