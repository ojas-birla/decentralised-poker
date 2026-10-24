import { describe, expect, it } from "vitest";
import { captureResult, mergeResult, type HandResult } from "./handResult";
import { game, seat } from "./testHelpers";

// Seat 0 and seat 1 reach showdown, seat 1 wins; seats 2 and 3 folded.
const showdownState = () =>
  game({
    tableState: "settlement",
    street: "showdown",
    handNumber: 4,
    board: [0, 5, 10, 15, 20],
    holeCards: [[1, 2], [3, 4], [], []],
    awards: [{ seat: 1, amount: 120 }],
    pots: [{ amount: 120, eligibleSeats: [0, 1] }],
    seats: [
      seat(0, { chips: 940, inHand: true }),
      seat(1, { chips: 1060, inHand: true }),
      seat(2, { chips: 1000, inHand: true, hasFolded: true }),
      seat(3, { chips: 1000, inHand: true, hasFolded: true }),
    ],
  });

describe("captureResult", () => {
  it("returns null unless the table is in settlement", () => {
    for (const tableState of ["betting", "showdown", "ready", "finished"] as const) {
      expect(captureResult(game({ tableState }))).toBeNull();
    }
  });

  it("at a showdown: board, the shown hands of live seats, awards and pots", () => {
    const r = captureResult(showdownState());
    expect(r).not.toBeNull();
    expect(r!.handNumber).toBe(4);
    expect(r!.board).toEqual(["2c", "7c", "Qc", "4d", "9d"]);
    expect(r!.hands).toEqual([
      { seat: 0, cards: ["3c", "4c"] },
      { seat: 1, cards: ["5c", "6c"] },
    ]);
    expect(r!.awards).toEqual([{ seat: 1, amount: 120 }]);
    expect(r!.pots).toEqual([{ amount: 120, eligibleSeats: [0, 1] }]);
  });

  it("never invents cards: a live seat without two cards in the state is left out", () => {
    const s = showdownState();
    s.holeCards = [[1, 2], [], [], []];
    expect(captureResult(s)!.hands).toEqual([{ seat: 0, cards: ["3c", "4c"] }]);
  });

  it("uncontested win: no hands are shown, even if the state holds your own cards", () => {
    const s = game({
      tableState: "settlement",
      handNumber: 2,
      holeCards: [[1, 2], [], [], []], // only YOUR cards are ever in the state
      awards: [{ seat: 0, amount: 15 }],
      seats: [
        seat(0, { chips: 1005, inHand: true }),
        seat(1, { chips: 995, inHand: true, hasFolded: true }),
        seat(2, { chips: 1000, inHand: true, hasFolded: true }),
        seat(3, { chips: 1000, inHand: true, hasFolded: true }),
      ],
    });
    const r = captureResult(s)!;
    expect(r.hands).toEqual([]);
    expect(r.pots).toEqual([]);
    expect(r.awards).toEqual([{ seat: 0, amount: 15 }]);
  });
});

describe("mergeResult", () => {
  const res = (tableId: string, handNumber: number): HandResult => ({
    tableId, handNumber, board: [], hands: [], awards: [], pots: [],
  });

  it("keeps the old result when nothing new arrives", () => {
    const a = res("1", 3);
    expect(mergeResult(a, null)).toBe(a);
  });
  it("takes the first result", () => {
    const a = res("1", 1);
    expect(mergeResult(null, a)).toBe(a);
  });
  it("replaces an older hand with a newer one, but never the other way round", () => {
    const old = res("1", 3), newer = res("1", 4);
    expect(mergeResult(old, newer)).toBe(newer);
    expect(mergeResult(newer, old)).toBe(newer);
    expect(mergeResult(newer, res("1", 4))).toBe(newer); // same hand twice: keep the first
  });
  it("a result for another table always replaces the old one", () => {
    const a = res("1", 9), b = res("2", 1);
    expect(mergeResult(a, b)).toBe(b);
  });
});
