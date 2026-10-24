"use client";

import { useState } from "react";
import WalletBar from "@/components/WalletBar";
import { useWallet } from "@/components/WalletProvider";
import {
  BIG_BLIND,
  CHIPS_PER_PLAYER,
  CreateTableParams,
  MAX_HANDS,
  MIN_HANDS,
  SMALL_BLIND,
  parseCreateForm,
  weiToEth,
} from "@/lib/createTable";

export default function CreatePage() {
  const { address, isWrongNetwork } = useWallet();
  const [buyIn, setBuyIn] = useState("0.001");
  const [hands, setHands] = useState("10");
  const [draft, setDraft] = useState<CreateTableParams | null>(null);

  const result = parseCreateForm(buyIn, hands);
  const errors = result.ok ? {} : result.errors;
  const walletReady = !!address && !isWrongNetwork;
  const canSubmit = result.ok && walletReady;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!result.ok || !walletReady) return;
    // Step 2.3 will send the real createTable transaction here.
    setDraft(result.value);
  }

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
            onChange={(e) => {
              setBuyIn(e.target.value);
              setDraft(null);
            }}
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
            onChange={(e) => {
              setHands(e.target.value);
              setDraft(null);
            }}
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
          Create table
        </button>

        {!walletReady && (
          <p className="text-sm text-gray-600">
            Connect your wallet on Base Sepolia to create a table.
          </p>
        )}
      </form>

      {draft && (
        <div className="max-w-md rounded border border-green-600 p-3 text-sm">
          <p className="font-medium">Form is valid. Ready to send to the contract.</p>
          <p>Buy-in: {draft.buyInWei} wei</p>
          <p>Hands: {draft.hands}</p>
          <p className="mt-2 text-gray-600">The real transaction is added in step 2.3.</p>
        </div>
      )}
    </div>
  );
}