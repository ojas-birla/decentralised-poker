import { ingest, type IngestDeps, type IngestResult } from "../ingest";
import type { ChainWatcher } from "./watcher";

/** True when a join failed only because the server hasn't read the chain event yet. */
function looksLikeChainLag(raw: unknown, res: IngestResult): boolean {
  if (res.ok) return false;
  const type = (raw as { type?: unknown } | null)?.type;
  if (type !== "join") return false;
  return res.reject.code === "BAD_SEAT" || res.reject.message === "unknown table";
}

/** Use this in the socket handler instead of calling ingest() directly. */
export async function ingestWithChainSync(
  db: Parameters<typeof ingest>[0],
  deps: IngestDeps,
  raw: unknown,
  watcher: Pick<ChainWatcher, "syncNow">
): Promise<IngestResult> {
  const first = ingest(db, deps, raw);
  if (!looksLikeChainLag(raw, first)) return first;
  try {
    await watcher.syncNow();
  } catch {
    return first; // the RPC is down, so keep the original rejection
  }
  return ingest(db, deps, raw); // a rejected message never consumed its seq, so the retry is safe
}
