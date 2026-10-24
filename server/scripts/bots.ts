// server/scripts/bots.ts
// SPEC-2.1 §7 C7. Headless players for the game server.
//
//   A) No chain (CI, C4/C5 development). Start the server with POKER_SKIP_CHAIN=1, then:
//        npm run bots -w server -- --seed
//      Writes a table with 4 deposited seats into the server's database (DB_PATH) and plays it to `finished`.
//
//   A2) No chain, "1 browser + 3 bots" (SPEC-2.2 C3). Start the server with POKER_SKIP_CHAIN=1, then:
//        npm run bots -w server -- --seed --human 0xYourWallet
//      Seat 0 is your wallet, seats 1-3 are bots. The script prints a localStorage line to paste into the
//      browser console so the browser gets the seat's session key. DEV ONLY.
//
//   B) Real chain, "1 browser + 3 bots". The browser creates the table, then:
//        BOT_KEYS=0xkey1,0xkey2,0xkey3 npm run bots -w server -- --table 12 --seats 1,2,3
//      Each bot calls joinTable (a real deposit), then plays. Exit code 0 = table finished and no check failed.
//
// Options:
//   --url <http://localhost:4000>   game server (default http://localhost:PORT)
//   --hands <n>                     seed mode only: hands to play (default 3)
//   --think <min,max>               pause before each bet, ms (default 0,0 in seed mode, 600,1800 with --human or in chain mode)
//   --stall <seats>                 these seats never bet (the 30 s clock must fold them), e.g. --stall 2
//   --garbage <seats>               these seats also spray junk envelopes at the server, e.g. --garbage 1
//   --traffic <file>                write every received message to this file, one JSON per line
//   --timeout <seconds>             give up after this long (default 600)
//   --human <wallet>                with --seed: seat 0 is YOUR wallet (a browser), seats 1-3 are bots. Dev only.
//   --max-minutes <n>               give up after n minutes (default 10); same as --timeout but in minutes
import { JsonRpcProvider, Contract, Wallet, isAddress } from "ethers";
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

  const humanWallet = opt("human");
  if (flag("human") && humanWallet === undefined) die("--human needs a wallet address");
  if (humanWallet !== undefined) {
    if (!seed) die("--human only works together with --seed");
    if (!isAddress(humanWallet)) die(`--human must be a wallet address (0x + 40 hex characters), got "${humanWallet}"`);
  }

  const thinkArg = nums(opt("think"));
  // Next to a human the bots should not answer instantly.
  const think: [number, number] =
    thinkArg.length === 2 ? [thinkArg[0], thinkArg[1]] : seed && humanWallet === undefined ? [0, 0] : [600, 1800];

  let tableId: string;
  let buyInWei: string;
  let identities: BotIdentity[];

  if (seed) {
    const db = openDb(DB_PATH);
    const seeded = seedTable(db, { totalHands: Number(opt("hands") ?? 3), humanWallet });
    db.close(); // the server (another process) opens the same file; WAL mode allows that
    ({ tableId, buyInWei } = seeded);
    identities = seeded.botIdentities; // with --human these are seats 1..3 only
    if (seeded.human) {
      console.log(`seeded table ${tableId} in ${DB_PATH}: seat 0 = YOU (${seeded.human.wallet}), seats 1-3 = bots.`);
      console.log(`\nDEV ONLY. Open http://localhost:3000/table/${tableId} with this wallet connected, then paste this`);
      console.log(`line into the browser console (it gives the browser the session key for seat 0), and reload:\n`);
      console.log(`localStorage.setItem("poker:sk:${seeded.human.wallet}:${tableId}", "${seeded.human.sessionPrivateKey}")\n`);
      console.log(`The 3 bots wait for your "ready" (the browser sends it by itself), then play ${opt("hands") ?? 3} hands.`);
    } else {
      console.log(`seeded table ${tableId} in ${DB_PATH} (4 seats, deposited). Playing ${opt("hands") ?? 3} hands against ${url}`);
    }
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

  // --max-minutes (default 10) wins over the older --timeout <seconds>, so a forgotten script always ends.
  const maxMinutes = opt("max-minutes") !== undefined ? Number(opt("max-minutes")) : undefined;
  if (maxMinutes !== undefined && !(maxMinutes > 0)) die("--max-minutes must be a positive number");
  const timeoutSeconds = maxMinutes !== undefined ? maxMinutes * 60 : Number(opt("timeout") ?? 600);

  const run = startBots({
    url, tableId, buyInWei, identities, think,
    stallSeats: nums(opt("stall")),
    garbageSeats: nums(opt("garbage")),
    trafficFile: opt("traffic"),
    timeoutMs: timeoutSeconds * 1000,
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