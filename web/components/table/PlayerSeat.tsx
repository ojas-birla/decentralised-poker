"use client";

import { useEffect, useState } from "react";
import { PlayerView, TURN_MS, shortAddress } from "@/lib/tableView";
import Avatar from "./Avatar";
import PlayingCard from "./PlayingCard";

// Time left in the turn, redrawn a few times a second.
function useTurnClock(deadlineMs: number | null, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || deadlineMs === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [active, deadlineMs]);
  if (!active || deadlineMs === null) return null;
  const left = Math.max(0, deadlineMs - now);
  return { fraction: Math.min(1, left / TURN_MS), secs: Math.ceil(left / 1000) };
}

export default function PlayerSeat({
  index,
  player,
  isYou,
  isTurn,
  deadlineMs,
  hole,
  blind = null,
}: {
  index: number;
  player: PlayerView;
  isYou: boolean;
  isTurn: boolean;
  deadlineMs: number | null;
  hole: [string, string] | null; // only passed for your own seat
  blind?: "SB" | "BB" | null;
}) {
  const clock = useTurnClock(deadlineMs, isTurn);

  if (player.address === null) {
    return (
      <div className="flex h-[78px] w-[200px] items-center justify-center rounded-[16px] border border-dashed border-[#2a2a3d] text-xs text-slate-500">
        Seat {index + 1}: empty
      </div>
    );
  }

  const inHand = !player.folded && !player.busted;
  const shown = hole ?? player.revealed ?? null;
  const dim = !inHand;
  const urgent = clock !== null && clock.secs <= 10;
  const ringColor = urgent ? "#ff4d6d" : "#f5c542";

  return (
    <div className="relative flex w-[200px] flex-col items-center font-grotesk">
      {/* Cards. Your own hole cards are fanned and bigger. */}
      <div
        className={`mb-2 flex items-end justify-center ${isYou ? "h-[80px] translate-y-[6px] gap-0.5" : "h-[64px] gap-1"} ${
          dim ? "brightness-75 saturate-50" : ""
        }`}
      >
        {inHand && isYou && (
          <>
            <PlayingCard card={shown?.[0]} hidden={!shown} size="hand"  />
            <PlayingCard card={shown?.[1]} hidden={!shown} size="hand"  />
          </>
        )}
        {inHand && !isYou && (
          <>
            <PlayingCard card={shown?.[0]} hidden={!shown} size="opp" />
            <PlayingCard card={shown?.[1]} hidden={!shown} size="opp" />
          </>
        )}
        {!inHand && (
          <span className="mb-2 rounded-full border border-[#3a3a52] bg-[#14141f] px-4 py-1 text-xs font-semibold uppercase tracking-wider text-slate-300">
            {player.busted ? "Out" : "Folded"}
          </span>
        )}
      </div>

      {/* Name plate */}
      <div
        className={`relative flex h-[78px] w-full items-center gap-2.5 rounded-[16px] border-2 bg-[linear-gradient(180deg,#171726,#0c0c15)] px-3 ${
          isYou
            ? "border-[#d9a928] shadow-[0_0_28px_rgba(245,197,66,0.35)]"
            : isTurn
              ? "border-[#8a7330] shadow-[0_0_20px_rgba(245,197,66,0.22)]"
              : "border-[#34344a] shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
        } ${dim ? "brightness-75 saturate-50" : ""}`}
      >
        <div className="relative h-14 w-14 shrink-0">
          <div className="h-full w-full overflow-hidden rounded-full border-2 border-[#d9a928]/70">
            <Avatar address={player.address} className="h-full w-full" />
          </div>
          {player.isDealer && (
            <span
              title="Dealer"
              className="absolute -left-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-white text-xs font-extrabold text-black shadow"
            >
              D
            </span>
          )}
          <span
            title={player.connected ? "Connected" : "Disconnected"}
            className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-[#0c0c15] ${
              player.connected ? "bg-emerald-400" : "bg-red-500"
            }`}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate font-tmono text-[12px] text-slate-200">
            {isYou ? "You" : shortAddress(player.address)}
          </p>
          <p className="mt-0.5 text-[24px] font-bold leading-none text-[#f5c542]">{player.stack}</p>
        </div>

        {blind && (
          <span className="absolute bottom-2 right-2.5 rounded-md bg-[#2f4fd6] px-2 py-0.5 text-[11px] font-bold text-white">
            {blind}
          </span>
        )}
        {player.allIn && (
          <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-2.5 py-0.5 text-[10px] font-extrabold tracking-wide text-black">
            ALL-IN
          </span>
        )}

        {/* Turn clock */}
        {clock && (
          <div
            className="absolute -right-3 -top-4 z-10 flex h-[40px] w-[40px] items-center justify-center rounded-full p-[3px] shadow-[0_0_18px_rgba(0,0,0,0.6)]"
            style={{ background: `conic-gradient(${ringColor} ${clock.fraction * 360}deg, #2d2d3d 0)` }}
            role="timer"
            aria-label={`${clock.secs} seconds left`}
          >
            <span className="flex h-full w-full items-center justify-center rounded-full bg-[#0c0c15] text-[12px] font-bold text-white">
              {clock.secs}s
            </span>
          </div>
        )}
      </div>

      {isYou && isTurn && (
        <span className="turn-pill absolute -bottom-4 z-10 rounded-full bg-[#34d399] px-4 py-0.5 text-sm font-bold text-[#052e1d]">
          Your turn
        </span>
      )}
    </div>
  );
}
