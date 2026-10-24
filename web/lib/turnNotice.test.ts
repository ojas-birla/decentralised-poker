import { describe, expect, it } from "vitest";
import type { PlayerPresence } from "@poker/shared";
import { buildBanner } from "./statusLog";
import { disconnectedTurnNotice } from "./turnNotice";
import { game, seat } from "./testHelpers";

const betting = (toActSeat: 0 | 1 | 2 | 3 | null) =>
  game({
    tableState: "betting",
    toActSeat,
    seats: [
      seat(0, { inHand: true }),
      seat(1, { inHand: true }),
      seat(2, { inHand: true }),
      seat(3, { inHand: true }),
    ],
  });

const offline = (s: 0 | 1 | 2 | 3): PlayerPresence[] => [
  { seat: s, wallet: "0x" + String(s + 1).repeat(40), connected: false },
];

describe("disconnectedTurnNotice", () => {
  it("is null when the seat to act is connected", () => {
    expect(disconnectedTurnNotice(betting(2), [], null, 0)).toBeNull();
  });

  it("is null when nobody is to act", () => {
    expect(disconnectedTurnNotice(betting(null), offline(2), null, 0)).toBeNull();
  });

  it("is null for your own seat, even if presence says offline", () => {
    expect(disconnectedTurnNotice(betting(0), offline(0), null, 0)).toBeNull();
  });

  it("returns the notice with the deadline of that seat's timer", () => {
    const n = disconnectedTurnNotice(betting(2), offline(2), { seat: 2, deadline: 99000 }, 0);
    expect(n).toEqual({ kind: "seat_disconnected", seat: 2, deadlineMs: 99000 });
  });

  it("ignores a timer that belongs to another seat", () => {
    const n = disconnectedTurnNotice(betting(2), offline(2), { seat: 1, deadline: 99000 }, 0);
    expect(n).toEqual({ kind: "seat_disconnected", seat: 2, deadlineMs: undefined });
  });

  it("falls back to the connected flag inside the state when there is no presence row", () => {
    const s = betting(3);
    s.seats[3].connected = false;
    expect(disconnectedTurnNotice(s, [], null, 0)).not.toBeNull();
  });
});

describe("buildBanner seat_disconnected", () => {
  it("is a warning with the countdown deadline", () => {
    const b = buildBanner("connected", { kind: "seat_disconnected", seat: 2, deadlineMs: 5000 });
    expect(b).toMatchObject({ level: "warn", deadlineMs: 5000 });
    expect(b!.text).toContain("Seat 3 is disconnected");
  });

  it("our own connection problems still come first", () => {
    const b = buildBanner("reconnecting", { kind: "seat_disconnected", seat: 2, deadlineMs: 5000 });
    expect(b!.text).toContain("Reconnecting");
  });
});
