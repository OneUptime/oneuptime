import {
  getTextReadingDirection,
  ReadingDirection,
} from "../../../Types/ReadingDirection";

/*
 * NOTES READ THE WAY THEY ARE WRITTEN.
 *
 * A note, a description, an AI answer is written in its author's language,
 * whatever the page's: an English postmortem on a Persian page laid out
 * from the right put its full stops and list bullets on the wrong side,
 * and a Persian note on an English page did the same the other way. So
 * the Markdown viewer and editor lay a text out the way its first letter
 * reads (getTextReadingDirection) - an English note left to right on a
 * Persian page - and each paragraph, heading and list item then reads the
 * way its own first letter does (unicode-bidi: plaintext), so a Persian
 * paragraph in an English note still starts at the right. A text with no
 * letter yet - an empty editor, its placeholder - follows the page.
 *
 * React-free, so the viewer, the editor and the tests share it.
 */

// The text's own direction, or undefined to follow the page (no dir attribute).
export const getMarkdownReadingDirection: (
  markdown: string | null | undefined,
) => ReadingDirection | undefined = (
  markdown: string | null | undefined,
): ReadingDirection | undefined => {
  return getTextReadingDirection(markdown) || undefined;
};

/*
 * Every block of text inside reads the way its own first letter does, and
 * starts on that side. Tables keep the side the whole text reads from, so
 * a column's cells line up.
 */
export const MARKDOWN_BLOCKS_READ_THEIR_OWN_WAY_CLASS_NAME: string =
  "[&_:is(p,li,h1,h2,h3,h4,h5,h6,dt,dd,figcaption)]:[unicode-bidi:plaintext] [&_:is(p,li,h1,h2,h3,h4,h5,h6,dt,dd,figcaption)]:text-start";

// The same, for the editor's own stylesheet (the visual editor's blocks).
export const MARKDOWN_EDITOR_BLOCKS_READ_THEIR_OWN_WAY_CSS: string =
  ".oneuptime-wysiwyg :is(p, li, h1, h2, h3, h4, h5, h6, dt, dd, figcaption) { unicode-bidi: plaintext; text-align: start; }";
