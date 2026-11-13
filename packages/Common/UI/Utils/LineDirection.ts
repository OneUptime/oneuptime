import {
  getReadingDirection,
  getTextReadingDirectionByMostLetters,
  hasEnglishWords,
  hasRightToLeftWords,
  ReadingDirection,
  RIGHT_TO_LEFT,
} from "../../Types/ReadingDirection";

/*
 * A LINE CUT SHORT AT ITS OWN END.
 *
 * A value on a line of its own that ends in "..." where its box does - a
 * person's name in a table's cell, a chart's title, a feed's last poll
 * summary - is cut at the end of the line, and a line ends where the page's
 * lines do: at the left on a Persian page. So an English name there lost
 * its start ("...negro de la Vega"), and a Persian one on an English page
 * lost its start too. An inline isolate (IsolatedText) keeps a value's
 * punctuation where it was written, but the ellipsis belongs to the box
 * that cuts the line, not to the isolate inside it.
 *
 * So the box itself reads the way its value does (dir), which puts the
 * "..." at the value's own end - "José Ignacio Negro de l...". Only a value
 * that reads the other way from the page gets a dir of its own (on an
 * English page an English name's box is drawn exactly as before), so the
 * page's start is always that box's end: aligned to its end
 * (LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME, text-align: end), a short English
 * name on a Persian page still starts at the right, under its column's
 * name. One too long for its box runs from its own start, as every line
 * too long for its box does, and ends in "..." at the left. (text-align:
 * match-parent says the same in one word, but Chrome does not know it.)
 */

export const LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME: string = "text-end";

/*
 * A ONE-LINE VALUE THAT MAY BE CUT SHORT BY LINE-CLAMP, READ THE OTHER WAY.
 *
 * A table row's name, while its table fits its card, breaks anywhere and
 * shows only its first line (TableLayout's
 * TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME). Aligned to its end as a one-line
 * box is, that line's "..." was drawn past the box's end, where the box cut
 * it: "Customer notifications worker (queue co.." on an Arabic monitor
 * list. So only the box's last line is aligned to its end
 * (text-align-last). A name that fits is one line, its last, and starts
 * where the page's lines do; a name cut short shows a first line that is
 * never its last, which runs from its own start and ends in the whole
 * "...". A line that does not wrap is its box's last, so the same box cut
 * short by text-overflow reads as a one-line box does.
 */
export const LINE_OR_CLAMPED_LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME: string =
  "text-start [text-align-last:end]";

/*
 * A VALUE CUT SHORT TO A FEW LINES (line-clamp), READ THE OTHER WAY.
 *
 * A clamped box cannot be aligned to its end as a one-line box is: Chrome
 * draws the "..." of a clamped line past the end of a line aligned to its
 * end, where the box cuts it off, so an English title clamped on a Persian
 * page lost its end with nothing to say so. The box is as wide as its
 * value instead, up to its holder's width (with its own dir, from
 * getLineDirection). A short value is a box narrower than its holder, and
 * such a box sits at its holder's start: where the page's lines start, as
 * one aligned to its end would. One too long fills its holder, runs from
 * its own start and ends in "..." at its own end.
 */
export const CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME: string =
  "w-fit max-w-full";

/*
 * The dir a box that holds one line of `text` needs: the way most of the
 * text's letters read (getTextReadingDirectionByMostLetters) when that is
 * not the way the page's language reads, and none otherwise - nor for a
 * text with no letters (a port, a count), which reads as the page does.
 */
export const getLineDirection: (
  text: string | null | undefined,
  pageLanguage: string | null | undefined,
) => ReadingDirection | undefined = (
  text: string | null | undefined,
  pageLanguage: string | null | undefined,
): ReadingDirection | undefined => {
  const direction: ReadingDirection | null =
    getTextReadingDirectionByMostLetters(text);

  if (!direction || direction === getReadingDirection(pageLanguage)) {
    return undefined;
  }

  return direction;
};

/*
 * A LINE READ ONE WAY ON EVERY PAGE, WHATEVER ITS LETTERS.
 *
 * The user flow map is drawn from the left in every language, so a
 * transition is named its way: its two pages and the arrow between them
 * (joinWithArrowsInDirection), "/home → /cart" on an Arabic page too. Each
 * page is set apart there, so the line has no letter of its own, and read
 * by the letters in its isolates (getLineDirection) a transition between
 * two folds named in Arabic - "صفحات أخرى → صفحات أخرى" - or from one
 * into "/" was laid out from the right on an Arabic page, its arrow
 * pointing back at where the sessions came from. Such a line's box takes
 * the line's direction instead: `direction` where the page reads the other
 * way, and, as getLineDirection gives, none where the page reads that way
 * too.
 */
export const getOneWayLineDirection: (
  direction: ReadingDirection,
  pageLanguage: string | null | undefined,
) => ReadingDirection | undefined = (
  direction: ReadingDirection,
  pageLanguage: string | null | undefined,
): ReadingDirection | undefined => {
  return direction === getReadingDirection(pageLanguage)
    ? undefined
    : direction;
};

/*
 * A LINE OF THE PRODUCT'S OWN WORDS - a help line, the sentence under a
 * title, an error - in the reader's language or, not worded in it yet, in
 * English: the dir a box that holds it needs.
 *
 * On a page read from the right, a line with right-to-left words of its
 * own (hasRightToLeftWords) is in the page's language: an Arabic or Persian
 * sentence, however many names it gives in Latin letters. Read by most of
 * their letters (getLineDirection), the SMTP server's help that names
 * smtp.office365.com (Microsoft 365) and smtp.gmail.com (Google), and the
 * Arabic two-factor card's line that names 1Password, Google Authenticator
 * and Microsoft Authenticator, read left to right: laid out from the left,
 * their words came out in the wrong order. Such a line is drawn as the
 * page draws its lines. Any other - an English sentence not worded yet, an
 * English answer from the server, a line on a page read from the left -
 * reads the way getLineDirection says. So does an English sentence that
 * quotes a name typed in Arabic or Persian letters, which has right-to-left
 * letters of its own too: "Runner "قناة الطوارئ" is offline." drawn the
 * page's way put its full stop first and its words out of order. Its small
 * English words ("is", "the", "already") tell it apart (hasEnglishWords).
 *
 * A value someone typed - a name, a title, a note - is not the page's
 * words, and reads by most of its letters wherever it is shown.
 */
export const getTranslatedLineDirection: (
  text: string | null | undefined,
  pageLanguage: string | null | undefined,
) => ReadingDirection | undefined = (
  text: string | null | undefined,
  pageLanguage: string | null | undefined,
): ReadingDirection | undefined => {
  if (
    getReadingDirection(pageLanguage) === RIGHT_TO_LEFT &&
    hasRightToLeftWords(text) &&
    !hasEnglishWords(text)
  ) {
    return undefined;
  }

  return getLineDirection(text, pageLanguage);
};
