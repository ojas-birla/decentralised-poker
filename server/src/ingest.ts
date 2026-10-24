// server/src/ingest.ts
// Plan step 1.30: "every incoming event is validated by the engine before it is saved or sent on."
// Implements the six validation rules of SPEC §1, then saves the event and the new state atomically.
//
// ingest() is synchronous on purpose (better-sqlite3 is synchronous): two messages can never interleave,
// so the seq check and the state update cannot race.
import {
  applyAction,
  computeCheckpoint,
  isMessageAllowed,
} from "@poker/shared";
import type {
  BetActionPayload,
  Checkpoint,
  CheckpointSigPayload,
  Envelope,
  GameState,
  JoinPayload,
  MessageType,
  Reject,
  RejectCode,
} from "@poker/shared";
import type { Db } from "./db";
import { validatePayload } from "./payloads";
import { syncTurnTimer } from "./timers";
import {
  addCheckpointSig,
  appendEvent,
  getCheckpoint,
  getPlayer,
  insertCheckpoint,
  loadGame,
  logReject,
  markCheckpointComplete,
  saveState,
  setConnected,
  setLastSeq,
} from "./store";

export interface IngestDeps {
  /**
   * SPEC §1 rule 1: does env.sig recover to `sessionKey`? Must be shared/envelope.ts verifyEnvelope()
   * (SPEC: "implemented once ... nobody re-implements this"). Injected so this file does no hashing itself.
   */
  verifySig(env: Envelope, sessionKey: string): boolean;
  /**
   * Is `checkpointHash` the EIP-712 digest of `cp`, and does `signature` recover to `sessionKey`?
   * Must use the shared EIP-712 checkpoint code (SPEC §3). Required, so it cannot be forgotten.
   */
  verifyCheckpointSig(cp: Checkpoint, checkpointHash: string, signature: string, sessionKey: string): boolean;
  now?(): number;
}

export type IngestResult =
  | { ok: true; index: number; state: GameState; envelope: Envelope }
  | { ok: false; reject: Reject };

const MESSAGE_TYPES: readonly MessageType[] = [
  "join", "ready", "commit_padlock", "shuffle_step", "unlock_card",
  "bet_action", "reveal_padlock", "checkpoint_sig", "abandon_vote",
];

const PHASE3_ONLY: readonly MessageType[] = ["commit_padlock", "shuffle_step", "unlock_card", "reveal_padlock", "abandon_vote"];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

// SPEC §1 rule 4 and the §2 table: which handNumber each message type must carry.
function expectedHandNumber(type: MessageType, state: GameState): number {
  if (type === "join") return 0;
  if (type === "ready") return state.tableState === "settlement" ? state.handNumber + 1 : 0;
  return state.handNumber; // checkpoint_sig = the hand being settled; everything else = current hand
}

