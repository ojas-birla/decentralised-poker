import { describe, it, expect } from "vitest";
import { cardName } from "./cards";

describe("cardName (SPEC §2)", () => {
  it("matches the spec examples", () => {
    expect(cardName(0)).toBe("2c");
    expect(cardName(51)).toBe("As");
  });

  it("rank cycles every 13 ids and suit changes every 13 ids (c, d, h, s)", () => {
    expect(cardName(12)).toBe("Ac");
    expect(cardName(13)).toBe("2d");
    expect(cardName(25)).toBe("Ad");
    expect(cardName(26)).toBe("2h");
    expect(cardName(38)).toBe("Ah");
    expect(cardName(39)).toBe("2s");
    expect(cardName(8)).toBe("Tc");
    expect(cardName(11)).toBe("Kc");
  });

  it("gives 52 distinct, well-formed names for ids 0..51", () => {
    const names = Array.from({ length: 52 }, (_, i) => cardName(i as never));
    expect(new Set(names).size).toBe(52);
    for (const n of names) expect(/^[2-9TJQKA][cdhs]$/.test(n)).toBe(true);
  });
});