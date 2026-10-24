// Mirrors what B's useDealing() returns (SPEC-PHASE3 section 3.3).
// If B renames a field, edit ONLY this interface.
import type { Banner } from "@/lib/statusLog";

export type DealingPhase =
  | "idle"
  | "committing"
  | "shuffling"
  | "unlocking"
  | "playing"
  | "showdown";

export interface DealingUi {
  dealingPhase: DealingPhase;
  waitingFor: number | null; // seat we wait on
  shuffleStep: number; // players already done (CONFIRM WITH B)
  myCards: readonly number[] | null; // my two card ids, null until dealt
  error: string | null;
}

const seatLabel = (s: number | null) => (s === null ? "another player" : `seat ${s + 1}`);

/** Banner for the dealing phase. Returns null when there is nothing to say. */
export function dealingBanner(d: DealingUi, activePlayers = 4): Banner | null {
  if (d.error) {
    return { level: "error", text: `Dealing problem: ${d.error}` };
  }
  // waitingFor is null when we are waiting on nobody, or on ourselves (useDealing).
  const wait = d.waitingFor === null ? "" : ` Waiting for seat ${d.waitingFor + 1}.`;
  switch (d.dealingPhase) {
    case "committing":
      return { level: "info", text: `Locking in padlocks.${wait}` };
    case "shuffling":
      // shuffleStep = players already done (confirmed from B's useDealing)
      return {
        level: "info",
        text: `Shuffling the deck: ${d.shuffleStep} of ${activePlayers} players done.${wait}`,
      };
    case "unlocking":
      return { level: "info", text: `Dealing cards.${wait}` };
    default:
      return null;
  }
}

/** Text next to the spinner. Only committing, shuffling and unlocking spin. */
export function busyLabel(d: DealingUi): string | null {
  if (d.error) return null;
  switch (d.dealingPhase) {
    case "committing":
      return "Committing padlocks…";
    case "shuffling":
      return "Shuffling the deck…";
    case "unlocking":
      return "Dealing cards…";
    default:
      return null;
  }
}

// ---------- Mock data (NEXT_PUBLIC_USE_MOCK=true) ----------
export interface MockDealing {
  label: string; // every label starts with "Dealing:"
  ui: DealingUi;
}

export const MOCK_DEALING: MockDealing[] = [
  {
    label: "Dealing: committing",
    ui: { dealingPhase: "committing", waitingFor: 2, shuffleStep: 0, myCards: null, error: null },
  },
  {
    label: "Dealing: shuffling 2 of 4",
    ui: { dealingPhase: "shuffling", waitingFor: 2, shuffleStep: 2, myCards: null, error: null },
  },
  {
    label: "Dealing: unlocking",
    ui: { dealingPhase: "unlocking", waitingFor: 3, shuffleStep: 4, myCards: null, error: null },
  },
  {
    label: "Dealing: playing (no banner)",
    ui: { dealingPhase: "playing", waitingFor: null, shuffleStep: 4, myCards: [0, 13], error: null },
  },
  {
    label: "Dealing: error",
    ui: {
      dealingPhase: "shuffling",
      waitingFor: null,
      shuffleStep: 1,
      myCards: null,
      error: "your padlock for this hand is missing",
    },
  },
];