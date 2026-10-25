// shared/engine/abort.ts
// SPEC-PHASE3 D6 + SPEC.md section 3 "What an aborted hand does to the balances".
// Pure: no database, no clock. The caller (server lifecycle or timers) logs it and broadcasts it.
//
//  - technical abort (CRYPTO_STALL, BAD_REVEAL, DUPLICATE_CARD): the hand is rolled back. Every chip
//    committed this hand returns to its owner, so each seat ends with exactly the chips it had before
//    the hand started (blinds included).
//  - PLAYER_ABANDONED (needs `abandonerSeat`): the abandoner forfeits what they put in this hand. The
//    forfeit is split among the other players still in the hand (odd chip to the first left of the
//    dealer). Everyone else's committed chips return. The abandoner keeps their remaining chips and is
//    evicted.
//
// Afterwards the table is in "settlement" with `aborted` set and committedThisHand = 0, so the normal
// checkpoint flow runs and the next hand can start (lifecycle rule checkpointNumber >= handNumber).
// Only allowed in dealing, betting, showdown. Anything else: WRONG_STATE.
import type { AbortReason } from "../types";
import type { EngineError, GameState, Seat } from "./types";

const ABORTABLE: ReadonlySet<GameState["tableState"]> = new Set(["dealing", "betting", "showdown"]);

export function abortHand(
  state: GameState,
  reason: AbortReason,
  abandonerSeat?: Seat,
): GameState | { error: EngineError } {
  if (!ABORTABLE.has(state.tableState)) return { error: "WRONG_STATE" };
  if (reason === "PLAYER_ABANDONED" && abandonerSeat === undefined) return { error: "BAD_PAYLOAD" };

  const s: GameState = structuredClone(state);
  let forfeit = 0;

  if (reason === "PLAYER_ABANDONED") {
    const a = s.seats[abandonerSeat as Seat];
    forfeit = a.committedThisHand;
    a.committedThisHand = 0; // forfeited, NOT returned
    a.evicted = true;
    a.inHand = false;
  }

  // everybody else gets their committed chips back
  for (const p of s.seats) {
    p.chips += p.committedThisHand;
    p.committedThisHand = 0;
    p.committedThisStreet = 0;
    p.hasActedThisStreet = false;
  }

  if (forfeit > 0) {
    let heirs = s.seats.filter((p) => p.inHand && !p.hasFolded && !p.evicted);
    if (heirs.length === 0) heirs = s.seats.filter((p) => p.inHand && !p.evicted);
    if (heirs.length === 0) {
      s.seats[abandonerSeat as Seat].chips += forfeit; // nobody to pay: give it back
    } else {
      const each = Math.floor(forfeit / heirs.length);
      let rest = forfeit - each * heirs.length;
      for (const p of heirs) p.chips += each;
      for (let i = 1; i <= 4 && rest > 0; i++) { // odd chips: first left of the dealer
        const h = heirs.find((p) => p.seat === (((s.dealerSeat + i) % 4) as Seat));
        if (h) { h.chips += 1; rest -= 1; }
      }
    }
  }

  s.pots = [];
  s.awards = [];
  s.board = [];
  s.holeCards = [[], [], [], []];
  s.toActSeat = null;
  s.currentBet = 0;
  s.needsCards = null;
  s.deck = null;
  s.aborted = { reason };
  s.tableState = "settlement";
  return s;
}