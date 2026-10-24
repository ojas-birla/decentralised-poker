// server/src/store.ts
// Plan step 1.30: thin repository functions over the tables in db.ts. No game rules live here.
import type { Checkpoint, GameState, PlayerState, Reject, Seat } from "@poker/shared";
import type { Db } from "./db";

const lc = (s: string) => s.toLowerCase();

// ---------------------------------------------------------------- games

export interface GameMeta {
  tableId: string;
  creator: string;
  buyInWei: string;
  weiPerChip: string;
  totalHands: number;
}
export interface LoadedGame {
  meta: GameMeta;
  state: GameState;
}

interface GameRow {
  table_id: string;
  creator: string;
  buy_in_wei: string;
  wei_per_chip: string;
  total_hands: number;
  state_json: string;
}

/** A fresh table: lobby, 1000 chips each, nobody seated yet. */
export function newGameState(tableId: string): GameState {
  const seat = (i: number): PlayerState => ({
    seat: i as Seat, wallet: "", sessionKey: "", chips: 1000, inHand: false, hasFolded: false,
    isAllIn: false, committedThisStreet: 0, committedThisHand: 0, hasActedThisStreet: false,
    evicted: false, connected: false,
  });
  return {
    tableId, tableState: "lobby", handNumber: 0, checkpointNumber: 0,
    seats: [seat(0), seat(1), seat(2), seat(3)], dealerSeat: 0, blinds: { small: 5, big: 10 },
    board: [], holeCards: [[], [], [], []], pots: [], awards: [], toActSeat: null,
    currentBet: 0, lastRaiseSize: 10, street: "preflop", deck: null, needsCards: null,
  };
}

