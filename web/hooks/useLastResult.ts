"use client";

// D2: keeps the result of the last settled hand on screen after the next hand has started.
// The decisions (what a result is, which one is newer) live in lib/handResult.ts and are unit tested;
// this hook only adds React state and the timer.
import { useCallback, useEffect, useState } from "react";
import type { GameState } from "@poker/shared";
import { captureResult, mergeResult, type HandResult } from "@/lib/handResult";

export const RESULT_VISIBLE_MS = 8000;

export interface LastResult {
  result: HandResult | null;
  /** true while the panel should be on screen */
  visible: boolean;
  dismiss: () => void;
}

export function useLastResult(state: GameState | null): LastResult {
  const [result, setResult] = useState<HandResult | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null); // key of a result the player closed
  const [expired, setExpired] = useState<string | null>(null); // key of a result whose time ran out

  // 1. Capture: every new state either holds a settled hand (then we keep it) or it does not.
  //    mergeResult makes this safe to run twice (React strict mode) and for old states.
  useEffect(() => {
    if (!state) return;
    setResult((prev) => mergeResult(prev, captureResult(state)));
  }, [state]);

  const key = result ? `${result.tableId}:${result.handNumber}` : null;

  // 2. Time limit. The cleanup clears the timer, so strict mode's second run starts only one.
  useEffect(() => {
    if (key === null) return;
    const id = setTimeout(() => setExpired(key), RESULT_VISIBLE_MS);
    return () => clearTimeout(id);
  }, [key]);

  const dismiss = useCallback(() => setDismissed(key), [key]);

  // When the game is over, the last result stays until the player closes it.
  const finished = state?.tableState === "finished";
  const visible =
    result !== null &&
    state !== null &&
    state.tableId === result.tableId &&
    key !== dismissed &&
    (finished || key !== expired);

  return { result, visible, dismiss };
}
