"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CreateHeader from "@/components/create/CreateHeader";
import TablePreview from "@/components/create/TablePreview";
import { useWallet } from "@/components/WalletProvider";
import { EXPLORER_TX_URL, createTable, describeTxError } from "@/lib/contractTx";
import { getOrCreateSessionKey, promotePendingKey } from "@/lib/sessionKey";
import {
  BIG_BLIND,
  CHIPS_PER_PLAYER,
  MAX_HANDS,
  MIN_HANDS,
  SMALL_BLIND,
  parseCreateForm,
  weiToEth,
} from "@/lib/createTable";

const DEFAULT_BUY_IN = "0.001";
const DEFAULT_HANDS = "10";

const BUY_IN_PRESETS = ["0.001", "0.005", "0.01"];
const HANDS_PRESETS = [
  { value: "5", name: "Quick" },
  { value: "10", name: "Standard" },
  { value: "25", name: "" },
  { value: "50", name: "Marathon" },
];

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5c542]";

function Icon({ d, className = "h-[18px] w-[18px]" }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  coins: "M3 7c0-1.700 2.700-3 6-3s6 1.300 6 3-2.700 3-6 3-6-1.300-6-3zM3 7v5c0 1.700 2.700 3 6 3M3 12v5c0 1.700 2.700 3 6 3 1.200 0 2.300-.2 3.200-.5M15 10c3.300 0 6 1.300 6 3s-2.700 3-6 3-6-1.300-6-3 2.700-3 6-3zM21 13v4c0 1.700-2.700 3-6 3s-6-1.300-6-3",
  cards: "M5 5h9a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zM18 8l2.200.8a1 1 0 01.6 1.300l-3.400 9a1 1 0 01-1.300.6L15 19.400",
  players: "M9 11a3 3 0 100-6 3 3 0 000 6zM3 19c0-3 2.700-5 6-5s6 2 6 5M17 11a2.500 2.500 0 100-5M18 14.200c2 .4 3.500 1.900 3.500 4.300",
  chip: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 3v2M12 19v2M3 12h2M19 12h2",
  target: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 15a3 3 0 100-6 3 3 0 000 6z",
  eye: "M2 12s3.600-7 10-7 10 7 10 7-3.600 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  reset: "M20 12a8 8 0 11-2.400-5.700M20 4v5h-5",
  info: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01",
  arrow: "M5 12h14M13 6l6 6-6 6",
};

function EthGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 text-indigo-300" fill="currentColor" aria-hidden>
      <path d="M12 2l-6.500 10.200L12 16l6.500-3.800zM12 17.300l-6.500-3.800L12 22l6.500-8.500z" opacity=".9" />
    </svg>
  );
}

