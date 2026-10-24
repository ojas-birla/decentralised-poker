"use client";

// The waiting room: the table before the game starts (lobby, deposits, ready check).
import Link from "next/link";
import { ReactNode, useState } from "react";
import CreateHeader from "@/components/create/CreateHeader";
import { SEATS } from "@/lib/lobby";
import { weiToEth } from "@/lib/createTable";
import { shortAddress } from "@/lib/tableView";
import { SeatView, WaitingRoomState, bannerText, countWhere, filledSeats } from "@/lib/waitingRoom";
import Avatar from "./Avatar";

const ICON = {
  back: "M19 12H5M11 6l-6 6 6 6",
  coins: "M3 7c0-1.700 2.700-3 6-3s6 1.300 6 3-2.700 3-6 3-6-1.300-6-3zM3 7v5c0 1.700 2.700 3 6 3M3 12v5c0 1.700 2.700 3 6 3 1.200 0 2.300-.2 3.200-.5M15 10c3.300 0 6 1.300 6 3s-2.700 3-6 3-6-1.300-6-3 2.700-3 6-3zM21 13v4c0 1.700-2.700 3-6 3s-6-1.300-6-3",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  players: "M9 11a3 3 0 100-6 3 3 0 000 6zM3 19c0-3 2.700-5 6-5s6 2 6 5M17 11a2.500 2.500 0 100-5M18 14.200c2 .4 3.500 1.900 3.500 4.300",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  chevron: "M6 15l6-6 6 6",
  copy: "M9 9h10v11H9zM5 15V4h10",
  check: "M5 12.500l4.500 4.500L19 7.500",
  diamond: "M12 3l9 9-9 9-9-9z",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 3.600-6 8-6s8 2 8 6",
  plus: "M12 5v14M5 12h14",
};

function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function EthGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 text-indigo-300" fill="currentColor" aria-hidden>
      <path d="M12 2l-6.500 10.200L12 16l6.500-3.800zM12 17.300l-6.500-3.800L12 22l6.500-8.500z" opacity=".9" />
    </svg>
  );
}

// One yes/no flag: a green tick, or an empty ring.
function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center" title={`${label}: ${on ? "yes" : "no"}`}>
      {on ? (
        <Icon d={ICON.check} className="h-5 w-5 text-emerald-400" />
      ) : (
        <span className="h-[18px] w-[18px] rounded-full border-2 border-[#3a3a52]" />
      )}
      <span className="sr-only">
        {label}: {on ? "yes" : "no"}
      </span>
    </span>
  );
}

