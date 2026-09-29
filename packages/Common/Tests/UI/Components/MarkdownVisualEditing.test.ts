import { afterEach, describe, expect, it } from "@jest/globals";
import {
  htmlToMarkdown,
  markdownToHtml,
} from "../../../UI/Components/Markdown.tsx/MarkdownConverters";
import {
  caretAtEndOf,
  insertBlocksAtCaret,
  isCaretOnEmptyLine,
} from "../../../UI/Components/Markdown.tsx/MarkdownVisualEditing";

/*
 * Inserting blocks into the visual editor by hand. Chromium's and Safari's
 * insertHTML fold the first block of an insert into the line the caret is in
 * (a pasted code block saved as "Run:npm install"), so the editor splits the
 * line at the caret and puts the blocks between its halves itself -- except
 * on an empty line, where insertHTML is right in every browser.
 */

let editable: HTMLDivElement | null = null;

const mountHtml: (html: string) => HTMLDivElement = (
  html: string,
): HTMLDivElement => {
  const root: HTMLDivElement = document.createElement("div");
  root.setAttribute("contenteditable", "true");
  root.innerHTML = html;
  document.body.appendChild(root);
  editable = root;
  return root;
};

const mountMarkdown: (markdown: string) => HTMLDivElement = (
  markdown: string,
): HTMLDivElement => {
  return mountHtml(markdownToHtml(markdown));
};

afterEach(() => {
  editable?.remove();
  editable = null;
  window.getSelection()?.removeAllRanges();
});

// A collapsed range `offset` characters into the first text node holding `text`.
const caretAt: (root: HTMLElement, text: string, offset: number) => Range = (
  root: HTMLElement,
  text: string,
  offset: number,
): Range => {
  const walker: TreeWalker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  let node: Node | null = walker.nextNode();
  while (node && !(node.textContent || "").includes(text)) {
    node = walker.nextNode();
  }
  if (!node) {
    throw new Error(`no text "${text}"`);
  }
  const range: Range = document.createRange();
  range.setStart(node, (node.textContent || "").indexOf(text) + offset);
  range.collapse(true);
  return range;
};

const caretOn: (node: Node, offset: number) => Range = (
  node: Node,
  offset: number,
): Range => {
  const range: Range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  return range;
};

const fragmentOf: (html: string) => DocumentFragment = (
  html: string,
): DocumentFragment => {
  const template: HTMLTemplateElement = document.createElement("template");
  template.innerHTML = html;
  return template.content;
};

const CODE_BLOCK: string = "<pre><code>code block</code></pre>";

