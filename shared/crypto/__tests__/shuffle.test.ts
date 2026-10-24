import { describe, test, expect } from "vitest";
import { generatePadlock, lockCard, unlockCard, type Padlock } from "../padlock";
import { CARD_POINTS } from "../cards";
import {
  lockAndShuffle,
  verifyNoDuplicates,
  verifyDeckShape,
  verifyFinalDeck,
} from "../shuffle";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const rng = () => crypto.getRandomValues(new Uint8Array(64));
const randInt = (max: number) => crypto.getRandomValues(new Uint32Array(1))[0] % max;
const HEX32 = /^[0-9a-f]{64}$/;

// ===========================================================================
// lockAndShuffle — argument validation
// ===========================================================================
describe("lockAndShuffle — argument validation", () => {
  test("rejects deck that is not 52 cards (too few)", () => {
    const padlock = generatePadlock(rng());
    expect(() => lockAndShuffle(CARD_POINTS.slice(0, 51), padlock, randInt))
      .toThrow(/52/);
  });

  test("rejects deck that is not 52 cards (too many)", () => {
    const padlock = generatePadlock(rng());
    expect(() =>
      lockAndShuffle([...CARD_POINTS, CARD_POINTS[0]], padlock, randInt),
    ).toThrow(/52/);
  });

  test("rejects empty deck", () => {
    const padlock = generatePadlock(rng());
    expect(() => lockAndShuffle([], padlock, randInt)).toThrow(/52/);
  });

  test("rejects an invalid padlock (lockCard throws through)", () => {
    const badPadlock = { scalar: 0n, hex: "0".repeat(64) };
    expect(() =>
      lockAndShuffle([...CARD_POINTS], badPadlock as any, randInt),
    ).toThrow(/scalar out of|invalid padlock/i);
  });
});

// ===========================================================================
// lockAndShuffle — output shape
// ===========================================================================
describe("lockAndShuffle — output shape", () => {
  test("returns 52 strings, all 32-byte hex", () => {
    const padlock = generatePadlock(rng());
    const out = lockAndShuffle([...CARD_POINTS], padlock, randInt);

    expect(out).toHaveLength(52);
    for (const c of out) {
      expect(typeof c).toBe("string");
      expect(c).toMatch(HEX32);
    }
  });

  test("output is a different array than input (no aliasing)", () => {
    const padlock = generatePadlock(rng());
    const input = [...CARD_POINTS];
    const out = lockAndShuffle(input, padlock, randInt);
    expect(out).not.toBe(input);
  });

  test("input deck is not mutated", () => {
    const padlock = generatePadlock(rng());
    const input = [...CARD_POINTS];
    const snapshot = [...input];
    lockAndShuffle(input, padlock, randInt);
    expect(input).toEqual(snapshot);
  });

  test("every output is a lockCard() of some input; all distinct", () => {
    const padlock = generatePadlock(rng());
    const input = [...CARD_POINTS];
    const out = lockAndShuffle(input, padlock, randInt);

    const expectedLocks = new Set(input.map((c) => lockCard(c, padlock)));
    for (const c of out) expect(expectedLocks.has(c)).toBe(true);
    expect(new Set(out).size).toBe(52);
  });
});

// ===========================================================================
// lockAndShuffle — the 3rd argument (randInt)
// ===========================================================================
describe("lockAndShuffle — the 3rd argument (randInt)", () => {
  test("randInt is called exactly 51 times (Fisher-Yates on 52 items)", () => {
    const padlock = generatePadlock(rng());
    let calls = 0;
    const spyRandInt = (max: number) => {
      calls++;
      expect(max).toBeGreaterThanOrEqual(2);
      expect(max).toBeLessThanOrEqual(52);
      return 0;
    };
    lockAndShuffle([...CARD_POINTS], padlock, spyRandInt);
    expect(calls).toBe(51);
  });

  test("randInt is called with strictly descending max (52 → 2)", () => {
    const padlock = generatePadlock(rng());
    const maxes: number[] = [];
    const spyRandInt = (max: number) => {
      maxes.push(max);
      return 0;
    };
    lockAndShuffle([...CARD_POINTS], padlock, spyRandInt);

    expect(maxes).toHaveLength(51);
    expect(maxes[0]).toBe(52);
    expect(maxes[maxes.length - 1]).toBe(2);
    for (let k = 0; k < maxes.length; k++) {
      expect(maxes[k]).toBe(52 - k);
    }
  });

  test("deterministic randInt → deterministic output", () => {
    const padlock = generatePadlock(rng());
    const fixed = (_max: number) => 0;
    const a = lockAndShuffle([...CARD_POINTS], padlock, fixed);
    const b = lockAndShuffle([...CARD_POINTS], padlock, fixed);
    expect(a).toEqual(b);
  });

  test("randInt always returning max-1 preserves order (after locking)", () => {
    // j = i for every step → no swaps → order unchanged
    const padlock = generatePadlock(rng());
    const input = [...CARD_POINTS];
    const out = lockAndShuffle(input, padlock, (max) => max - 1);
    const lockedInput = input.map((c) => lockCard(c, padlock));
    expect(out).toEqual(lockedInput);
  });

  test("randInt returning out of range throws", () => {
    const padlock = generatePadlock(rng());
    expect(() => lockAndShuffle([...CARD_POINTS], padlock, () => 999))
      .toThrow(/out-of-range/i);
  });
});

