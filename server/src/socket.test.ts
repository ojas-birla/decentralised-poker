import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import type {
  ClientToServerEvents, EnvelopeAck, EventRow, GameState, HelloAck, MessageType, Seat, ServerToClientEvents,
} from "@poker/shared";
import { openDb, type Db } from "./db";
import { addPlayer, createGame, getPlayer, setDeposited } from "./store";
import type { IngestDeps } from "./ingest";
import { attachSockets, type SocketLayer } from "./socket";
process.env.POKER_DEV_DECK = "1"; // bots still rely on server dealing; remove when C-8 (bots use the real shuffle) lands

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;
interface Bot {
  seat: Seat; sock: Client; seq: number;
  state: GameState | null; events: EventRow[]; presence: { seat: number; connected: boolean }[];
  all: { name: string; msg: unknown }[];
}

const T = "1";
const wallet = (i: number) => "0x" + String(i + 1).repeat(40);
const key = (i: number) => "0x" + String(i + 5).repeat(40);
const deps: IngestDeps = { verifySig: e => e.sig === "0xok", verifyCheckpointSig: () => true }; // stub crypto

const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

async function startServer() {
  const db = openDb();
  createGame(db, { tableId: T, creator: wallet(0), buyInWei: 1_000_000_000_000_000n, totalHands: 3 });
  for (let i = 0; i < 4; i++) {
    addPlayer(db, { tableId: T, seat: i as Seat, wallet: wallet(i), sessionKey: key(i) });
    setDeposited(db, T, i);
  }
  const server = http.createServer();
  const layer: SocketLayer = attachSockets(server, db, deps, ["http://localhost:3000"]);
  await new Promise<void>(res => server.listen(0, res));
  cleanups.push(() => { layer.close(); db.close(); });
  return { db, layer, url: `http://localhost:${(server.address() as AddressInfo).port}` };
}

async function connectBot(url: string, seat: Seat): Promise<Bot> {
  const sock: Client = connect(url, { transports: ["websocket"], forceNew: true });
  cleanups.push(() => { sock.disconnect(); });
  const bot: Bot = { seat, sock, seq: 1, state: null, events: [], presence: [], all: [] };
  sock.onAny((name, msg) => bot.all.push({ name, msg }));
  sock.on("state", m => { bot.state = m.state; });
  sock.on("event", m => { bot.events.push(m.entry); });
  sock.on("presence", m => { bot.presence.push({ seat: m.seat, connected: m.connected }); });
  await new Promise<void>((res, rej) => { sock.on("connect", () => res()); sock.on("connect_error", rej); });
  return bot;
}

const env = (seat: number, seq: number, type: MessageType, payload: unknown, handNumber: number) =>
  ({ tableId: T, handNumber, seq, sender: wallet(seat), seat: seat as Seat, type, payload, sig: "0xok" });

const hello = (b: Bot, fromIndex = 0) => new Promise<HelloAck>(res => {
  b.sock.emit("hello", { joinEnvelope: env(b.seat, b.seq, "join", { sessionKey: key(b.seat) }, 0), fromIndex }, a => {
    if (a.ok) b.seq = a.view.nextSeq; // SPEC §4.1: after every hello the counter is the server's nextSeq
    res(a);
  });
});
const send = (b: Bot, type: MessageType, payload: unknown, handNumber: number) => new Promise<EnvelopeAck>(res => {
  b.sock.emit("envelope", env(b.seat, b.seq, type, payload, handNumber), a => { if (a.ok) b.seq++; res(a); });
});

async function waitFor(cond: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for condition");
    await new Promise(r => setTimeout(r, 10));
  }
}

/** 4 bots connected, hello'd and ready: the server deals hand 1. */
async function startedTable() {
  const s = await startServer();
  const bots = await Promise.all(([0, 1, 2, 3] as Seat[]).map(i => connectBot(s.url, i)));
  for (const b of bots) expect((await hello(b)).ok).toBe(true);
  for (const b of bots) expect((await send(b, "ready", { ready: true }, 0)).ok).toBe(true);
  await waitFor(() => bots.every(b => b.state?.tableState === "betting"));
  return { ...s, bots };
}