function Pill({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex h-[54px] min-w-0 flex-col items-center justify-center overflow-hidden rounded-full border px-2 text-[15px] transition-colors ${focusRing} ${
        selected
          ? "border-[#d9a928] bg-[#f5c542]/10 font-semibold text-white shadow-[0_0_18px_rgba(245,197,66,0.12)]"
          : "border-[#23233a] bg-[#0e0e18] text-slate-300 hover:border-[#3a3a56]"
      }`}
    >
      {children}
    </button>
  );
}

function Fact({
  icon,
  value,
  label,
}: {
  icon: string;
  value: string;
  label: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-[#23233a] bg-[#0b0b13] px-3 py-3">
      <Icon d={icon} className="h-[18px] w-[18px] shrink-0 text-[#e3bb5a]" />
      <div className="min-w-0 leading-tight">
        <p className="text-[13px] font-medium text-white">{value}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">{label}</p>
      </div>
    </div>
  );
}

function Row({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-t border-[#1c1c2e] py-3.5 text-[15px] first:border-t-0">
      <span className="text-slate-400">{label}</span>
      <span className="flex items-center gap-2 font-medium text-slate-100">
        {icon}
        {children}
      </span>
    </div>
  );
}

export default function CreatePage() {
  const router = useRouter();
  const { address, isWrongNetwork, hasWallet, isConnecting, connect, switchNetwork, error: walletError } =
    useWallet();
  const [buyIn, setBuyIn] = useState(DEFAULT_BUY_IN);
  const [customBuyIn, setCustomBuyIn] = useState(false);
  const [hands, setHands] = useState(DEFAULT_HANDS);
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const result = parseCreateForm(buyIn, hands);
  const errors = result.ok ? {} : result.errors;
  const walletReady = !!address && !isWrongNetwork;
  const canSubmit = result.ok && walletReady && !busy;

  const totalEth = result.ok ? weiToEth(result.value.totalPotWei) : null;
  const perPlayerEth = result.ok ? weiToEth(result.value.buyInWei) : null;

  function pickBuyIn(v: string) {
    setCustomBuyIn(false);
    setBuyIn(v);
    setTxError(null);
  }

  function reset() {
    pickBuyIn(DEFAULT_BUY_IN);
    setHands(DEFAULT_HANDS);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    // The button doubles as the wallet step until the wallet is ready.
    if (!address) return void connect();
    if (isWrongNetwork) return void switchNetwork();
    if (!result.ok) return;
    setBusy(true);
    setTxError(null);
    setTxHash(null);
    try {
      // The session key's address is registered on-chain inside this transaction.
      const sk = getOrCreateSessionKey(address, "pending");
      const { tableId } = await createTable(
        {
          buyInWei: result.value.buyInWei,
          hands: result.value.hands,
          sessionKey: sk.address.toLowerCase(),
        },
        (p) => {
          if (p.hash) setTxHash(p.hash);
        }
      );
      promotePendingKey(address, tableId); // keep the key under the real table id
      router.push(`/table/${tableId}`);
    } catch (err) {
      setTxError(describeTxError(err)); // form stays editable after a reject
      setBusy(false);
    }
  }

  const ctaLabel = busy
    ? txHash
      ? "Confirming…"
      : "Waiting for MetaMask…"
    : !address
      ? isConnecting
        ? "Connecting…"
        : "Connect wallet to create table"
      : isWrongNetwork
        ? "Switch to Base Sepolia"
        : "Create table and take seat 1";

  const ctaDisabled =
    busy ||
    (!address && (hasWallet === false || hasWallet === null || isConnecting)) ||
    (walletReady && !result.ok);

  return (
    <div className="table-stage fixed inset-0 z-10 !m-0 overflow-auto font-grotesk text-white">
      <CreateHeader />

      <div className="mx-auto grid w-full max-w-[1160px] items-start gap-10 px-6 pb-16 pt-2 lg:grid-cols-[minmax(0,510px)_minmax(0,1fr)] lg:gap-12">
        {/* Left: form */}
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <section className="rounded-2xl border border-[#2a2a3d] bg-[#0d0d16]/95 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
            <h1 className="text-[28px] font-bold leading-tight">Create a Table</h1>
            <p className="mt-2 text-[15px] text-slate-400">
              Set your stakes, choose the game, and take the first seat.
            </p>

            <div className="mt-6 space-y-6 border-t border-[#1c1c2e] pt-6">
              {/* Buy-in */}
              <div role="radiogroup" aria-labelledby="buyin-label">
                <div className="relative mb-3 flex items-center justify-between">
                  <p id="buyin-label" className="flex items-center gap-2.5 text-[15px] text-slate-200">
                    <Icon d={ICONS.coins} className="h-5 w-5 text-[#e3bb5a]" />
                    Buy-in per player (test ETH)
                  </p>
                  <span className="group relative">
                    <button
                      type="button"
                      aria-label="How buy-in works"
                      className={`rounded-full text-slate-500 hover:text-slate-300 ${focusRing}`}
                    >
                      <Icon d={ICONS.info} />
                    </button>
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute right-0 top-7 z-20 w-64 rounded-xl border border-[#2a2a3d] bg-[#0c0c14] p-3 text-xs leading-relaxed text-slate-300 opacity-0 shadow-2xl transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                    >
                      Each player deposits this amount and starts with {CHIPS_PER_PLAYER} chips
                      {result.ok ? ` (1 chip = ${result.value.weiPerChip} wei)` : ""}. Balances at the end are
                      paid out from escrow by chip count.
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {BUY_IN_PRESETS.map((v) => (
                    <Pill key={v} selected={!customBuyIn && buyIn === v} onClick={() => pickBuyIn(v)}>
                      {v}
                    </Pill>
                  ))}
                  <Pill
                    selected={customBuyIn}
                    onClick={() => {
                      setCustomBuyIn(true);
                      setTxError(null);
                    }}
                  >
                    Custom
                  </Pill>
                </div>

                {customBuyIn && (
                  <div className="mt-3">
                    <label htmlFor="custom-buyin" className="sr-only">
                      Custom buy-in in test ETH
                    </label>
                    <div className="flex h-[54px] items-center rounded-full border border-[#d9a928] bg-[#0e0e18] pl-5 pr-4 focus-within:shadow-[0_0_18px_rgba(245,197,66,0.2)]">
                      <input
                        id="custom-buyin"
                        type="text"
                        inputMode="decimal"
                        autoFocus
                        autoComplete="off"
                        value={buyIn}
                        onChange={(e) => {
                          setBuyIn(e.target.value);
                          setTxError(null);
                        }}
                        aria-invalid={!!errors.buyIn}
                        aria-describedby={errors.buyIn ? "buyin-error" : undefined}
                        className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-slate-600"
                        placeholder="0.002"
                      />
                      <span className="text-sm text-slate-500">ETH</span>
                    </div>
                  </div>
                )}
                {errors.buyIn && (
                  <p id="buyin-error" className="mt-2 text-sm text-red-400">
                    {errors.buyIn}
                  </p>
                )}
              </div>

              {/* Hands */}
              <div role="radiogroup" aria-labelledby="hands-label">
                <p id="hands-label" className="mb-3 flex items-center gap-2.5 text-[15px] text-slate-200">
                  <Icon d={ICONS.cards} className="h-5 w-5 text-[#e3bb5a]" />
                  Hands to play ({MIN_HANDS} to {MAX_HANDS})
                </p>
                <div className="grid grid-cols-4 gap-3">
                  {HANDS_PRESETS.map((h) => (
                    <Pill
                      key={h.value}
                      selected={hands === h.value}
                      onClick={() => {
                        setHands(h.value);
                        setTxError(null);
                      }}
                    >
                      <span className="block leading-none">{h.value}</span>
                      {h.name && (
                        <span className={`mt-1.5 block text-[11px] leading-none ${hands === h.value ? "text-[#f5c542]" : "text-slate-500"}`}>
                          {h.name}
                        </span>
                      )}
                    </Pill>
                  ))}
                </div>
                {errors.hands && <p className="mt-2 text-sm text-red-400">{errors.hands}</p>}
              </div>

              {/* Fixed rules */}
              <div className="grid grid-cols-3 gap-3">
                <Fact icon={ICONS.players} value="4 players" label="Table size" />
                <Fact icon={ICONS.chip} value={`${CHIPS_PER_PLAYER} chips`} label="Each player" />
                <Fact icon={ICONS.target} value={`Blinds ${SMALL_BLIND} / ${BIG_BLIND}`} label="Fixed blinds" />
              </div>

              {/* Preview */}
              <div className="rounded-xl border border-[#23233a] bg-[#0b0b13] px-5 pb-1 pt-4">
                <div className="mb-1 flex items-center justify-between">
                  <p className="flex items-center gap-2.5 text-[15px] font-semibold">
                    <Icon d={ICONS.eye} className="h-5 w-5 text-slate-300" />
                    Game preview
                  </p>
                  <button
                    type="button"
                    onClick={reset}
                    className={`flex items-center gap-1.5 rounded text-sm text-indigo-400 hover:text-indigo-300 ${focusRing}`}
                  >
                    Reset
                    <Icon d={ICONS.reset} className="h-4 w-4" />
                  </button>
                </div>
                <Row label="Total in escrow" icon={<EthGlyph />}>
                  {totalEth ? `${totalEth} ETH` : "–"}
                </Row>
                <Row label="Per player" icon={<EthGlyph />}>
                  {perPlayerEth ? `${perPlayerEth} ETH` : "–"}
                </Row>
                <Row label="Estimated duration" icon={<Icon d={ICONS.clock} className="h-4 w-4 text-slate-300" />}>
                  {result.ok ? `~ ${result.value.hands} hands` : "–"}
                </Row>
              </div>
            </div>
          </section>

          {/* CTA */}
          <button
            type="submit"
            disabled={ctaDisabled}
            className={`flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-[#e3bb5a] px-6 text-[17px] font-semibold text-[#1a1405] transition-colors hover:bg-[#f0c85f] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#e3bb5a] ${focusRing}`}
          >
            <span className="relative flex w-full items-center justify-center">
              <svg viewBox="0 0 24 24" className="absolute left-0 h-5 w-5" fill="currentColor" aria-hidden>
                <path d="M12 2C9 6.500 4 9.500 4 14a4.500 4.500 0 007.200 3.600c-.2 1.500-.8 2.700-1.700 3.400h5c-.9-.7-1.500-1.900-1.700-3.400A4.500 4.500 0 0020 14c0-4.500-5-7.500-8-12z" />
              </svg>
              {ctaLabel}
              <Icon d={ICONS.arrow} className="absolute right-0 h-5 w-5" />
            </span>
          </button>

          {/* Status messages */}
          <div aria-live="polite" className="space-y-3 text-sm">
            {txHash && busy && (
              <p className="text-slate-400">
                Transaction sent.{" "}
                <a
                  href={`${EXPLORER_TX_URL}${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-400 underline hover:text-indigo-300"
                >
                  View on BaseScan
                </a>
                . Waiting for confirmation…
              </p>
            )}
            {hasWallet === false && (
              <p className="rounded-xl border border-yellow-500/50 bg-yellow-500/5 p-3 text-yellow-200">
                MetaMask was not detected. Install it from{" "}
                <a href="https://metamask.io" target="_blank" rel="noreferrer" className="underline">
                  metamask.io
                </a>{" "}
                and reload this page.
              </p>
            )}
            {walletError && (
              <p role="alert" className="rounded-xl border border-red-500/50 bg-red-500/5 p-3 text-red-300">
                {walletError}
              </p>
            )}
            {txError && (
              <p role="alert" className="rounded-xl border border-red-500/50 bg-red-500/5 p-3 text-red-300">
                {txError}
              </p>
            )}
          </div>
        </form>

        {/* Right: live table preview */}
        <TablePreview totalEth={totalEth} />
      </div>
    </div>
  );
}
