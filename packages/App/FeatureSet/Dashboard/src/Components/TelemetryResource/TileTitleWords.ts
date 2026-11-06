import {
  getDrawnWords,
  LongWordHyphenation,
  WORDS_BREAK_CLASS_NAME,
} from "Common/UI/Components/HyphenatedWords/LongWords";

/*
 * How the title of a telemetry overview's metric tile or chart card breaks
 * when it does not fit on one line.
 *
 * The titles are drawn in the reader's language (ResourceOverview's tiles,
 * ChartCard), in small spaced capitals beside the tile's icon. Two tiles
 * side by side on a phone, or four beside the side menu on a small laptop,
 * leave a title some 95 pixels: nine or ten letters to a line. A longer
 * word - Portuguese "Carregamentos", Danish "Forespørgsler", French
 * "chargement" - cannot have a line of its own there, and broke at the edge
 * mid-syllable with nothing to say it goes on ("CARREGAME / NTOS").
 *
 * So, as a side menu's titles do (SideMenuEntryState), a title in the
 * reader's language says its language (`lang`), and its long words alone
 * may be hyphenated where that language breaks them (Common's LongWords,
 * drawn with HyphenatedWords), at least four letters before the hyphen and
 * three after it. A word that fits a line moves there whole; a word the
 * language cannot break still breaks at the edge rather than run under the
 * icon. English - the page's own words - is never hyphenated: its titles
 * were written to fit.
 *
 * The limit is lower than the side menu's fourteen letters because a tile's
 * line is shorter than a menu's (some sixteen letters there). The short
 * words beside it are never hyphenated, in Safari too, which reads no
 * hyphenate-limit-chars: they are not in the long word's span.
 *
 * Every engine, Chrome included, hyphenates a long word where it ends a
 * line though it would fit the next one: four German tiles beside the side
 * menu read "ERFORDERT AUFMERK- / SAMKEIT" with room for AUFMERKSAMKEIT on
 * a line of its own (#5646's review). So a long word is a box of its own,
 * at most the line's width (inline-block, max-w-full): a word that fits a
 * line moves there whole, and only a word longer than any line is
 * hyphenated, inside its box.
 */

// The shortest word a tile's or chart card's title hyphenates.
export const TILE_TITLE_HYPHENATED_WORD_LENGTH: number = 10;

// A word longer than the line breaks at the line's edge rather than spill.
export const TILE_TITLE_WORDS_CLASS_NAME: string = WORDS_BREAK_CLASS_NAME;

/*
 * A long word's own classes: hyphenated in its language, four letters
 * before the hyphen and three after - hyphenate-limit-chars for Chrome and
 * Firefox, -webkit-hyphenate-limit-before and -after for Safari.
 */
export const TILE_TITLE_LONG_WORD_CLASS_NAME: string =
  "hyphens-auto [hyphenate-limit-chars:10_4_3] [-webkit-hyphenate-limit-before:4] [-webkit-hyphenate-limit-after:3]";

/*
 * A long word as a box no wider than the line: it moves whole to the next
 * line when it fits one, rather than be hyphenated at the end of this one.
 */
export const TILE_TITLE_LONG_WORD_BOX_CLASS_NAME: string =
  "inline-block max-w-full";

// A title whose every word is that long: the title itself may be hyphenated.
export const TILE_TITLE_HYPHENATED_WORDS_CLASS_NAME: string = `${TILE_TITLE_WORDS_CLASS_NAME} ${TILE_TITLE_LONG_WORD_BOX_CLASS_NAME} ${TILE_TITLE_LONG_WORD_CLASS_NAME}`;

export const TILE_TITLE_LONG_WORDS: LongWordHyphenation = {
  minimumWordLength: TILE_TITLE_HYPHENATED_WORD_LENGTH,
  longWordClassName: `${TILE_TITLE_LONG_WORD_BOX_CLASS_NAME} ${TILE_TITLE_LONG_WORD_CLASS_NAME}`,
};

/*
 * The classes of the element that holds a title's words: between words
 * always, and the title itself hyphenated only when it is in the reader's
 * language (`lang`, from getDrawnLanguage) and every word in it is
 * TILE_TITLE_HYPHENATED_WORD_LENGTH letters long or more. Its long words
 * among shorter ones are hyphenated in spans of their own (HyphenatedWords
 * with TILE_TITLE_LONG_WORDS).
 */
export function getTileTitleWordsClassName(data: {
  text: string | undefined;
  lang: string | undefined;
}): string {
  return getDrawnWords({ ...data, rule: TILE_TITLE_LONG_WORDS }).className;
}
