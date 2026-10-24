import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHand } from "@poker/shared";
import type { GameState, MessageType, Seat } from "@poker/shared";
import { openDb, type Db } from "./db";
import { addPlayer, createGame, getEvents, loadGame, saveState } from "./store";
import { ingest, type IngestDeps } from "./ingest";
import { TURN_MS, fireDueTimers, getTimer, syncTurnTimer } from "./timers";

const T = "1";
const wallet = (i: number) => "0x" + String(i + 1).repeat(40);
const key = (i: number) => "0x" + String(i + 5).repeat(40);
const deck = Array.from({ length: 52 }, (_, i) => i);
const baseDeps: IngestDeps = { verifySig: e => e.sig === "0xok", verifyCheckpointSig: () => true };
const at = (t: number): IngestDeps => ({ ...baseDeps, now: () => t });

// Hand 1 started at time 0: dealer 1, SB 2, BB 3, seat 0 to act.
function setup(db: Db) {
  createGame(db, { tableId: T, creator: wallet(0), buyInWei: 1_000_000_000_000_000n, totalHands: 5 });
  for (let i = 0; i < 4; i++) addPlayer(db, { tableId: T, seat: i as Seat, wallet: wallet(i), sessionKey: key(i) });
  const st = loadGame(db, T)!.state;
  st.tableState = "ready";
  const started = startHand(st, deck) as GameState;
  saveState(db, T, started);
  syncTurnTimer(db, T, started, 0); // whoever calls startHand must also arm the clock
}
const bet = (seat: number, seq: number, action: string) =>
  ({ tableId: T, handNumber: 1, seq, sender: wallet(seat), seat, type: "bet_action" as MessageType, payload: { action }, sig: "0xok" });
const autos = (db: Db) => getEvents(db, T).filter(e => e.kind === "server").map(e => e.body as any);

describe("turn timer", () => {
  it("arms the clock for the player to act, and restarts it after every accepted action", () => {
    const db = openDb(); setup(db);
    expect(getTimer(db, T)).toMatchObject({ seat: 0, handNumber: 1, deadline: TURN_MS });
    ingest(db, at(1000), bet(0, 1, "call"));
    expect(getTimer(db, T)).toMatchObject({ seat: 1, deadline: 1000 + TURN_MS });
  });

  it("does nothing before the deadline", () => {
    const db = openDb(); setup(db);
    expect(fireDueTimers(db, TURN_MS - 1)).toEqual([]);
    expect(getEvents(db, T)).toHaveLength(0);
  });

  it("auto-folds when facing a bet, logs an auto event, and moves the clock on", () => {
    const db = openDb(); setup(db);
    const [r] = fireDueTimers(db, TURN_MS);
    expect(r).toMatchObject({ seat: 0, action: "fold", handNumber: 1 });
    expect(autos(db)).toEqual([{ kind: "auto", seat: 0, action: "fold", handNumber: 1 }]);
    const s = loadGame(db, T)!.state;
    expect(s.seats[0].hasFolded).toBe(true);
    expect(s.toActSeat).toBe(1);
    expect(getTimer(db, T)).toMatchObject({ seat: 1, deadline: 2 * TURN_MS });
  });

  it("auto-checks when it is free (big blind with its option)", () => {
    const db = openDb(); setup(db);
    ingest(db, at(0), bet(0, 1, "call")); ingest(db, at(0), bet(1, 1, "call")); ingest(db, at(0), bet(2, 1, "call"));
    expect(getTimer(db, T)).toMatchObject({ seat: 3 });
    const [r] = fireDueTimers(db, TURN_MS);
    expect(r).toMatchObject({ seat: 3, action: "check" });
    expect(loadGame(db, T)!.state.street).toBe("flop");
  });

  it("a late action after the auto-fold is rejected", () => {
    const db = openDb(); setup(db);
    fireDueTimers(db, TURN_MS); // seat 0 auto-folded
    const r = ingest(db, at(TURN_MS), bet(0, 1, "call")) as any;
    expect(r.reject.code).toBe("NOT_YOUR_TURN");
  });

  it("a stale deadline cannot fire after the player acted in time", () => {
    const db = openDb(); setup(db);
    ingest(db, at(10_000), bet(0, 1, "call")); // clock moves to seat 1, deadline 40_000
    expect(fireDueTimers(db, TURN_MS)).toEqual([]); // 30_000 < 40_000
    expect(loadGame(db, T)!.state.seats[1].hasFolded).toBe(false);
  });

  it("everyone timing out folds to the last player and clears the clock", () => {
    const db = openDb(); setup(db);
    for (let i = 1; i <= 3; i++) fireDueTimers(db, i * TURN_MS); // seats 0, 1, 2 fold
    const s = loadGame(db, T)!.state;
    expect(s.tableState).toBe("settlement");
    expect(s.seats[3].chips).toBe(1005);
    expect(getTimer(db, T)).toBeNull();
    expect(autos(db)).toHaveLength(3);
  });

  it("survives a restart: a deadline that passed while the server was down fires on the next tick", () => {
    const file = join(mkdtempSync(join(tmpdir(), "poker-")), "t.db");
    let db = openDb(file); setup(db);
    db.close();

    db = openDb(file);
    expect(getTimer(db, T)).toMatchObject({ seat: 0, deadline: TURN_MS }); // deadline was stored, not lost
    const [r] = fireDueTimers(db, TURN_MS + 5000);
    expect(r).toMatchObject({ seat: 0, action: "fold" });
    db.close();
  });
});