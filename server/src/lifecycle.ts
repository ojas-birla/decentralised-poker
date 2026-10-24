// server/src/lifecycle.ts
// SPEC-2.1 §7 C5: moves a table through ready -> hand -> showdown -> settlement -> next hand -> finished.
// Phase 2 only: the server deals a crypto-random deck (dev safety net, replaced in Phase 3).
//
// afterChange() is idempotent: every step checks the current tableState first, so calling it twice is harmless.
// Call it after ANYTHING that changed a table: an accepted envelope, an auto action, a chain event, a restart.
import { randomInt } from "node:crypto";
import { advanceStreet, resolveShowdown, startHand } from "@poker/shared";
import type { GameState } from "@poker/shared";
import type { Db } from "./db";
import { appendEvent, getPlayers, loadGame, saveState } from "./store";
import { getTimer, syncTurnTimer } from "./timers";

/** What the server writes into the log (kind "server"). Never put cards or the deck in here. */
export type LifecycleLog =
  | { kind: "table_state"; state: GameState["tableState"] }
  | { kind: "hand_started"; handNumber: number; dealerSeat: number }
  | { kind: "hand_settled"; handNumber: number; awards: GameState["awards"] };

export interface LifecycleDeps {
  /** Tests inject a fixed deck. Production uses randomDeck(). */
  randomDeck?: () => number[];
  now?: () => number;
}

/** After a restart every turn clock has at least this long left, so reconnecting players are not folded on the first tick. */
export const RESTART_GRACE_MS = 10_000;

