"use client";

import { useEffect, useState } from "react";
import { LegalActions, PlayerAction, RaisePresets } from "@/lib/tableView";

const btn = "rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40";

export default function ActionBar({
  legal,
  presets,
  myStack,
  enabled,
  onAction,
}: {
  legal: LegalActions | null;
  presets: RaisePresets | null;
  myStack: number;
  enabled: boolean; // true only on your turn
  onAction: (action: PlayerAction) => void;
}) {
  const min = legal?.minRaiseTo ?? 0;
  const max = legal?.maxRaiseTo ?? 0;
  const [raiseTo, setRaiseTo] = useState(min);

  // Reset the slider whenever the legal range changes (a new turn).
  useEffect(() => {
    setRaiseTo(min);
  }, [min, max]);

  const active = enabled && legal !== null;
  const canRaise = active && max >= min && max > 0;
  const amount = Math.min(max, Math.max(min, Number.isFinite(raiseTo) ? raiseTo : min));
  const callAmount = legal ? Math.min(legal.toCall, myStack) : 0;

  return (
    <div className="space-y-3 rounded-xl bg-slate-900/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={!active}
          onClick={() => onAction({ type: "fold" })}
          className={`${btn} bg-rose-500 text-white`}
        >
          Fold
        </button>

        {legal?.canCheck || !legal ? (
          <button
            disabled={!active || !legal?.canCheck}
            onClick={() => onAction({ type: "check" })}
            className={`${btn} bg-slate-600 text-white`}
          >
            Check
          </button>
        ) : (
          <button
            disabled={!active || callAmount <= 0}
            onClick={() => onAction({ type: "call" })}
            className={`${btn} bg-slate-600 text-white`}
          >
            Call {callAmount}
          </button>
        )}

        <button
          disabled={!canRaise}
          onClick={() => onAction({ type: "raise", raiseTo: amount })}
          className={`${btn} bg-green-500 text-slate-900`}
        >
          Raise to {canRaise ? amount : "-"}
        </button>

        <button
          disabled={!active || myStack <= 0}
          onClick={() => onAction({ type: "allin" })}
          className={`${btn} bg-amber-500 text-slate-900`}
        >
          All-in {myStack}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input
          type="range"
          min={min}
          max={max}
          value={amount}
          disabled={!canRaise}
          onChange={(e) => setRaiseTo(Number(e.target.value))}
          className="w-48 disabled:opacity-40"
          aria-label="Raise amount"
        />
        <input
          type="number"
          min={min}
          max={max}
          value={canRaise ? amount : ""}
          disabled={!canRaise}
          onChange={(e) => setRaiseTo(Number(e.target.value))}
          className="w-24 rounded border border-slate-500 bg-slate-800 px-2 py-1 text-white disabled:opacity-40"
          aria-label="Raise amount (number)"
        />
        {presets && (
          <div className="flex gap-1">
            {(
              [
                ["Min", presets.min],
                ["1/2 pot", presets.half],
                ["Pot", presets.pot],
                ["Max", presets.max],
              ] as const
            ).map(([label, value]) => (
              <button
                key={label}
                disabled={!canRaise}
                onClick={() => setRaiseTo(value)}
                className="rounded border border-slate-500 px-2 py-1 text-xs disabled:opacity-40"
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!active && <p className="text-xs text-slate-400">Buttons unlock on your turn.</p>}
    </div>
  );
}