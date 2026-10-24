import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { legalActions, totalChips } from "@poker/shared";
import type { MessageType, Seat } from "@poker/shared";
import { openDb, type Db } from "./db";
import { addPlayer, createGame, getEvents, getPlayer, loadGame, setDeposited } from "./store";
import { ingest, type IngestDeps } from "./ingest";
import { afterChange, randomDeck, recoverAll } from "./lifecycle";
import { reconnect } from "./reconnect";
import { getTimer } from "./timers";

const T = "1";
const wallet = (i: number) => "0x" + String(i + 1).repeat(40);
const key = (i: number) => "0x" + String(i + 5).repeat(40);
const HASH = "0x" + "ab".repeat(32);
const SIG = "0x" + "cd".repeat(65);
const deps: IngestDeps = { verifySig: e => e.sig === "0xok", verifyCheckpointSig: () => true }; // stub crypto
const L = { randomDeck: () => Array.from({ length: 52 }, (_, i) => i) };

function table(db: Db, totalHands = 2, deposits = 4) {
  createGame(db, { tableId: T, creator: wallet(0), buyInWei: 1_000_000_000_000_000n, totalHands });
  for (let i = 0; i < 4; i++) addPlayer(db, { tableId: T, seat: i as Seat, wallet: wallet(i), sessionKey: key(i) });
  for (let i = 0; i < deposits; i++) setDeposited(db, T, i);
}
const state = (db: Db) => loadGame(db, T)!.state;
const mk = (db: Db, seat: number, type: MessageType, payload: unknown, handNumber: number, seq?: number) => ({
  tableId: T, handNumber, seq: seq ?? getPlayer(db, T, seat)!.lastSeq + 1, sender: wallet(seat), seat, type, payload, sig: "0xok",
});
/** What the socket layer does for every accepted envelope: ingest, then the lifecycle. */
function send(db: Db, seat: number, type: MessageType, payload: unknown, handNumber: number, lifecycle = true) {
  const r = ingest(db, deps, mk(db, seat, type, payload, handNumber));
  if (!r.ok) throw new Error(`${type} from seat ${seat} rejected: ${r.reject.code} ${r.reject.message}`);
  if (lifecycle) afterChange(db, T, L);
}
const readyAll = (db: Db) => { for (let i = 0; i < 4; i++) send(db, i, "ready", { ready: true }, 0); };

function playHand(db: Db, mode: "checkdown" | "folds") {
  for (let guard = 0; guard < 100 && state(db).tableState === "betting"; guard++) {
    const s = state(db);
    const seat = s.toActSeat as Seat;
    const legal = legalActions(s, seat)!;
    const action = mode === "folds" ? "fold" : legal.canCheck ? "check" : "call";
    send(db, seat, "bet_action", { action }, s.handNumber);
  }
}
function signAll(db: Db, lifecycle = true) {
  const s = state(db);
  for (let seat = 0; seat < 4; seat++) {
    send(db, seat, "checkpoint_sig", { checkpointNumber: s.checkpointNumber + 1, checkpointHash: HASH, signature: SIG }, s.handNumber, lifecycle);
  }
}
const serverKinds = (db: Db) => getEvents(db, T).filter(e => e.kind === "server").map(e => (e.body as { kind: string }).kind);

