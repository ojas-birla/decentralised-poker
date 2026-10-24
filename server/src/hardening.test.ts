// C8 hardening pass (SPEC-2.1 §7): bad input is rejected AND logged, garbage never crashes the server,
// a seat that never acts is folded by the clock, and a restarted server picks the game up where it was.
import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { legalActions, totalChips } from "@poker/shared";
import type { ClientToServerEvents, HelloAck, MessageType, Seat, ServerToClientEvents } from "@poker/shared";
import { openDb, type Db } from "./db";
import { addPlayer, createGame, getEvents, getPlayer, latestCompleteCheckpoint, loadGame, setDeposited } from "./store";
import { ingest, type IngestDeps } from "./ingest";
import { afterChange, recoverAll, RESTART_GRACE_MS } from "./lifecycle";
import { fireDueTimers, getTimer, TURN_MS } from "./timers";
import { attachSockets, FLOOD_MAX_MESSAGES } from "./socket";
import { startGameServer } from "./gameServer";
import { seedTable, startBots } from "../scripts/botsLib";

const T = "1";
const wallet = (i: number) => "0x" + String(i + 1).repeat(40);
const key = (i: number) => "0x" + String(i + 5).repeat(40);
const HASH = "0x" + "ab".repeat(32);
const SIG = "0x" + "cd".repeat(65);
const deps: IngestDeps = { verifySig: e => e.sig === "0xok", verifyCheckpointSig: () => true }; // stub crypto
const L = { randomDeck: () => Array.from({ length: 52 }, (_, i) => i) };

function table(db: Db, totalHands = 2) {
  createGame(db, { tableId: T, creator: wallet(0), buyInWei: 1_000_000_000_000_000n, totalHands });
  for (let i = 0; i < 4; i++) {
    addPlayer(db, { tableId: T, seat: i as Seat, wallet: wallet(i), sessionKey: key(i) });
    setDeposited(db, T, i);
  }
}
const state = (db: Db) => loadGame(db, T)!.state;
const mk = (db: Db, seat: number, type: MessageType, payload: unknown, handNumber: number, seq?: number) => ({
  tableId: T, handNumber, seq: seq ?? getPlayer(db, T, seat)!.lastSeq + 1, sender: wallet(seat), seat, type, payload, sig: "0xok",
});
const readyAll = (db: Db) => {
  for (let i = 0; i < 4; i++) {
    const r = ingest(db, deps, mk(db, i, "ready", { ready: true }, 0));
    if (!r.ok) throw new Error(`ready rejected: ${r.reject.code}`);
    afterChange(db, T, L);
  }
};
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for condition");
    await sleep(10);
  }
}

// ---------------------------------------------------------------------------------------------- rejects table

const rejectRows = (db: Db) => db.prepare("SELECT code FROM rejects ORDER BY id").all() as { code: string }[];
const snapshot = (db: Db) => JSON.stringify({
  state: loadGame(db, T)!.state,
  events: getEvents(db, T).length,
  seqs: [0, 1, 2, 3].map(i => getPlayer(db, T, i)!.lastSeq),
  checkpoints: db.prepare("SELECT COUNT(*) AS n FROM checkpoints").get(),
});

/** The envelope is refused with `code`, exactly one row lands in `rejects`, and NOTHING else in the database moves. */
function expectRejected(db: Db, raw: unknown, code: string) {
  const before = snapshot(db);
  const n = rejectRows(db).length;
  const r = ingest(db, deps, raw);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reject.code).toBe(code);
  expect(snapshot(db)).toBe(before);
  const rows = rejectRows(db);
  expect(rows).toHaveLength(n + 1);
  expect(rows[rows.length - 1].code).toBe(code);
}

