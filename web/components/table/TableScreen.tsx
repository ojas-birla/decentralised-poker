"use client";

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
  const labels = [
    ...MOCK_SCENARIOS.map((s) => s.label),
    ...MOCK_TABLE_VIEWS.map((s) => s.label),
  ];

  // Rebuilt when you pick a preview, which also restarts the countdowns.
  const playView = useMemo(
    () =>
      preview >= waitingCount
        ? MOCK_TABLE_VIEWS[preview - waitingCount].build(tableId, Date.now())
        : null,
    [preview, tableId, waitingCount]
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

  if (!USE_MOCK) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Table #{tableId}</h1>
        <StatusBanner banner={banner} />
        <p>Live table state is connected in step 2.1.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 rounded border border-yellow-500 p-2 text-sm">
        <div>
          Mock mode. Preview a state:{" "}
          {labels.map((label, i) => (
            <button
              key={label}
              onClick={() => {
                setPreview(i);
                setLastAction(null);
                setNoticeIdx(0);
              }}
              className={`mr-2 mb-1 rounded border px-2 py-0.5 ${
                i === preview ? "bg-black text-white" : ""
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
                i === noticeIdx ? "bg-black text-white" : ""
              }`}
            >
              {n.label}
            </button>
          ))}
          <button
            onClick={() => setSimulateLost((v) => !v)}
            className={`mb-1 rounded border px-2 py-0.5 ${simulateLost ? "bg-black text-white" : ""}`}
          >
            Simulate lost connection
          </button>
        </div>
      </div>

      {shownView ? (
        <PokerTable
          view={shownView}
          log={MOCK_LOGS[preview - waitingCount]}
          banner={banner}
          onAction={(a) => setLastAction(describe(a))}
        />
      ) : (
        <>
          <StatusBanner banner={banner} />
          <WaitingRoom room={getMockRoom(tableId, preview)} myAddress={address} />
        </>
      )}

      {lastAction && (
        <p className="text-sm text-gray-600">
          Mock mode: you chose &quot;{lastAction}&quot;. Nothing is sent until step 2.1.
        </p>
      )}
    </div>
  );
}