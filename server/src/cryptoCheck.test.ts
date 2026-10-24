import { test as t } from "vitest";
import assert from "node:assert/strict";
import { startHand } from "@poker/shared";
import type { Envelope, EventRow, GameState, PlayerState, Seat } from "@poker/shared";
import { expectedForSeat, unlockOrder } from "@poker/shared/crypto/dealingView";
import { CARD_POINTS } from "@poker/shared/crypto/cards";
import { checkCryptoMessage } from "./cryptoCheck";

// The 52 card points are real, distinct curve points. Anything else counts as "not a point" in these tests.
const isValidPoint = (h: string) => CARD_POINTS.includes(h);
const BAD_POINT = "ff".repeat(32);

const mk = (i: number): PlayerState => ({
  seat: i as Seat, wallet: "0x" + i, sessionKey: "0xk" + i, chips: 1000, inHand: false,
  hasFolded: false, isAllIn: false, committedThisStreet: 0, committedThisHand: 0,
  hasActedThisStreet: false, evicted: false, connected: true,
});
const baseState = (): GameState => ({
  tableId: "1", tableState: "ready", handNumber: 0, checkpointNumber: 0,
  seats: [mk(0), mk(1), mk(2), mk(3)], dealerSeat: 0, blinds: { small: 5, big: 10 },
  board: [], holeCards: [[], [], [], []], pots: [], awards: [], toActSeat: null,
  currentBet: 0, lastRaiseSize: 10, street: "preflop", deck: null, needsCards: null,
});

/** A table in "dealing" (Phase 3) plus a log we grow by hand. Every accepted message is appended, like ingest does. */
class Table {
  state: GameState;
  rows: EventRow[] = [];
  private seq = [0, 0, 0, 0];
  active: number[];
  constructor(mutate?: (s: GameState) => void) {
    const b = baseState();
    mutate?.(b);
    const r = startHand(b);
    if ("error" in r) throw new Error(r.error);
    this.state = r;
    this.active = r.seats.filter(p => p.inHand).map(p => p.seat);
  }
  env(seat: number, type: string, payload: unknown): Envelope {
    return { tableId: "1", handNumber: this.state.handNumber, seq: this.seq[seat] + 1, sender: "0x" + seat, seat: seat as Seat, type, payload, sig: "" } as Envelope;
  }
  check(seat: number, type: string, payload: unknown) {
    return checkCryptoMessage({ state: this.state, rows: this.rows, env: this.env(seat, type, payload), isValidPoint });
  }
  /** check, and if accepted, append it to the log */
  send(seat: number, type: string, payload: unknown) {
    const env = this.env(seat, type, payload);
    const r = checkCryptoMessage({ state: this.state, rows: this.rows, env, isValidPoint });
    if (!r) { this.rows.push({ index: this.rows.length, kind: "envelope", handNumber: env.handNumber, body: env }); this.seq[seat]++; }
    return r;
  }
  commitAll() { for (const s of this.active) assert.equal(this.send(s, "commit_padlock", { commitment: "ab".repeat(32) }), null); }
  shuffleAll() { this.active.forEach((s, step) => assert.equal(this.send(s, "shuffle_step", { step, deck: [...CARD_POINTS] }), null)); }
  unlockChain(position: number, stopBefore = 0) {
    const forSeat = expectedForSeat(position, this.state.dealerSeat, this.active)!;
    const order = unlockOrder(forSeat, this.active);
    order.slice(0, order.length - stopBefore).forEach((seat, k) =>
      assert.equal(this.send(seat, "unlock_card", { cardIndex: position, forSeat, value: CARD_POINTS[k] }), null));
  }
}
const code = (r: { code: string } | null) => (r ? r.code : "OK");

t("everything is accepted in order, up to all hole cards", () => {
  const T = new Table();
  T.commitAll();
  T.shuffleAll();
  T.state.needsCards!.forEach(i => T.unlockChain(i));
  assert.equal(T.rows.length, 4 + 4 + 8 * 3);
});

t("commits may arrive in any seat order", () => {
  const T = new Table();
  for (const s of [2, 0, 3, 1]) assert.equal(T.send(s, "commit_padlock", { commitment: "cd".repeat(32) }), null);
});

t("a second commitment from the same seat is rejected", () => {
  const T = new Table();
  assert.equal(T.send(0, "commit_padlock", { commitment: "ab".repeat(32) }), null);
  assert.equal(code(T.check(0, "commit_padlock", { commitment: "cd".repeat(32) })), "ILLEGAL_ACTION");
});

t("a shuffle before every commitment is in is rejected", () => {
  const T = new Table();
  T.send(0, "commit_padlock", { commitment: "ab".repeat(32) });
  assert.equal(code(T.check(0, "shuffle_step", { step: 0, deck: [...CARD_POINTS] })), "ILLEGAL_ACTION");
});