describe("rejects", () => {
  it("every kind of bad envelope is refused, logged in `rejects`, and changes nothing", () => {
    const db = openDb(); table(db); readyAll(db);
    const a = state(db).toActSeat as Seat;       // the seat to act
    const b = ((a + 1) % 4) as Seat;             // not its turn
    const fold = { action: "fold" };

    expectRejected(db, mk(db, b, "bet_action", fold, 1), "NOT_YOUR_TURN");
    expectRejected(db, mk(db, a, "bet_action", fold, 1, 99), "BAD_SEQ");
    expectRejected(db, { ...mk(db, a, "bet_action", fold, 1), sig: "0xbad" }, "BAD_SIG");
    expectRejected(db, { ...mk(db, a, "bet_action", fold, 1), sender: wallet(b) }, "BAD_SEAT");
    expectRejected(db, mk(db, a, "bet_action", fold, 7), "WRONG_HAND");
    expectRejected(db, mk(db, a, "bet_action", { action: "teleport" }, 1), "BAD_PAYLOAD");
    expectRejected(db, mk(db, a, "bet_action", { action: "raise", amount: 11 }, 1), "ILLEGAL_ACTION"); // min raise is to 20
    expectRejected(db, mk(db, a, "ready", { ready: true }, 0), "WRONG_STATE");                          // not allowed while betting
    expectRejected(db, mk(db, a, "unlock_card", { cardIndex: 0, forSeat: "board", value: "ab".repeat(32) }, 1), "WRONG_STATE"); // Phase 3 only
    expectRejected(db, mk(db, a, "abandon_vote", { accusedSeat: b, reason: "TIMEOUT" }, 1), "WRONG_STATE");
    expectRejected(db, { ...mk(db, a, "bet_action", fold, 1), tableId: "77" }, "WRONG_STATE");           // unknown table
    expectRejected(db, { tableId: T }, "BAD_PAYLOAD");                                                  // not even an envelope

    // A replayed copy of an ACCEPTED envelope is a DUPLICATE and carries the seq to use next.
    const legit = mk(db, a, "bet_action", fold, 1);
    expect(ingest(db, deps, legit).ok).toBe(true);
    afterChange(db, T, L);
    const before = rejectRows(db).length;
    const dup = ingest(db, deps, legit);
    expect(dup.ok).toBe(false);
    if (!dup.ok) { expect(dup.reject.code).toBe("DUPLICATE"); expect(dup.reject.nextSeq).toBe(3); }
    expect(rejectRows(db)).toHaveLength(before + 1);

    expect(totalChips(state(db))).toBe(4000);
  });
});

// ---------------------------------------------------------------------------------------------- a seat that never acts

describe("a seat that never acts", () => {
  it("is auto-folded or auto-checked in every hand and the table still reaches `finished`", () => {
    const STALL: Seat = 2;
    let clock = 1_000_000;
    const d: IngestDeps = { ...deps, now: () => clock };
    const LC = { ...L, now: () => clock };
    const db = openDb(); table(db, 4);
    const sendC = (seat: number, type: MessageType, payload: unknown, hand: number) => {
      const r = ingest(db, d, mk(db, seat, type, payload, hand));
      if (!r.ok) throw new Error(`${type} from seat ${seat} rejected: ${r.reject.code} ${r.reject.message}`);
      afterChange(db, T, LC);
    };
    for (let i = 0; i < 4; i++) sendC(i, "ready", { ready: true }, 0);

    for (let hand = 1; hand <= 4; hand++) {
      for (let guard = 0; guard < 100 && state(db).tableState === "betting"; guard++) {
        const s = state(db);
        const seat = s.toActSeat as Seat;
        if (seat === STALL) {               // the player does nothing: let the 30 s clock run out
          clock += TURN_MS + 1;
          for (const r of fireDueTimers(db, clock)) {
            expect(r.seat).toBe(STALL);
            afterChange(db, T, LC);         // what the socket layer does after every auto action
          }
          continue;
        }
        sendC(seat, "bet_action", { action: legalActions(s, seat)!.canCheck ? "check" : "call" }, hand);
      }
      expect(state(db).tableState).toBe("settlement");
      expect(totalChips(state(db))).toBe(4000);
      const n = state(db).checkpointNumber + 1;
      for (let seat = 0; seat < 4; seat++) { // the staller still signs: it is only the betting it ignores
        sendC(seat, "checkpoint_sig", { checkpointNumber: n, checkpointHash: HASH, signature: SIG }, hand);
      }
    }

    const s = state(db);
    expect(s.tableState).toBe("finished");
    expect(s.checkpointNumber).toBe(4);
    expect(totalChips(s)).toBe(4000);
    const autos = getEvents(db, T)
      .filter(e => e.kind === "server" && (e.body as { kind: string }).kind === "auto")
      .map(e => e.body as { seat: number; action: string });
    expect(autos.length).toBeGreaterThanOrEqual(4);          // at least once per hand
    expect(autos.every(a => a.seat === STALL)).toBe(true);   // and never anybody else
  });
});

