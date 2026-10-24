"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import CreateHeader from "@/components/create/CreateHeader";
import FinalPayoutCard from "./FinalPayoutCard";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5c542]";

// Shown when a table was cancelled or refunded: same dark theme as the lobby
// and the finished screen, with the refund card front and centre.
export default function CancelledScreen({
  tableId,
  mySeat,
  notices,
}: {
  tableId: string;
  mySeat: number | null;
  notices?: ReactNode;
}) {
  return (
    <div className="table-stage fixed inset-0 z-10 !m-0 overflow-auto font-grotesk text-white">
      <CreateHeader wide />

      <div className="mx-auto w-full max-w-[640px] px-6 pb-16 pt-2">
        <Link
          href="/lobby"
          className={`mb-5 inline-flex h-11 items-center gap-2 rounded-full border border-[#2a2a3d] bg-[#0e0e18] pl-3 pr-5 text-sm font-medium text-slate-100 transition-colors hover:border-[#4a4a6a] ${focusRing}`}
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Back to Lobby
        </Link>

        {notices && <div className="mb-4 space-y-3">{notices}</div>}

        <section className="space-y-5 rounded-2xl border border-[#2a2a3d] bg-[#0d0d16]/95 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-[28px] font-bold leading-tight">Table #{tableId}</h1>
              <p className="mt-2 text-[15px] text-slate-400">This table was cancelled or refunded.</p>
            </div>
            <span className="flex h-9 shrink-0 items-center rounded-full border border-red-400/40 bg-red-500/10 px-4 text-xs font-semibold uppercase tracking-wider text-red-300">
              Cancelled
            </span>
          </div>

          {mySeat === null ? (
            <p className="rounded-xl border border-dashed border-[#2a2a3d] p-5 text-center text-[15px] text-slate-400">
              No seat found for this wallet, so there is nothing to refund here.
            </p>
          ) : (
            <FinalPayoutCard tableId={tableId} mySeat={mySeat} />
          )}
        </section>

        <p className="mt-4 px-1 text-xs text-slate-500">
          Test ETH only · Base Sepolia · no real value.
        </p>
      </div>
    </div>
  );
}
