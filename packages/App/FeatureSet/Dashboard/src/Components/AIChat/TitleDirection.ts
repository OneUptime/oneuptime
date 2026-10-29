import {
  getTextReadingDirectionByMostLetters,
  ReadingDirection,
} from "Common/Types/ReadingDirection";

/*
 * A ONE-LINE TITLE SOMEONE WROTE: READ ITS OWN WAY, CUT AT ITS OWN END, AND
 * STANDING WHERE THE PAGE READS FROM.
 *
 * A conversation's title is the question it began with, in the language it
 * was asked in, whatever the page's. On a Persian page an English title in
 * an isolate kept its "?" at its end, but a title too long for its line
 * lost its START ("…checkout latency spike?"): a line read right to left is
 * cut at its left. Given its own direction instead (by most of its letters,
 * as Common's IsolatedText reads a value), it is cut at its own end ("Why
 * did checkout latenc…") - but then a short one stood at the left, away
 * from its icon at the right, where the page reads from.
 *
 * So the title reads its own way and is aligned the PAGE's way: left on a
 * page read left to right, right on one read right to left. (Not the rtl:
 * variant, which also matches a title whose own dir is rtl, and not
 * `text-align: match-parent`, which Chromium does not know.) A title too
 * long for its line is laid out from its own start whatever its alignment,
 * so it is still cut at its end.
 */
export const PAGE_START_ALIGN_CLASS_NAME: string =
  "[text-align:left] [html[dir=rtl]_&]:[text-align:right]";

// The way a title reads, by most of its letters; none for one without any.
export function getTitleDirection(title: string): ReadingDirection | undefined {
  return getTextReadingDirectionByMostLetters(title) || undefined;
}
