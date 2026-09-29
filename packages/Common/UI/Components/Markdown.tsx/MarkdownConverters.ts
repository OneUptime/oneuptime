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
 */

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
 */
const RE_TABLE_SEPARATOR: RegExp =
  /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const RE_BLANK_LINE: RegExp = /^\s*$/;
const RE_FENCE_OPEN: RegExp = /^\s*```\s*([\w-]*)\s*$/;
const RE_FENCE_CLOSE: RegExp = /^\s*```\s*$/;
const RE_HORIZONTAL_RULE: RegExp = /^\s*(---+|\*\*\*+|___+)\s*$/;
const RE_HEADING: RegExp = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_BLOCKQUOTE_LINE: RegExp = /^\s*>/;
const RE_LIST_ITEM: RegExp = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
/*
 * A list item that may also be a bare marker ("-", "1.") with nothing after
 * it -- an empty item, as CommonMark and marked read it. The serializer
 * writes one when the editor leaves an empty <li> (Enter at the end of a
 * nested bullet), and trimming the item's content drops the space after
 * the marker. Only used for the SECOND and later items of a list: a bare
 * marker cannot start a list, so a line reading "2021." on its own still
 * is not one.
 */
const RE_LIST_ITEM_OR_EMPTY: RegExp = /^(\s*)([-*+]|\d+\.)(?:\s+(.*)|\s*)$/;
const RE_ORDERED_MARKER: RegExp = /^\d+\./;
const RE_TASK_PREFIX: RegExp = /^\[[ xX]\]\s+/;
const RE_TASK_ITEM: RegExp = /^\[([ xX])\]\s+(.*)$/;
const RE_WHITESPACE_CHAR: RegExp = /\s/;
const RE_LIST_START: RegExp = /^\s*\d+\s*$/;

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
  s = s.replace(
    /<\/?(?:u|sub|sup|kbd|br)(?:\s[^>]*)?\/?>/gi,
    (m: string): string => {
      return stash(m);
    },
  );

  // Inline code first — content is literal and not parsed further.
  s = s.replace(/`([^`\n]+)`/g, (_m: string, code: string): string => {
    return stash(`<code>${escapeText(code)}</code>`);
  });

  // Images.
  s = s.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_m: string, alt: string, url: string, title?: string): string => {
      const titleAttr: string = title ? ` title="${escapeAttr(title)}"` : "";
      return stash(
        `<img alt="${escapeAttr(alt)}" src="${escapeAttr(url)}"${titleAttr}>`,
      );
    },
  );

  // Links.
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_m: string, label: string, url: string, title?: string): string => {
      const titleAttr: string = title ? ` title="${escapeAttr(title)}"` : "";
      return stash(
        `<a href="${escapeAttr(url)}"${titleAttr}>${renderInline(label, tokens)}</a>`,
      );
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

  const splitRow: (line: string) => Array<string> = (
    line: string,
  ): Array<string> => {
    const trimmed: string = line.trim().replace(/^\||\|$/g, "");
    return trimmed.split("|").map((c: string): string => {
      return c.trim();
    });
  };

  const header: ParsedTableRow = { cells: splitRow(headerLine) };
  const body: Array<ParsedTableRow> = [];
  let i: number = start + 2;
  while (i < lines.length) {
    const line: string = lines[i] || "";
    if (line.trim() === "" || !line.includes("|")) {
      break;
    }
    body.push({ cells: splitRow(line) });
    i++;
  }

  let html: string = "<table><thead><tr>";
  for (const cell of header.cells) {
    html += `<th>${renderInline(cell)}</th>`;
  }
  html += "</tr></thead><tbody>";
  for (const row of body) {
    html += "<tr>";
    for (let c: number = 0; c < header.cells.length; c++) {
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
    RE_HEADING.test(line) ||
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
    textLines.push(...item.body);
    return renderInline(textLines.join("\n").replace(/\n+$/, "")).replace(
      /\n/g,
      "<br>",
    );
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
    const headingMatch: RegExpMatchArray | null = line.match(RE_HEADING);
    if (headingMatch) {
      flushParagraph();
      const level: number = (headingMatch[1] || "#").length;
      const content: string = headingMatch[2] || "";
      out += `<h${level}>${renderInline(content)}</h${level}>`;
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

const trimEnd: (s: string) => string = (s: string): string => {
  return s.replace(/\s+$/, "");
};

const collapseBlankLines: (s: string) => string = (s: string): string => {
  return s.replace(/\n{3,}/g, "\n\n");
};

const serializeChildren: (node: Node) => string = (node: Node): string => {
  let out: string = "";
  for (let i: number = 0; i < node.childNodes.length; i++) {
    const child: ChildNode | undefined = node.childNodes[i] as
      | ChildNode
      | undefined;
    if (!child) {
      continue;
    }
    out += serializeNode(child);
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
 */
const serializeListItemChildren: (li: HTMLElement) => string = (
  li: HTMLElement,
): string => {
  let out: string = "";
  for (let i: number = 0; i < li.childNodes.length; i++) {
    const child: ChildNode | undefined = li.childNodes[i] as
      | ChildNode
      | undefined;
    if (!child) {
      continue;
    }
    let part: string = serializeNode(child);
    const isBlock: boolean =
      child.nodeType === Node.ELEMENT_NODE &&
      LIST_ITEM_BLOCK_TAGS.has((child as HTMLElement).tagName.toLowerCase());
    if (isBlock && out.trim().length > 0 && !out.endsWith("\n\n")) {
      out = out.replace(/\n*$/, "\n\n");
      part = part.replace(/^\n+/, "");
    }
    out += part;
  }
  return out;
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
  for (let i: number = 0; i < list.children.length; i++) {
    const child: Element | null = list.children[i] || null;
    if (!child || child.tagName.toLowerCase() !== "li") {
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

const tableToMarkdown: (table: HTMLTableElement) => string = (
  table: HTMLTableElement,
): string => {
  const rows: Array<HTMLTableRowElement> = Array.from(
    table.querySelectorAll("tr"),
  );
  if (rows.length === 0) {
    return "";
  }

  const cellText: (cell: Element) => string = (cell: Element): string => {
    return serializeChildren(cell)
      .replace(/\|/g, "\\|")
      .replace(/\n+/g, " ")
      .trim();
  };

  let header: Array<string> = [];
  const body: Array<Array<string>> = [];

  rows.forEach((tr: HTMLTableRowElement, rowIdx: number) => {
    const cells: Array<Element> = Array.from(tr.children);
    const texts: Array<string> = cells.map(cellText);
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
      const trimmed: string = text.replace(/\n+$/, "");
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
  return collapseBlankLines(trimEnd(raw)).replace(/^\n+/, "");
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
