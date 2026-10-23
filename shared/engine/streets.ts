// shared/engine/streets.ts
// If TypeScript complains about this import: `npm i pokersolver` and add a
// declaration file containing `declare module "pokersolver";` (and enable esModuleInterop).
import pokersolver from "pokersolver";
import { GameState, PlayerState, PotState, Seat, EngineError } from "./types";
import { BOARD_INDICES, CardId } from "./cards";

const { Hand } = pokersolver as any;

const err = (error: EngineError) => ({ error });
const isLive = (p: PlayerState) => p.inHand && !p.hasFolded;
const canAct = (p: PlayerState) => isLive(p) && !p.isAllIn;

// ASSUMPTION: card id -> pokersolver name. Must match Person B's lookup table.
// id % 13 = rank (2..A), floor(id / 13) = suit (c, d, h, s).
const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
export const solverCardName = (id: CardId): string => RANKS[id % 13] + SUITS[Math.floor(id / 13)];

const NEXT_STREET = {
  preflop: "flop",
  flop: "turn",
  turn: "river",
  river: "showdown",
} as const;

function resetStreet(s: GameState): void {
  s.seats.forEach(p => {
    p.committedThisStreet = 0;
    p.hasActedThisStreet = false;
  });
  s.currentBet = 0;
  s.lastRaiseSize = s.blinds.big;
}

// Opens a betting round. Returns false when nobody has anyone to bet against (run-out).
function openBetting(s: GameState): boolean {
  if (s.seats.filter(canAct).length < 2) {
    s.toActSeat = null;
    return false;
  }
  for (let i = 1; i <= 4; i++) {
    const seat = ((s.dealerSeat + i) % 4) as Seat; // first live, non-all-in seat left of the dealer
    if (canAct(s.seats[seat])) {
      s.toActSeat = seat;
      return true;
    }
  }
  s.toActSeat = null;
  return false;
}

/**
 * Moves to the next street after a betting round closes.
 * - Phase 2 (state.deck present): board cards are revealed immediately.
 * - Phase 3 (deck null): sets needsCards and waits; call provideBoardCards() once all unlocks are in.
 * - If nobody can bet, keeps running streets out until showdown.
 * Reaching the river's end sets tableState "showdown"; reveal hole cards, then call resolveShowdown().
 */
export function advanceStreet(state: GameState): GameState {
  const s: GameState = structuredClone(state);

  while (s.street !== "showdown") {
    const next = NEXT_STREET[s.street];
    resetStreet(s);
    s.street = next;

    if (next === "showdown") {
      s.tableState = "showdown";
      s.toActSeat = null;
      s.needsCards = null;
      return s;
    }

    const idx = BOARD_INDICES[next];
    if (s.deck) {
      s.board.push(...idx.map(i => s.deck![i]));
      s.needsCards = null;
    } else {
      s.needsCards = [...idx]; // wait for unlocks
      s.toActSeat = null;
      return s;
    }

    if (openBetting(s)) return s;
    // else: run-out, loop to the next street
  }
  return s;
}

/** Phase 3: supply the unlocked board cards for the street that is waiting, then open betting. */
export function provideBoardCards(
  state: GameState,
  cards: CardId[]
): GameState | { error: EngineError } {
  if (state.tableState !== "betting" || !state.needsCards) return err("WRONG_STATE");
  if (cards.length !== state.needsCards.length) return err("BAD_PAYLOAD");

  const known = new Set<number>([...state.board, ...state.holeCards.flat()]);
  for (const c of cards) {
    if (!Number.isInteger(c) || c < 0 || c > 51 || known.has(c)) return err("BAD_PAYLOAD");
    known.add(c);
  }

  const s: GameState = structuredClone(state);
  s.board.push(...cards);
  s.needsCards = null;
  return openBetting(s) ? s : advanceStreet(s);
}

