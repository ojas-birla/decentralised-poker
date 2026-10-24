// server/src/gameServer.ts
// Everything index.ts used to do, as a function: REST + socket.io on ONE http server, the turn clock, the chain watcher,
// recovery after a crash. index.ts calls it once; the tests call it again to simulate a server restart.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { verifyEnvelope, verifyCheckpointSig } from "@poker/shared";
import { openDb, type Db } from "./db";
import { createApp } from "./lobby";
import { resetAllConnected } from "./reconnect";
import { TurnTimerScheduler } from "./timers";
import { recoverAll } from "./lifecycle";
import { attachSockets, type SocketLayer } from "./socket";
import { startChainWatcher } from "./chain";

export interface GameServerOptions {
  /** SQLite file (":memory:" if neither this nor `db` is given). */
  dbPath?: string;
  /** An already open database. The caller then owns it: close() will not close it. */
  db?: Db;
  /** 0 = pick a free port (read it back from `.port`). */
  port: number;
  origins: string[];
  skipChain?: boolean;
  log?: (msg: string) => void;
}

export interface GameServer {
  port: number;
  db: Db;
  sockets: SocketLayer;
  /** Stops the clock, the watcher and the sockets, then closes the database if this function opened it. */
  close(): Promise<void>;
}

export async function startGameServer(o: GameServerOptions): Promise<GameServer> {
  const ownDb = !o.db;
  const db = o.db ?? openDb(o.dbPath ?? ":memory:");
  const log = o.log ?? (() => {});

  resetAllConnected(db); // every socket died with the previous process
  recoverAll(db);        // finish anything a crash left half-done

  const server = http.createServer(createApp(db, { allowedOrigins: o.origins }));
  const sockets = attachSockets(server, db, { verifySig: verifyEnvelope, verifyCheckpointSig }, o.origins);

  const scheduler = new TurnTimerScheduler(db, r => {
    log(`auto ${r.action} seat ${r.seat} (table ${r.tableId}, hand ${r.handNumber})`);
    sockets.onAuto(r);
  });
  scheduler.start();

  const watcher = o.skipChain ? null : startChainWatcher(db, { onTableChanged: id => sockets.tableChanged(id) });
  if (o.skipChain) log("POKER_SKIP_CHAIN=1: chain watcher is off");

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.port, () => { server.off("error", reject); resolve(); });
  });

  let closing: Promise<void> | null = null;
  return {
    port: (server.address() as AddressInfo).port,
    db,
    sockets,
    close: () => (closing ??= (async () => {
      scheduler.stop();
      watcher?.stop();
      await sockets.close(); // also closes the http server
      if (ownDb) db.close();
    })()),
  };
}
