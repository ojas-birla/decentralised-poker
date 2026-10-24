// D3 (optional): hand names like "Two Pair, K's & 7's", computed in the browser with pokersolver.
// Only seats whose cards the server sent are ever named. The pokersolver import is dynamic,
// so it stays out of the first bundle.
import type { ShownHand } from "@/lib/handResult";

export interface Solver {
  solve(cards: string[]): { descr: string };
}

/** Pure part (testable with a fake solver). Needs the full 5-card board and the shown hands. */
export function nameHands(
  board: string[],
  hands: ShownHand[],
  solver: Solver
): Record<number, string> {
  const names: Record<number, string> = {};
  if (board.length !== 5) return names;
  for (const h of hands) {
    try {
      // Our card codes ("Td", "As") are already in pokersolver's format.
      names[h.seat] = solver.solve([...board, ...h.cards]).descr;
    } catch {
      // A name is a nice-to-have. Never break the panel for it.
    }
  }
  return names;
}

export async function loadHandNames(
  board: string[],
  hands: ShownHand[]
): Promise<Record<number, string>> {
  if (hands.length < 2 || board.length !== 5) return {};
  const mod: any = await import("pokersolver");
  const { Hand } = mod.default ?? mod;
  return nameHands(board, hands, Hand);
}
