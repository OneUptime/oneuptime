import {
  getReadingDirection,
  getTextReadingDirectionByMostLetters,
  ReadingDirection,
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
 * "..." at the value's own end - "José Ignacio Negro de l...". And it lines
 * up as the page's lines do (LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
 * text-align: match-parent): a short English name on a Persian page still
 * starts at the right, under its column's name; one too long for its box
 * runs from its own start, as every line too long for its box does.
 *
 * Only a value that reads the other way from the page gets a dir of its
 * own: on an English page an English name's box is drawn exactly as
 * before.
 */

export const LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME: string =
  "[text-align:match-parent]";

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
