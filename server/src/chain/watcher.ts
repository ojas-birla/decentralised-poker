import { Contract, JsonRpcProvider } from "ethers";
import type { Db } from "../db";
import { POKER_ABI, POKER_ADDRESS, POKER_CHAIN_ID, POKER_DEPLOY_BLOCK } from "../../../shared/contract";
import { decodeLog, type ChainEvent } from "./events";
import { getCursor, initChainTables, processBatch, type ApplyResult } from "./apply";

/** The slice of a provider the watcher needs, so tests can pass a fake chain. */
export interface LogSource {
  getBlockNumber(): Promise<number>;
  getLogs(f: { address: string; fromBlock: number; toBlock: number }): Promise<Parameters<typeof decodeLog>[0][]>;
  destroy?(): void;
}

export interface WatcherOptions {
  db: Db;
  rpcUrl?: string;
  source?: LogSource;      // overrides rpcUrl (tests)
  address?: string;        // defaults to the deployed address in shared/contract.ts
  startBlock?: number;     // defaults to POKER_DEPLOY_BLOCK
  pollMs?: number;         // default 3000
  confirmations?: number;  // default 2 blocks behind the head, in case of a small reorg
  maxRange?: number;       // blocks per getLogs call, default 200, shrinks automatically if the RPC says it is too big
  onApplied?: (ev: ChainEvent, result: ApplyResult) => void; // C hooks his socket broadcast in here
  log?: (msg: string) => void;
}

export class ChainWatcher {
  readonly provider: LogSource;
  private readonly db: Db;
  private readonly address: string;
  private readonly startBlock: number;
  private readonly pollMs: number;
  private readonly confirmations: number;
  private maxRange: number;
  private readonly onApplied?: (ev: ChainEvent, result: ApplyResult) => void;
  private readonly log: (msg: string) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private inFlight: Promise<number> | null = null;

  constructor(o: WatcherOptions) {
    this.db = o.db;
    if (o.source) this.provider = o.source;
    else if (o.rpcUrl) this.provider = new JsonRpcProvider(o.rpcUrl, POKER_CHAIN_ID, { staticNetwork: true }) as unknown as LogSource;
    else throw new Error("ChainWatcher needs rpcUrl or source");
    this.address = o.address ?? POKER_ADDRESS;
    this.startBlock = o.startBlock ?? POKER_DEPLOY_BLOCK;
    this.pollMs = o.pollMs ?? 3000;
    this.confirmations = o.confirmations ?? 2;
    this.maxRange = o.maxRange ?? 200;
    this.onApplied = o.onApplied;
    this.log = o.log ?? (() => {});
    initChainTables(this.db);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      let delay = this.pollMs;
      try {
        await this.pollOnce();
      } catch (e) {
        this.log(`poll failed, will retry: ${e instanceof Error ? e.message : String(e)}`);
        delay = Math.min(this.pollMs * 4, 15000); // back off when the RPC is unhappy
      }
      if (this.running) this.timer = setTimeout(tick, delay);
    };
    void tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.provider.destroy?.();
  }

  /**
   * One pass. `confirmations` can be lowered to read the newest blocks, but the cursor never passes the safe
   * point. Passes are serialised: a second call waits for the one in flight, so the timer and a socket-triggered
   * syncNow() can never interleave.
   */
  pollOnce(confirmations = this.confirmations): Promise<number> {
    const run = async () => {
      if (this.inFlight) await this.inFlight.catch(() => {});
      return this.pass(confirmations);
    };
    const p = run();
    this.inFlight = p;
    const clear = () => { if (this.inFlight === p) this.inFlight = null; };
    p.then(clear, clear);
    return p;
  }

  private async pass(confirmations: number): Promise<number> {
    const latest = await this.provider.getBlockNumber();
    const readTo = latest - confirmations;            // how far we read
    const cursorLimit = latest - this.confirmations;  // how far the cursor may move
    // Blocks above the cursor limit are re-read next poll, so read from the cursor, not from the last read.
    let from = getCursor(this.db, this.startBlock) + 1;
    let handled = 0;
    let batches = 0;
    while (from <= readTo) {
      const to = Math.min(from + this.maxRange - 1, readTo);
      let logs;
      try {
        logs = await this.provider.getLogs({ address: this.address, fromBlock: from, toBlock: to });
      } catch (e) {
        // Public RPCs cap the getLogs range (Base Sepolia: 200). Shrink and retry the same start block.
        const msg = e instanceof Error ? e.message : String(e);
        const limit = /limited to a (\d+) range|range.*?(\d+)/i.exec(msg);
        const next = limit ? Number(limit[1] ?? limit[2]) : Math.floor(this.maxRange / 2);
        if (Number.isFinite(next) && next >= 1 && next < this.maxRange) {
          this.log(`RPC range limit hit, using ${next} blocks per request`);
          this.maxRange = next;
          continue;
        }
        throw e;
      }
      if (++batches % 200 === 0) this.log(`catching up: block ${to} of ${readTo}`);
      const events = logs.map((l) => decodeLog(l)).filter((e): e is ChainEvent => e !== null);
      for (const { ev, result } of processBatch(this.db, events, Math.min(to, cursorLimit))) {
        if (result.status === "duplicate") continue;
        handled++;
        if (result.status === "error") this.log(`event error (${ev.type} table ${ev.tableId}): ${result.note}`);
        this.onApplied?.(ev, result);
      }
      from = to + 1;
    }
    return handled;
  }

  /** Reads right up to the newest block. The cursor stays behind, so the normal poll re-reads those blocks later (repeats are ignored). */
  syncNow(): Promise<number> {
    return this.pollOnce(0);
  }
}

/**
 * Reads a table straight from the contract. This is authoritative, so use it to check a `join`
 * message when the watcher hasn't caught up yet. status: 0 none, 1 open, 2 started, 3 cancelled, 4 finalized, 5 refunded.
 */
export async function readTableOnChain(provider: JsonRpcProvider, tableId: string, address: string = POKER_ADDRESS) {
  const c = new Contract(address, POKER_ABI, provider);
  const t = await c.getTable(tableId);
  return {
    status: Number(t.status),
    seatsFilled: Number(t.seatsFilled),
    buyInWei: (t.buyIn as bigint).toString(),
    players: (t.players as string[]).map((p) => p.toLowerCase()),
    sessionKeys: (t.sessionKeys as string[]).map((p) => p.toLowerCase()),
  };
}
