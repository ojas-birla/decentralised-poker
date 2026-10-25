import { test as t, expect } from "vitest";
import assert from "node:assert/strict";
import { abortHand, applyAction, computeCheckpoint, startHand, totalChips } from "./index";
import type { GameState, PlayerState, Seat } from "./index";

const mk = (i: number): PlayerState => ({ seat: i as Seat, wallet: "0x" + i, sessionKey: "0xk" + i, chips: 1000, inHand: false,
  hasFolded: false, isAllIn: false, committedThisStreet: 0, committedThisHand: 0, hasActedThisStreet: false, evicted: false, connected: true });
const base = (): GameState => ({ tableId: "1", tableState: "ready", handNumber: 0, checkpointNumber: 0,
  seats: [mk(0), mk(1), mk(2), mk(3)], dealerSeat: 0, blinds: { small: 5, big: 10 }, board: [], holeCards: [[], [], [], []],
  pots: [], awards: [], toActSeat: null, currentBet: 0, lastRaiseSize: 10, street: "preflop", deck: null, needsCards: null });
const deck = Array.from({ length: 52 }, (_, i) => i);
const ok = (r: any): GameState => { assert.ok(!("error" in r), JSON.stringify(r)); return r as GameState; };
const act = (s: GameState, seat: number, type: any, amount?: number) => ok(applyAction(s, seat as Seat, { type, amount }));
const chips = (s: GameState) => s.seats.map((p) => p.chips);
const WEI = 1_000_000_000_000n;

// a hand with real money in the pot: the first seat to act raises to 60, the next seat calls
function midHand(): GameState {
  let s = ok(startHand(base(), deck));
  s = ok(applyAction(s, s.toActSeat as Seat, { type: "raise", amount: 60 }));
  s = ok(applyAction(s, s.toActSeat as Seat, { type: "call" }));
  return s;
}

// ---------------------------------------------------------------- technical aborts (SPEC-PHASE3 D6)

t("abort in dealing: blinds go back, chips sum stays 4000", () => {
  const pre = base();
  const s = ok(startHand(pre)); // Phase 3: no deck, state is "dealing"
  assert.equal(s.tableState, "dealing");
  const a = ok(abortHand(s, "CRYPTO_STALL"));
  expect(chips(a)).toEqual(chips(pre));
  assert.equal(totalChips(a), 4000);
  assert.equal(a.seats.reduce((n, p) => n + p.chips, 0), 4000);
});

t("abort state: settlement, aborted reason set, everything cleared", () => {
  const a = ok(abortHand(ok(startHand(base())), "BAD_REVEAL"));
  assert.equal(a.tableState, "settlement");
  expect(a.aborted).toEqual({ reason: "BAD_REVEAL" });
  expect(a.board).toEqual([]);
  expect(a.holeCards).toEqual([[], [], [], []]);
  expect(a.pots).toEqual([]);
  expect(a.awards).toEqual([]);
  assert.equal(a.needsCards, null);
  assert.equal(a.toActSeat, null);
  assert.ok(a.seats.every((p) => p.committedThisHand === 0 && p.committedThisStreet === 0));
});

t("abort after a raise restores every stack", () => {
  const pre = base();
  let s = ok(startHand(pre, deck)); // dev deck: straight to betting
  s = act(s, 0, "raise", 40);
  s = act(s, 1, "call");
  assert.equal(s.tableState, "betting");
  const a = ok(abortHand(s, "DUPLICATE_CARD"));
  expect(chips(a)).toEqual(chips(pre));
  assert.equal(totalChips(a), 4000);
});

t("abort after an all-in restores every stack", () => {
  const pre = base();
  let s = ok(startHand(pre, deck));
  s = act(s, 0, "allin");
  s = act(s, 1, "allin");
  const a = ok(abortHand(s, "CRYPTO_STALL"));
  expect(chips(a)).toEqual([1000, 1000, 1000, 1000]);
});

t("abort at showdown restores every stack", () => {
  const pre = base();
  let s = ok(startHand(pre, deck));
  for (const seat of [0, 1, 2, 3]) s = act(s, seat, "allin");
  assert.equal(s.tableState, "showdown");
  const a = ok(abortHand(s, "BAD_REVEAL"));
  expect(chips(a)).toEqual(chips(pre));
  expect(a.board).toEqual([]);
});

t("unequal starting stacks come back exactly", () => {
  const pre = base();
  pre.seats[0].chips = 1100;
  pre.seats[1].chips = 900;
  const a = ok(abortHand(ok(startHand(pre)), "CRYPTO_STALL"));
  expect(chips(a)).toEqual([1100, 900, 1000, 1000]);
});

