"use client";

export interface Escrow {
  deposit: string; // your buy-in, e.g. "0.01 ETH"
  total: string; // everyone's buy-ins held by the contract
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-[#1f1f30] py-2 last:border-b-0">
      <span className="text-slate-300">{label}</span>
      <span className="font-semibold text-white">{children}</span>
    </div>
  );
}

export default function EscrowPanel({ escrow, className = "" }: { escrow: Escrow; className?: string }) {
  return (
    <section className={`rounded-2xl border border-[#2a2a3d] bg-[#0c0c14] p-4 text-sm ${className}`}>
      <div className="mb-2 flex items-center gap-3 text-base font-semibold text-white">
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-emerald-400" fill="currentColor" aria-hidden>
          <path d="M12 2l8 3v6c0 5-3.400 9-8 11-4.600-2-8-6-8-11V5z" opacity=".9" />
          <path d="M8.500 12l2.500 2.500 4.500-5" fill="none" stroke="#06140d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Escrow &amp; Funds
      </div>
      <Row label="Your deposit">{escrow.deposit}</Row>
      <Row label="Total in escrow">{escrow.total}</Row>
      <Row label="Status">
        <span className="flex items-center gap-2 text-emerald-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400" /> Locked
        </span>
      </Row>
      <p className="mt-2 text-xs text-slate-400">
        The contract holds every buy-in until the game ends. Withdraw your share from the payout screen.
      </p>
    </section>
  );
}
