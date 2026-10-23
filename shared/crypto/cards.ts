// shared/crypto/cards.ts
import { POINT_TO_NAME } from "./cardPoints.generated";

const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();

/** Index 0..51 → point hex (64 lowercase hex chars, no 0x), in card order. */
export const CARD_POINTS: readonly string[] = Object.keys(POINT_TO_NAME).map(strip);

/** Point hex → card index 0..51. */
export const POINT_TO_INDEX: ReadonlyMap<string, number> = new Map(
  CARD_POINTS.map((p, i): [string, number] => [p, i]),
);

export function cardIndexFromPoint(pointHex: string): number | undefined {
  return POINT_TO_INDEX.get(strip(pointHex));
}