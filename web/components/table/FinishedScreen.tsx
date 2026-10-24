"use client";

// The "Game finished" screen: final table, chip counts and the payout card.
import Link from "next/link";
import type { ReactNode } from "react";
import { formatEther } from "ethers";
import CreateHeader from "@/components/create/CreateHeader";
import Avatar from "./Avatar";
import PlayingCard from "./PlayingCard";

export interface FinishedSeat {
  address: string | null;
  chips: number;
}

const TROPHY = "M8 4h8v5a4 4 0 01-8 0zM8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8.500 20h7M10 17h4";
const COINS =
  "M3 7c0-1.700 2.700-3 6-3s6 1.300 6 3-2.700 3-6 3-6-1.300-6-3zM3 7v5c0 1.700 2.700 3 6 3M3 12v5c0 1.700 2.700 3 6 3 1.200 0 2.300-.2 3.200-.5M15 10c3.300 0 6 1.300 6 3s-2.700 3-6 3-6-1.300-6-3 2.700-3 6-3zM21 13v4c0 1.700-2.700 3-6 3s-6-1.300-6-3";

function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** 1000 chips of a 0.001 buy-in -> "0.0010". At least 4 decimals so the column lines up. */
function fmtEth(wei: bigint): string {
  const [i, f = ""] = formatEther(wei).split(".");
  return `${i}.${f.padEnd(4, "0")}`;
}

type Status = "Winner" | "Lost" | "Tie";

function statuses(seats: FinishedSeat[]): Status[] {
  const max = Math.max(...seats.map((s) => s.chips));
  const allEqual = seats.every((s) => s.chips === max);
  return seats.map((s) => (allEqual ? "Tie" : s.chips === max ? "Winner" : "Lost"));
}

const PILL: Record<Status, string> = {
  Winner: "bg-[#0f5a37] text-emerald-300",
  Tie: "bg-[#3a2f10] text-[#f5c542]",
  Lost: "bg-white/5 text-slate-400",
};

function StatusPill({ status, className = "" }: { status: Status; className?: string }) {
  return (
    <span className={`inline-flex h-8 min-w-[60px] items-center justify-center rounded-lg px-3 text-xs font-semibold ${PILL[status]} ${className}`}>
      {status}
    </span>
  );
}

// Your seat is drawn at the bottom, the others clockwise from there (same as the live table).
const PLATE_POS = [
  "left-1/2 top-[80%] -translate-x-1/2 -translate-y-1/2",
  "left-2 top-[47%] -translate-y-1/2",
  "left-1/2 top-[13%] -translate-x-1/2 -translate-y-1/2",
  "right-2 top-[47%] -translate-y-1/2",
];

