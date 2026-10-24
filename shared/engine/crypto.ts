// shared/engine/crypto.ts
// SPEC-PHASE3 section 2 (steps 5, 8, 10): the pure bridge between the crypto event log and the engine.
// applyCrypto(state, events) returns the next state if the hand can move forward, or null if nothing changed.
import type { EventRow } from "../protocol";
import { boardCard, deriveDealing, unlockOrder, type DealingView } from "../crypto/dealingView";
import { abortHand } from "./abort";
import { provideBoardCards } from "./streets";
import type { GameState, Seat } from "./types";

/** SPEC-PHASE3 D2. A folded player is still inHand, so folded players keep unlocking board cards. */
export function activeSeats(state: GameState): Seat[] {
  return state.seats.filter(p => p.inHand).map(p => p.seat);
}

/** True when every seat that has to unlock deck position `i` has done so, in order. */
function chainComplete(view: DealingView, i: number, active: readonly number[]): boolean {
  const u = view.unlocks[i];
  return u !== undefined && u.chain.length === unlockOrder(u.forSeat, active).length;
}

function abortOrNull(state: GameState, reason: "DUPLICATE_CARD" | "BAD_REVEAL"): GameState | null {
  const r = abortHand(state, reason);
  return "error" in r ? null : r;
}

export function applyCrypto(state: GameState, events: readonly EventRow[]): GameState | null {
  if (state.deck !== null) return null; // Phase 2 dev deck: nothing to unlock

  const active = activeSeats(state);
  const view = deriveDealing(events, state.handNumber, active, state.dealerSeat);
  const needs = state.needsCards;

  switch (state.tableState) {
    case "dealing": { // step 5: all hole chains done -> betting
      if (!needs || needs.length === 0) return null;
      if (!needs.every(i => chainComplete(view, i, active))) return null;
      const s: GameState = structuredClone(state);
      s.tableState = "betting";
      s.needsCards = null;
      return s;
    }
    case "betting": { // step 8: a street is waiting for its board cards
      if (!needs || needs.length === 0) return null;
      if (!needs.every(i => chainComplete(view, i, active))) return null;
      const cards: number[] = [];
      for (const i of needs) {
        const c = boardCard(view, i, active);
        if (c === null) return abortOrNull(state, "DUPLICATE_CARD"); // last value is not one of the 52 card points
        cards.push(c);
      }
      const r = provideBoardCards(state, cards);
      if ("error" in r) return abortOrNull(state, "DUPLICATE_CARD"); // a card repeated on the board
      return r;
    }
    case "showdown": // step 10 (C-3b, commit 8)
      return null;
    default:
      return null;
  }
}