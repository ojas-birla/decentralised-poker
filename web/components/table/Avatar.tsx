"use client";

import { useId } from "react";

// A stable little portrait made from the wallet address, so every player looks different.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export default function Avatar({ address, className = "" }: { address: string; className?: string }) {
  const id = useId();
  const h = hash(address.toLowerCase());
  const hue1 = h % 360;
  const hue2 = (hue1 + 70 + ((h >> 9) % 110)) % 360;
  const skin = `hsl(${(h >> 4) % 40 + 8} ${35 + ((h >> 13) % 25)}% ${62 + ((h >> 17) % 22)}%)`;
  const hat = (h >> 21) % 3; // 0 none, 1 cap, 2 hood
  const shades = (h >> 25) % 2 === 0;
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${hue1} 80% 55%)`} />
          <stop offset="1" stopColor={`hsl(${hue2} 75% 38%)`} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill={`url(#${id})`} />
      <path d="M8 66c1-17 13-24 24-24s23 7 24 24z" fill={`hsl(${hue2} 45% 22%)`} />
      <circle cx="32" cy="27" r="11.5" fill={skin} />
      {hat === 1 && <path d="M19.5 25c0-9 5-14 12.500-14s12.500 5 12.500 14z" fill={`hsl(${hue1} 70% 40%)`} />}
      {hat === 2 && <path d="M18 31c-3-14 5-22 14-22s17 8 14 22c-2-7-6-11-14-11s-12 4-14 11z" fill="#15151f" />}
      {shades && <rect x="22" y="25" width="20" height="5" rx="2.500" fill="#12121a" />}
    </svg>
  );
}
