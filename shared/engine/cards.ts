// shared/engine/cards.ts
import type { Seat } from "./types";

// A card IDENTITY: 0..51, i.e. the card named "card-<n>" in the crypto module.
export type CardId = number;

// A deck POSITION: 0..51, an index into the shuffled deck (SPEC §2).
export type DeckIndex = number;

// SPEC §2: flop is deck[8], deck[9], deck[10]; turn is deck[11]; river is deck[12]. No burn cards.
export const BOARD_INDICES: {
  readonly flop: readonly DeckIndex[];
  readonly turn: readonly DeckIndex[];
  readonly river: readonly DeckIndex[];
} = {
  flop: [8, 9, 10],
  turn: [11],
  river: [12],
};

// SPEC §2: deal order starts at the seat left of the dealer, ONE card at a time, two rounds.
// Position p (0 = left of dealer ... 3 = dealer) gets deck[p] in round 1 and deck[p + 4] in round 2.
// Positions are counted over all 4 seats, so indices do not depend on who is busted.
export function holeCardIndices(seat: Seat, dealer: Seat): [DeckIndex, DeckIndex] {
  const pos = (seat - dealer - 1 + 4) % 4;
  return [pos, pos + 4];
}

// A valid dev-mode deck is a permutation of 0..51.
export function isValidDeck(deck: unknown): deck is CardId[] {
  if (!Array.isArray(deck) || deck.length !== 52) return false;
  const seen = new Set<number>();
  for (const c of deck) {
    if (!Number.isInteger(c) || c < 0 || c > 51 || seen.has(c)) return false;
    seen.add(c);
  }
  return true;
}