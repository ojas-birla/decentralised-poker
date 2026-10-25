// server/src/timers.ts
// Plan step 1.31 / SPEC §2 "Timers tied to messages": 30 s per bet_action, then auto-check if free, else auto-fold.
// SPEC-PHASE3 D7: one clock per table. kind 'turn' = 30 s for bet_action, kind 'crypto' = 60 s for the seat that owes
// the next crypto message (commit, shuffle, unlock, reveal). When a crypto clock runs out the hand is aborted (CRYPTO_STALL).
//
// The server cannot act for a player (no key). On a turn expiry it appends an UNSIGNED `auto` server event to the log
// and applies the same fold/check through the shared engine. Clients replay `auto` events through the engine too,
// so everyone ends in the same state (SPEC §1: server events are informational, clients recompute).
//
// The deadline lives in the `timers` table, and one polling loop reads it, so a restart loses nothing:
// a deadline that passed while the server was down fires on the first tick after start().
import { abortHand, applyAction } from "@poker/shared";
import type { GameState, Seat } from "@poker/shared";
import { deriveDealing, nextDuties, type DealingEventRow } from "@poker/shared/crypto/dealingView";
import type { Db } from "./db";
import { logStreets } from "./streetLog";
import { appendEvent, getEvents, loadGame, saveState } from "./store";

export const TURN_MS = 30_000;
export const CRYPTO_MS = 60_000;

export interface TimerRow {
  tableId: string;
  kind: string;
  seat: Seat;
  handNumber: number;
  deadline: number;
}

export interface AutoResult {
  kind: "auto";
  tableId: string;
  index: number; // position of the `auto` event in the log
  seat: Seat;
  action: "fold" | "check";
  handNumber: number;
  state: GameState;
}

/** A crypto clock ran out: the hand was aborted. `seat` is the seat we were waiting for. */
export interface AbortResult {
  kind: "abort";
  tableId: string;
  index: number; // position of the `abort` server event in the log
  seat: Seat;
  reason: "CRYPTO_STALL";
  handNumber: number;
  state: GameState;
}

export type TimerResult = AutoResult | AbortResult;

interface TimerDbRow { table_id: string; kind: string; seat: number; hand_number: number; deadline: number }
const toTimer = (r: TimerDbRow): TimerRow => ({
  tableId: r.table_id, kind: r.kind, seat: r.seat as Seat, handNumber: r.hand_number, deadline: r.deadline,
});

export function getTimer(db: Db, tableId: string): TimerRow | null {
  const r = db.prepare("SELECT * FROM timers WHERE table_id = ?").get(tableId) as TimerDbRow | undefined;
  return r ? toTimer(r) : null;
}

export function clearTimer(db: Db, tableId: string): void {
  db.prepare("DELETE FROM timers WHERE table_id = ?").run(tableId);
}

/**
 * SPEC-PHASE3 C-6: the lowest active seat that still owes a crypto message, or null.
 * Only meaningful with the real shuffle (deck === null) while the table waits for crypto:
 * dealing, showdown, or betting with board cards pending (needsCards).
 */
export function awaitedSeat(db: Db, tableId: string, state: GameState): Seat | null {
  if (state.deck !== null) return null;
  const waiting =
    state.tableState === "dealing" ||
    state.tableState === "showdown" ||
    (state.tableState === "betting" && state.needsCards !== null && state.needsCards.length > 0);
  if (!waiting) return null;

  const active = state.seats.filter(p => p.inHand).map(p => p.seat); // ascending
  const view = deriveDealing(
    getEvents(db, tableId) as unknown as DealingEventRow[], state.handNumber, active, state.dealerSeat,
  );
  for (const seat of active) {
    const duties = nextDuties({
      view, mySeat: seat, activeSeats: active, dealer: state.dealerSeat,
      needsCards: state.needsCards, showdown: state.tableState === "showdown",
      stillInHand: !state.seats[seat].hasFolded,
    });
    if (duties.length > 0) return seat;
  }
  return null;
}

/**
 * Restarts the clock to match `state`: running for whoever must act, cleared when nobody does.
 * Call it after EVERY state change (ingest does; the code that calls startHand must too), and after every
 * crypto message, because those change who we are waiting for without changing the game state.
 */
