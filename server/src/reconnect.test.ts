import { describe, it, expect } from "vitest";
import { startHand } from "@poker/shared";
import type { GameState, MessageType, Seat } from "@poker/shared";
import { openDb, type Db } from "./db";
import { addPlayer, createGame, getEvents, getPlayer, loadGame, saveState } from "./store";
import { ingest, type IngestDeps } from "./ingest";
import { TURN_MS, getTimer, syncTurnTimer } from "./timers";
import { disconnect, publicState, reconnect, resetAllConnected } from "./reconnect";

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
  syncTurnTimer(db, T, started, 0);
}
const bet = (seat: number, seq: number, action: string) =>
  ({ tableId: T, handNumber: 1, seq, sender: wallet(seat), seat, type: "bet_action" as MessageType, payload: { action }, sig: "0xok" });
const join = (seat: number, seq: number, sessionKey = key(seat), sig = "0xok") =>
  ({ tableId: T, handNumber: 0, seq, sender: wallet(seat), seat, type: "join" as MessageType, payload: { sessionKey }, sig });

describe("reconnect", () => {
  it("returns the full log, a safe snapshot, the server's next seq and the running clock", () => {
    const db = openDb(); setup(db);
    ingest(db, at(1000), bet(0, 1, "call"));
    ingest(db, at(1000), bet(1, 1, "call"));

    const r = reconnect(db, at(2000), join(0, 2));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.view;
    expect(v.events.map(e => e.index)).toEqual([0, 1, 2]); // two bets, then the rejoin itself
    expect(v.events[2].kind).toBe("envelope");
    expect(v.nextSeq).toBe(3);
    expect(v.timer).toEqual({ seat: 2, deadline: 1000 + TURN_MS });
    expect(v.state.tableState).toBe("betting");
    expect(v.state.deck).toBeNull(); // the dev deck never reaches a client
    expect(v.state.holeCards[0]).toHaveLength(2);
    expect(v.state.holeCards[1]).toEqual([]);
    expect(v.state.holeCards[2]).toEqual([]);
    expect(v.players.find(p => p.seat === 0)!.connected).toBe(true);
    expect(v.players.find(p => p.seat === 1)!.connected).toBe(false);
  });

  it("does not leak: publicState for another seat shows only that seat's cards", () => {
    const db = openDb(); setup(db);
    const s = loadGame(db, T)!.state;
    expect(s.deck).not.toBeNull(); // the server really holds it
    const p3 = publicState(s, 3);
    expect(p3.deck).toBeNull();
    expect(p3.holeCards[3]).toHaveLength(2);
    expect([0, 1, 2].every(i => p3.holeCards[i].length === 0)).toBe(true);
    expect(s.deck).not.toBeNull(); // the original is untouched
  });

  it("rejoining does NOT reset the turn clock", () => {
    const db = openDb(); setup(db); // seat 0 to act, deadline 30_000
    const r = reconnect(db, at(20_000), join(0, 1));
    expect(r.ok).toBe(true);
    expect(getTimer(db, T)).toMatchObject({ seat: 0, deadline: TURN_MS });
  });

  it("can resume from a log index", () => {
    const db = openDb(); setup(db);
    ingest(db, at(0), bet(0, 1, "call"));
    ingest(db, at(0), bet(1, 1, "call"));
    const r = reconnect(db, at(0), join(0, 2), 1);
    expect(r.ok && r.view.events.map(e => e.index)).toEqual([1, 2]);
    const bad = reconnect(db, at(0), join(1, 2), -5); // nonsense index falls back to 0
    expect(bad.ok && bad.view.fromIndex).toBe(0);
  });

  it("rejects strangers and malformed requests", () => {
    const db = openDb(); setup(db);
    const code = (r: any) => (r.ok ? "OK" : r.reject.code);
    expect(code(reconnect(db, at(0), join(0, 1, key(3))))).toBe("BAD_PAYLOAD");       // not the registered session key
    expect(code(reconnect(db, at(0), join(0, 1, key(0), "0xbad")))).toBe("BAD_SIG");  // forged signature
    expect(code(reconnect(db, at(0), { ...join(0, 1), sender: wallet(2) }))).toBe("BAD_SEAT");
    expect(code(reconnect(db, at(0), bet(0, 1, "fold")))).toBe("BAD_PAYLOAD");        // must be a join
    expect(code(reconnect(db, at(0), null))).toBe("BAD_PAYLOAD");
    expect(code(reconnect(db, at(0), join(0, 5)))).toBe("BAD_SEQ");
    expect(getEvents(db, T)).toHaveLength(0); // nothing leaked into the log
  });

  it("a replayed join is a DUPLICATE and returns no data", () => {
    const db = openDb(); setup(db);
    expect(reconnect(db, at(0), join(0, 1)).ok).toBe(true);
    const again = reconnect(db, at(0), join(0, 1));
    expect(again.ok).toBe(false);
    expect(!again.ok && again.reject.code).toBe("DUPLICATE");
  });

  it("is refused once the table is aborted", () => {
    const db = openDb(); setup(db);
    const s = loadGame(db, T)!.state;
    s.tableState = "aborted";
    saveState(db, T, s);
    const r = reconnect(db, at(0), join(0, 1));
    expect(!r.ok && r.reject.code).toBe("WRONG_STATE");
  });

  it("disconnect and resetAllConnected clear presence in the players table and the state", () => {
    const db = openDb(); setup(db);
    reconnect(db, at(0), join(0, 1));
    reconnect(db, at(0), join(1, 1));
    expect(getPlayer(db, T, 0)!.connected).toBe(true);
    expect(loadGame(db, T)!.state.seats[0].connected).toBe(true);

    disconnect(db, T, 0);
    expect(getPlayer(db, T, 0)!.connected).toBe(false);
    expect(loadGame(db, T)!.state.seats[0].connected).toBe(false);
    expect(getPlayer(db, T, 1)!.connected).toBe(true);

    resetAllConnected(db); // server restart
    expect(getPlayer(db, T, 1)!.connected).toBe(false);
    expect(loadGame(db, T)!.state.seats[1].connected).toBe(false);
  });
});