"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CreateHeader from "@/components/create/CreateHeader";
import CardFan from "@/components/lobby/CardFan";
import { useWallet } from "@/components/WalletProvider";
import { SEATS, TableSummary, USE_MOCK, fetchOpenTables } from "@/lib/lobby";
import { BIG_BLIND, SMALL_BLIND, weiToEth } from "@/lib/createTable";
import { EXPLORER_TX_URL, describeTxError, joinTable } from "@/lib/contractTx";
import { getOrCreateSessionKey } from "@/lib/sessionKey";

const POLL_MS = 5000;

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5c542]";

const ICONS = {
  players: "M9 11a3 3 0 100-6 3 3 0 000 6zM3 19c0-3 2.700-5 6-5s6 2 6 5M17 11a2.500 2.500 0 100-5M18 14.200c2 .4 3.500 1.900 3.500 4.300",
  target: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 15a3 3 0 100-6 3 3 0 000 6z",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  refresh: "M20 12a8 8 0 11-2.400-5.700M20 4v5h-5",
};

function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

function EthGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 text-indigo-300" fill="currentColor" aria-hidden>
      <path d="M12 2l-6.500 10.200L12 16l6.500-3.800zM12 17.300l-6.500-3.800L12 22l6.500-8.500z" opacity=".9" />
    </svg>
  );
}

function Stat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {icon}
      <div className="min-w-0 leading-tight">
        <p className="whitespace-nowrap text-[15px] font-medium text-white">{value}</p>
        <p className="mt-1 whitespace-nowrap text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

