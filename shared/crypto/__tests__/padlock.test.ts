import { test, expect } from "vitest";
import { ristretto255 } from "@noble/curves/ed25519.js";
import {
  generatePadlock, lockCard, unlockCard, to32Hex, from32Hex,
  commitPadlock, verifyCommitment,
} from "../padlock";

const ORDER = ristretto255.Point.Fn.ORDER;
const card0 = ristretto255.Point.BASE.toHex(); // stand-in for a card point

test("round-trip lock/unlock", () => {
  const p = generatePadlock(crypto.getRandomValues(new Uint8Array(64)));
  expect(unlockCard(lockCard(card0, p), p)).toBe(card0);
});

test("commutative unlock (order A,B)", () => {
  const pA = generatePadlock(crypto.getRandomValues(new Uint8Array(64)));
  const pB = generatePadlock(crypto.getRandomValues(new Uint8Array(64)));
  const once = lockCard(lockCard(card0, pA), pB);
  const ab = unlockCard(unlockCard(once, pA), pB);
  const ba = unlockCard(unlockCard(once, pB), pA);
  expect(ab).toBe(card0);
  expect(ba).toBe(card0);
});

test("identity padlock is rejected", () => {
  const zero = { scalar: 0n, hex: to32Hex(0n) };
  expect(() => lockCard(card0, zero)).toThrow();
});

test("hex round-trip", () => {
  const n = 12345678901234567890n % ORDER;
  expect(from32Hex(to32Hex(n))).toBe(n);
});

test("commitment is salted and bound", () => {
  const p = generatePadlock(crypto.getRandomValues(new Uint8Array(64)));
  const c1 = commitPadlock(p, "table-1", 3);
  expect(verifyCommitment(c1, p, "table-1", 3)).toBe(true);
  expect(verifyCommitment(c1, p, "table-1", 4)).toBe(false);
  expect(verifyCommitment(c1, p, "table-2", 3)).toBe(false);
});