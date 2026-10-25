import { generatePadlock, from32Hex, to32Hex, type Padlock } from "./padlock";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const padlockKey = (tableId: string, hand: number) => `padlock:${tableId}:${hand}`;

export function loadPadlock(storage: KeyValueStorage, tableId: string, hand: number): Padlock | null {
  const raw = storage.getItem(padlockKey(tableId, hand));
  if (!raw) return null;
  try {
    const scalar = from32Hex(raw);
    return { scalar, hex: to32Hex(scalar) };
  } catch {
    return null; // corrupt entry
  }
}

/** Returns the existing padlock, or makes and stores a new one. Safe to call twice (React strict mode). */
export function loadOrCreatePadlock(
  storage: KeyValueStorage,
  tableId: string,
  hand: number,
  randomBytes: (n: number) => Uint8Array,
): Padlock {
  const existing = loadPadlock(storage, tableId, hand);
  if (existing) return existing;
  const p = generatePadlock(randomBytes(64));
  storage.setItem(padlockKey(tableId, hand), p.hex);
  return p;
}
