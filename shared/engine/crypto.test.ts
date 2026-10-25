import { test as t } from "vitest";
import assert from "node:assert/strict";
import { applyAction, applyCrypto, startHand, totalChips } from "./index";
import type { GameState, PlayerState, Seat } from "./index";
import { expectedForSeat, unlockOrder } from "../crypto/dealingView";
import { CARD_POINTS } from "../crypto/cards";
import { BOARD_INDICES } from "./cards";
import type { EventRow } from "../protocol";

// ---- a fake but well-formed log ---------------------------------------------------------------
// applyCrypto only reads the SHAPE of the log (who sent what, in which order), plus the final value of a
// board chain, which must be one of the 52 card points. So these tests build the log by hand and choose the
// cards themselves. That makes "a duplicate card" or "a value that is not a card" a one-liner.
const hex = (n: number) => n.toString(16).padStart(64, "0"); // any 64 lowercase hex chars is accepted

class Log {
  events: EventRow[] = [];
  private seq = [0, 0, 0, 0];
  constructor(public hand: number) {}
  push(seat: number, type: string, payload: unknown, hand = this.hand) {
    this.events.push({
      index: this.events.length, kind: "envelope", handNumber: hand,
      body: { tableId: "1", handNumber: hand, seq: ++this.seq[seat], sender: "0x" + seat, seat, type, payload, sig: "" } as any,
    });
  }
  /** commit_padlock from every active seat, then the shuffle in active-seat order (D3: step = index). */
  shuffle(active: readonly number[]) {
    for (const s of active) this.push(s, "commit_padlock", { commitment: hex(100 + s) });
    active.forEach((s, step) => this.push(s, "shuffle_step", { step, deck: Array.from({ length: 52 }, (_, i) => hex(1000 + i)) }));
  }
  /**
   * The unlock chain of one deck position. `card` is the card a BOARD position will decode to
   * (last value = that card's point). `stopBefore` leaves the last N unlocks out (a missing player).
   */
  unlock(state: GameState, position: number, o: { card?: number; stopBefore?: number; raw?: string } = {}) {
    const active = state.seats.filter(p => p.inHand).map(p => p.seat);
    const forSeat = expectedForSeat(position, state.dealerSeat, active)!;
    const order = unlockOrder(forSeat, active);
    const send = order.length - (o.stopBefore ?? 0);
    order.slice(0, send).forEach((seat, k) => {
      const last = k === order.length - 1;
      const value = last && forSeat === "board" ? (o.raw ?? CARD_POINTS[o.card ?? 0]) : hex(5000 + position * 10 + k);
      this.push(seat, "unlock_card", { cardIndex: position, forSeat, value });
    });
  }
}

// ---- state helpers ----------------------------------------------------------------------------
const mk = (i: number): PlayerState => ({
  seat: i as Seat, wallet: "0x" + i, sessionKey: "0xk" + i, chips: 1000, inHand: false,
  hasFolded: false, isAllIn: false, committedThisStreet: 0, committedThisHand: 0,
  hasActedThisStreet: false, evicted: false, connected: true,
});
const base = (): GameState => ({
  tableId: "1", tableState: "ready", handNumber: 0, checkpointNumber: 0,
  seats: [mk(0), mk(1), mk(2), mk(3)], dealerSeat: 0, blinds: { small: 5, big: 10 },
  board: [], holeCards: [[], [], [], []], pots: [], awards: [], toActSeat: null,
  currentBet: 0, lastRaiseSize: 10, street: "preflop", deck: null, needsCards: null,
});
const ok = (r: any): GameState => { assert.ok(!("error" in r), JSON.stringify(r)); return r as GameState; };
const act = (s: GameState, seat: number, type: any) => ok(applyAction(s, seat as Seat, { type }));
const apply = (s: GameState, log: Log): GameState => {
  const r = applyCrypto(s, log.events);
  assert.ok(r !== null, "applyCrypto returned null");
  return r!;
};

/** A hand that is in "dealing" with the shuffle done. */
function dealingHand(mutate?: (s: GameState) => void) {
  const b = base();
  mutate?.(b);
  const s = ok(startHand(b)); // no deck -> Phase 3
  const active = s.seats.filter(p => p.inHand).map(p => p.seat);
  const log = new Log(s.handNumber);
  log.shuffle(active);
  return { s, log, active };
}
const unlockAllHole = (s: GameState, log: Log) => s.needsCards!.forEach(i => log.unlock(s, i));

