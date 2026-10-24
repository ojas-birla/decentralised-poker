import { TableState } from "@/lib/lobby";

// Mirrors SPEC.md section 9. Replace with imports from "@poker/shared" once
// shared/view.ts exists. In the real app this shape is derived on each
// browser from the signed event log, never sent by the server.
//
// Chip accounting: stack + currentBet over all seats + pot = 4000 at all times.
// "pot" excludes bets still in front of players in the current betting round.

// Cards are two characters: rank (2-9, T, J, Q, K, A) then suit (s, h, d, c).
export type CardCode = string;

export interface PlayerView {
  address: string | null; // lowercase, null only for a seat nobody took
  connected: boolean; // from `presence` events (PROPOSAL: add to SPEC.md section 9)
  stack: number; // chips behind
  currentBet: number; // chips in front of the player this round
  folded: boolean;
  allIn: boolean;
  busted: boolean; // 0 chips, watching as a spectator
  isDealer: boolean;
  revealed?: [CardCode, CardCode]; // set at showdown after the reveal is verified (step 3.7)
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
  mySeat: number | null; // null = not seated at this table
  myHole: [CardCode, CardCode] | null; // only ever your own cards
  turnSeat: number | null;
  turnDeadlineMs: number | null; // epoch ms
  legal: LegalActions | null; // null when it is not your turn
}

// Length of one turn. Mirrors TURN_MS in server/src/timers.ts; only used to
// draw the countdown ring, the server's deadline is what actually counts.
export const TURN_MS = 30_000;

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function streetName(boardLength: number): string {
  if (boardLength >= 5) return "River";
  if (boardLength === 4) return "Turn";
  if (boardLength === 3) return "Flop";
  return "Pre-flop";
}

// Who posts the blinds. The UI works it out from the dealer button the same way the
// engine does (engine/dealer.ts): heads-up the dealer is the small blind, otherwise
// the small blind is the next player with chips after the dealer.
export function blindSeats(seats: PlayerView[]): { sb: number | null; bb: number | null } {
  const dealer = seats.findIndex((p) => p.isDealer);
  if (dealer < 0) return { sb: null, bb: null };
  const live = (i: number) => seats[i].address !== null && !seats[i].busted;
  const next = (from: number) => {
    for (let k = 1; k <= 4; k++) if (live((from + k) % 4)) return (from + k) % 4;
    return null;
  };
  const headsUp = seats.filter((_, i) => live(i)).length === 2;
  const sb = headsUp ? (live(dealer) ? dealer : next(dealer)) : next(dealer);
  const bb = sb === null ? null : next(sb);
  return { sb, bb };
}

// Share of the final pot you would be paying to call, as a whole percent.
export function potOdds(view: TableView, legal: LegalActions): number | null {
  if (legal.toCall <= 0) return null;
  const total = view.pot + view.seats.reduce((sum, p) => sum + p.currentBet, 0) + legal.toCall;
  return Math.round((legal.toCall / total) * 100);
}

export interface RaisePresets {
  min: number;
  half: number;
  pot: number;
  max: number;
}

// Convenience amounts for the raise controls. All are clamped to the legal range.
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

function seat(n: number, stack: number, extra: Partial<PlayerView> = {}): PlayerView {
  return {
    address: addr(n),
    connected: true,
    stack,
    currentBet: 0,
    folded: false,
    allIn: false,
    busted: false,
    isDealer: false,
    ...extra,
  };
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
        seat(1, 960),
        seat(2, 920, { currentBet: 20, isDealer: true }),
        seat(3, 1000, { folded: true }),
        seat(4, 1050),
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
        seat(1, 800),
        seat(2, 700),
        seat(3, 1000, { folded: true, isDealer: true }),
        seat(4, 1260),
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
        seat(1, 800),
        seat(2, 700),
        seat(3, 1000, { folded: true, isDealer: true }),
        seat(4, 1260),
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
  {
    label: "Dealing (cards face down)",
    build: (tableId) => ({
      tableId,
      state: "dealing",
      handNumber: 4,
      totalHands: 10,
      seats: [
        seat(1, 1000),
        seat(2, 995, { currentBet: 5, isDealer: true }),
        seat(3, 990, { currentBet: 10 }),
        seat(4, 1000),
      ],
      board: [],
      pot: 0,
      mySeat: 0,
      myHole: null,
      turnSeat: null,
      turnDeadlineMs: null,
      legal: null,
    }),
  },
];