function SeatPlate({
  seat,
  index,
  isYou,
  status,
  eth,
  className,
}: {
  seat: FinishedSeat;
  index: number;
  isYou: boolean;
  status: Status;
  eth: string | null;
  className: string;
}) {
  const win = status === "Winner";
  return (
    <div
      className={`absolute z-10 flex h-[76px] w-[220px] items-center gap-2.5 rounded-2xl border bg-[linear-gradient(180deg,#171726,#0c0c15)] px-3 ${
        win
          ? "border-[#d9a928] shadow-[0_0_28px_rgba(245,197,66,0.3)]"
          : isYou
            ? "border-[#4a4a6a]"
            : "border-[#2a2a3d]"
      } ${className}`}
    >
      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full border-2 border-[#d9a928]/60">
        <Avatar address={seat.address ?? "empty"} className="h-full w-full" />
      </div>
      <div className="min-w-0 flex-1 text-[12px] leading-snug">
        <p className="truncate font-medium text-white">
          Seat {index + 1}
          {isYou ? " (You)" : ""}
        </p>
        <p className="text-slate-300">{seat.chips} chips</p>
        <p className="text-slate-400">{eth ? `${eth} ETH` : "–"}</p>
      </div>
      <StatusPill status={status} className="!h-7 !min-w-[52px] !px-2" />
    </div>
  );
}

function TableArt() {
  return (
    <svg viewBox="0 0 780 600" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <radialGradient id="fin-felt" cx="50%" cy="42%" r="65%">
          <stop offset="0" stopColor="#168a5c" />
          <stop offset="0.6" stopColor="#0f6a47" />
          <stop offset="1" stopColor="#0a4e34" />
        </radialGradient>
        <radialGradient id="fin-floor" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#7c3aed" stopOpacity="0.22" />
          <stop offset="1" stopColor="#7c3aed" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="390" cy="330" rx="390" ry="250" fill="url(#fin-floor)" />
      {/* Chairs peeking out behind the table */}
      {[
        { x: 335, y: 18, w: 110, h: 72, r: 0 },
        { x: 110, y: 120, w: 100, h: 70, r: -38 },
        { x: 570, y: 120, w: 100, h: 70, r: 38 },
        { x: 80, y: 410, w: 100, h: 70, r: 38 },
        { x: 600, y: 410, w: 100, h: 70, r: -38 },
        { x: 335, y: 510, w: 110, h: 72, r: 0 },
      ].map((c, i) => (
        <rect
          key={i}
          x={c.x}
          y={c.y}
          width={c.w}
          height={c.h}
          rx="26"
          fill="#0d0d15"
          stroke="#202033"
          transform={`rotate(${c.r} ${c.x + c.w / 2} ${c.y + c.h / 2})`}
        />
      ))}
      {/* Table: edge, rail, felt */}
      <ellipse cx="390" cy="312" rx="350" ry="192" fill="#0c0807" />
      <ellipse cx="390" cy="292" rx="350" ry="192" fill="#1c130d" stroke="#d9a928" strokeOpacity="0.35" />
      <ellipse cx="390" cy="292" rx="322" ry="168" fill="url(#fin-felt)" stroke="#000" strokeOpacity="0.35" />
      <ellipse cx="390" cy="292" rx="292" ry="146" fill="none" stroke="#fff" strokeOpacity="0.07" />
    </svg>
  );
}

export default function FinishedScreen({
  tableId,
  seats,
  mySeat,
  board,
  buyInWei,
  totalHands,
  notices,
  payout,
  overlay,
}: {
  tableId: string;
  seats: FinishedSeat[]; // 4 seats, seat 0 first
  mySeat: number | null;
  board: string[]; // card codes such as "As"
  buyInWei: string | null;
  totalHands: number | null;
  notices?: ReactNode;
  payout?: ReactNode;
  overlay?: ReactNode;
}) {
  const buyIn = buyInWei && /^\d+$/.test(buyInWei) ? BigInt(buyInWei) : 0n;
  const eth = (chips: number) => (buyIn > 0n ? fmtEth((BigInt(chips) * buyIn) / 1000n) : null);
  const status = statuses(seats);
  const offset = mySeat ?? 0;
  const subtitle = ["4-player Texas Hold'em", totalHands ? `${totalHands} hands` : null, "Game finished"]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="table-stage fixed inset-0 z-10 !m-0 overflow-auto font-grotesk text-white">
      <CreateHeader wide />

      <div className="mx-auto w-full max-w-[1280px] px-6 pb-12">
        <div className="mb-5 flex items-center justify-between">
          <Link
            href="/lobby"
            className="flex h-11 items-center gap-2 rounded-full border border-[#2a2a3d] bg-[#0e0e18] pl-3 pr-5 text-sm font-medium text-slate-100 transition-colors hover:border-[#4a4a6a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5c542]"
          >
            <Icon d="M15 6l-6 6 6 6" className="h-[18px] w-[18px]" />
            Back to Lobby
          </Link>
          <span className="flex h-11 items-center gap-2.5 rounded-full border border-[#d9a928]/70 bg-[#f5c542]/10 px-5 text-sm font-semibold text-[#f5c542]">
            <Icon d={TROPHY} className="h-5 w-5" />
            Game Finished
          </span>
        </div>

        {notices && <div className="mb-4 space-y-3">{notices}</div>}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_460px]">
          {/* Left: the table */}
          <div className="overflow-x-auto rounded-2xl border border-[#23233a] bg-[#0a0a12]/80">
            <div className="relative mx-auto aspect-[1.3/1] min-w-[760px]">
              <TableArt />

              {board.length > 0 && (
                <div className="absolute left-1/2 top-[47%] z-[5] flex -translate-x-1/2 -translate-y-1/2 scale-90 gap-1.5">
                  {board.slice(0, 5).map((c, i) => (
                    <PlayingCard key={i} card={c} size="opp" />
                  ))}
                </div>
              )}

              {seats.map((s, i) => (
                <SeatPlate
                  key={i}
                  seat={s}
                  index={i}
                  isYou={mySeat === i}
                  status={status[i]}
                  eth={eth(s.chips)}
                  className={PLATE_POS[(i - offset + 4) % 4]}
                />
              ))}
            </div>
          </div>

          {/* Right: results and payout */}
          <aside className="space-y-4 rounded-2xl border border-[#23233a] bg-[#0d0d16]/95 p-5">
            <div>
              <h1 className="text-[28px] font-bold leading-tight">Table #{tableId}</h1>
              <p className="mt-1.5 text-sm text-slate-400">{subtitle}</p>
            </div>

            <section className="rounded-2xl border border-[#23233a] bg-[#0b0b13]">
              <h2 className="flex items-center gap-2.5 px-4 py-3.5 text-[15px] font-semibold">
                <Icon d={COINS} className="h-5 w-5 text-slate-300" />
                Final chip counts &amp; deposits
              </h2>
              <ul>
                {seats.map((s, i) => {
                  const win = status[i] === "Winner";
                  return (
                    <li
                      key={i}
                      className={`grid grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_auto] items-center gap-3 border-t px-4 py-2.5 text-[13px] ${
                        win ? "rounded-xl border-[#d9a928] bg-[#16130f]" : "border-[#1c1c2e]"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-[#d9a928]/50">
                          <Avatar address={s.address ?? "empty"} className="h-full w-full" />
                        </span>
                        <span className="truncate font-medium text-white">
                          Seat {i + 1}
                          {mySeat === i ? " (You)" : ""}
                        </span>
                      </span>
                      <span className="whitespace-nowrap text-slate-300">{s.chips} chips</span>
                      <span className="whitespace-nowrap text-slate-400">{eth(s.chips) ? `${eth(s.chips)} ETH` : "–"}</span>
                      <StatusPill status={status[i]} />
                    </li>
                  );
                })}
              </ul>
            </section>

            {payout}

            <Link
              href="/lobby"
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#3a3a52] text-[15px] font-medium text-slate-100 transition-colors hover:border-[#6a6a8c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5c542]"
            >
              <Icon d="M15 6l-6 6 6 6" className="h-[18px] w-[18px]" />
              Back to the lobby
            </Link>
          </aside>
        </div>
      </div>

      {overlay}
    </div>
  );
}
