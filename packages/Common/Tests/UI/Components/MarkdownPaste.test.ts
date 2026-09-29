import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { marked, Token, Tokens } from "marked";
import {
  htmlToMarkdown,
  markdownToHtml,
} from "../../../UI/Components/Markdown.tsx/MarkdownConverters";
import {
  clipboardToMarkdown,
  isRichClipboardHtml,
  normalizePlainTextListMarkers,
  pastedHtmlToMarkdown,
  PastedClipboard,
} from "../../../UI/Components/Markdown.tsx/MarkdownPaste";
import {
  CHROME_VIEWER_COPY_HTML,
  CHROME_VIEWER_COPY_TEXT,
  FIREFOX_VIEWER_COPY_HTML,
  FIREFOX_VIEWER_COPY_TEXT,
  GOOGLE_DOCS_LIST_COPY_HTML,
  GOOGLE_DOCS_LIST_COPY_MARKDOWN,
  GOOGLE_DOCS_LIST_COPY_TEXT,
  VIEWER_COPY_SOURCE_MARKDOWN,
  WORD_OUTLOOK_ISSUE_4114_HTML,
} from "./fixtures/MarkdownPasteFixtures";

/*
 * Clipboard -> markdown for the MarkdownEditor (issue #4114: a pasted bullet
 * showed its dot but was not a list, nested lists came out flat, and copying
 * a previous incident lost its formatting).
 *
 * Every conversion is checked three ways: the exact markdown written, the
 * list nesting as marked (the email renderer) reads it, and that the result
 * is a fixed point of the editor's render / serialize loop -- markdown the
 * editor would rewrite on the next keystroke is not a finished paste.
 */

const NBSP: string = String.fromCharCode(0xa0);
const SYMBOL_FONT_BULLET: string = String.fromCharCode(0xf0b7);
const WINGDINGS_SQUARE: string = String.fromCharCode(0xf0a7);

// A list's nesting as marked sees it: "ul[li[ul[li]],li]".
const listShape: (markdown: string) => string = (markdown: string): string => {
  const describe: (token: Token) => string = (token: Token): string => {
    if (token.type !== "list") {
      return token.type;
    }
    const list: Tokens.List = token as Tokens.List;
    const items: Array<string> = list.items.map(
      (item: Tokens.ListItem): string => {
        const nested: Array<string> = item.tokens
          .filter((child: Token): boolean => {
            return child.type === "list";
          })
          .map(describe);
        return nested.length > 0 ? `li[${nested.join("")}]` : "li";
      },
    );
    return `${list.ordered ? "ol" : "ul"}[${items.join(",")}]`;
  };
  return marked
    .lexer(markdown)
    .filter((token: Token): boolean => {
      return token.type !== "space";
    })
    .map(describe)
    .join(" ");
};

// What the editor saves after rendering `markdown` and serializing it back.
const afterEditorLoop: (markdown: string) => string = (
  markdown: string,
): string => {
  return htmlToMarkdown(markdownToHtml(markdown));
};

const clipboard: (
  data: { [format: string]: string },
  types?: ReadonlyArray<string>,
) => PastedClipboard = (
  data: { [format: string]: string },
  types?: ReadonlyArray<string>,
): PastedClipboard => {
  return {
    getData: (format: string): string => {
      return data[format] ?? "";
    },
    types: types ?? Object.keys(data),
  };
};

