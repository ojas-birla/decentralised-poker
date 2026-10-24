import { describe, expect, it } from "vitest";
import { MOCK_DEALING, busyLabel, dealingBanner, type DealingUi } from "./dealingUi";

const base: DealingUi = {
  dealingPhase: "idle",
  waitingFor: null,
  shuffleStep: 0,
  myCards: null,
  error: null,
};

describe("dealingBanner", () => {
  it("is null when idle, playing or at showdown", () => {
    for (const p of ["idle", "playing", "showdown"] as const) {
      expect(dealingBanner({ ...base, dealingPhase: p })).toBeNull();
    }
  });

  it("names the awaited seat as a 1-based number", () => {
    const b = dealingBanner({ ...base, dealingPhase: "committing", waitingFor: 2 });
    expect(b?.level).toBe("info");
    expect(b?.text).toContain("seat 3");
  });

  it("shows shuffle progress", () => {
    const b = dealingBanner({ ...base, dealingPhase: "shuffling", shuffleStep: 2, waitingFor: 2 });
    expect(b?.text).toContain("2 of 4");
  });

  it("uses the active player count when a seat is busted", () => {
    const b = dealingBanner({ ...base, dealingPhase: "shuffling", shuffleStep: 1 }, 3);
    expect(b?.text).toContain("1 of 3");
  });

  it("an error is a red banner and wins over the phase", () => {
    const b = dealingBanner({ ...base, dealingPhase: "unlocking", error: "boom" });
    expect(b?.level).toBe("error");
    expect(b?.text).toContain("boom");
  });
});

describe("busyLabel", () => {
  it("spins only for committing, shuffling and unlocking", () => {
    expect(busyLabel({ ...base, dealingPhase: "committing" })).not.toBeNull();
    expect(busyLabel({ ...base, dealingPhase: "shuffling" })).not.toBeNull();
    expect(busyLabel({ ...base, dealingPhase: "unlocking" })).not.toBeNull();
    for (const p of ["idle", "playing", "showdown"] as const) {
      expect(busyLabel({ ...base, dealingPhase: p })).toBeNull();
    }
  });

  it("does not spin while showing an error", () => {
    expect(busyLabel({ ...base, dealingPhase: "shuffling", error: "x" })).toBeNull();
  });
});

describe("MOCK_DEALING", () => {
  it("all labels start with Dealing:", () => {
    for (const m of MOCK_DEALING) expect(m.label.startsWith("Dealing:")).toBe(true);
  });
});