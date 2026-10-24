export const TARGET_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID) || 84532;
export const TARGET_CHAIN_HEX = "0x" + TARGET_CHAIN_ID.toString(16);

export const BASE_SEPOLIA_PARAMS = {
  chainId: "0x14a34",
  chainName: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://sepolia.base.org"],
  blockExplorerUrls: ["https://sepolia.basescan.org"],
};

export interface EthereumProvider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  removeListener(event: string, handler: (...args: unknown[]) => void): void;
}

export function getEthereum(): EthereumProvider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum;
}