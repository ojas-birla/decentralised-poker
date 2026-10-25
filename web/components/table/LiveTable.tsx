"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Envelope, EventRow, GameState, PlayerPresence } from "@poker/shared";
import WalletBar from "@/components/WalletBar";
import { useSocket } from "@/components/SocketProvider";
import { useWallet } from "@/components/WalletProvider";
import { useTable, type TablePhase } from "@/hooks/useTable";
import { useTableInfo, type TableInfo } from "@/hooks/useTableInfo";
import { useAutoMessages } from "@/hooks/useAutoMessages";
import { useDealing } from "@/hooks/useDealing";
import { busyLabel, dealingBanner } from "@/lib/dealingUi";
import { useLastResult } from "@/hooks/useLastResult";
import { toBetPayload, toTableView } from "@/lib/gameToView";
import { disconnectedTurnNotice } from "@/lib/turnNotice";
import { ConnectionState, TableNotice, buildBanner, buildLog } from "@/lib/statusLog";
import type { PlayerAction } from "@/lib/tableView";
import { SeatView, WaitingRoomState, isWaitingState } from "@/lib/waitingRoom";
import { weiToEth } from "@/lib/createTable";
import HandResultPanel from "./HandResultPanel";
import PokerTable from "./PokerTable";
import StatusBanner from "./StatusBanner";
import WaitingRoom from "./WaitingRoom";
import CancelledScreen from "./CancelledScreen";
import ExitPanel from "./ExitPanel";
import FinalPayoutCard from "./FinalPayoutCard";
import FinishedScreen from "./FinishedScreen";
import { cardName } from "@poker/shared/engine/cards";

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

// 2.1 never aborts a hand for a dropped player: the 30 s turn clock folds them.
// Tell the player which live seat (not me) is currently disconnected.
function disconnectedLiveSeat(
  state: GameState,
  players: PlayerPresence[],
  mySeat: number | null
): number | null {
  const inPlay =
    state.tableState === "dealing" ||
    state.tableState === "betting" ||
    state.tableState === "showdown" ||
    state.tableState === "settlement";
  if (!inPlay) return null;
  const sorted = [...players].sort((a, b) => a.seat - b.seat);
  for (const p of sorted) {
    if (p.seat === mySeat || p.connected) continue;
    const s = state.seats[p.seat];
    if (s && s.inHand && !s.hasFolded) return p.seat;
  }
  return null;
}

function BackToLobby() {
  return (
    <Link href="/lobby" className="inline-block rounded border px-3 py-1 text-sm underline">
      Back to the lobby
    </Link>
  );
}

