// server/src/socket.ts
// SPEC-2.1 §7 C4 / §4: the socket.io layer. Two client events (hello, envelope), six server events.
// Everything in here is synchronous (better-sqlite3), so two messages can never interleave.
import type http from "node:http";
import { Server, type Socket } from "socket.io";
import type {
  ClientToServerEvents, EnvelopeAck, EventRow, HelloAck, HelloRequest, Reject, RejectCode, Seat, ServerToClientEvents,
} from "@poker/shared";
import type { Db } from "./db";
import type { IngestDeps } from "./ingest";
import { ingest } from "./ingest";
import { afterChange } from "./lifecycle";
import { disconnect as markDisconnected, publicState, reconnect } from "./reconnect";
import { getEvents, lastEventIndex, loadGame } from "./store";
import { getTimer, type AutoResult } from "./timers";

type S = Socket<ClientToServerEvents, ServerToClientEvents>;
interface Binding { tableId: string; seat: Seat }

const roomOf = (tableId: string) => `table:${tableId}`;
const keyOf = (tableId: string, seat: number) => `${tableId}:${seat}`;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const reject = (code: RejectCode, message: string, refSeq = 0): { ok: false; reject: Reject } =>
  ({ ok: false, reject: { refSeq, code, message } });

/** Wraps an ack so a client that sent none (or sends garbage) cannot crash us, and so it runs at most once. */
function safeAck<T>(ack: unknown): (a: T) => void {
  let done = false;
  return (a: T) => {
    if (done || typeof ack !== "function") return;
    done = true;
    (ack as (a: T) => void)(a);
  };
}

export interface SocketLayer {
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  /** Pushes everything new at a table to the sockets that should see it. Safe to call any time. */
  broadcast(tableId: string): void;
  /** Hand this to TurnTimerScheduler as onAuto. */
  onAuto(r: AutoResult): void;
  /** Call when a table changed without a socket message (chain watcher, restart recovery). */
  tableChanged(tableId: string): void;
  close(): void;
}