t("shuffle out of order: wrong seat, or wrong step number", () => {
  const T = new Table();
  T.commitAll();
  assert.equal(code(T.check(1, "shuffle_step", { step: 0, deck: [...CARD_POINTS] })), "ILLEGAL_ACTION"); // not seat 1's turn
  assert.equal(code(T.check(0, "shuffle_step", { step: 1, deck: [...CARD_POINTS] })), "ILLEGAL_ACTION"); // right seat, wrong index
  assert.equal(T.send(0, "shuffle_step", { step: 0, deck: [...CARD_POINTS] }), null);
  assert.equal(code(T.check(0, "shuffle_step", { step: 0, deck: [...CARD_POINTS] })), "ILLEGAL_ACTION"); // twice
});

t("busted seat: step is the INDEX in the active order, not the seat number", () => {
  const T = new Table(b => { b.seats[1].chips = 0; }); // seat 1 busted -> active seats [0, 2, 3]
  assert.deepEqual(T.active, [0, 2, 3]);
  T.commitAll();
  assert.equal(T.send(0, "shuffle_step", { step: 0, deck: [...CARD_POINTS] }), null);
  // seat 2 is the second shuffler: step 1 (the old rule "step === seat" would have demanded 2)
  assert.equal(T.send(2, "shuffle_step", { step: 1, deck: [...CARD_POINTS] }), null);
  assert.equal(T.send(3, "shuffle_step", { step: 2, deck: [...CARD_POINTS] }), null);
  // the busted seat takes no part at all
  assert.equal(code(T.check(1, "commit_padlock", { commitment: "ab".repeat(32) })), "ILLEGAL_ACTION");
});

t("a shuffle deck with an invalid or repeated point is BAD_PAYLOAD", () => {
  const T = new Table();
  T.commitAll();
  const withBad = [...CARD_POINTS]; withBad[17] = BAD_POINT;
  const withRepeat = [...CARD_POINTS]; withRepeat[5] = withRepeat[4];
  assert.equal(code(T.check(0, "shuffle_step", { step: 0, deck: withBad })), "BAD_PAYLOAD");
  assert.equal(code(T.check(0, "shuffle_step", { step: 0, deck: withRepeat })), "BAD_PAYLOAD");
});

t("unlock: a card that is not in needsCards is rejected (no early flop)", () => {
  const T = new Table();
  T.commitAll(); T.shuffleAll();
  const r = T.check(0, "unlock_card", { cardIndex: 8, forSeat: "board", value: CARD_POINTS[0] });
  assert.equal(code(r), "ILLEGAL_ACTION");
});

t("unlock: wrong sender / out of order, and an invalid point", () => {
  const T = new Table();
  T.commitAll(); T.shuffleAll();
  const pos = T.state.needsCards![0];
  const forSeat = expectedForSeat(pos, T.state.dealerSeat, T.active)!;
  const order = unlockOrder(forSeat, T.active);
  const wrongSender = order[1]; // second in the chain tries to go first
  assert.equal(code(T.check(wrongSender, "unlock_card", { cardIndex: pos, forSeat, value: CARD_POINTS[0] })), "ILLEGAL_ACTION");
  assert.equal(code(T.check(forSeat as number, "unlock_card", { cardIndex: pos, forSeat, value: CARD_POINTS[0] })), "ILLEGAL_ACTION"); // the owner never sends
  assert.equal(code(T.check(order[0], "unlock_card", { cardIndex: pos, forSeat, value: BAD_POINT })), "BAD_PAYLOAD");
  assert.equal(T.send(order[0], "unlock_card", { cardIndex: pos, forSeat, value: CARD_POINTS[0] }), null);
  assert.equal(code(T.check(order[0], "unlock_card", { cardIndex: pos, forSeat, value: CARD_POINTS[1] })), "ILLEGAL_ACTION"); // again
});

t("unlock with the wrong forSeat is rejected", () => {
  const T = new Table();
  T.commitAll(); T.shuffleAll();
  const pos = T.state.needsCards![0];
  const forSeat = expectedForSeat(pos, T.state.dealerSeat, T.active) as number;
  const lie = (forSeat + 1) % 4;
  const first = unlockOrder(forSeat as Seat, T.active)[0];
  assert.equal(code(T.check(first, "unlock_card", { cardIndex: pos, forSeat: lie, value: CARD_POINTS[0] })), "ILLEGAL_ACTION");
});

t("reveal_padlock: only from a live seat, once", () => {
  const T = new Table();
  T.state = { ...T.state, tableState: "showdown", needsCards: null, seats: T.state.seats.map(s => ({ ...s })) as GameState["seats"] };
  T.state.seats[0].hasFolded = true;
  assert.equal(code(T.check(0, "reveal_padlock", { padlock: "12".repeat(32) })), "ILLEGAL_ACTION"); // folded
  assert.equal(T.send(1, "reveal_padlock", { padlock: "12".repeat(32) }), null);
  assert.equal(code(T.check(1, "reveal_padlock", { padlock: "34".repeat(32) })), "ILLEGAL_ACTION"); // second reveal
});

t("a message for another hand number never changes this hand's view", () => {
  const T = new Table();
  const env = { ...T.env(0, "commit_padlock", { commitment: "ab".repeat(32) }), handNumber: 99 } as Envelope;
  const r = checkCryptoMessage({ state: T.state, rows: T.rows, env, isValidPoint });
  assert.equal(code(r), "ILLEGAL_ACTION");
});