import { afterEach, describe, expect, it } from "@jest/globals";
import {
  htmlToMarkdown,
  markdownToHtml,
} from "../../../UI/Components/Markdown.tsx/MarkdownConverters";
import {
  caretAtEndOf,
  deleteSelectionForInsert,
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

  /*
   * With the caret at the very end of a bold word -- where a click on its
   * last letter, or the arrow keys, leave it -- the split copied the <strong>
   * into the second half with nothing in it, which was saved as
   * "**** then check".
   */
  it("leaves no empty copy of the bold word the caret is at the end of", () => {
    const root: HTMLDivElement = mountHtml(
      "<p>Run <strong>this</strong> then check</p>",
    );

    insertBlocksAtCaret(root, caretAt(root, "this", 4), fragmentOf(CODE_BLOCK));

    expect(root.innerHTML).toBe(
      `<p>Run <strong>this</strong></p>${CODE_BLOCK}<p>then check</p>`,
    );
    expect(htmlToMarkdown(root.innerHTML)).toBe(
      "Run **this**\n\n```\ncode block\n```\n\nthen check",
    );
  });

  // At the very start of one, the emptied <strong> stayed behind: "Run ****".
  it("leaves no emptied bold word behind when the caret is at its start", () => {
    const root: HTMLDivElement = mountHtml(
      "<p>Run <strong>this</strong> then check</p>",
    );

    insertBlocksAtCaret(root, caretAt(root, "this", 0), fragmentOf(CODE_BLOCK));

    expect(root.innerHTML).toBe(
      `<p>Run</p>${CODE_BLOCK}<p><strong>this</strong> then check</p>`,
    );
  });

  /*
   * An empty link was saved as its address -- a second link, the note never
   * had one -- and an empty strikethrough as "~~~~", which opens a code
   * fence that runs to the end of the note.
   */
  it.each([
    [
      "link",
      "See [docs](https://x.test/) now",
      "docs",
      "See [docs](https://x.test/)\n\n```\ncode block\n```\n\nnow",
    ],
    ["italic text", "a *b* c", "b", "a *b*\n\n```\ncode block\n```\n\nc"],
    [
      "inline code",
      "Run `npm i` now",
      "npm i",
      "Run `npm i`\n\n```\ncode block\n```\n\nnow",
    ],
    [
      "struck-through text",
      "old ~~gone~~ new",
      "gone",
      "old ~~gone~~\n\n```\ncode block\n```\n\nnew",
    ],
  ])(
    "leaves no empty copy of the %s the caret is at the end of",
    (_what: string, markdown: string, word: string, expected: string) => {
      const root: HTMLDivElement = mountMarkdown(markdown);

      insertBlocksAtCaret(
        root,
        caretAt(root, word, word.length),
        fragmentOf(CODE_BLOCK),
      );

      expect(htmlToMarkdown(root.innerHTML)).toBe(expected);
    },
  );

  it("leaves no empty copy of a link the caret is at the start of", () => {
    const root: HTMLDivElement = mountMarkdown(
      "See [docs](https://x.test/) now",
    );

    insertBlocksAtCaret(root, caretAt(root, "docs", 0), fragmentOf(CODE_BLOCK));

    expect(htmlToMarkdown(root.innerHTML)).toBe(
      "See\n\n```\ncode block\n```\n\n[docs](https://x.test/) now",
    );
  });

  it("leaves no empty copy of formatting nested in formatting", () => {
    const root: HTMLDivElement = mountHtml(
      "<p>a <strong><em>b</em></strong> c</p>",
    );

    insertBlocksAtCaret(root, caretAt(root, "b", 1), fragmentOf("<hr>"));

    expect(root.innerHTML).toBe(
      "<p>a <strong><em>b</em></strong></p><hr><p>c</p>",
    );
  });

  it("leaves no empty copy of the bold word in a list item either", () => {
    const root: HTMLDivElement = mountMarkdown("- run **this** now");

    insertBlocksAtCaret(root, caretAt(root, "this", 4), fragmentOf(CODE_BLOCK));

    expect(htmlToMarkdown(root.innerHTML)).toBe(
      "- run **this**\n\n  ```\n  code block\n  ```\n\n  now",
    );
    expect(root.querySelectorAll("strong")).toHaveLength(1);
  });

  it("leaves no emptied bold word behind in a list item either", () => {
    const root: HTMLDivElement = mountMarkdown("- run **this** now");

    insertBlocksAtCaret(root, caretAt(root, "this", 0), fragmentOf(CODE_BLOCK));

    expect(htmlToMarkdown(root.innerHTML)).toBe(
      "- run\n\n  ```\n  code block\n  ```\n\n  **this** now",
    );
  });

  // What a selection taking a whole bold word leaves at the caret.
  it("drops formatting emptied before the split", () => {
    const root: HTMLDivElement = mountHtml("<p>Run <strong></strong> then</p>");
    const line: Element = root.firstElementChild as Element;

    insertBlocksAtCaret(root, caretOn(line, 2), fragmentOf("<hr>"));

    expect(root.innerHTML).toBe("<p>Run</p><hr><p>then</p>");
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

// A range from `startOffset` into the text holding `start` to `endOffset` into the text holding `end`.
const rangeBetween: (
  root: HTMLElement,
  start: string,
  startOffset: number,
  end: string,
  endOffset: number,
) => Range = (
  root: HTMLElement,
  start: string,
  startOffset: number,
  end: string,
  endOffset: number,
): Range => {
  const range: Range = caretAt(root, start, startOffset);
  const endPoint: Range = caretAt(root, end, endOffset);
  range.setEnd(endPoint.startContainer, endPoint.startOffset);
  return range;
};

// What the caret is next to: the text before it in its text node, and its line.
const caretText: (range: Range) => string = (range: Range): string => {
  return (range.startContainer.textContent || "").slice(0, range.startOffset);
};

describe("deleteSelectionForInsert", () => {
  /*
   * Range.deleteContents alone left both items and the caret between them,
   * straight inside the <ul>: a link pasted there showed in the editor and
   * never reached the saved markdown.
   */
  it("joins what is left of the second list item to the first, with the caret at the join", () => {
    const root: HTMLDivElement = mountMarkdown("- alpha\n- beta\n- gamma");
    const range: Range = rangeBetween(root, "alpha", 2, "beta", 2);

    deleteSelectionForInsert(root, range);

    expect(root.innerHTML).toBe("<ul><li>alta</li><li>gamma</li></ul>");
    expect(range.collapsed).toBe(true);
    expect(range.startContainer.parentElement?.tagName).toBe("LI");
    expect(caretText(range)).toBe("al");
  });

  it("joins two paragraphs the same way", () => {
    const root: HTMLDivElement = mountMarkdown("first para\n\nsecond para");
    const range: Range = rangeBetween(root, "first", 2, "second", 2);

    deleteSelectionForInsert(root, range);

    expect(root.innerHTML).toBe("<p>ficond para</p>");
    expect(caretText(range)).toBe("fi");
  });

  /*
   * A triple click selects an item up to the very start of the next one; a
   * paste then replaces that item and leaves the next alone.
   */
  it("leaves the next line alone when the selection stops at its start", () => {
    const root: HTMLDivElement = mountMarkdown("- alpha\n- beta\n- gamma");
    const items: NodeListOf<HTMLLIElement> = root.querySelectorAll("li");
    const range: Range = document.createRange();
    range.setStart(items[1]?.firstChild as Node, 0);
    range.setEnd(items[2] as Node, 0);

    deleteSelectionForInsert(root, range);

    expect(htmlToMarkdown(root.innerHTML)).toBe("- alpha\n- \n- gamma");
    expect(range.startContainer.parentElement).toBe(items[1]);
  });

  it("takes the joined item's nested list along to the item it joins", () => {
    const root: HTMLDivElement = mountMarkdown(
      "- alpha\n  - sub\n    - deep\n- beta",
    );

    deleteSelectionForInsert(root, rangeBetween(root, "alpha", 2, "sub", 2));

    expect(htmlToMarkdown(root.innerHTML)).toBe("- alb\n  - deep\n- beta");
  });

  /*
   * A nested item joined to its parent keeps its place in the text: what it
   * held comes right after the join, ahead of the nested items that followed
   * it. Added at the end of the parent, "deep" came out after "gamma".
   */
  it("keeps what a nested item held ahead of the items that followed it", () => {
    const root: HTMLDivElement = mountMarkdown(
      "- alpha\n  - beta\n    - deep\n  - gamma\n- omega",
    );

    deleteSelectionForInsert(root, rangeBetween(root, "alpha", 2, "beta", 2));

    expect(htmlToMarkdown(root.innerHTML)).toBe(
      "- alta\n  - deep\n  - gamma\n- omega",
    );
  });

  it("keeps a code block a nested item held ahead of the items that followed it", () => {
    const root: HTMLDivElement = mountMarkdown(
      "- alpha\n  - beta\n\n    ```\n    code\n    ```\n  - gamma",
    );

    deleteSelectionForInsert(root, rangeBetween(root, "alpha", 2, "beta", 2));

    const markdown: string = htmlToMarkdown(root.innerHTML);
    expect(markdown.indexOf("code")).toBeLessThan(markdown.indexOf("gamma"));
    expect(markdown.startsWith("- alta\n")).toBe(true);
  });

  it("removes the list item it empties, and the list with it", () => {
    const root: HTMLDivElement = mountMarkdown("first para\n\n- alpha");

    deleteSelectionForInsert(root, rangeBetween(root, "first", 2, "alpha", 5));

    expect(root.innerHTML).toBe("<p>fi</p>");
  });

  it("moves a caret that starts between list items into the item after it", () => {
    const root: HTMLDivElement = mountMarkdown("- alpha\n- beta");
    const list: Element = root.querySelector("ul") as Element;
    const selection: Range = document.createRange();
    selection.setStart(list, 1);
    selection.setEnd(list.lastElementChild?.firstChild as Node, 2);

    deleteSelectionForInsert(root, selection);

    expect(selection.startContainer.nodeName).toBe("LI");
    expect(htmlToMarkdown(root.innerHTML)).toBe("- alpha\n- ta");
  });

  it("does nothing to a caret", () => {
    const root: HTMLDivElement = mountMarkdown("- alpha\n- beta");
    const range: Range = caretAt(root, "alpha", 2);

    deleteSelectionForInsert(root, range);

    expect(htmlToMarkdown(root.innerHTML)).toBe("- alpha\n- beta");
    expect(caretText(range)).toBe("al");
  });
});
