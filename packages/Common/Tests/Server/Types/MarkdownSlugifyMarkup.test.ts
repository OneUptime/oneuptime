import Markdown, { MarkdownContentType } from "../../../Server/Types/Markdown";
import slugify, {
  slugifyMarkdownHeading,
} from "../../../Server/Types/MarkdownSlugify";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * An anchor is made from a heading's HTML - inline code, emphasis and links
 * in it are tags by then - so slugify takes markup out first. It reads the
 * heading through removeHtmlMarkup (Common/Types/HtmlMarkup) now. One pass
 * of /<[^>]*>/ ended a tag at a ">" inside a quoted attribute value and a
 * comment at its first ">", so the rest of the value or the comment became
 * part of the anchor; the walk keeps only the text the reader sees.
 *
 * Anchors are published URLs, so the anchors of the headings the docs have
 * stay exactly as they were: the docs renderer writes no such markup in a
 * heading, and the suites that resolve every docs link hold that on the
 * real pages.
 */

const ANCHOR_CHARACTERS: RegExp = /^[\p{L}\p{N}\p{M}_-]*$/u;

describe("slugify reads a heading's text, not its markup", () => {
  test.each([
    ["a comment holding '>'", "Retry<!-- b > c -->Policy", "retrypolicy"],
    [
      "a quoted attribute value holding '>'",
      '<code title="a > b">helm</code> install',
      "helm-install",
    ],
    [
      "a single-quoted value holding '>'",
      "<a title='1 > 0' href='/docs/x'>Guide</a>",
      "guide",
    ],
    [
      "a comment holding a tag",
      "Setup <!-- <strong>draft</strong> > -->Steps",
      "setup-steps",
    ],
  ])("takes out %s whole", (_case: string, heading: string, anchor: string) => {
    expect(slugify(heading)).toBe(anchor);
  });

  test.each([
    ["a tag inside a tag's name", "<scr<script>ipt>Title", "ipttitle"],
    ["an overlapping comment", "<!<!---->--Title", "title"],
    ["an unclosed tag", "Title <script", "title-script"],
    ["a run of '<'", "<<<<Title", "title"],
    ["a tag before a tag", "<<script>script>Title", "scripttitle"],
  ])(
    "makes an anchor of letters, numbers and dashes from %s",
    (_case: string, heading: string, anchor: string) => {
      expect(slugify(heading)).toBe(anchor);
      expect(slugify(heading)).toMatch(ANCHOR_CHARACTERS);
    },
  );

  test.each([
    [
      '<code class="docs-code-inline">oneuptime &lt;resource&gt; list</code>',
      "oneuptime-resource-list",
    ],
    ['Install <code class="docs-code-inline">helm</code> 3', "install-helm-3"],
    ["<strong>Important</strong> notes", "important-notes"],
    [
      'Read the <a href="/docs/monitor/create-monitor">monitor guide</a> first',
      "read-the-monitor-guide-first",
    ],
    [
      '<em>Überprüfen</em> der <code class="docs-code-inline">ceph_health_status</code>',
      "überprüfen-der-ceph_health_status",
    ],
    ["Tom &amp; Jerry", "tom-jerry"],
    ["ログの<strong>重大度</strong>", "ログの重大度"],
  ])(
    "keeps the anchor of heading HTML the renderer writes: %s",
    (html: string, anchor: string) => {
      expect(slugify(html)).toBe(anchor);
      expect(Markdown.slugify(html)).toBe(anchor);
    },
  );

  test("gives a heading as written the anchor the renderer gives its HTML", async () => {
    /*
     * The docs renderer escapes raw HTML an author types (convertToHTML's
     * renderer.html), so a tag typed in a heading is text on the page and
     * its name stays in the anchor - as slugifyMarkdownHeading reads it.
     */
    for (const heading of [
      "`oneuptime <resource> list`",
      "Install `helm` 3",
      "**Important** notes",
      "Read the [monitor guide](/docs/monitor/create-monitor) first",
      "*Überprüfen* der `ceph_health_status`",
      "Tom & Jerry",
      "A <b>tag</b> typed in a heading",
      "Setup<br>Linux",
      "API <sup>beta</sup>",
      "Retry <!-- b > c --> Policy",
    ]) {
      const html: string = await Markdown.convertToHTML(
        `## ${heading}`,
        MarkdownContentType.Docs,
      );
      const id: RegExpMatchArray | null = html.match(/<h2 id="([^"]*)"/);

      expect(id).not.toBeNull();
      expect(slugifyMarkdownHeading(heading)).toBe(id![1]);
    }
  });
});

describe("MarkdownSlugify loads with the root install alone", () => {
  /*
   * The docs anchor scripts (Scripts/Docs) load it with nothing but the
   * repository's root npm install, in CI's lint job: it may import only
   * modules that import nothing themselves.
   */
  function importsOf(file: string): Array<string> {
    const source: ts.SourceFile = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );

    return source.statements
      .filter((statement: ts.Statement): boolean => {
        return ts.isImportDeclaration(statement);
      })
      .map((statement: ts.Statement): string => {
        return (
          (statement as ts.ImportDeclaration)
            .moduleSpecifier as ts.StringLiteral
        ).text;
      });
  }

  test("imports HtmlMarkup alone, which imports nothing", () => {
    const slugifyModule: string = path.resolve(
      __dirname,
      "../../../Server/Types/MarkdownSlugify.ts",
    );

    expect(importsOf(slugifyModule)).toEqual(["../../Types/HtmlMarkup"]);
    expect(
      importsOf(path.resolve(__dirname, "../../../Types/HtmlMarkup.ts")),
    ).toEqual([]);
  });
});
