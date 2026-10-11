import { stripHtmlTags } from "../../../../App/Tests/FeatureSet/Docs/DocsHtmlText";
import Markdown, { MarkdownContentType } from "../../../Server/Types/Markdown";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * stripHtmlTags (App/Tests/FeatureSet/Docs/DocsHtmlText.ts) is how the docs
 * tests read a rendered page as text - strayMarkers looks for "**" and "_"
 * left on it in every language. It replaced a single-pass tag pattern that
 * code scanning reported (js/incomplete-multi-character-sanitization), so
 * here it is held to a browser's reading of HTML: jsdom parses the same
 * markup, and the text of the two must be the same.
 *
 * The helper leaves entities as they are and jsdom reads them, so its text
 * is compared once jsdom has read its entities too. It holds no "<" (that is
 * its promise), so jsdom finds nothing in it but text.
 *
 * The real pages are read in English, where every component and markup
 * shape of the docs is (a translation keeps its English page's shape), and
 * in Japanese, Chinese and Persian for text in other scripts and written
 * right to left. jsdom parses about 2 MB of HTML a second, and all
 * seventeen languages are 73 MB: the other languages are left to the
 * helper's own tests and to the translation suites that read them.
 *
 * jsdom lives in Common's dependencies, which is why this runs in Common.
 */

// Every markup shape (English), and other scripts and directions.
const LANGUAGES_READ: Array<string> = ["en", "ja", "zh-CN", "fa"];

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

// The text of HTML as a browser reads it: every text node, entities read.
function browserText(html: string): string {
  return JSDOM.fragment(html).textContent || "";
}

function helperText(html: string): string {
  return browserText(stripHtmlTags(html));
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

describe("stripHtmlTags reads HTML as a browser does", () => {
  it.each([
    ["nested tags", "<p>Do <strong><em>this</em></strong> first.</p>"],
    ["adjacent and void tags", "<b>a</b><i>b</i>one<br>two<br/>three<hr />"],
    [
      "attributes with underscores",
      '<a class="docs-link" href="/docs/a_b">guide</a><img src="a__b.png" alt="a_b">',
    ],
    ["a double-quoted value holding '>'", '<a title="a > b">link</a> after'],
    ["a single-quoted value holding '>'", "<img alt='1 > 0'>after"],
    ["spaces around '='", "<a title = \"x>y\" class='p>q'>z</a>"],
    ["an unquoted value ending at '>'", "<a title=a>b>c"],
    [
      "a tag over several lines",
      '<a\n  href="/docs/a_b"\n  class="x">link</a>',
    ],
    ["a comment holding tags and '>'", "a<!-- x > y <b>z</b> -->b"],
    ["the shortest comments", "a<!-->b<!--->c<!---->d"],
    ["entities", "<p>use &lt;script&gt; &amp; &quot;quotes&quot; &#39;</p>"],
    [
      "Japanese, Chinese and Persian text",
      '<p><strong>リクエストタイムアウト（秒）</strong>を</p><p>尝试_之后_的</p><p dir="rtl">مانیتور <em>وب‌سایت</em></p>',
    ],
    ["'>' that closes nothing", "<p>A --&gt; B</p> a > b"],
  ])("on %s", (_case: string, html: string) => {
    expect(helperText(html)).toBe(browserText(html));
  });

  it("differs only on a '<' that is text, which the renderer never writes", () => {
    /*
     * A browser shows a "<" before a space or another "<" as text. The
     * helper reads every "<" as markup, so it never returns one; the docs
     * renderer writes a "<" that is text as "&lt;", so no page has one (the
     * pages below are read the same by both).
     */
    expect(browserText("a < b")).toBe("a < b");
    expect(helperText("a < b")).toBe("a  b");
    expect(browserText("<<b>script>")).toBe("<script>");
    expect(helperText("<<b>script>")).toBe("script>");
    expect(browserText("a &lt; b")).toBe(helperText("a &lt; b"));
  });

  it("finds the docs in every language, and reads the ones it names", () => {
    const languages: Array<string> = fs
      .readdirSync(DOCS_CONTENT_DIR, { withFileTypes: true })
      .filter((entry: fs.Dirent): boolean => {
        return entry.isDirectory();
      })
      .map((entry: fs.Dirent): string => {
        return entry.name;
      });

    expect(languages).toHaveLength(17);
    expect(languages).toEqual(expect.arrayContaining(LANGUAGES_READ));
  });

  it.each(LANGUAGES_READ)(
    "reads every %s docs page as a browser does",
    async (language: string) => {
      const pages: Array<string> = listPages(
        path.join(DOCS_CONTENT_DIR, language),
      );
      const differences: Array<string> = [];

      for (const page of pages) {
        // The body, as the docs route renders it: the title line is not drawn.
        const body: string = fs
          .readFileSync(page, "utf8")
          .split("\n")
          .slice(1)
          .join("\n");
        const html: string = await Markdown.convertToHTML(
          body,
          MarkdownContentType.Docs,
        );
        const expected: string = browserText(html);
        const actual: string = helperText(html);

        if (actual !== expected) {
          let at: number = 0;

          while (at < expected.length && expected[at] === actual[at]) {
            at++;
          }

          differences.push(
            `${path.relative(DOCS_CONTENT_DIR, page)} at ${at}: a browser reads ${JSON.stringify(expected.slice(at, at + 60))}, stripHtmlTags ${JSON.stringify(actual.slice(at, at + 60))}`,
          );
        }
      }

      expect(pages.length).toBeGreaterThan(100);
      expect(differences).toEqual([]);
    },
  );
});
