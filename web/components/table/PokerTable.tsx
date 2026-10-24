"use client";

import { ReactNode, useEffect, useState } from "react";
import { BIG_BLIND, SMALL_BLIND } from "@/lib/createTable";
import { Banner, LogEntry } from "@/lib/statusLog";
import { PlayerAction, TableView, blindSeats, potOdds, raisePresets, streetName } from "@/lib/tableView";
import ActionBar from "./ActionBar";
import EscrowPanel, { Escrow } from "./EscrowPanel";
import PlayerSeat from "./PlayerSeat";
import PlayingCard from "./PlayingCard";
import StatusBanner from "./StatusBanner";
import StatusLog from "./StatusLog";

// Your seat is always drawn at the bottom; the rest go clockwise from there.
const SEAT_POS = [
  "bottom-[14px] left-1/2 -translate-x-1/2",
  "left-[9%] top-[52%] -translate-y-1/2",
  "top-[clamp(52px,6vh,76px)] left-1/2 -translate-x-1/2",
  "right-[9%] top-[52%] -translate-y-1/2",
];

// Where each seat's current bet sits on the felt, between the seat and the pot.
const BET_POS = [
  "bottom-[136px] left-[calc(50%+90px)]",
  "left-[calc(9%+222px)] top-[52%] -translate-y-1/2",
  "top-[calc(clamp(52px,6vh,76px)+96px)] left-[calc(50%+124px)]",
  "right-[calc(9%+222px)] top-[52%] -translate-y-1/2",
];

const barBtn =
  "flex h-[52px] items-center gap-2.5 rounded-2xl border border-[#2b3350] bg-[#0b0b13]/90 px-5 text-[15px] font-medium text-slate-100 transition-colors hover:border-[#5b6aa8]";

type Panel = "log" | "fair" | null;

function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

const CHAIN_NAMES: Record<string, string> = { "84532": "Base Sepolia", "8453": "Base" };

function Divider() {
  return <span aria-hidden className="h-9 w-px bg-[#23233a]" />;
}

