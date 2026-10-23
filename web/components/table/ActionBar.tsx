"use client";

import { useEffect, useState } from "react";
import { BIG_BLIND } from "@/lib/createTable";
import { LegalActions, PlayerAction, RaisePresets } from "@/lib/tableView";

const pill =
  "rounded-full border border-slate-500 px-3 py-1 text-xs font-semibold disabled:opacity-40";
const secondary =
  "rounded-full bg-slate-600 px-4 py-1 text-xs font-semibold text-white disabled:opacity-40";

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

  // Reset the amount whenever the legal range changes (a new turn).
  useEffect(() => {
    setRaiseTo(min);
  }, [min, max]);

  const active = enabled && legal !== null;
  const canRaise = active && max >= min && max > 0;
  const shortStack = active && max < min && myStack > 0; // can only go all-in
  const amount = Math.min(max, Math.max(min, Number.isFinite(raiseTo) ? raiseTo : min));
  const goesAllIn = canRaise ? amount >= max : shortStack;
  const primaryEnabled = canRaise || shortStack;
  const callAmount = legal ? Math.min(legal.toCall, myStack) : 0;
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));

  function primary() {
    onAction(goesAllIn ? { type: "allin" } : { type: "raise", raiseTo: amount });
  }

  const presetButton = (label: string, value: number | undefined) => (
    <button
      key={label}
      disabled={!canRaise || value === undefined}
      onClick={() => value !== undefined && setRaiseTo(value)}
      className={pill}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3 rounded-2xl bg-slate-900/60 p-3">
      <div className="flex flex-wrap items-center justify-center gap-4">
        {/* Left presets */}
        <div className="flex flex-col gap-1">
          {presetButton("Min", presets?.min)}
          {presetButton("1/2 pot", presets?.half)}
        </div>

        {/* Fold and call */}
        <div className="flex flex-col items-stretch gap-1">
          <button
            disabled={!active}
            onClick={() => onAction({ type: "fold" })}
            className="rounded-xl bg-rose-500 px-8 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            Fold
          </button>
          <button
            disabled={!active || !legal || legal.toCall <= 0}
            onClick={() => onAction({ type: "call" })}
            className={secondary}
          >
            {legal && legal.toCall > 0 ? `Call ${callAmount}` : "Call"}
          </button>
        </div>

        {/* Amount stepper */}
        <div className="flex items-center gap-2">
          <button
            disabled={!canRaise || amount <= min}
            onClick={() => setRaiseTo(clamp(amount - BIG_BLIND))}
            className="h-8 w-8 rounded-full bg-rose-500 text-lg font-bold leading-none text-white disabled:opacity-40"
            aria-label="Decrease raise"
          >
            −
          </button>
          <input
            type="number"
            min={min}
            max={max}
            value={canRaise ? amount : ""}
            disabled={!canRaise}
            onChange={(e) => setRaiseTo(Number(e.target.value))}
            className="w-24 rounded-lg border border-slate-500 bg-slate-800 px-2 py-1 text-center text-white disabled:opacity-40"
            aria-label="Raise amount"
          />
          <button
            disabled={!canRaise || amount >= max}
            onClick={() => setRaiseTo(clamp(amount + BIG_BLIND))}
            className="h-8 w-8 rounded-full bg-green-500 text-lg font-bold leading-none text-slate-900 disabled:opacity-40"
            aria-label="Increase raise"
          >
            +
          </button>
        </div>

        {/* Raise and check */}
        <div className="flex flex-col items-stretch gap-1">
          <button
            disabled={!primaryEnabled}
            onClick={primary}
            className="rounded-xl bg-green-500 px-8 py-2 text-sm font-bold text-slate-900 disabled:opacity-40"
          >
            {!primaryEnabled
              ? "Raise"
              : goesAllIn
                ? `All-in ${myStack}`
                : `Raise to ${amount}`}
          </button>
          <button
            disabled={!active || !legal?.canCheck}
            onClick={() => onAction({ type: "check" })}
            className={secondary}
          >
            Check
          </button>
        </div>

        {/* Right presets */}
        <div className="flex flex-col gap-1">
          {presetButton("Pot", presets?.pot)}
          {presetButton("Max", presets?.max)}
        </div>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        value={amount}
        disabled={!canRaise}
        onChange={(e) => setRaiseTo(Number(e.target.value))}
        className="w-full disabled:opacity-40"
        aria-label="Raise amount slider"
      />

      {!active && <p className="text-center text-xs text-slate-400">Buttons unlock on your turn.</p>}
    </div>
  );
}