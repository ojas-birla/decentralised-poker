// Decorative background art for the home page: a pair of cards on the left and
// chip stacks on the right. Pure SVG, no image assets to load.
const FONT = { fontFamily: "var(--font-display), Georgia, serif" } as const;

const SPADE =
  "M50 6C50 6 10 40 10 62c0 14 12 22 24 20 5-1 9-3 12-7-1 10-4 16-10 20h28c-6-4-9-10-10-20 3 4 7 6 12 7 12 2 24-6 24-20C90 40 50 6 50 6z";
const HEART =
  "M50 92S8 64 8 36C8 20 20 10 33 10c8 0 14 5 17 12 3-7 9-12 17-12 13 0 25 10 25 26 0 28-42 56-42 56z";

function Card({
  rank,
  path,
  color,
  rot,
  x,
  y,
  dim = false,
}: {
  rank: string;
  path: string;
  color: string;
  rot: number;
  x: number;
  y: number;
  dim?: boolean;
}) {
  return (
    <g
      transform={`translate(${x} ${y}) rotate(${rot})`}
      opacity={dim ? 0.75 : 1}
      style={{ filter: `drop-shadow(0 0 22px ${color}40)` }}
    >
      <rect x="-80" y="-115" width="160" height="230" rx="16" fill="#0d0b16" stroke={color} strokeOpacity="0.7" strokeWidth="2" />
      <rect x="-80" y="-115" width="160" height="230" rx="16" fill="url(#card-sheen)" />
      <text x="-60" y="-70" fontSize="40" fontWeight="700" fill={color} style={FONT}>
        {rank}
      </text>
      <g transform="translate(-60 -58) scale(0.22)" fill={color}>
        <path d={path} />
      </g>
      <g transform="translate(-8 24) scale(0.8) translate(-50 -50)" fill={color} opacity="0.35">
        <path d={path} />
      </g>
    </g>
  );
}

function ChipStack({
  x,
  y,
  count,
  face,
  side,
  rim,
}: {
  x: number;
  y: number;
  count: number;
  face: string;
  side: string;
  rim: string;
}) {
  const discs = [];
  for (let i = 0; i < count; i++) {
    const cy = y - i * 15;
    discs.push(
      <g key={i}>
        <ellipse cx={x} cy={cy + 12} rx="62" ry="19" fill={side} />
        <rect x={x - 62} y={cy} width="124" height="12" fill={side} />
        <ellipse cx={x} cy={cy} rx="62" ry="19" fill={face} stroke={rim} strokeOpacity="0.55" />
        <ellipse cx={x} cy={cy} rx="44" ry="12" fill="none" stroke={rim} strokeOpacity="0.4" strokeDasharray="6 7" />
      </g>
    );
  }
  return <g>{discs}</g>;
}

export default function HeroArt() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg
        viewBox="0 0 420 520"
        className="absolute -left-10 top-[12%] hidden h-[62%] w-auto opacity-90 md:block lg:left-[2%]"
      >
        <defs>
          <linearGradient id="card-sheen" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.06" />
            <stop offset="0.6" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <Card rank="K" path={HEART} color="#a855f7" rot={-10} x={130} y={300} dim />
        <Card rank="A" path={SPADE} color="#e3bb5a" rot={9} x={250} y={260} />
      </svg>

      <svg
        viewBox="0 0 480 520"
        className="absolute -right-12 bottom-[14%] hidden h-[56%] w-auto opacity-90 md:block lg:right-[1%]"
      >
        <ChipStack x={340} y={250} count={6} face="#1b1233" side="#0f0a1f" rim="#a855f7" />
        <ChipStack x={190} y={380} count={4} face="#2a2110" side="#17120a" rim="#e3bb5a" />
        <ChipStack x={370} y={430} count={3} face="#1b1233" side="#0f0a1f" rim="#a855f7" />
      </svg>

      {/* Soft table rim lines */}
      <div className="absolute inset-x-0 bottom-0 h-[38%] bg-[radial-gradient(ellipse_70%_100%_at_50%_100%,rgba(124,58,237,0.16),transparent_70%)]" />
    </div>
  );
}
