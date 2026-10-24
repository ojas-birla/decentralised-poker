// SPEC step 2.7: submit the final signed checkpoint, wait out the challenge window, finalize, withdraw.
// Everything here is a MetaMask transaction made by a PLAYER (the contract only accepts seated wallets);
// the server never holds a key, so it cannot do this for anyone.
import { BrowserProvider, Contract } from "ethers";
import { POKER_ABI, POKER_ADDRESS } from "@poker/shared/contract";
import type { Checkpoint } from "@poker/shared";
import { getEthereum } from "@/lib/chain";
import { SERVER_URL } from "@/lib/lobby";
import { getContract, type TxProgress } from "@/lib/contractTx";

// contract enum Status { None, Open, Started, Cancelled, Finalized, Refunded }
const STARTED = 2;
const CANCELLED = 3;
const FINALIZED = 4;
const REFUNDED = 5;

export interface ChainSnapshot {
  status: number;
  checkpointNumber: number; // latest checkpoint accepted on-chain (0 = none)
  challengeEnd: number;     // unix seconds, 0 = no checkpoint yet
  now: number;              // unix seconds of the newest block (the contract compares with block.timestamp)
  withdrawableWei: bigint;  // what THIS seat can still pull out
}

export type PayoutStep =
  | { kind: "loading" }
  | { kind: "submit" }
  | { kind: "wait"; secondsLeft: number }
  | { kind: "finalize" }
  | { kind: "withdraw"; amountWei: bigint }
  | { kind: "done" }
  | { kind: "unavailable"; reason: string };

/** What should the player do next? Pure, so it is unit tested. */
export function nextPayoutStep(s: ChainSnapshot, finalCheckpointNumber: number): PayoutStep {
  if (s.status === FINALIZED || s.status === CANCELLED || s.status === REFUNDED) {
    return s.withdrawableWei > 0n ? { kind: "withdraw", amountWei: s.withdrawableWei } : { kind: "done" };
  }
  if (s.status === STARTED) {
    if (s.checkpointNumber < finalCheckpointNumber) return { kind: "submit" };
    if (s.now < s.challengeEnd) return { kind: "wait", secondsLeft: s.challengeEnd - s.now };
    return { kind: "finalize" };
  }
  return { kind: "unavailable", reason: "This table is not started on-chain." };
}

export interface FinalCheckpoint {
  checkpoint: Checkpoint;
  hash: string;
  sigs: (string | null)[];
}

/** GET /api/tables/:id/checkpoint, the newest checkpoint all 4 seats signed. Null until it exists. */
export async function fetchFinalCheckpoint(tableId: string): Promise<FinalCheckpoint | null> {
  const res = await fetch(`${SERVER_URL}/api/tables/${tableId}/checkpoint`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`The server answered ${res.status} for the checkpoint.`);
  const d = (await res.json()) as FinalCheckpoint;
  if (!d?.checkpoint || !Array.isArray(d.sigs) || d.sigs.length !== 4) throw new Error("Unexpected checkpoint response.");
  return d;
}

export async function readSnapshot(tableId: string, seat: number): Promise<ChainSnapshot> {
  const eth = getEthereum();
  if (!eth) throw new Error("MetaMask not found.");
  const provider = new BrowserProvider(eth);
  const c = new Contract(POKER_ADDRESS, POKER_ABI, provider);
  const [t, w, block] = await Promise.all([
    c.getTable(BigInt(tableId)),
    c.withdrawable(BigInt(tableId), seat),
    provider.getBlock("latest"),
  ]);
  return {
    status: Number(t.status),
    checkpointNumber: Number(t.checkpointNumber),
    challengeEnd: Number(t.challengeEnd),
    now: block ? block.timestamp : Math.floor(Date.now() / 1000),
    withdrawableWei: w as bigint,
  };
}

async function send(
  call: (c: Contract) => Promise<{ hash: string; wait(n: number): Promise<{ status: number | null } | null> }>,
  onProgress?: (p: TxProgress) => void
): Promise<string> {
  const contract = await getContract();
  onProgress?.({ stage: "wallet" });
  const tx = await call(contract);
  onProgress?.({ stage: "confirming", hash: tx.hash });
  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error("The transaction failed on-chain.");
  return tx.hash;
}

export const submitFinalCheckpoint = (tableId: string, f: FinalCheckpoint, onProgress?: (p: TxProgress) => void) =>
  send(
    c =>
      c.submitCheckpoint(
        BigInt(tableId),
        f.checkpoint.checkpointNumber,
        f.checkpoint.balances.map(b => BigInt(b)),
        f.checkpoint.evicted,
        f.sigs.map(s => s ?? "0x") // an evicted seat has no signature
      ),
    onProgress
  );

export const finalizeTable = (tableId: string, onProgress?: (p: TxProgress) => void) =>
  send(c => c.finalize(BigInt(tableId)), onProgress);

export const withdrawFunds = (tableId: string, onProgress?: (p: TxProgress) => void) =>
  send(c => c.withdraw(BigInt(tableId)), onProgress);
