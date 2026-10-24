import { describe, expect, it } from "vitest";
import { wonBySeat } from "./handResult";

describe("wonBySeat", () => {
  it("adds up several awards for the same seat", () => {
    const m = wonBySeat([
      { seat: 1, amount: 100 },
      { seat: 2, amount: 20 },
      { seat: 1, amount: 30 },
    ]);
    expect(m.get(1)).toBe(130);
    expect(m.get(2)).toBe(20);
    expect(m.has(0)).toBe(false);
  });
});
