// server/src/timers.ts
// Plan step 1.31 / SPEC §2 "Timers tied to messages": 30 s per bet_action, then auto-check if free, else auto-fold.
//
// The server cannot act for a player (no key). On expiry it appends an UNSIGNED `auto` server event to the log
// and applies the same fold/check through the shared engine. Clients replay `auto` events through the engine too,
// so everyone ends in the same state (SPEC §1: server events are informational, clients recompute).
//
// The deadline lives in the `timers` table, and one polling loop reads it, so a restart loses nothing:
// a deadline that passed while the server was down fires on the first tick after start().
import { applyAction } from "@poker/shared";
import type { GameState, Seat } from "@poker/shared";
import type { Db } from "./db";
import { logStreets } from "./streetLog";
import { appendEvent, loadGame, saveState } from "./store";

export const TURN_MS = 30_000;

export interface TimerRow {
  tableId: string;
  kind: string;
  seat: Seat;
  handNumber: number;
  deadline: number;
}

export interface AutoResult {
  tableId: string;
  index: number; // position of the `auto` event in the log
  seat: Seat;
  action: "fold" | "check";
  handNumber: number;
  state: GameState;
}

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
 * Restarts the clock to match `state`: running for whoever must act, cleared when nobody does.
 * Call it after EVERY state change (ingest does; the code that calls startHand must too).
 */
export function syncTurnTimer(db: Db, tableId: string, state: GameState, now = Date.now()): void {
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

function fireOne(db: Db, t: TimerRow, now: number): AutoResult | null {
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
  return { tableId: t.tableId, index, seat: t.seat, action, handNumber: s.handNumber, state: next };
}

/** Fires every clock whose deadline has passed. Synchronous, so it can never interleave with ingest(). */
export function fireDueTimers(db: Db, now = Date.now()): AutoResult[] {
  const due = (db.prepare("SELECT * FROM timers WHERE deadline <= ? ORDER BY deadline").all(now) as TimerDbRow[]).map(toTimer);
  const out: AutoResult[] = [];
  for (const t of due) {
    const r = db.transaction(() => fireOne(db, t, now))();
    if (r) out.push(r);
  }
  return out;
}

/** Polls the timers table. `onAuto` is where the socket layer (2.1) broadcasts the new event and state. */
export class TurnTimerScheduler {
  private handle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: Db,
    private readonly onAuto: (r: AutoResult) => void,
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