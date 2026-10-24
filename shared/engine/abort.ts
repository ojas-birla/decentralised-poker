// shared/engine/abort.ts
// SPEC-PHASE3 D6: abort a hand for a technical reason (never a player's fault yet).
// Pure: no database, no clock. The caller (server lifecycle or timers) logs it and broadcasts it.
import type { AbortReason } from "../types";
import type { EngineError, GameState } from "./types";

const ABORTABLE: ReadonlySet<GameState["tableState"]> = new Set(["dealing", "betting", "showdown"]);

/**
 * Cancels the hand in progress. Every chip committed this hand goes back to its owner, so each
 * seat ends with exactly the chips it had before the hand started (blinds included).
 *
 * The table moves to "settlement" with `aborted` set, so the normal checkpoint flow runs on the
 * pre-hand balances and the next hand can start (lifecycle rule checkpointNumber >= handNumber).
 *
 * - Only allowed in dealing, betting, showdown. Anything else: WRONG_STATE.
 * - PLAYER_ABANDONED belongs to Phase 4 (penalty rules), so it is refused here: ILLEGAL_ACTION.
 */
export function abortHand(
  state: GameState,
  reason: AbortReason
): GameState | { error: EngineError } {
  if (!ABORTABLE.has(state.tableState)) return { error: "WRONG_STATE" };
  if (reason === "PLAYER_ABANDONED") return { error: "ILLEGAL_ACTION" };

  const s = structuredClone(state);

  for (const p of s.seats) {
    p.chips += p.committedThisHand;
    p.committedThisHand = 0;
    p.committedThisStreet = 0;
  }

  s.tableState = "settlement";
  s.aborted = { reason };
  s.board = [];
  s.holeCards = [[], [], [], []];
  s.pots = [];
  s.awards = [];
  s.needsCards = null;
  s.toActSeat = null;
  return s;
}