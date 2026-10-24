import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHand } from "@poker/shared";
import type { GameState, MessageType, Seat } from "@poker/shared";
import { openDb, type Db } from "./db";
import { addPlayer, createGame, getEvents, getPlayer, latestCompleteCheckpoint, loadGame, saveState } from "./store";
import { ingest, type IngestDeps } from "./ingest";

const T = "1";
const wallet = (i: number) => "0x" + String(i + 1).repeat(40);
const key = (i: number) => "0x" + String(i + 5).repeat(40);
const deck = Array.from({ length: 52 }, (_, i) => i);
const HASH = "0x" + "ab".repeat(32);
const SIG = "0x" + "cd".repeat(65);

// Stub crypto: the real checks come from shared/envelope.ts and the shared EIP-712 checkpoint code.
const deps: IngestDeps = { verifySig: e => e.sig === "0xok", verifyCheckpointSig: () => true };

function setup(db: Db, startPlay = true) {
  createGame(db, { tableId: T, creator: wallet(0), buyInWei: 1_000_000_000_000_000n, totalHands: 5 });
  for (let i = 0; i < 4; i++) addPlayer(db, { tableId: T, seat: i as Seat, wallet: wallet(i), sessionKey: key(i) });
  if (startPlay) {
    const st = loadGame(db, T)!.state;
    st.tableState = "ready";
    saveState(db, T, startHand(st, deck) as GameState); // dealer 1, SB 2, BB 3, seat 0 to act
  }
}
const env = (seat: number, seq: number, type: MessageType, payload: unknown, handNumber = 1, sig = "0xok") =>
  ({ tableId: T, handNumber, seq, sender: wallet(seat), seat, type, payload, sig });
const bet = (seat: number, seq: number, action: string, amount?: number) =>
  env(seat, seq, "bet_action", amount === undefined ? { action } : { action, amount });
const code = (r: any) => (r.ok ? "OK" : r.reject.code);
const cpSig = (seat: number, seq: number, hash = HASH) =>
  env(seat, seq, "checkpoint_sig", { checkpointNumber: 1, checkpointHash: hash, signature: SIG });

