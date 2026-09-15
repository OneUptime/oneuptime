/*
 * Escaping for user-controlled text interpolated INTO a markdown sentence -
 * an SLO, monitor, rule, team or user name inside a feed item such as
 * "Added [SLO {name}](link) ...".
 *
 * Why this exists: feed items are rendered by ResourceFeed without the
 * viewer's safe mode, so a name is not inert text there. A name containing
 * `](` closes the surrounding link early and points the rest of the sentence
 * somewhere else; `![x](https://tracker)` renders as an image, which is a
 * zero-click request to a third party every time the feed is opened; `*` and
 * `_` restyle the sentence; `<img ...>` is raw HTML. Every one of those is a
 * character somebody can put in a name, so every one of them is escaped.
 *
 * What it does:
 *   - `null` / `undefined` become "" so callers can pass optional names
 *     straight through.
 *   - Line breaks (\r\n, \r, \n) become a single space. A newline inside a
 *     sentence can start a heading, a list or a block quote, which no escape
 *     character can undo, and a name has no business spanning lines anyway.
 *   - Each of \ ` * _ [ ] ( ) # + - ! | < > is prefixed with a backslash. All
 *     of them are ASCII punctuation, which CommonMark guarantees a backslash
 *     turns back into the literal character, so the rendered text reads
 *     exactly like the name that was typed.
 *
 * It is deliberately NOT idempotent: escaping an already-escaped value
 * escapes the backslashes it added, and the reader then sees them. Escape
 * exactly once, at the point the value is interpolated into markdown - never
 * store the escaped form, and never escape a value that is already markdown.
 */

const LINE_BREAK_PATTERN: RegExp = /\r\n|\r|\n/g;

/*
 * Backslash comes first in the class only for readability; `replace` visits
 * the ORIGINAL string once, so the backslashes this adds are never re-escaped
 * within a single call.
 */
const MARKDOWN_INLINE_SPECIAL_CHARACTER_PATTERN: RegExp = /[\\`*_[\]()#+\-!|<>]/g;

export type EscapeMarkdownInlineFunction = (
  value: string | undefined | null,
) => string;

export const escapeMarkdownInline: EscapeMarkdownInlineFunction = (
  value: string | undefined | null,
): string => {
  if (value === undefined || value === null) {
    return "";
  }

  // Defensive: a caller typed `string` can still hand over a number at runtime.
  return String(value)
    .replace(LINE_BREAK_PATTERN, " ")
    .replace(
      MARKDOWN_INLINE_SPECIAL_CHARACTER_PATTERN,
      (character: string): string => {
        return `\\${character}`;
      },
    );
};

export default escapeMarkdownInline;
