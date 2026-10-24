// D3: real createTable / joinTable transactions (SPEC-2.1 section 8, D3).
// MetaMask pops up for these two only. A deposit IS the join transaction, so once the
// receipt is confirmed the player is seated and deposited on-chain.
import { BrowserProvider, Contract } from "ethers";
import { POKER_ABI, POKER_ADDRESS } from "@poker/shared/contract";
import { getEthereum } from "@/lib/chain";

export const EXPLORER_TX_URL = "https://sepolia.basescan.org/tx/";

export interface TxProgress {
  stage: "wallet" | "confirming";
  hash?: string;
}

const STATUS_OPEN = 1; // contract enum Status { None, Open, Started, ... }

async function getContract(): Promise<Contract> {
  const eth = getEthereum();
  if (!eth) throw new Error("MetaMask not found. Install it from metamask.io.");
  const provider = new BrowserProvider(eth);
  const signer = await provider.getSigner();
  return new Contract(POKER_ADDRESS, POKER_ABI, signer);
}

/** Finds the tableId (decimal string) in the TableCreated log of a receipt. */
function tableIdFromReceipt(
  contract: Contract,
  logs: ReadonlyArray<{ address: string; topics: ReadonlyArray<string>; data: string }>
): string | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== POKER_ADDRESS.toLowerCase()) continue;
    try {
      const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "TableCreated") return (parsed.args.tableId as bigint).toString();
    } catch {
      /* not one of our events */
    }
  }
  return null;
}

export interface CreateTableArgs {
  buyInWei: string; // decimal string, divisible by 1000 (validated by parseCreateForm)
  hands: number;
  sessionKey: string; // address of the session key
}

export async function createTable(
  args: CreateTableArgs,
  onProgress?: (p: TxProgress) => void
): Promise<{ tableId: string; txHash: string }> {
  const contract = await getContract();
  const buyIn = BigInt(args.buyInWei);

  onProgress?.({ stage: "wallet" });
  const tx = await contract.createTable(buyIn, args.hands, args.sessionKey, { value: buyIn });

  onProgress?.({ stage: "confirming", hash: tx.hash });
  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error("The transaction failed on-chain.");

  const tableId = tableIdFromReceipt(contract, receipt.logs);
  if (!tableId) {
    throw new Error(
      `The transaction was confirmed but no table id was found. Check ${EXPLORER_TX_URL}${tx.hash}`
    );
  }
  return { tableId, txHash: tx.hash };
}

export interface JoinTableArgs {
  tableId: string; // decimal string
  sessionKey: string; // address of the session key
  wallet: string; // lowercase, the connected account
}

export async function joinTable(
  args: JoinTableArgs,
  onProgress?: (p: TxProgress) => void
): Promise<{ txHash: string }> {
  const contract = await getContract();

  // Read the table first: the deposit must equal the buy-in exactly (WRONG_BUYIN otherwise).
  const t = await contract.getTable(BigInt(args.tableId));
  if (Number(t.status) !== STATUS_OPEN) throw new Error("This table is full or no longer open.");
  const players = (t.players as string[]).map((p) => p.toLowerCase());
  if (players.includes(args.wallet.toLowerCase())) {
    throw new Error("You already have a seat at this table.");
  }
  const buyIn = t.buyIn as bigint;

  onProgress?.({ stage: "wallet" });
  const tx = await contract.joinTable(BigInt(args.tableId), args.sessionKey, { value: buyIn });

  onProgress?.({ stage: "confirming", hash: tx.hash });
  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error("The transaction failed on-chain.");
  return { txHash: tx.hash };
}

// Revert strings from the contract -> text for the player (SPEC-D section 7.9).
const REVERT_TEXT: Record<string, string> = {
  BUYIN_NOT_DIVISIBLE_BY_1000: "Buy-in must be divisible by 1000 wei.",
  NO_HANDS: "Choose at least 1 hand.",
  WRONG_BUYIN: "The deposit must equal the table's buy-in.",
  BAD_SESSION_KEY: "Session key problem. Reload the page and try again.",
  SESSION_KEY_TAKEN: "Session key problem. Reload the page and try again.",
  NOT_OPEN: "This table is full or no longer open.",
  ALREADY_SEATED: "You already have a seat at this table.",
};

/** Turns any ethers / MetaMask error into one readable sentence. */
export function describeTxError(e: unknown): string {
  const err = e as {
    code?: number | string;
    reason?: string;
    shortMessage?: string;
    message?: string;
    info?: { error?: { code?: number } };
  };

  if (err?.code === "ACTION_REJECTED" || err?.code === 4001 || err?.info?.error?.code === 4001) {
    return "Transaction rejected in MetaMask. Nothing was sent.";
  }
  if (err?.code === "INSUFFICIENT_FUNDS") {
    return "Not enough test ETH in this account for the deposit plus gas.";
  }
  if (err?.code === -32002) return "A MetaMask request is already open. Check the MetaMask pop-up.";

  const text = [err?.reason, err?.shortMessage, err?.message].filter(Boolean).join(" ");
  for (const [name, msg] of Object.entries(REVERT_TEXT)) {
    if (text.includes(name)) return msg;
  }
  if (/network|chain/i.test(text) && /changed|mismatch|wrong/i.test(text)) {
    return "Wrong network. Switch to Base Sepolia and try again.";
  }
  return err?.shortMessage ?? err?.reason ?? err?.message ?? "The transaction failed.";
}