export default function LiveTable({ tableId }: { tableId: string }) {
  const { address, isWrongNetwork, switchNetwork } = useWallet();
  const { connection } = useSocket();
  const session = useTable(tableId);
  const info = useTableInfo(tableId);
  const { checkpointError } = useAutoMessages({
    tableId,
    session,
    buyInWei: info?.buyInWei ?? null,
  });
  const dealing = useDealing({ tableId, session });
  const [actionError, setActionError] = useState<string | null>(null);

  const { phase, state, mySeat, players, timer, events, abort, pending, send } = session;
  const log = useMemo(() => buildLog(events), [events]);
  const lastResult = useLastResult(state); // must stay above the early returns below (rules of hooks)

  let notice: TableNotice | null = null;
  if (checkpointError) notice = { kind: "checkpoint_mismatch" };
  else if (state?.aborted) notice = { kind: "hand_aborted", reason: state.aborted.reason };
  else if (abort && state && abort.handNumber === state.handNumber) {
    notice = { kind: "hand_aborted", reason: abort.reason };
  } else if (state) {
    notice = disconnectedTurnNotice(state, players, timer, mySeat);
  }

  // A server that is down shows up as connection === "disconnected" even before any phase change.
  const conn: ConnectionState =
    connection === "disconnected" ? "disconnected" : connectionFor(phase);

  // Connection problems and abort notices come first; the dealing banner fills the gaps.
  // While we wait for a seat to answer a crypto step, the server's `timer` event carries that seat
  // and its deadline (SPEC-PHASE3 D7), so the banner can show a countdown.
    const activeCount = state ? state.seats.filter((p) => p.inHand).length : 4;
  const banner = buildBanner(conn, notice) ?? dealingBanner(dealing, activeCount);

  const header = <h1 className="text-2xl font-bold">Table #{tableId}</h1>;

  const networkWarning = isWrongNetwork ? (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded border border-yellow-500 p-3 text-sm"
    >
      <span>
        Your wallet is on the wrong network. The game keeps running, but deposits and
        withdrawals need Base Sepolia.
      </span>
      <button onClick={() => void switchNetwork()} className="rounded border px-2 py-0.5">
        Switch network
      </button>
    </div>
  ) : null;

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
  // A cancelled or refunded table: the server refuses `join` once it is aborted, so do not wait for the socket.
  const mySeatForRefund =
    mySeat ?? (address ? info?.seats.find((s) => s.wallet === address)?.seat ?? null : null);
  if (info?.state === "aborted" || state?.tableState === "aborted") {
    return <CancelledScreen tableId={tableId} mySeat={mySeatForRefund} notices={networkWarning} />;
  }
  if (phase === "error") {
    return (
      <div className="space-y-4">
        {header}
        {networkWarning}
        <StatusBanner banner={connection === "disconnected" ? banner : null} />
        <p role="alert" className="rounded border border-red-500 p-3 text-sm text-red-600">
          {session.error}
        </p>
        <BackToLobby />
      </div>
    );
  }
  if (!state) {
    return (
      <div className="space-y-4">
        {header}
        {networkWarning}
        <StatusBanner banner={banner} />
        <p className="text-sm text-gray-600">Loading table…</p>
      </div>
    );
  }

  if (isWaitingState(state.tableState)) {
    return (
      <WaitingRoom
        room={buildRoom(tableId, state, info, players, events)}
        myAddress={address}
        notices={
          <>
            {networkWarning}
            <StatusBanner banner={banner} />
          </>
        }
        exit={<ExitPanel tableId={tableId} tableState={state.tableState} mySeat={mySeat} variant="inline" />}
      />
    );
  }

  if (state.tableState === "finished") {
    const seatsData = state.seats.map((p, i) => ({
      address: (info?.seats.find((x) => x.seat === i)?.wallet || p.wallet || "").toLowerCase() || null,
      chips: p.chips,
    }));
    return (
      <FinishedScreen
        tableId={tableId}
        seats={seatsData}
        mySeat={mySeat}
        board={lastResult.result?.board ?? state.board.map(cardName)}
        buyInWei={info?.buyInWei ?? null}
        totalHands={info?.totalHands ?? null}
        notices={
          <>
            {networkWarning}
            <StatusBanner banner={banner} />
          </>
        }
        payout={<FinalPayoutCard tableId={tableId} mySeat={mySeat} />}
        overlay={
          lastResult.visible && lastResult.result ? (
            <HandResultPanel result={lastResult.result} mySeat={mySeat} onDismiss={lastResult.dismiss} />
          ) : null
        }
      />
    );
  }

  const view = toTableView({
    state,
    mySeat,
    players,
    timer,
    totalHands: info?.totalHands ?? 0,
    myCards: dealing.myCards,
  });

  // Buy-in numbers for the Escrow & Funds panel. Each of the 4 players put in the same buy-in.
  const escrow =
    info && /^\d+$/.test(info.buyInWei) && mySeat !== null
      ? {
          deposit: `${weiToEth(info.buyInWei)} ETH`,
          total: `${weiToEth((BigInt(info.buyInWei) * 4n).toString())} ETH`,
        }
      : null;

  return (
    <PokerTable
      view={view}
      log={log}
      banner={banner}
      pending={pending}
      busy={busyLabel(dealing)}
      onAction={onAction}
      escrow={escrow}
      resultSlot={
        lastResult.visible && lastResult.result ? (
          <HandResultPanel result={lastResult.result} mySeat={mySeat} onDismiss={lastResult.dismiss} />
        ) : null
      }
      extras={
        <>
          <ExitPanel tableId={tableId} tableState={state.tableState} mySeat={mySeat} />
          {actionError && (
            <p role="alert" className="rounded-2xl border border-red-500 bg-red-950 p-3 text-red-200">
              {actionError}
            </p>
          )}
        </>
      }
    />
  );
}