// server/scripts/bots.ts
// SPEC-2.1 §7 C7. Headless players for the game server.
//
//   A) No chain (CI, C4/C5 development). Start the server with POKER_SKIP_CHAIN=1, then:
//        npm run bots -w server -- --seed
//      Writes a table with 4 deposited seats into the server's database (DB_PATH) and plays it to `finished`.
//
//   B) Real chain, "1 browser + 3 bots". The browser creates the table, then:
//        BOT_KEYS=0xkey1,0xkey2,0xkey3 npm run bots -w server -- --table 12 --seats 1,2,3
//      Each bot calls joinTable (a real deposit), then plays. Exit code 0 = table finished and no check failed.
//
// Options:
//   --url <http://localhost:4000>   game server (default http://localhost:PORT)
//   --hands <n>                     seed mode only: hands to play (default 3)
//   --think <min,max>               pause before each bet, ms (default 0,0 in seed mode, 600,1800 in chain mode)
//   --stall <seats>                 these seats never bet (the 30 s clock must fold them), e.g. --stall 2
//   --garbage <seats>               these seats also spray junk envelopes at the server, e.g. --garbage 1
//   --traffic <file>                write every received message to this file, one JSON per line
//   --timeout <seconds>             give up after this long (default 600)
import { JsonRpcProvider, Contract, Wallet } from "ethers";
import { POKER_ABI, POKER_ADDRESS } from "@poker/shared";
import type { Seat } from "@poker/shared";
import { openDb } from "../src/db";
import { DB_PATH, PORT, RPC_URL } from "../src/env";
import { seedTable, startBots, type BotIdentity } from "./botsLib";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const nums = (s: string | undefined) => (s ?? "").split(",").map(x => x.trim()).filter(Boolean).map(Number);
const die = (msg: string): never => { console.error(`bots: ${msg}`); process.exit(2); };

async function main(): Promise<void> {
  const url = opt("url") ?? `http://localhost:${PORT}`;
  const seed = flag("seed");
  const tableArg = opt("table");
  if (seed === (tableArg !== undefined)) die("use exactly one of --seed or --table <id> --seats 1,2,3");

  const thinkArg = nums(opt("think"));
  const think: [number, number] = thinkArg.length === 2 ? [thinkArg[0], thinkArg[1]] : seed ? [0, 0] : [600, 1800];

  let tableId: string;
  let buyInWei: string;
  let identities: BotIdentity[];

  if (seed) {
    const db = openDb(DB_PATH);
    const seeded = seedTable(db, { totalHands: Number(opt("hands") ?? 3) });
    db.close(); // the server (another process) opens the same file; WAL mode allows that
    ({ tableId, buyInWei, identities } = seeded);
    console.log(`seeded table ${tableId} in ${DB_PATH} (4 seats, deposited). Playing ${opt("hands") ?? 3} hands against ${url}`);
  } else {
    tableId = tableArg!;
    if (!/^\d+$/.test(tableId)) die("--table must be a decimal table id");
    const seats = nums(opt("seats") ?? "1,2,3");
    const keys = (process.env.BOT_KEYS ?? "").split(",").map(s => s.trim()).filter(Boolean);
    if (keys.length < seats.length) die(`--seats lists ${seats.length} bots but BOT_KEYS has ${keys.length} private keys`);

    const res = await fetch(`${url}/api/tables/${tableId}`);
    if (!res.ok) die(`GET /api/tables/${tableId} answered ${res.status}: has the server's chain watcher seen the table yet?`);
    buyInWei = ((await res.json()) as { buyInWei: string }).buyInWei;

    const provider = new JsonRpcProvider(RPC_URL);
    identities = [];
    // Joins go one after another: the contract hands out seats in join order, not by choice.
    for (let i = 0; i < seats.length; i++) {
      const wallet = new Wallet(keys[i], provider);
      const contract = new Contract(POKER_ADDRESS, POKER_ABI, wallet);
      const session = Wallet.createRandom(); // this bot's session key; its address is registered by the join
      console.log(`bot ${i}: ${wallet.address} joins table ${tableId} (buy-in ${buyInWei} wei) ...`);
      const tx = await contract.joinTable(BigInt(tableId), session.address, { value: BigInt(buyInWei) });
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) die(`joinTable failed for ${wallet.address}`);

      let seat: number | null = null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== POKER_ADDRESS.toLowerCase()) continue;
        try {
          const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "PlayerJoined") seat = Number(parsed.args.seat);
        } catch { /* not one of our events */ }
      }
      if (seat === null) die(`joinTable ${tx.hash} confirmed but no PlayerJoined event was found`);
      if (seat !== seats[i]) console.warn(`bot ${i}: expected seat ${seats[i]}, the contract gave seat ${seat} (join order). Using ${seat}.`);
      identities.push({
        seat: seat as Seat,
        wallet: wallet.address.toLowerCase(),
        sessionPrivateKey: session.privateKey,
        sessionAddress: session.address.toLowerCase(),
      });
    }
    console.log(`joined seats ${identities.map(b => b.seat).join(", ")}. Waiting for the table to fill and the game to start ...`);
  }

  const run = startBots({
    url, tableId, buyInWei, identities, think,
    stallSeats: nums(opt("stall")),
    garbageSeats: nums(opt("garbage")),
    trafficFile: opt("traffic"),
    timeoutMs: Number(opt("timeout") ?? 600) * 1000,
    log: m => console.log(m),
  });
  process.on("SIGINT", () => { run.stop(); });

  const report = await run.finished;
  console.log("\n--- report ---");
  console.log(`finished: ${report.finished}  timed out: ${report.timedOut}  hands seen: ${report.hands}`);
  console.log(`server rejects seen by the bots: ${JSON.stringify(report.rejects)}`);
  if (report.failures.length) console.log("FAILURES:\n  " + report.failures.join("\n  "));
  console.log(report.ok ? "OK" : "NOT OK");
  process.exit(report.ok ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
