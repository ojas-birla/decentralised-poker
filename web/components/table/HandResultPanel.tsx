"use client";

import type { HandResult } from "@/lib/handResult";
import PlayingCard from "./PlayingCard";

const seatName = (seat: number, mySeat: number | null) =>
  `Seat ${seat + 1}${seat === mySeat ? " (you)" : ""}`;

export default function HandResultPanel({
  result,
  mySeat,
  onDismiss,
}: {
  result: HandResult;
  mySeat: number | null;
  onDismiss: () => void;
}) {
  const won = new Map(result.awards.map((a) => [a.seat, a.amount]));

  return (
    <section
      aria-label="Last hand result"
      className="space-y-2 rounded-2xl border border-emerald-500 bg-slate-900 p-3 text-sm text-white"
    >
      <div className="flex items-center justify-between">
        <p className="font-semibold">Hand {result.handNumber} result</p>
        <button
          onClick={onDismiss}
          aria-label="Close result"
          className="rounded px-2 text-slate-300"
        >
          ×
        </button>
      </div>

      {result.board.length > 0 && (
        <div className="flex gap-1">
          {result.board.map((c, i) => (
            <PlayingCard key={i} card={c} small />
          ))}
        </div>
      )}

      {result.hands.length > 0 ? (
        <ul className="space-y-1">
          {result.hands.map((h) => (
            <li key={h.seat} className="flex items-center gap-2">
              <span className="w-24">{seatName(h.seat, mySeat)}</span>
              <PlayingCard card={h.cards[0]} small />
              <PlayingCard card={h.cards[1]} small />
              {won.has(h.seat) && (
                <span className="rounded-full bg-emerald-500 px-2 py-0.5 font-bold text-slate-900">
                  +{won.get(h.seat)}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-1">
          {result.awards.map((a) => (
            <li key={a.seat}>
              {seatName(a.seat, mySeat)} won {a.amount}. Everyone else folded.
            </li>
          ))}
        </ul>
      )}

      {result.pots.length > 1 && (
        <ul className="space-y-0.5 text-xs text-slate-300">
          {result.pots.map((pot, i) => (
            <li key={i}>
              {i === 0 ? "Main pot" : `Side pot ${i}`}: {pot.amount} (seats{" "}
              {pot.eligibleSeats.map((s) => s + 1).join(", ")})
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
