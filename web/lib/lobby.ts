// Mirrors SPEC.md section 4. Replace with an import from "@poker/shared"
// once shared/states.ts exists.
export const TABLE_STATES = [
  "lobby",
  "waiting_deposits",
  "ready",
  "dealing",
  "betting",
  "showdown",
  "settlement",
  "finished",
  "aborted",
] as const;
export type TableState = (typeof TABLE_STATES)[number];

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

function normalise(raw: unknown): TableSummary | null {
  const t = raw as Partial<TableSummary> | null;
  if (!t || typeof t !== "object") return null;
  if (typeof t.tableId !== "string" || !/^\d+$/.test(t.tableId)) return null;
  if (typeof t.buyInWei !== "string" || !/^\d+$/.test(t.buyInWei)) return null;
  if (typeof t.hands !== "number" || !Array.isArray(t.players)) return null;
  if (typeof t.state !== "string") return null;
  if (!(TABLE_STATES as readonly string[]).includes(t.state)) return null;
  return {
    tableId: t.tableId,
    buyInWei: t.buyInWei,
    hands: t.hands,
    players: t.players.map((p) => String(p).toLowerCase()), // SPEC.md: lowercase addresses
    state: t.state as TableState,
  };
}

export async function fetchOpenTables(): Promise<TableSummary[]> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 300)); // feel like a real request
    return MOCK_TABLES;
  }
  const res = await fetch(`${SERVER_URL}/tables`);
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new Error("Server sent an unexpected response.");
  return data.map(normalise).filter((t): t is TableSummary => t !== null);
}