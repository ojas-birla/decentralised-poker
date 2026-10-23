// shared/engine/types.ts
import { TableState, AbortReason } from "../types";
import { CardId } from "./cards";

export interface PlayerState {
  seat: 0 | 1 | 2 | 3;
  wallet: string;
  sessionKey: string;
  chips: number;       // starts at 1000
  inHand: boolean;
  hasFolded: boolean;
  isAllIn: boolean;
  committedThisStreet: number;
  committedThisHand: number;
  evicted: boolean;
  connected: boolean;
}

export interface PotState {
  amount: number;
  eligibleSeats: (0 | 1 | 2 | 3)[];
}

export interface GameState {
  tableId: string;
  tableState: TableState;
  handNumber: number;
  checkpointNumber: number; // SPEC §3: starts at 0, increments per signed checkpoint
  seats: [PlayerState, PlayerState, PlayerState, PlayerState];
  dealerSeat: 0 | 1 | 2 | 3;
  blinds: { small: 5; big: 10 };
  board: CardId[]; // deck[8..12]
  holeCards: [CardId[], CardId[], CardId[], CardId[]]; // By seat, e.g. holeCards[seat]
  pots: PotState[];
  toActSeat: 0 | 1 | 2 | 3 | null;
  currentBet: number;
  lastRaiseSize: number;
  street: "preflop" | "flop" | "turn" | "river" | "showdown";
  aborted?: { reason: AbortReason }; // SPEC §4
  needsCards?: CardId[] | null; // Used for Phase 3 (padlock shuffle) and board unlock
}