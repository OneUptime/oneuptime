import {
  DrawnWords,
  getDrawnWords,
  LongWordHyphenation,
  WORDS_BREAK_CLASS_NAME,
  WordRun,
} from "./LongWords";

/*
 * A title with an (i) after it, as words that wrap: the (i) follows the
 * title's last word on whichever line that word ends, and goes to the next
 * line WITH that word when the line has no room for both.
 *
 * The (i) used to be the title's flex sibling (a row of the title's span and
 * the (i), `flex items-center gap-1`). A title too long for its column
 * wraps, and a wrapped flex item takes all the width it is offered - so the
 * (i) was drawn at the far edge of the tile, centred between the two lines,
 * as if it belonged to the next tile (German "Hardware-Betriebszeit" and
 * Arabic "وقت تشغيل الجهاز المادي" on a network device's hero, issue
 * #7348). English titles fit on one line, so it only showed in other
 * languages.
 *
 * So the (i) is drawn inside the title's own text (WordsWithInfoTooltip),
 * right after its last word, and glued to it: a box no line breaks inside
 * (white-space: nowrap) that starts with a WORD JOINER (U+2060) - a
 * character with no width across which no line may break (Unicode line
 * breaking, rule LB11) - and holds the (i). A line cannot break between the
 * last word and the joiner, nor inside the box, so the (i) never starts a
 * line alone: it moves with the word. The joiner is drawn by the box's
 * stylesheet (WordsWithInfoTooltip.css, `content` before it), not written in
 * the page: the title's text is its words alone. The words themselves are
 * left as they were - one text, breaking between words (break-words), or
 * where its language hyphenates a long word for a title drawn with a
 * LongWords rule - so they read, and are found, as the one title they are.
 *
 * A long word of a LongWords rule is drawn in a box of its own (an inline
 * block, which a line may break around whatever is next to it). When such a
 * word ends the title, the (i) is drawn inside that box, after it.
 */

/*
 * The box that glues the (i) to the word before it: a word joiner before it
 * (info-glue, WordsWithInfoTooltip.css), and no line breaks inside it.
 */
export const INFO_GLUE_CLASS_NAME: string = "info-glue whitespace-nowrap";

// The (i) after the last word: in the line, at the middle of its letters.
export const INFO_AFTER_WORDS_CLASS_NAME: string = "ms-1 align-middle";

export interface WordsBeforeInfo {
  // The class of the element that holds the words (LongWords).
  className: string;
  // The words, in their runs: the long words of a rule apart.
  runs: Array<WordRun>;
  /*
   * Whether the (i) is drawn inside the last run's own box: a long word of
   * a LongWords rule that ends the title. Otherwise it is drawn after the
   * last run, in the element that holds the words.
   */
  isInfoInLastRun: boolean;
}

/*
 * A title's words as drawn before its (i).
 *
 * Without a rule the words break between words only (break-words), as most
 * titles do. With a LongWords rule, a long word may be hyphenated in its
 * language (a telemetry tile's title, TileTitleWords).
 */
export function getWordsBeforeInfo(data: {
  text: string | undefined;
  // The language the words are drawn in, when it is the reader's.
  lang?: string | undefined;
  rule?: LongWordHyphenation | undefined;
}): WordsBeforeInfo {
  const text: string = data.text || "";
  const drawn: DrawnWords = data.rule
    ? getDrawnWords({ text, lang: data.lang, rule: data.rule })
    : {
        className: WORDS_BREAK_CLASS_NAME,
        runs: text ? [{ text, mayHyphenate: false }] : [],
      };
  const last: WordRun | undefined = drawn.runs[drawn.runs.length - 1];

  return {
    className: drawn.className,
    runs: drawn.runs,
    isInfoInLastRun: Boolean(last?.mayHyphenate),
  };
}
