import { describe, expect, it } from "@jest/globals";
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
        "<p>a | b\nplain text</p>".replace("\n", "<br>"),
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
