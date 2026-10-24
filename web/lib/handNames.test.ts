import { describe, expect, it } from "vitest";
import { nameHands } from "./handNames";

const board = ["2c", "7c", "Qc", "4d", "9d"];
const hands = [
  { seat: 0, cards: ["3c", "4c"] as [string, string] },
  { seat: 1, cards: ["5c", "6c"] as [string, string] },
];

describe("nameHands", () => {
  it("solves board + 2 cards for every shown hand", () => {
    const seen: string[][] = [];
    const names = nameHands(board, hands, {
      solve: (cards) => {
        seen.push(cards);
        return { descr: `hand of ${cards.length}` };
      },
    });
    expect(names).toEqual({ 0: "hand of 7", 1: "hand of 7" });
    expect(seen[0]).toEqual([...board, "3c", "4c"]);
  });

  it("names nothing without a full board", () => {
    expect(nameHands(board.slice(0, 3), hands, { solve: () => ({ descr: "x" }) })).toEqual({});
  });

  it("skips a seat when the solver throws", () => {
    const names = nameHands(board, hands, {
      solve: (cards) => {
        if (cards.includes("3c")) throw new Error("bad");
        return { descr: "ok" };
      },
    });
    expect(names).toEqual({ 1: "ok" });
  });
});
