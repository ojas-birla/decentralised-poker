import Link from "next/link";
import HeroArt from "@/components/home/HeroArt";
import HomeHeader from "@/components/home/HomeHeader";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f5c542]";

function Svg({ children, className = "h-6 w-6" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function SpadeIcon() {
  return (
    <svg viewBox="0 0 100 100" className="h-5 w-5" fill="currentColor" aria-hidden>
      <path d="M50 6C50 6 10 40 10 62c0 14 12 22 24 20 5-1 9-3 12-7-1 10-4 16-10 20h28c-6-4-9-10-10-20 3 4 7 6 12 7 12 2 24-6 24-20C90 40 50 6 50 6z" />
    </svg>
  );
}

function Arrow() {
  return (
    <Svg className="h-5 w-5">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}

function ActionCard({
  href,
  title,
  body,
  icon,
  tone,
}: {
  href: string;
  title: string;
  body: React.ReactNode;
  icon: React.ReactNode;
  tone: "gold" | "violet";
}) {
  const gold = tone === "gold";
  return (
    <Link
      href={href}
      className={`group relative flex min-h-[224px] flex-col justify-between overflow-hidden rounded-2xl border p-7 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 ${focusRing} ${
        gold
          ? "border-[#d9a928]/80 bg-[#14100a]/80 shadow-[0_0_34px_rgba(245,197,66,0.12)] hover:shadow-[0_0_44px_rgba(245,197,66,0.22)]"
          : "border-[#4a3a8c]/80 bg-[#0e0c1c]/80 shadow-[0_0_34px_rgba(124,58,237,0.10)] hover:border-[#7c5cff] hover:shadow-[0_0_44px_rgba(124,58,237,0.22)]"
      }`}
    >
      <span
        className={`flex h-14 w-14 items-center justify-center rounded-full border ${
          gold ? "border-[#d9a928]/70 bg-[#1d160a] text-[#f5c542]" : "border-[#4a3a8c] bg-[#14112b] text-[#9b8cff]"
        }`}
      >
        {icon}
      </span>

      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-white">{title}</h2>
          <p className="mt-3 max-w-[300px] text-[15px] leading-relaxed text-slate-400">{body}</p>
        </div>
        <span
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full border transition-transform group-hover:translate-x-1 ${
            gold ? "border-[#d9a928] text-[#f5c542]" : "border-[#6d5bd0] text-[#9b8cff]"
          }`}
        >
          <Arrow />
        </span>
      </div>
    </Link>
  );
}

function Feature({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-slate-300">{icon}</span>
      <div className="leading-tight">
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="mt-1.5 text-xs text-slate-500">{sub}</p>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="table-stage fixed inset-0 z-10 !m-0 overflow-auto font-grotesk text-white">
      <HomeHeader />

      <div className="relative">
        <HeroArt />

        <div className="relative mx-auto flex w-full max-w-[1160px] flex-col items-center px-6 pb-16 pt-10 text-center sm:pt-14">
          <p className="text-xs font-medium uppercase tracking-[0.42em] text-slate-400 sm:text-[13px]">
            Decentralized Poker
          </p>

          <h1 className="mt-6 font-display text-[64px] font-bold leading-none text-[#e3bb5a] [text-shadow:0_0_40px_rgba(227,187,90,0.25)] sm:text-[88px] lg:text-[104px]">
            Ante Chain
          </h1>

          <p className="mt-7 text-lg leading-relaxed text-slate-400 sm:text-xl">
            4-player Texas Hold&apos;em on chain.
            <br />
            Fair games. Real stakes. No middlemen.
          </p>

          <div className="mt-14 grid w-full max-w-[940px] gap-5 text-left md:grid-cols-2">
            <ActionCard
              href="/create"
              tone="gold"
              icon={<SpadeIcon />}
              title="Create a Table"
              body="Set your stakes, choose the game, and take the first seat."
            />
            <ActionCard
              href="/lobby"
              tone="violet"
              icon={
                <Svg className="h-6 w-6">
                  <path d="M9 11a3 3 0 100-6 3 3 0 000 6zM3 19c0-3 2.7-5 6-5s6 2 6 5M17 11a2.5 2.5 0 100-5M18 14.2c2 .4 3.5 1.9 3.5 4.3" />
                </Svg>
              }
              title="Join a Table"
              body="Browse open tables and take a seat. Jump into the action."
            />
          </div>

          <div className="mt-16 grid w-full max-w-[940px] gap-6 text-left sm:grid-cols-3 sm:gap-0">
            <div className="sm:flex sm:justify-center sm:border-r sm:border-[#2a2a3d]">
              <Feature
                icon={
                  <Svg className="h-9 w-9">
                    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
                    <path d="M9 12l2 2 4-4" />
                  </Svg>
                }
                title="Provably Fair"
                sub="On-chain game logic"
              />
            </div>
            <div className="sm:flex sm:justify-center sm:border-r sm:border-[#2a2a3d]">
              <Feature
                icon={
                  <Svg className="h-9 w-9">
                    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
                    <path d="M12 12l8-4.5M12 12v9M12 12L4 7.500" />
                  </Svg>
                }
                title="True Ownership"
                sub="Your funds, in escrow"
              />
            </div>
            <div className="sm:flex sm:justify-center">
              <Feature
                icon={
                  <Svg className="h-9 w-9">
                    <circle cx="6" cy="6" r="1.8" />
                    <circle cx="12" cy="5" r="1.8" />
                    <circle cx="18" cy="6" r="1.8" />
                    <path d="M3 20c0-3 1.500-5 3.5-5M21 20c0-3-1.500-5-3.5-5M7.500 20c0-3.5 2-6 4.5-6s4.5 2.500 4.5 6" />
                  </Svg>
                }
                title="4-Player Texas Hold'em"
                sub="Classic. Decentralized."
              />
            </div>
          </div>

          <p className="mt-12 text-xs text-slate-600">
            Test ETH only · Base Sepolia · no real value. Never send real ETH to this app.
          </p>
        </div>
      </div>
    </div>
  );
}
