import { describe, it, expect } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Seat } from "@poker/shared";
import { openDb, type Db } from "./db";
import { addPlayer, createGame } from "./store";
import { createApp, listOpenTables } from "./lobby";

const wallet = (i: number) => "0x" + i.toString(16).padStart(40, "0");
const key = (i: number) => "0x" + (i + 0xa00).toString(16).padStart(40, "0");

function table(db: Db, id: string, seats: number, createdAt: number, buyIn = 1_000_000_000_000_000n) {
  createGame(db, { tableId: id, creator: wallet(1), buyInWei: buyIn, totalHands: 10 }, createdAt);
  for (let s = 0; s < seats; s++) {
    addPlayer(db, { tableId: id, seat: s as Seat, wallet: wallet(Number(id) * 10 + s), sessionKey: key(Number(id) * 10 + s) });
  }
}

describe("listOpenTables", () => {
  it("lists only lobby tables, newest first, with their seated wallets", () => {
    const db = openDb();
    table(db, "1", 1, 1000);
    table(db, "2", 3, 2000);
    table(db, "3", 4, 3000); // full: waiting_deposits, no longer joinable
    const list = listOpenTables(db);
    expect(list.map(t => t.tableId)).toEqual(["2", "1"]);
    expect(list[0].seatsTaken).toBe(3);
    expect(list[0].seats.map(s => s.seat)).toEqual([0, 1, 2]);
    expect(list[1].seats[0].wallet).toBe(wallet(10));
    expect(list[0]).toMatchObject({ buyInWei: "1000000000000000", totalHands: 10, createdAt: 2000 });
  });

  it("returns nothing when there are no open tables, and exposes no session keys", () => {
    const db = openDb();
    expect(listOpenTables(db)).toEqual([]);
    table(db, "1", 2, 1);
    expect(JSON.stringify(listOpenTables(db))).not.toContain(key(10));
  });

  it("respects the limit", () => {
    const db = openDb();
    for (let i = 1; i <= 5; i++) table(db, String(i), 1, i);
    expect(listOpenTables(db, 3).map(t => t.tableId)).toEqual(["5", "4", "3"]);
  });
});

function get(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path, headers }, res => {
      let body = "";
      res.on("data", c => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    }).on("error", reject);
  });
}

describe("GET /api/tables", () => {
  async function withServer(db: Db, fn: (port: number) => Promise<void>) {
    const server = http.createServer(createApp(db, { allowedOrigins: ["http://localhost:3000"] }));
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    try { await fn((server.address() as AddressInfo).port); }
    finally { await new Promise(r => server.close(r)); }
  }

  it("returns the open tables as JSON and allows the Next.js origin", async () => {
    const db = openDb(); table(db, "7", 2, 1);
    await withServer(db, async port => {
      const r = await get(port, "/api/tables", { Origin: "http://localhost:3000" });
      expect(r.status).toBe(200);
      expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
      expect(r.headers["cache-control"]).toBe("no-store");
      const body = JSON.parse(r.body);
      expect(body.tables).toHaveLength(1);
      expect(body.tables[0]).toMatchObject({ tableId: "7", seatsTaken: 2, buyInWei: "1000000000000000" });
    });
  });

  it("sends no CORS header to other origins", async () => {
    const db = openDb();
    await withServer(db, async port => {
      const r = await get(port, "/api/tables", { Origin: "http://evil.example" });
      expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  it("answers 404 for unknown paths", async () => {
    const db = openDb();
    await withServer(db, async port => {
      expect((await get(port, "/api/nope")).status).toBe(404);
    });
  });
});