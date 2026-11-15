import {
  DrawnWords,
  getDrawnWords,
  LongWordHyphenation,
  WORDS_BREAK_CLASS_NAME,
  WordRun,
} from "./LongWords";

/*
 * A title with an (i) after it, as words that wrap: the (i) follows the
 * title's last word on whichever line that word ends, and is never drawn
 * alone at the start of a line.
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
 * right after its last word, and the words make room for it on every line:
 * the box that holds them keeps the (i)'s width free at its end
 * (WORDS_KEEP_INFO_ROOM_CLASS_NAME), and the (i) takes that width back
 * (INFO_AFTER_WORDS_CLASS_NAME), so it adds nothing to a line. A line is
 * full when its words reach the room, never when the (i) does: the words
 * wrap - or a long word hyphenates - where they would have to anyway, and
 * the (i) always fits after the last of them.
 *
 * Gluing the (i) to the last word with a word joiner (U+2060) does not do:
 * it keeps the pair together, but a line too short for both still breaks
 * before the (i) and leaves it alone under the title - and the joiner stops
 * Chrome hyphenating the word it touches, so a tile's "ANFRAGE-RATE" is
 * drawn whole over a lone (i), and "SPITZENSPEI-CHER" as "SPITZENSPEICH" +
 * "ER" with no hyphen (German, 390px). Keeping the room lets the word
 * hyphenate where its language does, with the (i) after it.
 *
 * The words themselves are left as they were - one text, breaking between
 * words (break-words), or where its language hyphenates a long word for a
 * title drawn with a LongWords rule - so they read, and are found, as the
 * one title they are. A long word of a LongWords rule is drawn in a box of
 * its own (an inline block); when such a word ends the title, the (i) is
 * drawn inside that box, after it.
 */

/*
 * The box that holds the (i) after the last word: no line breaks inside it,
 * so the (i) and anything a caller adds beside it stay one piece.
 */
export const INFO_GLUE_CLASS_NAME: string = "whitespace-nowrap";

/*
 * The (i) after the last word: a gap from it (ms-1), at the middle of its
 * letters, taking back the room the words keep for it (-me-[1.125rem]: the
 * gap and the 14px icon), so it adds no width to the line it is on.
 */
export const INFO_AFTER_WORDS_CLASS_NAME: string =
  "ms-1 -me-[1.125rem] align-middle";

/*
 * The words' box, when an (i) follows them: it keeps the (i)'s room - the
 * gap and the icon, 1.125rem - free at the end of every line it draws, and
 * is no wider than its words and that room. An inline block, so it still
 * sits in the line of whatever holds it (a section's count after it).
 */
export const WORDS_KEEP_INFO_ROOM_CLASS_NAME: string =
  "inline-block max-w-full pe-[1.125rem]";

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
