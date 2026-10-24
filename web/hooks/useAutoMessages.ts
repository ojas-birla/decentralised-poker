"use client";

// D7: the two messages the client sends by itself.
//  - `ready` once, after hello, while the table is waiting_deposits / ready
//  - `checkpoint_sig` once per hand, when the hand is settled
import { useEffect, useRef, useState } from "react";
import type { CheckpointSigPayload, Envelope, EventRow, ReadyPayload } from "@poker/shared";
import { computeCheckpoint } from "@poker/shared/engine/checkpoint";
import { signCheckpoint } from "@poker/shared/envelope";
import { useWallet } from "@/components/WalletProvider";
import { loadSessionKey } from "@/lib/sessionKey";
import type { TableSession } from "@/hooks/useTable";

function mySignedEntry(events: EventRow[], type: string, seat: number, handNumber?: number) {
  return events.some((e) => {
    if (e.kind !== "envelope") return false;
    const env = e.body as Envelope;
    return (
      env.type === type &&
      env.seat === seat &&
      (handNumber === undefined || env.handNumber === handNumber)
    );
  });
}

export function useAutoMessages({
  tableId,
  session,
  buyInWei,
}: {
  tableId: string;
  session: TableSession;
  buyInWei: string | null;
}): { checkpointError: string | null } {
  const { address } = useWallet();
  const { phase, state, mySeat, events, send } = session;

  const readySentRef = useRef(false);
  const signedHandsRef = useRef<Set<number>>(new Set());
  const [tick, setTick] = useState(0); // bumped to retry after a failed send
  const [checkpointError, setCheckpointError] = useState<string | null>(null);

  // ---- ready ----
  useEffect(() => {
    if (phase !== "live" || !state || mySeat === null) return;
    if (state.tableState !== "waiting_deposits" && state.tableState !== "ready") return;
    if (readySentRef.current) return;
    if (mySignedEntry(events, "ready", mySeat)) {
      readySentRef.current = true; // already in the log (e.g. after a reload)
      return;
    }
    readySentRef.current = true;
    const payload: ReadyPayload = { ready: true };
    send("ready", payload).then((ack) => {
      if (!ack.ok && ack.reject.code !== "DUPLICATE") {
        setTimeout(() => {
          readySentRef.current = false;
          setTick((t) => t + 1);
        }, 3000);
      }
    });
  }, [phase, state, mySeat, events, send, tick]);

  // ---- checkpoint_sig ----
  useEffect(() => {
    if (phase !== "live" || !state || mySeat === null || !address || !buyInWei) return;
    if (state.tableState !== "settlement" && state.tableState !== "finished") {
      setCheckpointError(null);
      return;
    }
    const hand = state.handNumber;
    if (signedHandsRef.current.has(hand)) return;
    // The server stores checkpointNumber on the state only once all 4 signatures are in
    // (C's lifecycle and bots use the same test): then there is nothing left to sign.
    if (state.checkpointNumber >= hand) {
      signedHandsRef.current.add(hand);
      return;
    }
    if (mySignedEntry(events, "checkpoint_sig", mySeat, hand)) {
      signedHandsRef.current.add(hand); // the log already has my signature for this hand
      return;
    }
    const buyIn = BigInt(buyInWei);
    if (buyIn < 1000n) return; // buy-in unknown yet (chain fallback or not loaded)

    const cp = computeCheckpoint(state, buyIn / 1000n);
    if ("error" in cp) {
      setCheckpointError(cp.error); // never sign something that does not add up
      return;
    }
    const sk = loadSessionKey(address, tableId);
    if (!sk) return;

    setCheckpointError(null);
    signedHandsRef.current.add(hand);
    const { checkpointHash, signature } = signCheckpoint(sk.privateKey, cp);
    const payload: CheckpointSigPayload = {
      checkpointNumber: cp.checkpointNumber,
      checkpointHash,
      signature,
    };
    send("checkpoint_sig", payload, { handNumber: hand }).then((ack) => {
      if (!ack.ok && ack.reject.code !== "DUPLICATE") {
        signedHandsRef.current.delete(hand);
        setTimeout(() => setTick((t) => t + 1), 3000);
      }
    });
  }, [phase, state, mySeat, address, buyInWei, events, send, tableId, tick]);

  return { checkpointError };
}