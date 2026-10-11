import {
  DocsPageSummary,
  stripInlineMarkdown,
  summarizeDocsPage,
} from "../../../FeatureSet/Docs/Utils/SearchIndex";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs search index - and each page's meta description - is the text of
 * a page's first paragraph and its h2/h3 headings (summarizeDocsPage),
 * read out of the Markdown by stripInlineMarkdown. Its HTML tags used to be
 * taken out with one pass of /<[^>]+>/, which kept an unclosed tag ("<img
 * src=x ..." with no ">") as it was, and kept the end of a quoted value or a
 * comment holding ">". Code scanning reports that as incomplete
 * multi-character sanitization.
 *
 * Now tags and comments go through removeHtmlMarkup (Common/Types/
 * HtmlMarkup), and the "<" that Markdown reads as text - before a space or
 * a digit, "LCP < 2.5 s" - is set aside first and kept, as the page shows
 * it. So:
 *
 *   - outside inline code, the text holds no "<" that could start a tag,
 *     a comment or a declaration, whatever the Markdown;
 *   - inline code is kept as written, as it always was;
 *   - every page in every language reads as it did (the search and route
 *     suites pin the anchors; this holds the text to having no markup).
 */

// A "<" a tag, a comment, a declaration or a processing instruction starts with.
const TAG_START: RegExp = /<[A-Za-z!/?]/;
const INLINE_CODE: RegExp = /`+([^`]*)`+/g;
const FENCE_LINE: RegExp = /^\s*(```|~~~)/;

const DOCS_CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

function listPages(directory: string): Array<string> {
  const pages: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      pages.push(...listPages(fullPath));
    } else if (entry.name.endsWith(".md")) {
      pages.push(fullPath);
    }
  }

  return pages.sort();
}

const languages: Array<string> = fs
  .readdirSync(DOCS_CONTENT_DIR, { withFileTypes: true })
  .filter((entry: fs.Dirent): boolean => {
    return entry.isDirectory();
  })
  .map((entry: fs.Dirent): string => {
    return entry.name;
  })
  .sort();

// The texts of a page's inline code spans, longest first.
function inlineCodeOf(markdown: string): Array<string> {
  const code: Set<string> = new Set();

  for (const match of markdown.matchAll(INLINE_CODE)) {
    code.add(match[1]!);
  }

  return Array.from(code).sort((a: string, b: string): number => {
    return b.length - a.length;
  });
}

// Text with every piece of a page's inline code taken out of it.
function withoutCode(text: string, code: Array<string>): string {
  let result: string = text;

  for (const piece of code) {
    if (piece) {
      result = result.split(piece).join("");
    }
  }

  return result;
}

// A small seeded generator, so the generated lines are the same every run.
function seededRandom(seed: number): (limit: number) => number {
  let state: number = seed;

  return (limit: number): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % limit;
  };
}

describe("stripInlineMarkdown takes markup out of the text it indexes", () => {
  it.each([
    [
      "an unclosed tag",
      "Read <img src=x onerror=alert(1)",
      "Read img src=x onerror=alert(1)",
    ],
    ["a tag inside a tag's name", "<scr<script>ipt>Install", "ipt>Install"],
    ["an overlapping comment", "<!<!---->--Install", "--Install"],
    [
      "a comment holding a tag and '>'",
      "Install <!-- <b>x</b> > y --> the agent",
      "Install the agent",
    ],
    [
      "a quoted value holding '>'",
      'Click <img alt="a > b" src="/docs/static/x.png"> Save',
      "Click Save",
    ],
    [
      "an unclosed comment",
      "Install <!-- never closed",
      "Install !-- never closed",
    ],
    ["a tag before a letter", "a <b c", "a b c"],
    [
      "a tag rebuilt from the text around it",
      "<<b></b>script>alert(1)",
      "script>alert(1)",
    ],
  ])(
    "%s comes out with no tag in it",
    (_case: string, markdown: string, text: string) => {
      const result: string = stripInlineMarkdown(markdown);

      expect(result).toBe(text);
      expect(result).not.toMatch(TAG_START);
    },
  );

  it.each([
    ["a comparison", "LCP < 2.5 s is good", "LCP < 2.5 s is good"],
    ["a comparison before a digit", "keep p99 <200 ms", "keep p99 <200 ms"],
    ["less than or equal", "x <= 5 and y >= 2", "x <= 5 and y >= 2"],
    ["an arrow", "probe <-> monitor", "probe <-> monitor"],
    ["a shift", "a << b", "a << b"],
    ["a '<' at the end", "less <", "less <"],
    ["an empty pair", "an empty <> pair", "an empty <> pair"],
    ["a span after a '<' that is text", "a < b > c", "a < b > c"],
  ])(
    "keeps %s as the page shows it",
    (_case: string, markdown: string, text: string) => {
      expect(stripInlineMarkdown(markdown)).toBe(text);
    },
  );

  it("keeps inline code exactly as written, markup in it too", () => {
    expect(
      stripInlineMarkdown(
        'Add `<script src="x.js"></script>` and `oneuptime <resource> list`',
      ),
    ).toBe('Add <script src="x.js"></script> and oneuptime <resource> list');
  });

  it("never joins a '<' of the text to the code after it", () => {
    // "a <`b`" shows "a <" and then the code "b": no "<b" is made of them.
    expect(stripInlineMarkdown("a <`b` c")).toBe("a b c");
    expect(stripInlineMarkdown("a < `b` c")).toBe("a < b c");
  });

  it("keeps entities as written, as it always did", () => {
    expect(stripInlineMarkdown("Tom &amp; Jerry &lt;b&gt;")).toBe(
      "Tom &amp; Jerry &lt;b&gt;",
    );
  });

  it("reads back only the marks it set itself", () => {
    // Private-use characters in the text are dropped, never read as code or "<".
    expect(stripInlineMarkdown("a b 0 c `d`")).toBe("a b 0 c d");
  });

  it("leaves no tag in any line of text, whatever it holds", () => {
    const alphabet: Array<string> = [
      "<",
      ">",
      "!",
      "-",
      "=",
      '"',
      "/",
      "?",
      " ",
      "s",
      "b",
      "1",
      "*",
      "_",
      "[",
      "]",
      "(",
      ")",
    ];
    const random: (limit: number) => number = seededRandom(9001);
    const withTag: Array<string> = [];

    for (let index: number = 0; index < 20000; index++) {
      let line: string = "";
      const length: number = random(24);

      for (let position: number = 0; position < length; position++) {
        line += alphabet[random(alphabet.length)];
      }

      if (TAG_START.test(stripInlineMarkdown(line))) {
        withTag.push(line);
      }
    }

    expect(withTag.slice(0, 5)).toEqual([]);
  });
});

