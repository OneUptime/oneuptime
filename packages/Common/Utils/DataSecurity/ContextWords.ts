/*
 * THE WORDS AROUND A VALUE THAT SAY WHAT IT IS.
 *
 * A detector names the lower-case words that, near a candidate, say what
 * it is (DataTypeDetector.keywords): "tel" before a national phone number,
 * "ssn" before nine digits in a row. Data Security's scanner
 * (TextScanner.ts) looks for them around each candidate, and the rules
 * built on the detectors do too, for a type that is one only beside its
 * words (TextReadings.isWordNear, #11114): both read them here, so a
 * finding and the rule that hides it never disagree on what is a word.
 *
 * Every function is a few indexOf calls over the text it is handed, which
 * is no more than a candidate and the characters around it, or a window.
 */

function isWordCharacter(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90)
  );
}

/*
 * Whether `word` appears in `text` as a word: not inside a longer one, so
 * "pan" is found in "card pan:" and not in "company". Both are lower case.
 */
export function containsWord(text: string, word: string): boolean {
  let from: number = 0;

  for (;;) {
    const index: number = text.indexOf(word, from);

    if (index < 0) {
      return false;
    }

    const before: number = index > 0 ? text.charCodeAt(index - 1) : 32;
    const afterIndex: number = index + word.length;
    const after: number =
      afterIndex < text.length ? text.charCodeAt(afterIndex) : 32;
    const wordStartsWithLetter: boolean = isWordCharacter(word.charCodeAt(0));
    const wordEndsWithLetter: boolean = isWordCharacter(
      word.charCodeAt(word.length - 1),
    );

    if (
      (!wordStartsWithLetter || !isWordCharacter(before)) &&
      (!wordEndsWithLetter || !isWordCharacter(after))
    ) {
      return true;
    }

    from = index + 1;
  }
}

/*
 * Whether one of `words` is a word of the text from `before` characters
 * before [start, end) to `after` characters after it. The text is lower
 * case.
 */
export function anyWordNear(
  lowerText: string,
  start: number,
  end: number,
  words: ReadonlyArray<string> | undefined,
  before: number,
  after: number,
): boolean {
  if (!words || words.length === 0) {
    return false;
  }

  const around: string = lowerText.slice(
    Math.max(0, start - before),
    Math.min(lowerText.length, end + after),
  );

  for (const word of words) {
    if (containsWord(around, word)) {
      return true;
    }
  }

  return false;
}

/*
 * Whether a lower-case text holds one of `words` anywhere, in a word or
 * not: what rules out a whole text or window for a type that needs its
 * words, before any candidate is looked for.
 */
export function anyWordIn(
  lowerText: string,
  words: ReadonlyArray<string> | undefined,
): boolean {
  if (!words) {
    return false;
  }

  for (const word of words) {
    if (lowerText.includes(word)) {
      return true;
    }
  }

  return false;
}
