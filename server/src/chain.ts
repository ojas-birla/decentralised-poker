// server/src/chain.ts
// SPEC-2.1 §7 C3: watches the poker contract on Base Sepolia and mirrors table/seat/deposit events into SQLite.
// Bullet 1: provider + contract. Bullet 2 (this file now): cursor, chunked backfill, 3 s polling.
   // server/src/chain.ts
   // SPEC-2.1 §7 C3: watches the poker contract on Base Sepolia and mirrors TableCreated / PlayerJoined into SQLite.
   // Cursor in meta('lastBlock'), chunked backfill (2000 blocks), 3 s polling, idempotent handlers.
import { Contract, JsonRpcProvider, type Log, type Provider } from "ethers";
import { POKER_ABI, POKER_ADDRESS, POKER_CHAIN_ID, POKER_DEPLOY_BLOCK } from "@poker/shared";
import type { Seat } from "@poker/shared";
import type { Db } from "./db";
import { addPlayer, createGame, getMeta, getPlayer, loadGame, setDeposited, setMeta } from "./store";
import { RPC_URL } from "./env";

export const CURSOR_KEY = "lastBlock"; // meta table: last block that was fully processed
export const CHUNK_BLOCKS = 2000;      // public RPCs reject bigger getLogs ranges
export const POLL_MS = 3000;

export interface ChainHooks {
  /** Called once per table that changed in a chunk, AFTER the chunk and the cursor were saved. */
  onTableChanged(tableId: string): void;
}

/** Injected in tests (fake provider/contract, tiny chunks, fast polling); production passes nothing. */
export interface ChainDeps {
  provider?: Provider;
  contract?: Contract;
  deployBlock?: number;
  chunkBlocks?: number;
  pollMs?: number;
}

export interface ChainWatcher {
  provider: Provider;
  contract: Contract;
  /** Resolves once the first backfill finished (it never rejects; errors are logged and retried by the poll loop). */
  ready: Promise<void>;
  /** Catches up to the chain head once. Concurrent calls share one run. Tests call this instead of waiting on timers. */
  syncOnce(): Promise<void>;
  stop(): void;
}

/** Oldest first: (blockNumber, logIndex). RPCs usually return this order, but the spec requires us not to rely on it. */
export function sortLogs<T extends Pick<Log, "blockNumber" | "index">>(logs: readonly T[]): T[] {
  return [...logs].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
}

export function startChainWatcher(db: Db, hooks: ChainHooks, deps: ChainDeps = {}): ChainWatcher {
  const provider = deps.provider ?? new JsonRpcProvider(RPC_URL, POKER_CHAIN_ID, { staticNetwork: true });
  const contract = deps.contract ?? new Contract(POKER_ADDRESS, POKER_ABI, provider);
  const deployBlock = deps.deployBlock ?? POKER_DEPLOY_BLOCK;
  const chunkBlocks = Math.max(1, deps.chunkBlocks ?? CHUNK_BLOCKS);
  const pollMs = deps.pollMs ?? POLL_MS;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;

  /** Last fully processed block, or -1 if we never ran. */
  const readCursor = (): number => {
    const v = getMeta(db, CURSOR_KEY);
    const n = v === null ? NaN : Number(v);
    return Number.isSafeInteger(n) && n >= 0 ? n : -1;
  };

  /** Decodes one log and applies it. A bad or unknown log is logged and skipped, so it can never wedge the cursor. */
  function applyLog(log: Log, changed: Set<string>): void {
    let parsed;
    try {
      parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      return; // not one of our events
    }
    if (!parsed) return;
    try {
      if (parsed.name === "TableCreated") onTableCreated(parsed.args, changed);
      else if (parsed.name === "PlayerJoined") onPlayerJoined(parsed.args, changed);
      // TableStarted and anything else: ignored in 2.1
    } catch (e) {
      console.warn(`[chain] skipped ${parsed.name} at block ${log.blockNumber} log ${log.index}:`, e);
    }
  }

  // Bullet 3: TableCreated(tableId, creator, buyIn, handCount) -> a game row in "lobby".
  function onTableCreated(args: any, changed: Set<string>): void {
    const tableId = (args.tableId as bigint).toString();
    if (loadGame(db, tableId)) return; // already seen: replays are harmless
    createGame(db, {
      tableId,
      creator: args.creator as string,
      buyInWei: args.buyIn as bigint,
      totalHands: Number(args.handCount),
    });
    changed.add(tableId);
  }

  // Bullet 4: PlayerJoined(tableId, seat, wallet, sessionKey). The join transaction IS the deposit.
  // Bullet 5: every branch checks existing rows first, so replays and restarts mid-backfill give the same database.
  function onPlayerJoined(args: any, changed: Set<string>): void {
    const tableId = (args.tableId as bigint).toString();
    const seat = Number(args.seat);
    if (seat !== 0 && seat !== 1 && seat !== 2 && seat !== 3) throw new Error(`bad seat ${seat}`);
    if (!loadGame(db, tableId)) throw new Error(`PlayerJoined for unknown table ${tableId}`);
    const wallet = (args.wallet as string).toLowerCase();

    const existing = getPlayer(db, tableId, seat);
    if (!existing) {
      addPlayer(db, { tableId, seat: seat as Seat, wallet, sessionKey: args.sessionKey as string });
      setDeposited(db, tableId, seat);
      changed.add(tableId);
    } else if (existing.wallet !== wallet) {
      throw new Error(`seat ${seat} of table ${tableId} already belongs to ${existing.wallet}`);
    } else if (!existing.deposited) {
      setDeposited(db, tableId, seat); // seat existed but the deposit flag was missing
      changed.add(tableId);
    }
    // else: same wallet, already deposited: nothing to do
  }

  async function doSync(): Promise<void> {
    const head = await provider.getBlockNumber();
    const address = await contract.getAddress();
    let from = Math.max(deployBlock, readCursor() + 1);

    while (!stopped && from <= head) {
      const to = Math.min(from + chunkBlocks - 1, head);
      const logs = await provider.getLogs({ address, fromBlock: from, toBlock: to });

      const changed = new Set<string>();
      // One transaction: either the whole chunk AND its cursor are saved, or neither (a crash just redoes the chunk).
      db.transaction(() => {
        for (const log of sortLogs(logs)) applyLog(log, changed);
        setMeta(db, CURSOR_KEY, String(to));
      })();

      for (const tableId of changed) hooks.onTableChanged(tableId);
      from = to + 1;
    }
  }

  const syncOnce = (): Promise<void> => {
    if (!running) running = doSync().finally(() => { running = null; });
    return running;
  };

  const safeSync = async (): Promise<void> => {
    try { await syncOnce(); } catch (e) { console.error("[chain] sync failed, will retry:", e); }
  };

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(async () => { await safeSync(); schedule(); }, pollMs);
  };

  const ready = safeSync().then(schedule);

  return {
    provider,
    contract,
    ready,
    syncOnce,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (!deps.provider) (provider as JsonRpcProvider).destroy();
    },
  };
}