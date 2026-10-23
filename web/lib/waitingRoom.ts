import { TableState, SEATS, USE_MOCK } from "@/lib/lobby";

// Per-seat view model for the waiting room (step 1.37).
// PROPOSAL: SPEC.md does not define per-seat status fields yet. Agree these
// with Person C (and add them to SPEC.md with a commit starting "SPEC:").
export interface SeatView {
  address: string | null; // lowercase, null = empty seat
  connected: boolean; // socket connected to the game server
  deposited: boolean; // deposit confirmed on-chain
  ready: boolean; // player pressed "ready"
}

export interface WaitingRoomState {
  tableId: string;
  state: TableState;
  buyInWei: string; // decimal string
  hands: number;
  seats: SeatView[]; // always length 4, seat 0 first (creator)
}

export const WAITING_STATES: readonly TableState[] = ["lobby", "waiting_deposits", "ready"];

export function isWaitingState(s: TableState): boolean {
  return WAITING_STATES.includes(s);
}

const EMPTY: SeatView = { address: null, connected: false, deposited: false, ready: false };

function seat(n: number, flags: Partial<SeatView> = {}): SeatView {
  const address = "0x" + String(n).repeat(40);
  return { address, connected: true, deposited: false, ready: false, ...flags };
}

export interface MockScenario {
  label: string;
  build: (tableId: string) => WaitingRoomState;
}

const base = (tableId: string) => ({
  tableId,
  buyInWei: "1000000000000000",
  hands: 10,
});

export const MOCK_SCENARIOS: MockScenario[] = [
  {
    label: "Lobby (2 of 4 seats)",
    build: (id) => ({
      ...base(id),
      state: "lobby",
      seats: [seat(1, { deposited: true }), seat(2, { deposited: true }), EMPTY, EMPTY],
    }),
  },
  {
    label: "Waiting for deposits",
    build: (id) => ({
      ...base(id),
      state: "waiting_deposits",
      seats: [
        seat(1, { deposited: true }),
        seat(2, { deposited: true }),
        seat(3, { deposited: false }),
        seat(4, { deposited: true, connected: false }),
      ],
    }),
  },
  {
    label: "Ready check",
    build: (id) => ({
      ...base(id),
      state: "ready",
      seats: [
        seat(1, { deposited: true, ready: true }),
        seat(2, { deposited: true, ready: true }),
        seat(3, { deposited: true }),
        seat(4, { deposited: true, ready: true }),
      ],
    }),
  },
];

export function filledSeats(room: WaitingRoomState): number {
  return room.seats.filter((s) => s.address !== null).length;
}

export function countWhere(room: WaitingRoomState, key: "connected" | "deposited" | "ready"): number {
  return room.seats.filter((s) => s.address !== null && s[key]).length;
}

// One clear sentence for the banner (step 1.40 will reuse this idea).
export function bannerText(room: WaitingRoomState): string {
  const filled = filledSeats(room);
  if (room.state === "lobby") {
    return `Waiting for players: ${filled} of ${SEATS} seats filled.`;
  }
  if (room.state === "waiting_deposits") {
    const missing = room.seats.findIndex((s) => s.address !== null && !s.deposited);
    return missing >= 0
      ? `Waiting for seat ${missing + 1}'s deposit (${countWhere(room, "deposited")} of ${SEATS} confirmed).`
      : "Waiting for deposits to confirm on-chain.";
  }
  const notReady = room.seats.findIndex((s) => s.address !== null && !s.ready);
  return notReady >= 0
    ? `All deposits confirmed. Waiting for seat ${notReady + 1} to press ready.`
    : "Everyone is ready. The game is starting.";
}

// Server fetch is added in step 2.1. Until then mock mode is the only source.
export function getMockRoom(tableId: string, scenario: number): WaitingRoomState {
  if (!USE_MOCK) throw new Error("Server table state is wired in step 2.1.");
  return MOCK_SCENARIOS[scenario].build(tableId);
}