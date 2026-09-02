import { describe, expect, it } from "vitest";
import { FORMS } from "../src/game/economy";
import { KEYS, generateTitle } from "../src/game/titles";

describe("titles", () => {
  it("are deterministic and carry the opus", () => {
    const a = generateTitle("nocturne", 123, 4);
    const b = generateTitle("nocturne", 123, 4);
    expect(a).toEqual(b);
    expect(a.title.endsWith(", Op. 4")).toBe(true);
    expect(KEYS).toContain(a.key);
  });
  it("vary across seeds for every form", () => {
    for (const f of FORMS) {
      const titles = new Set<string>();
      for (let seed = 0; seed < 40; seed++) titles.add(generateTitle(f.id, seed, 1).title);
      expect(titles.size).toBeGreaterThan(8);
      for (const t of titles) expect(t.length).toBeLessThan(80);
    }
  });
});
