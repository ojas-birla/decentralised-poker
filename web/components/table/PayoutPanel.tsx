"use client";

// Step 2.7: the payout panel on the "Game finished" screen.
import { usePayout } from "@/hooks/usePayout";
import { weiToEth } from "@/lib/createTable";
import { EXPLORER_TX_URL } from "@/lib/contractTx";

export default function PayoutPanel({ tableId, mySeat }: { tableId: string; mySeat: number | null }) {
  const p = usePayout(tableId, mySeat, mySeat !== null);
  if (mySeat === null) return null;

  const myWei = p.final?.checkpoint.balances[mySeat];
  const btn = "rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50";
  const disabled = p.busy !== null;

  return (
    <section className="space-y-3 rounded border p-4">
      <h2 className="font-semibold">Payout</h2>
      {myWei !== undefined && <p className="text-sm">Your final share: {weiToEth(myWei)} test ETH</p>}

      {p.step.kind === "loading" && <p className="text-sm text-gray-600">Checking the contract…</p>}

      {p.step.kind === "submit" && (
        <>
          <p className="text-sm">Step 1 of 3. Send the final signed result to the contract. Any player can do this once for everyone.</p>
          <button className={btn} disabled={disabled} onClick={() => void p.submit()}>Submit final result</button>
        </>
      )}

      {p.step.kind === "wait" && (
        <p className="text-sm">Step 2 of 3. Challenge window open: {p.step.secondsLeft}s left. This page updates by itself.</p>
      )}

      {p.step.kind === "finalize" && (
        <>
          <p className="text-sm">Step 2 of 3 done. Now lock in the result so everyone can withdraw.</p>
          <button className={btn} disabled={disabled} onClick={() => void p.finalize()}>Finalize</button>
        </>
      )}

      {p.step.kind === "withdraw" && (
        <>
          <p className="text-sm">Step 3 of 3. {weiToEth(p.step.amountWei.toString())} test ETH is ready for you.</p>
          <button className={btn} disabled={disabled} onClick={() => void p.withdraw()}>Withdraw to my wallet</button>
        </>
      )}

      {p.step.kind === "done" && <p className="text-sm">All paid out. Nothing left to withdraw for this account.</p>}
      {p.step.kind === "unavailable" && <p className="text-sm text-gray-600">{p.step.reason}</p>}

      {p.busy && <p className="text-sm text-gray-600">{p.busy}…</p>}
      {p.lastTx && (
        <p className="text-xs">
          Last transaction: <a className="underline" href={EXPLORER_TX_URL + p.lastTx} target="_blank" rel="noreferrer">{p.lastTx.slice(0, 10)}…</a>
        </p>
      )}
      {p.error && <p role="alert" className="rounded border border-red-500 p-2 text-sm text-red-600">{p.error}</p>}
    </section>
  );
}
