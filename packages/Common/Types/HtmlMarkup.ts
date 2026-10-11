/*
 * HTML - or Markdown with HTML in it - read as text: every tag and comment
 * taken out, the text between them kept exactly as it is.
 *
 * Product code takes markup out of text in several places: an anchor made
 * from a docs heading (MarkdownSlugify), a docs tab's key
 * (MarkdownDocsExtensions), the docs search index (Docs/Utils/SearchIndex),
 * and a Microsoft Teams message read as text (ReactionNoteSync,
 * MicrosoftTeamsUtil.stripHtmlTags). Most of them removed /<[^>]*>/ in one
 * pass. That leaves an unclosed tag ("<script" with no ">" after it) exactly
 * as it came in, ends a tag at a ">" inside a quoted attribute value
 * (title="a > b") and keeps the rest of the value as text, and ends a
 * comment at its first ">". Code scanning reports the pattern as incomplete
 * multi-character sanitization (js/incomplete-multi-character-sanitization).
 * They all read text through this one walk now:
 *
 *   - Every "<" opens markup. HTML a renderer or a chat client writes has a
 *     "<" that is text as "&lt;", and entities are left as they are.
 *   - A comment ends at the first "-->" after its "<!--" ("<!-->" and
 *     "<!--->" end at once, as in a browser); a tag, at the first ">" outside
 *     a quoted attribute value. Each is dropped whole, across lines too.
 *   - A "<" whose markup never ends is dropped on its own, and the text
 *     after it stays: a broken tag still shows what follows it.
 *
 * So the text it returns holds no "<" at all, whatever it is given: no tag
 * is left, and none can form from the pieces either side of one that was
 * taken out. Taking markup out of that text again changes nothing.
 *
 * It reads a text in time that grows with its length alone. Looking ahead
 * from each "<" for the ">" that ends its tag reads the rest of the text
 * again for every "<" that never closes - a run of "<" before an "=" and an
 * unclosed quote took time that grew with the square of its length - so
 * where every tag ends is worked out once, from the end of the text
 * (findTagEnds), before the walk.
 *
 * The docs tests read rendered pages the same way (stripHtmlTags in
 * App/Tests/FeatureSet/Docs/DocsHtmlText.ts).
 *
 * Imports nothing, on purpose: MarkdownSlugify imports it, and the docs
 * anchor scripts (Scripts/Docs) load MarkdownSlugify with nothing but the
 * repository's root npm install.
 */

// What may stand between an attribute's "=" and its quoted value.
const WHITESPACE_CHARACTER: RegExp = /\s/;

const COMMENT_OPEN: string = "<!--";
const COMMENT_CLOSE: string = "-->";

type FindTagEndsFunction = (html: string, from: number) => Int32Array;

/*
 * Where a tag whose body starts at each position of `html` from `from` on
 * ends: the position just past its first ">" outside a quoted attribute
 * value, or -1 when it never ends. Entry 0 is position `from`. A tag's body
 * starts at the character after its "<".
 *
 * Worked out from the end of the text, so each position is read once. A
 * quote opens an attribute value only where a value can start - after "="
 * and any whitespace - and the value runs to the next quote of its kind, as
 * a browser reads it; anywhere else a quote is text in the tag.
 */
const findTagEnds: FindTagEndsFunction = (
  html: string,
  from: number,
): Int32Array => {
  const size: number = html.length - from;
  // The end, read from a position outside any attribute value.
  const tagEnds: Int32Array = new Int32Array(size + 1);
  // The end, read from a position after an "=", where a quote opens a value.
  const valueEnds: Int32Array = new Int32Array(size + 1);
  // The nearest quote of each kind after the position being read.
  let nextDoubleQuote: number = -1;
  let nextSingleQuote: number = -1;

  tagEnds[size] = -1;
  valueEnds[size] = -1;

  for (let entry: number = size - 1; entry >= 0; entry--) {
    const position: number = from + entry;
    const character: string = html.charAt(position);
    const next: number = entry + 1;

    if (character === ">") {
      tagEnds[entry] = position + 1;
      valueEnds[entry] = position + 1;
    } else if (character === "=") {
      tagEnds[entry] = valueEnds[next]!;
      valueEnds[entry] = valueEnds[next]!;
    } else if (character === '"' || character === "'") {
      const close: number =
        character === '"' ? nextDoubleQuote : nextSingleQuote;

      tagEnds[entry] = tagEnds[next]!;
      // The value runs to the next quote of its kind; the tag goes on after.
      valueEnds[entry] = close === -1 ? -1 : tagEnds[close - from + 1]!;
    } else if (WHITESPACE_CHARACTER.test(character)) {
      tagEnds[entry] = tagEnds[next]!;
      valueEnds[entry] = valueEnds[next]!;
    } else {
      tagEnds[entry] = tagEnds[next]!;
      // Anything else after an "=" is an unquoted value, which no quote opens.
      valueEnds[entry] = tagEnds[next]!;
    }

    if (character === '"') {
      nextDoubleQuote = position;
    } else if (character === "'") {
      nextSingleQuote = position;
    }
  }

  return tagEnds;
};

export type RemoveHtmlMarkupFunction = (html: string) => string;

/**
 * The text of `html` with every tag and comment taken out, and every "<"
 * that opens nothing that ends dropped on its own (see the top of this
 * file). The text between them is kept exactly as it is, entities included.
 * What it returns holds no "<".
 */
export const removeHtmlMarkup: RemoveHtmlMarkupFunction = (
  html: string,
): string => {
  const firstOpen: number = html.indexOf("<");

  if (firstOpen === -1) {
    return html;
  }

  // With no ">" after the first "<", no markup ends: every "<" goes alone.
  if (html.lastIndexOf(">") < firstOpen) {
    return html.split("<").join("");
  }

  // A tag's body starts just after a "<", so none starts before this.
  const bodiesFrom: number = firstOpen + 1;
  const tagEnds: Int32Array = findTagEnds(html, bodiesFrom);
  /*
   * The first "-->" at or after where one was last looked for, so the text
   * after a comment that never closes is not searched again for every
   * "<!--" in it. -2: not looked for yet.
   */
  let commentClose: number = -2;
  let text: string = html.slice(0, firstOpen);
  let index: number = firstOpen;

  while (index < html.length) {
    const open: number = html.indexOf("<", index);

    if (open === -1) {
      return text + html.slice(index);
    }

    text += html.slice(index, open);

    let end: number;

    if (html.startsWith(COMMENT_OPEN, open)) {
      // Looked for from the second "-", so "<!-->" and "<!--->" end at once.
      const searchFrom: number = open + 2;

      if (
        commentClose === -2 ||
        (commentClose !== -1 && commentClose < searchFrom)
      ) {
        commentClose = html.indexOf(COMMENT_CLOSE, searchFrom);
      }

      end = commentClose === -1 ? -1 : commentClose + COMMENT_CLOSE.length;
    } else {
      end = tagEnds[open + 1 - bodiesFrom]!;
    }

    index = end === -1 ? open + 1 : end;
  }

  return text;
};

export default removeHtmlMarkup;
