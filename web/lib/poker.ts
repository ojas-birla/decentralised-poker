import { BrowserProvider, Contract, Wallet, isError } from "ethers";
import { POKER_ABI, POKER_ADDRESS, POKER_CHAIN_ID } from "@poker/shared/contract";
import { getEthereum } from "@/lib/chain";

export type ChainStatus = "wallet" | "mining" | "done";
export type ChainErrorKind =
  | "NO_WALLET"
  | "WRONG_NETWORK"
  | "REJECTED"
  | "INSUFFICIENT_FUNDS"
  | "PENDING_REQUEST"
  | "REVERTED"
  | "BAD_INPUT"
  | "UNKNOWN";

export class ChainError extends Error {
  kind: ChainErrorKind;
  constructor(kind: ChainErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

const REVERT_MESSAGES: Record<string, string> = {
  WRONG_BUYIN: "The deposit must exactly match the table's buy-in.",
  NOT_OPEN: "This table doesn't exist, is full, or has already started.",
  ALREADY_SEATED: "This wallet already has a seat at this table.",
  SESSION_KEY_TAKEN: "That session key is already used at this table.",
  BUYIN_NOT_DIVISIBLE_BY_1000: "The buy-in must be divisible by 1000 wei.",
  NO_HANDS: "The hand count must be at least 1.",
  BAD_SESSION_KEY: "Invalid session key.",
};

type AnyErr = {
  code?: unknown;
  reason?: string;
  shortMessage?: string;
  message?: string;
  info?: { error?: { message?: string; code?: number } };
};

function mapError(e: unknown): ChainError {
  if (e instanceof ChainError) return e;
  const err = (e ?? {}) as AnyErr;
  const text = [err.reason, err.shortMessage, err.message, err.info?.error?.message]
    .filter(Boolean)
    .join(" ");

  if (isError(e, "ACTION_REJECTED") || err.code === 4001 || err.info?.error?.code === 4001)
    return new ChainError("REJECTED", "You cancelled the transaction in MetaMask.");
  if (isError(e, "INSUFFICIENT_FUNDS") || /insufficient funds/i.test(text))
    return new ChainError("INSUFFICIENT_FUNDS", "Not enough test ETH for the deposit plus gas.");
  if (err.code === -32002 || err.info?.error?.code === -32002)
    return new ChainError(
      "PENDING_REQUEST",
      "MetaMask already has a request open. Open the extension and finish it."
    );
  for (const key of Object.keys(REVERT_MESSAGES)) {
    if (text.includes(key)) return new ChainError("REVERTED", REVERT_MESSAGES[key]);
  }
  if (isError(e, "CALL_EXCEPTION"))
    return new ChainError(
      "UNKNOWN",
      "The network rejected the transaction. Check that you have enough test ETH and that the table is still open."
    );
  return new ChainError("UNKNOWN", err.shortMessage ?? err.message ?? "Something went wrong.");
}

// ---------- wallet + contract ----------

async function getSignerAndContract() {
  const eth = getEthereum();
  if (!eth) throw new ChainError("NO_WALLET", "MetaMask not found. Install it and reload.");
  const provider = new BrowserProvider(eth);
  const net = await provider.getNetwork();
  if (net.chainId !== BigInt(POKER_CHAIN_ID))
    throw new ChainError("WRONG_NETWORK", "Switch MetaMask to Base Sepolia first.");
  const signer = await provider.getSigner();
  const address = (await signer.getAddress()).toLowerCase();
  const contract = new Contract(POKER_ADDRESS, POKER_ABI, signer);
  return { contract, address, signer };
}

async function requireBalance(
  signer: { provider: { getBalance(a: string): Promise<bigint> } | null },
  address: string,
  needed: bigint
) {
  const balance = await signer.provider!.getBalance(address);
  if (balance < needed)
    throw new ChainError(
      "INSUFFICIENT_FUNDS",
      "Not enough test ETH for the deposit plus gas."
    );
}

// ---------- session key (plain secp256k1 key, one per table, kept in localStorage) ----------

const pendingKeyName = (addr: string) => `poker:pendingSessionKey:${addr}`;
const keyName = (tableId: string, addr: string) => `poker:sessionKey:${tableId}:${addr}`;

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage blocked */
  }
}
function lsDel(k: string) {
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

// Reuses an existing key, so a retry or a double call never creates a second one.
function getOrCreateKey(name: string): Wallet {
  const existing = lsGet(name);
  if (existing) return new Wallet(existing);
  const w = Wallet.createRandom();
  lsSet(name, w.privateKey);
  return new Wallet(w.privateKey);
}

/** Used later (step 2.1 socket code) to sign envelopes. Null if this browser has no key for the table. */
export function loadSessionKey(tableId: string, address: string): Wallet | null {
  const pk = lsGet(keyName(tableId, address.toLowerCase()));
  return pk ? new Wallet(pk) : null;
}

// ---------- helpers ----------

function findEvent(
  contract: Contract,
  receipt: { logs: readonly { address: string; topics: readonly string[]; data: string }[] },
  name: string
) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== POKER_ADDRESS.toLowerCase()) continue;
    try {
      const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed && parsed.name === name) return parsed;
    } catch {
      /* not one of our events */
    }
  }
  throw new ChainError("UNKNOWN", `The ${name} event was missing from the receipt.`);
}

