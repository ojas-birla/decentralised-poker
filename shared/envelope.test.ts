import { describe, it, expect } from "vitest";
import { Wallet, AbiCoder, concat, id, keccak256 } from "ethers";
import {
  canonicalJson,
  signEnvelope,
  verifyEnvelope,
  checkpointHash,
  signCheckpoint,
  verifyCheckpointSig,
  CHECKPOINT_DOMAIN,
} from "./envelope";
import type { Envelope, Checkpoint } from "./types";

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

describe("EIP-712 checkpoint", () => {
  const cp: Checkpoint = {
    tableId: "7",
    checkpointNumber: 3,
    balances: ["1000", "2000", "500", "500"],
    evicted: [false, false, false, false],
  };

  it("round-trips: signCheckpoint output verifies", () => {
    const { checkpointHash: h, signature } = signCheckpoint(wallet.privateKey, cp);
    expect(h).toBe(checkpointHash(cp));
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(verifyCheckpointSig(cp, h, signature, wallet.address)).toBe(true);
    expect(verifyCheckpointSig(cp, h, signature, wallet.address.toLowerCase())).toBe(true);
  });

  it("rejects wrong signer, changed content, wrong hash, garbage signature", () => {
    const { checkpointHash: h, signature } = signCheckpoint(wallet.privateKey, cp);
    expect(verifyCheckpointSig(cp, h, signature, other.address)).toBe(false);
    expect(verifyCheckpointSig({ ...cp, balances: ["1001", "2000", "500", "500"] }, h, signature, wallet.address)).toBe(false);
    expect(verifyCheckpointSig(cp, "0x" + "00".repeat(32), signature, wallet.address)).toBe(false);
    expect(verifyCheckpointSig(cp, h, "0x1234", wallet.address)).toBe(false);
  });

  it("every field changes the hash", () => {
    const base = checkpointHash(cp);
    expect(checkpointHash({ ...cp, tableId: "8" })).not.toBe(base);
    expect(checkpointHash({ ...cp, checkpointNumber: 4 })).not.toBe(base);
    expect(checkpointHash({ ...cp, balances: ["1000", "2000", "500", "501"] })).not.toBe(base);
    expect(checkpointHash({ ...cp, evicted: [true, false, false, false] })).not.toBe(base);
  });

  it("matches a hand-built EIP-712 digest (the way OpenZeppelin EIP712 / the contract computes it)", () => {
    const abi = AbiCoder.defaultAbiCoder();
    const typeHash = id("Checkpoint(uint256 tableId,uint64 checkpointNumber,uint256[4] balances,bool[4] evicted)");
    const balancesHash = keccak256(abi.encode(["uint256[4]"], [cp.balances.map((b) => BigInt(b))]));
    const evictedHash = keccak256(abi.encode(["bool[4]"], [cp.evicted]));
    const structHash = keccak256(
      abi.encode(
        ["bytes32", "uint256", "uint64", "bytes32", "bytes32"],
        [typeHash, BigInt(cp.tableId), cp.checkpointNumber, balancesHash, evictedHash],
      ),
    );
    const domainSeparator = keccak256(
      abi.encode(
        ["bytes32", "bytes32", "bytes32", "uint256", "address"],
        [
          id("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
          id(CHECKPOINT_DOMAIN.name!),
          id(CHECKPOINT_DOMAIN.version!),
          CHECKPOINT_DOMAIN.chainId!,
          CHECKPOINT_DOMAIN.verifyingContract!,
        ],
      ),
    );
    expect(checkpointHash(cp)).toBe(keccak256(concat(["0x1901", domainSeparator, structHash])));
  });
});