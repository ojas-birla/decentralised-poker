import { describe, expect, it } from "vitest";
import type { GameState, PlayerPresence, Seat } from "@poker/shared";
import { cardName } from "@poker/shared/engine/cards";
import { chipsAddUp, toBetPayload, toTableView } from "./gameToView";

type Player = GameState["seats"][number];

function player(seat: Seat, over: Partial<Player> = {}): Player {
  return {
    seat,
    wallet: "0x" + String(seat + 1).repeat(40),
    sessionKey: "0x" + String(seat + 5).repeat(40),
    chips: 1000,
    inHand: true,
    hasFolded: false,
    isAllIn: false,
    committedThisStreet: 0,
    committedThisHand: 0,
    hasActedThisStreet: false,
    evicted: false,
    connected: true,
    ...over,
  };
}

function makeState(seats: GameState["seats"], over: Partial<GameState> = {}): GameState {
  return {
    tableId: "7",
    tableState: "betting",
    handNumber: 1,
    checkpointNumber: 0,
    seats,
    dealerSeat: 0,
    blinds: { small: 5, big: 10 },
    board: [],
    holeCards: [[], [], [], []],
    pots: [],
    awards: [],
    toActSeat: null,
    currentBet: 0,
    lastRaiseSize: 10,
    street: "preflop",
    deck: null,
    needsCards: null,
    ...over,
  };
}

const NO_PLAYERS: PlayerPresence[] = [];

// Preflop, blinds posted, seat 3 to act. What a client at seat 3 receives (only its own cards).
function preflop(): GameState {
  return makeState(
    [
      player(0),
      player(1, { chips: 995, committedThisStreet: 5, committedThisHand: 5 }),
      player(2, { chips: 990, committedThisStreet: 10, committedThisHand: 10 }),
      player(3),
    ],
    {
      toActSeat: 3,
      currentBet: 10,
      holeCards: [[], [], [], [6, 7]],
    }
  );
}

