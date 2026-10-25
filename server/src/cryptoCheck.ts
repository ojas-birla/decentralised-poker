// server/src/cryptoCheck.ts
// SPEC-PHASE3 C-4: game-rule checks for the four padlock messages (commit_padlock, shuffle_step,
// unlock_card, reveal_padlock). payloads.ts already checked the SHAPE; this file decides whether the
// message makes sense RIGHT NOW: right sender, right order, a card that is actually waiting, real curve points.
//
// The order rules are not written a second time here. deriveDealing() (shared/crypto/dealingView.ts, Person B)
// silently ignores any message that is out of turn or from the wrong sender, and clients use the same function.
// So: replay the log with and without the new message. If the result is identical, the message was ignored,
// and the server rejects it.
import { deriveDealing, type DealingView } from "@poker/shared/crypto/dealingView";
import { isValidPointHex } from "@poker/shared/crypto/padlock"; // <- adjust this path to wherever B put isValidPointHex
import type { Envelope, EventRow as SharedEventRow, GameState, RejectCode } from "@poker/shared";
import type { Db } from "./db";
import { getEvents } from "./store";

export interface CryptoReject {
  code: RejectCode;
  message: string;
}

const no = (code: RejectCode, message: string): CryptoReject => ({ code, message });

// What "the view changed" means. deriveDealing creates an EMPTY unlock entry (chain: []) even for an unlock it
// then ignores because it is out of turn. An empty chain is not progress, so it must not count as a change.
function fingerprint(v: DealingView): string {
  const unlocks = Object.entries(v.unlocks).filter(([, u]) => u.chain.length > 0);
  return JSON.stringify({ ...v, unlocks });
}

/** Pure part (no database): easy to test. `rows` is the event log of this table. */
export function checkCryptoMessage(o: {
  state: GameState;
  rows: readonly SharedEventRow[];
  env: Envelope;
  isValidPoint: (hex: string) => boolean;
}): CryptoReject | null {
  const { state, rows, env, isValidPoint } = o;
  const p = env.payload as any; // the shape was already checked by validatePayload

  // D2: only seats that are in this hand take part. A busted seat never sends crypto messages.
  const active = state.seats.filter(s => s.inHand).map(s => s.seat);
  if (!active.includes(env.seat)) return no("ILLEGAL_ACTION", "this seat is not playing this hand");

  switch (env.type) {
    case "shuffle_step": {
      const deck = p.deck as string[];
      if (!deck.every(isValidPoint)) return no("BAD_PAYLOAD", "shuffle deck contains an invalid curve point");
      if (new Set(deck).size !== deck.length) return no("BAD_PAYLOAD", "shuffle deck contains a repeated point");
      break;
    }
    case "unlock_card": {
      if (!isValidPoint(p.value)) return no("BAD_PAYLOAD", "unlock value is not a valid curve point");
      // D5: nobody may reveal a card the table is not waiting for (for example the flop before betting is over).
      if (!state.needsCards || !state.needsCards.includes(p.cardIndex)) {
        return no("ILLEGAL_ACTION", `card ${p.cardIndex} is not waiting for unlocks`);
      }
      break;
    }
    case "reveal_padlock": {
      if (state.seats[env.seat].hasFolded) return no("ILLEGAL_ACTION", "folded seats do not reveal");
      break;
    }
    default:
      break; // commit_padlock: the shape check was enough; ordering is checked below
  }

  // Order, sender and duplicates: did deriveDealing accept the message?
  const candidate: SharedEventRow = { index: rows.length, kind: "envelope", handNumber: env.handNumber, body: env };
  const before = deriveDealing(rows, state.handNumber, active, state.dealerSeat);
  const after = deriveDealing([...rows, candidate], state.handNumber, active, state.dealerSeat);
  if (fingerprint(before) === fingerprint(after)) {
    return no("ILLEGAL_ACTION", `${env.type} is out of turn, repeated, or not expected from this seat`);
  }
  return null;
}

/** Database part: loads this hand's log and runs the pure check. null = accept. */
export function checkCrypto(db: Db, state: GameState, env: Envelope): CryptoReject | null {
  const rows = getEvents(db, env.tableId).filter(e => e.handNumber === env.handNumber) as SharedEventRow[];
  return checkCryptoMessage({ state, rows, env, isValidPoint: isValidPointHex });
}