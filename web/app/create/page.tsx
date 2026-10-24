"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import WalletBar from "@/components/WalletBar";
import { useWallet } from "@/components/WalletProvider";
import { EXPLORER_TX_URL, createTable, describeTxError } from "@/lib/contractTx";
import { getOrCreateSessionKey, promotePendingKey } from "@/lib/sessionKey";
import {
  BIG_BLIND,
  CHIPS_PER_PLAYER,
  MAX_HANDS,
  MIN_HANDS,
  SMALL_BLIND,
  parseCreateForm,
  weiToEth,
} from "@/lib/createTable";

export default function CreatePage() {
  const router = useRouter();
  const { address, isWrongNetwork } = useWallet();
  const [buyIn, setBuyIn] = useState("0.001");
  const [hands, setHands] = useState("10");
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const result = parseCreateForm(buyIn, hands);
  const errors = result.ok ? {} : result.errors;
  const walletReady = !!address && !isWrongNetwork;
  const canSubmit = result.ok && walletReady && !busy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!result.ok || !walletReady || !address || busy) return;
    setBusy(true);
    setTxError(null);
    setTxHash(null);
    try {
      // The session key's address is registered on-chain inside this transaction.
      const sk = getOrCreateSessionKey(address, "pending");
      const { tableId } = await createTable(
        {
          buyInWei: result.value.buyInWei,
          hands: result.value.hands,
          sessionKey: sk.address.toLowerCase(),
        },
        (p) => {
          if (p.hash) setTxHash(p.hash);
        }
      );
      promotePendingKey(address, tableId); // keep the key under the real table id
      router.push(`/table/${tableId}`);
    } catch (err) {
      setTxError(describeTxError(err)); // form stays editable after a reject
      setBusy(false);
    }
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
              setTxError(null);
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
              setTxError(null);
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
          {busy ? (txHash ? "Confirming…" : "Waiting for MetaMask…") : "Create table"}
        </button>

        {!walletReady && (
          <p className="text-sm text-gray-600">
            Connect your wallet on Base Sepolia to create a table.
          </p>
        )}
      </form>

      {txHash && busy && (
        <p className="max-w-md text-sm text-gray-600">
          Transaction sent.{" "}
          <a
            href={`${EXPLORER_TX_URL}${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            View on BaseScan
          </a>
          . Waiting for confirmation…
        </p>
      )}

      {txError && (
        <p role="alert" className="max-w-md rounded border border-red-500 p-3 text-sm text-red-600">
          {txError}
        </p>
      )}
    </div>
  );
}