// server/src/chain.test.ts
// SPEC-2.1 §7 C3, last bullet: replay is idempotent, out-of-order logs get sorted.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Interface } from "ethers";
import { POKER_ABI } from "@poker/shared";
import { openDb, type Db } from "./db";
import { getMeta, getPlayers, loadGame, setMeta } from "./store";
import { CURSOR_KEY, sortLogs, startChainWatcher, type ChainWatcher } from "./chain";

// chain.ts imports RPC_URL from ./env; keep the tests independent of any .env file.
vi.mock("./env", () => ({ RPC_URL: "http://127.0.0.1:0" }));

const iface = new Interface(POKER_ABI);
const ADDR = "0x" + "cc".repeat(20); // fake contract address
const W = ["a1", "a2", "a3", "a4"].map(x => "0x" + x.repeat(20)); // wallets (lowercase)
const S = ["b1", "b2", "b3", "b4"].map(x => "0x" + x.repeat(20)); // session keys
const BUYIN = 1000n * 10n ** 12n;

function mk(blockNumber: number, index: number, name: string, args: unknown[]) {
  const { topics, data } = iface.encodeEventLog(iface.getEvent(name)!, args);
  return { blockNumber, index, address: ADDR, topics, data };
}
const created = (b: number, i: number, id = 1n) => mk(b, i, "TableCreated", [id, W[0], BUYIN, 4n]);
const joined = (b: number, i: number, seat: number, id = 1n) =>
  mk(b, i, "PlayerJoined", [id, seat, W[seat], S[seat]]);

/** What createTable + 3 joinTable calls emit, in chain order. */
function fixture() {
  return [created(5, 0), joined(5, 1, 0), joined(6, 0, 1), joined(7, 0, 2), joined(8, 0, 3)];
}

const active: ChainWatcher[] = [];
afterEach(() => {
  while (active.length) active.pop()!.stop();
  vi.restoreAllMocks();
});

async function start(
  db: Db,
  logs: any[],
  head: number,
  onTableChanged = vi.fn(),
  chunkBlocks = 2 // tiny chunks so backfill really loops
) {
  const provider: any = {
    getBlockNumber: async () => head,
    getLogs: async (f: any) => logs.filter(l => l.blockNumber >= f.fromBlock && l.blockNumber <= f.toBlock),
  };
  const contract: any = { interface: iface, getAddress: async () => ADDR };
  const w = startChainWatcher(db, { onTableChanged }, {
    provider, contract, deployBlock: 1, chunkBlocks, pollMs: 1_000_000_000,
  });
  active.push(w);
  await w.ready;
  return w;
}

function dump(db: Db) {
  return {
    games: db.prepare(
      "SELECT table_id, creator, buy_in_wei, wei_per_chip, total_hands, table_state, state_json FROM games ORDER BY table_id"
    ).all(),
    players: db.prepare("SELECT * FROM players ORDER BY table_id, seat").all(),
    meta: db.prepare("SELECT * FROM meta ORDER BY key").all(),
  };
}

describe("sortLogs", () => {
  it("orders by (blockNumber, index) and does not mutate the input", () => {
    const input = [
      { blockNumber: 7, index: 0 }, { blockNumber: 5, index: 1 },
      { blockNumber: 5, index: 0 }, { blockNumber: 6, index: 3 },
    ];
    const copy = [...input];
    expect(sortLogs(input)).toEqual([
      { blockNumber: 5, index: 0 }, { blockNumber: 5, index: 1 },
      { blockNumber: 6, index: 3 }, { blockNumber: 7, index: 0 },
    ]);
    expect(input).toEqual(copy);
  });
});

describe("chain watcher", () => {
  it("backfills TableCreated + 4 PlayerJoined into a waiting_deposits table", async () => {
    const db = openDb(":memory:");
    const hook = vi.fn();
    await start(db, fixture(), 8, hook);

    const game = loadGame(db, "1")!;
    expect(game.state.tableState).toBe("waiting_deposits");
    expect(game.meta.creator).toBe(W[0]);
    expect(game.meta.buyInWei).toBe(BUYIN.toString());
    expect(game.meta.weiPerChip).toBe((BUYIN / 1000n).toString());
    expect(game.meta.totalHands).toBe(4);

    const players = getPlayers(db, "1");
    expect(players.map(p => p.wallet)).toEqual(W);
    expect(players.map(p => p.sessionKey)).toEqual(S);
    expect(players.every(p => p.deposited)).toBe(true);

    expect(getMeta(db, CURSOR_KEY)).toBe("8");
    expect(hook).toHaveBeenCalled();
    expect(hook.mock.calls.every(c => c[0] === "1")).toBe(true);
  });

  it("replaying the same logs twice gives the same rows (idempotent)", async () => {
    const db = openDb(":memory:");
    const hook = vi.fn();
    const w = await start(db, fixture(), 8, hook);
    const first = dump(db);
    const callsAfterFirst = hook.mock.calls.length;

    setMeta(db, CURSOR_KEY, "-1"); // pretend we never ran: re-read everything from the deploy block
    await w.syncOnce();

    expect(dump(db)).toEqual(first);
    expect(hook.mock.calls.length).toBe(callsAfterFirst); // nothing changed, so nobody is notified
  });

  it("sorts out-of-order logs before applying them", async () => {
    const reference = openDb(":memory:");
    await start(reference, fixture(), 8);

    const db = openDb(":memory:");
    // Everything in ONE chunk, fully reversed: the joins arrive before TableCreated.
    await start(db, [...fixture()].reverse(), 8, vi.fn(), 100);

    expect(loadGame(db, "1")!.state.tableState).toBe("waiting_deposits");
    expect(dump(db)).toEqual(dump(reference));
  });

  it("restarting mid-backfill gives the same database as an uninterrupted run", async () => {
    const reference = openDb(":memory:");
    await start(reference, fixture(), 8);

    const db = openDb(":memory:");
    const w1 = await start(db, fixture(), 6); // chain head is only 6: seats 0 and 1 so far
    expect(getPlayers(db, "1")).toHaveLength(2);
    expect(loadGame(db, "1")!.state.tableState).toBe("lobby");
    w1.stop();

    await start(db, fixture(), 8); // "restart": new watcher, same database, resumes from the cursor
    expect(dump(db)).toEqual(dump(reference));
  });

  it("skips bad logs without wedging the cursor", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clean = openDb(":memory:");
    await start(clean, fixture(), 8);

    const db = openDb(":memory:");
    const logs = [
      ...fixture(),
      mk(9, 0, "PlayerJoined", [99n, 0, W[0], S[0]]),                  // unknown table
      mk(9, 1, "PlayerJoined", [1n, 1, W[3], S[3]]),                   // seat 1 already belongs to someone else
      { blockNumber: 9, index: 2, address: ADDR, topics: ["0x" + "11".repeat(32)], data: "0x" }, // not our event
    ];
    await start(db, logs, 9);

    expect(getMeta(db, CURSOR_KEY)).toBe("9");
    expect(loadGame(db, "99")).toBeNull();
    expect(getPlayers(db, "1").map(p => p.wallet)).toEqual(W);
    expect(dump(db).games).toEqual(dump(clean).games);
    expect(dump(db).players).toEqual(dump(clean).players);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});