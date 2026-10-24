// D2: a snapshot of how the last hand ended. Pure functions, no React.
//
// Why a snapshot: the server starts the next hand as soon as the 4 checkpoint signatures are in
// (about a second after settlement), and the browser only keeps the NEWEST state. Without a copy,
// the revealed cards and the winner would vanish almost immediately.
import type { GameState } from "@poker/shared";
import { cardName } from "@poker/shared/engine/cards";
import type { CardCode } from "@/lib/tableView";

export interface ShownHand {
  seat: number;
  cards: [CardCode, CardCode];
}

export interface HandResult {
  tableId: string;
  handNumber: number;
  board: CardCode[];
  /** Only seats whose cards the server actually sent. Empty when nobody had to show (everyone else folded). */
  hands: ShownHand[];
  awards: { seat: number; amount: number }[];
  /** Filled by the engine at a showdown only. Empty for an uncontested win. */
  pots: { amount: number; eligibleSeats: number[] }[];
}

/**
 * Returns the result of the hand that just settled, or null if the state is not a settlement.
 * Only `settlement` counts: at `showdown` the awards are not filled yet, and the server moves on
 * to `settlement` in the same step.
 */
export function captureResult(state: GameState): HandResult | null {
  if (state.tableState !== "settlement") return null;

  // Cards are shown only for a real showdown (2+ live players). The server sends exactly those.
  // On an uncontested win the winner may hold their own cards, but nothing was "shown", so skip them.
  const live = state.seats.filter((p) => p.inHand && !p.hasFolded);
  const hands: ShownHand[] = [];
  if (live.length >= 2) {
    for (const p of live) {
      const cards = state.holeCards[p.seat];
      if (cards && cards.length === 2) {
        hands.push({ seat: p.seat, cards: [cardName(cards[0]), cardName(cards[1])] });
      }
    }
  }

  return {
    tableId: state.tableId,
    handNumber: state.handNumber,
    board: state.board.map(cardName),
    hands,
    awards: state.awards.map((a) => ({ seat: a.seat, amount: a.amount })),
    pots: state.pots.map((pot) => ({ amount: pot.amount, eligibleSeats: [...pot.eligibleSeats] })),
  };
}

/** Keeps the newest result. A result for another table always replaces the old one. */
export function mergeResult(prev: HandResult | null, next: HandResult | null): HandResult | null {
  if (!next) return prev;
  if (prev && prev.tableId === next.tableId && prev.handNumber >= next.handNumber) return prev;
  return next;
}

/** Total chips won per seat. A seat can appear in several awards (main pot and a side pot). */
export function wonBySeat(awards: HandResult["awards"]): Map<number, number> {
  const totals = new Map<number, number>();
  for (const a of awards) totals.set(a.seat, (totals.get(a.seat) ?? 0) + a.amount);
  return totals;
}
