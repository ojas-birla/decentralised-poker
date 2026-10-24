// C7: the bot script end to end, over real sockets and real signatures (no stubs), against the real server wiring.
import { afterEach, describe, expect, it } from "vitest";
import { verifyCheckpointSig, totalChips } from "@poker/shared";
import type { Checkpoint } from "@poker/shared";
import { openDb } from "./db";
import { loadGame } from "./store";
import { startGameServer, type GameServer } from "./gameServer";
import { seedTable, startBots } from "../scripts/botsLib";

const origins = ["http://localhost:3000"];
const open: GameServer[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

async function seededServer(totalHands: number) {
  const db = openDb();
  const seeded = seedTable(db, { tableId: "7", totalHands });
  const gs = await startGameServer({ db, port: 0, origins, skipChain: true });
  open.push(gs);
  return { db, gs, seeded, url: `http://localhost:${gs.port}` };
}

describe("bots", () => {
  it("4 bots play a seeded table to `finished`; every check passes; the checkpoint has 4 valid signatures", async () => {
    const { db, seeded, url } = await seededServer(3);
    const report = await startBots({
      url, tableId: seeded.tableId, buyInWei: seeded.buyInWei, identities: seeded.identities, timeoutMs: 60_000,
    }).finished;

    expect(report.failures).toEqual([]);
    expect(report.finished).toBe(true);
    expect(report.hands).toBe(3);
    expect(report.ok).toBe(true);

    const g = loadGame(db, seeded.tableId)!;
    expect(g.state.tableState).toBe("finished");
    expect(totalChips(g.state)).toBe(4000);

    // The REST endpoint serves what step 2.7 will submit on-chain; check each signature against its session key.
    const res = await fetch(`${url}/api/tables/${seeded.tableId}/checkpoint`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checkpoint: Checkpoint; hash: string; sigs: (string | null)[] };
    expect(body.checkpoint.checkpointNumber).toBe(3);
    body.sigs.forEach((sig, seat) => {
      expect(sig).not.toBeNull();
      expect(verifyCheckpointSig(body.checkpoint, body.hash, sig!, seeded.identities[seat].sessionAddress)).toBe(true);
    });
  }, 90_000);

  it("a garbage-spraying bot is shrugged off: the game still finishes and the rejects are logged", async () => {
    const { db, seeded, url } = await seededServer(3);
    const report = await startBots({
      url, tableId: seeded.tableId, buyInWei: seeded.buyInWei, identities: seeded.identities,
      garbageSeats: [1], think: [10, 40], timeoutMs: 60_000,
    }).finished;

    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    expect(Object.keys(report.rejects).length).toBeGreaterThan(0); // the server answered the junk with reject codes
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM rejects").get() as { n: number };
    expect(n).toBeGreaterThan(0);
  }, 90_000);
});
