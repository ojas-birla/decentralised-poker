// SPEC-2.1 §7 C1 / §4.1: envelope signing. Implemented ONCE here; nobody re-implements it.
import { keccak256, toUtf8Bytes, SigningKey, recoverAddress } from "ethers";
import type { Envelope } from "./types";

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