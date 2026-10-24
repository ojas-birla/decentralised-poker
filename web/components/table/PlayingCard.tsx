"use client";

const SUITS: Record<string, { symbol: string; red: boolean; name: string }> = {
  s: { symbol: "♠", red: false, name: "spades" },
  h: { symbol: "♥", red: true, name: "hearts" },
  d: { symbol: "♦", red: true, name: "diamonds" },
  c: { symbol: "♣", red: false, name: "clubs" },
};

// board: community cards. hand: your own hole cards. opp: other seats' cards
// (backs, or faces at showdown). sm: result panel.
export type CardSize = "board" | "hand" | "opp" | "sm" | "res";

const BOX: Record<CardSize, string> = {
  board: "h-[102px] w-[76px]",
  hand: "h-[90px] w-[66px]",
  opp: "h-[74px] w-[54px]",
  sm: "h-12 w-9",
  res: "h-[88px] w-[64px]",
};
const RANK: Record<CardSize, string> = {
  board: "text-[27px]",
  hand: "text-[23px]",
  opp: "text-[19px]",
  sm: "text-[13px]",
  res: "text-[23px]",
};
const PIP: Record<CardSize, string> = {
  board: "text-[15px]",
  hand: "text-[13px]",
  opp: "text-[11px]",
  sm: "text-[8px]",
  res: "text-[12px]",
};
const BIG: Record<CardSize, string> = {
  board: "text-[50px]",
  hand: "text-[42px]",
  opp: "text-[32px]",
  sm: "text-[22px]",
  res: "text-[42px]",
};

export default function PlayingCard({
  card,
  hidden,
  small,
  size,
  className = "",
}: {
  card?: string;
  hidden?: boolean;
  small?: boolean; // kept for HandResultPanel; same as size="sm"
  size?: CardSize;
  className?: string;
}) {
  const s: CardSize = size ?? (small ? "sm" : "board");
  const suit = card ? SUITS[card[1]] : undefined;

  if (hidden || !card || !suit) {
    return <div className={`card-back shrink-0 ${BOX[s]} ${className}`} aria-label="Hidden card" />;
  }

  const rank = card[0] === "T" ? "10" : card[0];
  return (
    <div
      className={`card-face relative shrink-0 overflow-hidden ${BOX[s]} ${
        suit.red ? "text-[#d6293e]" : "text-[#111118]"
      } ${className}`}
      aria-label={`${rank} of ${suit.name}`}
    >
      <div className="absolute left-[9%] top-[5%] flex flex-col items-center leading-none">
        <span className={`font-display font-bold ${RANK[s]}`}>{rank}</span>
        <span className={PIP[s]}>{suit.symbol}</span>
      </div>
      <span className={`absolute bottom-[2%] right-[8%] leading-none ${BIG[s]}`}>{suit.symbol}</span>
    </div>
  );
}
