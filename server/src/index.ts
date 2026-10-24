// server/src/index.ts
// Server entry point. For now: REST lobby (1.32a) plus the turn-timer loop (1.31).
// Step 2.1 attaches socket.io to the same http server below and routes envelopes to ingest()/reconnect().
import http from "node:http";
import { openDb } from "./db";
import { createApp } from "./lobby";
import { resetAllConnected } from "./reconnect";
import { TurnTimerScheduler } from "./timers";

const PORT = Number(process.env.PORT ?? 4000);
const DB_PATH = process.env.DB_PATH ?? "./data/game.db";          // server/.env.example
const ORIGINS = (process.env.WEB_ORIGIN ?? "http://localhost:3000") // server/.env.example; comma-separated for several
  .split(",").map(s => s.trim()).filter(Boolean);

const db = openDb(DB_PATH);
resetAllConnected(db); // every socket died with the previous process

// Overdue turn clocks (for example from before a restart) fire on the first tick.
const scheduler = new TurnTimerScheduler(db, r => {
  console.log(`auto ${r.action} seat ${r.seat} (table ${r.tableId}, hand ${r.handNumber})`); // 2.1: broadcast here
});
scheduler.start();

const server = http.createServer(createApp(db, { allowedOrigins: ORIGINS }));
server.listen(PORT, () => console.log(`game server on :${PORT}, db ${DB_PATH}, CORS ${ORIGINS.join(", ")}`));

const shutdown = () => { scheduler.stop(); server.close(); db.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);