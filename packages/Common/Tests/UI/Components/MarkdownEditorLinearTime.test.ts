import {
  __testing,
  domToMarkdown,
  htmlToMarkdown,
  markdownToHtml,
} from "../../../UI/Components/Markdown.tsx/MarkdownConverters";
import {
  indentMarkdownLines,
  isInFencedCodeBlock,
  TAB_ONLY_BULLET_GLYPHS,
  TEXT_BULLET_GLYPHS,
} from "../../../UI/Components/Markdown.tsx/MarkdownListEditing";
import { normalizePlainTextListMarkers } from "../../../UI/Components/Markdown.tsx/MarkdownPaste";
import { insertBlocksAtCaret } from "../../../UI/Components/Markdown.tsx/MarkdownVisualEditing";
import { fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { namedPattern } from "../../Helpers/SourcePatterns";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * THE MARKDOWN EDITOR READS AND WRITES A NOTE IN TIME IN LINE WITH ITS
 * LENGTH, WITH THE SAME MARKDOWN AND HTML AS BEFORE.
 *
 * The editor opens a note, a description, a postmortem or a status page's
 * text by turning its markdown into HTML (markdownToHtml), and turns the
 * HTML back into markdown on every keystroke (htmlToMarkdown). The text is
 * whatever whoever wrote it wrote - a member, an integration, a workflow -
 * and it is read in the browser of everyone who edits it.
 *
 * Several of its patterns were tried again from every place a match could
 * start, and each try read on to the end of a run of white space, a line
 * or the text: a table's delimiter row, a fence line, a list item with a
 * line separator in it, an inline tag, an image, a link, a "***", the line
 * feeds that end a list item or a code block. The way back asked the
 * markdown written so far whether it ends a line or shows anything, which
 * copied all of it each time; and a table was written out to every column
 * of every row, which a wide heading row over many short rows, or one long
 * cell over many rows, made millions of cells or hundreds of megabytes.
 * And the list editing, paste and block insertion helpers read the lines
 * they are given with the same shapes.
 *
 * These tests hold each of them to two things: the texts that were slow
 * are read in well under two seconds, at 400,000 characters; and what is
 * read is exactly what was - each rewritten pattern against the pattern it
 * replaced, on drawn texts, and the serializer against its loops as they
 * were. A table is laid out as before unless that makes it many times
 * larger than what it holds.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const CONVERTERS_FILE: string =
  "packages/Common/UI/Components/Markdown.tsx/MarkdownConverters.ts";
const LIST_EDITING_FILE: string =
  "packages/Common/UI/Components/Markdown.tsx/MarkdownListEditing.ts";
const PASTE_FILE: string =
  "packages/Common/UI/Components/Markdown.tsx/MarkdownPaste.ts";

const LINE_SEPARATOR: string = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR: string = String.fromCharCode(0x2029);
const NO_BREAK_SPACE: string = String.fromCharCode(0x00a0);

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

// `unit` written `count` times over: whole elements, never one cut short.
const times: (unit: string, count: number) => string = (
  unit: string,
  count: number,
): string => {
  return unit.repeat(Math.floor(count));
};

/*
 * How long the work takes: the fastest of up to three attempts, counted as
 * it would have run on a usual runner when every attempt overran on a slow
 * one (Tests/Helpers/FastestRun).
 */
const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {
  return fastestRun({ run: run, limitInMs: 2000 }).inMs;
};

const matchOf: (
  text: string,
  pattern: RegExp,
) => Array<string | undefined> | null = (
  text: string,
  pattern: RegExp,
): Array<string | undefined> | null => {
  const match: RegExpMatchArray | null = text.match(pattern);

  return match ? Array.from(match) : null;
};

// A document fragment of `html`, parsed the way htmlToMarkdown parses it.
const fragmentOf: (html: string) => DocumentFragment = (
  html: string,
): DocumentFragment => {
  const template: HTMLTemplateElement = document.createElement("template");
  template.innerHTML = html;
  return template.content;
};

/*
 * ---------------------------------------------------------------------------
 * The patterns as they were: the references the product's patterns must
 * agree with. The product's are read from its source by name.
 * ---------------------------------------------------------------------------
 */
const TABLE_SEPARATOR_BEFORE: RegExp =
  /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const FENCE_OPEN_BEFORE: RegExp = /^\s*```\s*([\w-]*)\s*$/;
const LIST_ITEM_BEFORE: RegExp = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
const LIST_ITEM_OR_EMPTY_BEFORE: RegExp = /^(\s*)([-*+]|\d+\.)(?:\s+(.*)|\s*)$/;
const TASK_ITEM_BEFORE: RegExp = /^\[([ xX])\]\s+(.*)$/;
const ALLOWED_TAG_BEFORE: RegExp = /<\/?(?:u|sub|sup|kbd|br)(?:\s[^>]*)?\/?>/gi;
const BOLD_ITALIC_BEFORE: RegExp = /\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g;
const SOURCE_LIST_ITEM_BEFORE: RegExp =
  /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
const PAREN_NUMBER_LINE_BEFORE: RegExp = /^([ \t]*)(\d{1,9})\)[ \t]+(.*)$/;
const GLYPH_BULLET_LINE_BEFORE: RegExp = new RegExp(
  `^([ \\t]*)(?:([${TEXT_BULLET_GLYPHS}])|([${TAB_ONLY_BULLET_GLYPHS}])(?=\\t))[ \\t\\u00a0]+(.*)$`,
);
const TEXT_FENCE: RegExp = /^[ \t]*(`{3,}|~{3,})/;

