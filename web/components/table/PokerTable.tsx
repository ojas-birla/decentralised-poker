"use client";

import { useState } from "react";
import { Banner, LogEntry } from "@/lib/statusLog";
import { PlayerAction, TableView, raisePresets } from "@/lib/tableView";
import ActionBar from "./ActionBar";
import PlayerSeat from "./PlayerSeat";
import PlayingCard from "./PlayingCard";
import StatusBanner from "./StatusBanner";
import StatusLog from "./StatusLog";

// Your seat is always drawn at the bottom; the rest go clockwise from there.
const POSITIONS = [
  "bottom-0 left-1/2 -translate-x-1/2",
  "left-0 top-1/2 -translate-y-1/2",
  "top-0 left-1/2 -translate-x-1/2",
  "right-0 top-1/2 -translate-y-1/2",
];

export default function PokerTable({
  view,
  log,
  banner,
  onAction,
}: {
  view: TableView;
  log: LogEntry[];
  banner: Banner | null;
  onAction: (action: PlayerAction) => void;
}) {
  const [logOpen, setLogOpen] = useState(false);

  const myTurn = view.turnSeat !== null && view.turnSeat === view.mySeat;
  const offset = view.mySeat ?? 0;
  const myStack = view.mySeat !== null ? view.seats[view.mySeat].stack : 0;
  const presets = view.legal && view.mySeat !== null ? raisePresets(view, view.legal) : null;
  const last = log.length > 0 ? log[log.length - 1].text : "Nothing has happened yet.";

  const status =
    view.turnSeat === null
      ? "Waiting for the next step."
      : myTurn
        ? "Your turn."
        : `Waiting for seat ${view.turnSeat + 1} to act.`;

  return (
    <div className="relative space-y-3 rounded-3xl bg-slate-800 p-4 text-white">
      {/* Top bar: table on the left, pot and log button on the right */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-300">
          Table #{view.tableId} · Hand {view.handNumber} of {view.totalHands}
        </p>
        <div className="flex items-center gap-3">
          <p className="text-sm">
            Pot <span className="font-semibold text-rose-300">{view.pot}</span>
          </p>
          <button
            onClick={() => setLogOpen((open) => !open)}
            aria-expanded={logOpen}
            aria-label="Show or hide what just happened"
            className="rounded-lg border border-slate-500 px-2 py-1 text-sm"
          >
            ≡ Log
          </button>
        </div>
      </div>

      <p
        className={`mx-auto w-fit rounded-full px-3 py-1 text-sm ${
          myTurn ? "bg-green-500 font-semibold text-slate-900" : "bg-slate-700"
        }`}
      >
        {status}
      </p>

      <StatusBanner banner={banner} />

      {/* Event log panel, opened with the button above */}
      {logOpen && (
        <div className="absolute right-4 top-14 z-20 w-72 rounded-xl border border-slate-600 bg-slate-900 p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between text-sm">
            <p className="font-semibold">What just happened</p>
            <button
              onClick={() => setLogOpen(false)}
              aria-label="Close log"
              className="rounded px-2 text-slate-300"
            >
              ×
            </button>
          </div>
          <StatusLog entries={log} className="h-64" />
        </div>
      )}

      <div className="overflow-x-auto">
        <div className="relative mx-auto h-[560px] min-w-[680px] max-w-3xl">
          <div className="absolute inset-x-[11rem] inset-y-[5.5rem] flex items-center justify-center rounded-[9999px] border-4 border-slate-600 bg-slate-900/60">
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

      <p className="text-center text-xs text-slate-400">
        Table #{view.tableId} · 4 seats · Last: {last}
      </p>
    </div>
  );
}