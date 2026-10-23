// shared/engine/actions.ts
import { GameState, PlayerState, Seat, EngineError } from "./types";
import { advanceStreet } from "./streets"; // We will write this next

export type ActionType = "fold" | "check" | "call" | "raise" | "allin";

export interface Action {
  type: ActionType;
  amount?: number; // Only used for "raise": total to raise TO for this street
}

const ACTION_TYPES: readonly ActionType[] = ["fold", "check", "call", "raise", "allin"];
const err = (error: EngineError) => ({ error });

const isLive = (p: PlayerState) => p.inHand && !p.hasFolded;
const canAct = (p: PlayerState) => isLive(p) && !p.isAllIn;

function commit(p: PlayerState, amount: number): void {
  p.chips -= amount;
  p.committedThisStreet += amount;
  p.committedThisHand += amount;
  if (p.chips === 0) p.isAllIn = true;
}

// Everyone else folded: winner takes everything committed this hand (including their own uncalled chips).
function awardUncontested(s: GameState, winner: Seat): void {
  const total = s.seats.reduce((n, p) => n + p.committedThisHand, 0);
  s.seats[winner].chips += total;
  s.seats.forEach(p => {
    p.committedThisHand = 0;
    p.committedThisStreet = 0;
  });
  s.pots = [];
  s.awards = [{ seat: winner, amount: total }];
  s.tableState = "settlement";
  s.toActSeat = null;
}

export function applyAction(
  state: GameState,
  seat: Seat,
  action: Action
): GameState | { error: EngineError } {
  // 1. Validate input shape (it arrives from the network) and turn order.
  if (seat !== 0 && seat !== 1 && seat !== 2 && seat !== 3) return err("BAD_PAYLOAD");
  if (!action || !ACTION_TYPES.includes(action.type)) return err("BAD_PAYLOAD");
  if (state.tableState !== "betting") return err("WRONG_STATE");
  if (state.toActSeat !== seat) return err("NOT_YOUR_TURN");
  if (!canAct(state.seats[seat])) return err("ILLEGAL_ACTION");

  // 2. Deep copy so the caller's state is never mutated.
  const s: GameState = structuredClone(state);
  const player = s.seats[seat];
  const callAmount = s.currentBet - player.committedThisStreet;

  // 3. Apply the action.
  if (action.type === "fold") {
    player.hasFolded = true;
  } else if (action.type === "check") {
    if (callAmount > 0) return err("ILLEGAL_ACTION");
  } else if (action.type === "call") {
    if (callAmount <= 0) return err("ILLEGAL_ACTION");
    commit(player, Math.min(callAmount, player.chips)); // short call = all-in
  } else {
    // raise or allin
    const maxTarget = player.committedThisStreet + player.chips;
    let target: number;

    if (action.type === "allin") {
      target = maxTarget;
    } else {
      const amt = action.amount;
      if (typeof amt !== "number" || !Number.isSafeInteger(amt)) return err("BAD_PAYLOAD");
      target = amt;
      if (target > maxTarget) return err("ILLEGAL_ACTION"); // betting more than you own
      const minRaiseTo = s.currentBet + s.lastRaiseSize;
      if (target < minRaiseTo && target !== maxTarget) return err("ILLEGAL_ACTION");
    }
    if (target <= player.committedThisStreet) return err("ILLEGAL_ACTION"); // nothing to put in

    commit(player, target - player.committedThisStreet);

    const increment = player.committedThisStreet - s.currentBet;
    if (increment > 0) {
      s.currentBet = player.committedThisStreet;
      // Only a FULL raise changes the raise size and reopens action.
      // A short all-in raise raises the bet but does neither.
      if (increment >= s.lastRaiseSize) {
        s.lastRaiseSize = increment;
        s.seats.forEach((p, i) => {
          if (i !== seat && canAct(p)) p.hasActedThisStreet = false;
        });
      }
    }
  }
  player.hasActedThisStreet = true;

  // 4. Everyone else folded: award the pot and go to settlement.
  const live = s.seats.filter(isLive);
  if (live.length === 1) {
    awardUncontested(s, live[0].seat);
    return s;
  }

  // 5. Is the betting round over?
  const active = s.seats.filter(canAct);
  const allDone = active.every(
    p => p.hasActedThisStreet && p.committedThisStreet === s.currentBet
  );
  // Nobody (or only one player who already matches the bet) can still bet.
  const nothingLeftToBet =
    active.length === 0 ||
    (active.length === 1 && active[0].committedThisStreet >= s.currentBet);

  if (allDone || nothingLeftToBet) {
    return advanceStreet(s); // flop / turn / river / showdown (and run-out when all-in)
  }

  // 6. Pass the turn to the next player who can act.
  for (let i = 1; i <= 4; i++) {
    const next = ((seat + i) % 4) as Seat;
    if (canAct(s.seats[next])) {
      s.toActSeat = next;
      return s;
    }
  }
  return advanceStreet(s); // defensive: nobody can act
}