describe("restart grace", () => {
  it("recoverAll gives an overdue turn clock a grace period, and leaves a distant one alone", () => {
    const db = openDb(); table(db); readyAll(db);
    db.prepare("UPDATE timers SET deadline = ?").run(1000); // the server was down for ages: this clock ran out long ago
    recoverAll(db, { ...L, now: () => 5_000_000 });
    expect(getTimer(db, T)!.deadline).toBe(5_000_000 + RESTART_GRACE_MS);
    expect(fireDueTimers(db, 5_000_000)).toEqual([]);       // nobody is folded before they could reconnect

    db.prepare("UPDATE timers SET deadline = ?").run(9_000_000);
    recoverAll(db, { ...L, now: () => 5_000_000 });
    expect(getTimer(db, T)!.deadline).toBe(9_000_000);
  });
});

// ---------------------------------------------------------------------------------------------- garbage over a socket

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;
const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

async function startServer() {
  const db = openDb(); table(db, 3);
  const server = http.createServer();
  const layer = attachSockets(server, db, deps, ["http://localhost:3000"]);
  await new Promise<void>(res => server.listen(0, res));
  cleanups.push(() => { void layer.close(); db.close(); });
  return { db, url: `http://localhost:${(server.address() as AddressInfo).port}` };
}
async function client(url: string): Promise<Client> {
  const sock: Client = connect(url, { transports: ["websocket"], forceNew: true, reconnection: false });
  cleanups.push(() => { sock.disconnect(); });
  await new Promise<void>((res, rej) => { sock.on("connect", () => res()); sock.on("connect_error", rej); });
  return sock;
}
const joinEnv = (seat: number, seq = 1) =>
  ({ tableId: T, handNumber: 0, seq, sender: wallet(seat), seat, type: "join", payload: { sessionKey: key(seat) }, sig: "0xok" });
const helloOk = (sock: Client, seat = 0) =>
  new Promise<HelloAck>(res => sock.emit("hello", { joinEnvelope: joinEnv(seat) as never, fromIndex: 0 }, res));

