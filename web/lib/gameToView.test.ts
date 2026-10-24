import { describe, expect, it } from "vitest";
import { applyAction, cardName, legalActions, resolveShowdown, startHand } from "@poker/shared";
import type { ActionType, GameState, PlayerPresence, PlayerState, Seat } from "@poker/shared";
import { chipsAddUp, toBetPayload, toTableView } from "./gameToView";

const mk = (i: number): PlayerState => ({
  seat: i as Seat, wallet: "0x" + String(i).repeat(40), sessionKey: "0xk" + i, chips: 1000,
  inHand: false, hasFolded: false, isAllIn: false, committedThisStreet: 0, committedThisHand: 0,
  hasActedThisStreet: false, evicted: false, connected: true,
});
const base = (): GameState => ({
  tableId: "1", tableState: "ready", handNumber: 0, checkpointNumber: 0,
  seats: [mk(0), mk(1), mk(2), mk(3)], dealerSeat: 0, blinds: { small: 5, big: 10 }, board: [],
  holeCards: [[], [], [], []], pots: [], awards: [], toActSeat: null, currentBet: 0,
  lastRaiseSize: 10, street: "preflop", deck: null, needsCards: null,
});
const deck = Array.from({ length: 52 }, (_, i) => i);

function ok(r: GameState | { error: string }): GameState {
  if ("error" in r) throw new Error("engine error: " + r.error);
  return r;
}
const act = (s: GameState, seat: number, type: ActionType, amount?: number) =>
  ok(applyAction(s, seat as Seat, { type, amount }));

// Mirrors server publicState(): no deck, only my hole cards, plus live seats at a real showdown.
function seenBy(state: GameState, seat: Seat): GameState {
  const s = structuredClone(state);
  s.deck = null;
  const live = (i: number) => s.seats[i].inHand && !s.seats[i].hasFolded;
  const showdown =
    (s.tableState === "showdown" || s.tableState === "settlement") &&
    s.seats.filter((_, i) => live(i)).length >= 2;
  s.holeCards = s.holeCards.map((c, i) => (i === seat || (showdown && live(i)) ? c : [])) as GameState["holeCards"];
  return s;
}

const present = (connected = [true, true, true, true]): PlayerPresence[] =>
  [0, 1, 2, 3].map((seat) => ({ seat: seat as Seat, wallet: mk(seat).wallet, connected: connected[seat] }));

const input = (state: GameState, mySeat: Seat | null, extra: Partial<Parameters<typeof toTableView>[0]> = {}) => ({
  state: mySeat === null ? state : seenBy(state, mySeat),
  mySeat,
  players: present(),
  timer: null,
  totalHands: 3,
  ...extra,
});