describe("each rewritten pattern matches what the pattern it replaced matched", () => {
  test("RE_TABLE_SEPARATOR, on every row of up to eight characters and on drawn ones", () => {
    const now: RegExp = namedPattern(CONVERTERS_FILE, "RE_TABLE_SEPARATOR");
    const alphabet: Array<string> = [
      " ",
      "|",
      ":",
      "-",
      "x",
      "\t",
      LINE_SEPARATOR,
    ];
    const differences: Array<string> = [];
    let rows: number = 0;

    // The editor only asks whether a row is a delimiter row.
    const visit: (row: string, length: number) => void = (
      row: string,
      length: number,
    ): void => {
      if (now.test(row) !== TABLE_SEPARATOR_BEFORE.test(row)) {
        differences.push(JSON.stringify(row));
      }
      if (TABLE_SEPARATOR_BEFORE.test(row)) {
        rows++;
      }
      if (length < 8) {
        for (const character of alphabet) {
          visit(row + character, length + 1);
        }
      }
    };

    visit("", 0);

    for (const row of generatedTexts(
      200000,
      4423,
      [
        "|",
        " | ",
        ":",
        "-",
        "---",
        ":-:",
        " ",
        "\t",
        "x",
        NO_BREAK_SPACE,
        LINE_SEPARATOR,
        "\n",
      ],
      16,
    )) {
      if (now.test(row) !== TABLE_SEPARATOR_BEFORE.test(row)) {
        differences.push(JSON.stringify(row));
      }
    }

    expect(differences).toEqual([]);
    expect(rows).toBeGreaterThan(10000);
  });

  test.each([
    ["RE_FENCE_OPEN", FENCE_OPEN_BEFORE],
    ["RE_LIST_ITEM", LIST_ITEM_BEFORE],
    ["RE_LIST_ITEM_OR_EMPTY", LIST_ITEM_OR_EMPTY_BEFORE],
    ["RE_TASK_ITEM", TASK_ITEM_BEFORE],
  ])(
    "%s, group for group, on three hundred thousand drawn lines",
    (name: string, before: RegExp) => {
      const now: RegExp = namedPattern(CONVERTERS_FILE, name);
      const differences: Array<string> = [];
      let matched: number = 0;

      for (const line of generatedTexts(
        300000,
        4421,
        [
          " ",
          "  ",
          "\t",
          "|",
          ":",
          "-",
          "---",
          "```",
          "`",
          "*",
          "+",
          "1",
          "10.",
          ".",
          "[",
          "]",
          "[ ]",
          "[x]",
          "X",
          "a",
          "js",
          "_",
          LINE_SEPARATOR,
          PARAGRAPH_SEPARATOR,
          NO_BREAK_SPACE,
          "\n",
          "\r",
        ],
        14,
      )) {
        const expected: Array<string | undefined> | null = matchOf(
          line,
          before,
        );

        if (expected) {
          matched++;
        }

        if (JSON.stringify(matchOf(line, now)) !== JSON.stringify(expected)) {
          differences.push(JSON.stringify(line));
        }
      }

      expect(differences).toEqual([]);
      expect(matched).toBeGreaterThan(1000);
    },
  );

  test("RE_ALLOWED_TAG_OR_UNCLOSED stashes the tags the old pattern found, and only those", () => {
    const now: RegExp = namedPattern(
      CONVERTERS_FILE,
      "RE_ALLOWED_TAG_OR_UNCLOSED",
    );
    const differences: Array<string> = [];
    let replaced: number = 0;

    for (const text of generatedTexts(
      200000,
      3301,
      [
        "<",
        "</",
        "u",
        "br",
        "sub",
        "sup",
        "kbd",
        "BR",
        ">",
        "/>",
        " ",
        "\t",
        "\n",
        "x",
        "=",
        '"',
      ],
      16,
    )) {
      const expected: string = text.replace(
        ALLOWED_TAG_BEFORE,
        (tag: string): string => {
          return `[${tag}]`;
        },
      );

      if (expected !== text) {
        replaced++;
      }

      // The editor stashes a match that ends in ">"; the rest it leaves.
      const actual: string = text.replace(now, (tag: string): string => {
        return tag.endsWith(">") ? `[${tag}]` : tag;
      });

      if (actual !== expected) {
        differences.push(JSON.stringify(text));
      }
    }

    expect(differences).toEqual([]);
    expect(replaced).toBeGreaterThan(5000);
  });

  test("RE_BOLD_ITALIC_OR_UNCLOSED finds the pairs the old pattern found, and only those", () => {
    const now: RegExp = namedPattern(
      CONVERTERS_FILE,
      "RE_BOLD_ITALIC_OR_UNCLOSED",
    );
    const differences: Array<string> = [];
    let replaced: number = 0;

    for (const text of generatedTexts(
      200000,
      2207,
      ["***", "**", "*", "a", "b c", " ", "\n", "\t", LINE_SEPARATOR],
      16,
    )) {
      const expected: string = text.replace(
        BOLD_ITALIC_BEFORE,
        (_pair: string, inner: string): string => {
          return `<${inner}>`;
        },
      );

      if (expected !== text) {
        replaced++;
      }

      // The editor writes a pair; an unclosed "***" and the rest it leaves.
      const actual: string = text.replace(
        now,
        (pair: string, inner: string | undefined): string => {
          return inner === undefined ? pair : `<${inner}>`;
        },
      );

      if (actual !== expected) {
        differences.push(JSON.stringify(text));
      }
    }

    expect(differences).toEqual([]);
    expect(replaced).toBeGreaterThan(20000);
  });

  test("RE_SOURCE_LIST_ITEM of list editing, group for group", () => {
    const now: RegExp = namedPattern(LIST_EDITING_FILE, "RE_SOURCE_LIST_ITEM");
    const differences: Array<string> = [];
    let matched: number = 0;

    for (const line of generatedTexts(
      300000,
      5519,
      [
        " ",
        "\t",
        "-",
        "*",
        "+",
        "1",
        "12",
        ".",
        ")",
        "a",
        "b c",
        LINE_SEPARATOR,
        NO_BREAK_SPACE,
        "\r",
      ],
      12,
    )) {
      const expected: Array<string | undefined> | null = matchOf(
        line,
        SOURCE_LIST_ITEM_BEFORE,
      );

      if (expected) {
        matched++;
      }

      if (JSON.stringify(matchOf(line, now)) !== JSON.stringify(expected)) {
        differences.push(JSON.stringify(line));
      }
    }

    expect(differences).toEqual([]);
    expect(matched).toBeGreaterThan(10000);
  });

  test("RE_PAREN_NUMBER_LINE of paste, group for group", () => {
    const now: RegExp = namedPattern(PASTE_FILE, "RE_PAREN_NUMBER_LINE");
    const differences: Array<string> = [];
    let matched: number = 0;

    for (const line of generatedTexts(
      300000,
      6007,
      [
        "1)",
        "23)",
        " ",
        "\t",
        "1",
        ")",
        "a",
        "b c",
        LINE_SEPARATOR,
        NO_BREAK_SPACE,
        "\r",
        ".",
      ],
      12,
    )) {
      const expected: Array<string | undefined> | null = matchOf(
        line,
        PAREN_NUMBER_LINE_BEFORE,
      );

      if (expected) {
        matched++;
      }

      if (JSON.stringify(matchOf(line, now)) !== JSON.stringify(expected)) {
        differences.push(JSON.stringify(line));
      }
    }

    expect(differences).toEqual([]);
    expect(matched).toBeGreaterThan(1000);
  });

  test("a pasted line with a bullet glyph or a number becomes the list item it became", () => {
    // What normalizePlainTextListMarkers made of one line, with the patterns as they were.
    const normalizedBefore: (line: string) => string = (
      line: string,
    ): string => {
      if (TEXT_FENCE.test(line)) {
        return line;
      }
      const bullet: RegExpMatchArray | null = line.match(
        GLYPH_BULLET_LINE_BEFORE,
      );
      if (bullet) {
        return `- ${bullet[4] || ""}`;
      }
      const numbered: RegExpMatchArray | null = line.match(
        PAREN_NUMBER_LINE_BEFORE,
      );
      if (numbered) {
        return `${numbered[1] || ""}${numbered[2] || ""}. ${numbered[3] || ""}`;
      }
      return line;
    };
    const differences: Array<string> = [];
    let changed: number = 0;

    for (const line of generatedTexts(
      200000,
      7121,
      [
        " ",
        "\t",
        NO_BREAK_SPACE,
        "•",
        "◦",
        "o",
        "§",
        "1",
        ")",
        "a",
        "b c",
        "-",
        "```",
        LINE_SEPARATOR,
      ],
      12,
    )) {
      const expected: string = normalizedBefore(line);

      if (expected !== line) {
        changed++;
      }

      if (normalizePlainTextListMarkers(line) !== expected) {
        differences.push(JSON.stringify(line));
      }
    }

    expect(differences).toEqual([]);
    expect(changed).toBeGreaterThan(3000);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The serializer's loops as they were - on the product's serializer of
 * each child, so each level is held to them, and by that the whole tree.
 * ---------------------------------------------------------------------------
 */
const breakBeforeDivBefore: (out: string, child: Node) => string = (
  out: string,
  child: Node,
): string => {
  const isDiv: boolean =
    child.nodeType === Node.ELEMENT_NODE &&
    (child as HTMLElement).tagName.toLowerCase() === "div";
  if (isDiv && out.length > 0 && !out.endsWith("\n")) {
    return `${out}\n`;
  }
  return out;
};

const serializeChildrenBefore: (node: Node) => string = (
  node: Node,
): string => {
  let out: string = "";
  for (let i: number = 0; i < node.childNodes.length; i++) {
    const child: ChildNode | undefined = node.childNodes[i] as
      | ChildNode
      | undefined;
    if (!child) {
      continue;
    }
    out = breakBeforeDivBefore(out, child);
    out += __testing.serializeNode(child);
  }
  return out;
};

const LIST_ITEM_BLOCK_TAGS_BEFORE: Set<string> = new Set<string>([
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

const serializeListItemChildrenBefore: (li: HTMLElement) => string = (
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
    let part: string = __testing.serializeNode(child);
    const isBlock: boolean =
      child.nodeType === Node.ELEMENT_NODE &&
      LIST_ITEM_BLOCK_TAGS_BEFORE.has(
        (child as HTMLElement).tagName.toLowerCase(),
      );
    if (isBlock && out.trim().length > 0 && !out.endsWith("\n\n")) {
      out = out.replace(/\n*$/, "\n\n");
      part = part.replace(/^\n+/, "");
    }
    out = breakBeforeDivBefore(out, child);
    out += part;
  }
  return out;
};

// Children a list item or a line can hold: text, line breaks, blocks, inline elements.
const CHILDREN: Array<string> = [
  "a",
  "b c",
  " ",
  "\n",
  "\n\n",
  "x\n",
  "<br>",
  "<div>d</div>",
  "<div></div>",
  "<div>\n</div>",
  "<p>p</p>",
  "<p></p>",
  "<pre><code>c\n\n</code></pre>",
  "<ul><li>i</li></ul>",
  "<ol><li>o</li></ol>",
  "<blockquote>q</blockquote>",
  "<hr>",
  "<h2>h</h2>",
  "<b>b</b>",
  "<b></b>",
  "<span> </span>",
  "<!--c-->",
  "<table><tr><td>t</td></tr></table>",
  '<input type="checkbox">',
];

describe("the serializer writes each line and list item as it did", () => {
  test("serializeChildren, on fifty thousand drawn runs of children", () => {
    const differences: Array<string> = [];

    for (const children of generatedTexts(50000, 1187, CHILDREN, 10)) {
      const holder: HTMLElement = document.createElement("div");
      holder.innerHTML = children;

      if (
        __testing.serializeChildren(holder) !== serializeChildrenBefore(holder)
      ) {
        differences.push(JSON.stringify(children));
      }
    }

    expect(differences).toEqual([]);
  });

  test("serializeListItemChildren, on fifty thousand drawn list items", () => {
    const differences: Array<string> = [];

    for (const children of generatedTexts(50000, 1193, CHILDREN, 10)) {
      const list: HTMLElement = document.createElement("ul");
      list.innerHTML = `<li>${children}</li>`;
      const item: HTMLElement = list.firstElementChild as HTMLElement;

      if (
        __testing.serializeListItemChildren(item) !==
        serializeListItemChildrenBefore(item)
      ) {
        differences.push(JSON.stringify(children));
      }
    }

    expect(differences).toEqual([]);
  });

  test("whole lists, nested and with boxes, are written as they were", () => {
    expect(
      htmlToMarkdown(
        '<ul><li>a<p>b</p>c<pre><code>d\n</code></pre></li><li><input type="checkbox" checked>e<div>f</div><ul><li>g</li></ul></li></ul>',
      ),
    ).toBe("- a\n\n  b\n\n  c\n\n  ```\n  d\n  ```\n- [x] e\n  f\n\n  - g");
    expect(
      htmlToMarkdown('<ol start="3"><li>a</li><li>b<br><br></li></ol>'),
    ).toBe("3. a\n4. b");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Tables: laid out as before while that stays in proportion to what they
 * hold.
 * ---------------------------------------------------------------------------
 */

// tableToMarkdown as it was, on the text of each row's cells.
const tableBefore: (rows: Array<Array<string>>) => string = (
  rows: Array<Array<string>>,
): string => {
  const texts: Array<Array<string>> = rows.map(
    (cells: Array<string>): Array<string> => {
      return cells.map((cell: string): string => {
        return cell.replace(/\n+/g, " ").trim();
      });
    },
  );
  const header: Array<string> = texts[0] || [];
  const body: Array<Array<string>> = texts.slice(1);
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

const tableHtml: (rows: Array<Array<string>>) => string = (
  rows: Array<Array<string>>,
): string => {
  return `<table>${rows
    .map((cells: Array<string>, index: number): string => {
      const tag: string = index === 0 ? "th" : "td";
      return `<tr>${cells
        .map((cell: string): string => {
          return `<${tag}>${cell}</${tag}>`;
        })
        .join("")}</tr>`;
    })
    .join("")}</table>`;
};

const serializedTable: (rows: Array<Array<string>>) => string = (
  rows: Array<Array<string>>,
): string => {
  const table: Node = fragmentOf(tableHtml(rows)).firstChild as Node;
  return __testing.serializeNode(table);
};

describe("a table is laid out as before while it stays in proportion", () => {
  test("ten thousand drawn tables are written as they were", () => {
    const cells: Array<string> = generatedTexts(
      200000,
      8291,
      ["a", "bb", "c d", "word", "x", "longer cell", "\n"],
      6,
    );
    const shapes: Array<string> = generatedTexts(
      10000,
      8293,
      ["0", "1", "2", "3", "4", "5"],
      6,
    );
    const differences: Array<string> = [];
    let cellIndex: number = 0;

    for (const shape of shapes) {
      const rows: Array<Array<string>> = [];
      for (const count of shape) {
        const row: Array<string> = [];
        for (let c: number = 0; c < Number(count); c++) {
          row.push(cells[cellIndex++ % cells.length] || "");
        }
        rows.push(row);
      }

      if (serializedTable(rows) !== tableBefore(rows)) {
        differences.push(JSON.stringify(rows));
      }
    }

    expect(differences).toEqual([]);
  });

  test("a large table of even rows is still lined up", () => {
    const rows: Array<Array<string>> = [];
    for (let row: number = 0; row < 2000; row++) {
      rows.push([
        `row ${row}`,
        "status",
        row % 7 === 0 ? "a longer note here" : "",
      ]);
    }

    expect(serializedTable(rows)).toBe(tableBefore(rows));
  });

  test("a long cell over many rows is written plainly, each cell as it is", () => {
    const long: string = repeat("y", 50000);
    const rows: Array<Array<string>> = [
      ["a", "b"],
      [long, "1"],
    ];
    for (let row: number = 0; row < 100; row++) {
      rows.push(["x", String(row)]);
    }

    const written: string = serializedTable(rows);

    // Lined up it was 100 rows padded to 50,000 characters each.
    expect(tableBefore(rows).length).toBeGreaterThan(5000000);
    expect(written).toBe(
      "\n| a | b |\n| --- | --- |\n" +
        `| ${long} | 1 |\n` +
        Array.from({ length: 100 }, (_unused: unknown, row: number): string => {
          return `| x | ${row} |\n`;
        }).join("") +
        "\n",
    );
    // And it reads back as the same table.
    expect(markdownToHtml(written.trim())).toBe(
      markdownToHtml(tableBefore(rows).trim()),
    );
  });

  test("a heading row of many columns over short rows writes each row's own cells", () => {
    const columns: number = 3000;
    const header: Array<string> = Array.from(
      { length: columns },
      (_unused: unknown, column: number): string => {
        return `h${column}`;
      },
    );
    const rows: Array<Array<string>> = [header];
    for (let row: number = 0; row < 3000; row++) {
      rows.push([`r${row}`]);
    }

    const written: string = serializedTable(rows);
    const lines: Array<string> = written.split("\n");

    expect(lines[1]).toBe(`| ${header.join(" | ")} |`);
    expect(lines[2]).toBe(
      `| ${new Array<string>(columns).fill("---").join(" | ")} |`,
    );
    expect(lines[3]).toBe("| r0 |");
    expect(lines[3002]).toBe("| r2999 |");
    expect(written.length).toBeLessThan(100000);
  });

  test("a body row's cells past the heading row stay under headings when written plainly", () => {
    const rows: Array<Array<string>> = [
      ["a"],
      ["b", "kept"],
      [repeat("z", 70000)],
    ];
    for (let row: number = 0; row < 200; row++) {
      rows.push(["x"]);
    }

    const written: string = serializedTable(rows);

    expect(
      written.startsWith("\n| a |  |\n| --- | --- |\n| b | kept |\n"),
    ).toBe(true);
    expect(markdownToHtml(written.trim())).toContain("<td>kept</td>");
  });

  test("short rows are filled out to the heading row, as before, in a table of any size that holds them", () => {
    expect(markdownToHtml("| a | b | c |\n| --- | --- | --- |\n| x |")).toBe(
      "<table><thead><tr><th>a</th><th>b</th><th>c</th></tr></thead>" +
        "<tbody><tr><td>x</td><td></td><td></td></tr></tbody></table>",
    );

    const rows: Array<string> = [];
    for (let row: number = 0; row < 3000; row++) {
      rows.push(row % 2 === 0 ? "| a | b | c |" : "| a |");
    }
    const html: string = markdownToHtml(
      `| 1 | 2 | 3 |\n|---|---|---|\n${rows.join("\n")}`,
    );

    expect(html.split("<td>").length - 1).toBe(9000);
  });

  test("a heading row of thousands of columns over one-cell rows shows each row's own cell", () => {
    const columns: number = 20000;
    const markdown: string =
      `${repeat("|", columns + 1)}\n|-|\n` + times("|x|\n", 4 * columns);

    const html: string = markdownToHtml(markdown);

    // Filled out, it was 1.6 billion cells.
    expect(html.split("<th>").length - 1).toBe(columns);
    expect(html.split("<td>").length - 1).toBe(4 * columns);
    expect(html).toContain("<tr><td>x</td></tr>");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The texts that were slow.
 * ---------------------------------------------------------------------------
 */

const deepListWithFeeds: (feeds: number) => string = (
  feeds: number,
): string => {
  let text: string = "";
  for (let depth: number = 0; depth < 21; depth++) {
    text += `${"  ".repeat(depth)}- a\n`;
  }
  return `${text}${"  ".repeat(21)}b${repeat("\n", feeds)}${"  ".repeat(21)}c`;
};

describe("markdown built to be slow opens quickly", () => {
  test.each([
    [
      "a table delimiter row with long runs of white space",
      "a|b\n" + repeat(" ", LENGTH / 2) + "-" + repeat(" ", LENGTH / 2) + "x|",
    ],
    [
      "a table delimiter row with a long run after its dashes",
      "a|b\n|---" + repeat("\t", LENGTH) + "x",
    ],
    [
      "a fence line with a long run of tabs",
      "```" + repeat("\t", LENGTH) + "```",
    ],
    [
      "a list item with a long run and a line separator",
      "*\t" + repeat("\t", LENGTH) + "*" + LINE_SEPARATOR + "x",
    ],
    [
      "a second list item with a long run and a line separator",
      "- a\n-" + repeat("\t", LENGTH) + "0" + LINE_SEPARATOR + "x",
    ],
    [
      "a task item with a long run",
      "- [ ] a\n- [x]" + repeat(" ", LENGTH) + "y" + LINE_SEPARATOR + "x",
    ],
    ["inline tags that close none", repeat("<U\t", LENGTH)],
    ["inline tags that close one at the end", repeat("<br ", LENGTH) + ">"],
    ["images that close none", repeat("![](\u0000", LENGTH)],
    ["links that close none", repeat("[(](((", LENGTH) + "][\t](\u0000)"],
    ["bold italics that close none", repeat(" ***a", LENGTH)],
    [
      "bold italics with stars that close none",
      "***\u0000" + repeat("*\t***\u0000*\u0000", LENGTH),
    ],
    ["line feeds deep in a nested list", deepListWithFeeds(LENGTH)],
    [
      "many short lines of every kind",
      repeat("# a\n- b\n> c\n1. d\n|e|\n", LENGTH),
    ],
  ])("%s", (_label: string, markdown: string) => {
    expect(
      timeOf(() => {
        markdownToHtml(markdown);
      }),
    ).toBeLessThan(2000);
  });

  test("past the nesting cap, an item's lines are its text, as before", () => {
    expect(markdownToHtml(deepListWithFeeds(3))).toContain(
      "<li>a<br>b<br><br><br>c</li>",
    );
  });

  test("past the nesting cap, an item of more lines than a call takes arguments opens", () => {
    let text: string = "";
    for (let depth: number = 0; depth < 21; depth++) {
      text += `${"  ".repeat(depth)}- a\n`;
    }
    // Spread into push(), 200,000 lines ran the stack out.
    text += times(`${"  ".repeat(21)}b\n`, 200000);

    let html: string = "";

    expect(() => {
      html = markdownToHtml(text);
    }).not.toThrow();
    expect(html.split("<br>").length - 1).toBe(200000);
  });
});

describe("HTML built to be slow is written back quickly", () => {
  test.each([
    [
      "a code block of line feeds",
      `<pre><code>${times("\n", LENGTH)}x</code></pre>`,
    ],
    [
      "a list item of line breaks before a paragraph",
      `<ul><li>a${times("<br>", LENGTH / 4)}x<p>b</p></li></ul>`,
    ],
    [
      "a list item of text and paragraphs, one after the other",
      `<ul><li>${times("x<p>y</p>", LENGTH / 9)}</li></ul>`,
    ],
    /*
     * The text written so far was copied whole for each line: 400,000
     * characters took a third of a second, and four times as many nine.
     */
    [
      "a note typed line by line",
      `x${times("<div>y</div>", (4 * LENGTH) / 12)}`,
    ],
    ["a note of empty lines", `x${times("<div></div>", (4 * LENGTH) / 11)}`],
    [
      "a list item typed line by line",
      `<ul><li>x${times("<div>y</div>", (4 * LENGTH) / 12)}</li></ul>`,
    ],
    ["a long list", `<ul>${times("<li>a</li>", LENGTH / 10)}</ul>`],
    [
      "a long cell over many rows",
      `<table><tr><td>${times("y", LENGTH / 4)}</td></tr>${times("<tr><td>x</td></tr>", (3 * LENGTH) / 4 / 19)}</table>`,
    ],
    [
      "a heading row of many columns over one-cell rows",
      `<table><tr>${times("<th>h</th>", LENGTH / 20)}</tr>${times("<tr><td>x</td></tr>", LENGTH / 38)}</table>`,
    ],
    [
      "a row of many cells",
      `<table><tr>${times("<td>c</td>", LENGTH / 10)}</tr></table>`,
    ],
  ])("%s", (_label: string, html: string) => {
    // Parsed once, as the browser has the editor's document already.
    const parsed: DocumentFragment = fragmentOf(html);

    expect(
      timeOf(() => {
        domToMarkdown(parsed);
      }),
    ).toBeLessThan(2000);
  });

  test("a code block's line feeds still come off its end", () => {
    expect(
      htmlToMarkdown(`<pre><code>a\n${times("\n", 50)}</code></pre>`),
    ).toBe("```\na\n```");
    // Blank lines inside it are collapsed with the rest, as they were.
    expect(htmlToMarkdown(`<pre><code>a\n\n\nb</code></pre>`)).toBe(
      "```\na\n\nb\n```",
    );
  });
});

describe("the editor's other readers of a line read it quickly", () => {
  test("a pasted line with a bullet glyph, a long run and a line separator", () => {
    const text: string = "•" + repeat(" ", LENGTH) + "x" + LINE_SEPARATOR + "y";

    expect(
      timeOf(() => {
        normalizePlainTextListMarkers(text);
      }),
    ).toBeLessThan(2000);
    expect(normalizePlainTextListMarkers(text)).toBe(text);
  });

  test("a pasted numbered line with a long run and a line separator", () => {
    const text: string = "1)" + repeat("\t", LENGTH) + "x" + LINE_SEPARATOR;

    expect(
      timeOf(() => {
        normalizePlainTextListMarkers(text);
      }),
    ).toBeLessThan(2000);
    expect(normalizePlainTextListMarkers(text)).toBe(text);
  });

  test("Tab and the list buttons on a note with a long list line", () => {
    const text: string =
      "- " + repeat(" ", LENGTH) + "x" + LINE_SEPARATOR + "y\n- b";

    expect(
      timeOf(() => {
        isInFencedCodeBlock(text, text.length);
        indentMarkdownLines(text, text.length, text.length);
      }),
    ).toBeLessThan(2000);
  });

  test("a block put into a line with a long run of spaces in it", () => {
    const editable: HTMLDivElement = document.createElement("div");
    editable.innerHTML = `<p>a${repeat(" ", LENGTH)}bc</p>`;
    document.body.appendChild(editable);

    try {
      const text: Text = editable.querySelector("p")!.firstChild as Text;
      const caret: Range = document.createRange();
      caret.setStart(text, LENGTH + 2);
      caret.collapse(true);

      expect(
        timeOf(() => {
          insertBlocksAtCaret(editable, caret, fragmentOf("<hr>"));
        }),
      ).toBeLessThan(2000);
      expect(editable.innerHTML).toBe(
        `<p>a${repeat(" ", LENGTH)}b</p><hr><p>c</p>`,
      );
    } finally {
      editable.remove();
    }
  });

  test("the spaces at the split come off as before", () => {
    const editable: HTMLDivElement = document.createElement("div");
    editable.innerHTML = "<p>Run this \t\n then</p>";
    document.body.appendChild(editable);

    try {
      const text: Text = editable.querySelector("p")!.firstChild as Text;
      const caret: Range = document.createRange();
      caret.setStart(text, "Run this \t\n ".length);
      caret.collapse(true);

      insertBlocksAtCaret(editable, caret, fragmentOf("<hr>"));

      expect(editable.innerHTML).toBe("<p>Run this</p><hr><p>then</p>");
    } finally {
      editable.remove();
    }
  });
});
