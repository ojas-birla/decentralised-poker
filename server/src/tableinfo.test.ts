import { describe, it, expect } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Seat } from "@poker/shared";
import { openDb, type Db } from "./db";
import { addCheckpointSig, addPlayer, createGame, insertCheckpoint, markCheckpointComplete, setConnected, setDeposited } from "./store";
import { createApp, getLatestCheckpoint, getTableInfo } from "./lobby";

const T = "7";
const wallet = (i: number) => "0x" + String(i + 1).repeat(40);
const key = (i: number) => "0x" + String(i + 5).repeat(40);
const HASH = "0x" + "ab".repeat(32);
const SIG = (n: number) => "0x" + String(n).repeat(130);
const BALANCES: [string, string, string, string] = ["1000", "2000", "500", "500"];
const EVICTED: [boolean, boolean, boolean, boolean] = [false, false, false, false];

function table(db: Db, seats = 4) {
  createGame(db, { tableId: T, creator: wallet(0), buyInWei: 1_000_000_000_000_000n, totalHands: 5 });
  for (let i = 0; i < seats; i++) addPlayer(db, { tableId: T, seat: i as Seat, wallet: wallet(i), sessionKey: key(i) });
}
const cp = (n: number) => ({ tableId: T, checkpointNumber: n, balances: BALANCES, evicted: EVICTED });

describe("getTableInfo", () => {
  it("returns public facts only: state, buy-in, hands, seats with deposited/connected", () => {
    const db = openDb(); table(db, 3);
    setDeposited(db, T, 0); setConnected(db, T, 1, true);
    const info = getTableInfo(db, T)!;
    expect(info.tableId).toBe(T);
    expect(info.state).toBe("lobby");
    expect(info.buyInWei).toBe("1000000000000000");
    expect(info.totalHands).toBe(5);
    expect(info.handNumber).toBe(0);
    expect(info.seats).toEqual([
      { seat: 0, wallet: wallet(0), deposited: true, connected: false },
      { seat: 1, wallet: wallet(1), deposited: false, connected: true },
      { seat: 2, wallet: wallet(2), deposited: false, connected: false },
    ]);
  });

  it("never exposes session keys, the deck or any cards", () => {
    const db = openDb(); table(db);
    const json = JSON.stringify(getTableInfo(db, T));
    expect(json).not.toContain(key(0));
    expect(json).not.toContain("sessionKey");
    expect(json).not.toContain("deck");
    expect(json).not.toContain("holeCards");
  });

  it("is null for unknown or malformed ids", () => {
    const db = openDb(); table(db);
    expect(getTableInfo(db, "999")).toBeNull();
    expect(getTableInfo(db, "abc")).toBeNull();
    expect(getTableInfo(db, "7 OR 1=1")).toBeNull();
  });
});

describe("getLatestCheckpoint", () => {
  it("is null until a checkpoint is COMPLETE", () => {
    const db = openDb(); table(db);
    expect(getLatestCheckpoint(db, T)).toBeNull();
    insertCheckpoint(db, T, cp(1), 1, HASH);
    addCheckpointSig(db, T, 1, 0, SIG(1));
    expect(getLatestCheckpoint(db, T)).toBeNull(); // proposed and partly signed, not complete
  });

  it("returns the newest complete checkpoint with one signature slot per seat", () => {
    const db = openDb(); table(db);
    insertCheckpoint(db, T, cp(1), 1, HASH);
    for (let i = 0; i < 4; i++) addCheckpointSig(db, T, 1, i, SIG(i));
    markCheckpointComplete(db, T, 1);
    insertCheckpoint(db, T, cp(2), 2, HASH); // newer but incomplete: must be ignored
    addCheckpointSig(db, T, 2, 0, SIG(9));

    const r = getLatestCheckpoint(db, T)!;
    expect(r.checkpoint).toEqual({ tableId: T, checkpointNumber: 1, balances: BALANCES, evicted: EVICTED });
    expect(r.hash).toBe(HASH);
    expect(r.sigs).toEqual([SIG(0), SIG(1), SIG(2), SIG(3)]);
  });

  it("puts null for an evicted seat that did not sign", () => {
    const db = openDb(); table(db);
    insertCheckpoint(db, T, { ...cp(1), evicted: [false, false, false, true] }, 1, HASH);
    for (let i = 0; i < 3; i++) addCheckpointSig(db, T, 1, i, SIG(i));
    markCheckpointComplete(db, T, 1);
    expect(getLatestCheckpoint(db, T)!.sigs).toEqual([SIG(0), SIG(1), SIG(2), null]);
  });

  it("is null for unknown or malformed ids", () => {
    const db = openDb(); table(db);
    expect(getLatestCheckpoint(db, "999")).toBeNull();
    expect(getLatestCheckpoint(db, "x")).toBeNull();
  });
});

function get(port: number, path: string) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path }, res => {
      let body = "";
      res.on("data", c => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    }).on("error", reject);
  });
}

describe("REST /api/tables/:id", () => {
  async function withServer(db: Db, fn: (port: number) => Promise<void>) {
    const server = http.createServer(createApp(db, { allowedOrigins: ["http://localhost:3000"] }));
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    try { await fn((server.address() as AddressInfo).port); }
    finally { await new Promise(r => server.close(r)); }
  }

  it("GET /api/tables/:id returns the table, uncached", async () => {
    const db = openDb(); table(db);
    await withServer(db, async port => {
      const r = await get(port, `/api/tables/${T}`);
      expect(r.status).toBe(200);
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(JSON.parse(r.body)).toMatchObject({ tableId: T, state: "waiting_deposits", totalHands: 5 });
    });
  });

  it("GET /api/tables/:id answers 404 for an unknown table", async () => {
    const db = openDb();
    await withServer(db, async port => {
      expect((await get(port, "/api/tables/404")).status).toBe(404);
      expect((await get(port, "/api/tables/abc")).status).toBe(404);
    });
  });

  it("GET /api/tables/:id/checkpoint answers 404 until complete, then 200", async () => {
    const db = openDb(); table(db);
    await withServer(db, async port => {
      expect((await get(port, `/api/tables/${T}/checkpoint`)).status).toBe(404);
      insertCheckpoint(db, T, cp(1), 1, HASH);
      for (let i = 0; i < 4; i++) addCheckpointSig(db, T, 1, i, SIG(i));
      markCheckpointComplete(db, T, 1);
      const r = await get(port, `/api/tables/${T}/checkpoint`);
      expect(r.status).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.hash).toBe(HASH);
      expect(body.sigs).toHaveLength(4);
    });
  });
});
