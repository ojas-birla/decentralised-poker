import { describe, it, expect } from "vitest";
import { legalActions } from "./legalActions";
import type { GameState, PlayerState, Seat } from "./types";

function player(seat: Seat, over: Partial<PlayerState> = {}): PlayerState {
  return {
    seat, wallet: "0x" + String(seat).repeat(40), sessionKey: "0x" + "a".repeat(40),
    chips: 1000, inHand: true, hasFolded: false, isAllIn: false,
    committedThisStreet: 0, committedThisHand: 0, hasActedThisStreet: false,
    evicted: false, connected: true, ...over,
  };
}

function mk(over: Partial<GameState> = {}, seats: Partial<PlayerState>[] = []): GameState {
  return {
    tableId: "1", tableState: "betting", handNumber: 1, checkpointNumber: 0,
    seats: [0, 1, 2, 3].map((s) => player(s as Seat, seats[s] ?? {})) as GameState["seats"],
    dealerSeat: 0, blinds: { small: 5, big: 10 }, board: [],
    holeCards: [[], [], [], []], pots: [], awards: [],
    toActSeat: 1, currentBet: 0, lastRaiseSize: 10, street: "flop",
    deck: null, needsCards: null, ...over,
  };
}

describe("legalActions", () => {
  it("is null unless it is betting and the seat's turn", () => {
    expect(legalActions(mk({ tableState: "showdown" }), 1)).toBeNull();
    expect(legalActions(mk({ tableState: "settlement" }), 1)).toBeNull();
    expect(legalActions(mk({ toActSeat: 2 }), 1)).toBeNull();
    expect(legalActions(mk({ toActSeat: null }), 1)).toBeNull();
  });

  it("opening bet: nothing to call, may check, min bet is the big blind", () => {
    expect(legalActions(mk(), 1)).toEqual({ toCall: 0, canCheck: true, minRaiseTo: 10, maxRaiseTo: 1000 });
  });

  it("big blind option preflop: may check, min raise to 20", () => {
    const s = mk(
      { currentBet: 10, lastRaiseSize: 10, street: "preflop", toActSeat: 2 },
      [{}, {}, { chips: 990, committedThisStreet: 10, committedThisHand: 10 }],
    );
    expect(legalActions(s, 2)).toEqual({ toCall: 0, canCheck: true, minRaiseTo: 20, maxRaiseTo: 1000 });
  });

  it("facing a raise: call amount, min re-raise = currentBet + lastRaiseSize", () => {
    const s = mk(
      { currentBet: 40, lastRaiseSize: 30, street: "preflop" },
      [{}, { chips: 990, committedThisStreet: 10, committedThisHand: 10 }],
    );
    expect(legalActions(s, 1)).toEqual({ toCall: 30, canCheck: false, minRaiseTo: 70, maxRaiseTo: 1000 });
  });

  it("short stack that cannot cover the call: call is capped at the stack, only all-in remains", () => {
    const s = mk({ currentBet: 40, lastRaiseSize: 30 }, [{}, { chips: 15 }]);
    expect(legalActions(s, 1)).toEqual({ toCall: 15, canCheck: false, minRaiseTo: 15, maxRaiseTo: 15 });
  });

  it("short stack that can call but not make a full raise: min raise is capped at all-in", () => {
    const s = mk(
      { currentBet: 40, lastRaiseSize: 30, street: "preflop" },
      [{}, { chips: 50, committedThisStreet: 10, committedThisHand: 10 }],
    );
    expect(legalActions(s, 1)).toEqual({ toCall: 30, canCheck: false, minRaiseTo: 60, maxRaiseTo: 60 });
  });

  it("heads-up preflop: the dealer posts the small blind and acts first", () => {
    const seats: Partial<PlayerState>[] = [
      { inHand: false, hasFolded: true, chips: 0 },
      { chips: 995, committedThisStreet: 5, committedThisHand: 5 },   // dealer = small blind
      { inHand: false, hasFolded: true, chips: 0 },
      { chips: 990, committedThisStreet: 10, committedThisHand: 10 }, // big blind
    ];
    const s = mk({ dealerSeat: 1, currentBet: 10, lastRaiseSize: 10, street: "preflop", toActSeat: 1 }, seats);
    expect(legalActions(s, 1)).toEqual({ toCall: 5, canCheck: false, minRaiseTo: 20, maxRaiseTo: 1000 });
    expect(legalActions(s, 3)).toBeNull(); // big blind waits
    // after the small blind calls, the big blind may check
    const s2 = mk(
      { dealerSeat: 1, currentBet: 10, lastRaiseSize: 10, street: "preflop", toActSeat: 3 },
      [seats[0], { chips: 990, committedThisStreet: 10, committedThisHand: 10 }, seats[2], seats[3]],
    );
    expect(legalActions(s2, 3)).toEqual({ toCall: 0, canCheck: true, minRaiseTo: 20, maxRaiseTo: 1000 });
  });
});