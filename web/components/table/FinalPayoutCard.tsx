"use client";

// The Payout card on the finished screen (dark theme).
// FinalPayoutView only draws; FinalPayoutCard wires it to the chain through usePayout.
import { usePayout } from "@/hooks/usePayout";
import { weiToEth } from "@/lib/createTable";
import { EXPLORER_TX_URL } from "@/lib/contractTx";
import type { PayoutStep } from "@/lib/payout";

const ICON = {
  coins: "M3 7c0-1.700 2.700-3 6-3s6 1.300 6 3-2.700 3-6 3-6-1.300-6-3zM3 7v5c0 1.700 2.700 3 6 3M3 12v5c0 1.700 2.700 3 6 3 1.200 0 2.300-.2 3.200-.5M15 10c3.300 0 6 1.300 6 3s-2.700 3-6 3-6-1.300-6-3 2.700-3 6-3zM21 13v4c0 1.700-2.700 3-6 3s-6-1.300-6-3",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  shield: "M12 3l8 3v6c0 4.500-3.200 8-8 9.500C7.200 20 4 16.500 4 12V6zM9 12l2 2 4-4",
  wallet: "M3 7h15a3 3 0 013 3v8a3 3 0 01-3 3H6a3 3 0 01-3-3zM3 7l11-4v4M16 14h2",
  arrow: "M5 12h14M13 6l6 6-6 6",
};

function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function mmss(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Where we are in the 3 transactions: submit, (wait +) finalize, withdraw.
function progress(step: PayoutStep): number | null {
  switch (step.kind) {
    case "submit": return 0;
    case "wait":
    case "finalize": return 1;
    case "withdraw": return 2;
    case "done": return 3;
    default: return null;
  }
}

export interface FinalPayoutViewProps {
  title: "Payout" | "Refund";
  shareWei?: string; // this player's final share, in wei
  step: PayoutStep;
  busy: string | null;
  error: string | null;
  lastTx: string | null;
  onSubmit: () => void;
  onFinalize: () => void;
  onWithdraw: () => void;
}

export function FinalPayoutView({ title, shareWei, step, busy, error, lastTx, onSubmit, onFinalize, onWithdraw }: FinalPayoutViewProps) {
  const at = progress(step);
  const disabled = busy !== null;

  // One primary action per step.
  let action: { label: string; icon: string; run: () => void } | null = null;
  if (step.kind === "submit") action = { label: "Submit final result", icon: ICON.doc, run: onSubmit };
  if (step.kind === "finalize") action = { label: "Finalize", icon: ICON.shield, run: onFinalize };
  if (step.kind === "withdraw") action = { label: "Withdraw to my wallet", icon: ICON.wallet, run: onWithdraw };

  return (
    <section className="rounded-2xl border border-[#23233a] bg-[#0b0b13] p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold">
          <Icon d={ICON.coins} className="h-6 w-6 text-[#e3bb5a]" />
          {title}
        </h2>
        {at !== null && (
          <div className="flex gap-1.5" role="img" aria-label={`Payout progress: ${Math.min(at + 1, 3)} of 3`}>
            {[0, 1, 2].map((i) => (
              <span key={i} className={`h-1.5 w-7 rounded-full ${i < at ? "bg-[#e3bb5a]" : i === at ? "bg-[#e3bb5a]/60" : "bg-[#23233a]"}`} />
            ))}
          </div>
        )}
      </div>

      {shareWei !== undefined && (
        <p className="mt-3 text-[17px] text-slate-200">
          Your final share: <span className="font-semibold text-[#f5c542]">{weiToEth(shareWei)} test ETH</span>
        </p>
      )}

      <div aria-live="polite" className="mt-2 space-y-1 text-sm text-slate-400">
        {step.kind === "loading" && <p>Checking the contract…</p>}
        {step.kind === "submit" && (
          <>
            <p className="text-[15px] text-slate-300">Step 1 of 3. Send the final signed result to the contract.</p>
            <p className="text-xs text-slate-500">Any player can do this once for everyone.</p>
          </>
        )}
        {step.kind === "wait" && (
          <>
            <p className="text-[15px] text-slate-300">Step 2 of 3. Challenge window open: <span className="font-semibold text-[#f5c542]">{mmss(step.secondsLeft)}</span> left.</p>
            <p className="text-xs text-slate-500">This page updates by itself.</p>
          </>
        )}
        {step.kind === "finalize" && (
          <>
            <p className="text-[15px] text-slate-300">Step 2 of 3 done. Now lock in the result so everyone can withdraw.</p>
          </>
        )}
        {step.kind === "withdraw" && (
          <p className="text-[15px] text-slate-300">
            {title === "Payout" ? "Step 3 of 3. " : "Refund: "}
            <span className="font-semibold text-[#f5c542]">{weiToEth(step.amountWei.toString())} test ETH</span> is ready for you.
          </p>
        )}
        {step.kind === "done" && <p className="text-[15px] text-emerald-300">All paid out. Nothing left to withdraw for this account.</p>}
        {step.kind === "unavailable" && <p className="text-[15px]">{step.reason}</p>}
      </div>

      {action && (
        <button
          type="button"
          onClick={action.run}
          disabled={disabled}
          className="mt-4 flex h-14 w-full items-center justify-between rounded-xl bg-[#f5c542] px-5 text-[16px] font-semibold text-[#1a1405] transition-colors hover:bg-[#ffd25a] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5c542]"
        >
          <Icon d={action.icon} />
          {action.label}
          <Icon d={ICON.arrow} />
        </button>
      )}

      {busy && <p className="mt-3 text-sm text-slate-300">{busy}…</p>}
      {lastTx && (
        <p className="mt-3 text-xs text-slate-500">
          Last transaction:{" "}
          <a className="text-indigo-400 underline hover:text-indigo-300" href={EXPLORER_TX_URL + lastTx} target="_blank" rel="noreferrer">
            {lastTx.slice(0, 10)}…
          </a>
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-red-500/50 bg-red-500/5 p-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}

export default function FinalPayoutCard({ tableId, mySeat }: { tableId: string; mySeat: number | null }) {
  const p = usePayout(tableId, mySeat, mySeat !== null);
  if (mySeat === null) return null;
  return (
    <FinalPayoutView
      title={p.final ? "Payout" : "Refund"}
      shareWei={p.final?.checkpoint.balances[mySeat]}
      step={p.step}
      busy={p.busy}
      error={p.error}
      lastTx={p.lastTx}
      onSubmit={() => void p.submit()}
      onFinalize={() => void p.finalize()}
      onWithdraw={() => void p.withdraw()}
    />
  );
}
