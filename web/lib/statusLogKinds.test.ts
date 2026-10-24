import { describe, expect, it } from "vitest";
import type { EventRow } from "@poker/shared";
import { buildLog } from "./statusLog";

const env = (index: number, seat: number, type: string, payload?: unknown): EventRow =>
  ({ index, kind: "envelope", handNumber: 1, body: { type, seat, payload } }) as unknown as EventRow;
const srv = (index: number, body: unknown): EventRow =>
  ({ index, kind: "server", handNumber: 1, body }) as unknown as EventRow;

const text = (row: EventRow) => buildLog([row])[0]?.text;

describe("buildLog: envelopes", () => {
  it("bet_action: one line per action type", () => {
    expect(text(env(0, 1, "bet_action", { action: "raise", amount: 40 }))).toBe("Seat 2 raised to 40.");
    expect(text(env(0, 0, "bet_action", { action: "allin" }))).toBe("Seat 1 went all-in.");
    expect(text(env(0, 2, "bet_action", { action: "fold" }))).toBe("Seat 3 folded.");
    expect(text(env(0, 3, "bet_action", { action: "check" }))).toBe("Seat 4 checked.");
    expect(text(env(0, 0, "bet_action", { action: "call" }))).toBe("Seat 1 called.");
  });

  it("ready and checkpoint_sig", () => {
    expect(text(env(0, 2, "ready"))).toBe("Seat 3 is ready.");
    expect(text(env(0, 3, "checkpoint_sig"))).toBe("Seat 4 signed the checkpoint.");
  });

  it("envelope types the log does not show are dropped", () => {
    expect(buildLog([env(0, 0, "join")])).toEqual([]);
  });
});

describe("buildLog: server entries", () => {
  it("auto fold and auto check are warnings", () => {
    const fold = buildLog([srv(0, { kind: "auto", seat: 2, action: "fold", handNumber: 1 })])[0];
    expect(fold).toMatchObject({ kind: "warn", text: "Seat 3 timed out and folded." });
    expect(text(srv(0, { kind: "auto", seat: 1, action: "check", handNumber: 1 }))).toBe(
      "Seat 2 timed out and checked."
    );
  });

  it("hand_started names the dealer", () => {
    expect(text(srv(0, { kind: "hand_started", handNumber: 2, dealerSeat: 0 }))).toBe(
      "Hand 2 started. Seat 1 is the dealer."
    );
  });

  it("hand_settled: one winner, two winners, and no chips moved", () => {
    const settled = (awards: { seat: number; amount: number }[]) =>
      text(srv(0, { kind: "hand_settled", handNumber: 2, awards }));
    expect(settled([{ seat: 1, amount: 120 }])).toBe("Hand 2 settled: Seat 2 won 120.");
    expect(
      settled([
        { seat: 0, amount: 60 },
        { seat: 2, amount: 60 },
      ])
    ).toBe("Hand 2 settled: Seat 1 won 60, Seat 3 won 60.");
    expect(settled([])).toBe("Hand 2 settled: no chips moved.");
  });

  it("table_state turns underscores into spaces", () => {
    expect(text(srv(0, { kind: "table_state", state: "waiting_deposits" }))).toBe(
      "Table is now waiting deposits."
    );
  });

  it("abort is a warning with the reason", () => {
    const line = buildLog([srv(0, { kind: "abort", handNumber: 3, reason: "PLAYER_ABANDONED" })])[0];
    expect(line.kind).toBe("warn");
    expect(line.text).toBe("Hand 3 aborted: a player left the game.");
  });

  it("keeps log order and uses the event index as the id", () => {
    const log = buildLog([
      srv(5, { kind: "hand_started", handNumber: 1, dealerSeat: 0 }),
      env(6, 1, "bet_action", { action: "fold" }),
    ]);
    expect(log.map((l) => l.id)).toEqual([5, 6]);
  });
});
