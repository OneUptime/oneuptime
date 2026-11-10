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
