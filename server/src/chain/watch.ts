// Run with: npm run watch-chain --workspace=server
try {
  (process as unknown as { loadEnvFile(p: string): void }).loadEnvFile(".env");
} catch {
  /* no .env file, defaults are used */
}
import { openDb } from "../db";
import { ChainWatcher } from "./watcher";

// A separate database file, so the test run never mixes with the real game.db or seeded fake tables.
const db = openDb(process.env.WATCH_DB_PATH ?? "./data/chain-watch.db");

const watcher = new ChainWatcher({
  db,
  startBlock: process.env.WATCH_START_BLOCK ? Number(process.env.WATCH_START_BLOCK) : undefined,
  rpcUrl: process.env.RPC_URL ?? "https://sepolia.base.org",
  log: (m) => console.log("[watcher]", m),
  onApplied: (ev, r) => {
    const detail =
      ev.type === "PlayerJoined" ? `seat ${ev.seat} ${ev.wallet}` :
      ev.type === "TableCreated" ? `creator ${ev.creator} buy-in ${ev.buyInWei} hands ${ev.handCount}` : "";
    console.log(`[block ${ev.blockNumber}] ${ev.type} table ${ev.tableId} ${detail} -> ${r.status}${"note" in r && r.note ? ` (${r.note})` : ""}`);
  },
});

console.log("Watching the contract. Ctrl+C to stop.");
watcher.start();
process.on("SIGINT", () => {
  watcher.stop();
  process.exit(0);
});
