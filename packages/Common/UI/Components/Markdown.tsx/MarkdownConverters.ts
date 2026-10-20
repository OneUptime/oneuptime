/*
 * Lightweight markdown <-> HTML converters used by the WYSIWYG editor.
 *
 * Scope is intentionally limited to the formatting the toolbar produces
 * (headings, bold/italic/underline/strikethrough, lists, task lists,
 * links, images, inline code, fenced code blocks, blockquotes, horizontal
 * rules, GFM tables, paragraphs) plus nested lists, which platform monitors
 * write into incident / alert root causes. Edge cases beyond that are
 * best-effort.
 *
 * The editing surface is a contenteditable, so the produced HTML is
 * passed through DOMPurify before being injected by callers.
 *
 * Both directions read text whoever wrote the note, description or
 * postmortem wrote, in the browser of everyone who edits it, so both take
 * time in line with its length: every pattern here reads a line once
 * (MarkdownHeadingLine and MarkdownLinkSpans read the shapes no pattern
 * reads once), the HTML is written back part by part without asking the
 * text written so far anything, and a table is never written out to many
 * times the size of what it holds.
 */

import { readHeadingLine, HeadingLine } from "./MarkdownHeadingLine";
import {
  findImageSpans,
  findLinkSpans,
  LinkSpan,
  replaceLinkSpans,
} from "./MarkdownLinkSpans";
import { withoutTrailingRun } from "../../../Utils/TrailingRuns";

const escapeAttr: (s: string) => string = (s: string): string => {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
};