// ---------- create / join ----------

export async function createTable(args: {
  buyInWei: bigint;
  handCount: number;
  onStatus?: (s: ChainStatus) => void;
}): Promise<{ tableId: string; txHash: string; sessionKeyAddress: string }> {
  const { buyInWei, handCount, onStatus } = args;
  try {
    if (buyInWei <= 0n || buyInWei % 1000n !== 0n)
      throw new ChainError("BAD_INPUT", "The buy-in must be above 0 and divisible by 1000 wei.");
    if (!Number.isInteger(handCount) || handCount < 1)
      throw new ChainError("BAD_INPUT", "The hand count must be a whole number of at least 1.");

    const { contract, address, signer } = await getSignerAndContract();
    await requireBalance(signer, address, buyInWei);
    // The table id is unknown until the transaction confirms, so the key waits under a temporary name.
    const key = getOrCreateKey(pendingKeyName(address));

    onStatus?.("wallet");
    const tx = await contract.createTable(buyInWei, handCount, key.address, { value: buyInWei });
    onStatus?.("mining");
    const receipt = await tx.wait();
    if (!receipt) throw new ChainError("UNKNOWN", "No receipt came back. Check Basescan for the transaction.");

    const tableId = findEvent(contract, receipt, "TableCreated").args.tableId.toString();
    lsSet(keyName(tableId, address), key.privateKey); // permanent copy first,
    lsDel(pendingKeyName(address)); // then drop the temporary one
    onStatus?.("done");
    return { tableId, txHash: tx.hash as string, sessionKeyAddress: key.address.toLowerCase() };
  } catch (e) {
    throw mapError(e);
  }
}

export async function joinTable(
  tableId: string,
  onStatus?: (s: ChainStatus) => void
): Promise<{ seat: number; txHash: string; sessionKeyAddress: string }> {
  try {
    if (!/^\d+$/.test(tableId)) throw new ChainError("BAD_INPUT", "Enter a valid table ID (a whole number).");

    const { contract, address, signer } = await getSignerAndContract();

    const t = await contract.getTable(tableId);
    if (t.status !== 1n) throw new ChainError("REVERTED", REVERT_MESSAGES.NOT_OPEN); // 1 = Open
    const seated = (t.players as string[]).some((p) => p.toLowerCase() === address);
    if (seated) throw new ChainError("REVERTED", REVERT_MESSAGES.ALREADY_SEATED);
    const buyIn: bigint = t.buyIn;
    await requireBalance(signer, address, buyIn);

    const key = getOrCreateKey(keyName(tableId, address));

    onStatus?.("wallet");
    const tx = await contract.joinTable(tableId, key.address, { value: buyIn });
    onStatus?.("mining");
    const receipt = await tx.wait();
    if (!receipt) throw new ChainError("UNKNOWN", "No receipt came back. Check Basescan for the transaction.");

    const seat = Number(findEvent(contract, receipt, "PlayerJoined").args.seat);
    onStatus?.("done");
    return { seat, txHash: tx.hash as string, sessionKeyAddress: key.address.toLowerCase() };
  } catch (e) {
    // A failed join leaves an unused key behind. That's harmless, and a retry reuses it.
    throw mapError(e);
  }
}