export function ingest(db: Db, deps: IngestDeps, raw: unknown): IngestResult {
  const now = deps.now ? deps.now() : Date.now();
  const rawObj: Record<string, unknown> = isObj(raw) ? raw : {};
  const refSeq = isInt(rawObj.seq) ? rawObj.seq : 0;

  const fail = (code: RejectCode, message: string, nextSeq?: number): IngestResult => {
    const reject: Reject = nextSeq === undefined ? { refSeq, code, message } : { refSeq, code, message, nextSeq };
    if (typeof rawObj.tableId === "string") {
      logReject(db, rawObj.tableId, isInt(rawObj.seat) ? rawObj.seat : null, raw, reject, now);
    }
    return { ok: false, reject };
  };

  // 0. Envelope shape (it arrives from the network).
  if (
    !isObj(raw) ||
    typeof raw.tableId !== "string" ||
    !isInt(raw.handNumber) || raw.handNumber < 0 ||
    !isInt(raw.seq) || raw.seq < 1 ||
    typeof raw.sender !== "string" ||
    !isInt(raw.seat) || raw.seat < 0 || raw.seat > 3 ||
    !MESSAGE_TYPES.includes(raw.type as MessageType) ||
    !isObj(raw.payload) ||
    typeof raw.sig !== "string"
  ) {
    return fail("BAD_PAYLOAD", "malformed envelope");
  }
  const env = raw as unknown as Envelope;

  const game = loadGame(db, env.tableId);
  if (!game) return fail("WRONG_STATE", "unknown table");
  const state = game.state;

  // Rule 2 (checked first because rule 1 needs the seat's session key): seat and sender must match the table.
  const player = getPlayer(db, env.tableId, env.seat);
  if (!player || player.wallet !== env.sender.toLowerCase()) {
    return fail("BAD_SEAT", "sender is not seated at this seat");
  }

  // Rule 1: signature recovers to the registered session key.
  if (!deps.verifySig(env, player.sessionKey)) return fail("BAD_SIG", "signature does not match the session key");

  // Rule 3: seq must be last accepted + 1. Duplicates are not applied; gaps are rejected.
  if (env.seq <= player.lastSeq) return fail("DUPLICATE", `seq ${env.seq} already seen`, player.lastSeq + 1);
  if (env.seq !== player.lastSeq + 1) return fail("BAD_SEQ", `expected seq ${player.lastSeq + 1}`, player.lastSeq + 1);
  // Rule 4: hand number.
  if (env.handNumber !== expectedHandNumber(env.type, state)) {
    return fail("WRONG_HAND", `expected hand ${expectedHandNumber(env.type, state)}`);
  }

  // Rule 5: type allowed in the current table state.
  if (!isMessageAllowed(state.tableState, env.type)) {
    return fail("WRONG_STATE", `${env.type} is not allowed in state ${state.tableState}`);
  }

  // C8 (Phase 2 only): while the server deals (state.deck is set) the padlock and abandon messages mean nothing.
  // Accepting them would let one client fill the log that every reconnect replays. Phase 3 has no dev deck: guard ends.
  if (state.deck !== null && PHASE3_ONLY.includes(env.type)) {
    return fail("WRONG_STATE", `${env.type} is not used while the server deals`);
  }

  // Rule 6: payload schema, then the engine.
  if (!validatePayload(env.type, env.payload, env.seat)) return fail("BAD_PAYLOAD", `bad ${env.type} payload`);

  let nextState: GameState = state;
  let markConnected = false;
  let cpStep: { cp: Checkpoint; hash: string; signature: string } | null = null;

  switch (env.type) {
    case "join": {
      const p = env.payload as JoinPayload;
      if (p.sessionKey.toLowerCase() !== player.sessionKey) {
        return fail("BAD_PAYLOAD", "session key does not match the one registered on-chain");
      }
      markConnected = true;
      nextState = structuredClone(state);
      nextState.seats[env.seat].connected = true;
      break;
    }
    case "bet_action": {
      const p = env.payload as BetActionPayload;
      const r = applyAction(state, env.seat, { type: p.action, amount: p.amount });
      if ("error" in r) return fail(r.error, `engine rejected ${p.action}: ${r.error}`);
      nextState = r;
      break;
    }
    case "checkpoint_sig": {
      const p = env.payload as CheckpointSigPayload;
      if (state.seats[env.seat].evicted) return fail("ILLEGAL_ACTION", "evicted seats do not sign");
      // The server recomputes the checkpoint with the shared engine; clients do the same before signing.
      const cp = computeCheckpoint(state, BigInt(game.meta.weiPerChip));
      if ("error" in cp) return fail(cp.error, `cannot build checkpoint: ${cp.error}`);
      if (p.checkpointNumber !== cp.checkpointNumber) {
        return fail("BAD_PAYLOAD", `expected checkpoint ${cp.checkpointNumber}`);
      }
      const existing = getCheckpoint(db, env.tableId, cp.checkpointNumber);
      if (existing) {
        if (existing.checkpointHash !== p.checkpointHash.toLowerCase()) {
          return fail("BAD_PAYLOAD", "checkpoint hash differs from the one already proposed");
        }
        if (existing.sigs[env.seat] !== undefined) return fail("DUPLICATE", "this seat already signed");
      }
      if (!deps.verifyCheckpointSig(cp, p.checkpointHash, p.signature, player.sessionKey)) {
        return fail("BAD_SIG", "checkpoint signature or hash is invalid");
      }
      cpStep = { cp, hash: p.checkpointHash, signature: p.signature };
      break;
    }
    default:
      // join/ready lifecycle (2.4) and the crypto messages (Phase 3) are relayed and logged only for now.
      break;
  }

  // Accepted: save the event, the sender's seq and the new state in ONE transaction.
  const index = db.transaction(() => {
    const idx = appendEvent(db, env.tableId, {
      kind: "envelope", handNumber: env.handNumber, seat: env.seat, seq: env.seq, type: env.type, body: env,
    }, now);
    setLastSeq(db, env.tableId, env.seat, env.seq);
    if (markConnected) setConnected(db, env.tableId, env.seat, true);

    if (cpStep) {
      const n = cpStep.cp.checkpointNumber;
      if (!getCheckpoint(db, env.tableId, n)) insertCheckpoint(db, env.tableId, cpStep.cp, env.handNumber, cpStep.hash, now);
      addCheckpointSig(db, env.tableId, n, env.seat, cpStep.signature);
      const row = getCheckpoint(db, env.tableId, n)!;
      const required = nextState.seats.filter(p => !p.evicted).map(p => p.seat);
      if (required.every(seat => row.sigs[seat] !== undefined)) {
        markCheckpointComplete(db, env.tableId, n);
        // SPEC §3: the number is stored on the state only once the checkpoint is fully signed.
        nextState = structuredClone(nextState);
        nextState.checkpointNumber = n;
      }
    }

    if (nextState !== state) {
      saveState(db, env.tableId, nextState, now);
      // Restart the clock for whoever acts next (or clear it). Never for `join`: a reconnect changes no game
      // state, and otherwise a stalling player could rejoin forever to reset their own 30 seconds.
      if (env.type !== "join") syncTurnTimer(db, env.tableId, nextState, now);
    }
    return idx;
  })();

  return { ok: true, index, state: nextState, envelope: env };
}