const escapeText: (s: string) => string = (s: string): string => {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

/*
 * renderInline stashes finished HTML under a numbered token delimited by NUL
 * characters, which ordinary text does not contain. They are written as
 * escapes: a literal NUL byte in this file made git treat it as binary, so
 * every change to it showed up as an unreadable "Bin" diff.
 */
const PLACEHOLDER_OPEN: string = "\u0000";
const PLACEHOLDER_CLOSE: string = "\u0000";

/*
 * Regex literals are extracted to named consts so callsites use
 * `RE.test(line)` instead of `(/.../).test(line)`. The latter form
 * triggers a prettier/eslint round-trip in this repo.
 */
/*
 * The delimiter row of a GFM table.
 *
 * The repeat is `*` rather than `+` so that a ONE column table -- which is
 * exactly what `tableToMarkdown` emits for a one column table, and therefore
 * what comes back through the editor's render/serialize loop -- is recognised
 * on the way back in. With `+` that row parsed as a paragraph and the table
 * was silently flattened into text every time the document was reopened.
 *
 * Dropping to `*` means a bare `---` also matches the pattern, so
 * `tryParseTable` additionally requires a pipe in the row: a horizontal rule
 * under a line that happens to contain a pipe must stay a horizontal rule.
 *
 * A pipe and the white space either side of it are one optional part, at
 * the row's start and at its end: written as an optional pipe between two
 * runs of white space, each split of a run between the two was tried, and
 * a row with long runs of white space took time that grew with their cube.
 * It matches the same rows.
 */
const RE_TABLE_SEPARATOR: RegExp =
  /^\s*(?:\|\s*)?:?-+:?\s*(?:\|\s*:?-+:?\s*)*(?:\|\s*)?$/;
const RE_BLANK_LINE: RegExp = /^\s*$/;
/*
 * The white space after the backticks is taken whole ((?!\s)): when the
 * language name was empty, the two runs of white space around it shared
 * one run every way it splits, and a long one took time in its square.
 */
const RE_FENCE_OPEN: RegExp = /^\s*```\s*(?!\s)([\w-]*)\s*$/;
const RE_FENCE_CLOSE: RegExp = /^\s*```\s*$/;
const RE_HORIZONTAL_RULE: RegExp = /^\s*(---+|\*\*\*+|___+)\s*$/;
const RE_BLOCKQUOTE_LINE: RegExp = /^\s*>/;
/*
 * The white space after a list marker is taken whole ((?!\s)), so the text
 * after it is read to the line's end once: tried from each character of a
 * long run of white space, a line separator after it (which "." does not
 * match) was found again from each, in time that grew with the run's
 * square. The pattern matches the same lines, with the same groups.
 */
const RE_LIST_ITEM: RegExp = /^(\s*)([-*+]|\d+\.)\s+(?!\s)(.*)$/;
/*
 * A list item that may also be a bare marker ("-", "1.") with nothing after
 * it -- an empty item, as CommonMark and marked read it. The serializer
 * writes one when the editor leaves an empty <li> (Enter at the end of a
 * nested bullet), and trimming the item's content drops the space after
 * the marker. Only used for the SECOND and later items of a list: a bare
 * marker cannot start a list, so a line reading "2021." on its own still
 * is not one.
 */
const RE_LIST_ITEM_OR_EMPTY: RegExp =
  /^(\s*)([-*+]|\d+\.)(?:\s+(?!\s)(.*)|\s*)$/;
const RE_ORDERED_MARKER: RegExp = /^\d+\./;
const RE_TASK_PREFIX: RegExp = /^\[[ xX]\]\s+/;
const RE_TASK_ITEM: RegExp = /^\[([ xX])\]\s+(?!\s)(.*)$/;
const RE_WHITESPACE_CHAR: RegExp = /\s/;
const RE_SHOWN_CHARACTER: RegExp = /\S/;
const RE_LIST_START: RegExp = /^\s*\d+\s*$/;
// A template variable, "{{incident.title}}", on one line and with no braces inside.
const RE_TEMPLATE_VARIABLE: RegExp = /\{\{[^{}\n]*\}\}/g;
// The line breaks a table cell's text is joined over.
const RE_LINE_BREAK_RUN: RegExp = /\n+/g;
const RE_LEADING_LINE_FEEDS: RegExp = /^\n+/;

/*
 * A small allowlist of inline HTML tags a person may have typed: "<u>",
 * "</sub>", "<br/>", "<kbd class=x>". One with white space after its name
 * runs to the next ">" - or, with no ">" after it, to the end of the text,
 * which is then left as it is (no later tag can end either). Looked for
 * alone, each "<u " of a run with no ">" after it was read on to the end of
 * the text again, in time that grew with the square of its length.
 */
const RE_ALLOWED_TAG_OR_UNCLOSED: RegExp =
  /<\/?(?:u|sub|sup|kbd|br)(?:\s[^>]*(?:>|$)|\/?>)/gi;

/*
 * "***a***", bold and italic at once - or, with no "***" after it that
 * closes it, the rest of the text, which is left as it is: a later "***"
 * cannot be closed either. Looked for alone, each "***" that closed nothing
 * was read on to the end of the text again.
 */
const RE_BOLD_ITALIC_OR_UNCLOSED: RegExp =
  /\*\*\*(?=\S)(?:([\s\S]*?\S)\*\*\*|[\s\S]*)/g;

const LINE_FEED: number = 0x0a;

const isLineFeedCode: (code: number) => boolean = (code: number): boolean => {
  return code === LINE_FEED;
};

// How many line feeds end `text`.
const lineFeedsAtEnd: (text: string) => number = (text: string): number => {
  let count: number = 0;

  while (
    count < text.length &&
    text.charCodeAt(text.length - 1 - count) === LINE_FEED
  ) {
    count++;
  }

  return count;
};

// A tab advances to the next multiple of four columns, as in CommonMark.
const TAB_WIDTH: number = 4;

/*
 * How deep list items may nest before the rest of an item is kept as plain
 * text. Each level parses its item's lines as a document of its own, so
 * without a cap a pathological line -- "- - - - …" a thousand levels deep --
 * overflowed the stack in the editor's mount effect, and a deep staircase of
 * indented bullets cost cubic time. Real documents rarely nest past three or
 * four levels.
 */
const MAX_LIST_NESTING_DEPTH: number = 20;

/*
 * What a task item's continuation lines are indented by. A task item's
 * content column is the one after its "- " bullet -- the "[ ]" box is part of
 * the content -- so a list nested under "- [ ] a" sits two spaces in, not six.
 * Six would put it four columns past the content column, where CommonMark
 * reads it as more paragraph text rather than a nested list.
 */
const TASK_ITEM_CONTENT_INDENT: number = "- ".length;

/*
 * How many empty cells a table's short rows are filled out with even when
 * that is more than the cells the table holds: a small table is always a
 * grid (tryParseTable).
 */
const TABLE_FILL_IN_ALLOWANCE: number = 100;

/*
 * How long a table written back with its columns lined up may be: within
 * TABLE_LINED_UP_ALWAYS_WITHIN characters, or within TABLE_LINED_UP_TIMES
 * the length of the table written plainly (tableToMarkdown).
 */
const TABLE_LINED_UP_ALWAYS_WITHIN: number = 64000;
const TABLE_LINED_UP_TIMES: number = 8;

interface InlineToken {
  html: string;
}

/*
 * `tokens` is shared with the calls this one makes for a link label or the
 * inside of an emphasis: that text can already hold placeholders stashed by
 * the outer call -- the inline code in "[**a** `b`](url)", the italic in
 * "~~*c*~~" -- and they are numbered in the outer call's list. A fresh list
 * per call resolved them against the wrong entries, so the label repeated
 * "a" instead of showing `b` and the strikethrough came back empty; and the
 * next save wrote that loss into the document.
 */
const renderInline: (raw: string, tokens?: Array<InlineToken>) => string = (
  raw: string,
  tokens: Array<InlineToken> = [],
): string => {
  const stash: (html: string) => string = (html: string): string => {
    tokens.push({ html });
    return `${PLACEHOLDER_OPEN}${tokens.length - 1}${PLACEHOLDER_CLOSE}`;
  };

  let s: string = raw;

  // Preserve a small allowlist of inline HTML tags users may have typed.
  s = s.replace(RE_ALLOWED_TAG_OR_UNCLOSED, (m: string): string => {
    // A tag that is not closed is the rest of the text, as it was.
    return m.endsWith(">") ? stash(m) : m;
  });

  // Inline code first — content is literal and not parsed further.
  s = s.replace(/`([^`\n]+)`/g, (_m: string, code: string): string => {
    return stash(`<code>${escapeText(code)}</code>`);
  });

  // Images.
  s = replaceLinkSpans(
    s,
    findImageSpans(s),
    (image: LinkSpan): string => {
      const titleAttr: string = image.title
        ? ` title="${escapeAttr(image.title)}"`
        : "";
      return stash(
        `<img alt="${escapeAttr(image.words)}" src="${escapeAttr(image.address)}"${titleAttr}>`,
      );
    },
  );

  // Links.
  s = replaceLinkSpans(s, findLinkSpans(s), (link: LinkSpan): string => {
    const titleAttr: string = link.title
      ? ` title="${escapeAttr(link.title)}"`
      : "";
    return stash(
      `<a href="${escapeAttr(link.address)}"${titleAttr}>${renderInline(link.words, tokens)}</a>`,
    );
  });

  /*
   * A template's {{variables}} are text, never formatting. An incident custom
   * field's key joins its words with underscores, and the italic pass below
   * read "{{incident.customFields.on_call_lead}}" as "on" + italic "call" +
   * "lead": the visual editor showed it slanted, and the next keystroke
   * saved it back as "{{incident.customFields.on*call*lead}}", a variable
   * nothing fills in. The same went for the text between two variables
   * with an underscore each. Kept as typed, as the viewer (CommonMark, where
   * an underscore inside a word is not emphasis) already shows them. Done
   * after links and images, whose addresses may hold a variable, and their
   * labels are rendered through here too.
   */
  s = s.replace(RE_TEMPLATE_VARIABLE, (variable: string): string => {
    return stash(escapeText(variable));
  });

  /*
   * Bold and italic at once. "***a***" is what the serializer writes for
   * <strong><em>a</em></strong> (text made bold and italic in the editor, or
   * pasted from Word or Google Docs), and the bold pass below would pair its
   * first "**" with the third star, rendering "<strong>*a</strong>*".
   */
  s = s.replace(
    RE_BOLD_ITALIC_OR_UNCLOSED,
    (m: string, inner: string | undefined): string => {
      // A "***" that nothing closes, and the rest of the text after it.
      if (inner === undefined) {
        return m;
      }
      return stash(`<em><strong>${renderInline(inner, tokens)}</strong></em>`);
    },
  );

  // Bold (** or __). Run before italic so single-star isn't consumed first.
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, (_m: string, inner: string): string => {
    return stash(`<strong>${renderInline(inner, tokens)}</strong>`);
  });
  s = s.replace(/__([\s\S]+?)__/g, (_m: string, inner: string): string => {
    return stash(`<strong>${renderInline(inner, tokens)}</strong>`);
  });

  // Italic (* or _).
  s = s.replace(
    /(^|[^*])\*([^*\n][^*\n]*?)\*(?!\*)/g,
    (_m: string, prefix: string, inner: string): string => {
      return `${prefix}${stash(`<em>${renderInline(inner, tokens)}</em>`)}`;
    },
  );
  s = s.replace(
    /(^|[^_])_([^_\n][^_\n]*?)_(?!_)/g,
    (_m: string, prefix: string, inner: string): string => {
      return `${prefix}${stash(`<em>${renderInline(inner, tokens)}</em>`)}`;
    },
  );

  // Strikethrough.
  s = s.replace(/~~([\s\S]+?)~~/g, (_m: string, inner: string): string => {
    return stash(`<s>${renderInline(inner, tokens)}</s>`);
  });

  // Final pass: escape remaining literal text, restore stashed HTML.
  const parts: Array<string> = s.split(
    new RegExp(`${PLACEHOLDER_OPEN}(\\d+)${PLACEHOLDER_CLOSE}`),
  );
  let out: string = "";
  for (let i: number = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      out += escapeText(parts[i] || "");
    } else {
      const idx: number = parseInt(parts[i] || "0", 10);
      out += tokens[idx]?.html || "";
    }
  }
  return out;
};

interface ParsedTableRow {
  cells: Array<string>;
}

// How many backslashes come right before `index` in `text`.
const backslashesBefore: (text: string, index: number) => number = (
  text: string,
  index: number,
): number => {
  let count: number = 0;

  while (index - count - 1 >= 0 && text[index - count - 1] === "\\") {
    count++;
  }

  return count;
};

/*
 * The cells of a table row, as GFM shows them. A "|" after an even number of
 * backslashes (none included) ends a cell, and the row's first and last such
 * "|" only frame it. Any other "|" is escaped and belongs to its cell: the
 * backslash that escapes it is taken out, and the backslashes before that
 * one are escaped backslashes, each pair of them one backslash of text. So
 * "\|" reads "|" and "\\\|" reads "\|", as a GFM reader shows them.
 * tableToMarkdown writes cells the other way round (tableCellMarkdown), so a
 * cell's text comes back as it was however many times the document is
 * opened and saved. One pass over the row.
 */
const splitTableRow: (line: string) => Array<string> = (
  line: string,
): Array<string> => {
  const row: string = line.trim();
  let start: number = 0;
  let end: number = row.length;

  if (row[0] === "|") {
    start = 1;
  }

  if (
    end > start &&
    row[end - 1] === "|" &&
    backslashesBefore(row, end - 1) % 2 === 0
  ) {
    end--;
  }

  const cells: Array<string> = [];
  let cell: string = "";
  // The run of backslashes just read, not yet added to the cell.
  let backslashes: number = 0;

  for (let index: number = start; index < end; index++) {
    const character: string = row[index]!;

    if (character === "\\") {
      backslashes++;
      continue;
    }

    if (character === "|") {
      if (backslashes % 2 === 0) {
        cells.push(`${cell}${"\\".repeat(backslashes)}`.trim());
        cell = "";
      } else {
        cell += `${"\\".repeat((backslashes - 1) / 2)}|`;
      }

      backslashes = 0;
      continue;
    }

    cell += `${"\\".repeat(backslashes)}${character}`;
    backslashes = 0;
  }

  cells.push(`${cell}${"\\".repeat(backslashes)}`.trim());

  return cells;
};

/*
 * A cell's text as tableToMarkdown writes it, for splitTableRow to read
 * back. A "|" gets a backslash, and so does each backslash right before it:
 * "a|b" is written "a\|b" and "C:\|D:" is written "C:\\\|D:". splitTableRow
 * takes those escapes out again, so the editor shows the cell as typed, and
 * a GFM reader - the dashboard's, GitHub's - keeps every "|" in its cell and
 * shows text as typed too: each escaped backslash reads as one. In a code
 * span GFM keeps backslashes as they are, so code holding "\|" shows one
 * backslash more there (none of the spellings that keep the "|" in its cell
 * shows it as typed in every reader). A line break becomes a space, as a
 * row is one line. A backslash that ends the text is left as it is: the row
 * writer puts a space after every cell, so it cannot escape the "|" that
 * ends it. One pass over the text.
 *
 * Not markdownTableCell, which every other table writer places Markdown
 * with: the editor's cell text is what its visual mode shows, backslashes
 * as typed, not Markdown whose escapes already mean something.
 */
const tableCellMarkdown: (text: string) => string = (text: string): string => {
  let written: string = "";
  // How many backslashes come right before the current character.
  let backslashes: number = 0;

  for (let index: number = 0; index < text.length; index++) {
    const character: string = text[index]!;

    if (character === "\\") {
      backslashes++;
      written += character;
      continue;
    }

    if (character === "|") {
      // The backslashes just written once more, and the escape of the "|".
      written += `${"\\".repeat(backslashes + 1)}|`;
      backslashes = 0;
      continue;
    }

    backslashes = 0;
    written += character === "\n" || character === "\r" ? " " : character;
  }

  return written;
};

const tryParseTable: (
  lines: Array<string>,
  start: number,
) => { html: string; consumed: number } | null = (
  lines: Array<string>,
  start: number,
): { html: string; consumed: number } | null => {
  const headerLine: string | undefined = lines[start];
  const sepLine: string | undefined = lines[start + 1];
  if (!headerLine || !sepLine) {
    return null;
  }
  if (!headerLine.includes("|")) {
    return null;
  }
  if (!sepLine.includes("|")) {
    return null;
  }
  if (!RE_TABLE_SEPARATOR.test(sepLine)) {
    return null;
  }

  const header: ParsedTableRow = { cells: splitTableRow(headerLine) };
  const body: Array<ParsedTableRow> = [];
  let i: number = start + 2;
  while (i < lines.length) {
    const line: string = lines[i] || "";
    if (line.trim() === "" || !line.includes("|")) {
      break;
    }
    body.push({ cells: splitTableRow(line) });
    i++;
  }

  /*
   * A row with fewer cells than the heading row is filled out with empty
   * cells, so that the table is a grid in the editor - unless that takes
   * more empty cells than the table's rows hold and more than
   * TABLE_FILL_IN_ALLOWANCE: then each row shows the cells it holds. A
   * heading row of thousands of cells over thousands of one-cell rows is a
   * few kilobytes of text, and filled out it was millions of cells - more
   * than the editor could open.
   */
  const columns: number = header.cells.length;
  let heldCells: number = columns;
  let fillInCells: number = 0;
  for (const row of body) {
    const held: number = Math.min(row.cells.length, columns);
    heldCells += held;
    fillInCells += columns - held;
  }
  const fillIn: boolean =
    fillInCells <= Math.max(heldCells, TABLE_FILL_IN_ALLOWANCE);

  let html: string = "<table><thead><tr>";
  for (const cell of header.cells) {
    html += `<th>${renderInline(cell)}</th>`;
  }
  html += "</tr></thead><tbody>";
  for (const row of body) {
    html += "<tr>";
    const cells: number = fillIn
      ? columns
      : Math.min(row.cells.length, columns);
    for (let c: number = 0; c < cells; c++) {
      html += `<td>${renderInline(row.cells[c] || "")}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table>";

  return { html, consumed: i - start };
};

