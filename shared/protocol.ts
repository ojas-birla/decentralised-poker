// shared/protocol.ts
// SPEC §7: the socket.io wire protocol. Types only, no runtime code. Server and web both import from here.
import type { AbortReason, Envelope, Reject } from "./types";
import type { GameState, Seat } from "./engine/types";

export const PROTOCOL_VERSION = 1;

// ---- shared copies of types that used to live only in server/ (server must import these instead) ----
export interface EventRow {
  index: number;                     // position in the table's log, from 0
  kind: "envelope" | "server";
  handNumber: number;
  body: Envelope | ServerLogBody;    // kind "envelope" => Envelope, kind "server" => ServerLogBody
}
export interface PlayerPresence { seat: Seat; wallet: string; connected: boolean }
export interface TimerInfo { seat: Seat; deadline: number }  // deadline = unix ms
export interface ReconnectView {
  seat: Seat;
  state: GameState;                  // already passed through publicState(state, seat)
  events: EventRow[];
  fromIndex: number;
  nextSeq: number;                   // seq for this client's NEXT envelope
  timer: TimerInfo | null;
  players: PlayerPresence[];
  lastIndex: number;                 // index of the newest log entry (-1 if empty); `state` reflects the log up to here
}

// ---- client -> server (socket.io emit with an ack callback) ----
export interface HelloRequest {
  joinEnvelope: Envelope;            // signed `join`, handNumber 0
  fromIndex: number;                 // first log index the client is missing (0 = everything)
}
export type HelloAck =
  | { ok: true; view: ReconnectView }
  | { ok: false; reject: Reject };

export type EnvelopeAck =
  | { ok: true; index: number }      // index of the accepted entry in the log
  | { ok: false; reject: Reject };

// ---- server -> client events (no ack) ----
// "state": sent PER SEAT, already through publicState(). `index` = log index it reflects. Drop it if index < the one you hold.
export interface StateMsg { tableId: string; index: number; state: GameState }
// "event": every new log entry, to everyone at the table, in index order.
export interface EventMsg { tableId: string; entry: EventRow }
// "timer": whose clock is running. seat = null means no clock.
export interface TimerMsg { tableId: string; seat: Seat | null; deadline: number | null; handNumber: number }
// "auto": the clock expired and the server applied fold/check. Followed by an `event` and a `state`.
export interface AutoMsg { tableId: string; index: number; seat: Seat; action: "fold" | "check"; handNumber: number }
// "presence": a seat connected or disconnected.
export interface PresenceMsg { tableId: string; seat: Seat; connected: boolean }
// "abort": a hand was aborted (also appears in the log).
export interface AbortMsg { tableId: string; handNumber: number; reason: AbortReason }

// Server-written log entries (kind "server"). Unsigned. They must NEVER contain cards or the dev deck.
export type ServerLogBody =
  | { kind: "auto"; seat: Seat; action: "fold" | "check"; handNumber: number }
  | { kind: "table_state"; state: GameState["tableState"] }
  | { kind: "hand_started"; handNumber: number; dealerSeat: Seat }
  | { kind: "street"; handNumber: number; street: "flop" | "turn" | "river" }
  | { kind: "hand_settled"; handNumber: number; awards: GameState["awards"] }
  | { kind: "abort"; handNumber: number; reason: AbortReason };

export interface ServerToClientEvents {
  state: (m: StateMsg) => void;
  event: (m: EventMsg) => void;
  timer: (m: TimerMsg) => void;
  auto: (m: AutoMsg) => void;
  presence: (m: PresenceMsg) => void;
  abort: (m: AbortMsg) => void;
}
export interface ClientToServerEvents {
  hello: (req: HelloRequest, ack: (a: HelloAck) => void) => void;
  envelope: (env: Envelope, ack: (a: EnvelopeAck) => void) => void;
}