"use client";

import { useEffect } from "react";
import { useHandNames } from "@/hooks/useHandNames";
import { wonBySeat, type HandResult } from "@/lib/handResult";
import PlayingCard from "./PlayingCard";

const seatName = (seat: number, mySeat: number | null) =>
  seat === mySeat ? `Seat ${seat + 1} (you)` : `Seat ${seat + 1}`;

function Trophy() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 4h8v5a4 4 0 01-8 0zM8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8.500 20h7M10 17h4" />
    </svg>
  );
}

export default function HandResultPanel({
  result,
  mySeat,
  onDismiss,
}: {
  result: HandResult;
  mySeat: number | null;
  onDismiss: () => void;
}) {
  const names = useHandNames(result);
  const won = wonBySeat(result.awards);
  const winners = [...won.entries()].filter(([, amount]) => amount > 0).sort((a, b) => b[1] - a[1]);
  const showdown = result.hands.length > 0;
  const iWon = mySeat !== null && won.has(mySeat) && (won.get(mySeat) ?? 0) > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDismiss();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  // Hero line: who won, and with what.
  const headline =
    winners.length === 0
      ? "Hand over"
      : winners.length === 1
        ? iWon
          ? "You win the pot"
          : `${seatName(winners[0][0], mySeat)} wins the pot`
        : "Pot is split";
  const subline = !showdown
    ? "Everyone else folded"
    : winners.length === 1
      ? (names[winners[0][0]] ?? "Won at showdown")
      : "Won at showdown";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#04040a]/80 p-6 backdrop-blur-[3px] [animation:result-fade_220ms_ease-out_both]"
      onClick={onDismiss}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Hand ${result.handNumber} result`}
        onClick={(e) => e.stopPropagation()}
        className="relative w-[min(780px,100%)] max-h-full overflow-auto rounded-[28px] border border-[#d9a928]/70 bg-[linear-gradient(180deg,#181829,#0b0b14)] px-9 pb-8 pt-7 font-grotesk text-white shadow-[0_0_80px_rgba(245,197,66,0.18),0_40px_120px_rgba(0,0,0,0.8)] [animation:result-pop_280ms_cubic-bezier(0.2,0.8,0.2,1)_both]"
      >
        {/* Top row */}
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#f5c542]">
            Hand {result.handNumber} result
          </p>
          <button
            onClick={onDismiss}
            aria-label="Close result"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#2b3350] text-xl leading-none text-slate-400 transition-colors hover:border-[#5b6aa8] hover:text-white"
          >
            ×
          </button>
        </div>

        {/* Hero */}
        <div className="mt-5 flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#f5c542]/15 text-[#f5c542] ring-1 ring-[#f5c542]/50">
            <Trophy />
          </span>
          <h2 className="mt-3 text-[34px] font-bold leading-tight">{headline}</h2>
          <p className="mt-1 text-base text-slate-300">{subline}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {winners.map(([seat, amount]) => (
              <span
                key={seat}
                className="flex items-center gap-3 rounded-full border border-emerald-400/60 bg-emerald-500/15 py-1.5 pl-4 pr-1.5 text-[15px] font-semibold text-emerald-200"
              >
                {winners.length > 1 && seatName(seat, mySeat)}
                <span className="rounded-full bg-emerald-400 px-4 py-1 text-[22px] font-extrabold leading-none text-[#04261a]">
                  +{amount}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* Board */}
        {result.board.length > 0 && (
          <div className="mt-7">
            <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Board</p>
            <div className="flex justify-center gap-2.5 rounded-2xl border border-[#14513b] bg-[radial-gradient(ellipse_at_50%_40%,#1a7a59,#0d5a3f)] px-4 py-4 shadow-[inset_0_8px_30px_rgba(0,0,0,0.35)]">
              {result.board.map((c, i) => (
                <PlayingCard key={i} card={c} size="res" />
              ))}
            </div>
          </div>
        )}

        {/* Showdown hands */}
        {showdown && (
          <ul className="mt-6 space-y-2.5">
            {result.hands.map((h) => {
              const amount = won.get(h.seat);
              const isWinner = amount !== undefined && amount > 0;
              return (
                <li
                  key={h.seat}
                  className={`flex items-center gap-4 rounded-2xl border px-4 py-3 ${
                    isWinner
                      ? "border-emerald-400/70 bg-emerald-500/10 shadow-[0_0_24px_rgba(52,211,153,0.15)]"
                      : "border-[#23233a] bg-[#0f0f1a] opacity-80"
                  }`}
                >
                  <div className="flex gap-1.5">
                    <PlayingCard card={h.cards[0]} size="opp" />
                    <PlayingCard card={h.cards[1]} size="opp" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-semibold">{seatName(h.seat, mySeat)}</p>
                    <p className="text-sm text-slate-400">{names[h.seat] ?? " "}</p>
                  </div>
                  {isWinner ? (
                    <span className="flex items-center gap-2.5">
                      <span className="text-xs font-bold uppercase tracking-widest text-emerald-300">Winner</span>
                      <span className="rounded-full bg-emerald-400 px-3.5 py-1 text-lg font-extrabold text-[#04261a]">+{amount}</span>
                    </span>
                  ) : (
                    <span className="text-sm text-slate-500">Lost</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {result.pots.length > 1 && (
          <ul className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-slate-400">
            {result.pots.map((pot, i) => (
              <li key={i}>
                {i === 0 ? "Main pot" : `Side pot ${i}`}: <span className="text-slate-200">{pot.amount}</span> (seats{" "}
                {pot.eligibleSeats.map((s) => s + 1).join(", ")})
              </li>
            ))}
          </ul>
        )}

        <button
          onClick={onDismiss}
          className="btn-raise mt-7 h-12 w-full rounded-2xl bg-[#f5c542] text-base font-bold text-[#1a1400]"
        >
          Continue
        </button>
      </section>
    </div>
  );
}
