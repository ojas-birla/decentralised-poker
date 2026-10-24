"use client";

import { useEffect, useState } from "react";
import { loadHandNames } from "@/lib/handNames";
import type { HandResult } from "@/lib/handResult";

/** seat -> hand name for the given result. Empty until pokersolver has loaded. */
export function useHandNames(result: HandResult | null): Record<number, string> {
  const [named, setNamed] = useState<{ key: string; names: Record<number, string> } | null>(null);
  const key = result ? `${result.tableId}:${result.handNumber}` : null;

  useEffect(() => {
    if (!result || key === null) return;
    let cancelled = false; // strict mode and fast hand changes: only the latest run may set state
    loadHandNames(result.board, result.hands)
      .then((names) => {
        if (!cancelled) setNamed({ key, names });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // result is fully identified by key; the snapshot never changes for the same key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return named && named.key === key ? named.names : {};
}