/** Everybody calls or checks until the street changes. */
function closeRound(s: GameState): GameState {
  const street = s.street;
  for (let guard = 0; guard < 20 && s.street === street && s.toActSeat !== null; guard++) {
    const p = s.seats[s.toActSeat];
    s = act(s, s.toActSeat, p.committedThisStreet < s.currentBet ? "call" : "check");
  }
  assert.notEqual(s.street, street, "the betting round did not close");
  return s;
}

// ---- tests ------------------------------------------------------------------------------------
t("dealing: all hole unlocks -> betting; needsCards cleared", () => {
  const { s, log } = dealingHand();
  unlockAllHole(s, log);
  const n = apply(s, log);
  assert.equal(n.tableState, "betting");
  assert.equal(n.needsCards, null);
  assert.equal(totalChips(n), 4000);
  assert.equal(s.tableState, "dealing"); // the input was not changed
});

t("dealing: one missing unlock does not move on", () => {
  const { s, log } = dealingHand();
  s.needsCards!.forEach((i, k) => log.unlock(s, i, { stopBefore: k === 3 ? 1 : 0 }));
  assert.equal(applyCrypto(s, log.events), null);
});

t("dealing: nothing unlocked yet -> null", () => {
  const { s, log } = dealingHand();
  assert.equal(applyCrypto(s, log.events), null);
});

t("flop, turn and river each wait, then open betting", () => {
  const { s: s0, log } = dealingHand();
  unlockAllHole(s0, log);
  let s = apply(s0, log); // betting, preflop

  s = closeRound(s); // preflop closes -> waits for the flop
  assert.deepEqual(s.needsCards, [...BOARD_INDICES.flop]);
  assert.equal(s.toActSeat, null);
  assert.equal(applyCrypto(s, log.events), null); // nobody has unlocked the flop yet

  // Only two of the three flop cards unlocked: still waiting.
  log.unlock(s, 8, { card: 10 }); log.unlock(s, 9, { card: 20 });
  assert.equal(applyCrypto(s, log.events), null);
  log.unlock(s, 10, { card: 30 });
  s = apply(s, log);
  assert.deepEqual(s.board, [10, 20, 30]);
  assert.equal(s.needsCards, null);
  assert.notEqual(s.toActSeat, null);

  s = closeRound(s); // flop closes -> waits for the turn
  assert.deepEqual(s.needsCards, [11]);
  assert.equal(applyCrypto(s, log.events), null);
  log.unlock(s, 11, { card: 40 });
  s = apply(s, log);
  assert.deepEqual(s.board, [10, 20, 30, 40]);
  assert.notEqual(s.toActSeat, null);

  s = closeRound(s); // turn closes -> waits for the river
  assert.deepEqual(s.needsCards, [12]);
  log.unlock(s, 12, { card: 50 });
  s = apply(s, log);
  assert.deepEqual(s.board, [10, 20, 30, 40, 50]);
  assert.equal(s.tableState, "betting");
  assert.equal(totalChips(s), 4000);

  s = closeRound(s); // river closes -> showdown
  assert.equal(s.tableState, "showdown");
});

t("everybody all-in: the board runs out street by street", () => {
  const { s: s0, log } = dealingHand();
  unlockAllHole(s0, log);
  let s = apply(s0, log);
  while (s.toActSeat !== null) s = act(s, s.toActSeat, "allin");
  assert.deepEqual(s.needsCards, [...BOARD_INDICES.flop]);

  // The whole board is unlocked in the log. One applyCrypto call handles one street.
  [[8, 1], [9, 2], [10, 3], [11, 4], [12, 5]].forEach(([i, c]) => log.unlock(s, i, { card: c }));
  s = apply(s, log);
  assert.deepEqual(s.board, [1, 2, 3]);
  assert.deepEqual(s.needsCards, [11]); // nobody can bet, so it moved on and waits for the turn
  s = apply(s, log);
  assert.deepEqual(s.needsCards, [12]);
  s = apply(s, log);
  assert.deepEqual(s.board, [1, 2, 3, 4, 5]);
  assert.equal(s.tableState, "showdown");
  assert.equal(totalChips(s), 4000);
});

