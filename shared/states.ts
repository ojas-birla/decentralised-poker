// shared/states.ts
// SPEC §4 "Allowed message types by state". Server and clients use the same table (SPEC §1 rule 5).
import type { MessageType, TableState } from "./types";

// NOTE (proposed SPEC change, plan 1.32): `join` is also allowed in every state except `aborted`.
// A returning player re-sends `join` (same wallet, same session key) to rebind and fetch the log.
export const ALLOWED_MESSAGES: Record<TableState, readonly MessageType[]> = {
  lobby: ["join"],
  waiting_deposits: ["join", "ready"],
  ready: ["join", "ready"],
  dealing: ["join", "commit_padlock", "shuffle_step", "unlock_card", "abandon_vote"],
  betting: ["join", "bet_action", "unlock_card", "abandon_vote"],
  showdown: ["join", "reveal_padlock", "abandon_vote"],
  settlement: ["join", "checkpoint_sig", "ready", "abandon_vote"],
  finished: ["join", "checkpoint_sig"],
  aborted: [],
};

export const isMessageAllowed = (state: TableState, type: MessageType): boolean =>
  ALLOWED_MESSAGES[state].includes(type);