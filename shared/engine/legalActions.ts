// SPEC-2.1 §7 C1: what the seat to act may do. Pure; used by the bots (C7) and by the web mapper (D6).
import type { GameState, Seat } from "./types";

/** Must stay in step with the `legal` field of `TableView` in web/lib/tableView.ts. */
export interface LegalActions {
  /** Chips needed to call (already capped by the seat's stack). */
  toCall: number;
  canCheck: boolean;
  /** Smallest legal raise, as a TOTAL bet this street (capped at an all-in). */
  minRaiseTo: number;
  /** Largest raise, as a TOTAL bet this street (= all-in). */
  maxRaiseTo: number;
}

/** `null` unless it is `seat`'s turn in the betting state. */
export function legalActions(state: GameState, seat: Seat): LegalActions | null {
  if (state.tableState !== "betting" || state.toActSeat !== seat) return null;
  const p = state.seats[seat];
  const toCall = Math.min(state.currentBet - p.committedThisStreet, p.chips);
  const maxRaiseTo = p.committedThisStreet + p.chips;
  const minRaiseTo = Math.min(state.currentBet + state.lastRaiseSize, maxRaiseTo);
  return { toCall, canCheck: toCall === 0, minRaiseTo, maxRaiseTo };
}