describe("toTableView", () => {
  it("preflop with blinds: bets are in front, pot is 0, chips add up to 4000", () => {
    const view = toTableView({ state: preflop(), mySeat: 3, players: NO_PLAYERS, timer: null, totalHands: 10 });
    expect(view.pot).toBe(0);
    expect(view.seats[1].currentBet).toBe(5);
    expect(view.seats[2].currentBet).toBe(10);
    expect(chipsAddUp(view)).toBe(true);
    expect(view.totalHands).toBe(10);
    expect(view.turnSeat).toBe(3);
  });

  it("shows only my own hole cards and reveals nothing before showdown", () => {
    const view = toTableView({ state: preflop(), mySeat: 3, players: NO_PLAYERS, timer: null, totalHands: 10 });
    expect(view.myHole).toEqual([cardName(6), cardName(7)]);
    expect(view.seats.every((s) => s.revealed === undefined)).toBe(true);
  });

  it("gives legal actions only on my turn (facing the big blind)", () => {
    const mine = toTableView({ state: preflop(), mySeat: 3, players: NO_PLAYERS, timer: null, totalHands: 10 });
    expect(mine.legal).not.toBeNull();
    expect(mine.legal?.canCheck).toBe(false);
    expect(mine.legal?.toCall).toBe(10);
    expect(mine.legal?.minRaiseTo).toBe(20);
    expect(mine.legal?.maxRaiseTo).toBe(1000);

    const other = toTableView({ state: preflop(), mySeat: 0, players: NO_PLAYERS, timer: null, totalHands: 10 });
    expect(other.legal).toBeNull();
  });

  it("counts chips committed on earlier streets in the pot", () => {
    const state = makeState(
      [
        player(0, { chips: 980, committedThisHand: 20 }),
        player(1, { chips: 980, committedThisHand: 20 }),
        player(2, { chips: 990, committedThisHand: 10, hasFolded: true, inHand: false }),
        player(3),
      ],
      { street: "flop", board: [0, 1, 2], toActSeat: 0, holeCards: [[8, 9], [], [], []] }
    );
    const view = toTableView({ state, mySeat: 0, players: NO_PLAYERS, timer: null, totalHands: 10 });
    expect(view.pot).toBe(50);
    expect(view.board).toEqual([cardName(0), cardName(1), cardName(2)]);
    expect(view.seats[2].folded).toBe(true);
    expect(chipsAddUp(view)).toBe(true);
  });

  it("heads-up all-in: busted seats flagged, call is exactly my stack", () => {
    const state = makeState(
      [
        player(0, { chips: 0, isAllIn: true, committedThisStreet: 2000, committedThisHand: 2000 }),
        player(1, { chips: 0, inHand: false }),
        player(2, { chips: 2000 }),
        player(3, { chips: 0, inHand: false }),
      ],
      { toActSeat: 2, currentBet: 2000, holeCards: [[], [], [20, 21], []] }
    );
    const view = toTableView({ state, mySeat: 2, players: NO_PLAYERS, timer: null, totalHands: 10 });
    expect(view.seats[0].allIn).toBe(true);
    expect(view.seats[0].busted).toBe(false);
    expect(view.seats[0].stack).toBe(0);
    expect(view.seats[0].currentBet).toBe(2000);
    expect(view.seats[1].busted).toBe(true);
    expect(view.seats[3].busted).toBe(true);
    expect(view.legal?.toCall).toBe(2000);
    expect(view.legal?.canCheck).toBe(false);
    expect(chipsAddUp(view)).toBe(true);
  });

  it("showdown: reveals cards of non-folded seats only, no turn, no legal actions", () => {
    const state = makeState(
      [
        player(0, { chips: 900, committedThisHand: 100 }),
        player(1, { chips: 900, committedThisHand: 100 }),
        player(2, { hasFolded: true, inHand: false }),
        player(3, { hasFolded: true, inHand: false }),
      ],
      {
        tableState: "showdown",
        street: "showdown",
        board: [0, 1, 2, 3, 4],
        holeCards: [[10, 11], [12, 13], [], []],
        toActSeat: null,
      }
    );
    const view = toTableView({ state, mySeat: 0, players: NO_PLAYERS, timer: null, totalHands: 10 });
    expect(view.seats[0].revealed).toEqual([cardName(10), cardName(11)]);
    expect(view.seats[1].revealed).toEqual([cardName(12), cardName(13)]);
    expect(view.seats[2].revealed).toBeUndefined();
    expect(view.seats[3].revealed).toBeUndefined();
    expect(view.turnSeat).toBeNull();
    expect(view.turnDeadlineMs).toBeNull();
    expect(view.legal).toBeNull();
    expect(view.pot).toBe(200);
    expect(chipsAddUp(view)).toBe(true);
  });

  it("uses the timer only when it belongs to the seat that must act", () => {
    const base = { state: preflop(), mySeat: 3 as Seat, players: NO_PLAYERS, totalHands: 10 };
    expect(toTableView({ ...base, timer: { seat: 3, deadline: 12345 } }).turnDeadlineMs).toBe(12345);
    expect(toTableView({ ...base, timer: { seat: 1, deadline: 12345 } }).turnDeadlineMs).toBeNull();
    expect(toTableView({ ...base, timer: null }).turnDeadlineMs).toBeNull();
  });

  it("takes connected from presence when known, from the state otherwise", () => {
    const players: PlayerPresence[] = [{ seat: 1, wallet: "0x" + "2".repeat(40), connected: false }];
    const view = toTableView({ state: preflop(), mySeat: 3, players, timer: null, totalHands: 10 });
    expect(view.seats[1].connected).toBe(false);
    expect(view.seats[0].connected).toBe(true);
  });

  it("works for a seat that is not mine / not seated", () => {
    const view = toTableView({ state: preflop(), mySeat: null, players: NO_PLAYERS, timer: null, totalHands: 10 });
    expect(view.mySeat).toBeNull();
    expect(view.myHole).toBeNull();
    expect(view.legal).toBeNull();
  });
});

describe("toBetPayload", () => {
  it("maps UI actions to bet_action payloads", () => {
    expect(toBetPayload({ type: "fold" })).toEqual({ action: "fold" });
    expect(toBetPayload({ type: "check" })).toEqual({ action: "check" });
    expect(toBetPayload({ type: "call" })).toEqual({ action: "call" });
    expect(toBetPayload({ type: "allin" })).toEqual({ action: "allin" });
    expect(toBetPayload({ type: "raise", raiseTo: 40 })).toEqual({ action: "raise", amount: 40 });
  });
});