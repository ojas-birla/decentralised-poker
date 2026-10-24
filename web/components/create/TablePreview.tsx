"use client";

// Live preview of the table being created. Seat 1 is you; seats go clockwise from the top.
const SEAT_SLOTS = [
  { n: 1, anchor: "left-1/2 top-0" },
  { n: 2, anchor: "left-full top-1/2" },
  { n: 3, anchor: "left-1/2 top-full" },
  { n: 4, anchor: "left-0 top-1/2" },
] as const;

export default function TablePreview({ totalEth }: { totalEth: string | null }) {
  return (
    <div className="relative">
      {/* Seat counter */}
      <div
        className="absolute right-0 top-0 z-10 rounded-2xl border border-[#23233a] bg-[#0c0c14]/90 px-4 py-3 text-sm"
        aria-label="1 of 4 seats taken"
      >
        <p className="text-slate-300">
          Seats <span className="text-slate-400">1/4</span>
        </p>
        <div className="mt-2.5 flex gap-2" aria-hidden>
          <span className="h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)]" />
          <span className="h-3 w-3 rounded-full border border-[#3a3a52]" />
          <span className="h-3 w-3 rounded-full border border-[#3a3a52]" />
          <span className="h-3 w-3 rounded-full border border-[#3a3a52]" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-[600px] px-10 pb-20 pt-24">
        <div className="relative aspect-[1.65/1] w-full">
          {/* Rail and felt */}
          <div className="absolute inset-0 rounded-[50%] border border-[#d9a928]/40 bg-[#14101f]" />
          <div className="felt absolute inset-[2.5%]">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="rounded-xl border border-white/5 bg-[#0c0c12]/90 px-8 py-5 text-center shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
                <p className="font-display text-[44px] font-bold leading-none text-[#e3bb5a]">
                  {totalEth ?? "–"} <span className="text-[40px]">ETH</span>
                </p>
                <p className="mt-2.5 text-[11px] tracking-[0.12em] text-slate-400">
                  LOCKED IN ESCROW WHEN FULL
                </p>
              </div>
            </div>
          </div>

          {/* Seats: each is anchored on the rim, circle centred on the anchor point */}
          {SEAT_SLOTS.map(({ n, anchor }) => (
            <div key={n} className={`absolute z-10 h-0 w-0 ${anchor}`}>
              {n === 1 ? (
                <>
                  <span className="absolute left-0 top-0 flex h-[64px] w-[64px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-emerald-400 bg-[#0d3a2c] font-display text-xl font-bold text-[#f5c542] shadow-[0_0_24px_rgba(52,211,153,0.35)]">
                    You
                  </span>
                  <span className="absolute left-0 top-[22px] -translate-x-1/2 whitespace-nowrap rounded-full bg-emerald-400 px-3 py-0.5 text-xs font-bold text-[#052e22]">
                    Seat 1
                  </span>
                </>
              ) : (
                <>
                  <span
                    aria-hidden
                    className="absolute left-0 top-0 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#2f2f48] bg-[#0b0b13] text-xl text-slate-300"
                  >
                    +
                  </span>
                  <span className="absolute left-0 top-[34px] -translate-x-1/2 whitespace-nowrap rounded-full bg-[#0b0b13]/90 px-2 py-0.5 text-xs font-semibold text-slate-200">
                    Seat {n}
                    <span className="sr-only"> (empty)</span>
                  </span>
                </>
              )}
            </div>
          ))}
        </div>

        <p className="mt-16 text-center text-xs text-slate-500">
          Test ETH only · Base Sepolia · no real value. Never send real ETH to this app.
        </p>
      </div>
    </div>
  );
}
