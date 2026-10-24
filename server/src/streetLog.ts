import type { GameState } from "@poker/shared";
import type { Db } from "./db";
import { appendEvent } from "./store";

type Street = GameState["street"];
export type StreetName = "flop" | "turn" | "river";

const ORDER: readonly Street[] = ["preflop", "flop", "turn", "river", "showdown"];

export function streetsEntered(before: GameState, after: GameState): StreetName[] {
  if (before.handNumber !== after.handNumber) return [];
  const from = ORDER.indexOf(before.street);
  const to = ORDER.indexOf(after.street);
  if (from < 0 || to <= from) return [];
  return ORDER.slice(from + 1, to + 1).filter((s): s is StreetName => s !== "showdown" && s !== "preflop");
}

export function logStreets(db: Db, tableId: string, before: GameState, after: GameState, now: number): StreetName[] {
  const streets = streetsEntered(before, after);
  for (const street of streets) {
    appendEvent(db, tableId, {
      kind: "server", handNumber: after.handNumber, type: "street",
      body: { kind: "street", handNumber: after.handNumber, street },
    }, now);
  }
  return streets;
}