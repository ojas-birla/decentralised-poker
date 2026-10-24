"use client";

import LiveTable from "./LiveTable";
import { useMemo, useState } from "react";
import { useSocket } from "@/components/SocketProvider";
import { useWallet } from "@/components/WalletProvider";
import { USE_MOCK } from "@/lib/lobby";
import { MOCK_LOGS, MOCK_NOTICES, buildBanner } from "@/lib/statusLog";
import { MOCK_TABLE_VIEWS, PlayerAction } from "@/lib/tableView";
import { MOCK_SCENARIOS, getMockRoom } from "@/lib/waitingRoom";
import PokerTable from "./PokerTable";
import StatusBanner from "./StatusBanner";
import WaitingRoom from "./WaitingRoom";
import FinishedScreen from "./FinishedScreen";
import { CancelRefundRow } from "./ExitPanel";
import { FinalPayoutView } from "./FinalPayoutCard";

// In mock mode you sit in seat 1 of the sample rooms, so the "You" styling shows.
const MOCK_ME = "0x" + "1".repeat(40);

function describe(a: PlayerAction): string {
  switch (a.type) {
    case "raise":
      return `raise to ${a.raiseTo}`;
    case "allin":
      return "all-in";
    default:
      return a.type;
  }
}

export default function TableScreen({ tableId }: { tableId: string }) {
  const { address } = useWallet();
  const { connection } = useSocket();
  const [preview, setPreview] = useState(0);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [noticeIdx, setNoticeIdx] = useState(0);
  const [simulateLost, setSimulateLost] = useState(false);

  const waitingCount = MOCK_SCENARIOS.length;
  const finishedIndex = waitingCount + MOCK_TABLE_VIEWS.length; // extra preview: the final screen
  const labels = [
    ...MOCK_SCENARIOS.map((s) => s.label),
    ...MOCK_TABLE_VIEWS.map((s) => s.label),
    "Game finished",
  ];

  // Rebuilt when you pick a preview, which also restarts the countdowns.
  const playView = useMemo(
    () =>
      preview >= waitingCount && preview < finishedIndex
        ? MOCK_TABLE_VIEWS[preview - waitingCount].build(tableId, Date.now())
        : null,
    [preview, tableId, waitingCount, finishedIndex]
  );
  const notice = useMemo(
    () => (playView ? MOCK_NOTICES[noticeIdx].build(Date.now()) : null),
    [playView, noticeIdx]
  );

  // In mock mode, "waiting for seat N" also shows that seat's red dot.
  const shownView = useMemo(() => {
    if (!playView) return null;
    if (notice?.kind !== "waiting_for_player") return playView;
    return {
      ...playView,
      seats: playView.seats.map((s, i) =>
        i === notice.seat ? { ...s, connected: false } : s
      ),
    };
  }, [playView, notice]);

  const banner = buildBanner(simulateLost ? "disconnected" : connection, notice);

  if (!USE_MOCK) return <LiveTable tableId={tableId} />;

  return (
    <div className="space-y-6">
      <details className="fixed left-1/2 top-4 z-50 -translate-x-1/2 max-w-[min(560px,92vw)] rounded-xl border border-yellow-500 bg-black/90 p-2 text-xs text-white shadow-2xl">
        <summary className="cursor-pointer select-none font-semibold text-yellow-400">
          Mock mode controls
        </summary>
        <div className="mt-2 space-y-2">
        <div>
          Preview a state:{" "}
          {labels.map((label, i) => (
            <button
              key={label}
              onClick={() => {
                setPreview(i);
                setLastAction(null);
                setNoticeIdx(0);
              }}
              className={`mr-2 mb-1 rounded border px-2 py-0.5 ${
                i === preview ? "bg-yellow-400 text-black" : ""
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div>
          Banner:{" "}
          {MOCK_NOTICES.map((n, i) => (
            <button
              key={n.label}
              onClick={() => setNoticeIdx(i)}
              disabled={!playView}
              className={`mr-2 mb-1 rounded border px-2 py-0.5 disabled:opacity-40 ${
                i === noticeIdx ? "bg-yellow-400 text-black" : ""
              }`}
            >
              {n.label}
            </button>
          ))}
          <button
            onClick={() => setSimulateLost((v) => !v)}
            className={`mb-1 rounded border px-2 py-0.5 ${simulateLost ? "bg-yellow-400 text-black" : ""}`}
          >
            Simulate lost connection
          </button>
        </div>
        {lastAction && (
          <p className="text-slate-300">
            You chose &quot;{lastAction}&quot;. Nothing is sent to the server.
          </p>
        )}
        </div>
      </details>

      {preview === finishedIndex ? (
        <FinishedScreen
          tableId={tableId}
          mySeat={2}
          seats={[
            { address: "0x1111111111111111111111111111111111111111", chips: 1000 },
            { address: "0x2222222222222222222222222222222222222222", chips: 1000 },
            { address: "0x3333333333333333333333333333333333333333", chips: 1005 },
            { address: "0x4444444444444444444444444444444444444444", chips: 995 },
          ]}
          board={["As", "Kh", "Jd", "7c", "3h"]}
          buyInWei="1000000000000000"
          totalHands={10}
          payout={
            <FinalPayoutView
              title="Payout"
              shareWei="1005000000000000"
              step={{ kind: "submit" }}
              busy={null}
              error={null}
              lastTx={null}
              onSubmit={() => setLastAction("submit final result")}
              onFinalize={() => {}}
              onWithdraw={() => {}}
            />
          }
        />
      ) : shownView ? (
        <PokerTable
          view={shownView}
          log={MOCK_LOGS[preview - waitingCount]}
          banner={banner}
          escrow={{ deposit: "0.01 ETH", total: "0.04 ETH" }}
          onAction={(a) => setLastAction(describe(a))}
        />
      ) : (
        <WaitingRoom
          room={getMockRoom(tableId, preview)}
          myAddress={address ?? MOCK_ME}
          notices={<StatusBanner banner={banner} />}
          exit={getMockRoom(tableId, preview).state === "lobby" ? <CancelRefundRow disabled /> : null}
        />
      )}

    </div>
  );
}