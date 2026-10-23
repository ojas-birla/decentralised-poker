import { test as t } from "vitest";
import assert from "node:assert/strict";
import { startHand, resolveShowdown, totalChips } from "./index";
import type { GameState, PlayerState, Seat } from "./index";

// card("As") -> id, using the same mapping as solverCardName() in streets.ts
const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
const card = (n: string) => RANKS.indexOf(n[0]) + 13 * SUITS.indexOf(n[1]);
const cards = (s: string) => s.split(" ").map(card) as [number, number];

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

// A hand sitting at showdown. commit[i] = chips seat i put in; chips = 1000 - commit.
function showdown(opts: { commit: number[]; folded?: number[]; hole: Record<number, string>; board: string; dealer?: Seat }): GameState {
  const s = base();
  s.tableState = "showdown"; s.street = "showdown"; s.dealerSeat = opts.dealer ?? 0;
  s.board = opts.board.split(" ").map(card);
  s.seats.forEach((p, i) => {
    p.inHand = true; p.committedThisHand = opts.commit[i]; p.chips = 1000 - opts.commit[i];
    p.hasFolded = (opts.folded ?? []).includes(i);
    if (opts.hole[i]) s.holeCards[i] = cards(opts.hole[i]);
  });
  assert.equal(totalChips(s), 4000);
  return s;
}
const won = (s: GameState) => [0, 1, 2, 3].map(i => s.awards.find(a => a.seat === i)?.amount ?? 0);

t("clear winner takes the whole pot", () => {
  const s = ok(resolveShowdown(showdown({
    commit: [100, 100, 100, 100], folded: [2, 3],
    hole: { 0: "As Ah", 1: "Kd Qc" }, board: "2c 7d 9h Jd 3s",
  })));
  assert.deepEqual(won(s), [400, 0, 0, 0]);
  assert.equal(s.seats[0].chips, 900 + 400);
  assert.equal(s.tableState, "settlement"); assert.equal(totalChips(s), 4000);
});

t("two-way tie splits evenly", () => {
  const s = ok(resolveShowdown(showdown({
    commit: [100, 100, 100, 100], folded: [2, 3],
    hole: { 0: "2c 3d", 1: "4h 5s" }, board: "As Kd Qh Jc Tc", // both play the broadway straight on board
  })));
  assert.deepEqual(won(s), [200, 200, 0, 0]); assert.equal(totalChips(s), 4000);
});

t("odd chip goes to the first winner left of the dealer (dealer 0 -> seat 1)", () => {
  const s = ok(resolveShowdown(showdown({
    commit: [100, 100, 5, 0], folded: [2, 3], dealer: 0,
    hole: { 0: "2c 3d", 1: "4h 5s" }, board: "As Kd Qh Jc Tc",
  }))); // pot 205
  assert.deepEqual(won(s), [102, 103, 0, 0]); assert.equal(totalChips(s), 4000);
});

t("odd chip goes to the first winner left of the dealer (dealer 1 -> seat 0)", () => {
  const s = ok(resolveShowdown(showdown({
    commit: [100, 100, 5, 0], folded: [2, 3], dealer: 1,
    hole: { 0: "2c 3d", 1: "4h 5s" }, board: "As Kd Qh Jc Tc",
  })));
  assert.deepEqual(won(s), [103, 102, 0, 0]); assert.equal(totalChips(s), 4000);
});

t("side pots: short stack wins main pot only, best of the rest wins the side pot", () => {
  const s = ok(resolveShowdown(showdown({
    commit: [100, 300, 300, 50], folded: [3],
    hole: { 0: "As Ah", 1: "Kd Kc", 2: "Qd Qc" }, board: "2c 7d 9h Jd 3s",
  })));
  assert.deepEqual(won(s), [350, 400, 0, 0]); assert.equal(totalChips(s), 4000);
});

t("side pots: short stack has the worst hand and wins nothing", () => {
  const s = ok(resolveShowdown(showdown({
    commit: [100, 300, 300, 0], folded: [3],
    hole: { 0: "Qd Qc", 1: "As Ah", 2: "Kd Kc" }, board: "2c 7d 9h Jd 3s",
  })));
  assert.deepEqual(won(s), [0, 700, 0, 0]); assert.equal(totalChips(s), 4000);
});

t("short stack posting the small blind goes all-in", () => {
  const b = base(); b.seats[2].chips = 3;
  const s = ok(startHand(b, Array.from({ length: 52 }, (_, i) => i))); // dealer 1, SB seat 2, BB seat 3
  assert.equal(s.seats[2].committedThisHand, 3); assert.equal(s.seats[2].isAllIn, true);
  assert.equal(s.currentBet, 10); assert.equal(s.toActSeat, 0); assert.equal(totalChips(s), 3 + 1000 * 3);
});

t("short stack posting the big blind: bet to call stays 10", () => {
  const b = base(); b.seats[3].chips = 4;
  const s = ok(startHand(b, Array.from({ length: 52 }, (_, i) => i)));
  assert.equal(s.seats[3].committedThisHand, 4); assert.equal(s.seats[3].isAllIn, true);
  assert.equal(s.currentBet, 10); assert.equal(s.toActSeat, 0);
});

t("both blinds all-in: nobody can act", () => {
  const b = base(); b.seats[0].chips = 0; b.seats[1].chips = 0; b.seats[2].chips = 5; b.seats[3].chips = 10;
  const s = ok(startHand(b, Array.from({ length: 52 }, (_, i) => i)));
  assert.equal(s.toActSeat, null);
});