/*
 * A code block's lines, each drawn on its own (CodeBlock with
 * wrapLongLines). A line too long for its box wraps, and the rest of it
 * continues indented under the line's own start - a hanging indent - so it
 * never reads as a line of its own:
 *
 *   curl -fsSL https://oneuptime.com/install/storage-array-agent -o
 *     install.sh
 *   bash install.sh
 *
 * is two commands, not three. Drawn as one block of text, the wrapped
 * "install.sh" started at the left edge like the line under it.
 */

/*
 * How far the rest of a wrapped line is indented past the line's own
 * start, in characters of the code's font.
 */
export const CODE_BLOCK_WRAPPED_LINE_INDENT: number = 2;

export interface CodeBlockLine {
  // The line as written, without its line break.
  text: string;
  /*
   * The line as highlight.js marked it up, every token it opens closed in
   * it, with a <wbr> after each slash of an address it may wrap at; null
   * when the code is not highlighted.
   */
  html: string | null;
  // How many spaces the line starts with: its rest wraps past them.
  leadingSpaces: number;
}

const SPAN_OPEN: string = "<span";
const SPAN_CLOSE: string = "</span>";

/*
 * highlight.js's markup, one line at a time. It marks a token up as
 * <span class="...">...</span> and escapes every "<" of the code itself,
 * so a "<" in its output starts a tag. A token can run over a line break
 * (a quoted string over two lines, an HTML tag over several): its spans
 * are closed at the end of the line and opened again at the start of the
 * next, so every line is markup of its own and keeps its colours.
 *
 * Null for markup that is not only spans, which this does not know how to
 * split: the code is then drawn whole, as without wrapLongLines. One pass,
 * no regular expression: linear in the length of the markup.
 */
export function splitHighlightedHtmlIntoLines(
  html: string,
): Array<string> | null {
  const lines: Array<string> = [];
  // The spans open at this point, outermost first, as they were opened.
  const open: Array<string> = [];
  let line: string = "";
  let index: number = 0;
  let nextTag: number = html.indexOf("<");
  let nextBreak: number = html.indexOf("\n");

  while (index < html.length) {
    if (nextTag !== -1 && nextTag < index) {
      nextTag = html.indexOf("<", index);
    }
    if (nextBreak !== -1 && nextBreak < index) {
      nextBreak = html.indexOf("\n", index);
    }

    const isTagNext: boolean =
      nextTag !== -1 && (nextBreak === -1 || nextTag < nextBreak);
    const stop: number = isTagNext
      ? nextTag
      : nextBreak === -1
        ? html.length
        : nextBreak;

    line += html.substring(index, stop);
    index = stop;

    if (index >= html.length) {
      break;
    }

    if (isTagNext) {
      const end: number = html.indexOf(">", index);

      if (end === -1) {
        return null;
      }

      const tag: string = html.substring(index, end + 1);

      if (tag === SPAN_CLOSE) {
        if (open.length === 0) {
          return null;
        }
        open.pop();
      } else if (
        tag.startsWith(SPAN_OPEN) &&
        (tag.charAt(SPAN_OPEN.length) === " " ||
          tag.charAt(SPAN_OPEN.length) === ">")
      ) {
        open.push(tag);
      } else {
        return null;
      }

      line += tag;
      index = end + 1;
      continue;
    }

    // A line break: close what is open, and open it again on the next line.
    lines.push(line + SPAN_CLOSE.repeat(open.length));
    line = open.join("");
    index++;
  }

  lines.push(line + SPAN_CLOSE.repeat(open.length));

  return lines;
}

/*
 * Where a line may wrap inside an address: after each slash of its path -
 * "https://oneuptime.com/" "install/" "proxmox-agent" - and never between
 * the two slashes after its scheme, right after them, or at the very end.
 * A browser otherwise breaks an address wherever its row ends
 * ("https://oneuptime.com/ins" / "tall/proxmox-agent"). The offsets in
 * `text` after which a break is allowed; one pass, no regular expression.
 */
export function getSlashBreakOffsets(text: string): Array<number> {
  const offsets: Array<number> = [];

  for (let index: number = 0; index < text.length - 1; index++) {
    if (
      text.charAt(index) === "/" &&
      text.charAt(index - 1) !== "/" &&
      text.charAt(index + 1) !== "/"
    ) {
      offsets.push(index + 1);
    }
  }

  return offsets;
}

// A line's text in pieces, cut after each slash a line may wrap at.
export function splitTextAtSlashBreaks(text: string): Array<string> {
  const pieces: Array<string> = [];
  let start: number = 0;

  for (const offset of getSlashBreakOffsets(text)) {
    pieces.push(text.substring(start, offset));
    start = offset;
  }

  pieces.push(text.substring(start));

  return pieces;
}

/*
 * One line of highlight.js's markup with a <wbr> after each slash a line
 * may wrap at, in its text only: never inside a tag ("</span>"). A slash
 * that ends a run of text before a tag is left alone, since what follows
 * it is not known there. One pass: linear in the length of the line.
 */
export function addSlashBreaksToHtml(html: string): string {
  let result: string = "";
  let isInTag: boolean = false;
  let previous: string = "";

  for (let index: number = 0; index < html.length; index++) {
    const character: string = html.charAt(index);
    result += character;

    if (isInTag) {
      if (character === ">") {
        isInTag = false;
      }
      continue;
    }

    if (character === "<") {
      isInTag = true;
      continue;
    }

    const next: string = html.charAt(index + 1);

    if (
      character === "/" &&
      previous !== "/" &&
      next !== "" &&
      next !== "/" &&
      next !== "<"
    ) {
      result += "<wbr>";
    }

    previous = character;
  }

  return result;
}

// The spaces a line starts with.
export function countLeadingSpaces(line: string): number {
  let count: number = 0;

  while (count < line.length && line.charAt(count) === " ") {
    count++;
  }

  return count;
}

/*
 * The code's lines, with their markup when it is highlighted. Null when
 * the markup cannot be split line for line with the code (it never should:
 * highlight.js keeps every line break of the code), and the code is drawn
 * whole.
 */
export function getCodeBlockLines(
  code: string,
  highlightedHtml: string | null,
): Array<CodeBlockLine> | null {
  const texts: Array<string> = code.split("\n");
  const htmls: Array<string> | null =
    highlightedHtml === null
      ? null
      : splitHighlightedHtmlIntoLines(highlightedHtml);

  if (highlightedHtml !== null && (!htmls || htmls.length !== texts.length)) {
    return null;
  }

  return texts.map((text: string, index: number): CodeBlockLine => {
    return {
      text: text,
      html: htmls ? addSlashBreaksToHtml(htmls[index]!) : null,
      leadingSpaces: countLeadingSpaces(text),
    };
  });
}
