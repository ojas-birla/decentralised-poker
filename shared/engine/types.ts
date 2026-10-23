// shared/engine/types.ts
import type { TableState, AbortReason, RejectCode } from "../types";
import type { CardId, DeckIndex } from "./cards";

export type Seat = 0 | 1 | 2 | 3;

// Subset of the SPEC §1 RejectCode that the pure engine can produce.
export type EngineError = Extract<
  RejectCode,
  "WRONG_STATE" | "NOT_YOUR_TURN" | "ILLEGAL_ACTION" | "BAD_PAYLOAD"
>;

export interface PlayerState {
  seat: Seat;
  wallet: string;
  sessionKey: string;
  chips: number; // starts at 1000; chips NOT yet committed to the current hand
  inHand: boolean;
  hasFolded: boolean;
  isAllIn: boolean;
  committedThisStreet: number;
  committedThisHand: number;
  hasActedThisStreet: boolean; // reset every street; reset for others on a full raise
  evicted: boolean;
  connected: boolean;
}

export interface PotState {
  amount: number;
  eligibleSeats: Seat[];
}

// Chips paid out when a hand is settled (uncontested or showdown).
export interface HandAward {
  seat: Seat;
  amount: number;
}

export interface GameState {
  tableId: string;
  tableState: TableState;
  handNumber: number;
  checkpointNumber: number; // SPEC §3: starts at 0, increments per signed checkpoint
  seats: [PlayerState, PlayerState, PlayerState, PlayerState];
  dealerSeat: Seat;
  blinds: { small: 5; big: 10 };
  board: CardId[]; // card identities revealed so far (from deck[8..12])
  holeCards: [CardId[], CardId[], CardId[], CardId[]]; // by seat; card identities
  pots: PotState[];
  awards: HandAward[]; // filled when the hand reaches settlement
  toActSeat: Seat | null; // null = nobody can act (betting closed / not in betting)
  currentBet: number;
  lastRaiseSize: number;
  street: "preflop" | "flop" | "turn" | "river" | "showdown";
  aborted?: { reason: AbortReason }; // SPEC §4

  // Phase 2 DEV-ONLY server dealing: the full shuffled deck (identities).
  // The server must never send this to clients in production. null in Phase 3.
  deck: CardId[] | null;

  // Phase 3 (padlock shuffle): deck POSITIONS that still need unlocks.
  needsCards: DeckIndex[] | null;
}

// Invariant that must hold at every point inside a hand, and at settlement
// (where committedThisHand is zero): sum(chips) + sum(committedThisHand) === 4000.
export function totalChips(state: GameState): number {
  return state.seats.reduce((n, p) => n + p.chips + p.committedThisHand, 0);
}