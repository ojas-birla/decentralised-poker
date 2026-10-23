export type ConnectionState = "mock" | "connecting" | "connected" | "disconnected";

// Mirrors SPEC.md section 1 (AbortReason). Replace with an import from
// "@poker/shared" once it exists.
export type AbortReason =
  | "CRYPTO_STALL"
  | "BAD_REVEAL"
  | "DUPLICATE_CARD"
  | "PLAYER_ABANDONED";

// One line in the feed. `id` is the event log index, so keys stay stable.
export interface LogEntry {
  id: number;
  kind: "info" | "action" | "warn";
  text: string;
}

// PROPOSAL: not in SPEC.md yet. Something the player must be told about,
// derived from the event log and presence events.
export type TableNotice =
  | { kind: "waiting_for_player"; seat: number; deadlineMs: number } // 60 s reconnect grace
  | { kind: "hand_aborted"; reason: AbortReason }
  | { kind: "checkpoint_mismatch" }; // our balances differ from the others, so we do not sign

export interface Banner {
  level: "info" | "warn" | "error";
  text: string;
  deadlineMs?: number; // shows a countdown when set
}

const ABORT_TEXT: Record<AbortReason, string> = {
  CRYPTO_STALL: "a player stopped responding during the shuffle or card reveal",
  BAD_REVEAL: "a player's revealed cards failed verification",
  DUPLICATE_CARD: "a duplicate card was detected in the deck",
  PLAYER_ABANDONED: "a player left the game",
};

export function buildBanner(
  connection: ConnectionState,
  notice: TableNotice | null
): Banner | null {
  // Our own connection problems come first, because nothing else can be trusted.
  if (connection === "disconnected") {
    return {
      level: "error",
      text: "Connection to the game server lost. Trying to reconnect…",
    };
  }
  if (connection === "connecting") {
    return { level: "info", text: "Connecting to the game server…" };
  }
  if (!notice) return null;

  switch (notice.kind) {
    case "waiting_for_player":
      return {
        level: "warn",
        text: `Waiting for seat ${notice.seat + 1}'s connection. The hand is aborted if they do not return.`,
        deadlineMs: notice.deadlineMs,
      };
    case "hand_aborted": {
      // SPEC.md section 3: what an aborted hand does to the balances.
      const outcome =
        notice.reason === "PLAYER_ABANDONED"
          ? "The leaving player's chips in this pot are shared among the active players."
          : "All chips from this hand go back to their owners.";
      return {
        level: "warn",
        text: `Hand aborted: ${ABORT_TEXT[notice.reason]}. ${outcome}`,
      };
    }
    case "checkpoint_mismatch":
      return {
        level: "error",
        text: "Your computed balances do not match the other players'. Not signing the checkpoint.",
      };
  }
}

// ---------- Mock data (used while NEXT_PUBLIC_USE_MOCK=true) ----------

export interface MockNotice {
  label: string;
  build: (now: number) => TableNotice | null;
}

export const MOCK_NOTICES: MockNotice[] = [
  { label: "No notice", build: () => null },
  {
    label: "Waiting for seat 3",
    build: (now) => ({ kind: "waiting_for_player", seat: 2, deadlineMs: now + 45000 }),
  },
  {
    label: "Aborted (stall)",
    build: () => ({ kind: "hand_aborted", reason: "CRYPTO_STALL" }),
  },
  {
    label: "Aborted (abandoned)",
    build: () => ({ kind: "hand_aborted", reason: "PLAYER_ABANDONED" }),
  },
  { label: "Checkpoint mismatch", build: () => ({ kind: "checkpoint_mismatch" }) },
];

// One log per scenario in MOCK_TABLE_VIEWS, same order.
export const MOCK_LOGS: LogEntry[][] = [
  [
    { id: 0, kind: "info", text: "Hand 3 started. Seat 2 is the dealer." },
    { id: 1, kind: "info", text: "Cards dealt." },
    { id: 2, kind: "action", text: "Seat 3 folded." },
    { id: 3, kind: "info", text: "Flop: A♥ 7♦ 2♣." },
    { id: 4, kind: "action", text: "Seat 2 bet 20." },
  ],
  [
    { id: 0, kind: "info", text: "Hand 7 started. Seat 3 is the dealer." },
    { id: 1, kind: "action", text: "Seat 3 folded." },
    { id: 2, kind: "info", text: "Flop: A♥ 7♦ 2♣." },
    { id: 3, kind: "info", text: "Turn: K♥." },
    { id: 4, kind: "info", text: "River: 9♠." },
  ],
  [
    { id: 0, kind: "info", text: "Hand 7 started. Seat 3 is the dealer." },
    { id: 1, kind: "action", text: "Seat 3 folded." },
    { id: 2, kind: "info", text: "Flop: A♥ 7♦ 2♣." },
    { id: 3, kind: "info", text: "Turn: K♥." },
    { id: 4, kind: "info", text: "River: 9♠." },
  ],
];