describe("ingest", () => {
  it("accepts a legal action: logs it, advances seq and state", () => {
    const db = openDb(); setup(db);
    const r = ingest(db, deps, bet(0, 1, "fold")) as any;
    expect(r.ok).toBe(true);
    expect(r.index).toBe(0);
    expect(r.state.toActSeat).toBe(1);
    expect(getPlayer(db, T, 0)!.lastSeq).toBe(1);
    expect(getEvents(db, T)).toHaveLength(1);
    expect(loadGame(db, T)!.state.toActSeat).toBe(1);
  });

  it("rejects out-of-turn and leaves no trace in the log or the seq", () => {
    const db = openDb(); setup(db);
    expect(code(ingest(db, deps, bet(1, 1, "call")))).toBe("NOT_YOUR_TURN");
    expect(getEvents(db, T)).toHaveLength(0);
    expect(getPlayer(db, T, 1)!.lastSeq).toBe(0);
    expect(code(ingest(db, deps, bet(1, 1, "call")))).toBe("NOT_YOUR_TURN"); // same seq may be reused after a reject
  });

  it("rejects duplicate and gapped seq", () => {
    const db = openDb(); setup(db);
    ingest(db, deps, bet(0, 1, "call"));
    expect(code(ingest(db, deps, bet(0, 1, "call")))).toBe("DUPLICATE");
    expect(code(ingest(db, deps, bet(0, 3, "call")))).toBe("BAD_SEQ");
    expect(getEvents(db, T)).toHaveLength(1);
  });

  it("rejects bad signature, wrong wallet for the seat, wrong hand, wrong state", () => {
    const db = openDb(); setup(db);
    expect(code(ingest(db, deps, bet(0, 1, "fold")))).toBe("OK");
    expect(code(ingest(db, deps, env(1, 1, "bet_action", { action: "fold" }, 1, "0xbad")))).toBe("BAD_SIG");
    expect(code(ingest(db, deps, { ...bet(1, 1, "fold"), sender: wallet(2) }))).toBe("BAD_SEAT");
    expect(code(ingest(db, deps, env(1, 1, "bet_action", { action: "fold" }, 7)))).toBe("WRONG_HAND");
    expect(code(ingest(db, deps, env(1, 1, "ready", { ready: true }, 0)))).toBe("WRONG_STATE");
  });

  it("rejects malformed envelopes and payloads", () => {
    const db = openDb(); setup(db);
    expect(code(ingest(db, deps, null))).toBe("BAD_PAYLOAD");
    expect(code(ingest(db, deps, { tableId: T }))).toBe("BAD_PAYLOAD");
    expect(code(ingest(db, deps, bet(0, 1, "dance")))).toBe("BAD_PAYLOAD");
    expect(code(ingest(db, deps, bet(0, 1, "fold", 5)))).toBe("BAD_PAYLOAD"); // amount only for raise
  });

  it("lets the engine reject illegal raises", () => {
    const db = openDb(); setup(db);
    expect(code(ingest(db, deps, bet(0, 1, "raise", 5000)))).toBe("ILLEGAL_ACTION");
    expect(code(ingest(db, deps, bet(0, 1, "raise", 12.5)))).toBe("BAD_PAYLOAD");
    expect(code(ingest(db, deps, bet(0, 1, "raise", 20)))).toBe("OK");
  });

  it("join binds the connection and checks the registered session key", () => {
    const db = openDb(); setup(db, false);
    expect(loadGame(db, T)!.state.tableState).toBe("waiting_deposits");
    expect(code(ingest(db, deps, env(0, 1, "join", { sessionKey: key(3) }, 0)))).toBe("BAD_PAYLOAD");
    expect(code(ingest(db, deps, env(0, 1, "join", { sessionKey: key(0) }, 0)))).toBe("OK");
    expect(getPlayer(db, T, 0)!.connected).toBe(true);
  });

  it("collects checkpoint signatures and completes when all four have signed", () => {
    const db = openDb(); setup(db);
    for (const seat of [0, 1, 2]) ingest(db, deps, bet(seat, 1, "fold")); // seat 3 wins the blinds
    expect(loadGame(db, T)!.state.tableState).toBe("settlement");

    expect(code(ingest(db, deps, cpSig(0, 2)))).toBe("OK");
    expect(code(ingest(db, deps, cpSig(1, 2, "0x" + "ee".repeat(32))))).toBe("BAD_PAYLOAD"); // different hash
    expect(code(ingest(db, deps, cpSig(1, 2)))).toBe("OK");
    expect(code(ingest(db, deps, cpSig(2, 2)))).toBe("OK");
    expect(latestCompleteCheckpoint(db, T)).toBeNull();
    expect(loadGame(db, T)!.state.checkpointNumber).toBe(0);

    expect(code(ingest(db, deps, cpSig(3, 1)))).toBe("OK");
    expect(loadGame(db, T)!.state.checkpointNumber).toBe(1);
    const cp = latestCompleteCheckpoint(db, T)!;
    expect(cp.checkpointNumber).toBe(1);
    expect(cp.balances[3]).toBe("1005000000000000");
    expect(Object.keys(cp.sigs)).toHaveLength(4);
  });

  it("survives a restart: state and log reload from disk", () => {
    const file = join(mkdtempSync(join(tmpdir(), "poker-")), "test.db");
    let db = openDb(file); setup(db);
    ingest(db, deps, bet(0, 1, "fold"));
    db.close();

    db = openDb(file);
    expect(loadGame(db, T)!.state.toActSeat).toBe(1);
    expect(getEvents(db, T)).toHaveLength(1);
    expect(getPlayer(db, T, 0)!.lastSeq).toBe(1);
    expect(code(ingest(db, deps, bet(0, 1, "fold")))).toBe("DUPLICATE"); // replay after restart is still caught
    db.close();
  });
});