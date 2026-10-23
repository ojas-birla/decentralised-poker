// shared/engine/checkpoint.ts
// SPEC §3: the signed balance sheet computed from a settled hand.
import type { Checkpoint } from "../types";
import { GameState, EngineError } from "./types";

const TOTAL_CHIPS = 4000; // 4 players x 1000 chips (SPEC conventions)

/**
 * Builds the checkpoint that every client signs after a hand is settled.
 * - Only valid in "settlement" or "finished" (SPEC §3 rule 6: never describes a hand in progress).
 * - balances[i] = chips[i] * weiPerChip, as decimal strings (SPEC: wei is never a JS number).
 * - checkpointNumber = state.checkpointNumber + 1. The caller stores the new number on
 *   the state only once the checkpoint is actually fully signed (SPEC §3).
 */
export function computeCheckpoint(
  state: GameState,
  weiPerChip: bigint
): Checkpoint | { error: EngineError } {
  if (state.tableState !== "settlement" && state.tableState !== "finished") {
    return { error: "WRONG_STATE" };
  }
  if (typeof weiPerChip !== "bigint" || weiPerChip <= 0n) return { error: "BAD_PAYLOAD" };
  // Settled hands have nothing committed, and chips must add up (SPEC §3 rules 1 and 2).
  if (state.seats.some(p => p.committedThisHand !== 0)) return { error: "ILLEGAL_ACTION" };
  if (state.seats.some(p => !Number.isSafeInteger(p.chips) || p.chips < 0)) {
    return { error: "ILLEGAL_ACTION" };
  }
  if (state.seats.reduce((n, p) => n + p.chips, 0) !== TOTAL_CHIPS) {
    return { error: "ILLEGAL_ACTION" };
  }

  const balances = state.seats.map(p => (BigInt(p.chips) * weiPerChip).toString());
  const evicted = state.seats.map(p => p.evicted);
  return {
    tableId: state.tableId,
    checkpointNumber: state.checkpointNumber + 1,
    balances: balances as Checkpoint["balances"],
    evicted: evicted as Checkpoint["evicted"],
  };
}