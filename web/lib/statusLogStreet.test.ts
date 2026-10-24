import { describe, expect, it } from "vitest";
import type { EventRow } from "@poker/shared";
import { buildLog } from "./statusLog";

const row = (index: number, body: unknown): EventRow =>
  ({ index, kind: "server", body } as unknown as EventRow);

describe("buildLog street lines", () => {
  it("writes Flop, Turn, River lines with no cards in the text", () => {
    const log = buildLog([
      row(1, { kind: "street", handNumber: 1, street: "flop" }),
      row(2, { kind: "street", handNumber: 1, street: "turn" }),
      row(3, { kind: "street", handNumber: 1, street: "river" }),
    ]);
    expect(log.map((l) => l.text)).toEqual(["Flop dealt.", "Turn dealt.", "River dealt."]);
  });
});