export default function LobbyPage() {
  const router = useRouter();
  const { address, isWrongNetwork } = useWallet();
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
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

  async function refresh() {
    setRefreshing(true);
    await load(() => false);
    setRefreshing(false);
  }

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

  // The highlighted row follows the pointer or keyboard focus, and starts on the first joinable table.
  const firstJoinable = open?.find((t) => t.players.length < SEATS && !t.players.includes(address ?? ""));
  const activeId = hoverId ?? firstJoinable?.tableId ?? null;

  return (
    <div className="table-stage fixed inset-0 z-10 !m-0 overflow-auto font-grotesk text-white">
      <CreateHeader wide />

      <div className="mx-auto grid w-full max-w-[1280px] items-start gap-10 px-6 pb-16 pt-2 lg:grid-cols-[minmax(0,780px)_minmax(0,1fr)] lg:gap-12">
        {/* Left: table list */}
        <div>
          <section className="rounded-2xl border border-[#2a2a3d] bg-[#0d0d16]/95 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-[28px] font-bold leading-tight">Join a Table</h1>
                <p className="mt-2 text-[15px] text-slate-400">Pick an open table and take a seat.</p>
              </div>
              <button
                type="button"
                onClick={refresh}
                disabled={refreshing}
                className={`flex h-11 shrink-0 items-center gap-2 rounded-full border border-[#2a2a3d] bg-[#0e0e18] px-5 text-sm font-medium text-slate-100 transition-colors hover:border-[#4a4a6a] disabled:opacity-60 ${focusRing}`}
              >
                <Icon d={ICONS.refresh} className={`h-[18px] w-[18px] text-indigo-300 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>

            <div className="mt-5 space-y-3" aria-live="polite">
              {open === null && !error && (
                <>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-20 animate-pulse rounded-xl border border-[#1c1c2e] bg-[#0b0b13]" />
                  ))}
                  <p className="sr-only">Loading tables…</p>
                </>
              )}

              {error && (
                <p role="alert" className="rounded-xl border border-red-500/50 bg-red-500/5 p-3 text-sm text-red-300">
                  Could not load tables: {error}
                </p>
              )}

              {open !== null && open.length === 0 && (
                <div className="rounded-xl border border-dashed border-[#2a2a3d] p-8 text-center">
                  <p className="text-[15px] text-slate-300">No open tables right now.</p>
                  <Link
                    href="/create"
                    className={`mt-4 inline-flex h-11 items-center rounded-xl bg-[#e3bb5a] px-5 text-sm font-semibold text-[#1a1405] hover:bg-[#f0c85f] ${focusRing}`}
                  >
                    Create a table
                  </Link>
                </div>
              )}

              {open?.map((t) => {
                const full = t.players.length >= SEATS;
                const seated = !!address && t.players.includes(address);
                const joining = joiningId === t.tableId;
                const active = activeId === t.tableId && !full;
                return (
                  <div
                    key={t.tableId}
                    onMouseEnter={() => setHoverId(t.tableId)}
                    onMouseLeave={() => setHoverId(null)}
                    onFocus={() => setHoverId(t.tableId)}
                    onBlur={() => setHoverId(null)}
                    className={`grid grid-cols-2 items-center gap-x-4 gap-y-4 rounded-xl border px-5 py-4 transition-colors sm:grid-cols-[1.35fr_1fr_1fr_1fr_auto] ${
                      active
                        ? "border-[#d9a928] bg-[#16130f] shadow-[0_0_22px_rgba(245,197,66,0.1)]"
                        : "border-[#1c1c2e] bg-[#0b0b13]"
                    } ${full ? "opacity-70" : ""}`}
                  >
                    <Stat icon={<EthGlyph />} value={`${weiToEth(t.buyInWei)} ETH`} label="Buy-in per player" />
                    <Stat
                      icon={<Icon d={ICONS.players} className="h-5 w-5 shrink-0 text-[#e3bb5a]" />}
                      value={`${t.players.length} / ${SEATS}`}
                      label="Players"
                    />
                    <Stat
                      icon={<Icon d={ICONS.target} className="h-5 w-5 shrink-0 text-[#e3bb5a]" />}
                      value={`${SMALL_BLIND} / ${BIG_BLIND}`}
                      label="Blinds"
                    />
                    <Stat
                      icon={<Icon d={ICONS.clock} className="h-5 w-5 shrink-0 text-slate-300" />}
                      value={`~ ${t.hands}`}
                      label="Hands"
                    />

                    {seated ? (
                      <button
                        type="button"
                        onClick={() => router.push(`/table/${t.tableId}`)}
                        aria-label={`Open table ${t.tableId}`}
                        className={`col-span-2 h-11 min-w-[88px] rounded-xl border border-emerald-400/60 px-4 text-sm font-semibold text-emerald-300 hover:bg-emerald-400/10 sm:col-span-1 ${focusRing}`}
                      >
                        Open
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleJoin(t.tableId)}
                        disabled={full || !walletReady || joiningId !== null}
                        aria-label={full ? `Table ${t.tableId} is full` : `Join table ${t.tableId}`}
                        className={`col-span-2 h-11 min-w-[88px] rounded-xl px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed sm:col-span-1 ${focusRing} ${
                          full
                            ? "border border-[#1c1c2e] bg-transparent text-slate-600"
                            : active
                              ? "bg-[#e3bb5a] text-[#1a1405] hover:bg-[#f0c85f] disabled:opacity-60"
                              : "border border-[#3a3a52] bg-transparent text-white hover:border-[#6a6a8c] disabled:opacity-50"
                        }`}
                      >
                        {joining ? "Joining…" : full ? "Full" : "Join"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div aria-live="polite" className="mt-4 space-y-3 text-sm">
              {txHash && joiningId && (
                <p className="text-slate-400">
                  Transaction sent.{" "}
                  <a
                    href={`${EXPLORER_TX_URL}${txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-400 underline hover:text-indigo-300"
                  >
                    View on BaseScan
                  </a>
                  . Waiting for confirmation…
                </p>
              )}
              {txError && (
                <p role="alert" className="rounded-xl border border-red-500/50 bg-red-500/5 p-3 text-red-300">
                  {txError}
                </p>
              )}
              {!walletReady && open !== null && open.length > 0 && (
                <p className="text-slate-400">Connect your wallet on Base Sepolia to join a table.</p>
              )}
            </div>
          </section>

          <p className="mt-4 px-1 text-xs text-slate-500">
            Test ETH only · Base Sepolia · no real value. Never send real ETH to this app.
            {USE_MOCK && " Showing sample tables (mock mode)."}
          </p>
        </div>

        {/* Right: illustration */}
        <div className="hidden pt-24 lg:block" aria-hidden={false}>
          <CardFan />
        </div>
      </div>
    </div>
  );
}
