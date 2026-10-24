// server/src/payloads.ts
// SPEC §1 rule 6, first half: the payload must pass the type's schema. Pure shape checks, no game rules.
import type { MessageType } from "@poker/shared";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const inRange = (v: unknown, lo: number, hi: number): v is number => isInt(v) && v >= lo && v <= hi;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const POINT_OR_SCALAR = /^[0-9a-f]{64}$/;// 32 bytes (crypto module; 0x mandator until Person B fixed the format)
const HASH32 = /^0x[0-9a-fA-F]{64}$/;
const SIG65 = /^0x[0-9a-fA-F]{130}$/;

const isHex32 = (v: unknown): v is string => typeof v === "string" && POINT_OR_SCALAR.test(v);
/** commitPadlock() (Person B) returns "0x" + keccak256 hex. Accept it with or without the 0x. */
const COMMITMENT = /^(0x)?[0-9a-fA-F]{64}$/;

export function validatePayload(type: MessageType, payload: unknown, senderSeat: number): boolean {
  if (!isObj(payload)) return false;
  switch (type) {
    case "join":
      return typeof payload.sessionKey === "string" && ADDRESS.test(payload.sessionKey);
    case "ready":
      return payload.ready === true;
        case "commit_padlock":
      return typeof payload.commitment === "string" && COMMITMENT.test(payload.commitment);
    case "shuffle_step":
      // step = the sender's INDEX in the active-seat order, not the seat number (SPEC-PHASE3 D3).
      // Whether it is this sender's turn is a game rule: cryptoCheck.ts decides that.
      return (
        inRange(payload.step, 0, 3) &&
        Array.isArray(payload.deck) &&
        payload.deck.length === 52 &&
        payload.deck.every(isHex32)
      );
    case "unlock_card":
      return (
        inRange(payload.cardIndex, 0, 51) &&
        (payload.forSeat === "board" || inRange(payload.forSeat, 0, 3)) &&
        isHex32(payload.value)
      );
    case "bet_action":
      if (!["fold", "check", "call", "raise", "allin"].includes(payload.action as string)) return false;
      // amount only exists for raise; the engine checks that it is a legal integer.
      return payload.action === "raise" ? typeof payload.amount === "number" : payload.amount === undefined;
    case "reveal_padlock":
      return isHex32(payload.padlock);
    case "checkpoint_sig":
      return (
        isInt(payload.checkpointNumber) &&
        payload.checkpointNumber >= 1 &&
        typeof payload.checkpointHash === "string" && HASH32.test(payload.checkpointHash) &&
        typeof payload.signature === "string" && SIG65.test(payload.signature)
      );
    case "abandon_vote":
      return (
        inRange(payload.accusedSeat, 0, 3) &&
        payload.accusedSeat !== senderSeat &&
        (payload.reason === "TIMEOUT" || payload.reason === "DISCONNECTED")
      );
    default:
      return false;
  }
}