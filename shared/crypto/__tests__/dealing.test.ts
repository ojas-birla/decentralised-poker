import { describe, it, expect } from "vitest";
import { generatePadlock, commitPadlock, unlockCard, type Padlock } from "../padlock";
import { lockAndShuffle } from "../shuffle";
import { verifyReveal } from "../verify";
import { loadOrCreatePadlock } from "../padlockStore";
import {
  deriveDealing, nextDuties, myHoleCards, boardCard, lockedForOwner, type Seat, type Duty,
} from "../dealingView";
import { holeCardIndices } from "../../engine/cards";
import type { EventRow } from "../../protocol";

const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));
function randInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const b = new Uint32Array(1);
  do crypto.getRandomValues(b); while (b[0] >= limit);
  return b[0] % max;
}
const TABLE = "7", HAND = 1, DEALER: Seat = 3, ACTIVE = [0, 1, 2, 3];
const BOARD = [8, 9, 10, 11, 12];
const HOLE = ACTIVE.flatMap((s) => holeCardIndices(s as Seat, DEALER));

class Log {
  events: EventRow[] = [];
  seq = [0, 0, 0, 0];
  push(seat: number, type: string, payload: unknown, hand = HAND) {
    this.events.push({
      index: this.events.length, kind: "envelope", handNumber: hand,
      body: { tableId: TABLE, handNumber: hand, seq: ++this.seq[seat], sender: "0x" + seat, seat, type, payload, sig: "" } as any,
    });
  }
}

/** Every player runs the real nextDuties loop until nobody owes anything. `tamper` lets a test cheat. */
function play(opts: { cards: number[]; pads?: Padlock[]; log?: Log; tamper?: (seat: number, d: Duty, v: string) => string }) {
  const pads = opts.pads ?? ACTIVE.map(() => generatePadlock(rnd(64)));
  const log = opts.log ?? new Log();
  for (let guard = 0; guard < 500; guard++) {
    let sent = false;
    const view = deriveDealing(log.events, HAND, ACTIVE, DEALER);
    for (const seat of ACTIVE) {
      const [d] = nextDuties({ view, mySeat: seat as Seat, activeSeats: ACTIVE, dealer: DEALER,
        needsCards: opts.cards, showdown: false, stillInHand: true });
      if (!d) continue;
      if (d.kind === "commit") log.push(seat, "commit_padlock", { commitment: commitPadlock(pads[seat], TABLE, HAND) });
      if (d.kind === "shuffle") log.push(seat, "shuffle_step", { step: d.step, deck: lockAndShuffle(d.deckIn, pads[seat], randInt) });
      if (d.kind === "unlock") {
        let value = unlockCard(d.valueIn, pads[seat]);
        if (opts.tamper) value = opts.tamper(seat, d, value);
        log.push(seat, "unlock_card", { cardIndex: d.cardIndex, forSeat: d.forSeat, value });
      }
      sent = true; break;
    }
    if (!sent) break;
  }
  return { pads, log, view: deriveDealing(log.events, HAND, ACTIVE, DEALER) };
}

describe("padlockStore", () => {
  it("returns the same padlock on a second call (strict mode)", () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const a = loadOrCreatePadlock(st, "7", 1, rnd);
    const b = loadOrCreatePadlock(st, "7", 1, rnd);
    const c = loadOrCreatePadlock(st, "7", 2, rnd);
    expect(b.hex).toBe(a.hex);
    expect(c.hex).not.toBe(a.hex);
  });
});

describe("dealing from the event log", () => {
  it("deals 13 distinct valid cards using only nextDuties", () => {
    const { pads, view } = play({ cards: [...HOLE, ...BOARD] });
    const ids: number[] = [];
    for (const s of ACTIVE) {
      const r = myHoleCards(view, s as Seat, pads[s], DEALER, ACTIVE);
      expect(r.ok).toBe(true);
      if (r.ok) ids.push(...r.cards);
    }
    for (const i of BOARD) ids.push(boardCard(view, i, ACTIVE)!);
    expect(ids.length).toBe(13);
    expect(ids.every((c) => Number.isInteger(c) && c >= 0 && c < 52)).toBe(true);
    expect(new Set(ids).size).toBe(13);
  });

  it("a hole card reveal verifies with lockedForOwner", () => {
    const { pads, view } = play({ cards: HOLE });
    const r = myHoleCards(view, 1, pads[1], DEALER, ACTIVE);
    if (!r.ok) throw new Error("pending");
    const idx = holeCardIndices(1, DEALER)[0];
    const res = verifyReveal({
      revealedPadlockHex: pads[1].hex, commitmentHex: view.commitments[1], tableId: TABLE, handNumber: HAND,
      lockedCardHex: lockedForOwner(view, idx, ACTIVE)!, claimedCardIndex: r.cards[0],
    });
    expect(res).toEqual({ ok: true });
  });

  it("waits for hole cards to be requested: nobody unlocks before needsCards says so", () => {
    const { view } = play({ cards: [] });
    expect(view.shuffleDone).toBe(true);
    expect(Object.keys(view.unlocks).length).toBe(0);
  });

  it("ignores messages that arrive out of order or from the wrong seat", () => {
    const log = new Log();
    // unlock and shuffle before any commitment
    log.push(0, "unlock_card", { cardIndex: 0, forSeat: 1, value: "00".repeat(32) });
    log.push(1, "shuffle_step", { step: 0, deck: Array(52).fill("00".repeat(32)) });
    // seat 2 commits for hand 2 (wrong hand)
    log.push(2, "commit_padlock", { commitment: "0xabc" }, 2);
    let v = deriveDealing(log.events, HAND, ACTIVE, DEALER);
    expect(v.commitments).toEqual({});
    expect(v.shuffleSteps).toBe(0);
    expect(Object.keys(v.unlocks).length).toBe(0);

    // after a normal shuffle: a wrong-seat shuffle, a short deck and a wrong-seat unlock are ignored
    const played = play({ cards: [HOLE[0]] });
    const before = JSON.stringify(played.view);
    played.log.push(0, "shuffle_step", { step: 4, deck: Array(52).fill("00".repeat(32)) });
    played.log.push(2, "unlock_card", { cardIndex: HOLE[0], forSeat: 0, value: "11".repeat(32) });
    v = deriveDealing(played.log.events, HAND, ACTIVE, DEALER);
    expect(JSON.stringify(v)).toBe(before);
  });

  it("a wrong unlock makes the owner see NOT_A_CARD", () => {
    const rogue = generatePadlock(rnd(64));
    const { pads, view } = play({
      cards: HOLE,
      tamper: (seat, d, good) => (seat === 2 && d.kind === "unlock" && d.forSeat === 0 ? unlockCard(d.valueIn, rogue) : good),
    });
    const r = myHoleCards(view, 0, pads[0], DEALER, ACTIVE);
    expect(r).toEqual({ ok: false, reason: "NOT_A_CARD" });
    expect(myHoleCards(view, 1, pads[1], DEALER, ACTIVE).ok).toBe(true);
  });

  it("is idempotent after a reload: replaying the same log yields the same duties", () => {
    const { log } = play({ cards: HOLE });
    const v1 = deriveDealing(log.events, HAND, ACTIVE, DEALER);
    const v2 = deriveDealing([...log.events], HAND, ACTIVE, DEALER);
    expect(v2).toEqual(v1);
    for (const s of ACTIVE)
      expect(nextDuties({ view: v1, mySeat: s as Seat, activeSeats: ACTIVE, dealer: DEALER, needsCards: HOLE, showdown: false, stillInHand: true })).toEqual([]);
  });
});
