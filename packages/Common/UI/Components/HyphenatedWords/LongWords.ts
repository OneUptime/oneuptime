/*
 * Words that break where they read, in a box too narrow for them: between
 * words always, and inside a word only when the word is too long to be sure
 * of a line of its own - and then where its language hyphenates it.
 *
 * A side menu's titles (SideMenuEntryState) and a telemetry tile's
 * (TileTitleWords) are drawn in the reader's language. A German compound,
 * "Benachrichtigungsprotokolle" (Notification Logs), is longer than any of
 * their lines, and broke at the edge mid-syllable with nothing to say it
 * goes on; with `hyphens: auto` it breaks where German breaks it, with a
 * hyphen. But Firefox and Safari hyphenate whatever word ends a line, where
 * Chrome moves it whole to the next: "Richtlinien für einge- / hende
 * Anrufe", "Règles de taux de consom- / mation". So only a long word may be
 * hyphenated, never the short ones around it.
 *
 * That used to be said with `hyphenate-limit-chars` on the whole title (a
 * word shorter than the limit is never hyphenated), which Chrome and Firefox
 * read and Safari does not: in Safari, a title that held one long word had
 * every word in it hyphenated wherever a line ended. Now the long words
 * alone carry `hyphens: auto` - each in a span of its own when the text
 * holds shorter words too - so every engine hyphenates them only. The
 * fewest letters either side of a hyphen are said both ways as well:
 * `hyphenate-limit-chars` for Chrome and Firefox, and Safari's own
 * `-webkit-hyphenate-limit-before` and `-after`.
 *
 * Words left in English carry no language (`lang` unset: the page's own
 * English) and are never hyphenated: their titles were written to fit.
 */

export interface LongWordHyphenation {
  // The shortest word that may be hyphenated; a shorter one fits a line.
  minimumWordLength: number;
  /*
   * The classes a long word is drawn with: hyphens: auto, and the fewest
   * letters either side of a hyphen for every engine.
   */
  longWordClassName: string;
}

// A word longer than the line breaks at the line's edge rather than spill.
export const WORDS_BREAK_CLASS_NAME: string = "break-words";

// Where words end: spaces, and the hyphens inside a compound.
const WORD_SEPARATOR: RegExp = /([\s\-\u{2010}]+)/u;

// A word has a letter in it; a run of punctuation ("/", "&") is no word.
const LETTER: RegExp = /\p{L}/u;

export interface WordRun {
  text: string;
  // Drawn in a span of its own, which may be hyphenated.
  mayHyphenate: boolean;
}

export interface DrawnWords {
  // For the element that holds the words.
  className: string;
  // The text in runs: the long words apart when shorter words are beside them.
  runs: Array<WordRun>;
}

function isWord(part: string): boolean {
  return LETTER.test(part);
}

/*
 * How text breaks (see above): the class of the element that holds it, and
 * its runs.
 *
 *  - Left in English, or with no word long enough: between words only.
 *  - Every word long (one German compound, mostly): the element itself may
 *    be hyphenated, and the text stays one run.
 *  - Long words among shorter ones: each long word is a run of its own that
 *    may be hyphenated; the element and the rest of its words are not.
 */
export function getDrawnWords(data: {
  text: string | undefined;
  lang: string | undefined;
  rule: LongWordHyphenation;
}): DrawnWords {
  const text: string = data.text || "";
  const plain: DrawnWords = {
    className: WORDS_BREAK_CLASS_NAME,
    runs: text ? [{ text, mayHyphenate: false }] : [],
  };

  if (!data.lang || !text) {
    return plain;
  }

  // Words and the separators between them, in order; a separator has no letter.
  const parts: Array<string> = text
    .split(WORD_SEPARATOR)
    .filter((part: string): boolean => {
      return part.length > 0;
    });
  // Letters are counted, not UTF-16 units.
  const isLong: (part: string) => boolean = (part: string): boolean => {
    return (
      isWord(part) && Array.from(part).length >= data.rule.minimumWordLength
    );
  };
  const words: Array<string> = parts.filter(isWord);
  const longWords: Array<string> = words.filter(isLong);

  if (longWords.length === 0) {
    return plain;
  }

  if (longWords.length === words.length) {
    return {
      className: `${WORDS_BREAK_CLASS_NAME} ${data.rule.longWordClassName}`,
      runs: [{ text, mayHyphenate: false }],
    };
  }

  const runs: Array<WordRun> = [];

  for (const part of parts) {
    if (isLong(part)) {
      runs.push({ text: part, mayHyphenate: true });
      continue;
    }

    const previous: WordRun | undefined = runs[runs.length - 1];

    if (previous && !previous.mayHyphenate) {
      previous.text += part;
    } else {
      runs.push({ text: part, mayHyphenate: false });
    }
  }

  return { className: WORDS_BREAK_CLASS_NAME, runs };
}