describe("normalizePlainTextListMarkers", () => {
  /*
   * Word and Outlook write a list into plain text as a bullet character and
   * a tab, and mark the level with the character alone -- "•", then "o",
   * then "§" -- without indenting anything.
   */
  it("turns Word's plain-text bullets into a nested markdown list", () => {
    const markdown: string = normalizePlainTextListMarkers(
      "•\tService down\no\tUsers cannot log in\no\tError shown\n•\tInvestigating\no\tTeam notified\n§\tPaged",
    );

    expect(markdown).toBe(
      "- Service down\n  - Users cannot log in\n  - Error shown\n- Investigating\n  - Team notified\n    - Paged",
    );
    expect(listShape(markdown)).toBe("ul[li[ul[li,li]],li[ul[li[ul[li]]]]]");
    expect(afterEditorLoop(markdown)).toBe(markdown);
  });

  it("reads Word's Symbol and Wingdings bullets from the private use area", () => {
    expect(
      normalizePlainTextListMarkers(
        `${SYMBOL_FONT_BULLET}\tA\no\tB\n${WINGDINGS_SQUARE}\tC`,
      ),
    ).toBe("- A\n  - B\n    - C");
  });

  it("never opens a level more than one deeper than the item above", () => {
    expect(normalizePlainTextListMarkers("•\ta\n§\tb")).toBe("- a\n  - b");
    expect(normalizePlainTextListMarkers("o\tfirst")).toBe("- first");
  });

  it("nests by indentation when the text is indented, as Slack writes it", () => {
    const markdown: string = normalizePlainTextListMarkers(
      "• Main item\n    ◦ Nested item\n        ▪ Further nested\n• Next",
    );

    expect(markdown).toBe(
      "- Main item\n  - Nested item\n    - Further nested\n- Next",
    );
    expect(listShape(markdown)).toBe("ul[li[ul[li[ul[li]]]],li]");
  });

  it("counts a tab of indentation as four columns", () => {
    expect(normalizePlainTextListMarkers("•\tA\n\t•\tB\n•\tC")).toBe(
      "- A\n  - B\n- C",
    );
  });

  /*
   * "●", "○", "■" are the bullets of three levels (the ones Google Docs
   * draws, though its own plain text has no bullets at all); a dash or an
   * arrow says nothing about the level, so it is a top-level item.
   */
  it("reads the other bullets and dashes people use", () => {
    expect(normalizePlainTextListMarkers("● one\n○ two\n■ three")).toBe(
      "- one\n  - two\n    - three",
    );
    expect(normalizePlainTextListMarkers("– four\n— five")).toBe(
      "- four\n- five",
    );
    expect(normalizePlainTextListMarkers("➤ go\n► on")).toBe("- go\n- on");
  });

  it("takes a non-breaking space after the bullet", () => {
    expect(normalizePlainTextListMarkers(`•${NBSP}item`)).toBe("- item");
  });

  it("writes numbered lines with a parenthesis the way the editor reads them", () => {
    expect(normalizePlainTextListMarkers("1) one\n2) two")).toBe(
      "1. one\n2. two",
    );
  });

  it("starts again at the top after a paragraph ends the list", () => {
    expect(
      normalizePlainTextListMarkers("•\ta\no\tb\nA paragraph.\no\tc"),
    ).toBe("- a\n  - b\nA paragraph.\n- c");
  });

  it("keeps a blank line between two bullets inside the same list", () => {
    expect(normalizePlainTextListMarkers("•\ta\n\no\tb")).toBe("- a\n\n  - b");
  });

  it("leaves the inside of a fenced code block alone", () => {
    expect(
      normalizePlainTextListMarkers("```\n• not a list\n1) nor this\n```\n• a"),
    ).toBe("```\n• not a list\n1) nor this\n```\n- a");
  });

  it("reads Windows line endings", () => {
    expect(normalizePlainTextListMarkers("•\ta\r\n•\tb")).toBe("- a\n- b");
  });

  describe("returns text with no bullet lines exactly as it came", () => {
    const untouched: Array<string> = [
      "Price • quality",
      "o no, not again",
      "o gato\no cão",
      "•item without a space",
      "- already markdown\n  - nested",
      "Line one\r\nLine two",
      "",
    ];
    for (const text of untouched) {
      it(JSON.stringify(text), () => {
        expect(normalizePlainTextListMarkers(text)).toBe(text);
      });
    }
  });
});

