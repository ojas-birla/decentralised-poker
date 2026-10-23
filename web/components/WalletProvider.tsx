"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { BrowserProvider } from "ethers";
import {
  BASE_SEPOLIA_PARAMS,
  TARGET_CHAIN_HEX,
  TARGET_CHAIN_ID,
  getEthereum,
} from "@/lib/chain";

interface WalletContextValue {
  hasWallet: boolean | null; // null = not checked yet
  address: string | null; // lowercase, per SPEC.md
  chainId: number | null;
  isConnecting: boolean;
  isWrongNetwork: boolean;
  error: string | null;
  connect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

function errorMessage(e: unknown): string {
  const err = e as { code?: number | string; message?: string };
  if (err?.code === 4001 || err?.code === "ACTION_REJECTED") {
    return "You rejected the request in MetaMask.";
  }
  if (err?.code === -32002) {
    return "A MetaMask request is already open. Check the MetaMask pop-up.";
  }
  return err?.message ?? "Something went wrong with the wallet.";
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [hasWallet, setHasWallet] = useState<boolean | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const eth = getEthereum();
    setHasWallet(!!eth);
    if (!eth) return;

    const onAccounts = (accounts: unknown) => {
      const list = accounts as string[];
      setAddress(list.length > 0 ? list[0].toLowerCase() : null);
    };
    const onChain = (id: unknown) => setChainId(parseInt(id as string, 16));

    // Restore an already-approved connection (no pop-up).
    eth.request({ method: "eth_accounts" }).then(onAccounts).catch(() => {});
    eth.request({ method: "eth_chainId" }).then(onChain).catch(() => {});

    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener("accountsChanged", onAccounts);
      eth.removeListener("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    const eth = getEthereum();
    if (!eth) {
      setError("MetaMask not found. Install it from metamask.io.");
      return;
    }
    setIsConnecting(true);
    setError(null);
    try {
      const provider = new BrowserProvider(eth);
      const accounts = (await provider.send("eth_requestAccounts", [])) as string[];
      setAddress(accounts[0] ? accounts[0].toLowerCase() : null);
      const network = await provider.getNetwork();
      setChainId(Number(network.chainId));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const switchNetwork = useCallback(async () => {
    const eth = getEthereum();
    if (!eth) return;
    setError(null);
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: TARGET_CHAIN_HEX }],
      });
    } catch (e) {
      // 4902 = the wallet doesn't know this network yet, so add it.
      if ((e as { code?: number })?.code === 4902) {
        try {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [BASE_SEPOLIA_PARAMS],
          });
        } catch (e2) {
          setError(errorMessage(e2));
        }
      } else {
        setError(errorMessage(e));
      }
    }
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      hasWallet,
      address,
      chainId,
      isConnecting,
      isWrongNetwork: chainId !== null && chainId !== TARGET_CHAIN_ID,
      error,
      connect,
      switchNetwork,
    }),
    [hasWallet, address, chainId, isConnecting, error, connect, switchNetwork]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}