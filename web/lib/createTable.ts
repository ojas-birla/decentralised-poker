import { parseEther, formatEther } from "ethers";

// SPEC.md: 1000 chips per player, blinds 5 and 10, fixed.
export const CHIPS_PER_PLAYER = 1000;
export const SMALL_BLIND = 5;
export const BIG_BLIND = 10;
export const MIN_HANDS = 1;
export const MAX_HANDS = 50;

export interface CreateTableParams {
  buyInWei: string; // decimal string, per SPEC.md
  weiPerChip: string;
  totalPotWei: string; // 4 x buy-in
  hands: number;
}

export interface FormErrors {
  buyIn?: string;
  hands?: string;
}

export type ParseResult =
  | { ok: true; value: CreateTableParams }
  | { ok: false; errors: FormErrors };

export function parseCreateForm(buyInEth: string, handsText: string): ParseResult {
  const errors: FormErrors = {};
  let buyInWei = 0n;

  const trimmed = buyInEth.trim();
  if (trimmed === "") {
    errors.buyIn = "Enter a buy-in amount.";
  } else {
    try {
      buyInWei = parseEther(trimmed);
      if (buyInWei <= 0n) {
        errors.buyIn = "Buy-in must be greater than 0.";
      } else if (buyInWei % BigInt(CHIPS_PER_PLAYER) !== 0n) {
        // SPEC.md: weiPerChip = buyIn / 1000, so buy-in must divide by 1000 wei.
        errors.buyIn = "Buy-in must be divisible by 1000 wei (for example 0.001).";
      }
    } catch {
      errors.buyIn = "Enter a valid number, for example 0.001.";
    }
  }

  let hands = 0;
  if (!/^\d+$/.test(handsText.trim())) {
    errors.hands = "Enter a whole number of hands.";
  } else {
    hands = Number(handsText.trim());
    if (hands < MIN_HANDS || hands > MAX_HANDS) {
      errors.hands = `Hands must be between ${MIN_HANDS} and ${MAX_HANDS}.`;
    }
  }

  if (errors.buyIn || errors.hands) return { ok: false, errors };

  return {
    ok: true,
    value: {
      buyInWei: buyInWei.toString(),
      weiPerChip: (buyInWei / BigInt(CHIPS_PER_PLAYER)).toString(),
      totalPotWei: (buyInWei * 4n).toString(),
      hands,
    },
  };
}

export function weiToEth(wei: string): string {
  return formatEther(BigInt(wei));
}