// How many columns of whitespace a line starts with.
const leadingColumns: (line: string) => number = (line: string): number => {
  let columns: number = 0;
  for (const ch of line) {
    if (ch === "\t") {
      columns += TAB_WIDTH - (columns % TAB_WIDTH);
    } else if (RE_WHITESPACE_CHAR.test(ch)) {
      columns += 1;
    } else {
      break;
    }
  }
  return columns;
};

/*
 * Removes up to `columns` columns of leading whitespace. A tab that straddles
 * the cut is split, and the columns it covers past the cut are kept as
 * spaces, so a tab-indented nested list keeps its relative indentation.
 */
const stripColumns: (line: string, columns: number) => string = (
  line: string,
  columns: number,
): string => {
  let removed: number = 0;
  let idx: number = 0;
  while (idx < line.length && removed < columns) {
    const ch: string = line.charAt(idx);
    if (ch === "\t") {
      const width: number = TAB_WIDTH - (removed % TAB_WIDTH);
      if (removed + width > columns) {
        return `${" ".repeat(removed + width - columns)}${line.slice(idx + 1)}`;
      }
      removed += width;
    } else if (RE_WHITESPACE_CHAR.test(ch)) {
      removed += 1;
    } else {
      break;
    }
    idx++;
  }
  return line.slice(idx);
};

