import { describe, expect, it } from "vitest";
import { nextPayoutStep, type ChainSnapshot } from "./payout";

const base: ChainSnapshot = { status: 2, checkpointNumber: 0, challengeEnd: 0, now: 1000, withdrawableWei: 0n };

describe("nextPayoutStep", () => {
  it("nothing submitted yet -> submit", () => {
    expect(nextPayoutStep(base, 3)).toEqual({ kind: "submit" });
  });
  it("an older checkpoint is on-chain -> submit the newer one", () => {
    expect(nextPayoutStep({ ...base, checkpointNumber: 2, challengeEnd: 1100 }, 3)).toEqual({ kind: "submit" });
  });
  it("final checkpoint submitted, window open -> wait with seconds left", () => {
    expect(nextPayoutStep({ ...base, checkpointNumber: 3, challengeEnd: 1120 }, 3)).toEqual({ kind: "wait", secondsLeft: 120 });
  });
  it("window over -> finalize", () => {
    expect(nextPayoutStep({ ...base, checkpointNumber: 3, challengeEnd: 1000 }, 3)).toEqual({ kind: "finalize" });
  });
  it("finalized with money -> withdraw", () => {
    expect(nextPayoutStep({ ...base, status: 4, withdrawableWei: 5n }, 3)).toEqual({ kind: "withdraw", amountWei: 5n });
  });
  it("finalized and already withdrawn -> done", () => {
    expect(nextPayoutStep({ ...base, status: 4 }, 3)).toEqual({ kind: "done" });
  });
  it("refunded or cancelled tables can withdraw too", () => {
    expect(nextPayoutStep({ ...base, status: 5, withdrawableWei: 7n }, 3)).toEqual({ kind: "withdraw", amountWei: 7n });
    expect(nextPayoutStep({ ...base, status: 3, withdrawableWei: 7n }, 3)).toEqual({ kind: "withdraw", amountWei: 7n });
  });
  it("a table that never started on-chain is unavailable", () => {
    expect(nextPayoutStep({ ...base, status: 1 }, 3).kind).toBe("unavailable");
  });
});
