import Markdown, { MarkdownContentType } from "../../../Server/Types/Markdown";
import { docsTabKey } from "../../../Server/Types/MarkdownDocsExtensions";
import slugify, {
  slugifyMarkdownHeading,
} from "../../../Server/Types/MarkdownSlugify";
import removeHtmlMarkup from "../../../Types/HtmlMarkup";
import SafeHtml from "../../../Types/SafeHtml";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * removeHtmlMarkup on the docs as they are, in all 17 languages.
 *
 * The docs renderer gives every heading an id from its HTML (Markdown.slugify,
 * MarkdownSlugify), and docsTabKey matches a tab set's labels; both used to
 * take markup out with one pass of /<[^>]*>/ and now read it with
 * removeHtmlMarkup. These hold the change to the real pages:
 *
 *   - on every heading the docs render, the text removeHtmlMarkup leaves is
 *     what a browser shows of the heading - so the anchor is made from the
 *     text the reader sees;
 *   - on whole rendered pages in a language of every script direction and
 *     shape, it reads what a browser reads;
 *   - a tab label with no markup keys on its words alone, as it always did.
 *
 * Whether anchors moved is held by the suites that resolve every docs link
 * and every search result against the rendered pages (App/Tests/FeatureSet/
 * Docs); these hold the reading underneath them.
 *
 * jsdom lives in Common's dependencies, which is why this runs in Common.
 */

const DOCS_CONTENT_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
);

// Whole pages are read in these: every component, and other scripts and directions.
const WHOLE_PAGE_LANGUAGES: Array<string> = ["en", "ja", "fa"];

const FENCE_LINE: RegExp = /^\s*(`{3,}|~{3,})/;
const TAB_LINE: RegExp = /^ {0,3}@tab[ \t]+(.+?)[ \t]*$/;
const WHITESPACE_RUN: RegExp = /\s+/g;

// The text of HTML as a browser reads it: every text node, entities read.
function browserText(html: string): string {
  return JSDOM.fragment(html).textContent || "";
}

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

// The page's body as the docs route renders it: the title line is not drawn.
function bodyOf(page: string): string {
  return fs.readFileSync(page, "utf8").split("\n").slice(1).join("\n");
}

describe("removeHtmlMarkup on the docs", () => {
  /*
   * The HTML of every heading the renderer makes an id from, per language,
   * caught on its way into Markdown.slugify while every page renders.
   */
  const headingHtml: Map<string, Array<string>> = new Map();
  const renderedPages: Map<string, string> = new Map();

  beforeAll(async () => {
    const realSlugify: (text: string) => string = Markdown.slugify;
    let current: Array<string> = [];

    Markdown.slugify = (text: string): string => {
      current.push(text);
      return realSlugify.call(Markdown, text);
    };

    try {
      for (const language of languages) {
        current = [];
        headingHtml.set(language, current);

        for (const page of listPages(path.join(DOCS_CONTENT_DIR, language))) {
          const html: string = await Markdown.convertToHTML(
            bodyOf(page),
            MarkdownContentType.Docs,
          );

          if (WHOLE_PAGE_LANGUAGES.includes(language)) {
            renderedPages.set(path.relative(DOCS_CONTENT_DIR, page), html);
          }
        }
      }
    } finally {
      Markdown.slugify = realSlugify;
    }
  }, 300000);

  afterAll(() => {
    headingHtml.clear();
    renderedPages.clear();
  });

  it("finds the docs in all 17 languages", () => {
    expect(languages).toHaveLength(17);
    expect(languages).toEqual(expect.arrayContaining(WHOLE_PAGE_LANGUAGES));
  });

  it.each(languages)(
    "%s: every heading's anchor is made from the text a browser shows of it",
    (language: string) => {
      const headings: Array<string> = headingHtml.get(language) || [];
      const differences: Array<string> = [];

      for (const html of headings) {
        const text: string = browserText(removeHtmlMarkup(html));

        if (text !== browserText(html)) {
          differences.push(`${html} -> ${text}`);
        }

        /*
         * The anchor is the anchor of the text the reader sees, written as
         * the renderer writes text: nothing in a tag or comment reaches it.
         */
        if (slugify(html) !== slugify(SafeHtml.escape(browserText(html)))) {
          differences.push(`${html}: its anchor reads more than its text`);
        }
      }

      expect(headings.length).toBeGreaterThan(500);
      expect(differences.slice(0, 10)).toEqual([]);
    },
  );

  it("reads headings with markup in them, inline code and emphasis", () => {
    const english: Array<string> = headingHtml.get("en") || [];
    const withTags: Array<string> = english.filter((html: string): boolean => {
      return html.includes("<code") || html.includes("<strong");
    });

    // The headings the old pass and the new walk could ever read apart.
    expect(withTags.length).toBeGreaterThan(5);
    expect(
      english.find((html: string): boolean => {
        return html.includes("&lt;resource&gt;");
      }),
    ).toBeDefined();
  });

  it.each(WHOLE_PAGE_LANGUAGES)(
    "%s: reads every rendered page as a browser does",
    (language: string) => {
      const differences: Array<string> = [];
      let read: number = 0;

      for (const [page, html] of renderedPages) {
        if (!page.startsWith(`${language}/`)) {
          continue;
        }

        read++;
        const expected: string = browserText(html);
        const actual: string = browserText(removeHtmlMarkup(html));

        if (actual !== expected) {
          let at: number = 0;

          while (at < expected.length && expected[at] === actual[at]) {
            at++;
          }

          differences.push(
            `${page} at ${at}: a browser reads ${JSON.stringify(expected.slice(at, at + 60))}, removeHtmlMarkup ${JSON.stringify(actual.slice(at, at + 60))}`,
          );
        }
      }

      expect(read).toBeGreaterThan(100);
      expect(differences).toEqual([]);
    },
    120000,
  );

  it.each(languages)(
    "%s: a tab label with no markup keys on its words alone",
    (language: string) => {
      const differences: Array<string> = [];
      let labels: number = 0;

      for (const page of listPages(path.join(DOCS_CONTENT_DIR, language))) {
        let inFence: boolean = false;

        for (const line of fs.readFileSync(page, "utf8").split("\n")) {
          if (FENCE_LINE.test(line)) {
            inFence = !inFence;
            continue;
          }

          const tab: RegExpMatchArray | null = inFence
            ? null
            : line.match(TAB_LINE);

          if (!tab || tab[1]!.includes("<")) {
            continue;
          }

          labels++;
          const words: string = tab[1]!
            .toLowerCase()
            .replace(WHITESPACE_RUN, " ")
            .trim();

          if (docsTabKey(tab[1]!) !== words) {
            differences.push(`${page}: ${tab[1]}`);
          }
        }
      }

      expect(labels).toBeGreaterThan(5);
      expect(differences).toEqual([]);
    },
  );

  it("names a heading with a <word> in inline code as the page does", () => {
    // The heading as written and the HTML the renderer slugifies agree.
    expect(slugifyMarkdownHeading("`oneuptime <resource> list`")).toBe(
      "oneuptime-resource-list",
    );
    expect(
      Markdown.slugify(
        '<code class="docs-code-inline">oneuptime &lt;resource&gt; list</code>',
      ),
    ).toBe("oneuptime-resource-list");
  });
});