/*
 * Whether lines[index] opens a block of its own -- the same set of blocks
 * `markdownToHtml` checks before it falls back to a paragraph, so a list
 * item's text ends exactly where a top-level paragraph would.
 */
const startsBlock: (lines: Array<string>, index: number) => boolean = (
  lines: Array<string>,
  index: number,
): boolean => {
  const line: string = lines[index] || "";
  return (
    RE_FENCE_OPEN.test(line) ||
    RE_HORIZONTAL_RULE.test(line) ||
    readHeadingLine(line) !== null ||
    RE_BLOCKQUOTE_LINE.test(line) ||
    RE_LIST_ITEM.test(line) ||
    tryParseTable(lines, index) !== null
  );
};

interface ParsedListItem {
  // The text after the marker (and after the "[ ]" box of a task item).
  content: string;
  // null for a plain item; the box's state for a task item.
  checked: boolean | null;
  // The lines below the marker line that belong to the item, dedented to its content column.
  body: Array<string>;
}

/*
 * The inside of one <li>.
 *
 * The marker line and any plain lines straight after it are the item's own
 * text. They are joined with <br> and NOT wrapped in a <p>: a tight item is
 * bare text in the DOM, which is what `serializeListItems` expects back and
 * what a `<li>a<br>b</li>` produced by the editor has to turn into again.
 * The first line that opens a block -- a nested list above all -- and
 * everything after it is the item's nested content, and is parsed as a
 * document of its own. That is what lets a nested list hold another list.
 */
const renderListItemBody: (item: ParsedListItem, depth: number) => string = (
  item: ParsedListItem,
  depth: number,
): string => {
  const textLines: Array<string> =
    item.content.length > 0 ? [item.content] : [];

  // Past the nesting cap the rest of the item is text, not another level.
  if (depth >= MAX_LIST_NESTING_DEPTH) {
    /*
     * One line at a time: spread into push(), the lines of a long item were
     * each an argument, and past what a call takes the push threw.
     */
    for (const bodyLine of item.body) {
      textLines.push(bodyLine);
    }
    // Its line feeds come off its end read back from the end, once.
    return renderInline(
      withoutTrailingRun(textLines.join("\n"), isLineFeedCode),
    ).replace(/\n/g, "<br>");
  }

  let k: number = 0;
  while (
    k < item.body.length &&
    !RE_BLANK_LINE.test(item.body[k] || "") &&
    !startsBlock(item.body, k)
  ) {
    textLines.push(item.body[k] || "");
    k++;
  }

  let html: string = renderInline(textLines.join("\n")).replace(/\n/g, "<br>");

  const nested: Array<string> = item.body.slice(k);
  const hasNestedContent: boolean = nested.some((line: string): boolean => {
    return !RE_BLANK_LINE.test(line);
  });
  if (hasNestedContent) {
    html += renderMarkdownBlocks(nested.join("\n"), depth + 1);
  }

  return html;
};

/*
 * A list starting at lines[start], with whatever is nested inside its items.
 *
 * A line belongs to the current item when it is indented to at least the
 * item's content column -- the marker's indent, plus the marker, plus one
 * space: three columns under "1.", four under "10.", two under "-". That is
 * the CommonMark rule, and it is what AffectedResourceList (and marked, which
 * renders the same markdown into emails) relies on. Those lines are dedented
 * to the content column and handed back to `markdownToHtml` as the item's
 * nested content, so a nested list may be of either kind and nest again.
 *
 * Only a list line indented LESS than that is a sibling. A sibling with the
 * other kind of marker ends this list and starts a new one, as before; a
 * nested list of the other kind no longer does. Without this an ordered list
 * whose items each carried a bullet list of details came apart into a
 * one-item <ol> per item with the details as a detached <ul> after it, and
 * the next save numbered every item "1." and left its details stranded.
 *
 * Two more ways a line joins the item, both from CommonMark:
 *
 *   - a plain (non-list, non-block) line indented past the marker but short
 *     of the content column continues the item's text. This is what reads
 *     back a "1. a\n  b" written by the fixed two-space indent this file
 *     used to emit;
 *   - blank lines, when the next non-blank line is indented to the content
 *     column. Otherwise a blank line ends the list, as it always has.
 *
 * An ordered list whose first marker is not "1." carries it as start="N" so
 * that `serializeListItems` can number it the same way on the way back.
 */