describe("pastedHtmlToMarkdown", () => {
  describe("Word and Outlook", () => {
    /*
     * The complaint in issue #4114 itself: its body is Outlook's clipboard
     * HTML, with nested lists written as a <ul> directly inside a <ul> --
     * which the serializer skipped, flattening every nested item away.
     */
    it("keeps the nested lists of the issue's own Outlook HTML", () => {
      const markdown: string = pastedHtmlToMarkdown(
        WORD_OUTLOOK_ISSUE_4114_HTML,
      );

      expect(markdown).toContain(
        "For example, a previous incident might contain:\n\n- Service is currently unavailable\n  - Users are unable to log in\n  - Users are receiving an error message\n- Investigation is in progress\n  - Technical team has been notified\n  - Vendor has been contacted\n\nA user may want to copy",
      );
      expect(markdown).toContain(
        "For example:\n\n- Main item\n  - Nested item\n    - Further nested item\n\nThe underlying Markdown",
      );
    });

    it("writes the whole document as markdown the editor keeps as it is", () => {
      const markdown: string = pastedHtmlToMarkdown(
        WORD_OUTLOOK_ISSUE_4114_HTML,
      );

      expect(afterEditorLoop(markdown)).toBe(markdown);
      expect(
        markdown.startsWith(
          "**Is your feature request related to a problem? Please describe.**\n\nWith the new custom fields",
        ),
      ).toBe(true);
      expect(markdown).toContain("\n\n---\n\n**Markdown Editor Enhancements**");
      expect(markdown).toContain(
        "- **Shown / Hidden**\n- **Required / Optional**",
      );
      expect(markdown).toContain(
        "**Which fields are displayed → Which fields are required → What the message looks like**",
      );
    });

    it("gives marked the same nesting", () => {
      const markdown: string = pastedHtmlToMarkdown(
        WORD_OUTLOOK_ISSUE_4114_HTML,
      );

      expect(listShape(markdown)).toContain("ul[li[ul[li,li]],li[ul[li,li]]]");
      expect(listShape(markdown)).toContain("ul[li[ul[li[ul[li]]]]]");
    });

    it("joins Word's hard-wrapped lines and leaks none of its markup", () => {
      const markdown: string = pastedHtmlToMarkdown(
        WORD_OUTLOOK_ISSUE_4114_HTML,
      );

      expect(markdown).toContain("- Affected Location\n");
      expect(markdown).not.toMatch(/Service\s*\n\s+is currently/);
      for (const leak of [
        "<",
        "mso",
        "o:p",
        "StartFragment",
        "VML",
        "WordDocument",
        NBSP,
      ]) {
        expect(markdown).not.toContain(leak);
      }
    });

    /*
     * Word itself (rather than Outlook) writes a list as paragraphs, each with
     * its level in a mso-list style and its bullet or number as text between
     * <![if !supportLists]> and <![endif]>. Without reading that, the bullet
     * came through as "·" at the start of a plain paragraph.
     */
    const wordParagraph: (
      level: number,
      marker: string,
      text: string,
    ) => string = (level: number, marker: string, text: string): string => {
      return `<p class=MsoListParagraphCxSpMiddle style='margin-left:${36 * level}.0pt;mso-add-space:auto;text-indent:-18.0pt;mso-list:l0 level${level} lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-fareast-font-family:Symbol'><span style='mso-list:Ignore'>${marker}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>${text}<o:p></o:p></p>\n`;
    };

    it("rebuilds Word's paragraph list, bullets removed, levels nested", () => {
      const html: string =
        "<p class=MsoNormal>Before<o:p></o:p></p>\n" +
        wordParagraph(1, "·", "One") +
        wordParagraph(2, "o", "Nested <b>bold</b>") +
        wordParagraph(3, "§", "Deeper") +
        wordParagraph(1, "·", "Two") +
        "<p class=MsoNormal>After<o:p></o:p></p>";

      const markdown: string = pastedHtmlToMarkdown(html);

      expect(markdown).toBe(
        "Before\n\n- One\n  - Nested **bold**\n    - Deeper\n- Two\n\nAfter",
      );
      expect(listShape(markdown)).toBe(
        "paragraph ul[li[ul[li[ul[li]]]],li] paragraph",
      );
      expect(afterEditorLoop(markdown)).toBe(markdown);
    });

    it("reads a numbered Word list as an ordered list", () => {
      const html: string =
        wordParagraph(1, "1.", "First") +
        wordParagraph(2, "a.", "Sub step") +
        wordParagraph(1, "2.", "Second");

      const markdown: string = pastedHtmlToMarkdown(html);

      expect(markdown).toBe("1. First\n   1. Sub step\n2. Second");
      expect(listShape(markdown)).toBe("ol[li[ol[li]],li]");
    });

    it("starts a new list where Word switches between bullets and numbers", () => {
      const html: string =
        wordParagraph(1, "·", "Bullet") + wordParagraph(1, "1.", "Number");

      expect(pastedHtmlToMarkdown(html)).toBe("- Bullet\n\n1. Number");
    });

    it("strips a marker Word wrote without the conditional comments", () => {
      const html: string =
        "<p style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>·<span>&nbsp;&nbsp; </span></span>Only item</p>";

      expect(pastedHtmlToMarkdown(html)).toBe("- Only item");
    });

    it("keeps an <o:p> that holds text, and drops an empty one", () => {
      expect(
        pastedHtmlToMarkdown(
          "<p class=MsoNormal>a<o:p>b</o:p></p><p class=MsoNormal><o:p>&nbsp;</o:p></p><p>c</p>",
        ),
      ).toBe("ab\n\nc");
    });
  });

  describe("Google Docs", () => {
    /*
     * The shape of a Google Docs copy: everything inside one
     * <b style="font-weight:normal" id="docs-internal-guid-...">, formatting
     * as span styles, each item's text in a <p>, and nested lists directly
     * inside their parent list.
     */
    const GOOGLE_DOCS_HTML: string =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-2f1b3c4d-7fff-a1b2-c3d4-e5f6a7b8c9d0"><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:700;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Bold</span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;"> and </span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:italic;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">italic</span></p></li><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" aria-level="2"><p dir="ltr" role="presentation"><a href="https://example.com/runbook" style="text-decoration:none;"><span style="font-size:11pt;color:#1155cc;font-weight:400;text-decoration:underline;white-space:pre;white-space:pre-wrap;">runbook</span></a><span style="font-weight:400;white-space:pre;white-space:pre-wrap;"> </span><span style="font-weight:400;text-decoration:line-through;white-space:pre;white-space:pre-wrap;">gone</span></p></li></ul><li dir="ltr" aria-level="1"><p dir="ltr" role="presentation"><span style="font-weight:700;font-style:italic;white-space:pre;white-space:pre-wrap;">Both</span></p></li></ul><br></b>';

    it("unwraps the whole-document bold and reads formatting from styles", () => {
      const markdown: string = pastedHtmlToMarkdown(GOOGLE_DOCS_HTML);

      expect(markdown).toBe(
        "- **Bold** and *italic*\n  - [runbook](https://example.com/runbook) ~~gone~~\n- ***Both***",
      );
      expect(listShape(markdown)).toBe("ul[li[ul[li]],li]");
      expect(afterEditorLoop(markdown)).toBe(markdown);
    });

    it("renders text that is bold and italic at once as both", () => {
      expect(markdownToHtml(pastedHtmlToMarkdown(GOOGLE_DOCS_HTML))).toContain(
        "<em><strong>Both</strong></em>",
      );
    });

    /*
     * Docs puts "white-space:pre" on every list item it copies, and the
     * paste took that for a code editor's copy (VS Code's white-space:pre
     * <div>) and used the plain text instead -- the lines alone, with no
     * bullets -- so every Docs copy with a list lost its lists, links and
     * formatting. These go through the editor's own entry point.
     */
    it("counts a Docs copy with a list in it as rich", () => {
      expect(isRichClipboardHtml(GOOGLE_DOCS_HTML)).toBe(true);
      expect(isRichClipboardHtml(GOOGLE_DOCS_LIST_COPY_HTML)).toBe(true);
    });

    it("pastes a Docs list as the list it is, not as its plain text", () => {
      expect(
        clipboardToMarkdown(
          clipboard({
            "text/html": GOOGLE_DOCS_HTML,
            "text/plain": "Bold and italic\nrunbook gone\nBoth",
          }),
        ),
      ).toBe(
        "- **Bold** and *italic*\n  - [runbook](https://example.com/runbook) ~~gone~~\n- ***Both***",
      );
      expect(
        clipboardToMarkdown(
          clipboard({
            "text/html": GOOGLE_DOCS_LIST_COPY_HTML,
            "text/plain": GOOGLE_DOCS_LIST_COPY_TEXT,
          }),
        ),
      ).toBe(GOOGLE_DOCS_LIST_COPY_MARKDOWN);
    });

    // Chromium, Safari and Docs write a tab as a white-space:pre <span>.
    it("counts a Docs paragraph with a tab in it as rich", () => {
      const html: string =
        '<b style="font-weight:normal;" id="docs-internal-guid-2"><p dir="ltr"><span style="font-weight:700;white-space:pre;white-space:pre-wrap;">Owner:</span><span style="font-weight:400;white-space:pre;white-space:pre-wrap;"><span class="Apple-tab-span" style="white-space:pre;">\t</span>Jane</span></p></b>';

      expect(isRichClipboardHtml(html)).toBe(true);
      expect(
        clipboardToMarkdown(
          clipboard({ "text/html": html, "text/plain": "Owner:\tJane" }),
        ),
      ).toBe("**Owner:** Jane");
    });

    it("counts plain Docs text as plain, so its plain text is pasted", () => {
      expect(
        isRichClipboardHtml(
          '<b style="font-weight:normal;" id="docs-internal-guid-1"><span style="font-weight:400;white-space:pre-wrap;">Just text</span></b>',
        ),
      ).toBe(false);
    });
  });

  describe("a note copied out of MarkdownViewer", () => {
    /*
     * The fixtures are real copies of the real viewer: the code block comes
     * back as a fence with its language (not the "Copy" button's text), the
     * localized timestamp as the ISO value it was rendered from, and every
     * list at its depth -- the same markdown the note was written in.
     */
    it("comes back from Chromium's copy exactly as the note was written", () => {
      const markdown: string = pastedHtmlToMarkdown(CHROME_VIEWER_COPY_HTML);

      expect(markdown).toBe(VIEWER_COPY_SOURCE_MARKDOWN);
      expect(afterEditorLoop(markdown)).toBe(markdown);
    });

    it("comes back from Firefox's copy exactly as the note was written", () => {
      const markdown: string = pastedHtmlToMarkdown(FIREFOX_VIEWER_COPY_HTML);

      expect(markdown).toBe(VIEWER_COPY_SOURCE_MARKDOWN);
    });

    it("leaves out the code block's Copy button and language label", () => {
      const markdown: string = pastedHtmlToMarkdown(CHROME_VIEWER_COPY_HTML);

      expect(markdown).not.toMatch(/\bCopy\b/);
      expect(markdown).not.toContain("TYPESCRIPT");
    });

    it("writes a code block without a language as a bare fence", () => {
      expect(
        pastedHtmlToMarkdown(
          '<div data-markdown-code-block="true" data-language="text"><div data-markdown-ignore="true"><span>Text</span><button>Copy</button></div><div style="white-space: pre;"><code class="font-mono">line 1\nline 2</code></div></div>',
        ),
      ).toBe("```\nline 1\nline 2\n```");
    });

    it("ignores a language attribute that is not a language name", () => {
      expect(
        pastedHtmlToMarkdown(
          '<div data-markdown-code-block="true" data-language="x`y"><code>a</code></div>',
        ),
      ).toBe("```\na\n```");
    });

    it("keeps the text of a timestamp that is not the viewer's", () => {
      expect(
        pastedHtmlToMarkdown(
          '<p>Due <time datetime="2026-05-01">May 1</time></p>',
        ),
      ).toBe("Due May 1");
    });
  });

  describe("lists", () => {
    it("moves a list written directly inside a list into the item before it", () => {
      expect(
        pastedHtmlToMarkdown(
          "<ul><li>a</li><ul><li>b</li><ol><li>c</li></ol></ul><li>d</li></ul>",
        ),
      ).toBe("- a\n  - b\n    1. c\n- d");
    });

    it("gives a list with no item before it an item of its own", () => {
      expect(pastedHtmlToMarkdown("<ul><ul><li>a</li></ul></ul>")).toBe(
        "- - a",
      );
    });

    it("wraps loose content in a list in an item instead of dropping it", () => {
      expect(
        pastedHtmlToMarkdown("<ul><span>x</span> y<li>a</li><p>z</p></ul>"),
      ).toBe("- x y\n- a\n- z");
    });

    it("keeps a task list's boxes", () => {
      expect(
        pastedHtmlToMarkdown(
          '<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul>',
        ),
      ).toBe("- [x] done\n- [ ] todo");
    });

    it("keeps an item with two paragraphs loose", () => {
      expect(pastedHtmlToMarkdown("<ul><li><p>a</p><p>b</p></li></ul>")).toBe(
        "- a\n\n  b",
      );
    });
  });

  describe("whitespace", () => {
    it("collapses runs of whitespace and non-breaking spaces outside code", () => {
      expect(pastedHtmlToMarkdown(`<p>a \n\t b&nbsp;&nbsp;c${NBSP}d</p>`)).toBe(
        "a b c d",
      );
    });

    it("keeps the whitespace of a code block", () => {
      expect(
        pastedHtmlToMarkdown("<pre><code>  indented\n\n    more</code></pre>"),
      ).toBe("```\n  indented\n\n    more\n```");
    });

    it("drops the whitespace between blocks and at their edges", () => {
      expect(
        pastedHtmlToMarkdown(
          "\n<p>\n  <span> one </span>\n</p>\n\n<p> two <br> three </p>\n",
        ),
      ).toBe("one\n\ntwo\nthree");
    });

    it("writes one space where spaces meet across inline elements", () => {
      expect(
        pastedHtmlToMarkdown("<p><span>a </span> <span> b</span></p>"),
      ).toBe("a b");
    });

    it("keeps the spaces on either side of an image", () => {
      expect(
        pastedHtmlToMarkdown('<p>a <img src="https://i.test/x.png"> b</p>'),
      ).toBe("a ![](https://i.test/x.png) b");
    });

    it("keeps the space between two formatted words", () => {
      expect(pastedHtmlToMarkdown("<p><b>a</b> <i>b</i></p>")).toBe(
        "**a** *b*",
      );
    });

    /*
     * "**bold **text" is not bold in CommonMark: marked (the email) and the
     * viewer print the asterisks.
     */
    it("moves the spaces at the edge of bold or italic text outside it", () => {
      const markdown: string = pastedHtmlToMarkdown(
        "<p><b>bold </b>text <i> italic</i> end</p>",
      );

      expect(markdown).toBe("**bold** text *italic* end");
      expect(marked.parse(markdown)).toContain("<strong>bold</strong>");
    });

    it("drops empty formatting and keeps the space it held", () => {
      expect(pastedHtmlToMarkdown("<p>a<b> </b>b<i></i>c<s></s></p>")).toBe(
        "a bc",
      );
    });
  });

  describe("links and images", () => {
    it("keeps http, https, mailto, tel and relative links", () => {
      expect(
        pastedHtmlToMarkdown(
          '<p><a href="https://a.test/x">a</a> <a href="http://b.test">b</a> <a href="mailto:ops@c.test">c</a> <a href="tel:+15550100">d</a> <a href="/dashboard/1">e</a> <a href="#part">f</a></p>',
        ),
      ).toBe(
        "[a](https://a.test/x) [b](http://b.test) [c](mailto:ops@c.test) [d](tel:+15550100) [e](/dashboard/1) [f](#part)",
      );
    });

    it("keeps only the text of a link with any other scheme", () => {
      expect(
        pastedHtmlToMarkdown(
          '<p><a href="javascript:alert(1)">js</a> <a href="JAVASCRIPT:alert(1)">upper</a> <a href="data:text/html,x">data</a> <a href="vbscript:x">vb</a> <a href="file:///C:/x">file</a> <a href="">empty</a></p>',
        ),
      ).toBe("js upper data vb file empty");
    });

    it("sees through a scheme hidden with whitespace, control characters or entities", () => {
      const control: string = String.fromCharCode(1);
      expect(
        pastedHtmlToMarkdown(
          `<p><a href="java\tscript:alert(1)">tab</a> <a href="  javascript:alert(1)">space</a> <a href="&#106;avascript:alert(1)">entity</a> <a href="${control}javascript:alert(1)">control</a></p>`,
        ),
      ).toBe("tab space entity control");
    });

    it("encodes the spaces and parentheses that would end a markdown link early", () => {
      const markdown: string = pastedHtmlToMarkdown(
        '<p><a href="https://w.test/wiki/Foo_(bar) baz">wiki</a></p>',
      );

      expect(markdown).toBe("[wiki](https://w.test/wiki/Foo_%28bar%29%20baz)");
      expect(markdownToHtml(markdown)).toContain(
        'href="https://w.test/wiki/Foo_%28bar%29%20baz"',
      );
    });

    it("keeps http, https and relative images and drops every other kind", () => {
      expect(
        pastedHtmlToMarkdown(
          '<p><img src="https://i.test/a.png" alt="a"><img src="/file/image/b.png" alt="b"><img src="data:image/png;base64,AAAA" alt="c"><img src="blob:https://x/1" alt="d"><img src="file:///C:/e.png" alt="e"><img src="cid:image001.png@01D" alt="f"><img alt="g"></p>',
        ),
      ).toBe("![a](https://i.test/a.png)![b](/file/image/b.png)");
    });

    it("drops the viewer's sessionRetry cache buster from an image", () => {
      expect(
        pastedHtmlToMarkdown(
          '<img src="https://oneuptime.test/file/image/access-token/t1?sessionRetry=1714"><img src="https://oneuptime.test/file/image/access-token/t2?sessionRetry=1&amp;v=2"><img src="https://oneuptime.test/x.png?v=2&amp;sessionRetry=9">',
        ),
      ).toBe(
        "![](https://oneuptime.test/file/image/access-token/t1)![](https://oneuptime.test/file/image/access-token/t2?v=2)![](https://oneuptime.test/x.png?v=2)",
      );
    });

    it("keeps an image's alt text from breaking the markdown around it", () => {
      expect(
        pastedHtmlToMarkdown(
          '<img src="https://i.test/a.png" alt="a [b]\n c" title="has &quot;quotes&quot;">',
        ),
      ).toBe("![a b c](https://i.test/a.png)");
    });
  });

  describe("what is not content", () => {
    it("drops scripts, styles, buttons, icons, frames and form controls", () => {
      expect(
        pastedHtmlToMarkdown(
          '<style>p { color: red }</style><script>var x = 1;</script><p>kept<button>Copy</button><svg><text>icon</text></svg></p><iframe src="https://x.test"></iframe><select><option>opt</option></select><textarea>draft</textarea><input type="text" value="v">',
        ),
      ).toBe("kept");
    });

    it("drops what is marked for the paste handler to ignore, or hidden", () => {
      expect(
        pastedHtmlToMarkdown(
          '<p>a<span data-markdown-ignore="true">chrome</span><span style="display:none">hidden</span><span style="mso-hide:all">word hidden</span>b</p>',
        ),
      ).toBe("ab");
    });

    it("keeps headings, quotes, rules and tables", () => {
      expect(
        pastedHtmlToMarkdown(
          "<h2>Status</h2><blockquote><p>Quoted</p></blockquote><hr><table><tr><td>Host</td><td>State</td></tr><tr><td>db-1</td><td>down</td></tr></table>",
        ),
      ).toBe(
        "## Status\n\n> Quoted\n\n---\n\n| Host | State |\n| ---- | ----- |\n| db-1 | down  |",
      );
    });
  });

  /*
   * The clipboard's HTML comes from anywhere. It is parsed with DOMParser,
   * whose document is inert, and never assigned to innerHTML -- in Chromium
   * an <img onerror> set through a detached element's innerHTML runs.
   */
  describe("hostile HTML", () => {
    afterEach(() => {
      jest.restoreAllMocks();
      delete (window as unknown as { __pasteRan?: number }).__pasteRan;
    });

    const HOSTILE: Array<string> = [
      '<img src="x" onerror="window.__pasteRan=1">',
      '<svg onload="window.__pasteRan=2"><circle r="1"></circle></svg>',
      "<script>window.__pasteRan=3</script>",
      '<body onload="window.__pasteRan=4"><p>body</p></body>',
      '<iframe srcdoc="<script>parent.__pasteRan=5</script>"></iframe>',
      '<a href="javascript:window.__pasteRan=6">link</a>',
      '<details open ontoggle="window.__pasteRan=7"><summary>s</summary></details>',
      '<math><mtext><table><mglyph><style><img src=x onerror="window.__pasteRan=8"></style></mglyph></table></mtext></math>',
    ];

    it("runs nothing and lets no markup through", async () => {
      const markdown: string = pastedHtmlToMarkdown(HOSTILE.join("<p>ok</p>"));

      // Give a handler that was queued the chance to run.
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 20);
      });
      expect((window as unknown as { __pasteRan?: number }).__pasteRan).toBe(
        undefined,
      );
      expect(markdown).not.toMatch(/<[a-z!/]/i);
      expect(markdown).not.toMatch(/on(error|load|toggle)|javascript|pasteRan/);
    });

    it("never assigns clipboard HTML to innerHTML", () => {
      const setter: SpyInstance<(value: string) => void> = jest.spyOn(
        Element.prototype,
        "innerHTML",
        "set",
      );

      pastedHtmlToMarkdown(HOSTILE.join(""));
      isRichClipboardHtml(HOSTILE.join(""));
      clipboardToMarkdown(clipboard({ "text/html": HOSTILE.join("") }));

      expect(setter).not.toHaveBeenCalled();
    });

    it("returns an empty string for empty HTML", () => {
      expect(pastedHtmlToMarkdown("")).toBe("");
    });
  });
});

