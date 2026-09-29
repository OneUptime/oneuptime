import { describe, expect, it } from "@jest/globals";
import DOMPurify from "dompurify";
import { marked, Token, Tokens } from "marked";
import AffectedResourceList, {
  AffectedResourceListEntry,
} from "../../../Server/Utils/Monitor/AffectedResourceList";
import {
  htmlToMarkdown,
  markdownToHtml,
} from "../../../UI/Components/Markdown.tsx/MarkdownConverters";

/*
 * The markdown <-> HTML pair behind the WYSIWYG editor.
 *
 * Two things make this worth testing properly rather than spot-checking.
 *
 * The first is that the two directions are used in a loop: the editor renders
 * markdown to HTML into a contenteditable, the user types, and the result is
 * serialized back. A construct that survives one direction but not the other
 * silently rewrites a document every time somebody opens it, so the
 * round-trip block below is the point of this file rather than an extra.
 *
 * The second is that the HTML produced here is injected into the page. It is
 * passed through DOMPurify by the caller, but the converter must not be the
 * thing relying on that: text taken from the document has to arrive escaped.
 */

describe("markdownToHtml", () => {
  describe("empty input", () => {
    it("returns an empty string for an empty document", () => {
      expect(markdownToHtml("")).toBe("");
    });
  });

  describe("headings", () => {
    it("renders each of the six levels", () => {
      for (let level: number = 1; level <= 6; level++) {
        expect(markdownToHtml(`${"#".repeat(level)} Title`)).toBe(
          `<h${level}>Title</h${level}>`,
        );
      }
    });

    it("does not treat a seventh hash level as a heading", () => {
      expect(markdownToHtml("####### Title")).not.toContain("<h7>");
    });

    it("requires a space after the hashes", () => {
      expect(markdownToHtml("#NotAHeading")).toBe("<p>#NotAHeading</p>");
    });

    it("drops the closing hashes of a closed ATX heading", () => {
      expect(markdownToHtml("## Title ##")).toBe("<h2>Title</h2>");
    });

    it("renders inline markup inside a heading", () => {
      expect(markdownToHtml("# A **bold** title")).toBe(
        "<h1>A <strong>bold</strong> title</h1>",
      );
    });
  });

  describe("inline formatting", () => {
    it("renders bold with asterisks and with underscores", () => {
      expect(markdownToHtml("**a**")).toBe("<p><strong>a</strong></p>");
      expect(markdownToHtml("__a__")).toBe("<p><strong>a</strong></p>");
    });

    it("renders italic with a single asterisk and a single underscore", () => {
      expect(markdownToHtml("*a*")).toBe("<p><em>a</em></p>");
      expect(markdownToHtml("_a_")).toBe("<p><em>a</em></p>");
    });

    /*
     * Bold has to run before italic, or `**a**` is consumed as an empty
     * emphasis wrapping a stray asterisk.
     */
    it("does not let italic eat the inner half of a bold span", () => {
      expect(markdownToHtml("**bold**")).toBe("<p><strong>bold</strong></p>");
    });

    it("nests italic inside bold", () => {
      expect(markdownToHtml("**a *b* c**")).toBe(
        "<p><strong>a <em>b</em> c</strong></p>",
      );
    });

    it("renders strikethrough", () => {
      expect(markdownToHtml("~~gone~~")).toBe("<p><s>gone</s></p>");
    });

    it("renders inline code", () => {
      expect(markdownToHtml("`x`")).toBe("<p><code>x</code></p>");
    });

    /*
     * Inline code is literal. Running the inline pass over its contents would
     * turn a documented markdown snippet into rendered markup.
     */
    it("does not parse markdown inside inline code", () => {
      expect(markdownToHtml("`**not bold**`")).toBe(
        "<p><code>**not bold**</code></p>",
      );
    });

    it("escapes HTML inside inline code", () => {
      expect(markdownToHtml("`<script>`")).toBe(
        "<p><code>&lt;script&gt;</code></p>",
      );
    });

    it("keeps the small allowlist of inline tags a user may type", () => {
      expect(markdownToHtml("a <u>b</u> c")).toBe("<p>a <u>b</u> c</p>");
      expect(markdownToHtml("x<sub>1</sub>")).toBe("<p>x<sub>1</sub></p>");
      expect(markdownToHtml("press <kbd>K</kbd>")).toBe(
        "<p>press <kbd>K</kbd></p>",
      );
    });
  });

  describe("escaping", () => {
    /*
     * The output is injected into the page. DOMPurify runs after this, but
     * the converter must not be what makes the difference.
     */
    it("escapes a script tag in plain text", () => {
      const html: string = markdownToHtml("<script>alert(1)</script>");

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("escapes an img onerror payload in plain text", () => {
      const html: string = markdownToHtml('<img src=x onerror="alert(1)">');

      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;img");
    });

    it("escapes a quote in a link title attribute", () => {
      const html: string = markdownToHtml('[a](http://e.com "t\\"x")');

      expect(html).not.toContain('title="t""');
    });

    it("escapes an ampersand in link text", () => {
      expect(markdownToHtml("a & b")).toBe("<p>a &amp; b</p>");
    });

    it("escapes HTML inside a fenced code block", () => {
      expect(markdownToHtml("```\n<b>hi</b>\n```")).toBe(
        "<pre><code>&lt;b&gt;hi&lt;/b&gt;</code></pre>",
      );
    });
  });

  describe("links and images", () => {
    it("renders a link", () => {
      expect(markdownToHtml("[label](http://example.com)")).toBe(
        '<p><a href="http://example.com">label</a></p>',
      );
    });

    it("renders a link title", () => {
      expect(markdownToHtml('[label](http://example.com "hi")')).toBe(
        '<p><a href="http://example.com" title="hi">label</a></p>',
      );
    });

    it("renders inline markup inside a link label", () => {
      expect(markdownToHtml("[**bold**](http://example.com)")).toBe(
        '<p><a href="http://example.com"><strong>bold</strong></a></p>',
      );
    });

    it("renders an image", () => {
      expect(markdownToHtml("![alt](http://example.com/a.png)")).toBe(
        '<p><img alt="alt" src="http://example.com/a.png"></p>',
      );
    });

    /* An image is a link with a bang, so the image rule must run first. */
    it("does not render an image as a link", () => {
      expect(markdownToHtml("![alt](http://example.com/a.png)")).not.toContain(
        "<a ",
      );
    });

    it("renders an image with an empty alt", () => {
      expect(markdownToHtml("![](http://example.com/a.png)")).toBe(
        '<p><img alt="" src="http://example.com/a.png"></p>',
      );
    });
  });

  describe("code blocks", () => {
    it("renders a fenced block with no language", () => {
      expect(markdownToHtml("```\nx = 1\n```")).toBe(
        "<pre><code>x = 1</code></pre>",
      );
    });

    it("carries the language onto the code element", () => {
      expect(markdownToHtml("```ts\nx = 1\n```")).toBe(
        '<pre><code class="language-ts">x = 1</code></pre>',
      );
    });

    it("keeps blank lines inside a fenced block", () => {
      expect(markdownToHtml("```\na\n\nb\n```")).toBe(
        "<pre><code>a\n\nb</code></pre>",
      );
    });

    it("closes an unterminated fence at the end of the document", () => {
      expect(markdownToHtml("```\na")).toBe("<pre><code>a</code></pre>");
    });

    /* A fence must end the paragraph above it rather than joining it. */
    it("ends the paragraph above a fence", () => {
      expect(markdownToHtml("text\n```\na\n```")).toBe(
        "<p>text</p><pre><code>a</code></pre>",
      );
    });
  });

  describe("lists", () => {
    it("renders an unordered list", () => {
      expect(markdownToHtml("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    });

    it("accepts every unordered bullet character", () => {
      expect(markdownToHtml("* a")).toBe("<ul><li>a</li></ul>");
      expect(markdownToHtml("+ a")).toBe("<ul><li>a</li></ul>");
    });

    it("renders an ordered list", () => {
      expect(markdownToHtml("1. a\n2. b")).toBe(
        "<ol><li>a</li><li>b</li></ol>",
      );
    });

    /*
     * Switching marker kind starts a new list. Without that break an ordered
     * item would be swallowed into the unordered list above it.
     */
    it("starts a new list when the marker kind changes", () => {
      expect(markdownToHtml("- a\n1. b")).toBe(
        "<ul><li>a</li></ul><ol><li>b</li></ol>",
      );
    });

    it("renders a task list", () => {
      const html: string = markdownToHtml("- [ ] a\n- [x] b");

      expect(html).toContain('<ul class="task-list">');
      expect(html).toContain('<li class="task-list-item">');
      expect(html).toContain("checked");
    });

    it("accepts an upper-case task marker", () => {
      expect(markdownToHtml("- [X] a")).toContain("checked");
    });

    /* WCAG 4.1.2: the disabled checkbox needs an accessible name. */
    it("gives a task checkbox an accessible name from its label", () => {
      expect(markdownToHtml("- [ ] Deploy the thing")).toContain(
        'aria-label="Deploy the thing"',
      );
    });

    it("falls back to a generic accessible name for an empty task", () => {
      expect(markdownToHtml("- [ ] ")).not.toContain('aria-label=""');
    });

    it("renders inline markup inside a list item", () => {
      expect(markdownToHtml("- a **b**")).toBe(
        "<ul><li>a <strong>b</strong></li></ul>",
      );
    });

    /*
     * An ordered list that does not start at one keeps its first number, so
     * the serializer can write the same numbers back.
     */
    it("records a first marker other than one as the list's start", () => {
      expect(markdownToHtml("3. a\n4. b")).toBe(
        '<ol start="3"><li>a</li><li>b</li></ol>',
      );
    });

    it("does not add a start attribute to a list that starts at one", () => {
      expect(markdownToHtml("1. a")).not.toContain("start=");
    });

    it("keeps an indented continuation line inside its item", () => {
      expect(markdownToHtml("- a\n  b")).toBe("<ul><li>a<br>b</li></ul>");
    });

    /*
     * The fixed two-space indent this converter used to write under every
     * marker. Two spaces is short of the content column of "1.", but a plain
     * line indented past the marker still continues the item (CommonMark's
     * lazy continuation), so documents saved that way read back whole.
     */
    it("keeps a continuation line indented short of the content column", () => {
      expect(markdownToHtml("1. a\n  b")).toBe("<ol><li>a<br>b</li></ol>");
    });

    it("ends the list at a blank line followed by unindented text", () => {
      expect(markdownToHtml("- a\n\nb")).toBe("<ul><li>a</li></ul><p>b</p>");
    });
  });

  /*
   * Nesting follows CommonMark, as marked (the email renderer) does: a line
   * belongs to an item when it is indented to the item's content column --
   * the marker's indent, plus the marker, plus one space.
   */
  describe("nested lists", () => {
    it("nests a bullet list indented to an ordered item's content column", () => {
      expect(markdownToHtml("1. a\n   - b\n   - c\n2. d")).toBe(
        "<ol><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ol>",
      );
    });

    it("nests a bullet list in a bullet list", () => {
      expect(markdownToHtml("- a\n  - b\n- c")).toBe(
        "<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>",
      );
    });

    it("nests an ordered list in a bullet list", () => {
      expect(markdownToHtml("- a\n  1. b\n  2. c")).toBe(
        "<ul><li>a<ol><li>b</li><li>c</li></ol></li></ul>",
      );
    });

    it("nests three levels deep", () => {
      expect(markdownToHtml("- a\n  - b\n    - c\n- d")).toBe(
        "<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>",
      );
    });

    /* Four columns under "10.", not three. */
    it("uses the wider content column of a two-digit marker", () => {
      expect(markdownToHtml("10. a\n    - b")).toBe(
        '<ol start="10"><li>a<ul><li>b</li></ul></li></ol>',
      );
    });

    /*
     * Three spaces is short of the content column of "10.", so the bullet is
     * a sibling of the item, of the other kind, and starts a new list. That
     * is how marked reads it too, and why AffectedResourceList indents item
     * 10's details by four.
     */
    it("does not nest a list indented short of the content column", () => {
      expect(markdownToHtml("10. a\n   - b")).toBe(
        '<ol start="10"><li>a</li></ol><ul><li>b</li></ul>',
      );
    });

    /*
     * The regression. Changing marker kind used to end the list at any
     * depth, so each item of a ranked list with bullet details became a
     * one-item <ol> with its details stranded in a <ul> after it.
     */
    it("keeps one ordered list when its items carry bullet lists", () => {
      const html: string = markdownToHtml(
        "1. a\n   - x\n2. b\n   - y\n3. c\n   - z",
      );

      expect(html).toBe(
        "<ol>" +
          "<li>a<ul><li>x</li></ul></li>" +
          "<li>b<ul><li>y</li></ul></li>" +
          "<li>c<ul><li>z</li></ul></li>" +
          "</ol>",
      );
    });

    it("still ends a nested list on a marker change at its own indentation", () => {
      expect(markdownToHtml("- a\n  - b\n  1. c")).toBe(
        "<ul><li>a<ul><li>b</li></ul><ol><li>c</li></ol></li></ul>",
      );
    });

    it("nests a tab-indented list", () => {
      expect(markdownToHtml("1. a\n\t- b")).toBe(
        "<ol><li>a<ul><li>b</li></ul></li></ol>",
      );
    });

    it("keeps an indented list after a blank line inside the item", () => {
      expect(markdownToHtml("- a\n\n  - b")).toBe(
        "<ul><li>a<ul><li>b</li></ul></li></ul>",
      );
    });

    it("keeps text after a nested list inside the item", () => {
      expect(markdownToHtml("- a\n  - b\n\n  c")).toBe(
        "<ul><li>a<ul><li>b</li></ul><p>c</p></li></ul>",
      );
    });

    /*
     * What the serializer writes for an item whose own text was deleted and
     * only its nested list is left.
     */
    it("reads an item that opens straight onto a marker as a nested list", () => {
      expect(markdownToHtml("1. - a\n   - b")).toBe(
        "<ol><li><ul><li>a</li><li>b</li></ul></li></ol>",
      );
    });

    it("nests a list under a task item", () => {
      const html: string = markdownToHtml("- [ ] a\n  - b");

      expect(html).toContain('<ul class="task-list">');
      expect(html).toContain("> a<ul><li>b</li></ul></li></ul>");
    });

    it("renders inline markup inside a nested item", () => {
      expect(markdownToHtml("1. a\n   - Node: `n-1`")).toBe(
        "<ol><li>a<ul><li>Node: <code>n-1</code></li></ul></li></ol>",
      );
    });

    it("escapes HTML inside a nested item", () => {
      const html: string = markdownToHtml("- a\n  - <script>alert(1)</script>");

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("renders a fenced block nested in an item", () => {
      expect(markdownToHtml("- a\n  ```\n  x\n\n  y\n  ```")).toBe(
        "<ul><li>a<pre><code>x\n\ny</code></pre></li></ul>",
      );
    });
  });

  describe("blockquotes", () => {
    it("renders a single quoted line", () => {
      expect(markdownToHtml("> hi")).toBe("<blockquote><p>hi</p></blockquote>");
    });

    it("joins contiguous quoted lines into one quote", () => {
      expect(markdownToHtml("> a\n> b")).toBe(
        "<blockquote><p>a<br>b</p></blockquote>",
      );
    });

    it("ends a quote at the first unquoted line", () => {
      expect(markdownToHtml("> a\nb")).toBe(
        "<blockquote><p>a</p></blockquote><p>b</p>",
      );
    });
  });

  describe("horizontal rules", () => {
    it("accepts each rule spelling", () => {
      expect(markdownToHtml("---")).toBe("<hr>");
      expect(markdownToHtml("***")).toBe("<hr>");
      expect(markdownToHtml("___")).toBe("<hr>");
    });
  });

  describe("tables", () => {
    it("renders a GFM table", () => {
      expect(markdownToHtml("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(
        "<table><thead><tr><th>a</th><th>b</th></tr></thead>" +
          "<tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
      );
    });

    it("accepts an alignment row", () => {
      expect(markdownToHtml("| a | b |\n| :-- | --: |\n| 1 | 2 |")).toContain(
        "<table>",
      );
    });

    /*
     * A pipe in a paragraph is not a table. Without the separator check the
     * next line would be eaten as a header row.
     */
    it("does not treat a bare pipe line as a table", () => {
      expect(markdownToHtml("a | b\nplain text")).toBe(
        "<p>a | b<br>plain text</p>",
      );
    });

    it("pads a short row out to the header width", () => {
      expect(markdownToHtml("| a | b |\n| --- | --- |\n| 1 |")).toContain(
        "<td>1</td><td></td>",
      );
    });

    it("renders inline markup inside a cell", () => {
      expect(
        markdownToHtml("| a | b |\n| --- | --- |\n| **c** | d |"),
      ).toContain("<td><strong>c</strong></td>");
    });

    /*
     * Regression. `tableToMarkdown` happily emits a one column table, so the
     * editor's render/serialize loop feeds one straight back in. While the
     * delimiter row needed two or more columns to match, that table came back
     * as a paragraph and the document lost its table on every reopen.
     */
    it("recognises a one column table", () => {
      expect(markdownToHtml("| a |\n| --- |\n| 1 |")).toBe(
        "<table><thead><tr><th>a</th></tr></thead>" +
          "<tbody><tr><td>1</td></tr></tbody></table>",
      );
    });

    /*
     * The other side of that change. Relaxing the delimiter row to allow a
     * single column also lets a bare `---` match the pattern, so a rule under
     * a line containing a pipe must still be a rule.
     */
    it("still treats a bare rule under a piped line as a rule", () => {
      expect(markdownToHtml("a | b\n---")).toBe("<p>a | b</p><hr>");
    });
  });

  describe("paragraphs", () => {
    it("joins wrapped lines with a break", () => {
      expect(markdownToHtml("a\nb")).toBe("<p>a<br>b</p>");
    });

    it("splits paragraphs on a blank line", () => {
      expect(markdownToHtml("a\n\nb")).toBe("<p>a</p><p>b</p>");
    });

    it("normalizes CRLF line endings", () => {
      expect(markdownToHtml("a\r\n\r\nb")).toBe("<p>a</p><p>b</p>");
    });

    it("normalizes a lone CR", () => {
      expect(markdownToHtml("a\rb")).toBe("<p>a<br>b</p>");
    });
  });
});

describe("htmlToMarkdown", () => {
  describe("empty input", () => {
    it("returns an empty string for empty HTML", () => {
      expect(htmlToMarkdown("")).toBe("");
    });
  });

  describe("blocks", () => {
    it("serializes each heading level", () => {
      for (let level: number = 1; level <= 6; level++) {
        expect(htmlToMarkdown(`<h${level}>T</h${level}>`)).toBe(
          `${"#".repeat(level)} T`,
        );
      }
    });

    it("serializes a paragraph", () => {
      expect(htmlToMarkdown("<p>a</p>")).toBe("a");
    });

    it("serializes a horizontal rule", () => {
      expect(htmlToMarkdown("<hr>")).toBe("---");
    });

    it("turns a break into a newline", () => {
      expect(htmlToMarkdown("<p>a<br>b</p>")).toBe("a\nb");
    });

    it("serializes a blockquote with a marker on every line", () => {
      expect(htmlToMarkdown("<blockquote><p>a<br>b</p></blockquote>")).toBe(
        "> a\n> b",
      );
    });

    it("collapses runs of blank lines", () => {
      expect(htmlToMarkdown("<p>a</p><p>b</p>")).toBe("a\n\nb");
    });
  });

  describe("inline", () => {
    it("serializes both spellings of bold", () => {
      expect(htmlToMarkdown("<p><strong>a</strong></p>")).toBe("**a**");
      expect(htmlToMarkdown("<p><b>a</b></p>")).toBe("**a**");
    });

    it("serializes both spellings of italic", () => {
      expect(htmlToMarkdown("<p><em>a</em></p>")).toBe("*a*");
      expect(htmlToMarkdown("<p><i>a</i></p>")).toBe("*a*");
    });

    it("serializes every spelling of strikethrough", () => {
      expect(htmlToMarkdown("<p><s>a</s></p>")).toBe("~~a~~");
      expect(htmlToMarkdown("<p><del>a</del></p>")).toBe("~~a~~");
      expect(htmlToMarkdown("<p><strike>a</strike></p>")).toBe("~~a~~");
    });

    /* Underline has no markdown spelling, so it stays as a tag. */
    it("keeps underline as an HTML tag", () => {
      expect(htmlToMarkdown("<p><u>a</u></p>")).toBe("<u>a</u>");
    });

    it("keeps sub, sup and kbd as HTML tags", () => {
      expect(htmlToMarkdown("<p><sub>a</sub></p>")).toBe("<sub>a</sub>");
      expect(htmlToMarkdown("<p><sup>a</sup></p>")).toBe("<sup>a</sup>");
      expect(htmlToMarkdown("<p><kbd>a</kbd></p>")).toBe("<kbd>a</kbd>");
    });

    it("serializes inline code", () => {
      expect(htmlToMarkdown("<p><code>a</code></p>")).toBe("`a`");
    });

    it("serializes a link", () => {
      expect(htmlToMarkdown('<p><a href="http://e.com">a</a></p>')).toBe(
        "[a](http://e.com)",
      );
    });

    it("falls back to the href when a link has no text", () => {
      expect(htmlToMarkdown('<p><a href="http://e.com"></a></p>')).toBe(
        "[http://e.com](http://e.com)",
      );
    });

    it("drops the link syntax when there is no href", () => {
      expect(htmlToMarkdown("<p><a>a</a></p>")).toBe("a");
    });

    it("serializes an image", () => {
      expect(htmlToMarkdown('<p><img alt="a" src="b.png"></p>')).toBe(
        "![a](b.png)",
      );
    });

    it("serializes an image title", () => {
      expect(htmlToMarkdown('<p><img alt="a" src="b.png" title="t"></p>')).toBe(
        '![a](b.png "t")',
      );
    });
  });

  describe("code blocks", () => {
    it("serializes a pre/code pair", () => {
      expect(htmlToMarkdown("<pre><code>x = 1</code></pre>")).toBe(
        "```\nx = 1\n```",
      );
    });

    it("recovers the language from the code class", () => {
      expect(
        htmlToMarkdown('<pre><code class="language-ts">x</code></pre>'),
      ).toBe("```ts\nx\n```");
    });

    /* The text is already literal; re-escaping it would corrupt the source. */
    it("does not escape the contents of a code block", () => {
      expect(htmlToMarkdown("<pre><code>a &lt; b</code></pre>")).toBe(
        "```\na < b\n```",
      );
    });
  });

  describe("lists", () => {
    it("serializes an unordered list", () => {
      expect(htmlToMarkdown("<ul><li>a</li><li>b</li></ul>")).toBe("- a\n- b");
    });

    it("numbers an ordered list from one regardless of the source numbers", () => {
      expect(htmlToMarkdown("<ol><li>a</li><li>b</li><li>c</li></ol>")).toBe(
        "1. a\n2. b\n3. c",
      );
    });

    it("serializes a task list back to its markers", () => {
      expect(
        htmlToMarkdown(
          '<ul class="task-list">' +
            '<li class="task-list-item"><input type="checkbox" disabled> a</li>' +
            '<li class="task-list-item"><input type="checkbox" disabled checked> b</li>' +
            "</ul>",
        ),
      ).toBe("- [ ] a\n- [x] b");
    });

    it("drops a bare checkbox that is not inside a list item", () => {
      const md: string = htmlToMarkdown('<p><input type="checkbox"> a</p>');

      expect(md).not.toContain("[ ]");
      expect(md.trim()).toBe("a");
    });

    it("ignores a non-li child of a list", () => {
      expect(htmlToMarkdown("<ul><span>x</span><li>a</li></ul>")).toBe("- a");
    });

    /* A continuation line has to be indented or it leaves the item. */
    it("indents a continuation line so it stays inside its item", () => {
      expect(htmlToMarkdown("<ul><li>a<br>b</li></ul>")).toBe("- a\n  b");
    });

    it("indents a continuation line by the width of an ordered marker", () => {
      expect(htmlToMarkdown("<ol><li>a<br>b</li></ol>")).toBe("1. a\n   b");
    });

    it("starts numbering at the list's start attribute", () => {
      expect(htmlToMarkdown('<ol start="3"><li>a</li><li>b</li></ol>')).toBe(
        "3. a\n4. b",
      );
    });

    it("keeps a start of zero", () => {
      expect(htmlToMarkdown('<ol start="0"><li>a</li></ol>')).toBe("0. a");
    });

    it("numbers from one when the start attribute is not a number", () => {
      expect(htmlToMarkdown('<ol start="x"><li>a</li></ol>')).toBe("1. a");
      expect(htmlToMarkdown('<ol start="-2"><li>a</li></ol>')).toBe("1. a");
    });

    /*
     * A nested list is indented to its item's content column -- three
     * spaces under "1. ". The old fixed two spaces put it outside the item.
     */
    it("indents a nested list by the width of its item's marker", () => {
      expect(htmlToMarkdown("<ol><li>a<ul><li>b</li></ul></li></ol>")).toBe(
        "1. a\n   - b",
      );
    });

    it("indents a nested list by four under a two-digit marker", () => {
      expect(
        htmlToMarkdown(
          '<ol start="9"><li>a<ul><li>x</li></ul></li><li>b<ul><li>y</li></ul></li></ol>',
        ),
      ).toBe("9. a\n   - x\n10. b\n    - y");
    });

    /*
     * No blank line either side of a nested list: that would make the list
     * loose and, between items, read as the end of the outer list.
     */
    it("keeps a nested list tight inside its item", () => {
      expect(
        htmlToMarkdown("<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>"),
      ).toBe("- a\n  - b\n- c");
    });

    it("indents every level of a deep nest", () => {
      expect(
        htmlToMarkdown(
          "<ul><li>a<ol><li>b<ul><li>c</li></ul></li></ol></li></ul>",
        ),
      ).toBe("- a\n  1. b\n     - c");
    });

    it("indents a list nested under a task item by the bullet's width", () => {
      expect(
        htmlToMarkdown(
          '<ul class="task-list"><li class="task-list-item">' +
            '<input type="checkbox" disabled> a<ul><li>b</li></ul></li></ul>',
        ),
      ).toBe("- [ ] a\n  - b");
    });

    it("does not pad a blank line inside an item with spaces", () => {
      const md: string = htmlToMarkdown(
        "<ul><li>a<ul><li>b</li></ul><p>c</p></li></ul>",
      );

      expect(md).toBe("- a\n  - b\n\n  c");
    });
  });

  describe("tables", () => {
    it("serializes a table to a padded GFM table", () => {
      expect(
        htmlToMarkdown(
          "<table><thead><tr><th>a</th><th>b</th></tr></thead>" +
            "<tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
        ),
      ).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |");
    });

    it("widens a column to its longest cell", () => {
      const md: string = htmlToMarkdown(
        "<table><tr><th>a</th></tr><tr><td>longer</td></tr></table>",
      );

      expect(md).toContain("| a      |");
      expect(md).toContain("| longer |");
    });

    /* An unescaped pipe in a cell would split it into two columns. */
    it("escapes a pipe inside a cell", () => {
      expect(htmlToMarkdown("<table><tr><th>a|b</th></tr></table>")).toContain(
        "a\\|b",
      );
    });

    it("flattens a newline inside a cell", () => {
      expect(
        htmlToMarkdown("<table><tr><th>a<br>b</th></tr></table>"),
      ).toContain("| a b |");
    });

    it("returns nothing for a table with no rows", () => {
      expect(htmlToMarkdown("<table></table>")).toBe("");
    });
  });

  describe("unknown elements", () => {
    it("keeps the text of an element it does not know", () => {
      expect(htmlToMarkdown("<p><span>a</span></p>")).toBe("a");
    });

    it("keeps the text of a div", () => {
      expect(htmlToMarkdown("<div>a</div>")).toBe("a");
    });

    it("drops a comment node", () => {
      expect(htmlToMarkdown("<p>a<!-- note --></p>")).toBe("a");
    });
  });
});

/*
 * The property that actually matters. The editor renders markdown into a
 * contenteditable and serializes it back on every change, so anything that
 * does not survive the loop is a document the editor silently rewrites.
 */
describe("markdown round trip", () => {
  const cases: Array<{ name: string; markdown: string }> = [
    { name: "a heading", markdown: "# Title" },
    { name: "a deep heading", markdown: "###### Title" },
    { name: "a paragraph", markdown: "Just some text." },
    { name: "bold", markdown: "**bold**" },
    { name: "italic", markdown: "*italic*" },
    { name: "strikethrough", markdown: "~~gone~~" },
    { name: "inline code", markdown: "`code`" },
    { name: "underline", markdown: "<u>under</u>" },
    { name: "a link", markdown: "[label](http://example.com)" },
    { name: "an image", markdown: "![alt](http://example.com/a.png)" },
    { name: "a rule", markdown: "---" },
    { name: "an unordered list", markdown: "- a\n- b" },
    { name: "an ordered list", markdown: "1. a\n2. b" },
    { name: "a task list", markdown: "- [ ] a\n- [x] b" },
    { name: "a blockquote", markdown: "> quoted" },
    { name: "a fenced block", markdown: "```\nx = 1\n```" },
    { name: "a fenced block with a language", markdown: "```ts\nx = 1\n```" },
    { name: "two paragraphs", markdown: "one\n\ntwo" },
    { name: "mixed inline markup", markdown: "a **b** and *c* and `d`" },
  ];

  for (const testCase of cases) {
    it(`preserves ${testCase.name}`, () => {
      const once: string = htmlToMarkdown(markdownToHtml(testCase.markdown));

      expect(once).toBe(testCase.markdown);
    });
  }

  /*
   * Tables are padded on the way back, so they do not round trip
   * character-for-character. What must hold is that the SECOND pass is a
   * no-op -- otherwise the document grows every time it is opened.
   */
  it("preserves a one column table across the loop", () => {
    const first: string = htmlToMarkdown(
      markdownToHtml("| a |\n| --- |\n| 1 |"),
    );

    expect(markdownToHtml(first)).toContain("<table>");
    expect(htmlToMarkdown(markdownToHtml(first))).toBe(first);
  });

  it("reaches a fixed point for a table after one pass", () => {
    const first: string = htmlToMarkdown(
      markdownToHtml("| a | b |\n| --- | --- |\n| 1 | 2 |"),
    );
    const second: string = htmlToMarkdown(markdownToHtml(first));

    expect(second).toBe(first);
  });

  it("reaches a fixed point for a mixed document after one pass", () => {
    const source: string = [
      "# Title",
      "",
      "Some **bold** text with a [link](http://example.com).",
      "",
      "- one",
      "- two",
      "",
      "> a quote",
      "",
      "```ts",
      "const x: number = 1;",
      "```",
    ].join("\n");

    const first: string = htmlToMarkdown(markdownToHtml(source));
    const second: string = htmlToMarkdown(markdownToHtml(first));

    expect(second).toBe(first);
  });

  /*
   * The loop must not be able to promote text into markup. A user who typed
   * a literal angle bracket must still have one after a save and a reopen.
   */
  it("does not turn escaped text into live markup across a round trip", () => {
    const html: string = markdownToHtml(
      htmlToMarkdown(markdownToHtml("<script>alert(1)</script>")),
    );

    expect(html).not.toContain("<script>");
  });
});

/*
 * The same property for nested lists, which the loop used to take apart:
 * a change of marker kind ended the list at any depth, and the serializer
 * numbered every <ol> from one and indented by a fixed two spaces.
 */
describe("nested list round trip", () => {
  const cases: Array<{ name: string; markdown: string }> = [
    { name: "a bullet list in a bullet list", markdown: "- a\n  - b\n- c" },
    {
      name: "an ordered list in a bullet list",
      markdown: "- a\n  1. b\n  2. c\n- d",
    },
    {
      name: "a bullet list in an ordered list",
      markdown: "1. a\n   - b\n2. c\n   - d",
    },
    { name: "three levels", markdown: "- a\n  - b\n    - c\n- d" },
    {
      name: "three levels of mixed kinds",
      markdown: "1. a\n   - b\n     1. c\n2. d",
    },
    { name: "a list that starts at three", markdown: "3. a\n4. b" },
    { name: "an ordered list split by a blank line", markdown: "1. a\n\n2. b" },
    {
      name: "a nested list under a two-digit marker",
      markdown: "9. a\n   - x\n10. b\n    - y",
    },
    { name: "a continuation line in an ordered item", markdown: "1. a\n   b" },
    {
      name: "a task list with a nested list",
      markdown: "- [ ] a\n  - b\n- [x] c",
    },
    {
      name: "a nested list after a paragraph",
      markdown: "Intro\n\n1. a\n   - b",
    },
    {
      name: "a paragraph after a nested list",
      markdown: "1. a\n   - b\n\nOutro",
    },
    { name: "an item that is only a nested list", markdown: "1. - a\n   - b" },
  ];

  for (const testCase of cases) {
    it(`preserves ${testCase.name}`, () => {
      const once: string = htmlToMarkdown(markdownToHtml(testCase.markdown));

      expect(once).toBe(testCase.markdown);
    });
  }

  it("preserves an ol start attribute through markdown and back", () => {
    const html: string = '<ol start="3"><li>a</li><li>b</li></ol>';
    const markdown: string = htmlToMarkdown(html);

    expect(markdown).toBe("3. a\n4. b");
    expect(markdownToHtml(markdown)).toBe(html);

    // And marked, which renders the same markdown into emails, agrees.
    const list: Tokens.List = marked.lexer(markdown)[0] as Tokens.List;

    expect(list.type).toBe("list");
    expect(list.start).toBe(3);
  });

  /*
   * Markdown the serializer would not have written itself -- a blank line
   * inside the item, a deeper indent, another bullet character -- is
   * normalised on the first pass and left alone after that.
   */
  it("reaches a fixed point for loosely written nested lists", () => {
    for (const source of ["- a\n\n  - b", "* a\n    * b", "1. a\n    - b"]) {
      const first: string = htmlToMarkdown(markdownToHtml(source));
      const second: string = htmlToMarkdown(markdownToHtml(first));

      expect(markdownToHtml(first)).toContain("<li>a<ul><li>b</li></ul></li>");
      expect(second).toBe(first);
    }
  });
});

/*
 * The document that exposed all of this. Platform monitors (Kubernetes,
 * Proxmox, VMware, ...) write an "Affected Resources" block into the root
 * cause of the incidents and alerts they open: a ranked ordered list whose
 * items each own a bullet list of details. "Edit Root Cause" opens it in this
 * editor, and before nested lists were supported the first keystroke saved
 * it back with every resource numbered "1." and its details detached.
 */
describe("Affected Resources block in the editor", () => {
  const code: (value: string) => string = (value: string): string => {
    return AffectedResourceList.code(value);
  };

  const podEntries: (count: number) => Array<AffectedResourceListEntry> = (
    count: number,
  ): Array<AffectedResourceListEntry> => {
    const result: Array<AffectedResourceListEntry> = [
      {
        kind: "Pod",
        name: code("oneuptime-migrate-267-k64qm"),
        value: "**3**",
        details: [
          { label: "Namespace", value: code("default") },
          { label: "Job", value: code("oneuptime-migrate-267") },
          {
            label: "Node",
            value: code("gke-gke-test-cluster-default-pool-662f6819-c6w3"),
          },
        ],
      },
    ];

    for (let i: number = 2; i <= count; i++) {
      result.push({
        kind: "Pod",
        name: code(`kube-dns-autoscaler-859854db85-gg5x${i}`),
        value: `**${i % 3 === 0 ? 1 : 2}**`,
        details: [
          { label: "Namespace", value: code("kube-system") },
          // An empty detail is dropped by the renderer.
          { label: "Deployment", value: i % 2 === 0 ? code("kube-dns") : "" },
          {
            label: "Node",
            value: code(`gke-gke-test-cluster-db-pool-3e2bfa3b-du6${i}`),
          },
        ],
      });
    }

    return result;
  };

  const renderBlock: (count: number, totalCount: number) => string = (
    count: number,
    totalCount: number,
  ): string => {
    return AffectedResourceList.render({
      heading: "Affected Resources",
      overflowNoun: "affected resources",
      totalCount,
      entries: podEntries(count),
    });
  };

  // A root cause as a monitor saves it: a sentence, then the block.
  const rootCause: (count: number, totalCount: number) => string = (
    count: number,
    totalCount: number,
  ): string => {
    return `Pods are restarting in cluster \`gke-test\`.${renderBlock(count, totalCount)}`;
  };

  // The sanitizer config of MarkdownEditor.tsx; its URI rule is not relevant here.
  const sanitize: (html: string) => string = (html: string): string => {
    return DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
  };

  // Top-level block tokens as marked (the email renderer) sees them.
  const blockTokens: (markdown: string) => Array<Token> = (
    markdown: string,
  ): Array<Token> => {
    return marked.lexer(markdown).filter((token: Token): boolean => {
      return token.type !== "space";
    });
  };

  /*
   * marked must read the re-serialized markdown as ONE ordered list, with
   * every item owning a nested bullet list. A string that merely looks right
   * can still parse as a run of one-item lists.
   */
  const expectOneRankedList: (
    markdown: string,
    entries: Array<AffectedResourceListEntry>,
  ) => void = (
    markdown: string,
    entries: Array<AffectedResourceListEntry>,
  ): void => {
    const lists: Array<Tokens.List> = blockTokens(markdown).filter(
      (token: Token): boolean => {
        return token.type === "list";
      },
    ) as Array<Tokens.List>;

    expect(lists).toHaveLength(1);

    const list: Tokens.List = lists[0] as Tokens.List;

    expect(list.ordered).toBe(true);
    expect(list.start).toBe(1);
    expect(list.items).toHaveLength(entries.length);

    list.items.forEach((item: Tokens.ListItem, index: number): void => {
      const nested: Array<Tokens.List> = item.tokens.filter(
        (token: Token): boolean => {
          return token.type === "list";
        },
      ) as Array<Tokens.List>;
      const expectedDetails: number = (entries[index]?.details || []).filter(
        (detail: { value: string }): boolean => {
          return detail.value.length > 0;
        },
      ).length;

      expect(nested).toHaveLength(1);
      expect(nested[0]?.ordered).toBe(false);
      expect(nested[0]?.items).toHaveLength(expectedDetails);
    });
  };

  it("round trips a three-entry block unchanged", () => {
    const block: string = renderBlock(3, 3);
    const once: string = htmlToMarkdown(markdownToHtml(block));

    // A document's leading blank lines are dropped, as for any document.
    expect(once).toBe(block.replace(/^\n+/, ""));
    expectOneRankedList(once, podEntries(3));
  });

  it("round trips a ten-entry block with its overflow line unchanged", () => {
    const block: string = renderBlock(10, 83);
    const once: string = htmlToMarkdown(markdownToHtml(block));

    expect(block).toContain("\n10. **Pod**");
    expect(block).toContain("\n    - Namespace:");
    expect(block).toContain("*... and 73 more affected resources*");
    expect(once).toBe(block.replace(/^\n+/, ""));
    expectOneRankedList(once, podEntries(10));
  });

  it("round trips a whole root cause unchanged", () => {
    const source: string = rootCause(10, 83);

    expect(htmlToMarkdown(markdownToHtml(source))).toBe(source);
  });

  it("renders the block as one ordered list whose items own their details", () => {
    const container: HTMLDivElement = document.createElement("div");
    container.innerHTML = markdownToHtml(renderBlock(10, 83));

    const topLevelLists: NodeListOf<Element> = container.querySelectorAll(
      ":scope > ol, :scope > ul",
    );

    expect(topLevelLists).toHaveLength(1);

    const list: Element = topLevelLists[0] as Element;

    expect(list.tagName).toBe("OL");
    expect(list.hasAttribute("start")).toBe(false);

    const items: NodeListOf<Element> = list.querySelectorAll(":scope > li");

    expect(items).toHaveLength(10);

    items.forEach((item: Element): void => {
      const details: NodeListOf<Element> = item.querySelectorAll(":scope > ul");

      expect(details).toHaveLength(1);
      expect(details[0]?.querySelector(":scope > li")?.textContent).toMatch(
        /^Namespace: /,
      );
    });

    // The heading and the overflow line stay paragraphs around the list.
    expect(container.firstElementChild?.tagName).toBe("P");
    expect(container.lastElementChild?.tagName).toBe("P");
    expect(container.lastElementChild?.textContent).toBe(
      "... and 73 more affected resources",
    );
  });

  /*
   * The editor sanitizes before injecting. DOMPurify's default allowlist
   * keeps nested lists and the start attribute; if it ever stopped doing so
   * the round trip would lose them there instead of here.
   */
  it("survives the editor's sanitizer unchanged", () => {
    const html: string = markdownToHtml(rootCause(10, 83));

    expect(sanitize(html)).toBe(html);
    expect(sanitize(markdownToHtml("3. a\n4. b"))).toContain('<ol start="3">');
  });

  /*
   * What "Edit Root Cause" actually does: render into the contenteditable,
   * let the user type, serialize. Adding a note after the list must not
   * renumber the list or detach any item's details.
   */
  it("keeps numbering and nesting when the user adds a paragraph", () => {
    const source: string = rootCause(10, 83);
    const editable: HTMLDivElement = document.createElement("div");
    editable.innerHTML = sanitize(markdownToHtml(source));

    const note: HTMLParagraphElement = document.createElement("p");
    note.textContent = "Rolled back the migration job.";
    editable.appendChild(note);

    const saved: string = htmlToMarkdown(editable.innerHTML);

    expect(saved).toBe(`${source}\n\nRolled back the migration job.`);
    expectOneRankedList(saved, podEntries(10));
  });

  it("keeps numbering and nesting when the user edits a nested detail", () => {
    const source: string = rootCause(10, 83);
    const editable: HTMLDivElement = document.createElement("div");
    editable.innerHTML = sanitize(markdownToHtml(source));

    const lastDetail: Element | null = editable.querySelector(
      ":scope > ol > li:nth-child(10) > ul > li:last-child",
    );

    expect(lastDetail?.textContent).toMatch(/^Node: /);
    lastDetail?.appendChild(document.createTextNode(" (cordoned)"));

    const saved: string = htmlToMarkdown(editable.innerHTML);
    const nodeTen: string = "`gke-gke-test-cluster-db-pool-3e2bfa3b-du610`";

    expect(saved).toBe(
      source.replace(
        `    - Node: ${nodeTen}`,
        `    - Node: ${nodeTen} (cordoned)`,
      ),
    );
    expectOneRankedList(saved, podEntries(10));
  });

  it("is a fixed point: a second save changes nothing", () => {
    const first: string = htmlToMarkdown(markdownToHtml(rootCause(10, 83)));

    expect(htmlToMarkdown(markdownToHtml(first))).toBe(first);
  });
});

/*
 * Regressions found while verifying nested-list support.
 */
describe("nested list edge cases", () => {
  /*
   * Each level of nesting parses its item's lines as a document of its own.
   * Uncapped, a single "- - - … x" line a thousand levels deep overflowed
   * the stack — in the editor's mount effect, so one such document would
   * have crashed the editor for everyone who opened it — and a staircase of
   * indented bullets cost cubic time.
   */
  it("does not overflow the stack on a pathologically deep single line", () => {
    const deep: string = `${"- ".repeat(1000)}x`;

    let html: string = "";
    expect(() => {
      html = markdownToHtml(deep);
    }).not.toThrow();
    expect(html).toContain("x");
    // Nesting stops at the cap; the rest of the item is kept as text.
    expect((html.match(/<ul>/g) || []).length).toBeLessThanOrEqual(21);
  });

  it("parses a deep staircase of indented bullets quickly", () => {
    const lines: Array<string> = [];
    for (let i: number = 0; i < 1000; i++) {
      lines.push(`${" ".repeat(i * 2)}- item ${i}`);
    }

    const startedAt: number = performance.now();
    const html: string = markdownToHtml(lines.join("\n"));
    const elapsed: number = performance.now() - startedAt;

    expect(html).toContain("item 0");
    expect(html).toContain("item 999");
    // The uncapped parser took about 8 seconds here.
    expect(elapsed).toBeLessThan(2000);
  });

  it("still nests normally well inside the cap", () => {
    const lines: Array<string> = [];
    for (let i: number = 0; i < 10; i++) {
      lines.push(`${" ".repeat(i * 2)}- level ${i}`);
    }
    const markdown: string = lines.join("\n");

    const html: string = markdownToHtml(markdown);

    expect((html.match(/<ul>/g) || []).length).toBe(10);
    expect(htmlToMarkdown(html)).toBe(markdown);
  });

  /*
   * A loose item's second paragraph is a <p> after the item's text. It used
   * to come back one newline short, so the saved markdown joined it to the
   * first paragraph and every save lost another break.
   */
  it("keeps the blank line before a later paragraph of an ordered item", () => {
    const markdown: string = "1. a\n\n   b\n2. c";

    const html: string = markdownToHtml(markdown);

    expect(html).toBe("<ol><li>a<p>b</p></li><li>c</li></ol>");
    expect(htmlToMarkdown(html)).toBe(markdown);
  });

  it("keeps every paragraph break of a multi-paragraph bullet, save after save", () => {
    const markdown: string = "- a\n\n  b\n\n  c\n- d";

    const once: string = htmlToMarkdown(markdownToHtml(markdown));
    const twice: string = htmlToMarkdown(markdownToHtml(once));

    expect(once).toBe(markdown);
    expect(twice).toBe(markdown);
  });

  it("separates a later paragraph from the item's text when serializing editor HTML", () => {
    expect(htmlToMarkdown("<ul><li>a<p>b</p></li></ul>")).toBe("- a\n\n  b");
  });

  /*
   * Enter at the end of a nested bullet leaves an empty <li>. Trimming the
   * item's content writes it as a bare "-", which used to reopen as a
   * literal "-" paragraph while marked (the email) read it as an empty item.
   */
  it("reads a bare marker after a list item as an empty item", () => {
    const saved: string = htmlToMarkdown(
      "<ol><li>a<ul><li>x</li><li><br></li></ul></li><li>b</li></ol>",
    );

    expect(saved).toBe("1. a\n   - x\n   -\n2. b");

    const html: string = markdownToHtml(saved);
    expect(html).toBe(
      "<ol><li>a<ul><li>x</li><li></li></ul></li><li>b</li></ol>",
    );
    expect(html).not.toContain("<p>-</p>");
    expect(htmlToMarkdown(html)).toBe(saved);
  });

  it("an empty ordered item after another is read as an item too", () => {
    expect(markdownToHtml("1. a\n2.")).toBe("<ol><li>a</li><li></li></ol>");
  });

  it("a bare marker cannot START a list, so a lone number stays text", () => {
    expect(markdownToHtml("2021.")).toBe("<p>2021.</p>");
    expect(markdownToHtml("-")).not.toContain("<li>");
  });
});
