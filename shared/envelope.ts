// SPEC-2.1 §7 C1 / §4.1: envelope signing. Implemented ONCE here; nobody re-implements it.
import {
  keccak256,
  toUtf8Bytes,
  SigningKey,
  recoverAddress,
  TypedDataEncoder,
  type TypedDataDomain,
  type TypedDataField,
} from "ethers";
import type { Envelope, Checkpoint } from "./types";
import { POKER_ADDRESS } from "./contract";

/** Keys sorted at every level, no whitespace. Same value rules as JSON.stringify (undefined object values are skipped). */
export function canonicalJson(value: unknown): string {
  if (value === undefined) throw new Error("canonicalJson: undefined is not serialisable");
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

// SPEC §4.1: digest = keccak256(utf8(canonicalJson({tableId, handNumber, seq, sender, seat, type, payload})))
function digestOf(f: Omit<Envelope, "sig">): string {
  const { tableId, handNumber, seq, sender, seat, type, payload } = f;
  return keccak256(
    toUtf8Bytes(canonicalJson({ tableId, handNumber, seq, sender, seat, type, payload })),
  );
}

/** `sig` = secp256k1 signature of the digest by the session key, 65-byte hex. */
export function signEnvelope(sessionPrivateKey: string, fields: Omit<Envelope, "sig">): Envelope {
  const sig = new SigningKey(sessionPrivateKey).sign(digestOf(fields)).serialized;
  return { ...fields, sig } as Envelope;
}

/** Recover the signer from the digest and compare with `sessionKeyAddress`, lowercase. Never throws. */
export function verifyEnvelope(env: Envelope, sessionKeyAddress: string): boolean {
  try {
    return recoverAddress(digestOf(env), env.sig).toLowerCase() === sessionKeyAddress.toLowerCase();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// EIP-712 checkpoints (SPEC-2.1 §7 C1 / SPEC §3)
// ---------------------------------------------------------------------------

/** SPEC §3 domain. chainId 84532 = Base Sepolia. */
export const CHECKPOINT_DOMAIN: TypedDataDomain = {
  name: "DecentralisedPoker",
  version: "1",
  chainId: 84532,
  verifyingContract: POKER_ADDRESS,
};

/** Checkpoint(uint256 tableId,uint64 checkpointNumber,uint256[4] balances,bool[4] evicted) */
export const CHECKPOINT_TYPES: Record<string, TypedDataField[]> = {
  Checkpoint: [
    { name: "tableId", type: "uint256" },
    { name: "checkpointNumber", type: "uint64" },
    { name: "balances", type: "uint256[4]" },
    { name: "evicted", type: "bool[4]" },
  ],
};

// tableId and balances are decimal strings in the repo; the encoder wants numerics.
function checkpointMessage(cp: Checkpoint) {
  return {
    tableId: BigInt(cp.tableId),
    checkpointNumber: cp.checkpointNumber,
    balances: cp.balances.map((b) => BigInt(b)),
    evicted: [...cp.evicted],
  };
}

/** Same digest under an explicit domain. Used by contracts/test (Hardhat has its own chainId/address). */
export function checkpointHashFor(domain: TypedDataDomain, cp: Checkpoint): string {
  return TypedDataEncoder.hash(domain, CHECKPOINT_TYPES, checkpointMessage(cp));
}

/** EIP-712 digest of the checkpoint (what every player signs and the contract recovers against). */
export function checkpointHash(cp: Checkpoint): string {
  return checkpointHashFor(CHECKPOINT_DOMAIN, cp);
}

export function signCheckpoint(
  sessionPrivateKey: string,
  cp: Checkpoint,
): { checkpointHash: string; signature: string } {
  const hash = checkpointHash(cp);
  return { checkpointHash: hash, signature: new SigningKey(sessionPrivateKey).sign(hash).serialized };
}

/**
 * True iff `checkpointHash` is the real hash of `cp` AND `signature` over it recovers to `sessionKeyAddress`
 * (lowercase compare). Never throws.
 */
export function verifyCheckpointSig(
  cp: Checkpoint,
  checkpointHash_: string,
  signature: string,
  sessionKeyAddress: string,
): boolean {
  try {
    if (checkpointHash(cp).toLowerCase() !== checkpointHash_.toLowerCase()) return false;
    return recoverAddress(checkpointHash_, signature).toLowerCase() === sessionKeyAddress.toLowerCase();
  } catch {
    return false;
  }
}