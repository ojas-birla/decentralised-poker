"use client";

// Phase 3 (Person B): the client side of the padlock shuffle.
// Reads the signed event log, works out what THIS player owes (commit, shuffle, unlock, reveal),
// sends it, and computes my hole cards locally. The log is the source of truth, so a reload
// recovers on its own: duties already in the log are never returned by nextDuties().
import { useEffect, useMemo, useRef, useState } from "react";
import { generatePadlock, commitPadlock, unlockCard, type Padlock } from "@poker/shared/crypto/padlock";
import { lockAndShuffle } from "@poker/shared/crypto/shuffle";
import { loadPadlock, loadOrCreatePadlock } from "@poker/shared/crypto/padlockStore";
import {
  deriveDealing, nextDuties, myHoleCards, verifyAllReveals, unlockOrder, expectedForSeat,
  type Duty, type Seat, type ShowdownCheck,
} from "@poker/shared/crypto/dealingView";
import type { TableSession } from "@/hooks/useTable";

export type DealingPhase = "idle" | "committing" | "shuffling" | "unlocking" | "playing" | "showdown";

export interface DealingInfo {
  dealingPhase: DealingPhase;
  waitingFor: number | null;       // seat we are waiting for (null = nobody / me)
  shuffleStep: number;             // 0..4 accepted shuffle steps, for "Shuffling (2 of 4)"
  myCards: [number, number] | null; // card identities 0..51. Show only in MY seat. Never send.
  showdownCheck: ShowdownCheck | null;
  error: string | null;
}

const DEV_DECK = process.env.NEXT_PUBLIC_DEV_DECK === "1"; // server-dealt fallback: this hook stays off
const MAX_TRIES = 5;

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
function randInt(max: number): number {          // rejection sampling, no modulo bias
  const limit = Math.floor(0x100000000 / max) * max;
  const b = new Uint32Array(1);
  do crypto.getRandomValues(b); while (b[0] >= limit);
  return b[0] % max;
}
const dutyKey = (hand: number, d: Duty) =>
  `${hand}:${d.kind}${d.kind === "unlock" ? ":" + d.cardIndex : d.kind === "shuffle" ? ":" + d.step : ""}`;

