// shared/engine/cards.ts

export type CardId = number; // 0 to 51

// SPEC §2: flop is deck[8], deck[9], deck[10]; turn is deck[11]; river is deck[12].
export const BOARD_INDICES = {
  flop: [8, 9, 10],
  turn: [11],
  river: [12]
} as const;

// SPEC §2: deal order starts at seat left of dealer, one at a time, two rounds.
export function holeCardIndices(seat: 0 | 1 | 2 | 3, dealer: 0 | 1 | 2 | 3): [CardId, CardId] {
  const posOfSeat = (seat - dealer - 1 + 4) % 4;
  return [2 * posOfSeat, 2 * posOfSeat + 1];
}