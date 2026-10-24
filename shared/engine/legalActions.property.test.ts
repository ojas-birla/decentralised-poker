// SPEC-2.1 §7 C1 property test: any raise inside [minRaiseTo, maxRaiseTo] that legalActions allows
// must be accepted by the real applyAction.
import { describe, it, expect } from "vitest";
import { applyAction } from "./actions";
import { legalActions } from "./legalActions";
import type { GameState, PlayerState, Seat } from "./types";

// Deterministic PRNG so a failure is reproducible (no Math.random).
function lcg(seed: number) {
  let s = seed >>> 0;
  return (n: number) => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s % n);
}

function randomBettingState(rnd: (n: number) => number): GameState {
  // random split of 4000 chips into 4 stacks
  const cuts = [rnd(4001), rnd(4001), rnd(4001)].sort((a, b) => a - b);
  const totals = [cuts[0], cuts[1] - cuts[0], cuts[2] - cuts[1], 4000 - cuts[2]];
  const actor = rnd(4) as Seat;
  if (totals[actor] === 0) totals[actor] = 1;
  const committed = totals.map((t, i) => (i === actor ? Math.min(rnd(Math.min(t, 300)), t - 1) : rnd(Math.min(t, 300) + 1)));
  const seats = totals.map((t, i): PlayerState => ({
    seat: i as Seat, wallet: "0x" + String(i).repeat(40), sessionKey: "0x" + "a".repeat(40),
    chips: t - committed[i], inHand: true, hasFolded: false, isAllIn: t - committed[i] === 0 && committed[i] > 0,
    committedThisStreet: committed[i], committedThisHand: committed[i], hasActedThisStreet: false,
    evicted: false, connected: true,
  })) as unknown as PlayerState[];
  return {
    tableId: "1", tableState: "betting", handNumber: 1, checkpointNumber: 0,
    seats: seats as GameState["seats"], dealerSeat: 0, blinds: { small: 5, big: 10 },
    board: [], holeCards: [[0, 1], [2, 3], [4, 5], [6, 7]], pots: [], awards: [],
    toActSeat: actor, currentBet: Math.max(...committed), lastRaiseSize: 10 + rnd(190), street: "preflop",
    deck: Array.from({ length: 52 }, (_, i) => i), needsCards: null, // dev-only server deck, as startHand leaves it
  };
}

describe("legalActions vs applyAction (property)", () => {
  it("every raise amount legalActions allows is accepted by applyAction", () => {
    const rnd = lcg(20260424);
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const state = randomBettingState(rnd);
      const seat = state.toActSeat as Seat;
      const la = legalActions(state, seat)!;
      if (la.maxRaiseTo <= state.currentBet) continue; // no raise possible, only call/fold/all-in
      const amounts = new Set([la.minRaiseTo, la.maxRaiseTo, Math.floor((la.minRaiseTo + la.maxRaiseTo) / 2)]);
      if (la.minRaiseTo + 1 <= la.maxRaiseTo) amounts.add(la.minRaiseTo + 1);
      for (const amount of amounts) {
        let outcome: unknown = "ok";
        try {
          const r = applyAction(state, seat, { type: "raise", amount });
          if ("error" in r) outcome = { amount, error: r.error, la, currentBet: state.currentBet, lastRaiseSize: state.lastRaiseSize };
        } catch (e) {
          outcome = { amount, threw: String(e), la };
        }
        expect(outcome).toBe("ok");
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});