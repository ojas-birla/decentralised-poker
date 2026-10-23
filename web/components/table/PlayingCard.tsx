"use client";

const SUITS: Record<string, { symbol: string; red: boolean }> = {
  s: { symbol: "♠", red: false },
  h: { symbol: "♥", red: true },
  d: { symbol: "♦", red: true },
  c: { symbol: "♣", red: false },
};

export default function PlayingCard({
  card,
  hidden,
  small,
}: {
  card?: string;
  hidden?: boolean;
  small?: boolean;
}) {
  const size = small ? "h-12 w-8 text-xs" : "h-16 w-11 text-sm";
  const suit = card ? SUITS[card[1]] : undefined;

  if (hidden || !card || !suit) {
    return (
      <div
        className={`${size} rounded border border-rose-300 bg-rose-400`}
        aria-label="Hidden card"
      />
    );
  }

  const rank = card[0] === "T" ? "10" : card[0];
  return (
    <div
      className={`${size} flex flex-col items-center justify-center rounded border bg-white font-semibold ${
        suit.red ? "text-red-600" : "text-gray-900"
      }`}
    >
      <span>{rank}</span>
      <span>{suit.symbol}</span>
    </div>
  );
}