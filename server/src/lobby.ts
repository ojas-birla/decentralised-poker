// server/src/lobby.ts
// Plan step 1.32a: a small REST endpoint on the game server that lists open tables for the Next.js lobby page.
// "Open" = still in the lobby state, i.e. fewer than 4 seats filled on-chain (SPEC §4).
import express from "express";
import cors from "cors";
import type { Db } from "./db";

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

  return app;
}