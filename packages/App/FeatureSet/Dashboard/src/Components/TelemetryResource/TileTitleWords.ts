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
 * reader's language that holds such a word says its language (`lang`) and
 * is hyphenated where that language breaks it, inside such words only
 * (hyphenate-limit-chars), at least four letters before the hyphen and
 * three after it. A word that fits a line moves there whole; a word the
 * language cannot break still breaks at the edge rather than run under the
 * icon. English - the page's own words - is never hyphenated: its titles
 * were written to fit.
 *
 * The limit is lower than the side menu's fourteen letters because a tile's
 * line is shorter than a menu's (some sixteen letters there). Chrome
 * hyphenates only a word that does not fit a line of its own; Firefox and
 * Safari may also hyphenate such a word where it ends a line though it would
 * fit the next one, which a title of a few words rarely meets, and which
 * reads better than a word cut at the edge with no hyphen.
 */

// The shortest word a tile's or chart card's title hyphenates.
export const TILE_TITLE_HYPHENATED_WORD_LENGTH: number = 10;

// A word longer than the line breaks at the line's edge rather than spill.
export const TILE_TITLE_WORDS_CLASS_NAME: string = "break-words";

// ...and one that may be hyphenated, in its language, inside long words only.
export const TILE_TITLE_HYPHENATED_WORDS_CLASS_NAME: string =
  "break-words hyphens-auto [hyphenate-limit-chars:10_4_3]";

// Where a title's words end: spaces, and the hyphens inside a compound.
const WORD_SEPARATOR: RegExp = /[\s\-\u{2010}]+/u;

/*
 * The classes a title's words break with: between words always, and inside
 * a word only when the title is in the reader's language (`lang`, from
 * getDrawnLanguage) and holds a word TILE_TITLE_HYPHENATED_WORD_LENGTH
 * letters long or more.
 */
export function getTileTitleWordsClassName(data: {
  text: string | undefined;
  lang: string | undefined;
}): string {
  if (!data.lang || !data.text) {
    return TILE_TITLE_WORDS_CLASS_NAME;
  }

  const hasLongWord: boolean = data.text
    .split(WORD_SEPARATOR)
    .some((word: string): boolean => {
      return Array.from(word).length >= TILE_TITLE_HYPHENATED_WORD_LENGTH;
    });

  return hasLongWord
    ? TILE_TITLE_HYPHENATED_WORDS_CLASS_NAME
    : TILE_TITLE_WORDS_CLASS_NAME;
}