export default function PokerTable({
  view,
  log,
  banner,
  pending = false,
  busy = null,
  onAction,
  resultSlot,
  extras,
  escrow = null,
}: {
  view: TableView;
  log: LogEntry[];
  banner: Banner | null;
  pending?: boolean; // an action is in flight: the whole action bar is disabled
  busy?: string | null; // dealing spinner text (null = no spinner)
  onAction: (action: PlayerAction) => void;
  resultSlot?: ReactNode; // last hand result, shown floating over the table
  extras?: ReactNode; // small panels (exit/refund, errors), docked at the left
  escrow?: Escrow | null; // buy-in numbers for the Escrow & Funds panel
}) {
  const [panel, setPanel] = useState<Panel>(null);

  useEffect(() => {
    if (!panel) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setPanel(null);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [panel]);

  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));

  const myTurn = view.turnSeat !== null && view.turnSeat === view.mySeat;
  const offset = view.mySeat ?? 0;
  const myStack = view.mySeat !== null ? view.seats[view.mySeat].stack : 0;
  const presets = view.legal && view.mySeat !== null ? raisePresets(view, view.legal) : null;
  const odds = view.legal ? potOdds(view, view.legal) : null;
  const blinds = blindSeats(view.seats);
  const seated = view.seats.filter((p) => p.address !== null);
  const online = seated.filter((p) => p.connected).length;
  const chainId = process.env.NEXT_PUBLIC_CHAIN_ID ?? "";
  const linkOk = banner?.level !== "error";

  const status =
    view.turnSeat === null
      ? "Waiting for the next step."
      : myTurn
        ? "Your turn."
        : `Waiting for seat ${view.turnSeat + 1} to act.`;

  return (
    // !m-0: parents like TableScreen use space-y-*, whose margin would push a fixed element down.
    <div className="table-stage fixed inset-0 z-10 !m-0 overflow-auto font-grotesk text-white">
      <div className="relative mx-auto h-full min-h-[880px] min-w-[1180px]">
        <p className="sr-only" role="status" aria-live="polite">
          {status}
        </p>

        {/* Top left: hand info */}
        <div className="absolute left-6 top-5 z-30 flex items-center gap-5 rounded-2xl border border-[#23233a] bg-[#0b0b13]/90 px-5 py-3">
          <div>
            <p className="text-xl font-bold leading-tight">
              Hand {view.handNumber}
              <span className="font-medium text-slate-400"> of {view.totalHands}</span>
            </p>
            <p className="text-sm text-slate-400">
              Table #{view.tableId} · Texas Hold&apos;em · {seated.length} Players
            </p>
          </div>
          <Divider />
          <div className="text-sm">
            <p className="flex items-center gap-1.5 text-slate-400">
              <span className="h-2 w-2 rounded-full bg-[#f5c542]" /> Blinds
            </p>
            <p className="text-lg font-semibold">
              {SMALL_BLIND} / {BIG_BLIND}
            </p>
          </div>
          <Divider />
          <div className="text-sm">
            <p className="text-slate-400">Next Raise</p>
            <p className="text-lg font-semibold">{view.legal ? view.legal.minRaiseTo : "–"}</p>
          </div>
          <Divider />
          <span className="rounded-full border-2 border-[#d9a928] px-4 py-1.5 text-[15px] font-semibold text-[#f5c542] shadow-[0_0_14px_rgba(245,197,66,0.25)]">
            {streetName(view.board.length)}
          </span>
        </div>

        {/* Top right: panels */}
        <div className="absolute right-6 top-5 z-30 flex items-center gap-3">
          <button onClick={() => toggle("fair")} aria-expanded={panel === "fair"} className={barBtn}>
            <Icon d="M12 3l8 3v6c0 4.500-3.200 8-8 9.500C7.200 20 4 16.500 4 12V6zM9 12l2 2 4-4" />
            Provably fair
          </button>
          <button onClick={() => toggle("log")} aria-expanded={panel === "log"} className={barBtn}>
            <Icon d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
            Log
          </button>
        </div>

<<<<<<< HEAD
        {/* Docked right panel */}
        {panel && (
          <div className="absolute right-6 top-[86px] z-40 max-h-[calc(100%-340px)] w-[360px] space-y-3 overflow-auto rounded-2xl border border-[#2a2a3d] bg-[#0c0c14] p-4 text-sm shadow-2xl">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2.5 text-base font-semibold">
                <Icon
                  className="h-6 w-6 text-emerald-400"
                  d={panel === "fair" ? "M12 3l8 3v6c0 4.500-3.200 8-8 9.500C7.200 20 4 16.500 4 12V6zM9 12l2 2 4-4" : "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"}
                />
                {panel === "fair" ? "Fairness Details" : "What just happened"}
              </p>
              <button
                onClick={() => setPanel(null)}
                aria-label="Close"
                className="rounded px-2 text-xl leading-none text-slate-400 hover:text-white"
              >
                ×
              </button>
            </div>
            {panel === "log" ? (
              <StatusLog entries={log} className="h-72" />
            ) : (
              <>
                <ul className="space-y-2.5 text-slate-300">
                  <li>
                    <span className="font-semibold text-white">Padlock shuffle.</span> All four players
                    lock the deck in turn, so neither the server nor another player can see your cards or
                    fix the order.
                  </li>
                  <li>
                    <span className="font-semibold text-white">Signed actions.</span> Every move is
                    signed by its player and checked by everyone at the table.
                  </li>
                  <li>
                    <span className="font-semibold text-white">Verified reveals.</span> Cards shown at
                    showdown are checked against the shuffle.
                  </li>
                </ul>
                {escrow && <EscrowPanel escrow={escrow} className="min-[1680px]:hidden" />}
              </>
            )}
=======
      <p
        className={`mx-auto w-fit rounded-full px-3 py-1 text-sm ${
          myTurn ? "bg-green-500 font-semibold text-slate-900" : "bg-slate-700"
        }`}
      >
        {status}
      </p>

      <StatusBanner banner={banner} />
            {busy && (
        <p
          role="status"
          className="mx-auto flex w-fit items-center gap-2 text-sm text-slate-200"
        >
          <span
            aria-hidden
            className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"
          />
          {busy}
        </p>
      )}

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
>>>>>>> af98599 (web: add dealing UI helpers and mock previews)
          </div>
        )}

        {/* Connection and table notices */}
        <div className="absolute inset-x-0 top-[96px] z-30 mx-auto w-fit max-w-[560px] px-4">
          <StatusBanner banner={banner} />
        </div>

        {resultSlot}

        {/* Table area, above the action panel */}
        <div className="absolute inset-x-0 bottom-[262px] top-0">
          <div className="felt absolute inset-x-[21%] bottom-[23%] top-[26%]">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pt-0">
              <div className="flex items-center gap-3 rounded-full border border-[#2b3350] bg-[#0a0a12] px-5 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
                <span aria-hidden className="relative h-9 w-11">
                  <span className="absolute bottom-0 left-0 h-5 w-9 rounded-full border-2 border-white/80 bg-[#d6293e]" />
                  <span className="absolute bottom-2 left-2 h-5 w-9 rounded-full border-2 border-white/80 bg-[#2f4fd6]" />
                  <span className="absolute bottom-4 left-1 h-5 w-9 rounded-full border-2 border-white/80 bg-[#d6293e]" />
                </span>
                <div className="leading-none">
                  <p className="text-xs font-semibold tracking-widest text-white/80">POT</p>
                  <p className="mt-1 text-[26px] font-bold text-white">{view.pot}</p>
                </div>
              </div>
              <div className="flex gap-3">
                {Array.from({ length: 5 }).map((_, i) =>
                  view.board[i] ? (
                    <PlayingCard key={i} card={view.board[i]} size="board" />
                  ) : (
                    <PlayingCard key={i} hidden size="board" />
                  )
                )}
              </div>
            </div>
          </div>

          {view.seats.map((p, i) => {
            const slot = (i - offset + 4) % 4;
            return (
              <div key={`bet-${i}`}>
                {p.currentBet > 0 && (
                  <span
                    className={`absolute z-20 whitespace-nowrap rounded-full bg-[#ff2d87] px-3.5 py-1 text-sm font-bold text-white shadow-[0_0_14px_rgba(255,45,135,0.45)] ${BET_POS[slot]}`}
                  >
                    Bet {p.currentBet}
                  </span>
                )}
              </div>
            );
          })}

          {view.seats.map((p, i) => (
            <div key={i} className={`absolute z-10 ${SEAT_POS[(i - offset + 4) % 4]}`}>
              <PlayerSeat
                index={i}
                player={p}
                isYou={view.mySeat === i}
                isTurn={view.turnSeat === i}
                deadlineMs={view.turnDeadlineMs}
                hole={view.mySeat === i ? view.myHole : null}
                blind={blinds.sb === i ? "SB" : blinds.bb === i ? "BB" : null}
              />
            </div>
          ))}
        </div>

        {/* Left dock: escrow (wide screens), exit/refund and errors */}
        <div className="absolute left-6 top-[104px] z-30 flex w-[300px] flex-col gap-3 text-sm min-[1680px]:bottom-6 min-[1680px]:top-auto">
          {escrow && (
            <div className="hidden min-[1680px]:block">
              <EscrowPanel escrow={escrow} />
            </div>
          )}
          {extras}
        </div>

        {/* Action panel */}
        <div className="absolute bottom-4 left-1/2 z-20 w-[min(880px,calc(100%-48px))] -translate-x-1/2">
          <ActionBar
            legal={view.legal}
            presets={presets}
            myStack={myStack}
            potOdds={odds}
            enabled={myTurn && !pending}
            pending={pending}
            outOfChips={view.mySeat !== null && view.seats[view.mySeat].busted}
            onAction={onAction}
          />
        </div>

        {/* Bottom right: connection */}
        <div className="absolute bottom-6 right-6 z-20 hidden items-center gap-4 rounded-2xl border border-[#23233a] bg-[#0b0b13]/90 px-4 py-3 text-xs min-[1440px]:flex">
          <div className="flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 rounded-full ${linkOk ? "bg-emerald-400" : "bg-red-500"}`} />
            <div>
              <p className={`text-sm font-semibold ${linkOk ? "text-emerald-300" : "text-red-300"}`}>
                {linkOk ? "Connected" : "Offline"}
              </p>
              <p className="text-slate-400">
                {online}/{seated.length} players
              </p>
            </div>
          </div>
          <Divider />
          <div>
            <p className="text-sm font-semibold">{CHAIN_NAMES[chainId] ?? `Chain ${chainId || "?"}`}</p>
            <p className="text-slate-400">Network</p>
          </div>
        </div>
      </div>
    </div>
  );
}
