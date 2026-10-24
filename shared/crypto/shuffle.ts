import { generatePadlock, lockCard, Padlock } from './padlock';

export function lockAndShuffle(
  deckHex: string[],                 // 52 locked-by-previous-players points
  padlock: Padlock,
  randInt: (maxExclusive: number) => number, // caller supplies CSPRNG
): string[] {
  if (deckHex.length !== 52) throw new Error('deck must be 52');
  const locked = deckHex.map(c => lockCard(c, padlock));
  // Fisher-Yates, unbiased via rejection sampling in the caller's randInt
  
  for (let i = locked.length - 1; i > 0; i--) {
    
    const j = randInt(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) {
    throw new Error(`randInt(${i + 1}) out-of-range: ${j}`);
  }
    [locked[i], locked[j]] = [locked[j], locked[i]];
  }
  return locked;
}

export function verifyNoDuplicates(deck: string[]): void {
  const seen = new Map<string, number>();
  for (let i = 0; i < deck.length; i++) {
    const first = seen.get(deck[i]);
    if (first !== undefined) {
      throw new Error(
        `duplicate card detected: ${deck[i]} at indices ${first} and ${i}`,
      );
    }
    seen.set(deck[i], i);
  }
}

// ---------------------------------------------------------------------------
// Wire-format validators (Phase 3.1 relay guards)
// ---------------------------------------------------------------------------

/** 32-byte ristretto point as hex, no 0x prefix — frozen wire format. */
const CARD_HEX_RE = /^(?:0x)?[0-9a-f]{64}$/i;
/**
 * Throws if the deck is not exactly 52 well-formed 32-byte hex strings.
 * Call on every incoming shuffle:step before relaying it (Phase 3.1).
 */
function verifyDeckShape(deck: unknown): asserts deck is string[] {
  if (!Array.isArray(deck) || deck.length !== 52) {
    throw new Error(
      `deck must be an array of 52 cards, got ${
        Array.isArray(deck) ? deck.length : typeof deck
      }`,
    );
  }
  for (let i = 0; i < deck.length; i++) {
    if (typeof deck[i] !== "string" || !CARD_HEX_RE.test(deck[i])) {
      throw new Error(`deck[${i}] is not 32-byte hex: ${String(deck[i])}`);
    }
  }
}

/**
 * Shape + no duplicates. Call once after the 4th shuffle step (Phase 3.4).
 */
export function verifyFinalDeck(deck: unknown): asserts deck is string[] {
  verifyDeckShape(deck);
  verifyNoDuplicates(deck);
}