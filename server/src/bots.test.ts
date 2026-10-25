// C7 + C-8: the bot script end to end, over real sockets and real signatures (no stubs), against the real server wiring.
// Real padlock shuffle (POKER_DEV_DECK unset): the bots deal the cards themselves.
import { afterEach, describe, expect, it } from "vitest";
import { verifyCheckpointSig, totalChips } from "@poker/shared";
import type { Checkpoint } from "@poker/shared";
import { openDb, type Db } from "./db";
import { getEvents, loadGame } from "./store";
import { startGameServer, type GameServer } from "./gameServer";
import { seedTable, startBots } from "../scripts/botsLib";

const origins = ["http://localhost:3000"];
const open: GameServer[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

async function seededServer(totalHands: number) {
  delete process.env.POKER_DEV_DECK; // real shuffle, whatever another test file left behind
  const db = openDb();
  const seeded = seedTable(db, { tableId: "7", totalHands });
  const gs = await startGameServer({ db, port: 0, origins, skipChain: true });
  open.push(gs);
  return { db, gs, seeded, url: `http://localhost:${gs.port}` };
}

const aborts = (db: Db, tableId: string) =>
  getEvents(db, tableId)
    .filter(e => e.kind === "server" && (e.body as { kind: string }).kind === "abort")
    .map(e => (e.body as { reason: string }).reason);

describe("bots", () => {
  it("4 honest bots play 5 hands with the real shuffle; chips stay 4000; no abort; 4 valid checkpoint signatures", async () => {
    const { db, seeded, url } = await seededServer(5);
    const report = await startBots({
      url, tableId: seeded.tableId, buyInWei: seeded.buyInWei, identities: seeded.identities, timeoutMs: 120_000,
    }).finished;

    expect(report.failures).toEqual([]); // includes "chips sum to 4000" and "no foreign hole cards", checked on every state
    expect(report.finished).toBe(true);
    // The game ends early when only one player has chips left (everyone all-in in an early hand).
    expect(report.hands).toBeGreaterThanOrEqual(1);
    expect(report.hands).toBeLessThanOrEqual(5);
    expect(report.ok).toBe(true);
    expect(aborts(db, seeded.tableId)).toEqual([]); // nobody cheated, nothing aborted

    const g = loadGame(db, seeded.tableId)!;
    expect(g.state.tableState).toBe("finished");
    expect(totalChips(g.state)).toBe(4000);

    // The REST endpoint serves what step 2.7 will submit on-chain; check each signature against its session key.
    const res = await fetch(`${url}/api/tables/${seeded.tableId}/checkpoint`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checkpoint: Checkpoint; hash: string; sigs: (string | null)[] };
    expect(body.checkpoint.checkpointNumber).toBe(report.hands); // one checkpoint per hand played
    body.sigs.forEach((sig, seat) => {
      expect(sig).not.toBeNull();
      expect(verifyCheckpointSig(body.checkpoint, body.hash, sig!, seeded.identities[seat].sessionAddress)).toBe(true);
    });
  }, 180_000);

  it("a garbage-spraying bot is shrugged off: the game still finishes and the rejects are logged", async () => {
    const { db, seeded, url } = await seededServer(3);
    const report = await startBots({
      url, tableId: seeded.tableId, buyInWei: seeded.buyInWei, identities: seeded.identities,
      garbageSeats: [1], think: [10, 40], timeoutMs: 120_000,
    }).finished;

    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    expect(Object.keys(report.rejects).length).toBeGreaterThan(0); // the server answered the junk with reject codes
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM rejects").get() as { n: number };
    expect(n).toBeGreaterThan(0);
  }, 180_000);
});

describe("bots: malicious padlock players (SPEC-PHASE3 C-8.3)", () => {
  // Passive bots check and call, so every hand reaches the flop and the showdown. The cheater ruins every hand,
  // every hand is aborted with its chips returned, every abort still gets a checkpoint, and the game finishes.
  async function cheatRun(cheat: "dup-card" | "lie-reveal", cheatSeat: number) {
    const { db, seeded, url } = await seededServer(2);
    const report = await startBots({
      url, tableId: seeded.tableId, buyInWei: seeded.buyInWei, identities: seeded.identities,
      passive: true, cheat, cheatSeats: [cheatSeat], timeoutMs: 120_000,
    }).finished;
    return { db, seeded, report };
  }

  it("--cheat=dup-card: a repeated board card aborts every hand with DUPLICATE_CARD", async () => {
    const { db, seeded, report } = await cheatRun("dup-card", 3); // seat 3 = last unlocker of every board card
    expect(report.failures).toEqual([]); // the HONEST bots' invariants held throughout
    expect(report.finished).toBe(true);
    const reasons = aborts(db, seeded.tableId);
    expect(reasons.length).toBeGreaterThanOrEqual(1);
    expect(reasons.every(r => r === "DUPLICATE_CARD")).toBe(true);
    const s = loadGame(db, seeded.tableId)!.state;
    expect(totalChips(s)).toBe(4000);
    expect(s.seats.map(p => p.chips)).toEqual([1000, 1000, 1000, 1000]); // every hand rolled back
  }, 180_000);

  it("--cheat=lie-reveal: a lying reveal aborts every hand with BAD_REVEAL", async () => {
    const { db, seeded, report } = await cheatRun("lie-reveal", 1);
    expect(report.failures).toEqual([]);
    expect(report.finished).toBe(true);
    const reasons = aborts(db, seeded.tableId);
    expect(reasons.length).toBeGreaterThanOrEqual(1);
    expect(reasons.every(r => r === "BAD_REVEAL")).toBe(true);
    const s = loadGame(db, seeded.tableId)!.state;
    expect(totalChips(s)).toBe(4000);
    expect(s.seats.map(p => p.chips)).toEqual([1000, 1000, 1000, 1000]);
  }, 180_000);

  it("--cheat=stall: the 60 s crypto clock aborts every hand with CRYPTO_STALL", async () => {
    const { db, seeded, url } = await seededServer(2);
    // Do not wait 60 s: whenever the server is waiting for the staller (seat 2), let its clock run out at once.
    const fast = setInterval(() => {
      db.prepare("UPDATE timers SET deadline = 0 WHERE kind = 'crypto' AND seat = 2").run();
    }, 100);
    try {
      const report = await startBots({
        url, tableId: seeded.tableId, buyInWei: seeded.buyInWei, identities: seeded.identities,
        cheat: "stall", cheatSeats: [2], passive: true, timeoutMs: 120_000,
      }).finished;
      expect(report.failures).toEqual([]);
      expect(report.finished).toBe(true);
    } finally {
      clearInterval(fast);
    }
    const reasons = aborts(db, seeded.tableId);
    expect(reasons.length).toBeGreaterThanOrEqual(1);
    expect(reasons.every(r => r === "CRYPTO_STALL")).toBe(true);
    expect(totalChips(loadGame(db, seeded.tableId)!.state)).toBe(4000);
  }, 180_000);
});