// server/src/reconnect.ts
// Plan step 1.32: a returning player (same wallet, same session key) gets the full event log and rebuilds their view.
//
// Authentication is a signed `join` envelope, validated by the normal ingest() pipeline (signature, seat, seq, hand 0,
// registered session key). So reconnecting needs no new message type, and the client's seq counter stays in step.
// SPEC §4 must allow `join` in every state except `aborted` (see shared/states.ts).
import type { GameState, Reject, Seat } from "@poker/shared";
import type { Db } from "./db";
import { ingest, type IngestDeps } from "./ingest";
import { getEvents, getPlayer, getPlayers, loadGame, saveState, setConnected, type EventRow } from "./store";
import { getTimer } from "./timers";

export interface PlayerPresence {
  seat: Seat;
  wallet: string;
  connected: boolean;
}

export interface ReconnectView {
  seat: Seat;
  /** Safe snapshot for THIS seat: see publicState(). */
  state: GameState;
  /** Log entries from `fromIndex` on, in order (SPEC §1). */
  events: EventRow[];
  fromIndex: number;
  /** The seq the client must use for its next message (the server's count, not the client's own). */
  nextSeq: number;
  /** Whose clock is running and when it ends (unix ms), or null. */
  timer: { seat: Seat; deadline: number } | null;
  players: PlayerPresence[];
}

export type ReconnectResult =
  | { ok: true; index: number; view: ReconnectView }
  | { ok: false; reject: Reject };

/**
 * What a client may see. The Phase 2 dev deck must never reach a client, and other players' hole cards stay hidden.
 * (Showdown reveals arrive through reveal_padlock events in Phase 3, not through this snapshot.)
 */
export function publicState(state: GameState, seat: Seat): GameState {
  const s = structuredClone(state);
  s.deck = null;
  s.holeCards = s.holeCards.map((cards, i) => (i === seat ? cards : [])) as GameState["holeCards"];
  return s;
}

export function buildView(db: Db, tableId: string, seat: Seat, fromIndex = 0): ReconnectView | null {
  const game = loadGame(db, tableId);
  const player = getPlayer(db, tableId, seat);
  if (!game || !player) return null;
  const from = Number.isSafeInteger(fromIndex) && fromIndex >= 0 ? fromIndex : 0;
  const timer = getTimer(db, tableId);
  return {
    seat,
    state: publicState(game.state, seat),
    events: getEvents(db, tableId, from),
    fromIndex: from,
    nextSeq: player.lastSeq + 1,
    timer: timer ? { seat: timer.seat, deadline: timer.deadline } : null,
    players: getPlayers(db, tableId).map(p => ({ seat: p.seat, wallet: p.wallet, connected: p.connected })),
  };
}

/** Handles a reconnect request: a signed `join` envelope, plus the log index the client already has (0 = everything). */
export function reconnect(db: Db, deps: IngestDeps, raw: unknown, fromIndex = 0): ReconnectResult {
  if (typeof raw !== "object" || raw === null || (raw as { type?: unknown }).type !== "join") {
    return { ok: false, reject: { refSeq: 0, code: "BAD_PAYLOAD", message: "reconnect requires a signed join envelope" } };
  }
  const r = ingest(db, deps, raw);
  if (!r.ok) return r;
  const view = buildView(db, r.envelope.tableId, r.envelope.seat, fromIndex)!;
  return { ok: true, index: r.index, view };
}

/** Call when a player's socket closes. Presence is not part of the event log; the socket layer broadcasts it. */
export function disconnect(db: Db, tableId: string, seat: Seat): void {
  db.transaction(() => {
    setConnected(db, tableId, seat, false);
    const game = loadGame(db, tableId);
    if (game) {
      game.state.seats[seat].connected = false;
      saveState(db, tableId, game.state);
    }
  })();
}

/** Call once at server start: every socket died with the old process, so nobody is connected yet. */
export function resetAllConnected(db: Db): void {
  db.transaction(() => {
    db.prepare("UPDATE players SET connected = 0").run();
    const ids = db.prepare("SELECT table_id FROM games").all() as { table_id: string }[];
    for (const { table_id } of ids) {
      const game = loadGame(db, table_id);
      if (game && game.state.seats.some(p => p.connected)) {
        game.state.seats.forEach(p => { p.connected = false; });
        saveState(db, table_id, game.state);
      }
    }
  })();
}