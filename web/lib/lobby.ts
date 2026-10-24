import type { TableState } from "@poker/shared";

// D4: TableState now comes from shared/types.ts (single source of truth).
// Re-exported so the other web files can keep importing it from "@/lib/lobby".
export type { TableState };

// Runtime list of the 9 states (used to validate rows from the server).
export const TABLE_STATES: readonly TableState[] = [
  "lobby",
  "waiting_deposits",
  "ready",
  "dealing",
  "betting",
  "showdown",
  "settlement",
  "finished",
  "aborted",
];

export interface TableSummary {
  tableId: string; // decimal string (SPEC.md)
  buyInWei: string; // decimal string (SPEC.md)
  hands: number;
  players: string[]; // lowercase wallet addresses, seat 0 first
  state: TableState;
}

export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";
export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "true";
export const SEATS = 4;

export const MOCK_TABLES: TableSummary[] = [
  {
    tableId: "7",
    buyInWei: "1000000000000000",
    hands: 10,
    players: ["0x1111111111111111111111111111111111111111"],
    state: "lobby",
  },
  {
    tableId: "8",
    buyInWei: "5000000000000000",
    hands: 5,
    players: [
      "0x2222222222222222222222222222222222222222",
      "0x3333333333333333333333333333333333333333",
      "0x4444444444444444444444444444444444444444",
    ],
    state: "lobby",
  },
  {
    tableId: "9",
    buyInWei: "10000000000000000",
    hands: 20,
    players: [
      "0x5555555555555555555555555555555555555555",
      "0x6666666666666666666666666666666666666666",
    ],
    state: "lobby",
  },
];

// D1: one row of the server's GET /api/tables (server/src/lobby.ts `OpenTable`)
// mapped to the TableSummary the lobby page renders.
//   totalHands -> hands,  seats[{seat,wallet}] -> players (seat order, creator first),
//   state -> "lobby" (the endpoint only returns lobby tables).
function normalise(raw: unknown): TableSummary | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.tableId !== "string" || !/^\d+$/.test(r.tableId)) return null;
  if (typeof r.buyInWei !== "string" || !/^\d+$/.test(r.buyInWei)) return null;
  if (typeof r.totalHands !== "number" || !Number.isInteger(r.totalHands)) return null;
  if (!Array.isArray(r.seats)) return null;

  const seats = (r.seats as unknown[])
    .filter(
      (s): s is { seat: number; wallet: string } =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as { seat?: unknown }).seat === "number" &&
        typeof (s as { wallet?: unknown }).wallet === "string"
    )
    .sort((a, b) => a.seat - b.seat);

  return {
    tableId: r.tableId,
    buyInWei: r.buyInWei,
    hands: r.totalHands,
    players: seats.map((s) => s.wallet.toLowerCase()), // SPEC.md: lowercase addresses
    state: "lobby",
  };
}

export async function fetchOpenTables(): Promise<TableSummary[]> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 300)); // feel like a real request
    return MOCK_TABLES;
  }
  const res = await fetch(`${SERVER_URL}/api/tables`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const data: unknown = await res.json();
  const list = (data as { tables?: unknown } | null)?.tables;
  if (!Array.isArray(list)) throw new Error("Server sent an unexpected response.");
  return list.map(normalise).filter((t): t is TableSummary => t !== null);
}