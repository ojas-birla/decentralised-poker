// D2: session key lifecycle (SPEC-2.1 section 8, D2).
// A session key is a throw-away secp256k1 wallet made in the browser. Its ADDRESS is
// registered on-chain in createTable/joinTable; its PRIVATE KEY silently signs every
// game message and checkpoint (no MetaMask pop-up). If the private key is lost, that
// seat can never sign again, so it is persisted in localStorage.
//
// Rules:
//  - Call these only inside effects or click handlers, never during render
//    (localStorage does not exist on the server).
//  - Strict mode runs effects twice: the module-level cache + "read before create"
//    guarantee one key per (wallet, table).
//  - Never log or display the private key.
import { Wallet } from "ethers";

const PENDING = "pending";
const cache = new Map<string, Wallet>();

const storageKey = (wallet: string, tableId: string) =>
  `poker:sk:${wallet.toLowerCase()}:${tableId}`;

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // storage blocked: the key then only lives for this tab
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function removeStored(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Returns the session key for this wallet + table, creating and saving it if needed.
 * Use tableId "pending" BEFORE a table exists (create flow), then call
 * promotePendingKey() once the real tableId is known.
 */
export function getOrCreateSessionKey(wallet: string, tableId: string = PENDING): Wallet {
  const key = storageKey(wallet, tableId);

  const cached = cache.get(key);
  if (cached) return cached;

  let sk: Wallet | null = null;
  const stored = readStored(key);
  if (stored) {
    try {
      sk = new Wallet(stored);
    } catch {
      sk = null; // corrupt value: fall through and make a new one
    }
  }
  if (!sk) {
    sk = new Wallet(Wallet.createRandom().privateKey);
    writeStored(key, sk.privateKey);
  }
  cache.set(key, sk);
  return sk;
}

/** Create flow: rename the "pending" key to the real tableId after TableCreated. */
export function promotePendingKey(wallet: string, tableId: string): void {
  const from = storageKey(wallet, PENDING);
  const to = storageKey(wallet, tableId);

  const sk = cache.get(from) ?? (readStored(from) ? new Wallet(readStored(from) as string) : null);
  if (!sk) return;

  writeStored(to, sk.privateKey);
  cache.set(to, sk);
  removeStored(from);
  cache.delete(from);
}

/** Read-only lookup (no creation). Used when re-entering a table after a reload. */
export function loadSessionKey(wallet: string, tableId: string): Wallet | null {
  const key = storageKey(wallet, tableId);
  const cached = cache.get(key);
  if (cached) return cached;
  const stored = readStored(key);
  if (!stored) return null;
  try {
    const sk = new Wallet(stored);
    cache.set(key, sk);
    return sk;
  } catch {
    return null;
  }
}