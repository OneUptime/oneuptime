/*
 * How one typed word matches one word of a name, shared by the searches that
 * forgive what people type: the workflow step pickers (ComponentSearch) and
 * Search (Cmd/Ctrl+K, PaletteFilter). Pure, with no imports, so either can
 * use it without pulling in the other.
 *
 * - A plural does not matter: "policies" is "policy", "statuses" is
 *   "status", "incidents" is "incident" (getWordVariants, isSameWord).
 * - A typo does not matter in a long enough word: "incidnet" is "incident"
 *   (matchWordWithTypo).
 */

// The shortest word a typo is forgiven in.
export const MIN_TYPO_WORD_LENGTH: number = 4;

export type GetWordVariantsFunction = (word: string) => Array<string>;

/*
 * A word and the singulars it could be the plural of: "policies" is
 * "policy", "statuses" is "status", "incidents" is "incident". Comparing
 * these on both sides is what makes the number not matter, without a
 * dictionary.
 */
export const getWordVariants: GetWordVariantsFunction = (
  word: string,
): Array<string> => {
  const variants: Set<string> = new Set<string>([word]);

  if (word.length > 3) {
    if (word.endsWith("ies")) {
      variants.add(`${word.slice(0, -3)}y`);
    }

    if (word.endsWith("es")) {
      variants.add(word.slice(0, -2));
    }

    if (word.endsWith("s") && !word.endsWith("ss")) {
      variants.add(word.slice(0, -1));
    }
  }

  return Array.from(variants);
};

export type IsSameWordFunction = (
  a: string,
  b: string,
  aVariants?: Array<string>,
  bVariants?: Array<string>,
) => boolean;

/*
 * The same word, the number aside: "keys" and "key", "policies" and
 * "policy". Never "runs" and "runners": the words are compared whole, not by
 * how they start. The variants can be passed in when the caller has them.
 */
export const isSameWord: IsSameWordFunction = (
  a: string,
  b: string,
  aVariants: Array<string> = getWordVariants(a),
  bVariants: Array<string> = getWordVariants(b),
): boolean => {
  if (a === b) {
    return true;
  }

  return aVariants.some((variant: string): boolean => {
    return bVariants.includes(variant);
  });
};

export type GetEditDistanceFunction = (
  a: string,
  b: string,
  maxDistance: number,
) => number;

/*
 * Edits between two words - insert, delete, replace, or swap two letters
 * side by side ("incidnet") - stopping early once it is past maxDistance,
 * when it returns maxDistance + 1.
 */
export const getEditDistance: GetEditDistanceFunction = (
  a: string,
  b: string,
  maxDistance: number,
): number => {
  if (Math.abs(a.length - b.length) > maxDistance) {
    return maxDistance + 1;
  }

  const columns: number = b.length + 1;
  let previousPrevious: Array<number> = new Array<number>(columns).fill(0);
  let previous: Array<number> = new Array<number>(columns);
  let current: Array<number> = new Array<number>(columns);

  for (let j: number = 0; j < columns; j++) {
    previous[j] = j;
  }

  for (let i: number = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMinimum: number = current[0]!;

    for (let j: number = 1; j < columns; j++) {
      const cost: number = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      let value: number = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + cost,
      );

      if (
        i > 1 &&
        j > 1 &&
        a.charAt(i - 1) === b.charAt(j - 2) &&
        a.charAt(i - 2) === b.charAt(j - 1)
      ) {
        value = Math.min(value, previousPrevious[j - 2]! + 1);
      }

      current[j] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }

    if (rowMinimum > maxDistance) {
      return maxDistance + 1;
    }

    const recycled: Array<number> = previousPrevious;
    previousPrevious = previous;
    previous = current;
    current = recycled;
  }

  return Math.min(previous[b.length]!, maxDistance + 1);
};

export type GetMaxTypoDistanceFunction = (word: string) => number;

// How many typos a word of this length may carry and still be recognised.
export const getMaxTypoDistance: GetMaxTypoDistanceFunction = (
  word: string,
): number => {
  if (word.length >= 8) {
    return 2;
  }

  if (word.length >= MIN_TYPO_WORD_LENGTH) {
    return 1;
  }

  return 0;
};

export type MatchWordWithTypoFunction = (
  token: string,
  word: string,
) => boolean;

/*
 * A typo of the whole word ("incidnet"), or of what has been typed of it so
 * far ("incidne" for "inciden...").
 */
export const matchWordWithTypo: MatchWordWithTypoFunction = (
  token: string,
  word: string,
): boolean => {
  const maxDistance: number = getMaxTypoDistance(token);

  if (maxDistance === 0) {
    return false;
  }

  if (getEditDistance(token, word, maxDistance) <= maxDistance) {
    return true;
  }

  return (
    word.length > token.length &&
    getEditDistance(token, word.slice(0, token.length), maxDistance) <=
      maxDistance
  );
};