describe("socket layer", () => {
  it("rejects an envelope sent before hello", async () => {
    const { url } = await startServer();
    const b = await connectBot(url, 0);
    const a = await send(b, "ready", { ready: true }, 0);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reject.code).toBe("WRONG_STATE");
  });

  it("answers hello for an unknown table with BAD_SEAT so the client retries", async () => {
    const { url } = await startServer();
    const b = await connectBot(url, 0);
    const a = await new Promise<HelloAck>(res =>
      b.sock.emit("hello", { joinEnvelope: { ...env(0, 1, "join", { sessionKey: key(0) }, 0), tableId: "999" }, fromIndex: 0 }, res));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reject.code).toBe("BAD_SEAT");
  });

  it("4 bots: hello, ready, the server deals, and each bot sees only its own cards", async () => {
    const { bots } = await startedTable();
    for (const b of bots) {
      expect(b.state!.deck).toBeNull();
      expect(b.state!.holeCards[b.seat]).toHaveLength(2);
      for (const other of [0, 1, 2, 3].filter(i => i !== b.seat)) expect(b.state!.holeCards[other]).toHaveLength(0);
      // nothing on the wire carries a deck
      expect(JSON.stringify(b.all)).not.toContain('"deck":[');
      // the log contains the deal
      expect(b.events.some(e => e.kind === "server" && (e.body as { kind: string }).kind === "hand_started")).toBe(true);
    }
  });

  it("an action is acked to the sender, broadcast as an event to everyone, and moves the turn", async () => {
    const { bots } = await startedTable();
    const toAct = bots[0].state!.toActSeat as Seat;
    const actor = bots.find(b => b.seat === toAct)!;

    const ack = await send(actor, "bet_action", { action: "fold" }, 1);
    expect(ack.ok).toBe(true);
    await waitFor(() => bots.every(b => b.state!.toActSeat !== toAct));
    for (const b of bots) {
      expect(b.events.some(e => e.kind === "envelope" && (e.body as { type: string }).type === "bet_action")).toBe(true);
    }
  });

  it("rejects an envelope for a different seat than the socket's", async () => {
    const { bots } = await startedTable();
    const a = await new Promise<EnvelopeAck>(res =>
      bots[0].sock.emit("envelope", env(1, 99, "ready", { ready: true }, 0), res));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reject.code).toBe("BAD_SEAT");
  });

  it("the newest hello for a seat wins and the old socket is dropped", async () => {
    const { url, db } = await startServer();
    const first = await connectBot(url, 0);
    expect((await hello(first)).ok).toBe(true);

    const second = await connectBot(url, 0); // same seat, second tab: it does not know the server's seq yet
    const retry = await hello(second);       // seq 1 was already used by the first tab
    expect(retry.ok).toBe(false);
    if (retry.ok) return;
    expect(retry.reject.code).toBe("DUPLICATE");
    second.seq = retry.reject.nextSeq!;      // SPEC §4.1 rule 4: adopt nextSeq and send the same message once more
    expect((await hello(second)).ok).toBe(true);
    await waitFor(() => !first.sock.connected);

    await new Promise(r => setTimeout(r, 50));
    expect(getPlayer(db as Db, T, 0)!.connected).toBe(true); // the old socket's close did not mark the seat offline
  });

  it("other players are told when a seat disconnects", async () => {
    const { url } = await startServer();
    const a = await connectBot(url, 0);
    const b = await connectBot(url, 1);
    await hello(a); await hello(b);
    a.sock.disconnect();
    await waitFor(() => b.presence.some(p => p.seat === 0 && !p.connected) && b.state?.seats[0].connected === false);
  });
});
