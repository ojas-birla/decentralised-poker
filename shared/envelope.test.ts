import { describe, it, expect } from "vitest";
import { Wallet } from "ethers";
import { canonicalJson, signEnvelope, verifyEnvelope } from "./envelope";
import type { Envelope } from "./types";

// Compile-time check: `tsc` fails here if shared/types.ts `Envelope` lacks any of these fields.
type RequiredEnvelopeKeys = "tableId" | "handNumber" | "seq" | "sender" | "seat" | "type" | "payload" | "sig";
const _envelopeHasFields: RequiredEnvelopeKeys extends keyof Envelope ? true : never = true;
void _envelopeHasFields;

const wallet = Wallet.createRandom();
const other = Wallet.createRandom();
const fields: Omit<Envelope, "sig"> = {
  tableId: "7",
  handNumber: 0,
  seq: 1,
  sender: "0x00000000000000000000000000000000000000aa",
  seat: 2,
  type: "join",
  payload: { sessionKey: wallet.address },
};

describe("canonicalJson", () => {
  it("sorts keys at every level with no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: "s" } })).toBe(
      '{"a":{"c":"s","d":[3,{"x":2,"y":1}]},"b":1}',
    );
  });
  it("does not depend on key insertion order", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it("skips undefined object values (nested too); undefined in arrays becomes null", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson({ a: { z: undefined, y: 2 } })).toBe('{"a":{"y":2}}');
    expect(canonicalJson([1, undefined])).toBe("[1,null]");
  });
  it("throws on a top-level undefined and on a bigint anywhere", () => {
    expect(() => canonicalJson(undefined)).toThrow();
    expect(() => canonicalJson(1n)).toThrow();
    expect(() => canonicalJson({ amount: 5n })).toThrow();
    expect(() => canonicalJson({ a: [{ b: 1n }] })).toThrow();
  });
});

describe("signEnvelope / verifyEnvelope", () => {
  it("round-trips; sig is 65-byte hex; address compare is case-insensitive", () => {
    const env = signEnvelope(wallet.privateKey, fields);
    expect(env.sig).toMatch(/^0x[0-9a-f]{130}$/);
    expect(verifyEnvelope(env, wallet.address)).toBe(true);
    expect(verifyEnvelope(env, wallet.address.toLowerCase())).toBe(true);
  });
  it("rejects wrong key, any changed signed field, and a garbage sig", () => {
    const env = signEnvelope(wallet.privateKey, fields);
    expect(verifyEnvelope(env, other.address)).toBe(false);
    expect(verifyEnvelope({ ...env, seq: 2 }, wallet.address)).toBe(false);
    expect(verifyEnvelope({ ...env, handNumber: 1 }, wallet.address)).toBe(false);
    expect(verifyEnvelope({ ...env, payload: { x: 1 } } as Envelope, wallet.address)).toBe(false);
    expect(verifyEnvelope({ ...env, sig: "0x1234" }, wallet.address)).toBe(false);
  });
});