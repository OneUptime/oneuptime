/*
 * The generator the outside-text and Teams reader tests draw their texts
 * from (GeneratedTexts.ts): the same texts on every run, and as many
 * different ones as their lengths allow.
 */

import { generatedTexts, seededRandom } from "./GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

const ALPHABET: Array<string> = ["<", ">", "a", "b", " ", "\n", "!", "["];

describe("generatedTexts", () => {
  test("gives the same texts for the same seed, and others for another", () => {
    expect(generatedTexts(1000, 7, ALPHABET)).toEqual(
      generatedTexts(1000, 7, ALPHABET),
    );
    expect(generatedTexts(1000, 8, ALPHABET)).not.toEqual(
      generatedTexts(1000, 7, ALPHABET),
    );
  });

  test("gives as many different texts as their lengths allow", () => {
    /*
     * 20,000 texts of up to 27 pieces of 8: only the shortest ones can
     * repeat. (A generator that draws from bits its multiply lost, as
     * HtmlMarkupCases.generatedTexts does, gave 48 different texts here.)
     */
    expect(new Set(generatedTexts(20000, 1618, ALPHABET)).size).toBeGreaterThan(
      17000,
    );
  });

  test("draws every number below the limit, about as often as each other", () => {
    const random: (limit: number) => number = seededRandom(42);
    const counts: Array<number> = new Array(10).fill(0);
    const outOfRange: Array<number> = [];

    for (let draw: number = 0; draw < 100000; draw++) {
      const value: number = random(10);

      if (!(Number.isInteger(value) && value >= 0 && value < 10)) {
        outOfRange.push(value);
        continue;
      }

      counts[value] = counts[value]! + 1;
    }

    expect(outOfRange).toEqual([]);

    for (const count of counts) {
      expect(count).toBeGreaterThan(9000);
      expect(count).toBeLessThan(11000);
    }
  });

  test("makes texts of up to as many pieces as asked", () => {
    const texts: Array<string> = generatedTexts(2000, 3, ["ab"], 5);

    expect(
      texts.every((text: string): boolean => {
        return text.length <= 10;
      }),
    ).toBe(true);
    // Every length from none to five pieces comes up.
    expect(
      new Set(
        texts.map((text: string): number => {
          return text.length;
        }),
      ),
    ).toEqual(new Set([0, 2, 4, 6, 8, 10]));
  });
});