/** Fisher-Yates over 0..51 with crypto.randomInt. Never Math.random. */
export function randomDeck(rand: (maxExclusive: number) => number = n => randomInt(n)): number[] {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = rand(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/** Seats that sent a hand-0 `ready` envelope (ingest only relays `ready`, so the log is the record). */
function readySeats(db: Db, tableId: string): Set<number> {
  const rows = db.prepare(
    "SELECT DISTINCT seat FROM events WHERE table_id = ? AND kind = 'envelope' AND type = 'ready' AND hand_number = 0"
  ).all(tableId) as { seat: number }[];
  return new Set(rows.map(r => r.seat));
}

function hasServerEvent(db: Db, tableId: string, type: string, handNumber: number): boolean {
  return db.prepare(
    "SELECT 1 FROM events WHERE table_id = ? AND kind = 'server' AND type = ? AND hand_number = ? LIMIT 1"
  ).get(tableId, type, handNumber) !== undefined;
}

/** Appends the log entries, saves the state and restarts the turn clock, all in the caller's transaction. */
function commit(db: Db, tableId: string, next: GameState, logs: LifecycleLog[], now: number): void {
  for (const body of logs) {
    appendEvent(db, tableId, { kind: "server", handNumber: next.handNumber, type: body.kind, body }, now);
  }
  saveState(db, tableId, next, now);
  syncTurnTimer(db, tableId, next, now);
}

/** Logs the right entry for a state that startHand() returned. */
const startedLog = (s: GameState): LifecycleLog =>
  s.tableState === "finished"
    ? { kind: "table_state", state: "finished" }
    : { kind: "hand_started", handNumber: s.handNumber, dealerSeat: s.dealerSeat };

/** Does one transition. Returns true if something changed (so the caller loops again). */
function stepOnce(db: Db, tableId: string, makeDeck: () => number[], now: number): boolean {
  const game = loadGame(db, tableId);
  if (!game) return false;
  const s = game.state;

  switch (s.tableState) {
    case "waiting_deposits": {
      const players = getPlayers(db, tableId);
      if (players.length !== 4 || !players.every(p => p.deposited)) return false;
      const ready = readySeats(db, tableId);
      if (![0, 1, 2, 3].every(seat => ready.has(seat))) return false;
      const next = structuredClone(s);
      next.tableState = "ready";
      commit(db, tableId, next, [{ kind: "table_state", state: "ready" }], now);
      return true;
    }

    case "ready": {
      const r = startHand(s, makeDeck());
      if ("error" in r) { console.error(`[lifecycle] startHand failed on table ${tableId}: ${r.error}`); return false; }
      commit(db, tableId, r, [startedLog(r)], now);
      return true;
    }

    case "betting": {
      // Betting is closed from the start (everyone all-in from the blinds): run the streets out.
      // Only Phase 2: with no dev deck (Phase 3) the engine waits for unlocks instead.
      if (s.toActSeat !== null || s.deck === null) return false;
      commit(db, tableId, advanceStreet(s), [], now);
      return true;
    }

    case "showdown": {
      const r = resolveShowdown(s); // Phase 2: hole cards already exist, nothing to reveal
      if ("error" in r) { console.error(`[lifecycle] resolveShowdown failed on table ${tableId}: ${r.error}`); return false; }
      commit(db, tableId, r, [], now);
      return true;
    }

    case "settlement": {
      // Uncontested wins and auto-folds reach settlement inside applyAction, so log it here, once per hand.
      if (!hasServerEvent(db, tableId, "hand_settled", s.handNumber)) {
        commit(db, tableId, s, [{ kind: "hand_settled", handNumber: s.handNumber, awards: s.awards }], now);
        return true;
      }
      // One checkpoint per hand. ingest() stores checkpointNumber on the state only once all sigs are in.
      if (s.checkpointNumber < s.handNumber) return false;

      if (s.handNumber >= game.meta.totalHands) {
        const next = structuredClone(s);
        next.tableState = "finished";
        next.toActSeat = null;
        commit(db, tableId, next, [{ kind: "table_state", state: "finished" }], now);
        return true;
      }
      const r = startHand(s, makeDeck()); // settlement -> betting, or finished if fewer than 2 seats have chips
      if ("error" in r) { console.error(`[lifecycle] startHand failed on table ${tableId}: ${r.error}`); return false; }
      commit(db, tableId, r, [startedLog(r)], now);
      return true;
    }

    default:
      return false; // lobby, dealing, finished, aborted: nothing for the server to do
  }
}

/** Runs transitions until nothing changes. Returns true if the table changed at all. */
export function afterChange(db: Db, tableId: string, deps: LifecycleDeps = {}): boolean {
  const makeDeck = deps.randomDeck ?? randomDeck;
  let changed = false;
  for (let guard = 0; guard < 20; guard++) { // a hand never needs more than a handful of steps
    const now = deps.now ? deps.now() : Date.now();
    if (!db.transaction(() => stepOnce(db, tableId, makeDeck, now))()) break;
    changed = true;
  }
  return changed;
}

/** Call once at server start, after resetAllConnected(). Finishes anything a crash left half-done. */
export function recoverAll(db: Db, deps: LifecycleDeps = {}): string[] {
  // C8: a clock that ran out while the server was down must not fire before the players have had a chance to reconnect.
  // Deadlines still in the future are kept exactly as they are (plan 4.5: timers resume).
  const graceUntil = (deps.now ? deps.now() : Date.now()) + RESTART_GRACE_MS;
  db.prepare("UPDATE timers SET deadline = ? WHERE deadline < ?").run(graceUntil, graceUntil);

  const ids = (db.prepare(
    "SELECT table_id FROM games WHERE table_state NOT IN ('lobby', 'finished', 'aborted')"
  ).all() as { table_id: string }[]).map(r => r.table_id);
  const changed: string[] = [];
  for (const id of ids) {
    if (afterChange(db, id, deps)) changed.push(id);
    const g = loadGame(db, id);
    // Keep an existing deadline (it survives restarts); only create a clock if one is missing.
    if (g && g.state.tableState === "betting" && g.state.toActSeat !== null && !getTimer(db, id)) {
      syncTurnTimer(db, id, g.state);
    }
  }
  return changed;
}
