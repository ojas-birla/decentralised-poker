"use client";

import { PlayerAction, TableView, raisePresets } from "@/lib/tableView";
import ActionBar from "./ActionBar";
import PlayerSeat from "./PlayerSeat";
import PlayingCard from "./PlayingCard";

// Your seat is always drawn at the bottom; the rest go clockwise from there.
const POSITIONS = [
  "bottom-0 left-1/2 -translate-x-1/2",
  "left-0 top-1/2 -translate-y-1/2",
  "top-0 left-1/2 -translate-x-1/2",
  "right-0 top-1/2 -translate-y-1/2",
];

export default function PokerTable({
  view,
  onAction,
}: {
  view: TableView;
  onAction: (action: PlayerAction) => void;
}) {
  const myTurn = view.turnSeat !== null && view.turnSeat === view.mySeat;
  const offset = view.mySeat ?? 0;
  const myStack = view.mySeat !== null ? view.seats[view.mySeat].stack : 0;
  const presets = view.legal && view.mySeat !== null ? raisePresets(view, view.legal) : null;

  const status =
    view.turnSeat === null
      ? "Waiting for the next step."
      : myTurn
        ? "Your turn."
        : `Waiting for seat ${view.turnSeat + 1} to act.`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Table #{view.tableId}</h1>
        <p className="text-sm text-gray-600">
          Hand {view.handNumber} of {view.totalHands} · {status}
        </p>
      </div>

      <div className="space-y-4 rounded-3xl bg-slate-800 p-4 text-white">
        <div className="overflow-x-auto">
          <div className="relative mx-auto h-[560px] min-w-[680px] max-w-3xl">
            <div className="absolute inset-x-[11rem] inset-y-[5.5rem] flex flex-col items-center justify-center gap-4 rounded-[9999px] border-4 border-slate-600 bg-slate-900/60">
              <p className="text-sm">
                Pot: <span className="font-semibold text-rose-300">{view.pot}</span>
              </p>
              <div className="flex gap-2">
                {Array.from({ length: 5 }).map((_, i) =>
                  view.board[i] ? (
                    <PlayingCard key={i} card={view.board[i]} />
                  ) : (
                    <div key={i} className="h-16 w-11 rounded border border-dashed border-slate-600" />
                  )
                )}
              </div>
            </div>

            {view.seats.map((p, i) => (
              <div key={i} className={`absolute ${POSITIONS[(i - offset + 4) % 4]}`}>
                <PlayerSeat
                  index={i}
                  player={p}
                  isYou={view.mySeat === i}
                  isTurn={view.turnSeat === i}
                  deadlineMs={view.turnDeadlineMs}
                  hole={view.mySeat === i ? view.myHole : null}
                />
              </div>
            ))}
          </div>
        </div>

        <ActionBar
          legal={view.legal}
          presets={presets}
          myStack={myStack}
          enabled={myTurn}
          onAction={onAction}
        />
      </div>
    </div>
  );
}