"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import WalletBar from "@/components/WalletBar";
import { useWallet } from "@/components/WalletProvider";
import { SEATS, TableSummary, USE_MOCK, fetchOpenTables } from "@/lib/lobby";
import { weiToEth } from "@/lib/createTable";
import { EXPLORER_TX_URL, describeTxError, joinTable } from "@/lib/contractTx";
import { getOrCreateSessionKey } from "@/lib/sessionKey";

const POLL_MS = 5000;

export default function LobbyPage() {
  const router = useRouter();
  const { address, isWrongNetwork } = useWallet();
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const walletReady = !!address && !isWrongNetwork;

  const load = useCallback(async (isCancelled: () => boolean) => {
    try {
      const data = await fetchOpenTables();
      if (isCancelled()) return;
      setTables(data);
      setError(null);
    } catch (e) {
      if (isCancelled()) return;
      setError(
        (e as Error).message || "Could not reach the game server. Is it running on port 4000?"
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    load(isCancelled);
    const id = setInterval(() => load(isCancelled), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [load]);

  async function handleJoin(tableId: string) {
    if (!address || joiningId) return;
    setJoiningId(tableId);
    setTxError(null);
    setTxHash(null);
    try {
      // Same key is reused if the player comes back to this table later.
      const sk = getOrCreateSessionKey(address, tableId);
      await joinTable(
        { tableId, sessionKey: sk.address.toLowerCase(), wallet: address },
        (p) => {
          if (p.hash) setTxHash(p.hash);
        }
      );
      router.push(`/table/${tableId}`);
    } catch (e) {
      setTxError(describeTxError(e));
      setJoiningId(null);
    }
  }

  // SPEC.md section 4: only tables in the "lobby" state (fewer than 4 seats) can be joined.
  const open = tables?.filter((t) => t.state === "lobby") ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Open tables</h1>
        <button onClick={() => load(() => false)} className="rounded border px-3 py-1 text-sm">
          Refresh
        </button>
      </div>

      {USE_MOCK && (
        <p className="rounded border border-yellow-500 p-2 text-sm">
          Showing sample tables (mock mode). Set NEXT_PUBLIC_USE_MOCK=false to use the server.
        </p>
      )}

      <WalletBar />

      {error && (
        <p className="rounded border border-red-500 p-3 text-sm text-red-600">
          Could not load tables: {error}
        </p>
      )}

      {txHash && joiningId && (
        <p className="text-sm text-gray-600">
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
        <p role="alert" className="rounded border border-red-500 p-3 text-sm text-red-600">
          {txError}
        </p>
      )}

      {open === null && !error && <p className="text-sm text-gray-500">Loading tables…</p>}

      {open !== null && open.length === 0 && (
        <p className="text-sm">No open tables right now. Create one from the home page.</p>
      )}

      <ul className="space-y-3">
        {open?.map((t) => {
          const full = t.players.length >= SEATS;
          const seated = !!address && t.players.includes(address);
          const isCreator = !!address && t.players[0] === address;
          return (
            <li
              key={t.tableId}
              className="flex items-center justify-between rounded border p-4"
            >
              <div className="space-y-1 text-sm">
                <p className="font-medium">Table #{t.tableId}</p>
                <p>Buy-in: {weiToEth(t.buyInWei)} test ETH</p>
                <p>
                  {t.hands} hands · {t.players.length}/{SEATS} seats filled
                </p>
              </div>

              {seated ? (
                <button
                  onClick={() => router.push(`/table/${t.tableId}`)}
                  className="rounded border px-4 py-2"
                >
                  {isCreator ? "Open your table" : "Open"}
                </button>
              ) : (
                <button
                  onClick={() => handleJoin(t.tableId)}
                  disabled={full || !walletReady || joiningId !== null}
                  className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
                >
                  {joiningId === t.tableId ? "Joining…" : full ? "Full" : "Join"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {!walletReady && (
        <p className="text-sm text-gray-600">
          Connect your wallet on Base Sepolia to join a table.
        </p>
      )}
    </div>
  );
}