const tryParseList: (
  lines: Array<string>,
  start: number,
  depth: number,
) => { html: string; consumed: number } | null = (
  lines: Array<string>,
  start: number,
  depth: number,
): { html: string; consumed: number } | null => {
  const firstMatch: RegExpMatchArray | null = (lines[start] || "").match(
    RE_LIST_ITEM,
  );
  if (!firstMatch) {
    return null;
  }
  const firstMarker: string = firstMatch[2] || "";
  const ordered: boolean = RE_ORDERED_MARKER.test(firstMarker);
  const taskList: boolean =
    !ordered && RE_TASK_PREFIX.test(firstMatch[3] || "");

  const items: Array<ParsedListItem> = [];
  let i: number = start;
  while (i < lines.length) {
    const m: RegExpMatchArray | null = (lines[i] || "").match(
      i === start ? RE_LIST_ITEM : RE_LIST_ITEM_OR_EMPTY,
    );
    if (!m) {
      break;
    }
    const marker: string = m[2] || "";
    if (RE_ORDERED_MARKER.test(marker) !== ordered) {
      break;
    }

    let content: string = m[3] || "";
    let checked: boolean | null = null;
    if (taskList) {
      const taskMatch: RegExpMatchArray | null = content.match(RE_TASK_ITEM);
      if (!taskMatch) {
        break;
      }
      content = taskMatch[2] || "";
      checked = (taskMatch[1] || "").toLowerCase() === "x";
    }

    const itemIndent: number = leadingColumns(m[1] || "");
    const contentColumn: number = itemIndent + marker.length + 1;
    const body: Array<string> = [];

    /*
     * An item that opens straight onto another marker ("1. - a") holds a
     * nested list and no text of its own. The serializer writes one of
     * these when an item's text has been deleted and only its nested list
     * is left, so it has to come back as a nested list, not as text.
     */
    if (!taskList && RE_LIST_ITEM.test(content)) {
      body.push(content);
      content = "";
    }

    i++;
    while (i < lines.length) {
      const next: string = lines[i] || "";

      if (RE_BLANK_LINE.test(next)) {
        let j: number = i;
        while (j < lines.length && RE_BLANK_LINE.test(lines[j] || "")) {
          j++;
        }
        if (
          j < lines.length &&
          leadingColumns(lines[j] || "") >= contentColumn
        ) {
          while (i < j) {
            body.push("");
            i++;
          }
          continue;
        }
        break;
      }

      const nextIndent: number = leadingColumns(next);
      const isNested: boolean = nextIndent >= contentColumn;
      const isContinuation: boolean =
        !isNested && nextIndent > itemIndent && !startsBlock(lines, i);
      if (!isNested && !isContinuation) {
        break;
      }
      body.push(stripColumns(next, contentColumn));
      i++;
    }

    items.push({ content, checked, body });
  }

  if (items.length === 0) {
    return null;
  }

  const listTag: string = ordered ? "ol" : "ul";
  const classAttr: string = taskList ? ' class="task-list"' : "";
  const startNumber: number = ordered ? parseInt(firstMarker, 10) : 1;
  const startAttr: string =
    ordered && startNumber !== 1 ? ` start="${startNumber}"` : "";

  let html: string = `<${listTag}${classAttr}${startAttr}>`;
  for (const item of items) {
    const inner: string = renderListItemBody(item, depth);
    if (item.checked === null) {
      html += `<li>${inner}</li>`;
    } else {
      const checkedAttr: string = item.checked ? " checked" : "";
      // Accessible name for the checkbox derived from its label (WCAG 4.1.2).
      const ariaLabel: string = escapeAttr(item.content.trim()) || "Task item";
      html += `<li class="task-list-item"><input type="checkbox" disabled${checkedAttr} aria-label="${ariaLabel}"> ${inner}</li>`;
    }
  }
  html += `</${listTag}>`;

  return { html, consumed: i - start };
};

export const markdownToHtml: (md: string) => string = (md: string): string => {
  return renderMarkdownBlocks(md, 0);
};

/*
 * `markdownToHtml` for a document nested `depth` list items deep -- a list
 * item's nested content is parsed as a document of its own.
 */
const renderMarkdownBlocks: (md: string, depth: number) => string = (
  md: string,
  depth: number,
): string => {
  if (!md) {
    return "";
  }

  // Normalise line endings.
  const text: string = md.replace(/\r\n?/g, "\n");
  const lines: Array<string> = text.split("\n");

  let out: string = "";
  let i: number = 0;
  let paragraph: Array<string> = [];

  const flushParagraph: () => void = (): void => {
    if (paragraph.length === 0) {
      return;
    }
    const joined: string = paragraph.join("\n");
    out += `<p>${renderInline(joined).replace(/\n/g, "<br>")}</p>`;
    paragraph = [];
  };

  while (i < lines.length) {
    const line: string = lines[i] || "";

    // Blank line ends current paragraph.
    if (RE_BLANK_LINE.test(line)) {
      flushParagraph();
      i++;
      continue;
    }

    // Fenced code block.
    const fenceMatch: RegExpMatchArray | null = line.match(RE_FENCE_OPEN);
    if (fenceMatch) {
      flushParagraph();
      const lang: string = fenceMatch[1] || "";
      i++;
      const codeLines: Array<string> = [];
      while (i < lines.length && !RE_FENCE_CLOSE.test(lines[i] || "")) {
        codeLines.push(lines[i] || "");
        i++;
      }
      // Skip closing fence if present.
      if (i < lines.length) {
        i++;
      }
      const langAttr: string = lang
        ? ` class="language-${escapeAttr(lang)}"`
        : "";
      out += `<pre><code${langAttr}>${escapeText(codeLines.join("\n"))}</code></pre>`;
      continue;
    }

    // Horizontal rule.
    if (RE_HORIZONTAL_RULE.test(line)) {
      flushParagraph();
      out += "<hr>";
      i++;
      continue;
    }

    // Heading.
    const heading: HeadingLine | null = readHeadingLine(line);
    if (heading) {
      flushParagraph();
      out += `<h${heading.level}>${renderInline(heading.text)}</h${heading.level}>`;
      i++;
      continue;
    }

    // Blockquote (consume contiguous > lines).
    if (RE_BLOCKQUOTE_LINE.test(line)) {
      flushParagraph();
      const quoteLines: Array<string> = [];
      while (i < lines.length && RE_BLOCKQUOTE_LINE.test(lines[i] || "")) {
        quoteLines.push((lines[i] || "").replace(/^\s*>\s?/, ""));
        i++;
      }
      out += `<blockquote><p>${renderInline(quoteLines.join("\n")).replace(/\n/g, "<br>")}</p></blockquote>`;
      continue;
    }

    // Lists (unordered, ordered, task), with anything nested in their items.
    const listResult: { html: string; consumed: number } | null = tryParseList(
      lines,
      i,
      depth,
    );
    if (listResult) {
      flushParagraph();
      out += listResult.html;
      i += listResult.consumed;
      continue;
    }

    // Table.
    const tableResult: { html: string; consumed: number } | null =
      tryParseTable(lines, i);
    if (tableResult) {
      flushParagraph();
      out += tableResult.html;
      i += tableResult.consumed;
      continue;
    }

    // Default: accumulate paragraph.
    paragraph.push(line);
    i++;
  }

  flushParagraph();
  return out;
};