describe("garbage over the wire", () => {
  it("never crashes the server; a normal client still gets in afterwards", async () => {
    const { db, url } = await startServer();
    const sock = await client(url);
    const v = joinEnv(0);
    const junk: unknown[] = [
      undefined, null, 0, -1, 1e308, "", "x".repeat(100_000), true, [], [1, 2, 3], {},
      { tableId: T }, { tableId: T, seat: 0 }, { tableId: 7 },
      { ...v, sig: 5 }, { ...v, payload: null }, { ...v, payload: [] }, { ...v, payload: { sessionKey: 5 } },
      { ...v, payload: { sessionKey: key(1) } }, { ...v, seat: "0" }, { ...v, seq: 1.5 }, { ...v, seq: -3 },
      { ...v, type: "__proto__" }, { ...v, tableId: "nope" }, { ...v, sig: "0xbad" },
      JSON.parse('{"__proto__": {"polluted": 1}, "tableId": "1"}'),
    ];
    const raw = sock as unknown as { emit(ev: string, ...a: unknown[]): void };
    for (const j of junk) {
      raw.emit("envelope", j, () => {});
      raw.emit("envelope", j);                                             // no ack callback at all
      raw.emit("hello", j, () => {});
      raw.emit("hello", { joinEnvelope: j, fromIndex: "zz" }, () => {});
    }
    raw.emit("hello"); raw.emit("envelope"); raw.emit("no-such-event", { a: 1 });
    // Messages are handled in order, so once this last one is answered, all the junk before it has been processed.
    await new Promise<void>(res =>
    raw.emit("hello", { joinEnvelope: { ...v, sig: "0xbad" }, fromIndex: 0 }, () => res()));
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM rejects").get() as { n: number };
    expect(n, "junk that reaches ingest should be logged in rejects").toBeGreaterThan(0);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const other = await client(url);
    const ack = await helloOk(other, 0);                                   // the server is still alive and correct
    expect(ack.ok).toBe(true);
  });

  it("survives a message bigger than the size limit", async () => {
    const { url } = await startServer();
    const big = await client(url);
    (big as unknown as { emit(ev: string, ...a: unknown[]): void }).emit("envelope", { x: "y".repeat(300_000) }, () => {});
    await waitFor(() => !big.connected, 5000);                             // the server hangs up on that client only
    expect((await helloOk(await client(url), 1)).ok).toBe(true);
  });

  it("flood guard: a client that spams is disconnected, others are unaffected", async () => {
    const { url } = await startServer();
    const spammer = await client(url);
    const raw = spammer as unknown as { emit(ev: string, ...a: unknown[]): void };
    for (let i = 0; i < FLOOD_MAX_MESSAGES + 50; i++) raw.emit("envelope", {}, () => {});
    await waitFor(() => !spammer.connected, 5000);
    expect((await helloOk(await client(url), 2)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------- restart mid-hand

describe("server restart", () => {
  it("mid-hand: the bots reconnect, resync their seq and the game finishes with 4 signatures", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "poker-restart-")), "game.db");
    const seedDb = openDb(file);
    const seeded = seedTable(seedDb, { tableId: "42", totalHands: 3 });
    seedDb.close();

    const origins = ["http://localhost:3000"];
    let gs = await startGameServer({ dbPath: file, port: 0, origins, skipChain: true });
    const port = gs.port;
    const run = startBots({
      url: `http://localhost:${port}`, tableId: seeded.tableId, buyInWei: seeded.buyInWei,
      identities: seeded.identities, think: [20, 60], timeoutMs: 90_000,
    });
    try {
      // Kill the server in the middle of the first hand. (A game can end early when one player wins every chip,
      // so hand 2 is not guaranteed to happen.)
      await waitFor(() => {
        const s = run.bots[0].latest();
        return !!s && s.handNumber >= 1 && s.tableState === "betting";
      }, 30_000);
      await gs.close();
      await sleep(300);
      gs = await startGameServer({ dbPath: file, port, origins, skipChain: true });

      const report = await run.finished;
      expect(report.failures).toEqual([]);
      expect(report.finished).toBe(true);
      expect(report.ok).toBe(true);
    } finally {
      run.stop();
      await gs.close();
    }

    const db = openDb(file);
    const g = loadGame(db, "42")!;
    expect(g.state.tableState).toBe("finished");
    // Normally 3 hands; fewer if one player won every chip earlier. One checkpoint per hand played.
    expect(g.state.handNumber).toBeGreaterThanOrEqual(1);
    expect(g.state.handNumber).toBeLessThanOrEqual(3);
    expect(g.state.checkpointNumber).toBe(g.state.handNumber);
    expect(totalChips(g.state)).toBe(4000);
    expect(Object.keys(latestCompleteCheckpoint(db, "42")!.sigs)).toHaveLength(4);
    db.close();
  }, 120_000);
});
