import { test as t } from "vitest";
import assert from "node:assert/strict";
import { applyAction, startHand, computeCheckpoint, totalChips } from "./index";
import type { GameState, PlayerState, Seat } from "./index";

const mk = (i: number): PlayerState => ({ seat: i as Seat, wallet: "0x"+i, sessionKey: "0xk"+i, chips: 1000, inHand: false,
  hasFolded: false, isAllIn: false, committedThisStreet: 0, committedThisHand: 0, hasActedThisStreet: false, evicted: false, connected: true });
const base = (): GameState => ({ tableId: "7", tableState: "ready", handNumber: 0, checkpointNumber: 0,
  seats: [mk(0), mk(1), mk(2), mk(3)], dealerSeat: 0, blinds: { small: 5, big: 10 }, board: [], holeCards: [[],[],[],[]],
  pots: [], awards: [], toActSeat: null, currentBet: 0, lastRaiseSize: 10, street: "preflop", deck: null, needsCards: null });
const deck = Array.from({ length: 52 }, (_, i) => i);
const ok = (r: any): GameState => { assert.ok(!("error" in r), JSON.stringify(r)); return r as GameState; };

t("startHand: refuses to start mid-hand (chips are not destroyed)", () => {
  const s = ok(startHand(base(), deck));
  assert.deepEqual(startHand(s, deck), { error: "WRONG_STATE" });
  assert.equal(totalChips(s), 4000);
});
t("startHand: allowed from settlement, refused from lobby/finished/aborted", () => {
  for (const st of ["lobby", "waiting_deposits", "dealing", "betting", "showdown", "finished", "aborted"] as const) {
    const b = base(); b.tableState = st;
    assert.deepEqual(startHand(b, deck), { error: "WRONG_STATE" }, st);
  }
  const b = base(); b.tableState = "settlement"; ok(startHand(b, deck));
});
t("computeCheckpoint: SPEC worked example", () => {
  const s = base(); s.tableState = "settlement"; s.checkpointNumber = 2;
  [1300, 700, 1200, 800].forEach((c, i) => (s.seats[i].chips = c));
  const cp: any = computeCheckpoint(s, 1_000_000_000_000n);
  assert.deepEqual(cp, { tableId: "7", checkpointNumber: 3,
    balances: ["1300000000000000", "700000000000000", "1200000000000000", "800000000000000"],
    evicted: [false, false, false, false] });
});
t("computeCheckpoint: after a fold-to-one hand, sums to the deposit", () => {
  let s = ok(startHand(base(), deck));
  for (const seat of [0, 1, 2]) s = ok(applyAction(s, seat as Seat, { type: "fold" }));
  const cp: any = computeCheckpoint(s, 1_000_000_000_000n);
  assert.equal(cp.balances.reduce((n: bigint, b: string) => n + BigInt(b), 0n), 4000n * 1_000_000_000_000n);
  assert.equal(cp.balances[3], "1005000000000000");
});
t("computeCheckpoint: copies evicted flags", () => {
  const s = base(); s.tableState = "settlement"; s.seats[2].evicted = true;
  const cp: any = computeCheckpoint(s, 1n); assert.deepEqual(cp.evicted, [false, false, true, false]);
});
t("computeCheckpoint: rejects mid-hand, bad wei, leftover commits, broken chip sum", () => {
  assert.deepEqual(computeCheckpoint(base(), 1n), { error: "WRONG_STATE" });
  const s = base(); s.tableState = "settlement";
  assert.deepEqual(computeCheckpoint(s, 0n), { error: "BAD_PAYLOAD" });
  s.seats[0].committedThisHand = 5;
  assert.deepEqual(computeCheckpoint(s, 1n), { error: "ILLEGAL_ACTION" });
  s.seats[0].committedThisHand = 0; s.seats[0].chips = 999;
  assert.deepEqual(computeCheckpoint(s, 1n), { error: "ILLEGAL_ACTION" });
});