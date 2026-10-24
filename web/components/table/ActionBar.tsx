"use client";

import { useEffect, useState } from "react";
import { LegalActions, PlayerAction, RaisePresets } from "@/lib/tableView";

function Coin({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-3 w-3 rounded-full border border-[#8a6a10] bg-[radial-gradient(circle_at_35%_30%,#ffe08a,#e0a920)] ${className}`}
    />
  );
}

const icon = "h-5 w-5 shrink-0";

export default function ActionBar({
  legal,
  presets,
  myStack,
  potOdds = null,
  enabled,
  pending = false,
  outOfChips = false,
  onAction,
}: {
  legal: LegalActions | null;
  presets: RaisePresets | null;
  myStack: number;
  potOdds?: number | null;
  enabled: boolean; // true only on your turn and when no action is in flight
  pending?: boolean; // an action is on its way to the server
  outOfChips?: boolean; // your seat is out of the game and only watching
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
  const checking = legal?.canCheck ?? false;
  const fill = max > min ? ((amount - min) / (max - min)) * 100 : 0;

  function primary() {
    onAction(goesAllIn ? { type: "allin" } : { type: "raise", raiseTo: amount });
  }

  const presetList: [string, number | undefined][] = [
    ["Min", presets?.min],
    ["½ Pot", presets?.half],
    ["Pot", presets?.pot],
    ["All-in", presets?.max],
  ];

  const hint = outOfChips
    ? "You are out of chips and watching."
    : pending
      ? "Sending your action…"
      : !active
        ? "Buttons unlock on your turn."
        : null;

  return (
    <div className="rounded-[28px] border border-[#2c3350] bg-[linear-gradient(180deg,#10101b,#0a0a12)] p-3 font-grotesk shadow-[0_0_40px_rgba(60,90,200,0.12),0_20px_50px_rgba(0,0,0,0.6)]">
      {/* Presets */}
      <div role="group" aria-label="Raise size presets" className="mb-2 flex justify-center gap-3">
        {presetList.map(([label, value]) => (
          <button
            key={label}
            disabled={!canRaise || value === undefined}
            onClick={() => value !== undefined && setRaiseTo(value)}
            className={`flex h-[44px] w-[118px] flex-col items-center justify-center rounded-xl border bg-[#14141f] leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-55 enabled:hover:border-[#f5c542]/70 ${
              canRaise && value === amount ? "border-[#f5c542] text-[#f5c542]" : "border-[#2f3350] text-slate-100"
            }`}
          >
            <span className="text-[13px] font-semibold">{label}</span>
            <span className="flex items-center gap-1.5 text-xs text-slate-300">
              <Coin />
              {value !== undefined && canRaise ? value : "–"}
            </span>
          </button>
        ))}
      </div>

      {/* Amount, slider, call and pot odds */}
      <div className="mb-2 flex items-stretch gap-3 rounded-2xl border border-[#23233a] bg-[#0d0d17] p-2">
        <label className="flex w-[150px] shrink-0 flex-col gap-1 text-xs text-slate-400">
          Bet Amount
          <input
            type="number"
            min={min}
            max={max}
            step={1}
            value={canRaise ? amount : ""}
            disabled={!canRaise}
            onChange={(e) => setRaiseTo(Number(e.target.value))}
            className="h-9 rounded-lg border border-[#3a3f5c] bg-[#0b0b13] px-3 text-lg font-semibold text-white outline-none focus:border-[#f5c542] disabled:opacity-50"
          />
        </label>

        <div className="flex flex-1 items-center px-2">
          <input
            type="range"
            min={min}
            max={max}
            value={amount}
            disabled={!canRaise}
            onChange={(e) => setRaiseTo(Number(e.target.value))}
            style={{
              background: `linear-gradient(90deg,#f5c542 ${fill}%,#2a2a3d ${fill}%)`,
            }}
            className="raise-slider w-full disabled:opacity-50"
            aria-label="Raise amount"
          />
        </div>

        <div className="flex w-[104px] shrink-0 flex-col justify-center rounded-xl border border-[#23233a] bg-[#12121c] px-3 text-slate-300">
          <span className="text-xs text-slate-400">{checking ? "Check" : "Call"}</span>
          <span className="text-xl font-semibold">{legal ? (checking ? "–" : callAmount) : "–"}</span>
        </div>
        <div className="flex w-[96px] shrink-0 flex-col justify-center px-2 text-slate-300">
          <span className="text-xs text-slate-400">Pot Odds</span>
          <span className="text-xl font-semibold">{potOdds !== null ? `${potOdds}%` : "–"}</span>
        </div>
      </div>

      {/* Main actions */}
      <div className="grid grid-cols-3 gap-3">
        <button
          disabled={!active}
          onClick={() => onAction({ type: "fold" })}
          className="flex h-[50px] items-center justify-center gap-2 rounded-xl border border-[#b02d57] bg-[linear-gradient(180deg,#4a1226,#2e0b19)] text-lg font-semibold text-[#ff8fb0] transition-colors disabled:cursor-not-allowed disabled:opacity-60 enabled:hover:bg-[#5a162e]"
        >
          <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M9 9l6 6M15 9l-6 6" />
          </svg>
          Fold
        </button>

        <button
          disabled={!active || !legal || (!checking && legal.toCall <= 0)}
          onClick={() => onAction({ type: checking ? "check" : "call" })}
          className="flex h-[50px] items-center justify-center gap-2 rounded-xl border border-[#3a6fd0] bg-[linear-gradient(180deg,#14275a,#0d1a3d)] text-lg font-semibold text-[#9cc2ff] transition-colors disabled:cursor-not-allowed disabled:opacity-60 enabled:hover:bg-[#1a3170]"
        >
          <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            {checking ? <path d="M5 12.5l4.5 4.5L19 7.500" /> : <path d="M5 4h4l2 5-2.500 1.500a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" />}
          </svg>
          {checking ? "Check" : legal && legal.toCall > 0 ? `Call ${callAmount}` : "Call"}
        </button>

        <button
          disabled={!primaryEnabled}
          onClick={primary}
          className="btn-raise flex h-[50px] items-center justify-center gap-2 rounded-xl border border-[#ffd76a] bg-[linear-gradient(180deg,#f7cf5a,#e4aa28)] text-lg font-bold text-[#15120a] disabled:cursor-not-allowed disabled:border-[#5a4a1e] disabled:bg-none disabled:bg-[#4a3f1c] disabled:text-[#c9b676]"
        >
          <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20V5M5.500 11.500L12 5l6.500 6.500" />
          </svg>
          {!primaryEnabled ? "Raise" : goesAllIn ? `All-in ${myStack}` : `Raise to ${amount}`}
        </button>
      </div>

      {hint && <p className="mt-2 text-center text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
