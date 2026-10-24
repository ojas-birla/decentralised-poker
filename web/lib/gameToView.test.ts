import { describe, expect, it } from "vitest";
import type { GameState, Seat } from "@poker/shared";
import { toTableView } from "./gameToView";
import { game, seat } from "./testHelpers";

const input = (state: GameState) => ({ state, mySeat: 0 as Seat, players: [], timer: null, totalHands: 3 });

describe("toTableView: busted", () => {
  it("a player who just lost all-in is NOT busted at settlement, and their cards are revealed", () => {
    // What the server sends after an all-in showdown: seat 0 won everything, seat 1 lost.
    // The engine zeroes committedThisHand at settlement, but the loser is still inHand.
    const state = game({
      tableState: "settlement",
      street: "showdown",
      board: [0, 5, 10, 15, 20],
      holeCards: [[1, 2], [3, 4], [], []],
      seats: [
        seat(0, { chips: 2000, inHand: true, isAllIn: true }),
        seat(1, { chips: 0, inHand: true, isAllIn: true }),
        seat(2, { chips: 1000, inHand: true, hasFolded: true }),
        seat(3, { chips: 1000, inHand: true, hasFolded: true }),
      ],
    });

    const view = toTableView(input(state));

    expect(view.seats[1].busted).toBe(false);
    expect(view.seats[1].revealed).toEqual(["5c", "6c"]);
  });

  it("a player who is really out (no chips, not in this hand) IS busted", () => {
    const state = game({
      tableState: "betting",
      seats: [
        seat(0, { chips: 1500, inHand: true }),
        seat(1, { chips: 0, inHand: false }),
        seat(2, { chips: 1500, inHand: true }),
        seat(3, { chips: 1000, inHand: true }),
      ],
      toActSeat: 0,
    });

    const view = toTableView(input(state));

    expect(view.seats[1].busted).toBe(true);
    expect(view.seats[0].busted).toBe(false);
  });

  it("nobody is busted before the first hand starts", () => {
    const state = game({ tableState: "ready" }); // everyone has 1000 chips and inHand false
    const view = toTableView(input(state));
    expect(view.seats.every((s) => !s.busted)).toBe(true);
  });
});
