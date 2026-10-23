"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@/components/WalletProvider";
import { USE_MOCK } from "@/lib/lobby";
import { MOCK_TABLE_VIEWS, PlayerAction } from "@/lib/tableView";
import { MOCK_SCENARIOS, getMockRoom } from "@/lib/waitingRoom";
import PokerTable from "./PokerTable";
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
  const [preview, setPreview] = useState(0);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const waitingCount = MOCK_SCENARIOS.length;
  const labels = [
    ...MOCK_SCENARIOS.map((s) => s.label),
    ...MOCK_TABLE_VIEWS.map((s) => s.label),
  ];

  // Rebuilt when you pick a preview, which also restarts the countdown.
  const playView = useMemo(
    () =>
      preview >= waitingCount
        ? MOCK_TABLE_VIEWS[preview - waitingCount].build(tableId, Date.now())
        : null,
    [preview, tableId, waitingCount]
  );

  if (!USE_MOCK) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Table #{tableId}</h1>
        <p>Live table state is connected in step 2.1.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded border border-yellow-500 p-2 text-sm">
        Mock mode. Preview a state:{" "}
        {labels.map((label, i) => (
          <button
            key={label}
            onClick={() => {
              setPreview(i);
              setLastAction(null);
            }}
            className={`mr-2 mb-1 rounded border px-2 py-0.5 ${
              i === preview ? "bg-black text-white" : ""
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {playView ? (
        <PokerTable view={playView} onAction={(a) => setLastAction(describe(a))} />
      ) : (
        <WaitingRoom room={getMockRoom(tableId, preview)} myAddress={address} />
      )}

      {lastAction && (
        <p className="text-sm text-gray-600">
          Mock mode: you chose &quot;{lastAction}&quot;. Nothing is sent until step 2.1.
        </p>
      )}
    </div>
  );
}