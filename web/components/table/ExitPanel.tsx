"use client";

// Leaving a table that is not going to play.
//  - lobby (fewer than 4 seats): any seated player can cancel the table; everyone then withdraws their deposit.
//  - started but stuck: after the contract's deadline any player can trigger the emergency refund.
import { useEffect, useRef, useState } from "react";
import { describeTxError } from "@/lib/contractTx";
import { cancelTableTx, emergencyRefundTx, readRefundInfo, refundState, type RefundInfo } from "@/lib/payout";

const STARTED_STATES = ["waiting_deposits", "ready", "dealing", "betting", "showdown", "settlement"];

/** The "Want out?" row of the waiting room. Presentational, so the mock preview can show it without sending anything. */
export function CancelRefundRow({ onClick, disabled }: { onClick?: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="flex max-w-[520px] items-start gap-3 text-sm leading-relaxed text-slate-400">
        <svg viewBox="0 0 24 24" className="mt-0.5 h-6 w-6 shrink-0 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01" />
        </svg>
        <span>Want out? Cancelling closes this table for everyone and refunds every deposit (each player will then need to click Withdraw).</span>
      </p>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="flex h-12 items-center gap-2.5 rounded-xl border border-red-500/70 bg-red-500/10 px-6 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM9 9l6 6M15 9l-6 6" />
        </svg>
        Cancel table and refund
      </button>
    </div>
  );
}

export default function ExitPanel({
  tableId,
  tableState,
  mySeat,
  variant = "panel",
}: {
  tableId: string;
  tableState: string;
  mySeat: number | null;
  variant?: "panel" | "inline"; // inline: drawn without its own box, for the waiting room card
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [refund, setRefund] = useState<RefundInfo | null>(null);
  const busyRef = useRef(false);
  const started = STARTED_STATES.includes(tableState);

  useEffect(() => {
    if (!started || mySeat === null) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      try { const r = await readRefundInfo(tableId); if (!stopped) setRefund(r); } catch { /* wallet not ready: try again */ }
      if (!stopped) timer = setTimeout(loop, 10_000);
    };
    void loop();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [started, tableId, mySeat]);

  if (mySeat === null || (tableState !== "lobby" && !started)) return null;

  async function run(label: string, fn: (cb: (p: { stage: string }) => void) => Promise<string>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy(label);
    try {
      await fn(p => setBusy(p.stage === "wallet" ? `${label}: confirm in MetaMask` : `${label}: waiting for confirmation`));
      setDone(true);
    } catch (e) {
      setError(describeTxError(e));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const rs = refund ? refundState(refund) : null;
  const btn = "rounded-lg border border-red-500 px-3 py-1 text-sm text-red-300 hover:bg-red-950 disabled:opacity-50";

  return (
    <section
      className={
        variant === "inline" && tableState === "lobby"
          ? "space-y-3 text-sm text-slate-200"
          : "space-y-2 rounded-2xl border border-[#d9a928]/60 bg-[#14110a] p-3 text-sm text-slate-200"
      }
    >
      {tableState === "lobby" && variant === "inline" && (
        <CancelRefundRow
          disabled={busy !== null || done}
          onClick={() => { if (window.confirm("Cancel this table for ALL players and refund the deposits?")) void run("Cancelling", cb => cancelTableTx(tableId, cb)); }}
        />
      )}
      {tableState === "lobby" && variant === "panel" && (
        <>
          <p>Want out? Cancelling closes this table for everyone and refunds every deposit (each player then clicks Withdraw).</p>
          <button
            className={btn}
            disabled={busy !== null || done}
            onClick={() => { if (window.confirm("Cancel this table for ALL players and refund the deposits?")) void run("Cancelling", cb => cancelTableTx(tableId, cb)); }}
          >
            Cancel table and refund
          </button>
        </>
      )}
      {started && rs?.kind === "wait" && (
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 24 24" className="h-8 w-8 shrink-0 text-[#f5c542]" fill="none" stroke="currentColor" strokeWidth="2.200" strokeLinecap="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <div>
            <p className="text-xs text-slate-300">Emergency refund unlocks in</p>
            <p className="text-xl font-bold text-[#f5c542]">{Math.ceil(rs.secondsLeft / 60)} min</p>
          </div>
        </div>
      )}
      {started && rs?.kind === "ready" && (
        <>
          <p>The emergency refund is unlocked. Use it only if the game is really stuck: every player gets their buy-in back and the game ends.</p>
          <button
            className={btn}
            disabled={busy !== null || done}
            onClick={() => { if (window.confirm("End the game and refund every buy-in?")) void run("Refunding", cb => emergencyRefundTx(tableId, cb)); }}
          >
            Emergency refund
          </button>
        </>
      )}
      {busy && <p className="text-slate-300">{busy}…</p>}
      {done && <p>Sent. This page switches to the refund screen in a few seconds.</p>}
      {error && <p role="alert" className="rounded border border-red-500 p-2 text-red-300">{error}</p>}
    </section>
  );
}
