import { TableState } from "@/lib/lobby";

// PROPOSAL: SPEC.md does not define this view model yet. Agree the shape with
// Person C (the server will send it in step 2.1). Changes to SPEC.md need a
// commit message starting "SPEC:".
//
// Chip accounting: stack + currentBet over all seats + pot = 4000 at all times.
// "pot" excludes bets still in front of players in the current betting round.

// Cards are two characters: rank (2-9, T, J, Q, K, A) then suit (s, h, d, c).
export type CardCode = string;

export interface PlayerView {
  address: string | null; // lowercase, null = empty or busted seat
  stack: number; // chips behind
  currentBet: number; // chips in front of the player this round
  folded: boolean;
  allIn: boolean;
  isDealer: boolean;
}

// Computed by the engine, never by the UI. Only present on your own turn.
export interface LegalActions {
  canCheck: boolean;
  toCall: number; // extra chips needed to call (0 if you can check)
  minRaiseTo: number; // total bet size after a minimum raise
  maxRaiseTo: number; // total bet size when going all-in (stack + current bet)
}

export type PlayerAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "raise"; raiseTo: number } // raiseTo = your total bet this round
  | { type: "allin" };

export interface TableView {
  tableId: string; // decimal string
  state: TableState;
  handNumber: number; // 1-based
  totalHands: number;
  seats: PlayerView[]; // always length 4, seat 0 first
  board: CardCode[]; // 0, 3, 4 or 5 cards
  pot: number;
  mySeat: number | null; // null = spectator
  myHole: [CardCode, CardCode] | null; // only ever your own cards
  turnSeat: number | null;
  turnDeadlineMs: number | null; // epoch ms
  legal: LegalActions | null; // null when it is not your turn
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export interface RaisePresets {
  min: number;
  half: number;
  pot: number;
  max: number;
}

// Convenience amounts for the raise slider. All are clamped to the legal range.
export function raisePresets(view: TableView, legal: LegalActions): RaisePresets {
  const bets = view.seats.reduce((sum, p) => sum + p.currentBet, 0);
  const totalPot = view.pot + bets;
  const myBet = view.mySeat !== null ? view.seats[view.mySeat].currentBet : 0;
  const highestBet = myBet + legal.toCall;
  const clamp = (n: number) =>
    Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.floor(n)));
  return {
    min: legal.minRaiseTo,
    half: clamp(highestBet + (totalPot + legal.toCall) / 2),
    pot: clamp(highestBet + totalPot + legal.toCall),
    max: legal.maxRaiseTo,
  };
}

export interface MockTableScenario {
  label: string;
  build: (tableId: string, now: number) => TableView;
}

function addr(n: number): string {
  return "0x" + String(n).repeat(40);
}

export const MOCK_TABLE_VIEWS: MockTableScenario[] = [
  {
    label: "Your turn (flop, facing a bet)",
    build: (tableId, now) => ({
      tableId,
      state: "betting",
      handNumber: 3,
      totalHands: 10,
      seats: [
        { address: addr(1), stack: 960, currentBet: 0, folded: false, allIn: false, isDealer: false },
        { address: addr(2), stack: 920, currentBet: 20, folded: false, allIn: false, isDealer: true },
        { address: addr(3), stack: 1000, currentBet: 0, folded: true, allIn: false, isDealer: false },
        { address: addr(4), stack: 1050, currentBet: 0, folded: false, allIn: false, isDealer: false },
      ],
      board: ["Ah", "7d", "2c"],
      pot: 50,
      mySeat: 0,
      myHole: ["Ks", "Qs"],
      turnSeat: 0,
      turnDeadlineMs: now + 22000,
      legal: { canCheck: false, toCall: 20, minRaiseTo: 40, maxRaiseTo: 960 },
    }),
  },
  {
    label: "Your turn (river, can check)",
    build: (tableId, now) => ({
      tableId,
      state: "betting",
      handNumber: 7,
      totalHands: 10,
      seats: [
        { address: addr(1), stack: 800, currentBet: 0, folded: false, allIn: false, isDealer: false },
        { address: addr(2), stack: 700, currentBet: 0, folded: false, allIn: false, isDealer: false },
        { address: addr(3), stack: 1000, currentBet: 0, folded: true, allIn: false, isDealer: true },
        { address: addr(4), stack: 1260, currentBet: 0, folded: false, allIn: false, isDealer: false },
      ],
      board: ["Ah", "7d", "2c", "Kh", "9s"],
      pot: 240,
      mySeat: 0,
      myHole: ["Jd", "Td"],
      turnSeat: 0,
      turnDeadlineMs: now + 28000,
      legal: { canCheck: true, toCall: 0, minRaiseTo: 10, maxRaiseTo: 800 },
    }),
  },
  {
    label: "Opponent's turn (river)",
    build: (tableId, now) => ({
      tableId,
      state: "betting",
      handNumber: 7,
      totalHands: 10,
      seats: [
        { address: addr(1), stack: 800, currentBet: 0, folded: false, allIn: false, isDealer: false },
        { address: addr(2), stack: 700, currentBet: 0, folded: false, allIn: false, isDealer: false },
        { address: addr(3), stack: 1000, currentBet: 0, folded: true, allIn: false, isDealer: true },
        { address: addr(4), stack: 1260, currentBet: 0, folded: false, allIn: false, isDealer: false },
      ],
      board: ["Ah", "7d", "2c", "Kh", "9s"],
      pot: 240,
      mySeat: 0,
      myHole: ["Jd", "Td"],
      turnSeat: 3,
      turnDeadlineMs: now + 14000,
      legal: null,
    }),
  },
];