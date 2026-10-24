// server/scripts/botsLib.ts
// SPEC-2.1 §7 C7: headless players. A Bot is a real socket.io client that follows the SAME rules as the web app:
//   hello (signed join) -> ready -> random legal bet_action when it is its turn -> checkpoint_sig after every hand.
// Every state it receives is checked against the Phase 2 invariants (chips sum to 4000, no deck, no foreign hole cards).
//
// No main() in this file on purpose: bots.ts is the command line, the vitest tests import this file directly.
import { appendFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { Wallet } from "ethers";
import { io as connect, type Socket } from "socket.io-client";
import { computeCheckpoint, legalActions, signCheckpoint, signEnvelope, totalChips } from "@poker/shared";
import type {
  ActionType, ClientToServerEvents, Envelope, EnvelopeAck, EventMsg, EventRow, GameState, HelloAck,
  MessageType, Seat, ServerToClientEvents, StateMsg,
} from "@poker/shared";
import type { Db } from "../src/db";
import { addPlayer, createGame, setDeposited } from "../src/store";

type Sock = Socket<ServerToClientEvents, ClientToServerEvents>;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ------------------------------------------------------------------------------------------------ identities

export interface BotIdentity {
  seat: Seat;
  /** Lowercase wallet address: the `sender` of every envelope. */
  wallet: string;
  /** The session key: signs envelopes and checkpoints. Its address is what the table registered. */
  sessionPrivateKey: string;
  sessionAddress: string; // lowercase
}

export function newIdentity(seat: Seat, wallet?: string): BotIdentity {
  const session = Wallet.createRandom();
  return {
    seat,
    wallet: (wallet ?? Wallet.createRandom().address).toLowerCase(),
    sessionPrivateKey: session.privateKey,
    sessionAddress: session.address.toLowerCase(),
  };
}

/**
 * `--seed` mode: writes a table with 4 seated AND deposited players straight into the server's database
 * (no chain). Run the server with POKER_SKIP_CHAIN=1 on the same DB_PATH. The server finds the table on the first `hello`.
 */
export function seedTable(
  db: Db,
  o: { tableId?: string; totalHands?: number; buyInWei?: bigint; humanWallet?: string } = {}
) {
  const tableId = o.tableId ?? String(Date.now()); // decimal string, like an on-chain id
  const buyInWei = o.buyInWei ?? 1_000_000_000_000_000n; // 0.001 ETH, divisible by 1000
  // Seat 0 is the human when humanWallet is given: that wallet, with a session key we generate here.
  const identities = ([0, 1, 2, 3] as Seat[]).map(seat =>
    newIdentity(seat, seat === 0 ? o.humanWallet : undefined));
  createGame(db, { tableId, creator: identities[0].wallet, buyInWei, totalHands: o.totalHands ?? 3 });
  for (const id of identities) {
    addPlayer(db, { tableId, seat: id.seat, wallet: id.wallet, sessionKey: id.sessionAddress });
    setDeposited(db, tableId, id.seat);
  }
  return {
    tableId,
    buyInWei: buyInWei.toString(),
    identities,                                            // all 4, as before (bots.test.ts uses this)
    human: o.humanWallet ? identities[0] : null,           // seat 0 when --human was used
    botIdentities: o.humanWallet ? identities.slice(1) : identities,
  };
}

// ------------------------------------------------------------------------------------------------ one bot

export type BotMode = "normal" | "stall" | "garbage";

export interface BotOptions {
  url: string;
  tableId: string;
  buyInWei: string; // decimal string; chip value = buyInWei / 1000
  identity: BotIdentity;
  /** Pause before every bet, uniformly in [min, max] ms. Use something like [400, 1500] next to a human. */
  think?: [number, number];
  /** stall: does everything except bet (the server's 30 s clock must fold it). garbage: also sends junk. */
  mode?: BotMode;
  /** Append every message received as one JSON line (for eyeballing "no deck, no foreign cards" yourself). */
  trafficFile?: string;
  log?: (msg: string) => void;
}

type Step = "ready" | "checkpoint" | "bet";

export class Bot {
  readonly seat: Seat;
  /** Everything that went wrong on the bot's side. Empty = the bot is happy. */
  readonly failures: string[] = [];
  /** How often the server answered with each reject code (interesting in garbage mode). */
  readonly rejects: Record<string, number> = {};
  /** Resolves when the bot has seen tableState "finished" (or "aborted", or stop()). */
  readonly done: Promise<void>;
  sawFinished = false;

  private resolveDone: () => void = () => {};
  private sock!: Sock;
  private seq = 1;
  private helloOk = false;
  private helloGen = 0;
  private lastEvent = -1; // highest log index received
  private state: GameState | null = null;
  private stateIndex = -1;
  private holdUntil = -1; // after a reject: do nothing until a state with a higher index arrives
  private lastActedIndex = -2; // state index we last bet on (the ack arrives BEFORE the new state)
  private sentReady = false;
  private signed = new Set<number>(); // hand numbers whose checkpoint we signed
  private hands = new Set<number>();
  private busy = false;
  private stopped = false;
  private pending = new Set<() => void>();
  private junkTimer: ReturnType<typeof setInterval> | null = null;
  private junkSent = 0;
  private lastEnv: Envelope | null = null;
  private readonly weiPerChip: bigint;
  private readonly think: [number, number];
  private readonly mode: BotMode;

  constructor(private readonly o: BotOptions) {
    this.seat = o.identity.seat;
    this.weiPerChip = BigInt(o.buyInWei) / 1000n;
    this.think = o.think ?? [0, 0];
    this.mode = o.mode ?? "normal";
    this.done = new Promise<void>(r => { this.resolveDone = r; });
  }

  latest(): GameState | null { return this.state; }
  handsSeen(): number { return this.hands.size === 0 ? 0 : Math.max(...this.hands); }

  start(): void {
    const sock: Sock = connect(this.o.url, {
      transports: ["websocket"], forceNew: true,
      reconnection: true, reconnectionDelay: 200, reconnectionDelayMax: 1000, // fast, so a server restart costs little
    });
    this.sock = sock;
    sock.on("connect", () => { void this.hello(); }); // EVERY connect, including the automatic reconnects
    sock.on("disconnect", reason => {
      this.helloOk = false;
      this.cancelPending();
      // The server hung up on purpose (flood guard, newer tab): socket.io will NOT retry by itself in that case.
      if (reason === "io server disconnect" && !this.stopped) setTimeout(() => { if (!this.stopped) sock.connect(); }, 300);
    });
    sock.on("connect_error", () => { /* socket.io retries on its own */ });
    sock.on("state", (m: StateMsg) => this.onState(m));
    sock.on("event", (m: EventMsg) => {
      if (m.tableId === this.o.tableId) this.lastEvent = Math.max(this.lastEvent, m.entry.index);
    });
    sock.onAny((name: string, msg: unknown) => this.inspect(name, msg));
    if (this.mode === "garbage") this.junkTimer = setInterval(() => this.sendJunk(), 150);
  }

  stop(): void {
    this.stopped = true;
    if (this.junkTimer) clearInterval(this.junkTimer);
    this.cancelPending();
    this.sock?.disconnect();
    this.resolveDone();
  }

  // ---------------------------------------------------------------- joining (SPEC §4.1 "Joining")

  private async hello(): Promise<void> {
    const gen = ++this.helloGen; // a newer connect supersedes an older retry loop
    let wait = 1000;
    let seqRetries = 0;
    while (!this.stopped && gen === this.helloGen && this.sock.connected) {
      const join = this.sign("join", { sessionKey: this.o.identity.sessionAddress }, 0);
      const ack = await this.call<HelloAck>(cb =>
        this.sock.emit("hello", { joinEnvelope: join, fromIndex: this.lastEvent + 1 }, cb));
      if (gen !== this.helloGen || this.stopped) return;
      if (!ack) { await sleep(300); continue; } // connection dropped or no answer: try again while connected
      this.inspect("hello-ack", ack);

      if (ack.ok) {
        const v = ack.view;
        this.seq = v.nextSeq; // SPEC §4.1 rule 3
        this.lastEvent = Math.max(this.lastEvent, v.lastIndex);
        for (const e of v.events) { this.scanLog(e); this.checkEntry(e); }
        this.state = v.state;
        this.stateIndex = v.lastIndex;
        this.holdUntil = -1;
        this.lastActedIndex = -2; // an action whose ack got lost must be re-evaluated from the fresh state
        this.noteState(v.state);
        this.helloOk = true;
        void this.pump();
        return;
      }

      const { code, message, nextSeq } = ack.reject;
      this.count(code);
      if ((code === "DUPLICATE" || code === "BAD_SEQ") && nextSeq !== undefined && seqRetries++ < 3) {
        this.seq = nextSeq; // SPEC §4.1 rule 4: adopt it and send the same message once more
        continue;
      }
      if (code === "BAD_SEAT") { // the chain watcher may not have registered our seat yet
        this.log(`hello: ${message}; retrying in ${wait} ms`);
        await sleep(wait);
        wait = Math.min(wait * 2, 30_000);
        continue;
      }
      this.fail(`hello rejected: ${code} ${message}`);
      return;
    }
  }

  // ---------------------------------------------------------------- reacting to state

  private onState(m: StateMsg): void {
    if (m.tableId !== this.o.tableId || m.index < this.stateIndex) return; // SPEC §4.1: drop older states
    this.state = m.state;
    this.stateIndex = m.index;
    this.noteState(m.state);
    void this.pump();
  }

  private noteState(s: GameState): void {
    this.hands.add(s.handNumber);
    this.check(s);
    if (s.tableState === "finished") { this.sawFinished = true; this.resolveDone(); }
    if (s.tableState === "aborted") { this.fail("table aborted"); this.resolveDone(); }
  }

  /** The Phase 2 invariants (SPEC-2.1 §7 C7). */
  private check(s: GameState): void {
    if (s.deck !== null) this.fail("a state message carries the deck");
    const total = totalChips(s);
    if (total !== 4000) this.fail(`chips sum to ${total}, not 4000 (hand ${s.handNumber}, ${s.tableState})`);
    const reveal = s.tableState === "showdown" || s.tableState === "settlement";
    for (let i = 0; i < 4; i++) {
      if (i === this.seat || s.holeCards[i].length === 0) continue;
      const p = s.seats[i];
      if (!(reveal && p.inHand && !p.hasFolded)) {
        this.fail(`seat ${this.seat} was shown the hole cards of seat ${i} (hand ${s.handNumber}, ${s.tableState})`);
      }
    }
  }

  private checkEntry(e: EventRow): void {
    if (e.kind === "server" && /holeCards|"deck"|"board"/.test(JSON.stringify(e.body))) {
      this.fail(`a server log entry carries cards (index ${e.index})`);
    }
  }

  private scanLog(e: EventRow): void {
    if (e.kind !== "envelope") return;
    const b = e.body as Envelope;
    if (b.seat !== this.seat) return;
    if (b.type === "ready") this.sentReady = true;
    if (b.type === "checkpoint_sig") this.signed.add(b.handNumber);
  }

  /** Looks at everything the server sends: no deck anywhere, no cards in server log entries. Optional traffic log. */
  private inspect(name: string, msg: unknown): void {
    let json = "";
    try { json = JSON.stringify(msg) ?? ""; } catch { return; }
    if (/"deck":\s*\[/.test(json)) this.fail(`'${name}' carries a deck`);
    if (name === "event") this.checkEntry((msg as EventMsg).entry);
    if (this.o.trafficFile) {
      appendFileSync(this.o.trafficFile, JSON.stringify({ t: Date.now(), seat: this.seat, name, msg }) + "\n");
    }
  }

  // ---------------------------------------------------------------- deciding and sending

  private plan(): Step | null {
    const s = this.state;
    if (!s || this.stateIndex <= this.holdUntil) return null;
    if ((s.tableState === "waiting_deposits" || s.tableState === "ready") && !this.sentReady) return "ready";
    if ((s.tableState === "settlement" || s.tableState === "finished") && s.handNumber >= 1) {
      // The server stores checkpointNumber on the state only once all 4 signatures are in: then there is nothing to sign.
      if (s.checkpointNumber >= s.handNumber) this.signed.add(s.handNumber);
      if (!this.signed.has(s.handNumber)) return "checkpoint"; // at most once per hand (SPEC-2.1 D7)
    }
    if (this.mode !== "stall" && s.tableState === "betting" && s.toActSeat === this.seat && this.stateIndex > this.lastActedIndex) {
      return "bet";
    }
    return null;
  }

  /** One envelope in flight at a time (SPEC §4.1 rule 1): everything goes through this loop. */
  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let guard = 0; guard < 50 && !this.stopped && this.helloOk; guard++) {
        let step = this.plan();
        if (!step) break;
        if (step === "bet" && this.think[1] > 0) {
          const [lo, hi] = this.think;
          await sleep(lo + (hi > lo ? randomInt(hi - lo + 1) : 0));
          if (this.stopped || !this.helloOk) break;
          step = this.plan(); // the world may have moved on while we "thought"
          if (step !== "bet") continue;
        }
        await this.act(step);
      }
    } catch (e) {
      this.fail(`bot crashed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      this.busy = false;
    }
  }

  private async act(step: Step): Promise<void> {
    const s = this.state!;
    const idx = this.stateIndex;
    let type: MessageType;
    let payload: object;
    const hand = step === "ready" ? 0 : s.handNumber; // SPEC §4.1: ready is hand 0, the rest carry the current hand

    if (step === "ready") {
      type = "ready"; payload = { ready: true };
    } else if (step === "checkpoint") {
      const cp = computeCheckpoint(s, this.weiPerChip); // our OWN engine decides what to sign
      if ("error" in cp) { this.fail(`computeCheckpoint failed: ${cp.error}`); this.holdUntil = idx; return; }
      const { checkpointHash, signature } = signCheckpoint(this.o.identity.sessionPrivateKey, cp);
      type = "checkpoint_sig"; payload = { checkpointNumber: cp.checkpointNumber, checkpointHash, signature };
      this.signed.add(hand); // optimistic: a second pump must not sign again while this one is in flight
    } else {
      const a = this.chooseAction(s);
      type = "bet_action";
      payload = a.amount === undefined ? { action: a.action } : { action: a.action, amount: a.amount };
      this.lastActedIndex = idx;
    }

    const ack = await this.sendEnvelope(type, payload, hand);
    if (!ack) { // no answer (connection died): hello resyncs the seq counter and re-plans from the fresh state
      if (step === "checkpoint") this.signed.delete(hand);
      return;
    }
    if (ack.ok) {
      if (step === "ready") this.sentReady = true;
      return;
    }
    const { code, message } = ack.reject;
    this.count(code);
    if (step === "checkpoint" && code !== "DUPLICATE") this.signed.delete(hand);
    if (step === "ready" && code === "DUPLICATE") this.sentReady = true;
    // A legal action must be accepted. NOT_YOUR_TURN / WRONG_STATE can be a harmless race with the turn clock.
    if (step === "bet" && (code === "ILLEGAL_ACTION" || code === "BAD_PAYLOAD")) this.fail(`legal action rejected: ${code} ${message}`);
    this.holdUntil = idx;
  }

  /** check/call 60%, fold 20%, raise 15%, all-in 5% (SPEC-2.1 C7). */
  private chooseAction(s: GameState): { action: ActionType; amount?: number } {
    const legal = legalActions(s, this.seat);
    if (!legal) return { action: "fold" }; // cannot happen: plan() only says "bet" on our turn
    const roll = randomInt(100);
    if (roll < 60) return { action: legal.canCheck ? "check" : "call" };
    if (roll < 80) return { action: "fold" };
    if (roll < 95) {
      const spread = Math.min(legal.maxRaiseTo - legal.minRaiseTo, 60); // keep raises modest so hands go on a while
      return { action: "raise", amount: legal.minRaiseTo + randomInt(spread + 1) }; // a TOTAL bet this street
    }
    return { action: "allin" };
  }

  private sign(type: MessageType, payload: object, handNumber: number, seq = this.seq): Envelope {
    return signEnvelope(this.o.identity.sessionPrivateKey, {
      tableId: this.o.tableId, handNumber, seq, sender: this.o.identity.wallet, seat: this.seat, type, payload,
    });
  }

  /** SPEC §4.1 rules 2 and 4: the counter moves only on ok; BAD_SEQ / DUPLICATE: adopt nextSeq and resend once. */
  private async sendEnvelope(type: MessageType, payload: object, handNumber: number): Promise<EnvelopeAck | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const env = this.sign(type, payload, handNumber);
      const ack = await this.call<EnvelopeAck>(cb => this.sock.emit("envelope", env, cb));
      if (!ack) return null;
      if (ack.ok) { this.seq++; this.lastEnv = env; return ack; }
      const { code, nextSeq } = ack.reject;
      if ((code === "BAD_SEQ" || code === "DUPLICATE") && nextSeq !== undefined && attempt === 0) {
        this.seq = nextSeq;
        continue;
      }
      return ack;
    }
    return null;
  }

  // ---------------------------------------------------------------- garbage mode (C8 manual testing)

  /** Junk the server must shrug off. Never anything that could be ACCEPTED: bad signatures, future seq, old seq. */
  private sendJunk(): void {
    if (this.stopped || !this.sock?.connected) return;
    const base = {
      tableId: this.o.tableId, handNumber: 1, seq: this.seq + 5, sender: this.o.identity.wallet, seat: this.seat,
      type: "bet_action", payload: { action: "fold" },
    };
    const pool: unknown[] = [
      undefined, null, 42, "garbage", [], {}, { tableId: this.o.tableId },
      { ...base, sig: "0x00" },                                           // BAD_SIG
      this.sign("bet_action", { action: "fold" }, 1, this.seq + 5),        // valid signature, seq gap: BAD_SEQ
      this.lastEnv,                                                        // replay of an accepted envelope: DUPLICATE
      { ...base, payload: { action: "teleport" }, sig: "0x" + "00".repeat(65) },
      { ...base, seat: 9 },
      { ...base, tableId: "999999999" },
    ];
    const raw = this.sock as unknown as { emit(ev: string, ...args: unknown[]): void };
    for (let i = 0; i < 2; i++) {
      // The first junk message always has a string tableId, so the server logs its reject.
      // Without this, a short game could send only unloggable junk and the rejects table stayed empty.
      const junk = this.junkSent++ === 0 ? { ...base, sig: "0x00" } : pool[randomInt(pool.length)];
      raw.emit("envelope", junk, (a: EnvelopeAck | undefined) => {
        if (a && a.ok === false) this.count(a.reject.code);
      });
    }
  }

  // ---------------------------------------------------------------- helpers

  /** emit-with-ack that always settles: null on timeout or when the connection dies. */
  private call<T>(emit: (cb: (a: T) => void) => void, ms = 8000): Promise<T | null> {
    return new Promise<T | null>(resolve => {
      let settled = false;
      const finish = (v: T | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pending.delete(cancel);
        resolve(v);
      };
      const cancel = () => finish(null);
      const timer = setTimeout(cancel, ms);
      this.pending.add(cancel);
      emit(a => finish(a));
    });
  }

  private cancelPending(): void { for (const c of [...this.pending]) c(); }
  private count(code: string): void { this.rejects[code] = (this.rejects[code] ?? 0) + 1; }
  private log(m: string): void { this.o.log?.(`[bot ${this.seat}] ${m}`); }
  private fail(m: string): void {
    if (this.failures.includes(m)) return;
    this.failures.push(m);
    this.log(`FAIL ${m}`);
  }
}

// ------------------------------------------------------------------------------------------------ a table of bots

export interface RunOptions {
  url: string;
  tableId: string;
  buyInWei: string;
  identities: BotIdentity[];
  think?: [number, number];
  stallSeats?: number[];
  garbageSeats?: number[];
  /** Give up after this long (default 10 minutes). */
  timeoutMs?: number;
  trafficFile?: string;
  log?: (msg: string) => void;
}

export interface BotsReport {
  /** True only if every bot saw `finished`, nobody timed out and no bot recorded a failure. */
  ok: boolean;
  finished: boolean;
  timedOut: boolean;
  failures: string[];
  /** Reject codes the server sent, summed over all bots. */
  rejects: Record<string, number>;
  hands: number;
}

export interface BotsRun {
  bots: Bot[];
  finished: Promise<BotsReport>;
  stop(): void;
}

export function startBots(o: RunOptions): BotsRun {
  const bots = o.identities.map(identity => new Bot({
    url: o.url, tableId: o.tableId, buyInWei: o.buyInWei, identity,
    think: o.think, trafficFile: o.trafficFile, log: o.log,
    mode: o.stallSeats?.includes(identity.seat) ? "stall" : o.garbageSeats?.includes(identity.seat) ? "garbage" : "normal",
  }));
  for (const b of bots) b.start();
  const stop = () => { for (const b of bots) b.stop(); };

  const finished = (async (): Promise<BotsReport> => {
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<void>(res => { timer = setTimeout(() => { timedOut = true; res(); }, o.timeoutMs ?? 600_000); });
    await Promise.race([Promise.all(bots.map(b => b.done)), limit]);
    clearTimeout(timer); // otherwise the command line would hang until the limit
    const allFinished = bots.every(b => b.sawFinished);
    await sleep(100); // let the last messages land so nothing is cut off mid-check
    stop();
    const rejects: Record<string, number> = {};
    for (const b of bots) for (const [k, v] of Object.entries(b.rejects)) rejects[k] = (rejects[k] ?? 0) + v;
    const failures = bots.flatMap(b => b.failures.map(f => `seat ${b.seat}: ${f}`));
    return {
      ok: allFinished && !timedOut && failures.length === 0,
      finished: allFinished, timedOut, failures, rejects,
      hands: Math.max(0, ...bots.map(b => b.handsSeen())),
    };
  })();

  return { bots, finished, stop };
}

export const runBots = (o: RunOptions): Promise<BotsReport> => startBots(o).finished;
