// server/src/index.ts
// Server entry point: REST lobby + socket.io on ONE http server, the turn clock, the chain watcher, hand lifecycle.
import http from "node:http";
import { verifyEnvelope, verifyCheckpointSig } from "@poker/shared";
import { openDb } from "./db";
import { createApp } from "./lobby";
import { resetAllConnected } from "./reconnect";
import { TurnTimerScheduler } from "./timers";
import { recoverAll } from "./lifecycle";
import { attachSockets } from "./socket";
import { startChainWatcher } from "./chain";
import { PORT, DB_PATH, WEB_ORIGIN, SKIP_CHAIN } from "./env";

const ORIGINS = WEB_ORIGIN.split(",").map(s => s.trim()).filter(Boolean);

const db = openDb(DB_PATH);
resetAllConnected(db); // every socket died with the previous process
recoverAll(db);        // finish anything a crash left half-done

const server = http.createServer(createApp(db, { allowedOrigins: ORIGINS }));
const sockets = attachSockets(server, db, { verifySig: verifyEnvelope, verifyCheckpointSig }, ORIGINS);

const scheduler = new TurnTimerScheduler(db, r => {
  console.log(`auto ${r.action} seat ${r.seat} (table ${r.tableId}, hand ${r.handNumber})`);
  sockets.onAuto(r);
});
scheduler.start();

const watcher = SKIP_CHAIN ? null : startChainWatcher(db, { onTableChanged: id => sockets.tableChanged(id) });
if (SKIP_CHAIN) console.log("POKER_SKIP_CHAIN=1: chain watcher is off");

server.listen(PORT, () => console.log(`game server on :${PORT}, db ${DB_PATH}, CORS ${ORIGINS.join(", ")}`));

const shutdown = () => { scheduler.stop(); watcher?.stop(); sockets.close(); server.close(); db.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);