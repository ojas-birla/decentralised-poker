import { describe, it, expect } from "vitest";
import { ristretto255 } from "@noble/curves/ed25519.js";
import { generatePadlock, lockCard, unlockCard, commitPadlock, verifyCommitment, type Padlock } from "../padlock";
import { lockAndShuffle } from "../shuffle";
import { verifyReveal } from "../verify";
import { CARD_POINTS, cardIndexFromPoint } from "../cards";

const newPad = () => generatePadlock(crypto.getRandomValues(new Uint8Array(64)));
function randInt(max: number): number {           // rejection sampling, no modulo bias
  const limit = Math.floor(0x100000000 / max) * max;
  const b = new Uint32Array(1);
  do crypto.getRandomValues(b); while (b[0] >= limit);
  return b[0] % max;
}

describe("cards", () => {
  it("52 distinct valid points", () => {
    expect(CARD_POINTS.length).toBe(52);
    expect(new Set(CARD_POINTS).size).toBe(52);
    for (const p of CARD_POINTS) {
      expect(p).toMatch(/^[0-9a-f]{64}$/);
      expect(() => ristretto255.Point.fromHex(p)).not.toThrow();
    }
  });
  it("index round-trips", () => {
    CARD_POINTS.forEach((p, i) => expect(cardIndexFromPoint(p)).toBe(i));
  });
});

describe("padlock", () => {
  it("generates 300 valid padlocks without throwing", () => {
    for (let i = 0; i < 300; i++) expect(newPad().scalar > 0n).toBe(true);
  });
  it("lock/unlock round-trip", () => {
    const a = newPad(), c = CARD_POINTS[7];
    expect(unlockCard(lockCard(c, a), a)).toBe(c);
  });
  it("commutes in both unlock orders", () => {
    const [a, b] = [newPad(), newPad()], c = CARD_POINTS[3];
    const locked = lockCard(lockCard(c, a), b);
    expect(unlockCard(unlockCard(locked, a), b)).toBe(c);
    expect(unlockCard(unlockCard(locked, b), a)).toBe(c);
    expect(lockCard(lockCard(c, b), a)).toBe(locked);   // lock order irrelevant too
  });
  it("wrong padlock does not recover a card", () => {
    const [a, wrong] = [newPad(), newPad()];
    const out = unlockCard(lockCard(CARD_POINTS[0], a), wrong);
    expect(cardIndexFromPoint(out)).toBeUndefined();
  });
  it("randInt is roughly uniform", () => {
    const counts = new Array(52).fill(0);
    for (let i = 0; i < 52000; i++) counts[randInt(52)]++;
    for (const c of counts) { expect(c).toBeGreaterThan(800); expect(c).toBeLessThan(1200); }
  });
});

describe("commitment", () => {
  it("binds padlock, table and hand", () => {
    const p = newPad(), c = commitPadlock(p, "7", 3);
    expect(verifyCommitment(c, p, "7", 3)).toBe(true);
    expect(verifyCommitment(c, p, "7", 4)).toBe(false);
    expect(verifyCommitment(c, p, "8", 3)).toBe(false);
    expect(verifyCommitment(c, newPad(), "7", 3)).toBe(false);
  });
});

describe("shuffle", () => {
  it("locks, permutes, and rejects wrong size", () => {
    const a = newPad();
    const out = lockAndShuffle([...CARD_POINTS], a, randInt);
    expect(out.length).toBe(52);
    expect(new Set(out).size).toBe(52);
    expect(out.some(p => CARD_POINTS.includes(p))).toBe(false);       // all actually locked
    const back = out.map(p => cardIndexFromPoint(unlockCard(p, a)));
    expect([...back].sort((x, y) => x! - y!)).toEqual([...Array(52).keys()]);
    expect(() => lockAndShuffle(out.slice(1), a, randInt)).toThrow();
  });
  it("one shuffle step is fast enough", () => {
    const t = performance.now();
    lockAndShuffle([...CARD_POINTS], newPad(), randInt);
    const ms = performance.now() - t;
    console.log("shuffle step ms:", ms);
    expect(ms).toBeLessThan(2000);
  });
});

// ---- full 4-player game ----
function playHand(tamper?: (deck: string[], pads: Padlock[]) => void) {
  const pads = [newPad(), newPad(), newPad(), newPad()];
  let deck = [...CARD_POINTS];
  for (const p of pads) deck = lockAndShuffle(deck, p, randInt);
  tamper?.(deck, pads);

  const cards: (number | undefined)[] = [];
  const intermediates: string[] = [];           // value with only the owner's padlock left
  for (let i = 0; i < 13; i++) {
    const owner = i < 8 ? Math.floor(i / 2) : -1;  // 0..3 hole, -1 board
    let v = deck[i];
    for (let s = 0; s < 4; s++) if (s !== owner) v = unlockCard(v, pads[s]);
    intermediates.push(v);
    if (owner >= 0) v = unlockCard(v, pads[owner]);
    cards.push(cardIndexFromPoint(v));
  }
  return { pads, deck, cards, intermediates };
}

describe("full 4-player hand", () => {
  it("deals 13 distinct valid cards (x5 hands)", () => {
    for (let h = 0; h < 5; h++) {
      const { cards } = playHand();
      expect(cards.every(c => c !== undefined)).toBe(true);
      expect(new Set(cards).size).toBe(13);
    }
  });

  it("showdown reveal verifies and rejects lies", () => {
    const { pads, cards, intermediates } = playHand();
    const commit = commitPadlock(pads[0], "7", 1);
    const base = { revealedPadlockHex: pads[0].hex, commitmentHex: commit, tableId: "7",
                   handNumber: 1, lockedCardHex: intermediates[0], claimedCardIndex: cards[0]! };
    expect(verifyReveal(base)).toEqual({ ok: true });
    expect(verifyReveal({ ...base, revealedPadlockHex: "0x" + pads[0].hex })).toEqual({ ok: true });
    expect(verifyReveal({ ...base, claimedCardIndex: (cards[0]! + 1) % 52 }))
      .toEqual({ ok: false, reason: "WRONG_CARD" });
    expect(verifyReveal({ ...base, revealedPadlockHex: pads[1].hex }))
      .toEqual({ ok: false, reason: "BAD_COMMITMENT" });
    expect(verifyReveal({ ...base, handNumber: 2 }))
      .toEqual({ ok: false, reason: "BAD_COMMITMENT" });
    expect(verifyReveal({ ...base, claimedCardIndex: 99 }))
      .toEqual({ ok: false, reason: "NOT_A_CARD" });
  });
});

describe("cheaters", () => {
  it("duplicate card in a shuffle is detectable", () => {
    const [a, b] = [newPad(), newPad()];
    const d1 = lockAndShuffle([...CARD_POINTS], a, randInt);
    const d2 = lockAndShuffle(d1, b, randInt);
    expect(new Set(d2).size).toBe(52);   // honest deck: all distinct
    d2[5] = d2[9];                       // cheater copies a card
    expect(new Set(d2).size).toBe(51);   // duplicate shows up
  });
  it("card locked with a rogue padlock decodes to NOT_A_CARD", () => {
    const rogue = newPad();
    const { cards } = playHand((deck) => { deck[3] = lockCard(deck[3], rogue); });
    expect(cards[3]).toBeUndefined();                // engine must map this to an abort
  });
  it("wrong unlock yields an unknown point, not a crash", () => {
    const out = unlockCard(lockCard(CARD_POINTS[0], newPad()), newPad());
    expect(cardIndexFromPoint(out)).toBeUndefined();
  });
});