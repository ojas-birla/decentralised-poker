// server/src/db.ts
// Plan step 1.30: SQLite tables for games, players, the event log and checkpoints.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  table_id      TEXT PRIMARY KEY,              -- on-chain id, decimal string
  creator       TEXT NOT NULL,                 -- lowercase wallet
  buy_in_wei    TEXT NOT NULL,                 -- decimal string, never a JS number
  wei_per_chip  TEXT NOT NULL,                 -- buy_in_wei / 1000
  total_hands   INTEGER NOT NULL,
  table_state   TEXT NOT NULL,                 -- copy of state.tableState, for cheap lobby queries
  state_json    TEXT NOT NULL,                 -- full engine GameState, so a restart can resume
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  table_id     TEXT NOT NULL REFERENCES games(table_id),
  seat         INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 3),
  wallet       TEXT NOT NULL,                  -- lowercase
  session_key  TEXT NOT NULL,                  -- lowercase address registered on-chain at join
  deposited    INTEGER NOT NULL DEFAULT 0,     -- 1 once the deposit event is seen on-chain
  last_seq     INTEGER NOT NULL DEFAULT 0,     -- last ACCEPTED seq from this sender (SPEC §1 rule 3)
  connected    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (table_id, seat),
  UNIQUE (table_id, wallet)
);

-- The single source of truth (SPEC §1): accepted envelopes and server events, indexed from 0.
CREATE TABLE IF NOT EXISTS events (
  table_id     TEXT NOT NULL REFERENCES games(table_id),
  idx          INTEGER NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('envelope', 'server')),
  hand_number  INTEGER NOT NULL,
  seat         INTEGER,
  seq          INTEGER,
  type         TEXT,
  body_json    TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (table_id, idx)
);
-- A sender can never have two log entries with the same seq.
CREATE UNIQUE INDEX IF NOT EXISTS events_sender_seq
  ON events (table_id, seat, seq) WHERE kind = 'envelope';

-- Rejected messages are logged here (plan 4.6) but never enter the event log.
CREATE TABLE IF NOT EXISTS rejects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id    TEXT NOT NULL,
  seat        INTEGER,
  ref_seq     INTEGER NOT NULL,
  code        TEXT NOT NULL,
  message     TEXT NOT NULL,
  raw_json    TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- One running clock per table (plan 1.31). The deadline is stored so a restart does not lose it.
CREATE TABLE IF NOT EXISTS timers (
  table_id     TEXT PRIMARY KEY REFERENCES games(table_id),
  kind         TEXT NOT NULL,                  -- 'turn' now; crypto-stall timers (4.3) will reuse the table
  seat         INTEGER NOT NULL,               -- whose clock is running
  hand_number  INTEGER NOT NULL,
  deadline     INTEGER NOT NULL                -- unix ms
);
CREATE INDEX IF NOT EXISTS timers_deadline ON timers (deadline);

CREATE TABLE IF NOT EXISTS checkpoints (
  table_id           TEXT NOT NULL REFERENCES games(table_id),
  checkpoint_number  INTEGER NOT NULL,
  hand_number        INTEGER NOT NULL,
  balances_json      TEXT NOT NULL,            -- 4 decimal strings (wei)
  evicted_json       TEXT NOT NULL,            -- 4 booleans
  checkpoint_hash    TEXT NOT NULL,            -- EIP-712 digest proposed by the first signer
  complete           INTEGER NOT NULL DEFAULT 0, -- 1 once every non-evicted seat has signed
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (table_id, checkpoint_number)
);

-- Small key/value store. The chain watcher keeps its cursor here (key 'lastBlock').
CREATE TABLE IF NOT EXISTS meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoint_sigs (
  table_id           TEXT NOT NULL,
  checkpoint_number  INTEGER NOT NULL,
  seat               INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 3),
  signature          TEXT NOT NULL,
  PRIMARY KEY (table_id, checkpoint_number, seat),
  FOREIGN KEY (table_id, checkpoint_number) REFERENCES checkpoints(table_id, checkpoint_number)
);
`;

/** Opens (and creates, if needed) the database. Use ":memory:" in tests. */
export function openDb(file = ":memory:"): Db {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true }); // DB_PATH defaults to ./data/game.db
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}