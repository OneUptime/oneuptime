/*
 * The texts the property tests draw (GeneratedTexts.ts): the same texts on
 * every run, made of the alphabet's pieces, of every length up to the
 * longest asked for, and as many different ones as their lengths allow.
 */

import { generatedTexts } from "./GeneratedTexts";
import { SeededRandom, seededRandom } from "./SeededRandom";
import { MARKUP_ALPHABET } from "../Types/HtmlMarkupCases";
import { describe, expect, test } from "@jest/globals";

const ALPHABET: Array<string> = ["<", ">", "a", "b", " ", "\n", "!", "["];

// The texts that come up more than once.
const repeatedIn: (texts: Array<string>) => Array<string> = (
  texts: Array<string>,
): Array<string> => {
  const seen: Set<string> = new Set<string>();
  const repeated: Set<string> = new Set<string>();

  for (const text of texts) {
    if (seen.has(text)) {
      repeated.add(text);
    }

    seen.add(text);
  }

  return Array.from(repeated);
};

// A text's pieces, for alphabets of single characters (code points).
const piecesOf: (text: string) => number = (text: string): number => {
  return Array.from(text).length;
};

// A text read back into the pieces it was made of; null when a stretch of it is no piece.
const readBack: (
  text: string,
  pieces: ReadonlyArray<string>,
) => Array<string> | null = (
  text: string,
  pieces: ReadonlyArray<string>,
): Array<string> | null => {
  const read: Array<string> = [];
  let at: number = 0;

  while (at < text.length) {
    let piece: string | undefined = undefined;

    for (const candidate of pieces) {
      if (text.startsWith(candidate, at)) {
        piece = candidate;
        break;
      }
    }

    if (piece === undefined) {
      return null;
    }

    read.push(piece);
    at += piece.length;
  }

  return read;
};

describe("generatedTexts", () => {
  test("gives the same texts for the same seed, and others for another", () => {
    expect(generatedTexts(1000, 7, ALPHABET)).toEqual(
      generatedTexts(1000, 7, ALPHABET),
    );
    expect(generatedTexts(1000, 8, ALPHABET)).not.toEqual(
      generatedTexts(1000, 7, ALPHABET),
    );
  });

  test("draws a text's length, then each of its pieces, from the seed's stream", () => {
    const random: SeededRandom = seededRandom(1618);
    const texts: Array<string> = [];

    for (let index: number = 0; index < 50; index++) {
      const length: number = random(28);
      let text: string = "";

      for (let position: number = 0; position < length; position++) {
        text += ALPHABET[random(ALPHABET.length)];
      }

      texts.push(text);
    }

    expect(generatedTexts(50, 1618, ALPHABET)).toEqual(texts);
  });

  test("gives as many different texts as their lengths allow", () => {
    /*
     * 20,000 texts of up to 27 pieces of 8, each length about as often: one
     * in 28 is empty, one in 28 is one of only 8 texts of one piece, and so
     * on - only the short ones can repeat. (The copy in HtmlMarkupCases,
     * whose multiply lost the low bits of its state, gave 48 different texts
     * here.)
     */
    const texts: Array<string> = generatedTexts(20000, 1618, ALPHABET);

    expect(new Set<string>(texts).size).toBeGreaterThan(17000);
    // No text of 8 pieces or more (16 million of them or more) comes up twice.
    expect(
      repeatedIn(texts).filter((text: string): boolean => {
        return piecesOf(text) >= 8;
      }),
    ).toEqual([]);
  });

  test.each([
    // The suites that ask for markup texts, as they ask for them.
    ["HtmlMarkup", 20000, 4242],
    ["OAuth2TokenClientMarkup", 20000, 3141],
    ["HtmlMarkupLessThanAsText", 20000, 5821],
    ["DynamicsNoteMarkup", 20000, 2718],
    ["HtmlMarkup's replaceHtmlMarkup", 5000, 77],
    ["HtmlMarkupLessThanAsText without the option", 5000, 7713],
  ])(
    "gives %s (%i texts, seed %i) a different text for nearly every one it asks for",
    (_suite: string, count: number, seed: number) => {
      const texts: Array<string> = generatedTexts(count, seed, MARKUP_ALPHABET);

      /*
       * Of 24 pieces: the empty text, 24 texts of one piece and 576 of two
       * are most of the repeats - about one text in 11 of these suites.
       */
      expect(new Set<string>(texts).size).toBeGreaterThan(count * 0.9);
      // No text of 6 pieces or more (191 million of them or more) comes up twice.
      expect(
        repeatedIn(texts).filter((text: string): boolean => {
          return piecesOf(text) >= 6;
        }),
      ).toEqual([]);
    },
  );

  test("makes texts of up to as many pieces as asked, every length coming up", () => {
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

  test("makes texts of up to 27 pieces unless asked otherwise", () => {
    const lengths: Set<number> = new Set<number>(
      generatedTexts(5000, 11, ["x"]).map((text: string): number => {
        return text.length;
      }),
    );

    expect(Math.max(...lengths)).toBe(27);
    expect(lengths.size).toBe(28);
  });

  test("makes every text of the alphabet's pieces, each piece about as often", () => {
    // Pieces that tell themselves apart: a text reads back into its pieces.
    const pieces: Array<string> = ["<a>", "&amp;", "é", "😀", " "];
    const counts: Map<string, number> = new Map<string, number>();
    const notPieces: Array<string> = [];

    for (const text of generatedTexts(4000, 99, pieces)) {
      const read: Array<string> | null = readBack(text, pieces);

      if (read === null) {
        notPieces.push(text);
        continue;
      }

      for (const piece of read) {
        counts.set(piece, (counts.get(piece) || 0) + 1);
      }
    }

    expect(notPieces).toEqual([]);

    const total: number = Array.from(counts.values()).reduce(
      (sum: number, count: number): number => {
        return sum + count;
      },
      0,
    );

    expect(
      pieces.every((piece: string): boolean => {
        return Math.abs((counts.get(piece) || 0) / total - 0.2) < 0.02;
      }),
    ).toBe(true);
  });

  test("makes none when asked for none, and empty texts when the longest is none", () => {
    expect(generatedTexts(0, 1, ALPHABET)).toEqual([]);
    expect(generatedTexts(5, 1, ALPHABET, 0)).toEqual(["", "", "", "", ""]);
  });

  test.each([
    ["an empty alphabet", 10, [] as Array<string>, 27],
    ["a count below none", -1, ALPHABET, 27],
    ["a count that is a fraction", 2.5, ALPHABET, 27],
    ["a longest below none", 10, ALPHABET, -1],
    ["a longest that is a fraction", 10, ALPHABET, 3.5],
  ])(
    "refuses %s",
    (
      _case: string,
      count: number,
      alphabet: Array<string>,
      longest: number,
    ) => {
      expect(() => {
        return generatedTexts(count, 1, alphabet, longest);
      }).toThrow(RangeError);
    },
  );
});
