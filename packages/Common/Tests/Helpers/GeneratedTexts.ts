import { SeededRandom, seededRandom } from "./SeededRandom";

/*
 * Texts generated from an alphabet, the same on every run: for the property
 * tests that hold a copy of a function to its original, or a new reading to
 * an old one, on many shapes at once.
 *
 *   generatedTexts(20000, 3141, MARKUP_ALPHABET);
 *
 * gives 20,000 texts of up to 27 pieces of the alphabet each, as many
 * different ones as their lengths allow: only the shortest repeat, as there
 * are only so many texts of one or two pieces.
 *
 * The draws come from the suites' one generator, SeededRandom: a text's
 * length first, then each of its pieces.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export type GeneratedTextsFunction = (
  count: number,
  seed: number,
  alphabet: ReadonlyArray<string>,
  longest?: number,
) => Array<string>;

// `count` texts of up to `longest` pieces of the alphabet, 27 unless said.
export const generatedTexts: GeneratedTextsFunction = (
  count: number,
  seed: number,
  alphabet: ReadonlyArray<string>,
  longest: number = 27,
): Array<string> => {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError(
      `generatedTexts makes a whole number of texts, not ${String(count)}.`,
    );
  }

  if (alphabet.length === 0) {
    throw new RangeError(
      "generatedTexts needs an alphabet of one piece or more.",
    );
  }

  if (!Number.isSafeInteger(longest) || longest < 0) {
    throw new RangeError(
      `generatedTexts makes texts of a whole number of pieces, not ${String(longest)}.`,
    );
  }

  const random: SeededRandom = seededRandom(seed);
  const texts: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    let text: string = "";
    const length: number = random(longest + 1);

    for (let position: number = 0; position < length; position++) {
      text += alphabet[random(alphabet.length)];
    }

    texts.push(text);
  }

  return texts;
};