/** Showdown: record a player's verified hole cards (after reveal_padlock checks out). */
export function revealHoleCards(
  state: GameState,
  seat: Seat,
  cards: [CardId, CardId]
): GameState | { error: EngineError } {
  if (state.tableState !== "showdown") return err("WRONG_STATE");
  if (!isLive(state.seats[seat])) return err("ILLEGAL_ACTION");
  const [a, b] = cards;
  if (![a, b].every(c => Number.isInteger(c) && c >= 0 && c <= 51) || a === b) {
    return err("BAD_PAYLOAD");
  }
  const s: GameState = structuredClone(state);
  s.holeCards[seat] = [a, b];
  return s;
}

const sameSeats = (a: Seat[], b: Seat[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Builds main + side pots from committedThisHand.
 * Folded players' chips stay in the pots but they are never eligible.
 * A layer only one player contributed to (an uncalled bet) becomes a pot with one eligible seat,
 * so it goes straight back to that player.
 */
export function buildPots(seats: readonly PlayerState[]): PotState[] {
  const levels = [...new Set(seats.map(p => p.committedThisHand).filter(n => n > 0))].sort(
    (a, b) => a - b
  );
  const pots: PotState[] = [];
  let prev = 0;

  for (const level of levels) {
    let amount = 0;
    for (const p of seats) {
      amount += Math.max(0, Math.min(p.committedThisHand, level) - prev);
    }
    const eligible = seats
      .map((p, i) => (isLive(p) && p.committedThisHand >= level ? (i as Seat) : -1))
      .filter(i => i !== -1) as Seat[];
    prev = level;

    if (amount === 0) continue;
    if (eligible.length === 0) {
      if (pots.length) pots[pots.length - 1].amount += amount; // defensive: should not happen
      continue;
    }
    const last = pots[pots.length - 1];
    if (last && sameSeats(last.eligibleSeats, eligible)) last.amount += amount;
    else pots.push({ amount, eligibleSeats: eligible });
  }
  return pots;
}

/**
 * Ranks hands with pokersolver, awards every pot, splits ties.
 * Odd leftover chips go one at a time to the winners starting left of the dealer (SPEC §4).
 * Requires a full board and hole cards for every live player (via revealHoleCards).
 */
export function resolveShowdown(state: GameState): GameState | { error: EngineError } {
  if (state.tableState !== "showdown") return err("WRONG_STATE");
  const live = state.seats.filter(isLive);
  if (live.length < 2 || state.board.length !== 5) return err("ILLEGAL_ACTION");
  if (live.some(p => state.holeCards[p.seat].length !== 2)) return err("ILLEGAL_ACTION");

  const s: GameState = structuredClone(state);
  const pots = buildPots(s.seats);
  const won = [0, 0, 0, 0];

  const solved = new Map<Seat, any>();
  for (const p of live) {
    solved.set(p.seat, Hand.solve([...s.holeCards[p.seat], ...s.board].map(solverCardName)));
  }

  for (const pot of pots) {
    let winners: Seat[];
    if (pot.eligibleSeats.length === 1) {
      winners = [...pot.eligibleSeats];
    } else {
      const best: any[] = Hand.winners(pot.eligibleSeats.map(seat => solved.get(seat)));
      winners = pot.eligibleSeats.filter(seat => best.includes(solved.get(seat)));
    }
    // Order winners starting from the seat left of the dealer.
    const pos = (seat: Seat) => (seat - s.dealerSeat - 1 + 4) % 4;
    winners.sort((a, b) => pos(a) - pos(b));

    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    for (const w of winners) {
      won[w] += share;
      if (remainder > 0) {
        won[w] += 1;
        remainder--;
      }
    }
  }

  s.seats.forEach((p, i) => {
    p.chips += won[i];
    p.committedThisHand = 0;
    p.committedThisStreet = 0;
  });
  s.pots = pots;
  s.awards = won
    .map((amount, i) => ({ seat: i as Seat, amount }))
    .filter(a => a.amount > 0);
  s.tableState = "settlement";
  s.toActSeat = null;
  return s;
}