/*
 * Texts generated from an alphabet, the same on every run: for the property
 * tests that hold a copy of a function to its original, or a new reading to
 * an old one, on many shapes at once.
 *
 * The generator is a 32-bit linear congruential one. Math.imul keeps its
 * multiply exact, and each draw reads the state's high bits. A plain "*"
 * passes 2^53 and loses the low bits of the state, and the low bits of such a
 * generator repeat soon: HtmlMarkupCases.generatedTexts, which does both,
 * gives about a thousand different texts however many it is asked for.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export type SeededRandomFunction = (seed: number) => (limit: number) => number;

// A number from 0 up to, not including, the limit, the same sequence for the same seed.
export const seededRandom: SeededRandomFunction = (
  seed: number,
): ((limit: number) => number) => {
  let state: number = seed >>> 0;

  return (limit: number): number => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return Math.floor((state / 4294967296) * limit);
  };
};

export type GeneratedTextsFunction = (
  count: number,
  seed: number,
  alphabet: ReadonlyArray<string>,
  longest?: number,
) => Array<string>;

// Texts of up to `longest` pieces of the alphabet, 27 unless said.
export const generatedTexts: GeneratedTextsFunction = (
  count: number,
  seed: number,
  alphabet: ReadonlyArray<string>,
  longest: number = 27,
): Array<string> => {
  const random: (limit: number) => number = seededRandom(seed);
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