const STATE_PILL: Record<string, { label: string; cls: string }> = {
  lobby: { label: "Waiting for players", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  waiting_deposits: { label: "Waiting for deposits", cls: "border-amber-400/40 bg-amber-400/10 text-amber-300" },
  ready: { label: "Ready check", cls: "border-[#d9a928]/50 bg-[#f5c542]/10 text-[#f5c542]" },
};

function Tile({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-[#23233a] bg-[#0c0c14]/90 px-5 py-3.5">
      <Icon d={icon} className="h-7 w-7 shrink-0 text-[#e3bb5a]" />
      <div className="leading-tight">
        <p className="whitespace-nowrap text-[15px] font-semibold text-white">{value}</p>
        <p className="mt-1 whitespace-nowrap text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

// Seats are fixed: 1 at the top, then clockwise.
const SEAT_POS = [
  "left-1/2 top-0 -translate-x-1/2",
  "right-0 top-[46%] -translate-y-1/2",
  "left-1/2 top-[82%] -translate-x-1/2 -translate-y-1/2",
  "left-0 top-[46%] -translate-y-1/2",
];

function SeatCard({ index, seat, isYou, className }: { index: number; seat: SeatView; isYou: boolean; className: string }) {
  const base = "absolute z-10 w-[260px] rounded-2xl border bg-[#0b0b13]/95 shadow-[0_14px_40px_rgba(0,0,0,0.5)]";

  if (seat.address === null) {
    return (
      <div className={`${base} flex items-center gap-4 border-[#23233a] px-5 py-4 ${className}`}>
        <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#3a3a52] text-slate-300">
          <Icon d={ICON.plus} className="h-5 w-5" />
        </span>
        <div className="min-w-0 text-[13px] leading-snug">
          <p className="font-semibold text-white">Seat {index + 1}</p>
          <p className="text-slate-300">Empty</p>
          <p className="text-slate-500">Waiting for a player to join.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${base} px-4 py-3.5 ${
        isYou ? "border-[#d9a928] shadow-[0_0_30px_rgba(245,197,66,0.28)]" : "border-[#2a2a3d]"
      } ${className}`}
    >
      <div className="flex items-start gap-3">
        <span className="relative h-11 w-11 shrink-0">
          <span className="block h-full w-full overflow-hidden rounded-full border-2 border-[#d9a928]/60">
            <Avatar address={seat.address} className="h-full w-full" />
          </span>
          <span
            title={seat.connected ? "Connected" : "Disconnected"}
            className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#0b0b13] ${seat.connected ? "bg-emerald-400" : "bg-red-500"}`}
          />
        </span>
        <div className="min-w-0 flex-1 text-[13px] leading-snug">
          <p className="truncate font-semibold text-white">
            Seat {index + 1}
            {isYou && <span className="font-normal text-slate-300"> (You)</span>}
          </p>
          <p className="font-tmono text-xs text-slate-400">{shortAddress(seat.address)}</p>
        </div>
        {isYou && (
          <span className="rounded-full border border-slate-500 px-2.5 py-0.5 text-[11px] font-medium text-slate-200">You</span>
        )}
      </div>
      <ul className="mt-3 space-y-1.5 text-[13px] text-slate-300">
        {(
          [
            ["Connected", seat.connected],
            ["Deposited", seat.deposited],
            ["Ready", seat.ready],
          ] as const
        ).map(([label, on]) => (
          <li key={label} className="flex items-center justify-between">
            <span>{label}</span>
            <Flag on={on} label={label} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TableArt() {
  return (
    <svg viewBox="0 0 1000 556" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <radialGradient id="wr-felt" cx="50%" cy="40%" r="70%">
          <stop offset="0" stopColor="#0f5f3d" />
          <stop offset="1" stopColor="#093f29" />
        </radialGradient>
      </defs>
      <ellipse cx="500" cy="290" rx="490" ry="232" fill="#050508" opacity="0.7" />
      <ellipse cx="500" cy="270" rx="480" ry="222" fill="#12100f" stroke="#d9a928" strokeOpacity="0.55" strokeWidth="1.5" />
      <ellipse cx="500" cy="270" rx="462" ry="206" fill="#0d0a08" />
      <ellipse cx="500" cy="270" rx="452" ry="198" fill="url(#wr-felt)" stroke="#d9a928" strokeOpacity="0.25" />
      <circle cx="500" cy="270" r="34" fill="#000" opacity="0.12" />
    </svg>
  );
}

function Collapse({ icon, title, children, defaultOpen = true }: { icon: string; title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-2xl border border-[#23233a] bg-[#0d0d16]/95">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-2xl px-5 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#f5c542]"
      >
        <span className="flex items-center gap-3 text-base font-semibold">
          <Icon d={icon} className="h-5 w-5 text-[#e3bb5a]" />
          {title}
        </span>
        <Icon d={ICON.chevron} className={`h-5 w-5 text-slate-400 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
      {open && <div className="border-t border-[#1c1c2e]">{children}</div>}
    </section>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-3 text-[14px]">
      <span className="text-slate-400">{label}</span>
      <span className="flex items-center gap-2 text-white">{children}</span>
    </div>
  );
}

export default function WaitingRoom({
  room,
  myAddress,
  notices,
  exit,
}: {
  room: WaitingRoomState;
  myAddress: string | null;
  notices?: ReactNode; // connection / network banners
  exit?: ReactNode; // the "cancel and refund" controls
}) {
  const [copied, setCopied] = useState(false);
  const filled = filledSeats(room);
  const pill = STATE_PILL[room.state] ?? STATE_PILL.lobby;
  const buyIn = /^\d+$/.test(room.buyInWei) && room.buyInWei !== "0" ? weiToEth(room.buyInWei) : null;

  async function copyId() {
    try {
      await navigator.clipboard.writeText(room.tableId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="table-stage fixed inset-0 z-10 !m-0 overflow-auto font-grotesk text-white">
      <CreateHeader wide />

      <div className="mx-auto w-full max-w-[1280px] px-6 pb-12">
        <Link
          href="/lobby"
          className="inline-flex h-11 items-center gap-2 rounded-full border border-[#2a2a3d] bg-[#0e0e18] pl-3.5 pr-5 text-sm font-medium text-slate-100 transition-colors hover:border-[#4a4a6a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5c542]"
        >
          <Icon d={ICON.back} className="h-[18px] w-[18px]" />
          Back
        </Link>

        {/* Title and quick facts */}
        <div className="mt-5 flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="flex flex-wrap items-center gap-4">
              <h1 className="text-[40px] font-bold leading-none">Table #{room.tableId}</h1>
              <span className={`flex h-9 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium ${pill.cls}`}>
                <Icon d={ICON.diamond} className="h-4 w-4" />
                {pill.label}
              </span>
            </div>
            <p className="mt-3 text-[17px] text-slate-400">
              {buyIn ? `Buy-in ${buyIn} ETH` : "Buy-in –"} <span aria-hidden>•</span>{" "}
              {room.hands ? `${room.hands} hands` : "– hands"} <span aria-hidden>•</span> {SEATS} players
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Tile icon={ICON.coins} value={buyIn ? `${buyIn} ETH` : "–"} label="Buy-in per player" />
            <Tile icon={ICON.clock} value={room.hands ? `~ ${room.hands}` : "–"} label="Hands" />
            <Tile icon={ICON.players} value={`${filled}/${SEATS}`} label="Seats filled" />
          </div>
        </div>

        {notices && <div className="mt-5 space-y-3">{notices}</div>}

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* Left: table and progress */}
          <div className="space-y-5">
            <div className="overflow-x-auto">
              <div className="relative mx-auto aspect-[1.8/1] min-w-[760px]">
                <TableArt />
                {room.seats.map((s, i) => (
                  <SeatCard
                    key={i}
                    index={i}
                    seat={s}
                    isYou={!!myAddress && s.address === myAddress}
                    className={SEAT_POS[i]}
                  />
                ))}
              </div>
            </div>

            <section className="rounded-2xl border border-[#23233a] bg-[#0b0b13]/95 p-5">
              <p className="text-[17px] text-white">
                Deposited {countWhere(room, "deposited")} / {SEATS} <span className="mx-2 text-slate-500" aria-hidden>•</span> Ready{" "}
                {countWhere(room, "ready")} / {SEATS}
              </p>
              <p aria-live="polite" className="mt-1.5 text-sm text-slate-400">
                {bannerText(room)}
              </p>
              {exit && <div className="mt-4 border-t border-[#1c1c2e] pt-4 empty:hidden">{exit}</div>}
            </section>
          </div>

          {/* Right: details */}
          <div className="space-y-5">
            <Collapse icon={ICON.doc} title="Table Info">
              <InfoRow label="Table ID">
                #{room.tableId}
                <button
                  type="button"
                  onClick={copyId}
                  aria-label={copied ? "Copied" : "Copy table ID"}
                  className="rounded text-slate-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f5c542]"
                >
                  <Icon d={copied ? ICON.check : ICON.copy} className={`h-[18px] w-[18px] ${copied ? "text-emerald-400" : ""}`} />
                </button>
              </InfoRow>
              <InfoRow label="Game">4-player Texas Hold&apos;em</InfoRow>
              <InfoRow label="Buy-in (per player)">
                {buyIn && <EthGlyph />}
                {buyIn ? `${buyIn} ETH` : "–"}
              </InfoRow>
              <InfoRow label="Number of hands">{room.hands || "–"}</InfoRow>
              <InfoRow label="Seats">
                {filled} / {SEATS} filled
              </InfoRow>
              <InfoRow label="Network">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                Base Sepolia
              </InfoRow>
            </Collapse>

            <Collapse icon={ICON.players} title={`Players (${filled} / ${SEATS})`}>
              <ul className="px-5 py-1.5">
                {room.seats.map((s, i) => {
                  const you = !!myAddress && s.address === myAddress;
                  return (
                    <li key={i} className="flex items-center gap-3 border-t border-[#1c1c2e] py-3 first:border-t-0">
                      {s.address ? (
                        <>
                          <span className="relative h-9 w-9 shrink-0">
                            <span className="block h-full w-full overflow-hidden rounded-full border border-[#d9a928]/50">
                              <Avatar address={s.address} className="h-full w-full" />
                            </span>
                            <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#0d0d16] ${s.connected ? "bg-emerald-400" : "bg-red-500"}`} />
                          </span>
                          <span className="font-tmono text-xs text-slate-300">{shortAddress(s.address)}</span>
                          {you && (
                            <span className="rounded-full border border-indigo-400/60 bg-indigo-500/10 px-2.5 py-0.5 text-[11px] font-medium text-indigo-200">You</span>
                          )}
                          <span className="ml-auto flex items-center gap-3">
                            <Flag on={s.connected} label="Connected" />
                            <Flag on={s.deposited} label="Deposited" />
                            <Flag on={s.ready} label="Ready" />
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1b1b2a] text-slate-500">
                            <Icon d={ICON.user} className="h-5 w-5" />
                          </span>
                          <span className="text-sm text-slate-500">Waiting for player…</span>
                          <span className="ml-auto">
                            <Flag on={false} label="Seat taken" />
                          </span>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Collapse>
          </div>
        </div>
      </div>
    </div>
  );
}
