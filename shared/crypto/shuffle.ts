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
    [locked[i], locked[j]] = [locked[j], locked[i]];
  }
  return locked;
}