import type { Db } from "../db";
import { addPlayer, createGame, loadGame, saveState, setDeposited } from "../store";
import type { ChainEvent } from "./events";

export type ApplyResult =
  | { status: "applied"; note?: string }
  | { status: "skipped"; note: string }
  | { status: "duplicate" }
  | { status: "error"; note: string };

/** Our own two tables, so nothing in db.ts has to change. */
export function initChainTables(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chain_cursor (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      last_block INTEGER NOT NULL            -- last block fully processed
    );
    CREATE TABLE IF NOT EXISTS chain_events (
      tx_hash      TEXT NOT NULL,
      log_index    INTEGER NOT NULL,
      block_number INTEGER NOT NULL,
      type         TEXT NOT NULL,
      outcome      TEXT NOT NULL,            -- applied | skipped | error
      note         TEXT,
      PRIMARY KEY (tx_hash, log_index)
    );
  `);
}

/** Last block fully processed, or startBlock - 1 on the very first run. */
export function getCursor(db: Db, startBlock: number): number {
  const row = db.prepare("SELECT last_block FROM chain_cursor WHERE id = 1").get() as
    | { last_block: number }
    | undefined;
  return row ? row.last_block : startBlock - 1;
}

/** Never moves backwards. */
export function setCursor(db: Db, block: number): void {
  db.prepare(
    `INSERT INTO chain_cursor (id, last_block) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET last_block = MAX(last_block, excluded.last_block)`
  ).run(block);
}

function handle(db: Db, ev: ChainEvent, now: number): ApplyResult {
  switch (ev.type) {
    case "TableCreated":
      createGame(db, { tableId: ev.tableId, creator: ev.creator, buyInWei: ev.buyInWei, totalHands: ev.handCount }, now);
      return { status: "applied" };

    case "PlayerJoined":
      // Deposits happen inside joinTable, so "joined" and "deposited" are the same moment.
      addPlayer(db, { tableId: ev.tableId, seat: ev.seat, wallet: ev.wallet, sessionKey: ev.sessionKey }, now);
      setDeposited(db, ev.tableId, ev.seat);
      return { status: "applied" };

    case "TableStarted": {
      // addPlayer already moved the table to waiting_deposits when the 4th seat filled.
      const g = loadGame(db, ev.tableId);
      if (!g) throw new Error(`TableStarted for unknown table ${ev.tableId}`);
      return { status: "applied", note: `state is ${g.state.tableState}` };
    }

    case "TableCancelled":
    case "EmergencyRefund": {
      const g = loadGame(db, ev.tableId);
      if (!g) throw new Error(`${ev.type} for unknown table ${ev.tableId}`);
      g.state.tableState = "aborted";
      saveState(db, ev.tableId, g.state, now);
      return { status: "applied" };
    }

    case "CheckpointSubmitted":
    case "Finalized":
      return { status: "skipped", note: "checkpoint events are used in step 2.7" };
  }
}

/**
 * Applies one event exactly once. A repeat is a "duplicate". A failure is recorded as an "error"
 * and marked processed, so one bad event never blocks the ones after it.
 */
export function applyChainEvent(db: Db, ev: ChainEvent, now = Date.now()): ApplyResult {
  return db.transaction((): ApplyResult => {
    const seen = db.prepare("SELECT 1 FROM chain_events WHERE tx_hash = ? AND log_index = ?").get(ev.txHash, ev.logIndex);
    if (seen) return { status: "duplicate" };

    let result: ApplyResult;
    try {
      // A savepoint so a failed handler (e.g. addPlayer half-way) rolls back only its own writes.
      db.exec("SAVEPOINT ev");
      result = handle(db, ev, now);
      db.exec("RELEASE ev");
    } catch (e) {
      db.exec("ROLLBACK TO ev; RELEASE ev");
      result = { status: "error", note: e instanceof Error ? e.message : String(e) };
    }
    const note = result.status === "duplicate" ? null : result.note ?? null;
    db.prepare(
      "INSERT INTO chain_events (tx_hash, log_index, block_number, type, outcome, note) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(ev.txHash, ev.logIndex, ev.blockNumber, ev.type, result.status, note);
    return result;
  })();
}

/** Applies a batch in chain order, then moves the cursor. A crash in between is safe because repeats are deduped. */
export function processBatch(db: Db, events: ChainEvent[], toBlock: number, now = Date.now()) {
  const sorted = [...events].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  const results = sorted.map((ev) => ({ ev, result: applyChainEvent(db, ev, now) }));
  setCursor(db, toBlock);
  return results;
}