t("a duplicate board card aborts with DUPLICATE_CARD and gives the chips back", () => {
  const { s: s0, log } = dealingHand();
  unlockAllHole(s0, log);
  let s = closeRound(apply(s0, log));
  log.unlock(s, 8, { card: 7 }); log.unlock(s, 9, { card: 7 }); log.unlock(s, 10, { card: 8 });
  const a = apply(s, log);
  assert.equal(a.tableState, "settlement");
  assert.deepEqual(a.aborted, { reason: "DUPLICATE_CARD" });
  assert.deepEqual(a.seats.map(p => p.chips), [1000, 1000, 1000, 1000]);
  assert.deepEqual(a.board, []);
});

t("a board value that is not one of the 52 cards also aborts", () => {
  const { s: s0, log } = dealingHand();
  unlockAllHole(s0, log);
  const s = closeRound(apply(s0, log));
  log.unlock(s, 8, { card: 1 }); log.unlock(s, 9, { card: 2 });
  log.unlock(s, 10, { raw: hex(424242) });
  const a = apply(s, log);
  assert.deepEqual(a.aborted, { reason: "DUPLICATE_CARD" });
});

t("a board card repeated on a later street aborts", () => {
  const { s: s0, log } = dealingHand();
  unlockAllHole(s0, log);
  let s = closeRound(apply(s0, log));
  [[8, 1], [9, 2], [10, 3]].forEach(([i, c]) => log.unlock(s, i, { card: c }));
  s = closeRound(apply(s, log));
  log.unlock(s, 11, { card: 2 }); // same as the flop's 2nd card
  assert.deepEqual(apply(s, log).aborted, { reason: "DUPLICATE_CARD" });
});

t("a busted seat is skipped (3 active players)", () => {
  const { s: s0, log, active } = dealingHand(b => { b.seats[3].chips = 0; b.seats[2].chips = 2000; });
  assert.deepEqual(active, [0, 1, 2]);
  // seat 3 is not in the log at all; the chain order is only the three active seats
  unlockAllHole(s0, log);
  assert.equal(s0.needsCards!.length, 6);
  let s = apply(s0, log);
  assert.equal(s.tableState, "betting");
  s = closeRound(s);
  [[8, 11], [9, 12], [10, 13]].forEach(([i, c]) => log.unlock(s, i, { card: c }));
  s = apply(s, log);
  assert.deepEqual(s.board, [11, 12, 13]);
  assert.equal(totalChips(s), 4000);
});

t("a folded player is still active: the board needs the folded seat's unlock too", () => {
  const { s: s0, log } = dealingHand();
  unlockAllHole(s0, log);
  let s = apply(s0, log);
  s = act(s, s.toActSeat!, "fold"); // first to act folds, but stays inHand
  s = closeRound(s);
  [8, 9].forEach(i => log.unlock(s, i, { card: i }));
  log.unlock(s, 10, { card: 10, stopBefore: 1 }); // the last seat in the chain has not unlocked
  assert.equal(applyCrypto(s, log.events), null);
});

t("applying twice returns null the second time", () => {
  const { s: s0, log } = dealingHand();
  unlockAllHole(s0, log);
  const once = apply(s0, log);
  assert.equal(applyCrypto(once, log.events), null);

  let s = closeRound(once);
  [[8, 1], [9, 2], [10, 3]].forEach(([i, c]) => log.unlock(s, i, { card: c }));
  s = apply(s, log);
  assert.equal(applyCrypto(s, log.events), null);
});

t("a log from another hand number is ignored", () => {
  const { s, log } = dealingHand();
  const other = new Log(s.handNumber + 1);
  other.shuffle([0, 1, 2, 3]);
  unlockAllHole(s, other); // full chains, but for the wrong hand
  assert.equal(applyCrypto(s, other.events), null);
  assert.equal(applyCrypto(s, log.events), null);
});

t("nothing happens on the Phase 2 dev deck, in lobby, or in settlement", () => {
  const { s, log } = dealingHand();
  unlockAllHole(s, log);
  assert.equal(applyCrypto({ ...s, deck: Array.from({ length: 52 }, (_, i) => i) }, log.events), null);
  assert.equal(applyCrypto({ ...s, tableState: "settlement" }, log.events), null);
  assert.equal(applyCrypto({ ...s, tableState: "lobby" }, log.events), null);
});