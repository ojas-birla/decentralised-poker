// SPEC-2.4: the server watches the contract; a table only becomes `ready` after all 4 deposits are confirmed on-chain.
import { Wallet } from "ethers";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signEnvelope } from "@poker/shared";
import type { MessageType } from "@poker/shared";
import { openDb } from "../db";
import { getPlayers, loadGame } from "../store";
import { ingest } from "../ingest";
import { verifyEnvelope, verifyCheckpointSig } from "@poker/shared";
import { startGameServer, type GameServer } from "../gameServer";
import { pokerInterface } from "./events";
import type { LogSource } from "./watcher";
// This file tests the deposit gate, not dealing. It relies on the Phase 2 server-dealt deck, so the
// hand goes straight to "betting" (SPEC-PHASE3 D8). Real-shuffle behaviour is covered in lifecycle.test.ts.
beforeAll(() => {
  process.env.POKER_DEV_DECK = "1";
});
afterAll(() => {
  delete process.env.POKER_DEV_DECK;
});
const ORIGINS = ["http://localhost:3000"];
const WALLETS = [0, 1, 2, 3].map(i => "0x" + String(i + 1).repeat(40));
const KEYS = [0, 1, 2, 3].map(() => Wallet.createRandom());
const BUYIN = 1_000_000_000_000_000n;

function log(name: string, args: unknown[], block: number, index: number, tx: number) {
  const { topics, data } = pokerInterface.encodeEventLog(pokerInterface.getEvent(name)!, args);
  return { topics, data, transactionHash: "0x" + tx.toString(16).padStart(64, "0"), index, blockNumber: block };
}
const created = () => log("TableCreated", [1n, WALLETS[0], BUYIN, 2n], 10, 0, 1);
const joined = (seat: number, block: number) => log("PlayerJoined", [1n, seat, WALLETS[seat], KEYS[seat].address], block, seat === 0 ? 1 : 0, 10 + seat);

function fakeChain(logs: ReturnType<typeof log>[], head: number) {
  const chain = { head, logs };
  const source: LogSource = {
    getBlockNumber: async () => chain.head,
    getLogs: async f => chain.logs.filter(l => l.blockNumber >= f.fromBlock && l.blockNumber <= f.toBlock),
  };
  return { chain, source };
}

async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting for condition");
    await new Promise(r => setTimeout(r, 10));
  }
}

let gs: GameServer | null = null;
afterEach(async () => { await gs?.close(); gs = null; });

const deps = { verifySig: verifyEnvelope, verifyCheckpointSig };
function sendReady(db: ReturnType<typeof openDb>, seat: number) {
  const seq = (getPlayers(db, "1")[seat] as { lastSeq: number }).lastSeq + 1;
  const env = signEnvelope(KEYS[seat].privateKey, {
    tableId: "1", handNumber: 0, seq, sender: WALLETS[seat], seat: seat as 0 | 1 | 2 | 3,
    type: "ready" as MessageType, payload: { ready: true },
  });
  const r = ingest(db, deps, env);
  if (!r.ok) throw new Error(`ready rejected: ${r.reject.code} ${r.reject.message}`);
  gs!.sockets.tableChanged("1");
}

describe("2.4: chain deposits gate the start of the game", () => {
  it("the 4th deposit is not believed until it is buried under the confirmation window", async () => {
    const db = openDb();
    const { chain, source } = fakeChain([created(), joined(0, 10), joined(1, 11), joined(2, 12), joined(3, 13)], 14);
    gs = await startGameServer({ db, port: 0, origins: ORIGINS, chainSource: source, chainStartBlock: 1, chainPollMs: 10, chainConfirmations: 2 });

    // head 14, 2 confirmations: blocks up to 12 are read, the 4th join (block 13) is not.
    await until(() => getPlayers(db, "1").length === 3);
    await new Promise(r => setTimeout(r, 60));
    expect(getPlayers(db, "1")).toHaveLength(3);
    expect(loadGame(db, "1")!.state.tableState).toBe("lobby");

    chain.head = 16; // block 13 now has 2 confirmations
    await until(() => loadGame(db, "1")!.state.tableState === "waiting_deposits");
    expect(getPlayers(db, "1").every(p => p.deposited)).toBe(true);
  });

  it("ready needs 4 deposits AND 4 ready messages; the hand then starts by itself", async () => {
    const db = openDb();
    const { source } = fakeChain([created(), joined(0, 10), joined(1, 11), joined(2, 12), joined(3, 13)], 100);
    gs = await startGameServer({ db, port: 0, origins: ORIGINS, chainSource: source, chainStartBlock: 1, chainPollMs: 10 });
    await until(() => loadGame(db, "1")?.state.tableState === "waiting_deposits");

    for (const seat of [0, 1, 2]) sendReady(db, seat);
    expect(loadGame(db, "1")!.state.tableState).toBe("waiting_deposits"); // 3 of 4 ready
    sendReady(db, 3);
    const s = loadGame(db, "1")!.state;
    expect(s.tableState).toBe("betting");
    expect(s.handNumber).toBe(1);
  });

  it("a table cancelled on-chain becomes aborted", async () => {
    const db = openDb();
    const cancel = log("TableCancelled", [1n, WALLETS[0]], 12, 0, 99);
    const { source } = fakeChain([created(), joined(0, 10), cancel], 100);
    gs = await startGameServer({ db, port: 0, origins: ORIGINS, chainSource: source, chainStartBlock: 1, chainPollMs: 10 });
    await until(() => loadGame(db, "1")?.state.tableState === "aborted");
  });

  it("restarting the server on the same database does not re-apply anything", async () => {
    const db = openDb();
    const { source } = fakeChain([created(), joined(0, 10), joined(1, 11)], 100);
    gs = await startGameServer({ db, port: 0, origins: ORIGINS, chainSource: source, chainStartBlock: 1, chainPollMs: 10 });
    await until(() => getPlayers(db, "1").length === 2);
    await gs.close();
    gs = await startGameServer({ db, port: 0, origins: ORIGINS, chainSource: source, chainStartBlock: 1, chainPollMs: 10 });
    await new Promise(r => setTimeout(r, 60));
    const rows = db.prepare("SELECT outcome, COUNT(*) n FROM chain_events GROUP BY outcome").all();
    expect(rows).toEqual([{ outcome: "applied", n: 3 }]);
  });
});