const collapseBlankLines: (s: string) => string = (s: string): string => {
  return s.replace(/\n{3,}/g, "\n\n");
};

/*
 * A <div> is a line of its own. Chromium leaves the first line typed into an
 * empty editor as bare text and puts each line after it in a <div>, and the
 * <div> only writes the line break after itself -- so "abc", Enter, "def"
 * saved as "abcdef". Text still open before a <div> ends its line first.
 */
const isDivNode: (node: Node) => boolean = (node: Node): boolean => {
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    (node as HTMLElement).tagName.toLowerCase() === "div"
  );
};

/*
 * Each child in turn, from its first to its last sibling: an index into a
 * live list of children can be read again from its start for each child.
 *
 * Whether the text written so far ends its line is asked of the last part
 * written, never of the text itself: a string built with += is copied into
 * one piece each time it is asked anything, and a note typed line by line --
 * a <div> a line -- took time that grew with the square of its length to
 * save.
 */
const serializeChildren: (node: Node) => string = (node: Node): string => {
  let out: string = "";
  // The last part written that was not empty: what `out` ends with.
  let lastPart: string = "";
  for (
    let child: ChildNode | null = node.firstChild;
    child;
    child = child.nextSibling
  ) {
    if (isDivNode(child) && out.length > 0 && !lastPart.endsWith("\n")) {
      out += "\n";
      lastPart = "\n";
    }
    const part: string = serializeNode(child);
    if (part.length > 0) {
      out += part;
      lastPart = part;
    }
  }
  return out;
};

const serializeInline: (node: Node) => string = (node: Node): string => {
  // Same as serializeNode but caller knows context is inline (no extra newlines).
  return serializeNode(node);
};

/*
 * The number an ordered list starts at. `markdownToHtml` records a first
 * marker other than "1." as start="N"; without reading it back, a list that
 * the document had split in two ("1. a" ... "2. b") would come back
 * numbered "1." twice.
 */
const listStartNumber: (list: HTMLElement) => number = (
  list: HTMLElement,
): number => {
  const raw: string | null = list.getAttribute("start");
  if (raw === null || !RE_LIST_START.test(raw)) {
    return 1;
  }
  return parseInt(raw, 10);
};

