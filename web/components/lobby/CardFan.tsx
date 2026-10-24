// Decorative neon card fan for the lobby. Pure SVG, no assets to load.
const FONT = { fontFamily: "var(--font-display), Georgia, serif" } as const;

type Suit = "spade" | "heart" | "diamond" | "club";

const CARDS: { rank: string; suit: Suit; color: string; x: number; y: number; rot: number }[] = [
  { rank: "A", suit: "spade", color: "#a855f7", x: 150, y: 318, rot: -24 },
  { rank: "K", suit: "heart", color: "#ff4d79", x: 262, y: 252, rot: -12 },
  { rank: "Q", suit: "club", color: "#d9a928", x: 380, y: 228, rot: 0 },
  { rank: "J", suit: "diamond", color: "#ff7a4d", x: 498, y: 252, rot: 12 },
  { rank: "10", suit: "spade", color: "#8b5cf6", x: 610, y: 318, rot: 24 },
];

function Suit({ suit, size, color }: { suit: Suit; size: number; color: string }) {
  const s = size / 100;
  return (
    <g transform={`scale(${s})`} fill={color}>
      {suit === "spade" && (
        <path d="M50 6C50 6 10 40 10 62c0 14 12 22 24 20 5-1 9-3 12-7-1 10-4 16-10 20h28c-6-4-9-10-10-20 3 4 7 6 12 7 12 2 24-6 24-20C90 40 50 6 50 6z" />
      )}
      {suit === "heart" && (
        <path d="M50 92S8 64 8 36C8 20 20 10 33 10c8 0 14 5 17 12 3-7 9-12 17-12 13 0 25 10 25 26 0 28-42 56-42 56z" />
      )}
      {suit === "diamond" && <path d="M50 4L90 50 50 96 10 50z" />}
      {suit === "club" && (
        <>
          <circle cx="50" cy="28" r="21" />
          <circle cx="26" cy="62" r="21" />
          <circle cx="74" cy="62" r="21" />
          <path d="M50 50L38 96h24z" />
        </>
      )}
    </g>
  );
}

export default function CardFan() {
  return (
    <svg
      viewBox="0 0 760 480"
      className="h-auto w-full max-w-[760px]"
      role="img"
      aria-label="A fan of five playing cards: ace of spades, king of hearts, queen of clubs, jack of diamonds and ten of spades"
    >
      <defs>
        <radialGradient id="fan-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#7c3aed" stopOpacity="0.35" />
          <stop offset="1" stopColor="#7c3aed" stopOpacity="0" />
        </radialGradient>
        {CARDS.map((c) => (
          <linearGradient key={c.rank + c.suit} id={`fan-edge-${c.rank}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={c.color} />
            <stop offset="1" stopColor={c.color} stopOpacity="0.25" />
          </linearGradient>
        ))}
      </defs>

      {/* Table glow and rings */}
      <ellipse cx="380" cy="400" rx="380" ry="130" fill="url(#fan-glow)" />
      <ellipse cx="380" cy="392" rx="330" ry="86" fill="none" stroke="#a855f7" strokeOpacity="0.28" />
      <ellipse cx="380" cy="392" rx="250" ry="62" fill="none" stroke="#a855f7" strokeOpacity="0.16" />

      {/* Cards, left to right so later ones overlap earlier ones */}
      {CARDS.map((c) => (
        <g
          key={c.rank + c.suit}
          transform={`translate(${c.x} ${c.y}) rotate(${c.rot})`}
          style={{ filter: `drop-shadow(0 0 12px ${c.color}66)` }}
        >
          <rect
            x="-80"
            y="-115"
            width="160"
            height="230"
            rx="16"
            fill="#0d0b16"
            stroke={`url(#fan-edge-${c.rank})`}
            strokeWidth="2.5"
          />
          <text x="-62" y="-70" fontSize="36" fontWeight="700" fill={c.color} style={FONT}>
            {c.rank}
          </text>
          <g transform="translate(-62 -58)">
            <Suit suit={c.suit} size={22} color={c.color} />
          </g>
          <g transform="translate(-10 22)" opacity="0.95">
            <Suit suit={c.suit} size={78} color={c.color} />
          </g>
          <g transform="translate(-72 36)" opacity="0.12">
            <Suit suit={c.suit} size={60} color={c.color} />
          </g>
        </g>
      ))}
    </svg>
  );
}
