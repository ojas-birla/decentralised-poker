import { ristretto255 } from "@noble/curves/ed25519.js";
import { keccak_256 } from '@noble/hashes/sha3.js';

export type Padlock = { scalar: bigint; hex: string };

/** Bigint → 64-character hex string (32 bytes), no 0x prefix, zero-padded. */
export function to32Hex(n: bigint): string {
  const h = n.toString(16);
  return h.padStart(64, "0");
}

export function from32Hex(hex: string): bigint {
  const h = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(h)) {
    throw new Error(`expected 32-byte hex (64 hex chars), got ${hex.length} chars: ${hex}`);
  }
  const n = BigInt('0x' + h);
  if (n >= ORDER) throw new Error(`scalar out of range: >= group order`);
  return n;
}
export function generatePadlock(rand: Uint8Array): Padlock {
  if (rand.length < 64) throw new Error("need >= 64 random bytes");
  let n = 0n;
  for (const b of rand) n = (n << 8n) | BigInt(b);
  const scalar = (n % (ORDER - 1n)) + 1n;      // uniform-ish in [1, ORDER-1]
  return { scalar, hex: to32Hex(scalar) };
}
// shared/crypto/padlock.ts
const ORDER = ristretto255.Point.Fn.ORDER;

/** Normalize a bigint into [1, ORDER-1]. */
function normScalar(n: bigint): bigint {
  if (n <= 0n || n >= ORDER) throw new Error("padlock scalar out of [1, ORDER-1]");
  const m = ((n % ORDER) + ORDER) % ORDER;
  return m === 0n ? 1n : m;
}

export function lockCard(cardPointHex: string, padlock: Padlock): string {
  const p = ristretto255.Point.fromHex(cardPointHex);
  const scalar = normScalar(padlock.scalar);
  
  return p.multiply(scalar).toHex();
}

/** 
 * Unlocks a card point by multiplying by the modular inverse of the scalar.
 */
export function unlockCard(lockedHex: string, padlock: Padlock): string {
  const p = ristretto255.Point.fromHex(lockedHex);
  const scalar = normScalar(padlock.scalar);
  
  // Compute the modular inverse of the scalar modulo the curve ORDER
  const invScalar = ristretto255.Point.Fn.inv(scalar);
  
  return p.multiply(invScalar).toHex();
}


// Helper to convert Uint8Array bytes cleanly into a hex string
const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export function commitPadlock(padlock: Padlock, tableId: string, handNumber: number): string {
  // Salt strings ensure a padlock cannot be reused or guessed across hands/tables
  const data = new TextEncoder().encode(`${padlock.hex}|${tableId}|${handNumber}`);
  return '0x' + toHex(keccak_256(data));
}

export function verifyCommitment(commitmentHex: string, padlock: Padlock, tableId: string, handNumber: number): boolean {
  return commitPadlock(padlock, tableId, handNumber) === commitmentHex;
}
