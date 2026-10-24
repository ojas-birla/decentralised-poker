// Test-only helpers: build a GameState by hand (same idea as shared/engine/engine.test.ts).
// Not a *.test.ts file, so vitest does not run it; it is only imported by tests.
import type { GameState, PlayerState, Seat } from "@poker/shared";

export const seat = (i: number, over: Partial<PlayerState> = {}): PlayerState => ({
  seat: i as Seat,
  wallet: "0x" + String(i + 1).repeat(40),
  sessionKey: "0xk" + i,
  chips: 1000,
  inHand: false,
  hasFolded: false,
  isAllIn: false,
  committedThisStreet: 0,
  committedThisHand: 0,
  hasActedThisStreet: false,
  evicted: false,
  connected: true,
  ...over,
});

export const game = (over: Partial<GameState> = {}): GameState => ({
  tableId: "1",
  tableState: "betting",
  handNumber: 1,
  checkpointNumber: 0,
  seats: [seat(0), seat(1), seat(2), seat(3)],
  dealerSeat: 0,
  blinds: { small: 5, big: 10 },
  board: [],
  holeCards: [[], [], [], []],
  pots: [],
  awards: [],
  toActSeat: null,
  currentBet: 0,
  lastRaiseSize: 10,
  street: "preflop",
  deck: null,
  needsCards: null,
  ...over,
});
