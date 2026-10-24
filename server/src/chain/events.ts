import { Interface, type Log } from "ethers";
import type { Seat } from "@poker/shared";
import { POKER_ABI } from "../../../shared/contract";

export type ChainEvent = { txHash: string; logIndex: number; blockNumber: number } & (
  | { type: "TableCreated"; tableId: string; creator: string; buyInWei: bigint; handCount: number }
  | { type: "PlayerJoined"; tableId: string; seat: Seat; wallet: string; sessionKey: string }
  | { type: "TableStarted"; tableId: string }
  | { type: "TableCancelled"; tableId: string }
  | { type: "EmergencyRefund"; tableId: string }
  | { type: "CheckpointSubmitted"; tableId: string; checkpointNumber: number }
  | { type: "Finalized"; tableId: string; checkpointNumber: number }
);

export const pokerInterface = new Interface(POKER_ABI);

const lc = (s: unknown) => String(s).toLowerCase();

/** Turns one raw log into a ChainEvent. Returns null for events we don't use (for example Withdrawn). */
export function decodeLog(
  log: Pick<Log, "topics" | "data" | "transactionHash" | "index" | "blockNumber">
): ChainEvent | null {
  let parsed;
  try {
    parsed = pokerInterface.parseLog({ topics: [...log.topics], data: log.data });
  } catch {
    return null;
  }
  if (!parsed) return null;

  const base = { txHash: log.transactionHash.toLowerCase(), logIndex: log.index, blockNumber: log.blockNumber };
  const a = parsed.args;

  switch (parsed.name) {
    case "TableCreated":
      return {
        ...base, type: "TableCreated", tableId: a.tableId.toString(), creator: lc(a.creator),
        buyInWei: a.buyIn as bigint, handCount: Number(a.handCount),
      };
    case "PlayerJoined":
      return {
        ...base, type: "PlayerJoined", tableId: a.tableId.toString(), seat: Number(a.seat) as Seat,
        wallet: lc(a.wallet), sessionKey: lc(a.sessionKey),
      };
    case "TableStarted":
      return { ...base, type: "TableStarted", tableId: a.tableId.toString() };
    case "TableCancelled":
      return { ...base, type: "TableCancelled", tableId: a.tableId.toString() };
    case "EmergencyRefund":
      return { ...base, type: "EmergencyRefund", tableId: a.tableId.toString() };
    case "CheckpointSubmitted":
      return { ...base, type: "CheckpointSubmitted", tableId: a.tableId.toString(), checkpointNumber: Number(a.checkpointNumber) };
    case "Finalized":
      return { ...base, type: "Finalized", tableId: a.tableId.toString(), checkpointNumber: Number(a.checkpointNumber) };
    default:
      return null;
  }
}
