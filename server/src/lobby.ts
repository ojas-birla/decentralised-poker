// server/src/lobby.ts
// Plan step 1.32a: a small REST endpoint on the game server that lists open tables for the Next.js lobby page.
// "Open" = still in the lobby state, i.e. fewer than 4 seats filled on-chain (SPEC §4).
import express from "express";
import cors from "cors";
import type { Checkpoint, TableState } from "@poker/shared";
import type { Db } from "./db";
import { getPlayers, latestCompleteCheckpoint, loadGame } from "./store";

export interface OpenTable {
  tableId: string;       // decimal string
  creator: string;       // lowercase wallet
  buyInWei: string;      // decimal string, never a JS number
  totalHands: number;
  seatsTaken: number;
  seats: { seat: number; wallet: string }[];
  createdAt: number;     // unix ms
}

/** Newest first. Only public facts: no session keys, no game state. */
export function listOpenTables(db: Db, limit = 50): OpenTable[] {
  const games = db.prepare(
    `SELECT table_id, creator, buy_in_wei, total_hands, created_at
       FROM games WHERE table_state = 'lobby'
       ORDER BY created_at DESC, rowid DESC LIMIT ?`
  ).all(limit) as { table_id: string; creator: string; buy_in_wei: string; total_hands: number; created_at: number }[];
  if (games.length === 0) return [];

  const marks = games.map(() => "?").join(",");
  const players = db.prepare(
    `SELECT table_id, seat, wallet FROM players WHERE table_id IN (${marks}) ORDER BY seat`
  ).all(...games.map(g => g.table_id)) as { table_id: string; seat: number; wallet: string }[];

  return games.map(g => {
    const seats = players.filter(p => p.table_id === g.table_id).map(p => ({ seat: p.seat, wallet: p.wallet }));
    return {
      tableId: g.table_id,
      creator: g.creator,
      buyInWei: g.buy_in_wei,
      totalHands: g.total_hands,
      seatsTaken: seats.length,
      seats,
      createdAt: g.created_at,
    };
  });
}

// ---- SPEC-2.1 §4.2: one table, and its latest fully signed checkpoint ----

export interface TableInfo {
  tableId: string;
  state: TableState;
  buyInWei: string;
  totalHands: number;
  handNumber: number;
  seats: { seat: number; wallet: string; deposited: boolean; connected: boolean }[];
}

/** Public facts about one table. No session keys, no game state blob (so no deck and no hole cards). Null if unknown. */
export function getTableInfo(db: Db, tableId: string): TableInfo | null {
  if (!/^\d+$/.test(tableId)) return null;
  const game = loadGame(db, tableId);
  if (!game) return null;
  return {
    tableId,
    state: game.state.tableState,
    buyInWei: game.meta.buyInWei,
    totalHands: game.meta.totalHands,
    handNumber: game.state.handNumber,
    seats: getPlayers(db, tableId).map(p => ({ seat: p.seat, wallet: p.wallet, deposited: p.deposited, connected: p.connected })),
  };
}

export interface CheckpointInfo {
  checkpoint: Checkpoint;
  hash: string;
  /** One entry per seat 0..3: the signature, or null if that seat has not signed (evicted seats stay null). */
  sigs: (string | null)[];
}

/** The newest checkpoint that every non-evicted seat has signed: what gets submitted on-chain in step 2.7. */
export function getLatestCheckpoint(db: Db, tableId: string): CheckpointInfo | null {
  if (!/^\d+$/.test(tableId)) return null;
  const row = latestCompleteCheckpoint(db, tableId);
  if (!row) return null;
  return {
    checkpoint: {
      tableId: row.tableId,
      checkpointNumber: row.checkpointNumber,
      balances: row.balances as Checkpoint["balances"],
      evicted: row.evicted as Checkpoint["evicted"],
    },
    hash: row.checkpointHash,
    sigs: [0, 1, 2, 3].map(seat => row.sigs[seat] ?? null),
  };
}

export interface AppOptions {
  /** Browser origins allowed to call the API, e.g. ["http://localhost:3000"] (the Next.js app). */
  allowedOrigins: string[];
}

export function createApp(db: Db, opts: AppOptions): express.Express {
  const app = express();
  app.disable("x-powered-by");
  // Origins not in the list get no CORS headers, so the browser blocks them. (Plan: Next.js on 3000, server on 4000.)
  app.use(cors({ origin: opts.allowedOrigins, methods: ["GET"] }));

  app.get("/api/tables", (_req, res) => {
    res.set("Cache-Control", "no-store"); // the lobby must never show a stale list
    res.json({ tables: listOpenTables(db) });
  });

  app.get("/api/tables/:id", (req, res) => {
    res.set("Cache-Control", "no-store");
    const info = getTableInfo(db, req.params.id);
    if (!info) { res.status(404).json({ error: "unknown table" }); return; }
    res.json(info);
  });

  app.get("/api/tables/:id/checkpoint", (req, res) => {
    res.set("Cache-Control", "no-store");
    const cp = getLatestCheckpoint(db, req.params.id);
    if (!cp) { res.status(404).json({ error: "no complete checkpoint for this table" }); return; }
    res.json(cp);
  });

  return app;
}