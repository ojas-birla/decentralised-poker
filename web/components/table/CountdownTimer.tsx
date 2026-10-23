"use client";

import { useEffect, useState } from "react";

export default function CountdownTimer({ deadlineMs }: { deadlineMs: number }) {
  const [now, setNow] = useState<number | null>(null);

  // The interval is cleaned up on unmount, so React strict mode's double
  // effect run does not leave two timers running.
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadlineMs]);

  if (now === null) return null;
  const secs = Math.max(0, Math.ceil((deadlineMs - now) / 1000));
  return <span className={`font-mono ${secs <= 10 ? "text-red-600" : ""}`}>{secs}s</span>;
}