export function syncTurnTimer(db: Db, tableId: string, state: GameState, now = Date.now()): void {
  const waitingOn = awaitedSeat(db, tableId, state);
  if (waitingOn !== null) {
    const cur = getTimer(db, tableId);
    // D7: same seat, same hand, same kind: keep the old deadline, so other players' messages cannot reset it.
    if (cur && cur.kind === "crypto" && cur.seat === waitingOn && cur.handNumber === state.handNumber) return;
    db.prepare(
      `INSERT INTO timers (table_id, kind, seat, hand_number, deadline) VALUES (?, 'crypto', ?, ?, ?)
       ON CONFLICT(table_id) DO UPDATE SET kind = 'crypto', seat = excluded.seat,
         hand_number = excluded.hand_number, deadline = excluded.deadline`
    ).run(tableId, waitingOn, state.handNumber, now + CRYPTO_MS);
    return;
  }
  if (state.tableState === "betting" && state.toActSeat !== null) {
    db.prepare(
      `INSERT INTO timers (table_id, kind, seat, hand_number, deadline) VALUES (?, 'turn', ?, ?, ?)
       ON CONFLICT(table_id) DO UPDATE SET kind = 'turn', seat = excluded.seat,
         hand_number = excluded.hand_number, deadline = excluded.deadline`
    ).run(tableId, state.toActSeat, state.handNumber, now + TURN_MS);
  } else {
    clearTimer(db, tableId);
  }
}

function fireCrypto(db: Db, t: TimerRow, now: number): AbortResult | null {
  const game = loadGame(db, t.tableId);
  const s = game?.state;
  // Stale clock: the hand moved on, or we are now waiting for somebody else. Re-sync (arms a fresh clock if needed).
  if (!s || s.handNumber !== t.handNumber || awaitedSeat(db, t.tableId, s) !== t.seat) {
    if (s) syncTurnTimer(db, t.tableId, s, now); else clearTimer(db, t.tableId);
    return null;
  }
  const next = abortHand(s, "CRYPTO_STALL");
  if ("error" in next) {
    clearTimer(db, t.tableId); // never loop on a clock the engine refuses
    return null;
  }
  const index = appendEvent(db, t.tableId, {
    kind: "server", handNumber: s.handNumber, seat: t.seat, type: "abort",
    body: { kind: "abort", handNumber: s.handNumber, reason: "CRYPTO_STALL" },
  }, now);
  saveState(db, t.tableId, next, now);
  syncTurnTimer(db, t.tableId, next, now); // settlement: clears the clock
  return { kind: "abort", tableId: t.tableId, index, seat: t.seat, reason: "CRYPTO_STALL", handNumber: s.handNumber, state: next };
}

function fireTurn(db: Db, t: TimerRow, now: number): AutoResult | null {
  const game = loadGame(db, t.tableId);
  const s = game?.state;
  // Stale clock (the player already acted, or the hand moved on): drop it without touching the game.
  if (!s || s.tableState !== "betting" || s.toActSeat !== t.seat || s.handNumber !== t.handNumber) {
    clearTimer(db, t.tableId);
    return null;
  }
  const action: "fold" | "check" = s.currentBet - s.seats[t.seat].committedThisStreet > 0 ? "fold" : "check";
  const next = applyAction(s, t.seat, { type: action });
  if ("error" in next) {
    clearTimer(db, t.tableId); // should not happen; never loop on a clock the engine refuses
    return null;
  }
  const index = appendEvent(db, t.tableId, {
    kind: "server", handNumber: s.handNumber, seat: t.seat, type: "auto",
    body: { kind: "auto", seat: t.seat, action, handNumber: s.handNumber },
  }, now);
  logStreets(db, t.tableId, s, next, now);
  saveState(db, t.tableId, next, now);
  syncTurnTimer(db, t.tableId, next, now);
  return { kind: "auto", tableId: t.tableId, index, seat: t.seat, action, handNumber: s.handNumber, state: next };
}

function fireOne(db: Db, t: TimerRow, now: number): TimerResult | null {
  return t.kind === "crypto" ? fireCrypto(db, t, now) : fireTurn(db, t, now);
}

/** Fires every clock whose deadline has passed. Synchronous, so it can never interleave with ingest(). */
export function fireDueTimers(db: Db, now = Date.now()): TimerResult[] {
  const due = (db.prepare("SELECT * FROM timers WHERE deadline <= ? ORDER BY deadline").all(now) as TimerDbRow[]).map(toTimer);
  const out: TimerResult[] = [];
  for (const t of due) {
    const r = db.transaction(() => fireOne(db, t, now))();
    if (r) out.push(r);
  }
  return out;
}

/** Polls the timers table. `onAuto` is where the socket layer broadcasts the new event and state (auto action or abort). */
export class TurnTimerScheduler {
  private handle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: Db,
    private readonly onAuto: (r: TimerResult) => void,
    private readonly pollMs = 500,
    private readonly clock: () => number = Date.now
  ) {}

  /** Starts polling; the first tick runs immediately, which handles deadlines missed during a restart. */
  start(): void {
    if (this.handle) return;
    this.tick();
    this.handle = setInterval(() => this.tick(), this.pollMs);
  }

  stop(): void {
    if (this.handle) clearInterval(this.handle);
    this.handle = null;
  }

  tick(): void {
    try {
      for (const r of fireDueTimers(this.db, this.clock())) this.onAuto(r);
    } catch (e) {
      console.error("turn timer tick failed", e); // a bad tick must not kill the server
    }
  }
}