"use client";

// Static-ish table facts: buy-in, total hands, deposits. Source: GET /api/tables/:id (C6).
// Until that route exists, falls back to the chain (buy-in + seated wallets only).
import { useEffect, useState } from "react";
import { BrowserProvider, Contract } from "ethers";
import type { TableState } from "@poker/shared";
import { POKER_ABI, POKER_ADDRESS } from "@poker/shared/contract";
import { SERVER_URL } from "@/lib/lobby";
import { getEthereum } from "@/lib/chain";

export interface TableInfoSeat {
  seat: number;
  wallet: string; // lowercase
  deposited: boolean;
  connected: boolean;
}
export interface TableInfo {
  tableId: string;
  state: TableState | null; // null when only the chain answered
  buyInWei: string;
  totalHands: number; // 0 = unknown (chain fallback)
  handNumber: number;
  seats: TableInfoSeat[];
  fromServer: boolean;
}

const POLL_MS = 4000;
const ZERO = "0x0000000000000000000000000000000000000000";

async function fromRest(tableId: string): Promise<TableInfo | null> {
  try {
    const res = await fetch(`${SERVER_URL}/api/tables/${tableId}`, { cache: "no-store" });
    if (!res.ok) return null;
    const d = (await res.json()) as Record<string, unknown>;
    if (typeof d.buyInWei !== "string" || !/^\d+$/.test(d.buyInWei)) return null;
    if (typeof d.totalHands !== "number" || !Array.isArray(d.seats)) return null;
    const seats = (d.seats as Array<Record<string, unknown>>)
      .filter((s) => typeof s.seat === "number" && typeof s.wallet === "string")
      .map((s) => ({
        seat: s.seat as number,
        wallet: (s.wallet as string).toLowerCase(),
        deposited: s.deposited === true,
        connected: s.connected === true,
      }));
    return {
      tableId,
      state: typeof d.state === "string" ? (d.state as TableState) : null,
      buyInWei: d.buyInWei,
      totalHands: d.totalHands,
      handNumber: typeof d.handNumber === "number" ? d.handNumber : 0,
      seats,
      fromServer: true,
    };
  } catch {
    return null;
  }
}

async function fromChain(tableId: string): Promise<TableInfo | null> {
  try {
    const eth = getEthereum();
    if (!eth) return null;
    const contract = new Contract(POKER_ABI ? POKER_ADDRESS : POKER_ADDRESS, POKER_ABI, new BrowserProvider(eth));
    const t = await contract.getTable(BigInt(tableId));
    const players = (t.players as string[]).map((p) => p.toLowerCase());
    return {
      tableId,
      state: null,
      buyInWei: (t.buyIn as bigint).toString(),
      totalHands: 0,
      handNumber: 0,
      seats: players
        .map((wallet, seat) => ({ seat, wallet, deposited: true, connected: false })) // join = deposit
        .filter((s) => s.wallet !== ZERO),
      fromServer: false,
    };
  } catch {
    return null;
  }
}

export function useTableInfo(tableId: string): TableInfo | null {
  const [info, setInfo] = useState<TableInfo | null>(null);

  // Keep polling while we only have chain data, or while the table is still filling up.
  const keepPolling =
    !info ||
    !info.fromServer ||
    info.state === "lobby" ||
    info.state === "waiting_deposits" ||
    info.state === "ready";

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next = (await fromRest(tableId)) ?? (await fromChain(tableId));
      if (!cancelled && next) setInfo(next);
    };
    load();
    const id = keepPolling ? setInterval(load, POLL_MS) : null;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [tableId, keepPolling]);

  return info;
}