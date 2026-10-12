/*
 * MARKDOWN PLACED IN ONE CELL OF A TABLE.
 *
 * A GitHub-style table row ends a cell at every "|" that is not escaped, and
 * ends the row at every line ending. Escaping a "|" with a backslash keeps it
 * in its cell, but a backslash already in the text decides what that escape
 * means. The table readers here (marked for the emails and the docs,
 * micromark for the dashboard) read a "|" after an odd number of
 * backslashes as escaped, and a "|" after an even number - "C:\|" escaped
 * once more is "C:\\|" - as the end of the cell, so the rest of the text
 * becomes a cell of its own. GitHub's own reader keeps a "|" after any
 * backslash in the cell.
 *
 * So the cell is written as the readers agree on it:
 *
 *   - a "|" after an even number of backslashes (none included) gets one
 *     more, so every "|" has an odd number before it. Each reader then keeps
 *     it in the cell, and the cell reads exactly as the same Markdown reads
 *     outside a table: "a | b" reads "a | b", "C:\\|" reads "C:\|", and an
 *     already escaped "\|" reads "|", as it does anywhere else;
 *   - a run of backslashes that ends the text and is odd gets one more, so
 *     it cannot escape the "|" written after the cell. It reads the same:
 *     a backslash at the end of a text is that backslash, whether escaped
 *     or not;
 *   - every line ending ("\r\n", "\r", "\n") becomes a space.
 *
 * Nothing else changes, so a cell holding no "|", no line ending and no
 * backslash at its end comes back exactly as it was given. The text is
 * Markdown, as every table here holds it: emphasis, code and links in it
 * stay what they are. Text that must not be read as Markdown at all is
 * escaped for that first, where it is placed (FeedMarkdown), and then given
 * here.
 *
 * One pass over the text, with no regular expression: time linear in its
 * length, whatever its shape (AGENTS.md, "Megabyte-long values").
 */

const BACKSLASH: number = 0x5c;
const PIPE: number = 0x7c;
const LINE_FEED: number = 0x0a;
const CARRIAGE_RETURN: number = 0x0d;

export type MarkdownTableCellFunction = (markdown: string) => string;

export const markdownTableCell: MarkdownTableCellFunction = (
  markdown: string,
): string => {
  const text: string = String(markdown ?? "");
  let written: string = "";
  // Where the text not yet written starts.
  let pending: number = 0;
  // How many backslashes come right before the current character.
  let backslashes: number = 0;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code === BACKSLASH) {
      backslashes++;
      continue;
    }

    if (code === PIPE) {
      if (backslashes % 2 === 0) {
        written += `${text.slice(pending, index)}\\|`;
        pending = index + 1;
      }

      backslashes = 0;
      continue;
    }

    if (code === LINE_FEED || code === CARRIAGE_RETURN) {
      written += `${text.slice(pending, index)} `;

      if (
        code === CARRIAGE_RETURN &&
        text.charCodeAt(index + 1) === LINE_FEED
      ) {
        index++;
      }

      pending = index + 1;
      backslashes = 0;
      continue;
    }

    backslashes = 0;
  }

  written += text.slice(pending);

  if (backslashes % 2 === 1) {
    written += "\\";
  }

  return written;
};

export default markdownTableCell;