describe("toTableView", () => {
  it("start of hand, my turn: legal actions, own cards, deadline, chip invariant", () => {
    const s = ok(startHand(base(), deck));
    const v = toTableView(input(s, 0, { timer: { seat: 0, deadline: 123456 } }));
    expect(v.state).toBe("betting");
    expect(v.turnSeat).toBe(0);
    expect(v.turnDeadlineMs).toBe(123456);
    expect(v.pot).toBe(0);
    expect(v.legal).toEqual({ toCall: 10, canCheck: false, minRaiseTo: 20, maxRaiseTo: 1000 });
    expect(v.myHole).toEqual([cardName(s.holeCards[0][0]), cardName(s.holeCards[0][1])]);
    expect(v.seats[2].currentBet).toBe(5);
    expect(v.seats[3].currentBet).toBe(10);
    expect(v.seats[1].isDealer).toBe(true);
    expect(chipsAddUp(v)).toBe(true);
  });

  it("not my turn: no legal actions, no deadline for someone else's clock, no foreign cards", () => {
    const s = ok(startHand(base(), deck));
    const v = toTableView(input(s, 3, { timer: { seat: 1, deadline: 999 } }));
    expect(v.legal).toBeNull();
    expect(v.turnSeat).toBe(0);
    expect(v.turnDeadlineMs).toBeNull();
    expect(v.myHole).not.toBeNull();
    expect(v.seats.every((p) => p.revealed === undefined)).toBe(true);
  });

  it("without a seat: no hole cards, no legal actions", () => {
    const s = ok(startHand(base(), deck));
    const v = toTableView({ state: seenBy(s, 0), mySeat: null, players: present(), timer: null, totalHands: 3 });
    expect(v.myHole).toBeNull();
    expect(v.legal).toBeNull();
  });

  it("pot only counts chips from earlier streets; board is named", () => {
    let s = ok(startHand(base(), deck));
    s = act(s, 0, "call"); s = act(s, 1, "call"); s = act(s, 2, "call"); s = act(s, 3, "check");
    let v = toTableView(input(s, 2));
    expect(v.pot).toBe(40);
    expect(v.board).toEqual(s.board.map(cardName));
    expect(v.board).toHaveLength(3);
    expect(chipsAddUp(v)).toBe(true);

    const l = legalActions(s, 2)!;
    s = act(s, 2, "raise", l.minRaiseTo);
    v = toTableView(input(s, 2));
    expect(v.seats[2].currentBet).toBe(l.minRaiseTo);
    expect(v.pot).toBe(40);
    expect(chipsAddUp(v)).toBe(true);
  });

  it("heads-up: dealer is small blind and acts first; busted seats are flagged", () => {
    const b = base();
    b.seats[0].chips = 2000; b.seats[1].chips = 2000; b.seats[2].chips = 0; b.seats[3].chips = 0;
    const s = ok(startHand(b, deck));
    expect(s.toActSeat).toBe(1);
    const v = toTableView(input(s, 1));
    expect(v.legal).toEqual({ toCall: 5, canCheck: false, minRaiseTo: 20, maxRaiseTo: 2000 });
    expect(v.seats[2].busted).toBe(true);
    expect(v.seats[3].busted).toBe(true);
    expect(chipsAddUp(v)).toBe(true);
  });

  it("everyone all-in: showdown reveals every live seat, then settlement keeps 4000 chips", () => {
    let s = ok(startHand(base(), deck));
    s = act(s, 0, "allin"); s = act(s, 1, "allin"); s = act(s, 2, "allin"); s = act(s, 3, "allin");
    expect(s.tableState).toBe("showdown");
    let v = toTableView(input(s, 0));
    expect(chipsAddUp(v)).toBe(true);
    v.seats.forEach((p, i) => {
      expect(p.allIn).toBe(true);
      expect(p.revealed).toEqual([cardName(s.holeCards[i][0]), cardName(s.holeCards[i][1])]);
    });

    s = ok(resolveShowdown(s));
    expect(s.tableState).toBe("settlement");
    v = toTableView(input(s, 0));
    expect(v.pot).toBe(0);
    expect(v.seats.reduce((n, p) => n + p.stack, 0)).toBe(4000);
    expect(chipsAddUp(v)).toBe(true);
  });

  it("uncontested win: folded seats never show cards", () => {
    let s = ok(startHand(base(), deck));
    s = act(s, 0, "fold"); s = act(s, 1, "fold"); s = act(s, 2, "fold");
    expect(s.tableState).toBe("settlement");
    const v = toTableView(input(s, 3));
    expect([0, 1, 2].every((i) => v.seats[i].revealed === undefined)).toBe(true);
    expect(v.seats[3].stack).toBe(1005);
    expect(chipsAddUp(v)).toBe(true);
  });

  it("presence overrides the seat's own connected flag; falls back to it when absent", () => {
    const s = ok(startHand(base(), deck));
    const v = toTableView(input(s, 0, { players: present([true, true, false, true]) }));
    expect(v.seats.map((p) => p.connected)).toEqual([true, true, false, true]);
    const w = toTableView(input(s, 0, { players: [] }));
    expect(w.seats.every((p) => p.connected)).toBe(true);
  });
});

describe("toBetPayload", () => {
  it("maps UI actions to bet_action payloads (raiseTo = total bet this street)", () => {
    expect(toBetPayload({ type: "fold" })).toEqual({ action: "fold" });
    expect(toBetPayload({ type: "check" })).toEqual({ action: "check" });
    expect(toBetPayload({ type: "call" })).toEqual({ action: "call" });
    expect(toBetPayload({ type: "allin" })).toEqual({ action: "allin" });
    expect(toBetPayload({ type: "raise", raiseTo: 40 })).toEqual({ action: "raise", amount: 40 });
  });
});