t("computeCheckpoint works on an aborted hand and returns the pre-hand balances", () => {
  const pre = base();
  pre.seats[0].chips = 1100;
  pre.seats[1].chips = 900;
  const a = ok(abortHand(ok(startHand(pre)), "CRYPTO_STALL"));
  const cp = computeCheckpoint(a, 1000n);
  assert.ok(!("error" in cp), JSON.stringify(cp));
  if ("error" in cp) return;
  assert.equal(cp.checkpointNumber, 1);
  expect(cp.balances).toEqual(["1100000", "900000", "1000000", "1000000"]);
});

t("startHand after an abort clears `aborted` and starts the next hand", () => {
  const a = ok(abortHand(ok(startHand(base())), "CRYPTO_STALL"));
  assert.equal(a.handNumber, 1);
  const next = ok(startHand(a));
  assert.equal(next.aborted, undefined);
  assert.equal(next.handNumber, 2);
  assert.equal(next.tableState, "dealing");
  assert.equal(totalChips(next), 4000);
});

t("abort is refused outside dealing, betting and showdown", () => {
  const lobby = { ...base(), tableState: "lobby" as const };
  const ready = base();
  const settled = { ...ok(startHand(base())), tableState: "settlement" as const };
  expect(abortHand(lobby, "CRYPTO_STALL")).toEqual({ error: "WRONG_STATE" });
  expect(abortHand(ready, "CRYPTO_STALL")).toEqual({ error: "WRONG_STATE" });
  expect(abortHand(settled, "CRYPTO_STALL")).toEqual({ error: "WRONG_STATE" });
});

t("the input state is not mutated", () => {
  const s = ok(startHand(base()));
  const snap = JSON.stringify(s);
  abortHand(s, "CRYPTO_STALL");
  assert.equal(JSON.stringify(s), snap);
});

// ---------------------------------------------------------------- checkpoints around aborts

t("computeCheckpoint refuses a hand in progress and an unsettled hand", () => {
  const s = midHand();
  expect(computeCheckpoint(s, WEI)).toEqual({ error: "WRONG_STATE" });
  const bad = { ...s, tableState: "settlement" as const }; // chips still committed
  expect(computeCheckpoint(bad, WEI)).toEqual({ error: "ILLEGAL_ACTION" });
});

for (const reason of ["CRYPTO_STALL", "BAD_REVEAL", "DUPLICATE_CARD"] as const) {
  t(`${reason}: rolled back, checkpoint equals the balances from before the hand`, () => {
    const a = ok(abortHand(midHand(), reason));
    expect(a.tableState).toBe("settlement");
    expect(chips(a)).toEqual([1000, 1000, 1000, 1000]);
    expect(totalChips(a)).toBe(4000);
    const cp = computeCheckpoint(a, WEI);
    assert.ok(!("error" in cp));
    if ("error" in cp) return;
    expect(cp.balances).toEqual(Array(4).fill((1000n * WEI).toString()));
    expect(cp.checkpointNumber).toBe(1);
    expect(cp.evicted).toEqual([false, false, false, false]);
  });
}

// ---------------------------------------------------------------- PLAYER_ABANDONED (SPEC.md section 3)

t("PLAYER_ABANDONED: abandoner forfeits their committed chips, others share them, abandoner evicted", () => {
  const s0 = midHand(); // two seats put in 60, the blind seats less
  const abandoner = s0.seats.findIndex((p) => p.committedThisHand >= 60) as Seat;
  const forfeit = s0.seats[abandoner].committedThisHand;
  const a = ok(abortHand(s0, "PLAYER_ABANDONED", abandoner));

  expect(a.tableState).toBe("settlement");
  expect(a.aborted).toEqual({ reason: "PLAYER_ABANDONED" });
  expect(a.seats[abandoner].evicted).toBe(true);
  expect(a.seats[abandoner].chips).toBe(1000 - forfeit); // remaining chips stay theirs
  expect(totalChips(a)).toBe(4000);
  expect(a.seats.every((p) => p.committedThisHand === 0)).toBe(true);
  const gained = a.seats.filter((p) => p.seat !== abandoner).reduce((n, p) => n + (p.chips - 1000), 0);
  expect(gained).toBe(forfeit); // everything forfeited was paid out

  const cp = computeCheckpoint(a, WEI);
  assert.ok(!("error" in cp));
  if ("error" in cp) return;
  expect(cp.evicted[abandoner]).toBe(true);
  expect(cp.balances.reduce((n, b) => n + BigInt(b), 0n)).toBe(4000n * WEI);
});

t("PLAYER_ABANDONED needs the abandoner's seat", () => {
  expect(abortHand(midHand(), "PLAYER_ABANDONED")).toEqual({ error: "BAD_PAYLOAD" });
});