/** Called when `createTable` is confirmed on-chain. Throws on bad input (this is not network input). */
export function createGame(
  db: Db,
  a: { tableId: string; creator: string; buyInWei: bigint; totalHands: number },
  now = Date.now()
): void {
  if (!/^\d+$/.test(a.tableId)) throw new Error("tableId must be a decimal string");
  if (a.buyInWei <= 0n || a.buyInWei % 1000n !== 0n) {
    throw new Error("buy-in must be positive and divisible by 1000 wei (SPEC conventions)");
  }
  if (!Number.isSafeInteger(a.totalHands) || a.totalHands < 1) throw new Error("bad totalHands");
  const state = newGameState(a.tableId);
  db.prepare(
    `INSERT INTO games (table_id, creator, buy_in_wei, wei_per_chip, total_hands, table_state, state_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    a.tableId, lc(a.creator), a.buyInWei.toString(), (a.buyInWei / 1000n).toString(),
    a.totalHands, state.tableState, JSON.stringify(state), now, now
  );
}

export function loadGame(db: Db, tableId: string): LoadedGame | null {
  const row = db.prepare("SELECT * FROM games WHERE table_id = ?").get(tableId) as GameRow | undefined;
  if (!row) return null;
  return {
    meta: {
      tableId: row.table_id, creator: row.creator, buyInWei: row.buy_in_wei,
      weiPerChip: row.wei_per_chip, totalHands: row.total_hands,
    },
    state: JSON.parse(row.state_json) as GameState,
  };
}

export function saveState(db: Db, tableId: string, state: GameState, now = Date.now()): void {
  db.prepare("UPDATE games SET state_json = ?, table_state = ?, updated_at = ? WHERE table_id = ?")
    .run(JSON.stringify(state), state.tableState, now, tableId);
}

// ---------------------------------------------------------------- players

export interface PlayerRow {
  tableId: string;
  seat: Seat;
  wallet: string;
  sessionKey: string;
  deposited: boolean;
  lastSeq: number;
  connected: boolean;
}

interface PlayerDbRow {
  table_id: string; seat: number; wallet: string; session_key: string;
  deposited: number; last_seq: number; connected: number;
}
const toPlayer = (r: PlayerDbRow): PlayerRow => ({
  tableId: r.table_id, seat: r.seat as Seat, wallet: r.wallet, sessionKey: r.session_key,
  deposited: r.deposited === 1, lastSeq: r.last_seq, connected: r.connected === 1,
});

/**
 * Called when a seat is filled on-chain (createTable for seat 0, joinTable for seats 1..3).
 * When the 4th seat fills, the table moves lobby -> waiting_deposits (SPEC §4).
 */
export function addPlayer(
  db: Db,
  a: { tableId: string; seat: Seat; wallet: string; sessionKey: string },
  now = Date.now()
): void {
  if (![0, 1, 2, 3].includes(a.seat)) throw new Error("bad seat");
  db.transaction(() => {
    const game = loadGame(db, a.tableId);
    if (!game) throw new Error("unknown table");
    if (game.state.tableState !== "lobby") throw new Error("table is not in the lobby");
    const wallet = lc(a.wallet);
    const sessionKey = lc(a.sessionKey);
    // The primary key and the UNIQUE(table_id, wallet) constraint throw on a taken seat or a repeat wallet.
    db.prepare("INSERT INTO players (table_id, seat, wallet, session_key) VALUES (?, ?, ?, ?)")
      .run(a.tableId, a.seat, wallet, sessionKey);
    const s = game.state;
    s.seats[a.seat].wallet = wallet;
    s.seats[a.seat].sessionKey = sessionKey;
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM players WHERE table_id = ?").get(a.tableId) as { n: number };
    if (n === 4) s.tableState = "waiting_deposits";
    saveState(db, a.tableId, s, now);
  })();
}

export function getPlayer(db: Db, tableId: string, seat: number): PlayerRow | null {
  const r = db.prepare("SELECT * FROM players WHERE table_id = ? AND seat = ?").get(tableId, seat) as PlayerDbRow | undefined;
  return r ? toPlayer(r) : null;
}

export function getPlayers(db: Db, tableId: string): PlayerRow[] {
  return (db.prepare("SELECT * FROM players WHERE table_id = ? ORDER BY seat").all(tableId) as PlayerDbRow[]).map(toPlayer);
}

export function setLastSeq(db: Db, tableId: string, seat: number, seq: number): void {
  db.prepare("UPDATE players SET last_seq = ? WHERE table_id = ? AND seat = ?").run(seq, tableId, seat);
}

export function setConnected(db: Db, tableId: string, seat: number, connected: boolean): void {
  db.prepare("UPDATE players SET connected = ? WHERE table_id = ? AND seat = ?").run(connected ? 1 : 0, tableId, seat);
}

export function setDeposited(db: Db, tableId: string, seat: number): void {
  db.prepare("UPDATE players SET deposited = 1 WHERE table_id = ? AND seat = ?").run(tableId, seat);
}

// ---------------------------------------------------------------- event log

export interface EventInput {
  kind: "envelope" | "server";
  handNumber: number;
  seat?: number | null;
  seq?: number | null;
  type?: string | null;
  body: unknown;
}
export interface EventRow {
  index: number;
  kind: "envelope" | "server";
  handNumber: number;
  body: unknown;
}

/** Appends to the ordered log and returns its index (0, 1, 2, ...). */
export function appendEvent(db: Db, tableId: string, e: EventInput, now = Date.now()): number {
  const { next } = db.prepare("SELECT COALESCE(MAX(idx), -1) + 1 AS next FROM events WHERE table_id = ?")
    .get(tableId) as { next: number };
  db.prepare(
    `INSERT INTO events (table_id, idx, kind, hand_number, seat, seq, type, body_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(tableId, next, e.kind, e.handNumber, e.seat ?? null, e.seq ?? null, e.type ?? null, JSON.stringify(e.body), now);
  return next;
}

/** Everything from `fromIndex` on: what a reconnecting client replays (SPEC §1). */
export function getEvents(db: Db, tableId: string, fromIndex = 0): EventRow[] {
  const rows = db.prepare(
    "SELECT idx, kind, hand_number, body_json FROM events WHERE table_id = ? AND idx >= ? ORDER BY idx"
  ).all(tableId, fromIndex) as { idx: number; kind: "envelope" | "server"; hand_number: number; body_json: string }[];
  return rows.map(r => ({ index: r.idx, kind: r.kind, handNumber: r.hand_number, body: JSON.parse(r.body_json) }));
}

export function logReject(db: Db, tableId: string, seat: number | null, raw: unknown, reject: Reject, now = Date.now()): void {
  let rawJson = "";
  try { rawJson = JSON.stringify(raw) ?? ""; } catch { rawJson = "<unserialisable>"; }
  db.prepare(
    "INSERT INTO rejects (table_id, seat, ref_seq, code, message, raw_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(tableId, seat, reject.refSeq, reject.code, reject.message, rawJson.slice(0, 20_000), now);
}

// ---------------------------------------------------------------- checkpoints

export interface CheckpointRow {
  tableId: string;
  checkpointNumber: number;
  handNumber: number;
  balances: string[];
  evicted: boolean[];
  checkpointHash: string;
  complete: boolean;
  sigs: Record<number, string>; // seat -> signature
}

interface CheckpointDbRow {
  table_id: string; checkpoint_number: number; hand_number: number;
  balances_json: string; evicted_json: string; checkpoint_hash: string; complete: number;
}

export function insertCheckpoint(
  db: Db, tableId: string, cp: Checkpoint, handNumber: number, checkpointHash: string, now = Date.now()
): void {
  db.prepare(
    `INSERT INTO checkpoints (table_id, checkpoint_number, hand_number, balances_json, evicted_json, checkpoint_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(tableId, cp.checkpointNumber, handNumber, JSON.stringify(cp.balances), JSON.stringify(cp.evicted), lc(checkpointHash), now);
}

export function getCheckpoint(db: Db, tableId: string, checkpointNumber: number): CheckpointRow | null {
  const r = db.prepare("SELECT * FROM checkpoints WHERE table_id = ? AND checkpoint_number = ?")
    .get(tableId, checkpointNumber) as CheckpointDbRow | undefined;
  if (!r) return null;
  const sigs: Record<number, string> = {};
  const rows = db.prepare("SELECT seat, signature FROM checkpoint_sigs WHERE table_id = ? AND checkpoint_number = ?")
    .all(tableId, checkpointNumber) as { seat: number; signature: string }[];
  for (const s of rows) sigs[s.seat] = s.signature;
  return {
    tableId: r.table_id, checkpointNumber: r.checkpoint_number, handNumber: r.hand_number,
    balances: JSON.parse(r.balances_json), evicted: JSON.parse(r.evicted_json),
    checkpointHash: r.checkpoint_hash, complete: r.complete === 1, sigs,
  };
}

export function addCheckpointSig(db: Db, tableId: string, checkpointNumber: number, seat: number, signature: string): void {
  db.prepare("INSERT INTO checkpoint_sigs (table_id, checkpoint_number, seat, signature) VALUES (?, ?, ?, ?)")
    .run(tableId, checkpointNumber, seat, signature);
}

export function markCheckpointComplete(db: Db, tableId: string, checkpointNumber: number): void {
  db.prepare("UPDATE checkpoints SET complete = 1 WHERE table_id = ? AND checkpoint_number = ?").run(tableId, checkpointNumber);
}

/** The latest fully signed checkpoint: what gets submitted to the contract at the end (SPEC §3 step 4). */
export function latestCompleteCheckpoint(db: Db, tableId: string): CheckpointRow | null {
  const r = db.prepare(
    "SELECT checkpoint_number FROM checkpoints WHERE table_id = ? AND complete = 1 ORDER BY checkpoint_number DESC LIMIT 1"
  ).get(tableId) as { checkpoint_number: number } | undefined;
  return r ? getCheckpoint(db, tableId, r.checkpoint_number) : null;
}