export function useDealing({ tableId, session }: { tableId: string; session: TableSession }): DealingInfo {
  const { phase, state, mySeat, events, send } = session;

  const [padlock, setPadlock] = useState<Padlock | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);                       // bumped to retry after a failed send
  const padlockHandRef = useRef<number>(-1);                 // strict-mode guard: one load per hand
  const sentRef = useRef<Set<string>>(new Set());            // duties in flight or done (this page load)
  const triesRef = useRef<Map<string, number>>(new Map());
  const busyRef = useRef(false);                             // one envelope at a time (seq numbers)

  const hand = state?.handNumber ?? 0;
  const handLive = !!state && hand > 0 &&
    (state.tableState === "dealing" || state.tableState === "betting" || state.tableState === "showdown");

  const activeSeats = useMemo(
    () => (state ? state.seats.filter((p) => p.inHand).map((p) => p.seat) : []),
    [state],
  );
  const dealer = (state?.dealerSeat ?? 0) as Seat;
  const me = mySeat !== null && state ? state.seats[mySeat] : null;

  const view = useMemo(
    () => deriveDealing(events, hand, activeSeats, dealer),
    [events, hand, activeSeats, dealer],
  );

  // ---- 1. my padlock for this hand (inside an effect, once per hand) ----
  useEffect(() => {
    if (DEV_DECK || phase !== "live" || !handLive || mySeat === null) return;
    if (padlockHandRef.current === hand) return;
    padlockHandRef.current = hand;
    try {
      const alreadyCommitted = view.commitments[mySeat] !== undefined;
      const p = alreadyCommitted
        ? loadPadlock(window.localStorage, tableId, hand)        // reload: must reuse, never replace
        : loadOrCreatePadlock(window.localStorage, tableId, hand, randomBytes);
      if (!p) setError("Padlock for this hand is missing from this browser. The hand will abort if you stall.");
      else setError(null);
      setPadlock(p);
    } catch {
      padlockHandRef.current = -1;
      setError("Cannot access localStorage for the padlock.");
    }
  }, [phase, handLive, hand, mySeat, tableId, view]);

  // ---- 2. what do I owe right now? ----
  const duties = useMemo(() => {
    if (DEV_DECK || mySeat === null || !state || !handLive || !padlock) return [];
    return nextDuties({
      view, mySeat, activeSeats, dealer,
      needsCards: state.needsCards,
      showdown: state.tableState === "showdown",
      stillInHand: !!me && me.inHand && !me.hasFolded,
    });
  }, [view, mySeat, state, handLive, padlock, activeSeats, dealer, me]);

  // ---- 3. send the next duty (one at a time) ----
  useEffect(() => {
    if (!padlock || busyRef.current || mySeat === null || duties.length === 0) return;
    const duty = duties.find((d) => !sentRef.current.has(dutyKey(hand, d)));
    if (!duty) return;
    const key = dutyKey(hand, duty);
    busyRef.current = true;
    sentRef.current.add(key);

    (async () => {
      try {
        let type: "commit_padlock" | "shuffle_step" | "unlock_card" | "reveal_padlock";
        let payload: unknown;
        switch (duty.kind) {
          case "commit":
            type = "commit_padlock";
            payload = { commitment: commitPadlock(padlock, tableId, hand) };
            break;
          case "shuffle":
            type = "shuffle_step";
            payload = { step: duty.step, deck: lockAndShuffle(duty.deckIn, padlock, randInt) };
            break;
          case "unlock":
            type = "unlock_card";
            payload = { cardIndex: duty.cardIndex, forSeat: duty.forSeat, value: unlockCard(duty.valueIn, padlock) };
            break;
          case "reveal":
            type = "reveal_padlock";
            payload = { padlock: padlock.hex };
            break;
        }
        const ack = await send(type, payload, { handNumber: hand });
        if (!ack.ok && ack.reject.code !== "DUPLICATE") throw new Error(ack.reject.code);
      } catch {
        sentRef.current.delete(key);                        // allow a retry
        const n = (triesRef.current.get(key) ?? 0) + 1;
        triesRef.current.set(key, n);
        if (n < MAX_TRIES) setTimeout(() => setTick((t) => t + 1), 2000 * n);
        else setError("Could not send a dealing message. The hand may abort.");
      } finally {
        busyRef.current = false;
        setTick((t) => t + 1);                              // look for the next duty
      }
    })();
  }, [duties, padlock, mySeat, hand, tableId, send, tick]);

  // ---- 4. things to show ----
  const myCards = useMemo(() => {
    if (!padlock || mySeat === null || !state || !handLive || !activeSeats.includes(mySeat)) return null;
    const r = myHoleCards(view, mySeat, padlock, dealer, activeSeats);
    return r.ok ? r.cards : null;
  }, [view, padlock, mySeat, state, handLive, activeSeats, dealer]);

  const showdownCheck = useMemo<ShowdownCheck | null>(() => {
    if (!state || state.tableState !== "showdown") return null;
    const revealSeats = state.seats.filter((p) => p.inHand && !p.hasFolded).map((p) => p.seat);
    return verifyAllReveals({ view, tableId, hand, dealer, activeSeats, revealSeats });
  }, [state, view, tableId, hand, dealer, activeSeats]);

  const info = useMemo(() => {
    const order = [...activeSeats].sort((a, b) => a - b);
    if (DEV_DECK || !handLive || !state) return { dealingPhase: "idle" as DealingPhase, waitingFor: null };
    const missing = order.find((s) => view.commitments[s] === undefined);
    if (missing !== undefined) return { dealingPhase: "committing" as DealingPhase, waitingFor: missing === mySeat ? null : missing };
    if (!view.shuffleDone) {
      const s = order[view.shuffleSteps];
      return { dealingPhase: "shuffling" as DealingPhase, waitingFor: s === mySeat ? null : s };
    }
    if (state.tableState === "showdown") {
      const s = state.seats.find((p) => p.inHand && !p.hasFolded && view.reveals[p.seat] === undefined)?.seat;
      return { dealingPhase: "showdown" as DealingPhase, waitingFor: s === undefined || s === mySeat ? null : s };
    }
    for (const i of state.needsCards ?? []) {
      const f = expectedForSeat(i, dealer, order);
      if (f === null) continue;
      const req = unlockOrder(f, order);
      const done = view.unlocks[i]?.chain.length ?? 0;
      if (done < req.length) return { dealingPhase: "unlocking" as DealingPhase, waitingFor: req[done] === mySeat ? null : req[done] };
    }
    return { dealingPhase: "playing" as DealingPhase, waitingFor: null };
  }, [handLive, state, view, activeSeats, dealer, mySeat]);

  return { ...info, shuffleStep: view.shuffleSteps, myCards, showdownCheck, error };
}