export function attachSockets(httpServer: http.Server, db: Db, deps: IngestDeps, origins: string[]): SocketLayer {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: origins },
    transports: ["websocket"],
    maxHttpBufferSize: 256 * 1024,
  });

  /** One live socket per seat: the newest hello wins. */
  const seatSockets = new Map<string, S>();
  /** Highest log index already sent to the room, per table. Tables nobody has opened yet have no entry. */
  const lastSent = new Map<string, number>();

  function broadcast(tableId: string): void {
    const game = loadGame(db, tableId);
    if (!game) return;
    const last = lastEventIndex(db, tableId);
    const from = (lastSent.get(tableId) ?? last) + 1; // unknown table: nothing is "new" for sockets that are not there
    lastSent.set(tableId, last);

    // 1. New log entries to everyone at the table, in order.
    if (last >= from) {
      for (const entry of getEvents(db, tableId, from)) {
        io.to(roomOf(tableId)).emit("event", { tableId, entry: entry as EventRow });
      }
    }
    // 2. Each seat gets ITS OWN view. Never one shared `state` emit: that would leak hole cards.
    for (const seat of [0, 1, 2, 3] as const) {
      seatSockets.get(keyOf(tableId, seat))?.emit("state", { tableId, index: last, state: publicState(game.state, seat) });
    }
    // 3. Whose clock is running.
    const t = getTimer(db, tableId);
    io.to(roomOf(tableId)).emit("timer", {
      tableId, seat: t ? t.seat : null, deadline: t ? t.deadline : null, handNumber: game.state.handNumber,
    });
  }

  function tableChanged(tableId: string): void {
    try {
      afterChange(db, tableId);
      broadcast(tableId);
    } catch (e) {
      console.error(`[socket] tableChanged(${tableId}) failed`, e);
    }
  }

  function onAuto(r: AutoResult): void {
    try {
      io.to(roomOf(r.tableId)).emit("auto", {
        tableId: r.tableId, index: r.index, seat: r.seat, action: r.action, handNumber: r.handNumber,
      });
      tableChanged(r.tableId); // lifecycle, then event + state + timer
    } catch (e) {
      console.error("[socket] onAuto failed", e);
    }
  }

  io.on("connection", (socket: S) => {
    const binding = (): Partial<Binding> => socket.data as Partial<Binding>;

    // ------------------------------------------------------------------ hello
    socket.on("hello", (req: HelloRequest, ack: (a: HelloAck) => void) => {
      const reply = safeAck<HelloAck>(ack);
      try {
        if (!isObj(req) || !isObj(req.joinEnvelope)) return reply(reject("BAD_PAYLOAD", "hello needs {joinEnvelope, fromIndex}"));
        const tableId = req.joinEnvelope.tableId;
        if (typeof tableId !== "string" || !loadGame(db, tableId)) return reply(reject("BAD_SEAT", "unknown table (the chain watcher may not have seen it yet)"));

        // A socket stays on one seat. A new tab/page makes a new socket, so this only blocks misuse.
        const b = binding();
        if (b.tableId !== undefined && (b.tableId !== tableId || b.seat !== req.joinEnvelope.seat)) {
          return reply(reject("BAD_SEAT", "this socket is already bound to another seat"));
        }

        // First time this process sees the table: nothing before now counts as "new" for the room.
        if (!lastSent.has(tableId)) lastSent.set(tableId, lastEventIndex(db, tableId));

        const r = reconnect(db, deps, req.joinEnvelope, typeof req.fromIndex === "number" ? req.fromIndex : 0);
        if (!r.ok) return reply({ ok: false, reject: r.reject });
        const seat = r.view.seat;
        const key = keyOf(tableId, seat);

        // Tell the OTHERS what changed (the join event, state with connected=true) BEFORE this socket is in the room,
        // so this client gets it only through `view` and never sees the same log entry twice.
        broadcast(tableId);

        const old = seatSockets.get(key);
        seatSockets.set(key, socket);
        socket.data = { tableId, seat } satisfies Binding;
        void socket.join(roomOf(tableId));
        if (old && old.id !== socket.id) old.disconnect(true); // its disconnect handler sees it is no longer the seat's socket

        reply({ ok: true, view: r.view });
        io.to(roomOf(tableId)).emit("presence", { tableId, seat, connected: true });
        const t = getTimer(db, tableId);
        socket.emit("timer", {
          tableId, seat: t ? t.seat : null, deadline: t ? t.deadline : null, handNumber: r.view.state.handNumber,
        });
      } catch (e) {
        console.error("[socket] hello failed", e);
        reply(reject("BAD_PAYLOAD", "server error"));
      }
    });

    // --------------------------------------------------------------- envelope
    socket.on("envelope", (env, ack: (a: EnvelopeAck) => void) => {
      const reply = safeAck<EnvelopeAck>(ack);
      try {
        const refSeq = isObj(env) && typeof env.seq === "number" ? env.seq : 0;
        const b = binding();
        if (b.tableId === undefined || b.seat === undefined) return reply(reject("WRONG_STATE", "send hello first", refSeq));
        if (!isObj(env) || env.tableId !== b.tableId || env.seat !== b.seat) {
          return reply(reject("BAD_SEAT", "envelope does not match this socket's table and seat", refSeq));
        }
        const r = ingest(db, deps, env);
        if (!r.ok) return reply({ ok: false, reject: r.reject }); // rejected envelopes are never forwarded
        reply({ ok: true, index: r.index });
        tableChanged(b.tableId); // lifecycle (ready -> deal, showdown -> settlement ...), then event + state + timer
      } catch (e) {
        console.error("[socket] envelope failed", e);
        reply(reject("BAD_PAYLOAD", "server error"));
      }
    });

    // ------------------------------------------------------------- disconnect
    socket.on("disconnect", () => {
      try {
        const b = binding();
        if (b.tableId === undefined || b.seat === undefined) return;
        const key = keyOf(b.tableId, b.seat);
        if (seatSockets.get(key) !== socket) return; // replaced by a newer hello: the seat is still connected
        seatSockets.delete(key);
        markDisconnected(db, b.tableId, b.seat);
        io.to(roomOf(b.tableId)).emit("presence", { tableId: b.tableId, seat: b.seat, connected: false });
        broadcast(b.tableId); // state now shows connected=false
      } catch (e) {
        console.error("[socket] disconnect failed", e);
      }
    });
  });

  return { io, broadcast, onAuto, tableChanged, close: () => { void io.close(); } };
}