describe("summarizeDocsPage indexes text, not markup", () => {
  it("takes markup out of the description and the headings", () => {
    const summary: DocsPageSummary = summarizeDocsPage(
      [
        "# Title",
        "",
        "Watch <kbd>Ctrl</kbd> + <kbd>K</kbd> <!-- shortcut > menu --> open",
        "search, LCP < 2.5 s. <img src=x onerror=alert(1)",
        "",
        "## Install <scr<script>ipt>",
        "### Keep `<resource>` LCP < 2.5 s",
      ].join("\n"),
    );

    expect(summary.description).toBe(
      "Watch Ctrl + K open search, LCP < 2.5 s. img src=x onerror=alert(1)",
    );
    expect(summary.headings).toEqual([
      // The page renders the heading's markup escaped, so its id keeps the words.
      { level: 2, text: "Install ipt>", anchor: "install-scrscriptipt" },
      {
        level: 3,
        text: "Keep <resource> LCP < 2.5 s",
        anchor: "keep-resource-lcp-25-s",
      },
    ]);
  });
});

describe("the docs' search text holds no markup", () => {
  it("finds the docs in all 17 languages", () => {
    expect(languages).toHaveLength(17);
  });

  it.each(languages)(
    "%s: no description or heading holds a tag outside its inline code",
    (language: string) => {
      const found: Array<string> = [];
      let read: number = 0;

      for (const page of listPages(path.join(DOCS_CONTENT_DIR, language))) {
        const markdown: string = fs.readFileSync(page, "utf8");
        const code: Array<string> = inlineCodeOf(markdown);
        const summary: DocsPageSummary = summarizeDocsPage(markdown);

        for (const text of [
          summary.description,
          ...summary.headings.map((heading: { text: string }): string => {
            return heading.text;
          }),
        ]) {
          read++;

          if (TAG_START.test(withoutCode(text, code))) {
            found.push(`${path.relative(DOCS_CONTENT_DIR, page)}: ${text}`);
          }
        }
      }

      expect(read).toBeGreaterThan(1000);
      expect(found).toEqual([]);
    },
  );

  it.each(languages)(
    "%s: no line of prose holds a tag once read, outside its inline code",
    (language: string) => {
      const found: Array<string> = [];

      for (const page of listPages(path.join(DOCS_CONTENT_DIR, language))) {
        const markdown: string = fs.readFileSync(page, "utf8");
        let inFence: boolean = false;

        for (const line of markdown.split("\n")) {
          if (FENCE_LINE.test(line)) {
            inFence = !inFence;
            continue;
          }

          if (inFence || !line.includes("<")) {
            continue;
          }

          const text: string = stripInlineMarkdown(line);

          if (TAG_START.test(withoutCode(text, inlineCodeOf(line)))) {
            found.push(`${path.relative(DOCS_CONTENT_DIR, page)}: ${line}`);
          }
        }
      }

      expect(found.slice(0, 10)).toEqual([]);
    },
  );
});
