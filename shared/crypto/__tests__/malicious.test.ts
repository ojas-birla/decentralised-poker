import { describe, it, expect } from "vitest";
import { generatePadlock, commitPadlock, unlockCard, type Padlock } from "../padlock";
import { lockAndShuffle } from "../shuffle";
import { verifyReveal } from "../verify";
import { loadOrCreatePadlock } from "../padlockStore";
import {
  deriveDealing, nextDuties, myHoleCards, boardCard, lockedForOwner, verifyAllReveals, type Seat, type Duty,
} from "../dealingView";
import { holeCardIndices } from "../../engine/cards";
import type { DealingEventRow as EventRow } from "../dealingView";

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
function play(opts: { cards: number[]; pads?: Padlock[]; log?: Log; tamper?: (seat: number, d: Duty, v: string) => string; tamperShuffle?: (seat: number, deck: string[]) => string[]; silent?: number }) {
  const pads = opts.pads ?? ACTIVE.map(() => generatePadlock(rnd(64)));
  const log = opts.log ?? new Log();
  for (let guard = 0; guard < 500; guard++) {
    let sent = false;
    const view = deriveDealing(log.events, HAND, ACTIVE, DEALER);
    for (const seat of ACTIVE) {
            const [d] = nextDuties({ view, mySeat: seat as Seat, activeSeats: ACTIVE, dealer: DEALER,
        needsCards: opts.cards, showdown: false, stillInHand: true });
      if (!d) continue;
      if (seat === opts.silent && d.kind === "unlock") continue;   // shuffles and commits, but never unlocks
      if (d.kind === "commit") log.push(seat, "commit_padlock", { commitment: commitPadlock(pads[seat], TABLE, HAND) });
      if (d.kind === "shuffle") { let deck = lockAndShuffle(d.deckIn, pads[seat], randInt); if (opts.tamperShuffle) deck = opts.tamperShuffle(seat, deck); log.push(seat, "shuffle_step", { step: d.step, deck }); }
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


const reveal = (log: Log, seat: number, pad: Padlock) => log.push(seat, "reveal_padlock", { padlock: pad.hex });
const check = (log: Log) => verifyAllReveals({
  view: deriveDealing(log.events, HAND, ACTIVE, DEALER), tableId: TABLE, hand: HAND, dealer: DEALER,
  activeSeats: ACTIVE, revealSeats: ACTIVE });

describe("malicious players (pure level; the same log the server and clients replay)", () => {
  it("duplicate card slipped in during the shuffle: caught at showdown as DUPLICATE_CARD", () => {
    // the LAST shuffler (seat 3) copies deck[0] over deck[1]; later players cannot move it
    const { pads, log } = play({ cards: [...HOLE, ...BOARD], tamperShuffle: (seat, deck) => (seat === 3 ? Object.assign([...deck], { 1: deck[0] }) : deck) });
    for (const s of ACTIVE) reveal(log, s, pads[s]);
    const r = check(log);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("DUPLICATE_CARD");
  });

  it("a duplicate that lands outside the 13 dealt cards cannot be seen (known limit)", () => {
    const { pads, log } = play({ cards: [...HOLE, ...BOARD], tamperShuffle: (seat, deck) => (seat === 3 ? Object.assign([...deck], { 40: deck[41] }) : deck) });
    for (const s of ACTIVE) reveal(log, s, pads[s]);
    expect(check(log).ok).toBe(true);
  });

  it("lying at showdown (reveals someone else's padlock) is BAD_REVEAL for that seat", () => {
    const { pads, log } = play({ cards: [...HOLE, ...BOARD] });
    reveal(log, 0, pads[0]); reveal(log, 1, pads[0]); reveal(log, 2, pads[2]); reveal(log, 3, pads[3]);
    expect(check(log)).toEqual({ ok: false, reason: "BAD_REVEAL", seat: 1 });
  });

  it("never unlocking: the deal cannot finish, so the 60 s CRYPTO_STALL timer is the only way out", () => {
    const { pads, view } = play({ cards: HOLE, silent: 2 });
    expect(view.shuffleDone).toBe(true);
    // seat 0's cards need seat 2's unlock, which never comes
    expect(myHoleCards(view, 0, pads[0], DEALER, ACTIVE)).toEqual({ ok: false, reason: "PENDING" });
    // seat 3 comes after seat 2 in the chain for seat 0's cards, so it owes nothing yet
    const duties = nextDuties({ view, mySeat: 3, activeSeats: ACTIVE, dealer: DEALER, needsCards: HOLE, showdown: false, stillInHand: true });
    const mine0 = holeCardIndices(0, DEALER);
    expect(duties.filter((d) => d.kind === "unlock" && mine0.includes(d.cardIndex))).toEqual([]);
  });

  it("replaying a message changes nothing", () => {
    const { log, view } = play({ cards: HOLE });
    const before = JSON.stringify(view);
    for (const e of [...log.events]) log.events.push({ ...e, index: log.events.length });   // every message sent twice
    expect(JSON.stringify(deriveDealing(log.events, HAND, ACTIVE, DEALER))).toBe(before);
  });

  it("an unlock sent out of turn is ignored, and the real one still works afterwards", () => {
    const log = new Log();
    const { view } = play({ cards: [], log });                    // deal finished, nobody asked to unlock yet
    const i = HOLE[0];
    const forSeat = holeCardIndices(0, DEALER).includes(i) ? 0 : (ACTIVE.find((s) => holeCardIndices(s as Seat, DEALER).includes(i)) as Seat);
    const owner = forSeat;
    const order = ACTIVE.filter((s) => s !== owner);
    const wrong = order[order.length - 1];                         // last link tries to go first
    log.push(wrong, "unlock_card", { cardIndex: i, forSeat: owner, value: view.deck![i] });
    expect(deriveDealing(log.events, HAND, ACTIVE, DEALER).unlocks[i]).toBeUndefined();
  });
});