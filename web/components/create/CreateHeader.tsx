"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/components/WalletProvider";
import Avatar from "@/components/table/Avatar";

const EXPLORER_ADDRESS_URL = "https://sepolia.basescan.org/address/";

function shortAddress(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const pill =
  "flex h-11 items-center gap-2.5 rounded-full border border-[#2a2a3d] bg-[#0e0e18]/90 px-4 text-sm font-medium text-slate-100 transition-colors hover:border-[#4a4a6a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5c542]";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export default function CreateHeader({ wide = false }: { wide?: boolean }) {
  const { hasWallet, address, isConnecting, isWrongNetwork, connect, switchNetwork } = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the wallet menu on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function copy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  }

  return (
    <header className={`mx-auto flex w-full items-center justify-between px-6 py-8 ${wide ? "max-w-[1280px]" : "max-w-[1160px]"}`}>
      <Link
        href="/lobby"
        className="font-display text-[32px] font-semibold leading-none tracking-tight text-[#e3bb5a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f5c542]"
      >
        Ante Chain
      </Link>

      <div className="flex items-center gap-3">
        {/* Network */}
        {address && isWrongNetwork ? (
          <button
            onClick={switchNetwork}
            className={`${pill} border-red-500/60 text-red-300 hover:border-red-400`}
          >
            <span className="h-2 w-2 rounded-full bg-red-500" />
            Wrong network · Switch
          </button>
        ) : (
          <span className={`${pill} cursor-default hover:border-[#2a2a3d]`}>
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Base Sepolia
          </span>
        )}

        {/* Wallet */}
        {hasWallet === false ? (
          <a href="https://metamask.io" target="_blank" rel="noreferrer" className={pill}>
            Install MetaMask
          </a>
        ) : !address ? (
          <button
            onClick={connect}
            disabled={isConnecting || hasWallet === null}
            className={`${pill} border-[#d9a928] text-[#f5c542] disabled:opacity-60`}
          >
            {isConnecting ? "Connecting…" : "Connect wallet"}
          </button>
        ) : (
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={open}
              className={`${pill} pl-1.5`}
            >
              <Avatar address={address} className="h-8 w-8 overflow-hidden rounded-full" />
              <span className="font-tmono text-[13px]">{shortAddress(address)}</span>
              <Chevron open={open} />
            </button>

            {open && (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+8px)] z-50 w-56 overflow-hidden rounded-2xl border border-[#2a2a3d] bg-[#0c0c14] p-1.5 text-sm shadow-2xl"
              >
                <button
                  role="menuitem"
                  onClick={copy}
                  className="flex w-full items-center rounded-xl px-3 py-2.5 text-left text-slate-200 hover:bg-white/5"
                >
                  {copied ? "Copied" : "Copy address"}
                </button>
                <a
                  role="menuitem"
                  href={`${EXPLORER_ADDRESS_URL}${address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full items-center rounded-xl px-3 py-2.5 text-slate-200 hover:bg-white/5"
                >
                  View on BaseScan
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