// Blocks that are separated from an item's own text by a blank line.
const LIST_ITEM_BLOCK_TAGS: Set<string> = new Set<string>([
  "p",
  "pre",
  "blockquote",
  "table",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

/*
 * An item's children, serialized. A block that follows the item's own text
 * -- the second paragraph of a loose item, a code block -- is separated
 * from it by a blank line. `serializeNode` opens a <p> with a single
 * newline, which straight after text reads as more of the same paragraph:
 * "1. a\n\n   b" came back as "1. a\n   b", marked then rendered the item
 * as the one paragraph "a b", and every save lost another break. Nested
 * lists are not blocks here -- they stay tight under the item's text.
 *
 * The parts are kept apart until the end, with what each block asks of the
 * text before it -- whether it shows anything, how many line feeds end it --
 * counted as each part is written, and the line feeds that end it taken off
 * the parts they are in. Asked of the text itself, each block copied all of
 * it into one piece, and an item holding a block after each line of text
 * took time that grew with the square of its length.
 */
const serializeListItemChildren: (li: HTMLElement) => string = (
  li: HTMLElement,
): string => {
  const parts: Array<string> = [];
  let length: number = 0;
  // Whether what is written shows anything: whether it trims to "" or not.
  let showsText: boolean = false;
  // How many line feeds end what is written.
  let trailingLineFeeds: number = 0;

  const write: (part: string) => void = (part: string): void => {
    if (part.length === 0) {
      return;
    }
    parts.push(part);
    length += part.length;
    if (!showsText && RE_SHOWN_CHARACTER.test(part)) {
      showsText = true;
    }
    const lineFeeds: number = lineFeedsAtEnd(part);
    trailingLineFeeds =
      lineFeeds === part.length ? trailingLineFeeds + lineFeeds : lineFeeds;
  };

  // What /\n*$/ matched, taken off the parts it is in.
  const takeOffTrailingLineFeeds: () => void = (): void => {
    while (trailingLineFeeds > 0) {
      const last: string = parts[parts.length - 1] || "";
      if (last.length <= trailingLineFeeds) {
        parts.pop();
        length -= last.length;
        trailingLineFeeds -= last.length;
      } else {
        parts[parts.length - 1] = last.slice(
          0,
          last.length - trailingLineFeeds,
        );
        length -= trailingLineFeeds;
        trailingLineFeeds = 0;
      }
    }
  };

  for (
    let child: ChildNode | null = li.firstChild;
    child;
    child = child.nextSibling
  ) {
    let part: string = serializeNode(child);
    const isBlock: boolean =
      child.nodeType === Node.ELEMENT_NODE &&
      LIST_ITEM_BLOCK_TAGS.has((child as HTMLElement).tagName.toLowerCase());
    if (isBlock && showsText && trailingLineFeeds < 2) {
      takeOffTrailingLineFeeds();
      write("\n\n");
      part = part.replace(RE_LEADING_LINE_FEEDS, "");
    }
    if (isDivNode(child) && length > 0 && trailingLineFeeds === 0) {
      write("\n");
    }
    write(part);
  }
  return parts.join("");
};

/*
 * Each item's continuation lines -- a <br>, a nested list, a nested table --
 * are indented by the width of the item's own marker: two spaces under "- ",
 * three under "1. ", four under "10. ". That is the item's content column,
 * so the parser (and marked) keeps them inside the item; a fixed two spaces
 * left everything under "1." and "10." outside it.
 *
 * A nested list comes back from `serializeNode` wrapped in single newlines,
 * which the trim below drops, so it sits directly under the item's text with
 * no blank line either side: the item stays tight and nothing between the
 * items reads as a paragraph break. Blank lines inside the content are left
 * unindented rather than padded with trailing spaces.
 */
const serializeListItems: (list: HTMLElement, ordered: boolean) => string = (
  list: HTMLElement,
  ordered: boolean,
): string => {
  let out: string = "";
  let n: number = ordered ? listStartNumber(list) : 1;
  // Each item in turn, from sibling to sibling (as serializeChildren).
  for (
    let child: Element | null = list.firstElementChild;
    child;
    child = child.nextElementSibling
  ) {
    if (child.tagName.toLowerCase() !== "li") {
      continue;
    }
    const li: HTMLElement = child as HTMLElement;
    const checkbox: HTMLInputElement | null = li.querySelector(
      ":scope > input[type='checkbox']",
    ) as HTMLInputElement | null;
    let prefix: string;
    let contentIndent: number;
    let content: string;
    if (checkbox) {
      prefix = checkbox.checked ? "- [x] " : "- [ ] ";
      contentIndent = TASK_ITEM_CONTENT_INDENT;
      const clone: HTMLElement = li.cloneNode(true) as HTMLElement;
      const cbClone: Element | null = clone.querySelector(
        ":scope > input[type='checkbox']",
      );
      if (cbClone) {
        cbClone.remove();
      }
      content = serializeListItemChildren(clone).trim();
    } else if (ordered) {
      prefix = `${n}. `;
      contentIndent = prefix.length;
      content = serializeListItemChildren(li).trim();
      n++;
    } else {
      prefix = "- ";
      contentIndent = prefix.length;
      content = serializeListItemChildren(li).trim();
    }
    // Indent any continuation lines so they remain part of the item.
    const indent: string = " ".repeat(contentIndent);
    const indented: string = content
      .split("\n")
      .map((l: string, idx: number): string => {
        if (idx === 0) {
          return l;
        }
        return RE_BLANK_LINE.test(l) ? "" : `${indent}${l}`;
      })
      .join("\n");
    out += `${prefix}${indented}\n`;
  }
  return out;
};

interface TableLengths {
  // What tableToMarkdown writes lined up: every row padded to every column.
  linedUp: number;
  // What plainTable writes.
  plain: number;
}

// "| " before a row's cells, " | " between them, " |" and a line feed after.
const tableRowFrameLength: (cells: number) => number = (
  cells: number,
): number => {
  return 2 + 3 * Math.max(cells - 1, 0) + 2 + 1;
};

/*
 * How long a table is written each way, counted without writing it. A row
 * costs the cells it holds: the columns after its last cell are counted
 * together (widthsFrom), so a row short of thousands of columns costs no
 * more than its own cells.
 */
const tableLengths: (
  header: Array<string>,
  body: Array<Array<string>>,
  widths: Array<number>,
) => TableLengths = (
  header: Array<string>,
  body: Array<Array<string>>,
  widths: Array<number>,
): TableLengths => {
  const columns: number = widths.length;
  // The widths of column c and every column after it, added up.
  const widthsFrom: Array<number> = new Array<number>(columns + 1).fill(0);
  for (let c: number = columns - 1; c >= 0; c--) {
    widthsFrom[c] = (widthsFrom[c + 1] || 0) + (widths[c] || 0);
  }

  // The line feed before the table and the one after it, and its dashes.
  let linedUp: number =
    2 + tableRowFrameLength(columns) + (widthsFrom[0] || 0);
  let plain: number = 2 + tableRowFrameLength(columns) + 3 * columns;

  // The heading row, which plainTable writes with a cell for every column.
  for (let c: number = 0; c < Math.min(header.length, columns); c++) {
    plain += (header[c] || "").length;
  }

  for (const cells of [header, ...body]) {
    const held: number = Math.min(cells.length, columns);
    linedUp += tableRowFrameLength(columns) + (widthsFrom[held] || 0);
    for (let c: number = 0; c < held; c++) {
      linedUp += Math.max((cells[c] || "").length, widths[c] || 0);
    }
  }

  for (const cells of body) {
    plain += tableRowFrameLength(cells.length);
    for (const cell of cells) {
      plain += cell.length;
    }
  }

  return { linedUp: linedUp, plain: plain };
};

/*
 * A table written plainly, for one that lined up would be many times longer
 * than what it holds (tableToMarkdown): each cell as it is, three dashes
 * under each heading, and each row with the cells it holds. The heading row
 * has a cell for every column, so a cell a row holds past the heading
 * row's last is still under a heading when the table is read back.
 */
const plainTable: (
  header: Array<string>,
  body: Array<Array<string>>,
  columns: number,
) => string = (
  header: Array<string>,
  body: Array<Array<string>>,
  columns: number,
): string => {
  const headings: Array<string> = [];
  const dashes: Array<string> = [];
  for (let c: number = 0; c < columns; c++) {
    headings.push(header[c] || "");
    dashes.push("---");
  }

  let out: string = "\n";
  out += `| ${headings.join(" | ")} |\n`;
  out += `| ${dashes.join(" | ")} |\n`;
  for (const row of body) {
    out += `| ${row.join(" | ")} |\n`;
  }
  out += "\n";
  return out;
};

const tableToMarkdown: (table: HTMLTableElement) => string = (
  table: HTMLTableElement,
): string => {
  const rows: Array<HTMLTableRowElement> = Array.from(
    table.querySelectorAll("tr"),
  );
  if (rows.length === 0) {
    return "";
  }

  /*
   * A cell's text on one line, written with tableCellMarkdown: every "|"
   * stays in its cell, whatever backslashes come before it, and
   * splitTableRow reads the text back as it was.
   */
  const cellText: (cell: Element) => string = (cell: Element): string => {
    return tableCellMarkdown(
      serializeChildren(cell).replace(RE_LINE_BREAK_RUN, " ").trim(),
    );
  };

  let header: Array<string> = [];
  const body: Array<Array<string>> = [];

  rows.forEach((tr: HTMLTableRowElement, rowIdx: number) => {
    // The row's cells, from sibling to sibling (as serializeChildren).
    const texts: Array<string> = [];
    for (
      let cell: Element | null = tr.firstElementChild;
      cell;
      cell = cell.nextElementSibling
    ) {
      texts.push(cellText(cell));
    }
    if (rowIdx === 0) {
      header = texts;
    } else {
      body.push(texts);
    }
  });

  if (header.length === 0) {
    return "";
  }

  const widths: Array<number> = header.map((h: string): number => {
    return Math.max(3, h.length);
  });
  for (const row of body) {
    for (let c: number = 0; c < row.length; c++) {
      const len: number = (row[c] || "").length;
      if (len > (widths[c] || 0)) {
        widths[c] = len;
      }
    }
  }

  /*
   * Lined up, every row is padded out to every column's widest cell: a
   * table of a few thousand rows with one long cell, or a heading row of
   * thousands of columns over thousands of short rows, came out hundreds of
   * megabytes long - written again for every keystroke - and past the
   * longest string a browser holds, the editor could not save at all. Such
   * a table is written plainly; any other is lined up as it always was.
   */
  const lengths: TableLengths = tableLengths(header, body, widths);
  if (
    lengths.linedUp >
    Math.max(TABLE_LINED_UP_TIMES * lengths.plain, TABLE_LINED_UP_ALWAYS_WITHIN)
  ) {
    return plainTable(header, body, widths.length);
  }

  const fmtRow: (cells: Array<string>) => string = (
    cells: Array<string>,
  ): string => {
    const padded: Array<string> = [];
    for (let c: number = 0; c < widths.length; c++) {
      padded.push((cells[c] || "").padEnd(widths[c] || 0));
    }
    return `| ${padded.join(" | ")} |`;
  };
  const sep: string = `| ${widths
    .map((w: number): string => {
      return "-".repeat(w);
    })
    .join(" | ")} |`;

  let out: string = "\n";
  out += `${fmtRow(header)}\n`;
  out += `${sep}\n`;
  for (const row of body) {
    out += `${fmtRow(row)}\n`;
  }
  out += "\n";
  return out;
};

const serializeNode: (node: Node) => string = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }
  const el: HTMLElement = node as HTMLElement;
  const tag: string = el.tagName.toLowerCase();

  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level: number = parseInt(tag.slice(1), 10);
      return `\n${"#".repeat(level)} ${serializeChildren(el).trim()}\n\n`;
    }
    case "strong":
    case "b":
      return `**${serializeChildren(el)}**`;
    case "em":
    case "i":
      return `*${serializeChildren(el)}*`;
    case "s":
    case "del":
    case "strike":
      return `~~${serializeChildren(el)}~~`;
    case "u":
      return `<u>${serializeChildren(el)}</u>`;
    case "sub":
    case "sup":
    case "kbd":
      return `<${tag}>${serializeChildren(el)}</${tag}>`;
    case "code": {
      const parent: HTMLElement | null = el.parentElement;
      if (parent && parent.tagName.toLowerCase() === "pre") {
        // Handled by <pre>.
        return el.textContent || "";
      }
      return `\`${el.textContent || ""}\``;
    }
    case "pre": {
      const codeEl: HTMLElement | null = el.querySelector("code");
      let lang: string = "";
      if (codeEl) {
        const cls: string = codeEl.className || "";
        const m: RegExpMatchArray | null = cls.match(/language-([\w-]+)/);
        if (m) {
          lang = m[1] || "";
        }
      }
      const text: string = (codeEl || el).textContent || "";
      // The line feeds that end the code, read back from its end once.
      const trimmed: string = withoutTrailingRun(text, isLineFeedCode);
      return `\n\`\`\`${lang}\n${trimmed}\n\`\`\`\n\n`;
    }
    case "blockquote": {
      const inner: string = serializeChildren(el).trim();
      const lines: Array<string> = inner.split("\n");
      return `\n${lines
        .map((l: string): string => {
          return `> ${l}`;
        })
        .join("\n")}\n\n`;
    }
    case "hr":
      return "\n---\n\n";
    case "br":
      return "\n";
    case "p":
      return `\n${serializeChildren(el)}\n\n`;
    case "div":
      return `${serializeChildren(el)}\n`;
    case "ul":
      return `\n${serializeListItems(el, false)}\n`;
    case "ol":
      return `\n${serializeListItems(el, true)}\n`;
    case "li":
      // li reached outside ul/ol context.
      return `- ${serializeChildren(el)}\n`;
    case "a": {
      const href: string = (el as HTMLAnchorElement).getAttribute("href") || "";
      const label: string = serializeChildren(el) || href;
      if (!href) {
        return label;
      }
      return `[${label}](${href})`;
    }
    case "img": {
      const alt: string = (el as HTMLImageElement).getAttribute("alt") || "";
      const src: string = (el as HTMLImageElement).getAttribute("src") || "";
      const title: string | null = (el as HTMLImageElement).getAttribute(
        "title",
      );
      return `![${alt}](${src}${title ? ` "${title}"` : ""})`;
    }
    case "table":
      return tableToMarkdown(el as HTMLTableElement);
    case "thead":
    case "tbody":
    case "tfoot":
    case "tr":
    case "th":
    case "td":
    case "caption":
    case "colgroup":
    case "col":
      // Handled inside tableToMarkdown; if reached standalone, just children.
      return serializeChildren(el);
    case "input": {
      // Bare checkbox outside an li: drop it.
      if ((el as HTMLInputElement).type === "checkbox") {
        return "";
      }
      return serializeChildren(el);
    }
    default:
      return serializeChildren(el);
  }
};

