// SPEC-2.2 C3: `--seed --human`. The table is chain-free, seat 0 is the human's wallet, 3 bots wait for the human's ready.
import { afterEach, describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { openDb } from "./db";
import { loadGame } from "./store";
import { startGameServer, type GameServer } from "./gameServer";
import { Bot, seedTable, startBots } from "../scripts/botsLib";
process.env.POKER_DEV_DECK = "1"; // bots still rely on server dealing; remove when C-8 (bots use the real shuffle) lands

const HUMAN = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01"; // mixed case on purpose: the table stores it lowercase
const open: GameServer[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

async function humanTable() {
  const db = openDb();
  const seeded = seedTable(db, { tableId: "9", totalHands: 2, humanWallet: HUMAN });
  const gs = await startGameServer({ db, port: 0, origins: ["http://localhost:3000"], skipChain: true });
  open.push(gs);
  return { db, seeded, url: `http://localhost:${gs.port}` };
}

describe("--seed --human", () => {
  it("inserts a waiting_deposits table, 4 deposited seats, seat 0 = the human's wallet, 3 bot identities", async () => {
    const { db, seeded, url } = await humanTable();
    expect(loadGame(db, "9")!.state.tableState).toBe("waiting_deposits");
    expect(seeded.botIdentities.map(b => b.seat)).toEqual([1, 2, 3]);
    expect(seeded.human!.seat).toBe(0);
    expect(seeded.human!.wallet).toBe(HUMAN.toLowerCase());
    // the printed private key really is the key whose address was registered for seat 0
    expect(new Wallet(seeded.human!.sessionPrivateKey).address.toLowerCase()).toBe(seeded.human!.sessionAddress);

    const res = await fetch(`${url}/api/tables/9`);
    expect(res.status).toBe(200);
    const info = (await res.json()) as { state: string; seats: { seat: number; wallet: string; deposited: boolean }[] };
    expect(info.state).toBe("waiting_deposits");
    expect(info.seats).toHaveLength(4);
    expect(info.seats.every(s => s.deposited)).toBe(true);
    expect(info.seats.find(s => s.seat === 0)!.wallet).toBe(HUMAN.toLowerCase());
  });

  it("the bots wait for the human; once the human is ready the table plays to finished", async () => {
    const { db, seeded, url } = await humanTable();
    const bots = startBots({
      url, tableId: seeded.tableId, buyInWei: seeded.buyInWei, identities: seeded.botIdentities, timeoutMs: 60_000,
    });
    await new Promise(r => setTimeout(r, 800));
    expect(loadGame(db, "9")!.state.tableState).toBe("waiting_deposits"); // 3 readies are not enough

    // stand-in for the browser: a bot driving seat 0 with the generated session key
    const human = new Bot({ url, tableId: seeded.tableId, buyInWei: seeded.buyInWei, identity: seeded.human! });
    human.start();
    const report = await bots.finished;
    await human.done;
    human.stop();

    expect(report.failures).toEqual([]);
    expect(loadGame(db, "9")!.state.tableState).toBe("finished");
  }, 90_000);
});