describe("isCaretOnEmptyLine", () => {
  it("is true in the empty editor", () => {
    const root: HTMLDivElement = mountHtml("");

    expect(isCaretOnEmptyLine(root, caretOn(root, 0))).toBe(true);
  });

  it("is true on a blank line straight inside the editor", () => {
    const root: HTMLDivElement = mountHtml("<p>Run:</p><p><br></p>");
    const blank: Element = root.lastElementChild as Element;

    expect(isCaretOnEmptyLine(root, caretOn(blank, 0))).toBe(true);
  });

  it("is true on the empty <div> a browser writes for a new line", () => {
    const root: HTMLDivElement = mountHtml("Run:<div><br></div>");
    const blank: Element = root.lastElementChild as Element;

    expect(isCaretOnEmptyLine(root, caretOn(blank, 0))).toBe(true);
  });

  /*
   * Where Chromium and Safari fold a block into the line: at its end, in its
   * middle, and at its start too (the last block then runs into the text).
   */
  it("is false anywhere in a line with text", () => {
    const root: HTMLDivElement = mountHtml("<p>hello world</p>");

    expect(isCaretOnEmptyLine(root, caretAt(root, "hello", 5))).toBe(false);
    expect(isCaretOnEmptyLine(root, caretAt(root, "world", 0))).toBe(false);
    expect(isCaretOnEmptyLine(root, caretAt(root, "hello", 0))).toBe(false);
  });

  it("is false on a line holding only a space, or only an image", () => {
    const spaced: HTMLDivElement = mountHtml("<p> </p>");
    expect(
      isCaretOnEmptyLine(spaced, caretOn(spaced.firstChild as Node, 0)),
    ).toBe(false);
    spaced.remove();

    const imaged: HTMLDivElement = mountHtml('<p><img src="a.png"></p>');
    expect(
      isCaretOnEmptyLine(imaged, caretOn(imaged.firstChild as Node, 0)),
    ).toBe(false);
  });

  it("is false in an empty list item, which is not a line of its own", () => {
    const root: HTMLDivElement = mountHtml("<ul><li><br></li></ul>");
    const item: Element = root.querySelector("li") as Element;

    expect(isCaretOnEmptyLine(root, caretOn(item, 0))).toBe(false);
  });

  it("is false between the blocks of an editor that has text", () => {
    const root: HTMLDivElement = mountHtml("<p>a</p><p>b</p>");

    expect(isCaretOnEmptyLine(root, caretOn(root, 1))).toBe(false);
  });

  it("is false for a selection", () => {
    const root: HTMLDivElement = mountHtml("<p><br></p>");
    const range: Range = document.createRange();
    range.selectNodeContents(root);

    expect(isCaretOnEmptyLine(root, range)).toBe(false);
  });
});

