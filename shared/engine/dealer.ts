// shared/engine/dealer.ts
import { GameState, PlayerState, Seat, EngineError } from "./types";
import { holeCardIndices, isValidDeck, CardId } from "./cards";

const canPlay = (p: PlayerState) => !p.evicted && p.chips > 0;

// Next seat (clockwise, exclusive) that is not evicted and has chips.
function nextActiveSeat(current: Seat, seats: readonly PlayerState[]): Seat {
  for (let i = 1; i <= 4; i++) {
    const s = (current + i) % 4;
    if (canPlay(seats[s])) return s as Seat;
  }
  return current; // unreachable when >= 2 players can play
}

function postBlind(p: PlayerState, amount: number): void {
  const paid = Math.min(amount, p.chips); // short stacks post what they have
  p.chips -= paid;
  p.committedThisStreet += paid;
  p.committedThisHand += paid;
  if (p.chips === 0) p.isAllIn = true;
}

/**
 * Starts a new hand.
 * - rngDeck given  -> Phase 2 dev dealing: a full 52-card permutation, hand goes straight to "betting".
 * - rngDeck absent -> Phase 3 padlock shuffle: hand goes to "dealing", needsCards lists hole-card positions.
 *
 * If betting is closed from the start (everyone all-in after blinds), toActSeat is null.
 * The caller must then run the streets forward (advanceStreet) once the needed cards are available.
 */
export function startHand(
  state: GameState,
  rngDeck?: CardId[]
): GameState | { error: EngineError } {
  if (rngDeck !== undefined && !isValidDeck(rngDeck)) return { error: "BAD_PAYLOAD" };

  // A hand may only start from "ready" (hand 1) or "settlement" (after the previous hand).
  // Starting mid-hand would wipe committedThisHand and destroy chips.
  if (state.tableState !== "ready" && state.tableState !== "settlement") {
    return { error: "WRONG_STATE" };
  }

  const s: GameState = structuredClone(state);

  // Fewer than 2 players with chips: the game is over (SPEC §4 settlement -> finished).
  if (s.seats.filter(canPlay).length < 2) {
    s.tableState = "finished";
    s.toActSeat = null;
    return s;
  }

  // 1. Move the dealer button (skips busted/evicted seats).
  s.dealerSeat = nextActiveSeat(s.dealerSeat, s.seats);

  // 2. Who is playing this hand (decided BEFORE blinds are taken).
  const playing = s.seats.map(canPlay);
  const isHeadsUp = playing.filter(Boolean).length === 2;

  // 3. Blind seats. Heads-up: dealer posts the small blind and acts first preflop.
  const sbSeat: Seat = isHeadsUp ? s.dealerSeat : nextActiveSeat(s.dealerSeat, s.seats);
  const bbSeat: Seat = nextActiveSeat(sbSeat, s.seats);

  // 4. Reset per-hand state.
  s.seats.forEach((p, i) => {
    p.inHand = playing[i];
    p.hasFolded = false;
    p.isAllIn = false;
    p.committedThisStreet = 0;
    p.committedThisHand = 0;
    p.hasActedThisStreet = false; // blinds do not count as acting (BB keeps its option)
  });

  postBlind(s.seats[sbSeat], s.blinds.small);
  postBlind(s.seats[bbSeat], s.blinds.big);

  // 5. Betting state.
  s.handNumber += 1;
  s.street = "preflop";
  s.board = [];
  s.pots = [];
  s.awards = [];
  s.currentBet = s.blinds.big; // stays 10 even if the BB posted less (short all-in)
  s.lastRaiseSize = s.blinds.big;
  delete s.aborted;

  // First to act: heads-up starts at the SB (inclusive), otherwise left of the BB.
  // Skip anyone who is all-in from posting a blind.
  const start = isHeadsUp ? sbSeat : (bbSeat + 1) % 4;
  let first: Seat | null = null;
  for (let i = 0; i < 4; i++) {
    const seat = ((start + i) % 4) as Seat;
    const p = s.seats[seat];
    if (p.inHand && !p.isAllIn) {
      first = seat;
      break;
    }
  }
  // No betting possible if nobody can act, or the only player who can act already matches the bet.
  const canAct = s.seats.filter(p => p.inHand && !p.isAllIn);
  const closed =
    first === null || (canAct.length === 1 && canAct[0].committedThisStreet >= s.currentBet);
  s.toActSeat = closed ? null : first;

  // 6. Deal hole cards.
  s.holeCards = [[], [], [], []];
  if (rngDeck) {
    // Phase 2 (dev): server-provided deck.
    s.deck = [...rngDeck];
    s.needsCards = null;
    s.tableState = "betting";
    for (let seat = 0; seat < 4; seat++) {
      if (s.seats[seat].inHand) {
        const [i1, i2] = holeCardIndices(seat as Seat, s.dealerSeat);
        s.holeCards[seat] = [rngDeck[i1], rngDeck[i2]];
      }
    }
  } else {
    // Phase 3: padlock shuffle. Engine waits for unlocks of these deck positions.
    s.deck = null;
    s.tableState = "dealing";
    s.needsCards = [];
    for (let seat = 0; seat < 4; seat++) {
      if (s.seats[seat].inHand) {
        s.needsCards.push(...holeCardIndices(seat as Seat, s.dealerSeat));
      }
    }
  }

  return s;
}