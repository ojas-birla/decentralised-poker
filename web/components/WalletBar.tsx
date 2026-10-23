"use client";

import { useWallet } from "./WalletProvider";

function shortAddress(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function WalletBar() {
  const { hasWallet, address, isConnecting, isWrongNetwork, error, connect, switchNetwork } =
    useWallet();

  if (hasWallet === null) {
    return <p className="text-sm text-gray-500">Checking for wallet…</p>;
  }

  if (!hasWallet) {
    return (
      <p className="rounded border border-yellow-500 p-3 text-sm">
        MetaMask was not detected. Install it from{" "}
        <a href="https://metamask.io" target="_blank" rel="noreferrer" className="underline">
          metamask.io
        </a>{" "}
        and reload this page.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {!address ? (
        <button
          onClick={connect}
          disabled={isConnecting}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {isConnecting ? "Connecting…" : "Connect wallet"}
        </button>
      ) : (
        <p className="text-sm">
          Connected: <span className="font-mono">{shortAddress(address)}</span>
        </p>
      )}

      {address && isWrongNetwork && (
        <div className="space-y-2 rounded border border-red-500 p-3 text-sm">
          <p>Wrong network. This game runs on Base Sepolia (test network).</p>
          <button onClick={switchNetwork} className="rounded bg-red-600 px-3 py-1 text-white">
            Switch to Base Sepolia
          </button>
        </div>
      )}

      {address && !isWrongNetwork && (
        <p className="text-sm text-green-600">Network: Base Sepolia ✓</p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}