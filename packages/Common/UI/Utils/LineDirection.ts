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
