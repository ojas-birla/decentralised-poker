"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import WalletBar from "@/components/WalletBar";
import { useWallet } from "@/components/WalletProvider";
import {
  BIG_BLIND,
  CHIPS_PER_PLAYER,
  MAX_HANDS,
  MIN_HANDS,
  SMALL_BLIND,
  parseCreateForm,
  weiToEth,
} from "@/lib/createTable";
import { ChainError, ChainStatus, createTable as createTableOnChain } from "@/lib/poker";

export default function CreatePage() {
  const router = useRouter();
  const { address, isWrongNetwork } = useWallet();
  const [buyIn, setBuyIn] = useState("0.001");
  const [hands, setHands] = useState("10");
  const [status, setStatus] = useState<ChainStatus | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const result = parseCreateForm(buyIn, hands);
  const errors = result.ok ? {} : result.errors;
  const walletReady = !!address && !isWrongNetwork;
  const busy = status !== null;
  const canSubmit = result.ok && walletReady && !busy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!result.ok || !walletReady || busy) return;
    setTxError(null);
    setStatus("wallet");
    try {
      const { tableId } = await createTableOnChain({
        buyInWei: BigInt(result.value.buyInWei),
        handCount: result.value.hands,
        onStatus: setStatus,
      });
      router.push(`/table/${tableId}`);
    } catch (err) {
      setTxError(err instanceof ChainError ? err.message : "Something went wrong.");
      setStatus(null);
    }
  }

  const buttonText =
    status === "wallet"
      ? "Confirm in MetaMask…"
      : status === "mining" || status === "done"
        ? "Waiting for confirmation…"
        : "Create table";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Create game</h1>

      <div className="rounded border border-yellow-500 p-3 text-sm">
        <strong>Test ETH only.</strong> This game runs on the Base Sepolia test network. The
        deposits are free test ETH with no real value. Never send real ETH to this app.
      </div>

      <WalletBar />

      <form onSubmit={handleSubmit} className="max-w-md space-y-4">
        <div className="space-y-1">
          <label htmlFor="buyin" className="block text-sm font-medium">
            Buy-in per player (test ETH)
          </label>
          <input
            id="buyin"
            type="text"
            inputMode="decimal"
            value={buyIn}
            disabled={busy}
            onChange={(e) => setBuyIn(e.target.value)}
            className="w-full rounded border p-2"
          />
          {errors.buyIn && <p className="text-sm text-red-600">{errors.buyIn}</p>}
        </div>

        <div className="space-y-1">
          <label htmlFor="hands" className="block text-sm font-medium">
            Number of hands ({MIN_HANDS} to {MAX_HANDS})
          </label>
          <input
            id="hands"
            type="text"
            inputMode="numeric"
            value={hands}
            disabled={busy}
            onChange={(e) => setHands(e.target.value)}
            className="w-full rounded border p-2"
          />
          {errors.hands && <p className="text-sm text-red-600">{errors.hands}</p>}
        </div>

        {result.ok && (
          <ul className="space-y-1 rounded bg-gray-100 p-3 text-sm text-gray-800">
            <li>Each player starts with {CHIPS_PER_PLAYER} chips.</li>
            <li>Blinds are fixed at {SMALL_BLIND} and {BIG_BLIND}.</li>
            <li>1 chip = {result.value.weiPerChip} wei.</li>
            <li>Total escrow (4 players): {weiToEth(result.value.totalPotWei)} test ETH.</li>
          </ul>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {buttonText}
        </button>

        {!walletReady && (
          <p className="text-sm text-gray-600">
            Connect your wallet on Base Sepolia to create a table.
          </p>
        )}

        {txError && (
          <p className="rounded border border-red-500 p-3 text-sm text-red-600">{txError}</p>
        )}
      </form>
    </div>
  );
}