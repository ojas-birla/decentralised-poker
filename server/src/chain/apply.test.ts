import { describe, expect, it } from "vitest";
import type { Seat } from "@poker/shared";
import { openDb } from "../db";
import { getPlayers, loadGame } from "../store";
import { applyChainEvent, getCursor, initChainTables, processBatch } from "./apply";
import type { ChainEvent } from "./events";

function fresh() {
  const db = openDb(":memory:");
  initChainTables(db);
  return db;
}

let n = 0;
const base = (block = 100) => ({
  txHash: "0x" + (++n).toString(16).padStart(64, "0"),
  logIndex: 0,
  blockNumber: block,
});
const WALLET = (i: number) => "0x" + ["Ab", "Cd", "Ef", "Fa"][i].repeat(20); // mixed case on purpose

const created = (tableId = "1"): ChainEvent => ({
  ...base(), type: "TableCreated", tableId, creator: WALLET(0), buyInWei: 1_000_000_000_000_000n, handCount: 10,
});
const joined = (tableId: string, seat: Seat): ChainEvent => ({
  ...base(), type: "PlayerJoined", tableId, seat, wallet: WALLET(seat), sessionKey: "0x" + String(seat + 1).repeat(40),
});

describe("chain events -> server state", () => {
  it("four joins fill the table and move it to waiting_deposits", () => {
    const db = fresh();
    applyChainEvent(db, created());
    for (const s of [0, 1, 2, 3] as Seat[]) applyChainEvent(db, joined("1", s));

    expect(loadGame(db, "1")!.state.tableState).toBe("waiting_deposits");
    const players = getPlayers(db, "1");
    expect(players).toHaveLength(4);
    expect(players.every((p) => p.deposited)).toBe(true);
    expect(players[1].wallet).toBe(WALLET(1).toLowerCase());
  });

  it("a repeated event is ignored", () => {
    const db = fresh();
    applyChainEvent(db, created());
    const j = joined("1", 0);
    expect(applyChainEvent(db, j).status).toBe("applied");
    expect(applyChainEvent(db, j).status).toBe("duplicate");
    expect(getPlayers(db, "1")).toHaveLength(1);
  });

  it("an event for an unknown table is recorded as an error and not retried", () => {
    const db = fresh();
    const j = joined("99", 0);
    expect(applyChainEvent(db, j).status).toBe("error");
    expect(applyChainEvent(db, j).status).toBe("duplicate");
  });

  it("a cancelled table becomes aborted", () => {
    const db = fresh();
    applyChainEvent(db, created());
    applyChainEvent(db, joined("1", 0));
    applyChainEvent(db, { ...base(), type: "TableCancelled", tableId: "1" });
    expect(loadGame(db, "1")!.state.tableState).toBe("aborted");
  });

  it("the cursor starts before the deploy block and never moves backwards", () => {
    const db = fresh();
    expect(getCursor(db, 100)).toBe(99);
    processBatch(db, [created()], 150);
    expect(getCursor(db, 100)).toBe(150);
    processBatch(db, [], 120);
    expect(getCursor(db, 100)).toBe(150);
  });

  it("out-of-order input is sorted, so a join listed before its table still applies", () => {
    const db = fresh();
    const c = { ...created(), blockNumber: 100, logIndex: 0 };
    const j = { ...joined("1", 0), blockNumber: 100, logIndex: 1 };
    const results = processBatch(db, [j, c], 100);
    expect(results.map((r) => r.ev.type)).toEqual(["TableCreated", "PlayerJoined"]);
    expect(results.every((r) => r.result.status === "applied")).toBe(true);
  });

  it("a duplicate seat is an error and leaves the first player untouched", () => {
    const db = fresh();
    applyChainEvent(db, created());
    applyChainEvent(db, joined("1", 0));
    const again = { ...joined("1", 0), wallet: WALLET(1) };
    expect(applyChainEvent(db, again).status).toBe("error");
    expect(getPlayers(db, "1")).toHaveLength(1);
    expect(getPlayers(db, "1")[0].wallet).toBe(WALLET(0).toLowerCase());
  });
});
