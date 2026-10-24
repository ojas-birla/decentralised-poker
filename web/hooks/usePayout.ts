"use client";

// Step 2.7 state machine for the "finished" screen: polls the chain and runs the 3 transactions.
import { useCallback, useEffect, useRef, useState } from "react";
import { describeTxError } from "@/lib/contractTx";
import {
  fetchFinalCheckpoint, finalizeTable, nextPayoutStep, readSnapshot, submitFinalCheckpoint, withdrawFunds,
  type FinalCheckpoint, type PayoutStep,
} from "@/lib/payout";

const POLL_MS = 4000;

export function usePayout(tableId: string, mySeat: number | null, enabled: boolean) {
  const [step, setStep] = useState<PayoutStep>({ kind: "loading" });
  const [final, setFinal] = useState<FinalCheckpoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const finalRef = useRef<FinalCheckpoint | null>(null);
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    if (mySeat === null) return;
    try {
      if (!finalRef.current) {
        finalRef.current = await fetchFinalCheckpoint(tableId);
        setFinal(finalRef.current);
      }
      const snap = await readSnapshot(tableId, mySeat);
      // A cancelled or refunded table never had a result, so only a started table needs one.
      if (!finalRef.current && snap.status === 2) {
        setStep({ kind: "unavailable", reason: "The server has no final result for this table yet." });
        return;
      }
      setStep(nextPayoutStep(snap, finalRef.current?.checkpoint.checkpointNumber ?? 0));
      setError(null);
    } catch (e) {
      setError(describeTxError(e));
    }
  }, [tableId, mySeat]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      if (!busyRef.current) await refresh();
      if (!stopped) timer = setTimeout(loop, POLL_MS);
    };
    void loop();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [enabled, refresh]);

  const run = useCallback(async (label: string, fn: (onProgress: (p: { stage: string; hash?: string }) => void) => Promise<string>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy(label);
    try {
      const hash = await fn(p => setBusy(p.stage === "wallet" ? `${label}: confirm in MetaMask` : `${label}: waiting for confirmation`));
      setLastTx(hash);
    } catch (e) {
      setError(describeTxError(e));
    } finally {
      busyRef.current = false;
      setBusy(null);
      void refresh();
    }
  }, [refresh]);

  return {
    step, final, error, busy, lastTx,
    submit: () => final && run("Submitting result", p => submitFinalCheckpoint(tableId, final, p)),
    finalize: () => run("Finalizing", p => finalizeTable(tableId, p)),
    withdraw: () => run("Withdrawing", p => withdrawFunds(tableId, p)),
  };
}