describe("isRichClipboardHtml", () => {
  const rich: Array<string> = [
    "<ul><li>a</li></ul>",
    "<ol><li>a</li></ol>",
    "<h2>Title</h2>",
    '<p>see <a href="https://x.test">x</a></p>',
    "<p><strong>bold</strong></p>",
    "<p><em>it</em></p>",
    "<p><s>gone</s></p>",
    "<table><tr><td>a</td></tr></table>",
    "<pre><code>x</code></pre>",
    "<p><code>x</code></p>",
    '<img src="https://i.test/a.png">',
    "<blockquote><p>q</p></blockquote>",
    '<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·</span>Word item</p>',
    '<span style="font-weight:700">docs bold</span>',
    '<p>At <time datetime="2026-04-20T11:21:00.000Z">Apr 20</time></p>',
  ];
  for (const html of rich) {
    it(`converts ${html}`, () => {
      expect(isRichClipboardHtml(html)).toBe(true);
    });
  }

  const plain: Array<string> = [
    "",
    "<p>hello</p>",
    "<p>one</p><p>two<br>three</p>",
    '<p style="font-weight: 400; white-space: normal;">Chrome copy of plain text</p>',
    '<a name="_Toc1">bookmark only</a>',
    '<p><a href="javascript:alert(1)">unsafe link</a></p>',
    '<img src="data:image/png;base64,AAAA">',
  ];
  for (const html of plain) {
    it(`leaves ${JSON.stringify(html)} to its plain text`, () => {
      expect(isRichClipboardHtml(html)).toBe(false);
    });
  }

  /*
   * VS Code (and other code editors) put coloured spans in a
   * white-space:pre <div> on the clipboard -- bold ones too, for keywords.
   * The plain text is the content, often markdown source itself.
   */
  it("leaves a code editor's copy to its plain text", () => {
    expect(
      isRichClipboardHtml(
        '<meta charset="utf-8"><div style="color: #cccccc;background-color: #1f1f1f;font-family: Menlo, monospace;font-weight: normal;font-size: 12px;line-height: 18px;white-space: pre;"><div><span style="color: #569cd6;font-weight: bold;"># Heading</span></div><div><span style="color: #cccccc;">- </span><span style="color: #ce9178;">item</span></div></div>',
      ),
    ).toBe(false);
  });
});

