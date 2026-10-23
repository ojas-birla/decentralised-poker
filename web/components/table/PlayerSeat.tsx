"use client";

import { PlayerView, shortAddress } from "@/lib/tableView";
import CountdownTimer from "./CountdownTimer";
import PlayingCard from "./PlayingCard";

export default function PlayerSeat({
  index,
  player,
  isYou,
  isTurn,
  deadlineMs,
  hole,
}: {
  index: number;
  player: PlayerView;
  isYou: boolean;
  isTurn: boolean;
  deadlineMs: number | null;
  hole: [string, string] | null; // only passed for your own seat
}) {
  if (player.address === null) {
    return (
      <div className="w-40 rounded-xl border border-dashed border-slate-500 p-3 text-center text-xs text-slate-400">
        Seat {index + 1}: empty
      </div>
    );
  }

  const inHand = !player.folded && !player.busted;
  const shown = hole ?? player.revealed ?? null;

  return (
    <div
      className={`w-40 rounded-xl bg-slate-700 p-2 text-xs shadow ${
        isTurn ? "ring-2 ring-green-400" : ""
      } ${player.folded || player.busted ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-2">
        <div className="relative h-9 w-9 shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-500 font-semibold">
            {index + 1}
          </div>
          <span
            title={player.connected ? "Connected" : "Disconnected"}
            className={`absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-slate-700 ${
              player.connected ? "bg-green-400" : "bg-red-500"
            }`}
          />
        </div>
        <div className="min-w-0">
          <p className="truncate font-mono text-[11px] text-slate-300">
            {shortAddress(player.address)}
          </p>
          <p className="font-medium">
            {isYou ? "You" : `Seat ${index + 1}`}
            {player.isDealer && (
              <span className="ml-1 rounded-full bg-white px-1.5 text-[10px] font-bold text-slate-900">
                D
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1">
        {inHand && shown ? (
          <>
            <PlayingCard card={shown[0]} small />
            <PlayingCard card={shown[1]} small />
          </>
        ) : inHand ? (
          <>
            <PlayingCard hidden small />
            <PlayingCard hidden small />
          </>
        ) : (
          <span className="text-slate-300">{player.busted ? "Busted" : "Folded"}</span>
        )}
        {player.allIn && (
          <span className="ml-auto rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-slate-900">
            ALL-IN
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="rounded-full bg-slate-900 px-2 py-0.5 font-medium">{player.stack}</span>
        {player.currentBet > 0 && (
          <span className="rounded-full bg-rose-500 px-2 py-0.5 font-medium">
            Bet {player.currentBet}
          </span>
        )}
      </div>

      {isTurn && deadlineMs !== null && (
        <p className="mt-1 text-green-300">
          Time left: <CountdownTimer deadlineMs={deadlineMs} />
        </p>
      )}
    </div>
  );
}