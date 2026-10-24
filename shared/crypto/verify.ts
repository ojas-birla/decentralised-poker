
import {
  to32Hex,
  from32Hex,
  commitPadlock,
  unlockCard,
  type Padlock,
} from './padlock.ts';
import { CARD_POINTS, POINT_TO_INDEX } from './cards.ts';

export type RevealFailure =
  | 'BAD_COMMITMENT' // padlock does not match the published commitment
  | 'NOT_A_CARD'     // after unlocking, the point is not one of the 52 cards
  | 'WRONG_CARD';    // after unlocking, the point is a card but not the claimed one

export type RevealResult =
  | { ok: true }
  | { ok: false; reason: RevealFailure };

/**
 * Verify one `reveal_padlock` message at showdown.
 *
 * @param revealedPadlockHex  32-byte hex scalar, from `reveal_padlock.padlock`
 * @param commitmentHex       hex hash, from the earlier `commit_padlock.commitment`
 * @param tableId             decimal string, same as `envelope.tableId`
 * @param handNumber          integer, same as `envelope.handNumber`
 * @param lockedCardHex       curve point (hex) the player was dealt, i.e. this
 *                            card's value in the deck after all 4 shuffle steps
 * @param claimedCardIndex    0..51, the card the player's engine says they held
 */
export function verifyReveal(params: {
  revealedPadlockHex: string;
  commitmentHex: string;
  tableId: string;
  handNumber: number;
  lockedCardHex: string;
  claimedCardIndex: number;
}): RevealResult {
  // 0. Basic shape checks — fail as "NOT_A_CARD" because a bad index / bad hex
  //    scalar is a malformed reveal, not a wrong one; either way the hand aborts
  //    with BAD_REVEAL and the caller's abort mapping is the same.
  if (
    !Number.isInteger(params.claimedCardIndex) ||
    params.claimedCardIndex < 0 ||
    params.claimedCardIndex >= CARD_POINTS.length
  ) {
    return { ok: false, reason: 'NOT_A_CARD' };
  }

 let padlock: Padlock;
try {
  const scalar = from32Hex(params.revealedPadlockHex);
  padlock = { scalar, hex: to32Hex(scalar) };   // canonical: 64 lowercase hex chars, no 0x
} catch {
  return { ok: false, reason: 'BAD_COMMITMENT' };
}
  // 1. Commitment check — does this padlock hash to the published commitment?
  //    Uses the *same* commitPadlock implementation as the client that published it,
  //    so the preimage can never drift between prover and verifier.
  const expected = commitPadlock(padlock, params.tableId, params.handNumber);
  if (expected !== params.commitmentHex.toLowerCase()) {
  return { ok: false, reason: 'BAD_COMMITMENT' };
}

  // 2. Card consistency — subtract the padlock from the locked value the player
  //    was dealt, and check the resulting point is the claimed card.
  //
  //    Note on "the locked value the player was dealt": SPEC §2 says the shuffle
  //    output is locked by all 4 padlocks, and each `unlock_card` removes only
  //    the sender's padlock. So `lockedCardHex` here must be the value *with only
  //    this player's padlock remaining* — i.e. after the other three players'
  //    unlocks have been applied and before this player's own. That is exactly
  //    the point at which the player privately removed their padlock to see the
  //    card; passing the raw shuffle output would leave 3 padlocks on and always
  //    fail. Callers must pass the intermediate, not `deck[i]`.
  const unlocked = unlockCard(params.lockedCardHex, padlock);

  const idx = POINT_TO_INDEX.get(unlocked);
  if (idx === undefined) return { ok: false, reason: 'NOT_A_CARD' };
  if (idx !== params.claimedCardIndex) return { ok: false, reason: 'WRONG_CARD' };

  return { ok: true };
}