import { describe, expect, it } from "vitest";
import type { Envelope } from "@poker/shared";
import { openDb } from "../db";
import { getPlayers, loadGame } from "../store";
import { pokerInterface } from "./events";
import { ChainWatcher, type LogSource } from "./watcher";
import { getCursor } from "./apply";
import { ingestWithChainSync } from "./ingestSync";
import type { IngestDeps } from "../ingest";

const W = (i: number) => "0x" + String(i + 1).repeat(40);
const SK = (i: number) => "0x" + String(i + 5).repeat(40);

function makeLog(name: string, args: unknown[], block: number, index: number, tx: number) {
  const frag = pokerInterface.getEvent(name)!;
  const { topics, data } = pokerInterface.encodeEventLog(frag, args);
  return { topics, data, transactionHash: "0x" + tx.toString(16).padStart(64, "0"), index, blockNumber: block };
}

/** A fake chain: `logs` is everything ever emitted, `head` is the newest block. */
function fakeChain() {
  const chain = { head: 100, logs: [] as ReturnType<typeof makeLog>[], getLogsCalls: 0 };
  const source: LogSource = {
    getBlockNumber: async () => chain.head,
    getLogs: async (f) => {
      chain.getLogsCalls++;
      return chain.logs.filter((l) => l.blockNumber >= f.fromBlock && l.blockNumber <= f.toBlock);
    },
  };
  return { chain, source };
}

const created = (block: number, tx = 1) => makeLog("TableCreated", [1n, W(0), 1_000_000_000_000_000n, 10n], block, 0, tx);
const joined = (seat: number, block: number, tx: number) => makeLog("PlayerJoined", [1n, seat, W(seat), SK(seat)], block, 0, tx);

describe("ChainWatcher", () => {
  it("replaying the same logs into a second database gives the same rows", async () => {
    const run = async () => {
      const { chain, source } = fakeChain();
      chain.logs = [joined(1, 12, 3), created(10), joined(0, 10, 2)]; // deliberately unsorted
      chain.logs[2].index = 1; // seat 0 joins after creation in the same block
      chain.head = 50;
      const db = openDb(":memory:");
      const w = new ChainWatcher({ db, source, startBlock: 1, maxRange: 7 });
      await w.pollOnce();
      await w.pollOnce(); // second pass: nothing new
      return getPlayers(db, "1").map((p) => [p.seat, p.wallet, p.sessionKey, p.deposited]);
    };
    const a = await run();
    expect(a).toHaveLength(2);
    expect(await run()).toEqual(a);
  });

  it("restarting with a new watcher on the same db repeats nothing", async () => {
    const { chain, source } = fakeChain();
    chain.logs = [created(10), joined(0, 10, 2)];
    chain.logs[1].index = 1;
    const db = openDb(":memory:");
    const seen: string[] = [];
    const mk = () => new ChainWatcher({ db, source, startBlock: 1, onApplied: (e) => seen.push(e.type) });
    expect(await mk().pollOnce()).toBe(2);
    expect(await mk().pollOnce()).toBe(0);
    expect(seen).toEqual(["TableCreated", "PlayerJoined"]);
  });

  it("syncNow reads blocks inside the confirmation window but the cursor stays behind", async () => {
    const { chain, source } = fakeChain();
    chain.head = 100;
    chain.logs = [created(99)]; // 1 block below head: inside the 2-block window
    const db = openDb(":memory:");
    const w = new ChainWatcher({ db, source, startBlock: 1, confirmations: 2 });
    expect(await w.pollOnce()).toBe(0);          // normal poll cannot see it yet
    expect(await w.syncNow()).toBe(1);           // syncNow can
    expect(getCursor(db, 1)).toBe(98);           // cursor limited to head - confirmations
    expect(loadGame(db, "1")).not.toBeNull();
    chain.head = 110;
    expect(await w.pollOnce()).toBe(0);          // re-read of block 99 is a duplicate, not a second apply
    expect(getCursor(db, 1)).toBe(108);
  });

  it("concurrent polls are serialised", async () => {
    const { chain, source } = fakeChain();
    chain.logs = [created(10)];
    const db = openDb(":memory:");
    const w = new ChainWatcher({ db, source, startBlock: 1 });
    const [a, b] = await Promise.all([w.pollOnce(), w.syncNow()]);
    expect(a + b).toBe(1);
  });
});

describe("RPC range limit", () => {
  it("shrinks the range when the RPC rejects a big one and still finds everything", async () => {
    const { chain, source } = fakeChain();
    chain.head = 1000;
    chain.logs = [created(10), joined(0, 900, 2)];
    const inner = source.getLogs;
    source.getLogs = async (f) => {
      if (f.toBlock - f.fromBlock + 1 > 50) throw new Error("eth_getLogs is limited to a 50 range");
      return inner(f);
    };
    const db = openDb(":memory:");
    const w = new ChainWatcher({ db, source, startBlock: 1, maxRange: 2000 });
    expect(await w.pollOnce()).toBe(2);
    expect(getPlayers(db, "1")).toHaveLength(1);
  });

  it("an unrelated error is still thrown", async () => {
    const { source } = fakeChain();
    source.getLogs = async () => { throw new Error("boom"); };
    const w = new ChainWatcher({ db: openDb(":memory:"), source, startBlock: 1, maxRange: 1 });
    await expect(w.pollOnce()).rejects.toThrow("boom");
  });
});

describe("ingestWithChainSync", () => {
  const deps: IngestDeps = { verifySig: () => true, verifyCheckpointSig: () => true };
  const join = (seat: number): Envelope => ({
    tableId: "1", handNumber: 0, seq: 1, sender: W(seat), seat: seat as 0, type: "join",
    payload: { sessionKey: SK(seat) }, sig: "0x00",
  } as Envelope);

  it("a join that beats the watcher succeeds after one catch-up", async () => {
    const { chain, source } = fakeChain();
    chain.head = 100;
    chain.logs = [created(99)];
    chain.logs.push({ ...joined(0, 99, 2), index: 1 });
    const db = openDb(":memory:");
    const w = new ChainWatcher({ db, source, startBlock: 1 });
    await w.pollOnce(); // sees nothing, block 99 is inside the window
    expect(loadGame(db, "1")).toBeNull();
    const res = await ingestWithChainSync(db, deps, join(0), w);
    expect(res.ok).toBe(true);
    expect(getPlayers(db, "1")[0].lastSeq).toBe(1);
  });

  it("a join for a seat that really is not on-chain is still rejected", async () => {
    const { chain, source } = fakeChain();
    chain.logs = [created(10)];
    const db = openDb(":memory:");
    const w = new ChainWatcher({ db, source, startBlock: 1 });
    await w.pollOnce();
    const res = await ingestWithChainSync(db, deps, join(2), w);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reject.code).toBe("BAD_SEAT");
  });

  it("if the RPC is down the original rejection is returned", async () => {
    const db = openDb(":memory:");
    const w = { syncNow: async () => { throw new Error("rpc down"); } };
    const res = await ingestWithChainSync(db, deps, join(0), w);
    expect(res.ok).toBe(false);
  });

  it("non-join messages are never retried", async () => {
    const db = openDb(":memory:");
    let calls = 0;
    const w = { syncNow: async () => { calls++; return 0; } };
    await ingestWithChainSync(db, deps, { ...join(0), type: "ready", payload: { ready: true } }, w);
    expect(calls).toBe(0);
  });
});
