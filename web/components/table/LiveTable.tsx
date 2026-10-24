"use client";

import { useMemo, useState } from "react";
import type { Envelope, EventRow, GameState, PlayerPresence } from "@poker/shared";
import WalletBar from "@/components/WalletBar";
import { useWallet } from "@/components/WalletProvider";
import { useTable, type TablePhase } from "@/hooks/useTable";
import { useTableInfo, type TableInfo } from "@/hooks/useTableInfo";
import { useAutoMessages } from "@/hooks/useAutoMessages";
import { useLastResult } from "@/hooks/useLastResult";
import { toBetPayload, toTableView } from "@/lib/gameToView";
import { ConnectionState, TableNotice, buildBanner, buildLog } from "@/lib/statusLog";
import type { PlayerAction } from "@/lib/tableView";
import { SeatView, WaitingRoomState, isWaitingState } from "@/lib/waitingRoom";
import { weiToEth } from "@/lib/createTable";
import HandResultPanel from "./HandResultPanel";
import PokerTable from "./PokerTable";
import StatusBanner from "./StatusBanner";
import WaitingRoom from "./WaitingRoom";

function connectionFor(phase: TablePhase): ConnectionState {
  switch (phase) {
    case "live":
      return "connected";
    case "reconnecting":
      return "reconnecting";
    case "waiting_seat":
      return "waiting_seat";
    default:
      return "connecting";
  }
}

function buildRoom(
  tableId: string,
  state: GameState,
  info: TableInfo | null,
  players: PlayerPresence[],
  events: EventRow[]
): WaitingRoomState {
  const seats: SeatView[] = [0, 1, 2, 3].map((i) => {
    const fromInfo = info?.seats.find((s) => s.seat === i);
    const wallet = (fromInfo?.wallet || state.seats[i].wallet || "").toLowerCase();
    const readyDone = events.some(
      (e) =>
        e.kind === "envelope" &&
        (e.body as Envelope).type === "ready" &&
        (e.body as Envelope).seat === i
    );
    return {
      address: wallet || null,
      connected: players.find((p) => p.seat === i)?.connected ?? false,
      deposited: fromInfo ? fromInfo.deposited : wallet !== "",
      ready: readyDone,
    };
  });
  return {
    tableId,
    state: state.tableState,
    buyInWei: info?.buyInWei ?? "0",
    hands: info?.totalHands ?? 0,
    seats,
  };
}

export default function LiveTable({ tableId }: { tableId: string }) {
  const { address } = useWallet();
  const session = useTable(tableId);
  const info = useTableInfo(tableId);
  const { checkpointError } = useAutoMessages({
    tableId,
    session,
    buyInWei: info?.buyInWei ?? null,
  });
  const [actionError, setActionError] = useState<string | null>(null);

  const { phase, state, mySeat, players, timer, events, abort, pending, send } = session;
  const log = useMemo(() => buildLog(events), [events]);
  const lastResult = useLastResult(state); // must stay above the early returns below (rules of hooks)

  let notice: TableNotice | null = null;
  if (checkpointError) notice = { kind: "checkpoint_mismatch" };
  else if (state?.aborted) notice = { kind: "hand_aborted", reason: state.aborted.reason };
  else if (abort && state && abort.handNumber === state.handNumber) {
    notice = { kind: "hand_aborted", reason: abort.reason };
  }
  const banner = buildBanner(connectionFor(phase), notice);

  const header = <h1 className="text-2xl font-bold">Table #{tableId}</h1>;

  async function onAction(a: PlayerAction) {
    if (pending) return;
    setActionError(null);
    const ack = await send("bet_action", toBetPayload(a));
    if (!ack.ok) setActionError(ack.reject.message);
  }

  if (phase === "no_wallet") {
    return (
      <div className="space-y-4">
        {header}
        <p>Connect your wallet to open this table.</p>
        <WalletBar />
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div className="space-y-4">
        {header}
        <p role="alert" className="rounded border border-red-500 p-3 text-sm text-red-600">
          {session.error}
        </p>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="space-y-4">
        {header}
        <StatusBanner banner={banner} />
        <p className="text-sm text-gray-600">Loading table…</p>
      </div>
    );
  }

  if (isWaitingState(state.tableState)) {
    return (
      <div className="space-y-4">
        <StatusBanner banner={banner} />
        <WaitingRoom room={buildRoom(tableId, state, info, players, events)} myAddress={address} />
      </div>
    );
  }

  if (state.tableState === "finished") {
    const buyIn = info && /^\d+$/.test(info.buyInWei) ? BigInt(info.buyInWei) : 0n;
    return (
      <div className="space-y-4">
        {header}
        <StatusBanner banner={banner} />
        {lastResult.visible && lastResult.result && (
          <HandResultPanel result={lastResult.result} mySeat={mySeat} onDismiss={lastResult.dismiss} />
        )}
        <p className="text-lg font-semibold">Game finished</p>
        <p className="text-lg font-semibold">Game finished</p>
        <ul className="space-y-1 text-sm">
          {state.seats.map((p, i) => (
            <li key={i}>
              Seat {i + 1}
              {mySeat === i ? " (you)" : ""}: {p.chips} chips
              {buyIn > 0n && <> · {weiToEth(((BigInt(p.chips) * buyIn) / 1000n).toString())} test ETH</>}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (state.tableState === "aborted") {
    return (
      <div className="space-y-4">
        {header}
        <StatusBanner banner={banner} />
        <p className="text-sm">This table was aborted.</p>
      </div>
    );
  }

  const view = toTableView({
    state,
    mySeat,
    players,
    timer,
    totalHands: info?.totalHands ?? 0,
  });

  return (
    <div className="space-y-3">
      {lastResult.visible && lastResult.result && (
        <HandResultPanel result={lastResult.result} mySeat={mySeat} onDismiss={lastResult.dismiss} />
      )}
      <PokerTable view={view} log={log} banner={banner} onAction={onAction} />
      {pending && <p className="text-sm text-gray-600">Sending…</p>}
      {actionError && (
        <p role="alert" className="rounded border border-red-500 p-3 text-sm text-red-600">
          {actionError}
        </p>
      )}
    </div>
  );
}