// ===========================================================================
// lockAndShuffle — crypto correctness
// ===========================================================================
describe("lockAndShuffle — crypto correctness", () => {
  test("full 52-card deck can be fully unlocked back to originals", () => {
    const padlock = generatePadlock(rng());
    const shuffled = lockAndShuffle([...CARD_POINTS], padlock, randInt);
    const unlocked = shuffled.map((c) => unlockCard(c, padlock));

    expect(new Set(unlocked)).toEqual(new Set(CARD_POINTS));
    expect(unlocked).toHaveLength(52);
  });

  test("without the padlock, output is not any original card", () => {
    const padlock = generatePadlock(rng());
    const out = lockAndShuffle([...CARD_POINTS], padlock, randInt);
    for (const c of out) expect(CARD_POINTS).not.toContain(c);
  });

  test("two padlocks: unlock order independent", () => {
    const pA = generatePadlock(rng());
    const pB = generatePadlock(rng());
    const once = lockAndShuffle([...CARD_POINTS], pA, randInt);
    const twice = lockAndShuffle(once, pB, randInt);

    const ab = twice.map((c) => unlockCard(unlockCard(c, pA), pB));
    const ba = twice.map((c) => unlockCard(unlockCard(c, pB), pA));

    expect(new Set(ab)).toEqual(new Set(CARD_POINTS));
    expect(new Set(ba)).toEqual(new Set(CARD_POINTS));
  });
});

// ===========================================================================
// 1.20 — Full 4-player shuffle + deal + board
// ===========================================================================
describe("4-player simulation (1.20)", () => {
  test("shuffle through 4 players, deal 2 hole + 5 board, no duplicates", () => {
    const padlocks: Padlock[] = Array.from({ length: 4 }, () => generatePadlock(rng()));

    // Sequential lock + shuffle: seat 0 → 3
    let deck: string[] = [...CARD_POINTS];
    for (const p of padlocks) deck = lockAndShuffle(deck, p, randInt);
    expect(deck).toHaveLength(52);

    // Hole cards: seat X gets the other 3 to unlock, then unlocks privately
    const holes: string[][] = [[], [], [], []];
    for (let seat = 0; seat < 4; seat++) {
      for (let i = 0; i < 2; i++) {
        const idx = seat * 2 + i;
        let card = deck[idx];
        for (let other = 0; other < 4; other++) {
          if (other === seat) continue;
          card = unlockCard(card, padlocks[other]);
        }
        card = unlockCard(card, padlocks[seat]);
        holes[seat].push(card);
      }
    }

    // Board: 5 cards, all 4 unlock each
    const board: string[] = [];
    for (let b = 0; b < 5; b++) {
      let card = deck[8 + b];
      for (let p = 0; p < 4; p++) card = unlockCard(card, padlocks[p]);
      board.push(card);
    }

    // Assertions
    const dealt = [...holes.flat(), ...board];
    expect(dealt).toHaveLength(13);
    expect(new Set(dealt).size).toBe(13);
    for (const c of dealt) {
      expect(CARD_POINTS).toContain(c);
      expect(c).toMatch(HEX32);
    }
  });
});

// ===========================================================================
// 1.21 — Cheat detection
// ===========================================================================
describe("cheat detection (1.21)", () => {
  test("duplicate card in the final deck is detected", () => {
    const padlocks: Padlock[] = Array.from({ length: 4 }, () => generatePadlock(rng()));
    let deck = [...CARD_POINTS];
    for (const p of padlocks) deck = lockAndShuffle(deck, p, randInt);

    deck[1] = deck[0]; // malicious duplicate

    expect(() => verifyNoDuplicates(deck)).toThrow(/duplicate/i);
  });

  test("wrong unlock does not recover the original card", () => {
    const pA = generatePadlock(rng());
    const pB = generatePadlock(rng());
    const original = CARD_POINTS[7];

    const locked = lockCard(original, pA);
    const attackerResult = unlockCard(locked, pB);

    expect(attackerResult).not.toBe(original);
    expect(CARD_POINTS).not.toContain(attackerResult);
  });

  test("verifyNoDuplicates: clean deck passes", () => {
    expect(() => verifyNoDuplicates([...CARD_POINTS])).not.toThrow();
  });

  test("verifyNoDuplicates: error names both indices", () => {
    const deck = [...CARD_POINTS];
    deck[10] = deck[3];
    let msg = "";
    try {
      verifyNoDuplicates(deck);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/duplicate/i);
    expect(msg).toContain(CARD_POINTS[3]);
    expect(msg).toContain("3");
    expect(msg).toContain("10");
  });
});

// ===========================================================================
// Wire-format validators (Phase 3.1 relay guards)
// ===========================================================================
describe("verifyDeckShape / verifyFinalDeck", () => {
  test("rejects non-52 length", () => {
    expect(() => verifyDeckShape(["a"])).toThrow(/52/);
    expect(() => verifyDeckShape("not-array")).toThrow(/52/);
  });

  test("rejects bad hex (0x prefix / wrong length)", () => {
    const bad = [...CARD_POINTS];
    (bad as any)[0] = "0xdeadbeef";
    expect(() => verifyDeckShape(bad)).toThrow(/32-byte hex/);
  });

  test("accepts a clean deck", () => {
    expect(() => verifyDeckShape([...CARD_POINTS])).not.toThrow();
  });

  test("verifyFinalDeck = shape + no duplicates", () => {
    expect(() => verifyFinalDeck([...CARD_POINTS])).not.toThrow();

    const dup = [...CARD_POINTS];
    dup[1] = dup[0];
    expect(() => verifyFinalDeck(dup)).toThrow(/duplicate/i);
  });
});