describe("insertBlocksAtCaret", () => {
  it("puts a block after the line when the caret is at its end", () => {
    const root: HTMLDivElement = mountMarkdown("hello");

    insertBlocksAtCaret(
      root,
      caretAt(root, "hello", 5),
      fragmentOf(CODE_BLOCK),
    );

    expect(root.innerHTML).toBe(`<p>hello</p>${CODE_BLOCK}`);
    expect(htmlToMarkdown(root.innerHTML)).toBe(
      "hello\n\n```\ncode block\n```",
    );
  });

  it("splits the line when the caret is in its middle, dropping the space at the split", () => {
    const root: HTMLDivElement = mountMarkdown("Run this then check");

    insertBlocksAtCaret(
      root,
      caretAt(root, "then", 0),
      fragmentOf("<pre><code>npm install oneuptime</code></pre>"),
    );

    expect(root.innerHTML).toBe(
      "<p>Run this</p><pre><code>npm install oneuptime</code></pre><p>then check</p>",
    );
    expect(htmlToMarkdown(root.innerHTML)).toBe(
      "Run this\n\n```\nnpm install oneuptime\n```\n\nthen check",
    );
  });

  it("keeps a non-breaking space at the split, which is shown", () => {
    const root: HTMLDivElement = mountHtml("<p>a\u00a0b</p>");

    insertBlocksAtCaret(root, caretAt(root, "b", 0), fragmentOf("<hr>"));

    expect(root.innerHTML).toBe("<p>a&nbsp;</p><hr><p>b</p>");
  });

  it("leaves no empty line behind at the start of a line", () => {
    const root: HTMLDivElement = mountMarkdown("hello");

    insertBlocksAtCaret(
      root,
      caretAt(root, "hello", 0),
      fragmentOf(CODE_BLOCK),
    );

    expect(root.innerHTML).toBe(`${CODE_BLOCK}<p>hello</p>`);
  });

  it("splits a heading into two headings", () => {
    const root: HTMLDivElement = mountMarkdown("## Title");

    insertBlocksAtCaret(root, caretAt(root, "Title", 2), fragmentOf("<hr>"));

    expect(htmlToMarkdown(root.innerHTML)).toBe("## Ti\n\n---\n\n## tle");
  });

  it("splits the formatting the caret is in along with the line", () => {
    const root: HTMLDivElement = mountHtml("<p><strong>bold</strong> text</p>");

    insertBlocksAtCaret(root, caretAt(root, "bold", 2), fragmentOf("<hr>"));

    expect(root.innerHTML).toBe(
      "<p><strong>bo</strong></p><hr><p><strong>ld</strong> text</p>",
    );
  });

  it("keeps a block inserted in a list item inside that item", () => {
    const root: HTMLDivElement = mountMarkdown("- item one\n- item two");

    insertBlocksAtCaret(
      root,
      caretAt(root, "item one", 8),
      fragmentOf(CODE_BLOCK),
    );

    expect(htmlToMarkdown(root.innerHTML)).toBe(
      "- item one\n\n  ```\n  code block\n  ```\n- item two",
    );
  });

  it("splits the text of a list item the caret is in the middle of", () => {
    const root: HTMLDivElement = mountHtml("<ul><li>one two</li></ul>");

    insertBlocksAtCaret(root, caretAt(root, "two", 0), fragmentOf("<hr>"));

    expect(root.innerHTML).toBe("<ul><li>one<hr>two</li></ul>");
  });

  it("keeps a block inserted in a quote inside the quote", () => {
    const root: HTMLDivElement = mountHtml(
      "<blockquote><p>quoted</p></blockquote>",
    );

    insertBlocksAtCaret(root, caretAt(root, "quoted", 6), fragmentOf("<hr>"));

    expect(root.innerHTML).toBe("<blockquote><p>quoted</p><hr></blockquote>");
  });

  it("puts blocks after a code block rather than inside it", () => {
    const root: HTMLDivElement = mountMarkdown("```\ncode\n```\n\nafter");

    insertBlocksAtCaret(root, caretAt(root, "code", 2), fragmentOf("<hr>"));

    expect(htmlToMarkdown(root.innerHTML)).toBe(
      "```\ncode\n```\n\n---\n\nafter",
    );
  });

  // Chromium leaves the first line typed into an empty editor as bare text.
  it("splits bare text straight inside the editor", () => {
    const root: HTMLDivElement = mountHtml("Run: now<div>next</div>");

    insertBlocksAtCaret(root, caretAt(root, "now", 0), fragmentOf(CODE_BLOCK));

    expect(root.innerHTML).toBe(`Run:${CODE_BLOCK}now<div>next</div>`);
  });

  it("goes between the editor's blocks when the caret is between them", () => {
    const root: HTMLDivElement = mountHtml("<p>a</p><p>b</p>");

    insertBlocksAtCaret(root, caretOn(root, 1), fragmentOf("<hr>"));

    expect(root.innerHTML).toBe("<p>a</p><hr><p>b</p>");
  });

  it("returns the last node inserted, or null for nothing", () => {
    const root: HTMLDivElement = mountMarkdown("hello");
    const inserted: Node | null = insertBlocksAtCaret(
      root,
      caretAt(root, "hello", 5),
      fragmentOf("<hr><p>last</p>"),
    );

    expect((inserted as Element).outerHTML).toBe("<p>last</p>");
    expect(
      insertBlocksAtCaret(
        root,
        caretAt(root, "last", 0),
        document.createDocumentFragment(),
      ),
    ).toBeNull();
  });
});

describe("caretAtEndOf", () => {
  it("is after the last character of what was inserted", () => {
    const root: HTMLDivElement = mountHtml(CODE_BLOCK);
    const caret: Range = caretAtEndOf(root.firstChild as Node);

    expect(caret.collapsed).toBe(true);
    expect(caret.startContainer.textContent).toBe("code block");
    expect(caret.startOffset).toBe("code block".length);
  });

  it("is before the <br> that keeps an empty line open", () => {
    const root: HTMLDivElement = mountHtml("<p><br></p>");
    const line: Node = root.firstChild as Node;
    const caret: Range = caretAtEndOf(line);

    expect(caret.startContainer).toBe(line);
    expect(caret.startOffset).toBe(0);
  });
});
