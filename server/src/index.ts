// server/src/index.ts
// Server entry point. The wiring lives in gameServer.ts so the tests can start and restart the same thing.
import { startGameServer } from "./gameServer";
import { PORT, DB_PATH, WEB_ORIGIN, SKIP_CHAIN, RPC_URL, CHAIN_CONFIRMATIONS } from "./env";

const ORIGINS = WEB_ORIGIN.split(",").map(s => s.trim()).filter(Boolean);

startGameServer({ dbPath: DB_PATH, port: PORT, origins: ORIGINS, skipChain: SKIP_CHAIN, rpcUrl: RPC_URL, chainConfirmations: CHAIN_CONFIRMATIONS, log: m => console.log(m) })
  .then(gs => {
    console.log(`game server on :${gs.port}, db ${DB_PATH}, CORS ${ORIGINS.join(", ")}`);
    const shutdown = () => { void gs.close().finally(() => process.exit(0)); };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })
  .catch(e => {
    console.error("could not start the game server:", e);
    process.exit(1);
  });
