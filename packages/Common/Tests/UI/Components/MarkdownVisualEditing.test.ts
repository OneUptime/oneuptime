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

  it("returns a caret at the end of what it inserted, or null for nothing", () => {
    const root: HTMLDivElement = mountMarkdown("hello");
    const caret: Range | null = insertBlocksAtCaret(
      root,
      caretAt(root, "hello", 5),
      fragmentOf("<hr><p>last</p>"),
    );

    expect(root.innerHTML).toBe("<p>hello</p><hr><p>last</p>");
    expect(caret?.collapsed).toBe(true);
    expect(caret?.startContainer).toBe(root.lastElementChild?.firstChild);
    expect(caret?.startOffset).toBe("last".length);
    expect(
      insertBlocksAtCaret(
        root,
        caretAt(root, "last", 0),
        document.createDocumentFragment(),
      ),
    ).toBeNull();
  });
});

/*
 * A list inserted in a list item -- pasted, or the Task List button's task
 * -- joins that item's list. Kept inside the item, as a code block inserted
 * there is, it was a list nested in it: pasted into the empty item Enter
 * leaves, it showed two bullets ("- - a"), the double bullet of issue #4114.
 */
describe("insertBlocksAtCaret, a list in a list item", () => {
  const LIST: string = "<ul><li>a</li><li>b</li></ul>";

  it("puts a list inserted into an empty item in that item's place", () => {
    const root: HTMLDivElement = mountHtml(
      "<ul><li>first</li><li><br></li></ul>",
    );
    const empty: Element = root.querySelectorAll("li")[1] as Element;

    const caret: Range | null = insertBlocksAtCaret(
      root,
      caretOn(empty, 0),
      fragmentOf(LIST),
    );

    expect(root.innerHTML).toBe("<ul><li>first</li><li>a</li><li>b</li></ul>");
    expect(htmlToMarkdown(root.innerHTML)).toBe("- first\n- a\n- b");
    expect(caretText(caret as Range)).toBe("b");
    expect(caret?.startContainer.parentElement).toBe(
      root.querySelector("li:last-child"),
    );
  });

  it("puts a list inserted at the end of an item after it", () => {
    const root: HTMLDivElement = mountMarkdown("- item one\n- item two");

    insertBlocksAtCaret(root, caretAt(root, "item one", 8), fragmentOf(LIST));

    expect(htmlToMarkdown(root.innerHTML)).toBe(
      "- item one\n- a\n- b\n- item two",
    );
  });

  it("splits the item a list is inserted into the middle of", () => {
    const root: HTMLDivElement = mountMarkdown("- item one\n- item two");

    insertBlocksAtCaret(root, caretAt(root, "one", 0), fragmentOf(LIST));

    expect(htmlToMarkdown(root.innerHTML)).toBe(
      "- item\n- a\n- b\n- one\n- item two",
    );
  });

  it("puts a list inserted at the start of an item before it", () => {
    const root: HTMLDivElement = mountMarkdown("- item one\n- item two");

    insertBlocksAtCaret(root, caretAt(root, "item one", 0), fragmentOf(LIST));

    expect(htmlToMarkdown(root.innerHTML)).toBe(
      "- a\n- b\n- item one\n- item two",
    );
  });

  /*
   * What the item held after the caret -- its own nested list -- goes under
   * the last item inserted, so the text keeps its order. Left where it was,
   * the item it stayed in held nothing else: "- - child".
   */
  it("keeps the nested list of the item after the items inserted at its end", () => {
    const root: HTMLDivElement = mountMarkdown("- parent\n  - child\n- next");

    const caret: Range | null = insertBlocksAtCaret(
      root,
      caretAt(root, "parent", 6),
      fragmentOf(LIST),
    );

    expect(htmlToMarkdown(root.innerHTML)).toBe(
      "- parent\n- a\n- b\n  - child\n- next",
    );
    expect(caretText(caret as Range)).toBe("b");
  });

  // In a loose item the item's own text is its first paragraph.
  it("splits the paragraph of a loose item a list is inserted into the middle of", () => {
    const root: HTMLDivElement = mountHtml(
      "<ul><li><p>one two</p><p>more</p></li></ul>",
    );

    insertBlocksAtCaret(root, caretAt(root, "two", 0), fragmentOf(LIST));

    expect(root.innerHTML).toBe(
      "<ul><li><p>one</p></li><li>a</li><li>b</li><li><p>two</p><p>more</p></li></ul>",
    );
  });

  it("puts the next paragraph of a loose item under the last item inserted at its end", () => {
    const root: HTMLDivElement = mountHtml(
      "<ul><li><p>one two</p><p>more</p></li></ul>",
    );

    insertBlocksAtCaret(root, caretAt(root, "one two", 7), fragmentOf(LIST));

    expect(root.innerHTML).toBe(
      "<ul><li><p>one two</p></li><li>a</li><li>b<p>more</p></li></ul>",
    );
  });

  it("puts a list inserted at the end of a nested item beside that item", () => {
    const root: HTMLDivElement = mountMarkdown("- parent\n  - child\n- next");

    insertBlocksAtCaret(root, caretAt(root, "child", 5), fragmentOf(LIST));

    expect(htmlToMarkdown(root.innerHTML)).toBe(
      "- parent\n  - child\n  - a\n  - b\n- next",
    );
  });

  it("keeps a nested list inserted nested under its own item", () => {
    const root: HTMLDivElement = mountHtml(
      "<ul><li>item one</li><li><br></li></ul>",
    );
    const empty: Element = root.querySelectorAll("li")[1] as Element;

    const caret: Range | null = insertBlocksAtCaret(
      root,
      caretOn(empty, 0),
      fragmentOf(markdownToHtml("- a\n  - a1\n- b")),
    );

    expect(htmlToMarkdown(root.innerHTML)).toBe("- item one\n- a\n  - a1\n- b");
    expect(caretText(caret as Range)).toBe("b");
  });

  it("numbers the items of a list inserted into a numbered one", () => {
    const root: HTMLDivElement = mountHtml(
      "<ol><li>first</li><li><br></li></ol>",
    );
    const empty: Element = root.querySelectorAll("li")[1] as Element;

    insertBlocksAtCaret(root, caretOn(empty, 0), fragmentOf(LIST));

    expect(htmlToMarkdown(root.innerHTML)).toBe("1. first\n2. a\n3. b");
  });

  // The Task List button, at the end of a task: the next task, not a sub-task.
  it("puts the Task List button's task beside the task the caret ends", () => {
    const root: HTMLDivElement = mountMarkdown("- [ ] task one");

    const caret: Range | null = insertBlocksAtCaret(
      root,
      caretAt(root, "task one", 8),
      fragmentOf(
        '<ul class="task-list"><li class="task-list-item"><input type="checkbox" disabled> Task</li></ul>',
      ),
    );

    expect(htmlToMarkdown(root.innerHTML)).toBe("- [ ] task one\n- [ ] Task");
    expect(caretText(caret as Range)).toBe(" Task");
  });

  /*
   * Chromium leaves the selection on the editor, just before the list, once
   * the Bullet List button has made one in the empty editor.
   */
  it("puts a list inserted just before an empty list in its first item's place", () => {
    const root: HTMLDivElement = mountHtml("<ul><li><br></li></ul>");

    insertBlocksAtCaret(root, caretOn(root, 0), fragmentOf(LIST));

    expect(root.innerHTML).toBe("<ul><li>a</li><li>b</li></ul>");
  });

  it("leaves no empty copy of a bold word at the end of the item", () => {
    const root: HTMLDivElement = mountMarkdown("- run **this** now");

    insertBlocksAtCaret(root, caretAt(root, "this", 4), fragmentOf(LIST));

    expect(htmlToMarkdown(root.innerHTML)).toBe(
      "- run **this**\n- a\n- b\n- now",
    );
  });

  it("still keeps a code block inserted in an item inside that item", () => {
    const root: HTMLDivElement = mountHtml(
      "<ul><li>item one</li><li><br></li></ul>",
    );
    const empty: Element = root.querySelectorAll("li")[1] as Element;

    insertBlocksAtCaret(root, caretOn(empty, 0), fragmentOf(CODE_BLOCK));

    expect(root.querySelector("li:last-child pre")).not.toBeNull();
  });

  it("still keeps a list inserted in a quote in an item inside that quote", () => {
    const root: HTMLDivElement = mountHtml(
      "<ul><li>item<blockquote><p>quoted</p></blockquote></li></ul>",
    );

    insertBlocksAtCaret(root, caretAt(root, "quoted", 6), fragmentOf(LIST));

    expect(root.querySelector("blockquote ul")).not.toBeNull();
    expect(root.querySelectorAll("ul > li")).toHaveLength(3);
  });

  // A list with other blocks is not only list items: it goes in as before.
  it("inserts a list followed by a paragraph as it did", () => {
    const root: HTMLDivElement = mountHtml(
      "<ul><li>item one</li><li><br></li></ul>",
    );
    const empty: Element = root.querySelectorAll("li")[1] as Element;

    insertBlocksAtCaret(
      root,
      caretOn(empty, 0),
      fragmentOf(`${LIST}<p>after</p>`),
    );

    expect(root.querySelector("li:last-child > p")?.textContent).toBe("after");
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

  /*
   * The item whose text the selection took, above the nested item it ended
   * in, stayed as an empty bullet: "- alep\n- \n- gamma".
   */
  it("removes the item a selection into its nested item emptied", () => {
    const root: HTMLDivElement = mountMarkdown(
      "- alpha\n- beta\n  - deep\n- gamma",
    );

    deleteSelectionForInsert(root, rangeBetween(root, "alpha", 2, "deep", 2));

    expect(htmlToMarkdown(root.innerHTML)).toBe("- alep\n- gamma");
  });

  it("removes the quote a selection into its first line emptied", () => {
    const root: HTMLDivElement = mountMarkdown(
      "intro\n\n> quoted text\n\nafter",
    );

    deleteSelectionForInsert(root, rangeBetween(root, "intro", 2, "quoted", 3));

    expect(root.querySelector("blockquote")).toBeNull();
    expect(htmlToMarkdown(root.innerHTML)).toBe("inted text\n\nafter");
  });

  /*
   * What is left of the code block's line joins as text, as typing over the
   * selection does; its other lines stay a code block. Its <code> moved
   * whole, the rest was inline code -- every line after it in one span --
   * and the emptied block an empty fence.
   */
  it("joins what is left of a code block's line as text, and keeps its other lines", () => {
    const root: HTMLDivElement = mountMarkdown(
      "intro\n\n```\ncode line\nsecond\n```",
    );
    const range: Range = rangeBetween(root, "intro", 2, "code line", 4);

    deleteSelectionForInsert(root, range);

    expect(htmlToMarkdown(root.innerHTML)).toBe("in line\n\n```\nsecond\n```");
    expect(root.querySelector("p code")).toBeNull();
    expect(caretText(range)).toBe("in");
  });

  it("removes a one-line code block the selection runs into", () => {
    const root: HTMLDivElement = mountMarkdown("intro\n\n```\ncode line\n```");

    deleteSelectionForInsert(
      root,
      rangeBetween(root, "intro", 2, "code line", 4),
    );

    expect(root.querySelector("pre")).toBeNull();
    expect(htmlToMarkdown(root.innerHTML)).toBe("in line");
  });

  it("removes a code block the selection takes all of", () => {
    const root: HTMLDivElement = mountMarkdown("intro\n\n```\ncode line\n```");

    deleteSelectionForInsert(
      root,
      rangeBetween(root, "intro", 2, "code line", 9),
    );

    expect(root.innerHTML).toBe("<p>in</p>");
  });

  /*
   * Ctrl+A in Chromium and Safari selects from the first text to the last:
   * the line it starts in is emptied too, and stays, holding the caret.
   */
  it("keeps the line holding the caret when it empties everything", () => {
    const root: HTMLDivElement = mountMarkdown("- alpha\n- beta\n  - deep");
    const range: Range = rangeBetween(root, "alpha", 0, "deep", 4);

    deleteSelectionForInsert(root, range);

    expect(root.innerHTML).toBe("<ul><li></li></ul>");
    expect(root.querySelector("li")?.contains(range.startContainer)).toBe(true);
  });

  /*
   * A selection ending at the end of a bold word leaves the <strong> empty:
   * pasted into, the line saved as "Rsee **that****** then check".
   */
  it("removes the formatting a selection ended in when it empties it", () => {
    const root: HTMLDivElement = mountMarkdown("Run **this** then check");

    deleteSelectionForInsert(root, rangeBetween(root, "Run", 1, "this", 4));

    expect(root.innerHTML).toBe("<p>R then check</p>");
  });

  // What is typed next carries on in the formatting the caret is in.
  it("keeps emptied formatting the caret is in", () => {
    const root: HTMLDivElement = mountMarkdown("Run **this** then check");
    const range: Range = rangeBetween(root, "this", 0, "this", 4);

    deleteSelectionForInsert(root, range);

    expect(root.querySelector("strong")?.contains(range.startContainer)).toBe(
      true,
    );
  });
});

/*
 * A selection that runs from one table cell into another is deleted the way
 * typing over it does: both cells stay, and every row keeps its columns.
 * Joined like two lines, the second cell's text moved into the first, the
 * emptied cell went, and the cells after it each moved a column left.
 */
describe("deleteSelectionForInsert across table cells", () => {
  const TABLE: string =
    "| A | B | C |\n| --- | --- | --- |\n| Cell 1 | Cell 2 | Cell 3 |\n| Cell 4 | Cell 5 | Cell 6 |";

  // The text of each row's cells.
  const rowsOf: (root: HTMLElement) => Array<Array<string>> = (
    root: HTMLElement,
  ): Array<Array<string>> => {
    return Array.from(root.querySelectorAll("tr")).map(
      (row: HTMLTableRowElement): Array<string> => {
        return Array.from(row.children).map((cell: Element): string => {
          return cell.textContent || "";
        });
      },
    );
  };

  it("keeps both cells of a selection from one cell into the next", () => {
    const root: HTMLDivElement = mountMarkdown(TABLE);
    const range: Range = rangeBetween(root, "Cell 1", 2, "Cell 2", 2);

    deleteSelectionForInsert(root, range);

    expect(rowsOf(root)).toEqual([
      ["A", "B", "C"],
      ["Ce", "ll 2", "Cell 3"],
      ["Cell 4", "Cell 5", "Cell 6"],
    ]);
    expect(range.startContainer.parentElement?.tagName).toBe("TD");
    expect(caretText(range)).toBe("Ce");
  });

  it("keeps every column of a selection from the header into the body", () => {
    const root: HTMLDivElement = mountMarkdown(TABLE);

    deleteSelectionForInsert(root, rangeBetween(root, "C", 0, "Cell 1", 4));

    expect(rowsOf(root)).toEqual([
      ["A", "B", ""],
      [" 1", "Cell 2", "Cell 3"],
      ["Cell 4", "Cell 5", "Cell 6"],
    ]);
  });

  it("keeps every column of a selection from one row into the next", () => {
    const root: HTMLDivElement = mountMarkdown(TABLE);

    deleteSelectionForInsert(
      root,
      rangeBetween(root, "Cell 3", 2, "Cell 4", 2),
    );

    expect(rowsOf(root)).toEqual([
      ["A", "B", "C"],
      ["Cell 1", "Cell 2", "Ce"],
      ["ll 4", "Cell 5", "Cell 6"],
    ]);
  });

  it("keeps a table a selection from the line above it ends in", () => {
    const root: HTMLDivElement = mountMarkdown(`intro\n\n${TABLE}`);

    deleteSelectionForInsert(root, rangeBetween(root, "intro", 2, "Cell 1", 4));

    expect(root.querySelector("p")?.textContent).toBe("in");
    expect(rowsOf(root)).toContainEqual([" 1", "Cell 2", "Cell 3"]);
  });

  /*
   * Ctrl+A in Chromium and Safari ends the selection inside the last cell's
   * text: the table it empties goes, rather than being saved empty.
   */
  it("removes a table the selection empties, when the caret is not in it", () => {
    const root: HTMLDivElement = mountMarkdown(`intro\n\n${TABLE}`);

    deleteSelectionForInsert(root, rangeBetween(root, "intro", 0, "Cell 6", 6));

    expect(root.querySelector("table")).toBeNull();
    expect(root.textContent).toBe("");
  });

  // Chromium's own rule: a cell's text joins the line after the table.
  it("still joins the line after a table to the cell a selection starts in", () => {
    const root: HTMLDivElement = mountMarkdown(`${TABLE}\n\nafter`);

    deleteSelectionForInsert(root, rangeBetween(root, "Cell 6", 2, "after", 2));

    expect(rowsOf(root)[2]).toEqual(["Cell 4", "Cell 5", "Ceter"]);
    expect(root.querySelector("p")).toBeNull();
  });
});