describe("lifecycle", () => {
  it("starts hand 1 only after 4 deposits AND 4 ready envelopes", () => {
    const db = openDb(); table(db, 2, 3); // only 3 deposits
    readyAll(db);
    expect(state(db).tableState).toBe("waiting_deposits");

    setDeposited(db, T, 3);
    expect(afterChange(db, T, L)).toBe(true);
    const s = state(db);
    expect(s.tableState).toBe("betting");
    expect(s.handNumber).toBe(1);
    expect(s.deck).toHaveLength(52); // the dev deck lives in the database only
    expect(getTimer(db, T)!.seat).toBe(s.toActSeat);
    expect(serverKinds(db)).toEqual(["table_state", "hand_started"]);
  });

  it("waits while one seat has not sent ready", () => {
    const db = openDb(); table(db);
    for (let i = 0; i < 3; i++) send(db, i, "ready", { ready: true }, 0);
    expect(state(db).tableState).toBe("waiting_deposits");
    send(db, 3, "ready", { ready: true }, 0);
    expect(state(db).tableState).toBe("betting");
  });

  it("plays 2 hands: showdown settles, checkpoint starts the next hand, then finished; chips stay 4000", () => {
    const db = openDb(); table(db, 2);
    readyAll(db);

    playHand(db, "checkdown"); // everyone calls/checks to a showdown
    let s = state(db);
    expect(s.tableState).toBe("settlement");
    expect(totalChips(s)).toBe(4000);
    expect(serverKinds(db).filter(k => k === "hand_settled")).toHaveLength(1);
    expect(afterChange(db, T, L)).toBe(false); // calling it again does nothing
    expect(afterChange(db, T, L)).toBe(false);
    expect(serverKinds(db).filter(k => k === "hand_settled")).toHaveLength(1);
    expect(getTimer(db, T)).toBeNull();

    signAll(db); // 4th signature completes the checkpoint, so hand 2 is dealt
    s = state(db);
    expect(s.tableState).toBe("betting");
    expect(s.handNumber).toBe(2);
    expect(s.checkpointNumber).toBe(1);
    expect(totalChips(s)).toBe(4000);

    playHand(db, "folds");
    expect(state(db).tableState).toBe("settlement");
    signAll(db);
    s = state(db);
    expect(s.tableState).toBe("finished"); // handNumber 2 >= totalHands 2
    expect(s.checkpointNumber).toBe(2);
    expect(totalChips(s)).toBe(4000);
    expect(getTimer(db, T)).toBeNull();
    expect(serverKinds(db).filter(k => k === "hand_started")).toHaveLength(2);
  });

  it("logs an uncontested win as hand_settled too (it never passes through showdown)", () => {
    const db = openDb(); table(db);
    readyAll(db);
    playHand(db, "folds"); // seats 0, 1, 2 fold, seat 3 (big blind) wins the blinds
    const settled = getEvents(db, T).map(e => e.body as { kind?: string; awards?: unknown }).filter(b => b.kind === "hand_settled");
    expect(settled).toHaveLength(1);
    expect(settled[0].awards).toEqual([{ seat: 3, amount: 15 }]);
  });

  it("never writes cards or the deck into a server log entry", () => {
    const db = openDb(); table(db);
    readyAll(db);
    playHand(db, "checkdown");
    const json = JSON.stringify(getEvents(db, T).filter(e => e.kind === "server"));
    expect(json).not.toContain("holeCards");
    expect(json).not.toContain("deck");
    expect(json).not.toContain("board");
  });

  it("recoverAll finishes a hand change the server crashed before doing", () => {
    const file = join(mkdtempSync(join(tmpdir(), "poker-")), "t.db");
    let db = openDb(file); table(db, 2);
    readyAll(db);
    playHand(db, "checkdown");
    signAll(db, false); // 4 sigs saved, but the process "died" before the lifecycle ran
    expect(state(db).tableState).toBe("settlement");
    expect(state(db).checkpointNumber).toBe(1);
    db.close();

    db = openDb(file); // restart
    expect(recoverAll(db, L)).toEqual([T]);
    const s = state(db);
    expect(s.tableState).toBe("betting");
    expect(s.handNumber).toBe(2);
    expect(getTimer(db, T)).not.toBeNull();
    expect(recoverAll(db, L)).toEqual([]); // second run: nothing left to do
    db.close();
  });
});

describe("randomDeck", () => {
  it("is a permutation of 0..51", () => {
    const d = randomDeck();
    expect([...d].sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });
  it("uses the injected randomness (no swaps when it always picks the last slot)", () => {
    expect(randomDeck(n => n - 1)).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });
});

describe("protocol fixes", () => {
  it("rejects carry nextSeq on DUPLICATE and BAD_SEQ", () => {
    const db = openDb(); table(db);
    send(db, 0, "ready", { ready: true }, 0); // seq 1 accepted
    const dup = ingest(db, deps, mk(db, 0, "ready", { ready: true }, 0, 1)) as any;
    expect(dup.reject.code).toBe("DUPLICATE");
    expect(dup.reject.nextSeq).toBe(2);
    const gap = ingest(db, deps, mk(db, 0, "ready", { ready: true }, 0, 5)) as any;
    expect(gap.reject.code).toBe("BAD_SEQ");
    expect(gap.reject.nextSeq).toBe(2);
  });

  it("reconnect view has lastIndex = index of the newest log entry", () => {
    const db = openDb(); table(db);
    const r = reconnect(db, deps, mk(db, 0, "join", { sessionKey: key(0) }, 0));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.lastIndex).toBe(getEvents(db, T).length - 1);
    expect(r.view.lastIndex).toBe(0);
  });
});