describe("clipboardToMarkdown", () => {
  it("prefers rich HTML over the plain text beside it", () => {
    expect(
      clipboardToMarkdown(
        clipboard({
          "text/html": "<ul><li>a<ul><li>b</li></ul></li></ul>",
          "text/plain": "a\nb",
        }),
      ),
    ).toBe("- a\n  - b");
  });

  it("takes the plain text, bullets made markdown, when the HTML is plain", () => {
    expect(
      clipboardToMarkdown(
        clipboard({
          "text/html": "<p>•\tService down<br>o\tUsers</p>",
          "text/plain": "•\tService down\no\tUsers",
        }),
      ),
    ).toBe("- Service down\n  - Users");
  });

  /*
   * A textarea holds "\n" line breaks. The editor's source mode compares
   * this result with the clipboard's plain text to decide whether the
   * browser's own paste would insert the same thing; Windows' "\r\n" made
   * every multi-line paste look different, and took it off the undo stack.
   */
  it("writes line breaks as a textarea holds them", () => {
    expect(
      clipboardToMarkdown(clipboard({ "text/plain": "one\r\ntwo\rthree" })),
    ).toBe("one\ntwo\nthree");
  });

  /*
   * Words copied out of a line keep their space: as HTML it sits at the
   * edge of the document and is trimmed, and "very" pasted before "world"
   * came out as "**very**world".
   */
  it("keeps the space at either edge of a one-line rich paste", () => {
    expect(
      clipboardToMarkdown(
        clipboard({ "text/html": "<b>very</b> ", "text/plain": "very " }),
      ),
    ).toBe("**very** ");
    expect(
      clipboardToMarkdown(
        clipboard({ "text/html": " <i>so</i>", "text/plain": "\tso" }),
      ),
    ).toBe(" *so*");
  });

  it("adds no edge spaces to a paste of several lines, or for a trailing newline", () => {
    expect(
      clipboardToMarkdown(
        clipboard({
          "text/html": "<ul><li>a</li><li>b</li></ul>",
          "text/plain": " a\nb ",
        }),
      ),
    ).toBe("- a\n- b");
    expect(
      clipboardToMarkdown(
        clipboard({ "text/html": "<b>line</b>", "text/plain": "line\n" }),
      ),
    ).toBe("**line**");
  });

  it("takes plain text alone", () => {
    expect(clipboardToMarkdown(clipboard({ "text/plain": "just text" }))).toBe(
      "just text",
    );
  });

  it("returns null when there is nothing to paste as text", () => {
    expect(clipboardToMarkdown(clipboard({}))).toBeNull();
    expect(clipboardToMarkdown(clipboard({ "text/html": "" }))).toBeNull();
  });

  /*
   * "Copy image" in a browser puts the image's <img> tag on the clipboard
   * beside the picture itself. Uploading the picture beats linking to
   * somebody else's server.
   */
  it("leaves an image-only paste to the image files beside it", () => {
    const data: { [format: string]: string } = {
      "text/html": '<img src="https://i.test/a.png">',
    };

    expect(
      clipboardToMarkdown(clipboard(data, ["text/html", "Files"])),
    ).toBeNull();
    expect(
      clipboardToMarkdown(clipboard(data), { hasImageFiles: true }),
    ).toBeNull();
    expect(clipboardToMarkdown(clipboard(data), { hasImageFiles: false })).toBe(
      "![](https://i.test/a.png)",
    );
  });

  /*
   * Word and Excel put a picture of the copied text on the clipboard as
   * well as the text itself. The text is what was meant.
   */
  it("keeps rich text even when image files come with it", () => {
    expect(
      clipboardToMarkdown(
        clipboard({ "text/html": "<ul><li>a</li></ul>", "text/plain": "a" }, [
          "text/html",
          "text/plain",
          "Files",
        ]),
      ),
    ).toBe("- a");
  });

  // A file copied in Finder or Explorer comes with its name as plain text.
  it("leaves plain text that comes with files to the files", () => {
    expect(
      clipboardToMarkdown(
        clipboard({ "text/plain": "Screenshot.png" }, ["text/plain", "Files"]),
      ),
    ).toBeNull();
    expect(
      clipboardToMarkdown(clipboard({ "text/plain": "Screenshot.png" }), {
        hasImageFiles: false,
      }),
    ).toBe("Screenshot.png");
  });

  it("reads a DOMStringList-like list of types", () => {
    const types: ReadonlyArray<string> = {
      length: 2,
      0: "text/plain",
      1: "Files",
    } as unknown as ReadonlyArray<string>;

    expect(
      clipboardToMarkdown({
        getData: (): string => {
          return "name.png";
        },
        types,
      }),
    ).toBeNull();
  });

  it("treats a format the browser refuses to read as empty", () => {
    expect(
      clipboardToMarkdown({
        getData: (format: string): string => {
          if (format === "text/html") {
            throw new Error("not allowed");
          }
          return "plain";
        },
      }),
    ).toBe("plain");
  });

  it("uses the text of plain HTML when there is no plain text", () => {
    expect(
      clipboardToMarkdown(clipboard({ "text/html": "<p>only html</p>" })),
    ).toBe("only html");
  });

  it("gives a code editor's copy as its plain text", () => {
    expect(
      clipboardToMarkdown(
        clipboard({
          "text/html":
            '<div style="white-space: pre;"><div><span style="font-weight: bold;"># Heading</span></div></div>',
          "text/plain": "# Heading",
        }),
      ),
    ).toBe("# Heading");
  });

  it("turns both real viewer copies back into the note's markdown", () => {
    expect(
      clipboardToMarkdown(
        clipboard({
          "text/html": CHROME_VIEWER_COPY_HTML,
          "text/plain": CHROME_VIEWER_COPY_TEXT,
        }),
      ),
    ).toBe(VIEWER_COPY_SOURCE_MARKDOWN);
    expect(
      clipboardToMarkdown(
        clipboard({
          "text/html": FIREFOX_VIEWER_COPY_HTML,
          "text/plain": FIREFOX_VIEWER_COPY_TEXT,
        }),
      ),
    ).toBe(VIEWER_COPY_SOURCE_MARKDOWN);
  });
});