/*
 * Markdown for the children of a DOM node that is already parsed. The paste
 * handler cleans clipboard HTML as a DOM tree and hands the result straight
 * here, rather than turning it back into a string to be parsed again.
 */
export const domToMarkdown: (root: Node) => string = (root: Node): string => {
  const raw: string = serializeChildren(root);
  /*
   * String.prototype.trimEnd, not /\s+$/: the pattern tried every start in a
   * long run of spaces that something else follows - the padding a long
   * cell gives its column - so a table with a long cell took time in the
   * square of its length to save.
   */
  return collapseBlankLines(raw.trimEnd()).replace(/^\n+/, "");
};

export const htmlToMarkdown: (html: string) => string = (
  html: string,
): string => {
  if (!html) {
    return "";
  }
  if (typeof document === "undefined") {
    return html;
  }
  /*
   * Parsed into a <template>, whose content is inert: nothing in it loads or
   * runs. A detached <div> is not -- Chromium runs the onerror handler of an
   * <img> set through a detached element's innerHTML -- and not every caller
   * hands this function HTML the editor produced itself.
   */
  const template: HTMLTemplateElement = document.createElement("template");
  template.innerHTML = html;
  return domToMarkdown(template.content);
};

// Re-export for callers that want to use the inline serializer directly.
export const __testing: {
  renderInline: (raw: string) => string;
  serializeNode: (node: Node) => string;
} = {
  renderInline,
  serializeNode: serializeInline,
};
