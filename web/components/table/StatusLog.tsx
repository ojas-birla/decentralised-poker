"use client";

import { useEffect, useRef } from "react";
import { LogEntry } from "@/lib/statusLog";

const COLORS = {
  info: "text-slate-300",
  action: "text-white",
  warn: "text-amber-300",
} as const;

export default function StatusLog({
  entries,
  className = "h-36",
}: {
  entries: LogEntry[];
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  // Keep the newest line in view without scrolling the whole page.
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <div
      ref={boxRef}
      className={`overflow-y-auto rounded-lg bg-slate-950/40 p-2 text-sm ${className}`}
      aria-label="What just happened"
    >
      {entries.length === 0 ? (
        <p className="text-slate-400">Nothing has happened yet.</p>
      ) : (
        <ul className="space-y-1">
          {entries.map((e) => (
            <li key={e.id} className={COLORS[e.kind]}>
              {e.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}