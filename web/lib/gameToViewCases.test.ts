import { describe, expect, it } from "vitest";
import type { GameState, Seat } from "@poker/shared";
import { chipsAddUp, toTableView } from "./gameToView";
import { game, seat } from "./testHelpers";

const view = (state: GameState, mySeat: Seat | null = 0) =>
  toTableView({ state, mySeat, players: [], timer: null, totalHands: 3 });

describe("toTableView: table shapes", () => {
  it("heads-up: two live seats, the two others are busted, chips add up", () => {
    const v = view(
      game({
        tableState: "betting",
        dealerSeat: 0,
        toActSeat: 1,
        seats: [
          seat(0, { chips: 1900, inHand: true }),
          seat(1, { chips: 2100, inHand: true }),
          seat(2, { chips: 0, inHand: false }),
          seat(3, { chips: 0, inHand: false }),
        ],
      })
    );
    expect(v.seats.map((s) => s.busted)).toEqual([false, false, true, true]);
    expect(v.seats[0].isDealer).toBe(true);
    expect(v.turnSeat).toBe(1);
    expect(v.pot).toBe(0);
    expect(chipsAddUp(v)).toBe(true);
  });

  it("all-in: stack 0, bet in front, not busted, not folded", () => {
    const v = view(
      game({
        tableState: "betting",
        currentBet: 1000,
        seats: [
          seat(0, { chips: 1000, inHand: true }),
          seat(1, {
            chips: 0,
            inHand: true,
            isAllIn: true,
            committedThisHand: 1000,
            committedThisStreet: 1000,
          }),
          seat(2, { chips: 1000, inHand: true, hasFolded: true }),
          seat(3, { chips: 1000, inHand: true, hasFolded: true }),
        ],
      })
    );
    expect(v.seats[1]).toMatchObject({
      allIn: true,
      stack: 0,
      currentBet: 1000,
      busted: false,
      folded: false,
    });
    expect(v.pot).toBe(0); // the 1000 is still a bet in front of the player, not in the pot
    expect(chipsAddUp(v)).toBe(true);
  });

  it("chip invariant mid-hand: sum(stack + currentBet) + pot === 4000", () => {
    // Seats 0 and 1 are in for 60 each (20 of it on this street), seat 3 folded after putting in 40.
    const v = view(
      game({
        tableState: "betting",
        currentBet: 20,
        toActSeat: null,
        seats: [
          seat(0, { chips: 940, inHand: true, committedThisHand: 60, committedThisStreet: 20 }),
          seat(1, { chips: 940, inHand: true, committedThisHand: 60, committedThisStreet: 20 }),
          seat(2, { chips: 1000, inHand: true, hasFolded: true }),
          seat(3, { chips: 960, inHand: true, hasFolded: true, committedThisHand: 40 }),
        ],
      })
    );
    expect(v.seats.map((s) => s.currentBet)).toEqual([20, 20, 0, 0]);
    expect(v.pot).toBe(120);
    expect(chipsAddUp(v)).toBe(true);
  });
});

describe("toTableView: revealed cards", () => {
  it("at a showdown, non-folded seats with two cards are revealed, folded ones never", () => {
    const v = view(
      game({
        tableState: "settlement",
        board: [0, 5, 10, 15, 20],
        holeCards: [[1, 2], [3, 4], [5, 6], []],
        seats: [
          seat(0, { chips: 1100, inHand: true }),
          seat(1, { chips: 900, inHand: true }),
          seat(2, { chips: 1000, inHand: true, hasFolded: true }),
          seat(3, { chips: 1000, inHand: true }), // live but the server sent no cards
        ],
      })
    );
    expect(v.seats[0].revealed).toEqual(["3c", "4c"]);
    expect(v.seats[1].revealed).toEqual(["5c", "6c"]);
    expect(v.seats[2].revealed).toBeUndefined();
    expect(v.seats[3].revealed).toBeUndefined();
    expect(chipsAddUp(v)).toBe(true);
  });

  it("before the showdown nobody is revealed; your own cards only show in myHole", () => {
    const v = view(
      game({
        tableState: "betting",
        holeCards: [[1, 2], [3, 4], [], []],
        seats: [
          seat(0, { inHand: true }),
          seat(1, { inHand: true }),
          seat(2, { inHand: true }),
          seat(3, { inHand: true }),
        ],
      })
    );
    expect(v.seats.every((s) => s.revealed === undefined)).toBe(true);
    expect(v.myHole).toEqual(["3c", "4c"]);
  });
});
