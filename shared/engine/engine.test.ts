import { test as t, expect } from "vitest";
import assert from "node:assert/strict";
import { applyAction, startHand, buildPots, resolveShowdown, revealHoleCards, totalChips, holeCardIndices } from "./index";
import type { GameState, PlayerState, Seat } from "./index";

const mk = (i: number): PlayerState => ({ seat: i as Seat, wallet: "0x"+i, sessionKey: "0xk"+i, chips: 1000, inHand: false,
  hasFolded: false, isAllIn: false, committedThisStreet: 0, committedThisHand: 0, hasActedThisStreet: false, evicted: false, connected: true });
const base = (): GameState => ({ tableId: "1", tableState: "ready", handNumber: 0, checkpointNumber: 0,
  seats: [mk(0), mk(1), mk(2), mk(3)], dealerSeat: 0, blinds: { small: 5, big: 10 }, board: [], holeCards: [[],[],[],[]],
  pots: [], awards: [], toActSeat: null, currentBet: 0, lastRaiseSize: 10, street: "preflop", deck: null, needsCards: null });
const deck = Array.from({ length: 52 }, (_, i) => i);
const ok = (r: any): GameState => { assert.ok(!("error" in r), JSON.stringify(r)); return r as GameState; };
const act = (s: GameState, seat: number, type: any, amount?: number) => ok(applyAction(s, seat as Seat, { type, amount }));

t("startHand: blinds, dealer, UTG, chip invariant", () => {
  const s = ok(startHand(base(), deck));
  assert.equal(s.dealerSeat, 1); assert.equal(s.seats[2].committedThisHand, 5); assert.equal(s.seats[3].committedThisHand, 10);
  assert.equal(s.toActSeat, 0); assert.equal(s.handNumber, 1); assert.equal(s.tableState, "betting"); assert.equal(totalChips(s), 4000);
});
t("holeCardIndices: one at a time, two rounds", () => {
  assert.deepEqual(holeCardIndices(2, 1), [0, 4]); assert.deepEqual(holeCardIndices(1, 1), [3, 7]);
});
t("BB gets its option; flop does not end after first check", () => {
  let s = ok(startHand(base(), deck));
  s = act(s, 0, "call"); s = act(s, 1, "call"); s = act(s, 2, "call");
  assert.equal(s.street, "preflop"); assert.equal(s.toActSeat, 3);
  s = act(s, 3, "check"); assert.equal(s.street, "flop"); assert.equal(s.board.length, 3); assert.equal(s.toActSeat, 2);
  s = act(s, 2, "check"); assert.equal(s.street, "flop");
  s = act(s, 3, "check"); s = act(s, 0, "check"); assert.equal(s.street, "flop");
  s = act(s, 1, "check"); assert.equal(s.street, "turn"); assert.equal(totalChips(s), 4000);
});
t("fold to one: pot awarded, 4000 chips conserved", () => {
  let s = ok(startHand(base(), deck));
  s = act(s, 0, "fold"); s = act(s, 1, "fold"); s = act(s, 2, "fold");
  assert.equal(s.tableState, "settlement"); assert.equal(s.seats[3].chips, 1005); assert.equal(totalChips(s), 4000);
});
t("validation: overbet, float, NaN, below min raise, out of turn", () => {
  const s = ok(startHand(base(), deck));
  assert.deepEqual(applyAction(s, 0, { type: "raise", amount: 5000 }), { error: "ILLEGAL_ACTION" });
  assert.deepEqual(applyAction(s, 0, { type: "raise", amount: 12.5 }), { error: "BAD_PAYLOAD" });
  assert.deepEqual(applyAction(s, 0, { type: "raise", amount: NaN }), { error: "BAD_PAYLOAD" });
  assert.deepEqual(applyAction(s, 0, { type: "raise", amount: 15 }), { error: "ILLEGAL_ACTION" });
  assert.deepEqual(applyAction(s, 1, { type: "call" }), { error: "NOT_YOUR_TURN" });
  assert.deepEqual(applyAction(s, 0, { type: "check" }), { error: "ILLEGAL_ACTION" });
  ok(applyAction(s, 0, { type: "raise", amount: 20 }));
});
t("short all-in does not change lastRaiseSize or reopen", () => {
  const b = base(); b.seats[0].chips = 15;
  let s = ok(startHand(b, deck)); // dealer->1, UTG=0 with 15 chips
  s = act(s, 0, "allin"); assert.equal(s.currentBet, 15); assert.equal(s.lastRaiseSize, 10);
});
t("everyone all-in preflop runs out to showdown", () => {
  let s = ok(startHand(base(), deck));
  s = act(s, 0, "allin"); s = act(s, 1, "allin"); s = act(s, 2, "allin"); s = act(s, 3, "allin");
  assert.equal(s.tableState, "showdown"); assert.equal(s.board.length, 5); assert.equal(totalChips(s), 4000);
});
t("side pots: 3 live (100,300,300) + folded 50", () => {
  const s = base(); const c = [100, 300, 300, 50]; s.seats.forEach((p, i) => { p.inHand = true; p.committedThisHand = c[i]; }); s.seats[3].hasFolded = true;
  const pots = buildPots(s.seats);
  assert.deepEqual(pots, [{ amount: 350, eligibleSeats: [0,1,2] }, { amount: 400, eligibleSeats: [1,2] }]);
});
t("showdown awards and conserves chips", () => {
  let s = ok(startHand(base(), deck));
  s = act(s, 0, "allin"); s = act(s, 1, "allin"); s = act(s, 2, "allin"); s = act(s, 3, "allin");
  for (let seat = 0; seat < 4; seat++) { const [a, b] = holeCardIndices(seat as Seat, s.dealerSeat); s = ok(revealHoleCards(s, seat as Seat, [deck[a], deck[b]])); }
  s = ok(resolveShowdown(s)); assert.equal(s.tableState, "settlement"); assert.equal(totalChips(s), 4000);
  assert.equal(s.awards.reduce((n, a) => n + a.amount, 0), 4000);
});
t("heads-up: dealer is SB and acts first", () => {
  const b = base(); b.seats[2].chips = 0; b.seats[3].chips = 0;
  const s = ok(startHand(b, deck)); assert.equal(s.dealerSeat, 1); assert.equal(s.seats[1].committedThisHand, 5); assert.equal(s.toActSeat, 1);
});
t("input state is not mutated", () => {
  const s0 = ok(startHand(base(), deck)); const snap = JSON.stringify(s0); act(s0, 0, "call"); assert.equal(JSON.stringify(s0), snap);
});