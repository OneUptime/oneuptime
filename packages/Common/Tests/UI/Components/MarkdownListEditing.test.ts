import { afterEach, describe, expect, it } from "@jest/globals";
import DOMPurify from "dompurify";
import { marked, Token, Tokens } from "marked";
import {
  htmlToMarkdown,
  markdownToHtml,
} from "../../../UI/Components/Markdown.tsx/MarkdownConverters";
import {
  indentMarkdownLines,
  liftListItems,
  MarkdownTextEdit,
  outdentMarkdownLines,
  sinkListItems,
  stripTextListMarkers,
  toggleMarkdownList,
} from "../../../UI/Components/Markdown.tsx/MarkdownListEditing";

/*
 * Indent and outdent for the MarkdownEditor's lists (issue #4114), and the
 * list buttons' clean-up of bullet characters typed or pasted as text.
 *
 * The source-mode functions are checked against the exact text they write
 * and, for the nesting, against both parsers that read it: the editor's own
 * (markdownToHtml) and marked, which renders the same markdown into emails.
 * A nested item that is one column short of its parent's content column
 * looks nested in the textarea and is a sibling to both of them.
 */

/*
 * A list's nesting as marked sees it: "ul[li,ul[li]]" is a list whose second
 * item holds a nested list of one item.
 */
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

// The same shape read off the editor's own parser.
const internalShape: (markdown: string) => string = (
  markdown: string,
): string => {
  const container: HTMLDivElement = document.createElement("div");
  container.innerHTML = markdownToHtml(markdown);
  const describe: (element: Element) => string = (element: Element): string => {
    const tag: string = element.tagName.toLowerCase();
    if (tag !== "ul" && tag !== "ol") {
      return tag;
    }
    const items: Array<string> = Array.from(element.children).map(
      (item: Element): string => {
        const nested: Array<string> = Array.from(item.children)
          .filter((child: Element): boolean => {
            return ["ul", "ol"].includes(child.tagName.toLowerCase());
          })
          .map(describe);
        return nested.length > 0 ? `li[${nested.join("")}]` : "li";
      },
    );
    return `${tag}[${items.join(",")}]`;
  };
  return Array.from(container.children)
    .map(describe)
    .join(" ")
    .replace(/\bp\b/g, "paragraph");
};

const at: (text: string, needle: string) => number = (
  text: string,
  needle: string,
): number => {
  const index: number = text.indexOf(needle);
  if (index === -1) {
    throw new Error(`"${needle}" is not in the text`);
  }
  return index;
};

const indentAt: (text: string, needle: string) => MarkdownTextEdit | null = (
  text: string,
  needle: string,
): MarkdownTextEdit | null => {
  const caret: number = at(text, needle);
  return indentMarkdownLines(text, caret, caret);
};

const outdentAt: (text: string, needle: string) => MarkdownTextEdit | null = (
  text: string,
  needle: string,
): MarkdownTextEdit | null => {
  const caret: number = at(text, needle);
  return outdentMarkdownLines(text, caret, caret);
};

const textOf: (edit: MarkdownTextEdit | null) => string = (
  edit: MarkdownTextEdit | null,
): string => {
  if (!edit) {
    throw new Error("expected an edit, got null");
  }
  return edit.text;
};

describe("indentMarkdownLines", () => {
  it("nests an item under the one before it, taking its own nested items along", () => {
    const edit: MarkdownTextEdit | null = indentAt("- a\n- b\n  - c\n- d", "b");

    expect(textOf(edit)).toBe("- a\n  - b\n    - c\n- d");
    expect(listShape(textOf(edit))).toBe("ul[li[ul[li[ul[li]]]],li]");
    expect(internalShape(textOf(edit))).toBe("ul[li[ul[li[ul[li]]]],li]");
  });

  it("moves under a numbered item to its content column, three columns in", () => {
    const edit: MarkdownTextEdit | null = indentAt("1. a\n2. b\n3. c", "b");

    expect(textOf(edit)).toBe("1. a\n   1. b\n2. c");
    expect(listShape(textOf(edit))).toBe("ol[li[ol[li]],li]");
    expect(internalShape(textOf(edit))).toBe("ol[li[ol[li]],li]");
  });

  /*
   * Two spaces -- a fixed-width indent -- would leave "b" short of the
   * content column of "10." and a sibling of "a" to both parsers.
   */
  it("moves under a two-digit number to its content column, four columns in", () => {
    const edit: MarkdownTextEdit | null = indentAt("10. a\n11. b", "b");

    expect(textOf(edit)).toBe("10. a\n    1. b");
    expect(listShape(textOf(edit))).toBe("ol[li[ol[li]]]");
    expect(internalShape(textOf(edit))).toBe("ol[li[ol[li]]]");
  });

  it("uses the content column of a marker followed by several spaces", () => {
    const edit: MarkdownTextEdit | null = indentAt("-   a\n- b", "b");

    expect(textOf(edit)).toBe("-   a\n    - b");
    expect(listShape(textOf(edit))).toBe("ul[li[ul[li]]]");
    expect(internalShape(textOf(edit))).toBe("ul[li[ul[li]]]");
  });

  /*
   * A new nested ordered list takes its first number as its start, so "2."
   * kept as it was would render the nested list from 2.
   */
  it("numbers an ordered item from 1 when it starts a new nested list", () => {
    const edit: MarkdownTextEdit | null = indentAt("1. a\n2. b", "b");

    expect(textOf(edit)).toBe("1. a\n   1. b");
    expect(markdownToHtml(textOf(edit))).toBe(
      "<ol><li>a<ol><li>b</li></ol></li></ol>",
    );
  });

  it("renumbers the items left behind in an ordered list", () => {
    expect(textOf(indentAt("1. a\n2. b\n3. c\n4. d", "b"))).toBe(
      "1. a\n   1. b\n2. c\n3. d",
    );
  });

  it("continues the numbering of the nested list an item joins", () => {
    const edit: MarkdownTextEdit | null = indentAt(
      "1. a\n   1. x\n   2. y\n2. b",
      "b",
    );

    expect(textOf(edit)).toBe("1. a\n   1. x\n   2. y\n   3. b");
  });

  it("takes the marker of the nested list an item joins", () => {
    expect(textOf(indentAt("- a\n  1. x\n- b", "b"))).toBe(
      "- a\n  1. x\n  2. b",
    );
    expect(textOf(indentAt("- a\n  * x\n- b", "b"))).toBe("- a\n  * x\n  * b");
  });

  it("indents every selected sibling, the later ones joining the first", () => {
    const text: string = "1. a\n2. b\n3. c\n4. d";
    const edit: MarkdownTextEdit | null = indentMarkdownLines(
      text,
      at(text, "b"),
      at(text, "c") + 1,
    );

    expect(textOf(edit)).toBe("1. a\n   1. b\n   2. c\n2. d");
    expect(listShape(textOf(edit))).toBe("ol[li[ol[li,li]],li]");
    expect(internalShape(textOf(edit))).toBe("ol[li[ol[li,li]],li]");
  });

  it("keeps a task item's box when it is indented", () => {
    expect(textOf(indentAt("- [ ] a\n- [x] b", "b"))).toBe(
      "- [ ] a\n  - [x] b",
    );
  });

  it("moves an item's continuation text and fenced code along with it", () => {
    const text: string = "- a\n- b\n  more of b\n\n  ```\n  code\n  ```\n- c";

    expect(textOf(indentAt(text, "- b"))).toBe(
      "- a\n  - b\n    more of b\n\n    ```\n    code\n    ```\n- c",
    );
  });

  it("indents from a continuation line of the item", () => {
    expect(textOf(indentAt("- a\n- b\n  more of b", "more"))).toBe(
      "- a\n  - b\n    more of b",
    );
  });

  it("writes spaces for a tab that followed the marker", () => {
    const edit: MarkdownTextEdit | null = indentAt("-\ta\n-\tb", "b");

    expect(textOf(edit)).toBe("-\ta\n    -   b");
    expect(listShape(textOf(edit))).toBe("ul[li[ul[li]]]");
  });

  describe("does nothing, so Tab can move focus on", () => {
    it("for the first item of a list", () => {
      expect(indentAt("- a\n- b", "a")).toBeNull();
      expect(indentAt("- a\n  - b\n  - c", "b")).toBeNull();
    });

    it("for text that is not in a list", () => {
      expect(indentAt("Intro\n- a", "Intro")).toBeNull();
      expect(indentMarkdownLines("", 0, 0)).toBeNull();
    });

    it("on a blank line between items", () => {
      const text: string = "- a\n\n- b";

      expect(indentMarkdownLines(text, 4, 4)).toBeNull();
    });

    it("inside a fenced code block, and on its fence", () => {
      const text: string = "- a\n```\n- b\n- c\n```";

      expect(indentAt(text, "- c")).toBeNull();
      expect(
        indentMarkdownLines(text, at(text, "```"), at(text, "```")),
      ).toBeNull();
    });

    it("after a paragraph that ends the list above", () => {
      expect(indentAt("- a\n\nparagraph\n- b", "b")).toBeNull();
    });
  });

  /*
   * Dragging over whole lines ends the selection at column 0 of the line
   * after them. That line is not selected, so it does not move.
   */
  it("leaves out the line a selection ends at column 0 of", () => {
    const text: string = "- a\n- b\n- c";
    const edit: MarkdownTextEdit | null = indentMarkdownLines(
      text,
      at(text, "- b"),
      at(text, "- c"),
    );

    expect(textOf(edit)).toBe("- a\n  - b\n- c");
  });

  it("keeps the caret on the same character", () => {
    const text: string = "- a\n- bravo";
    const edit: MarkdownTextEdit | null = indentMarkdownLines(
      text,
      at(text, "avo"),
      at(text, "avo"),
    );

    expect(edit?.text.slice(edit.selectionStart)).toBe("avo");
    expect(edit?.selectionEnd).toBe(edit?.selectionStart);
  });

  it("keeps whole selected lines selected, from column 0", () => {
    const text: string = "- a\n- b\n- c";
    const edit: MarkdownTextEdit | null = indentMarkdownLines(
      text,
      at(text, "- b"),
      text.length,
    );

    expect(textOf(edit)).toBe("- a\n  - b\n  - c");
    expect(edit?.selectionStart).toBe(4);
    expect(edit?.text.slice(edit.selectionStart, edit.selectionEnd)).toBe(
      "  - b\n  - c",
    );
  });

  it("moves a caret at the start of the line along with the marker", () => {
    const text: string = "- a\n- b";
    const edit: MarkdownTextEdit | null = indentMarkdownLines(text, 4, 4);

    expect(edit?.selectionStart).toBe(6);
    expect(edit?.text.slice(6)).toBe("- b");
  });
});

describe("outdentMarkdownLines", () => {
  it("moves an item out beside its parent, taking its own nested items along", () => {
    const edit: MarkdownTextEdit | null = outdentAt(
      "- a\n  - b\n    - c\n- d",
      "b",
    );

    expect(textOf(edit)).toBe("- a\n- b\n  - c\n- d");
    expect(listShape(textOf(edit))).toBe("ul[li,li[ul[li]],li]");
    expect(internalShape(textOf(edit))).toBe("ul[li,li[ul[li]],li]");
  });

  /*
   * A bullet moved out into a numbered list keeping its "-" would split the
   * list in three: "1. a", then a one-item bullet list, then "2. c".
   */
  it("takes the marker of the list it moves into, and numbers on from its parent", () => {
    const edit: MarkdownTextEdit | null = outdentAt("1. a\n   - b\n2. c", "b");

    expect(textOf(edit)).toBe("1. a\n2. b\n3. c");
    expect(listShape(textOf(edit))).toBe("ol[li,li,li]");
    expect(internalShape(textOf(edit))).toBe("ol[li,li,li]");
  });

  it("takes a bullet parent's marker", () => {
    expect(textOf(outdentAt("* a\n  1. b", "b"))).toBe("* a\n* b");
  });

  it("makes the items after it its own children, numbered from 1", () => {
    const edit: MarkdownTextEdit | null = outdentAt(
      "1. a\n   1. b\n   2. c\n   3. d",
      "b",
    );

    expect(textOf(edit)).toBe("1. a\n2. b\n   1. c\n   2. d");
    expect(listShape(textOf(edit))).toBe("ol[li,li[ol[li,li]]]");
    expect(internalShape(textOf(edit))).toBe("ol[li,li[ol[li,li]]]");
  });

  /*
   * "9." becomes "10." on the way out, a column wider, so the items it now
   * holds move a column right to stay inside it.
   */
  it("re-indents the items it now holds when its new marker is wider", () => {
    const edit: MarkdownTextEdit | null = outdentAt(
      "9. a\n   - b\n   - c",
      "b",
    );

    expect(textOf(edit)).toBe("9. a\n10. b\n    - c");
    expect(listShape(textOf(edit))).toBe("ol[li,li[ul[li]]]");
    expect(internalShape(textOf(edit))).toBe("ol[li,li[ul[li]]]");
  });

  it("outdents every selected sibling", () => {
    const text: string = "- a\n  - b\n  - c";
    const edit: MarkdownTextEdit | null = outdentMarkdownLines(
      text,
      at(text, "b"),
      text.length,
    );

    expect(textOf(edit)).toBe("- a\n- b\n- c");
  });

  it("outdents a third-level item one level only", () => {
    expect(textOf(outdentAt("- a\n  - b\n    - c", "c"))).toBe(
      "- a\n  - b\n  - c",
    );
  });

  describe("does nothing, so Shift+Tab can move focus back", () => {
    it("for a top-level item", () => {
      expect(outdentAt("- a\n- b", "b")).toBeNull();
    });

    it("for text that is not in a list", () => {
      expect(outdentAt("  indented text", "indented")).toBeNull();
    });

    it("inside a fenced code block", () => {
      expect(outdentAt("- a\n  ```\n  - b\n  ```", "- b")).toBeNull();
    });
  });

  it("undoes an indent", () => {
    const sources: Array<string> = [
      "- a\n- b\n- c",
      "1. a\n2. b\n3. c",
      "- a\n- b\n  - c\n- d",
      "10. a\n11. b",
    ];
    for (const source of sources) {
      const indented: MarkdownTextEdit | null = indentAt(source, "b");
      const back: MarkdownTextEdit | null = outdentMarkdownLines(
        textOf(indented),
        indented?.selectionStart ?? 0,
        indented?.selectionEnd ?? 0,
      );

      expect(textOf(back)).toBe(source);
    }
  });
});

describe("toggleMarkdownList", () => {
  /*
   * The issue's double bullets: a line pasted from Word still started with
   * "•", and the button put "- " in front of it (and of the first line only).
   */
  it("replaces a pasted bullet character on every selected line", () => {
    const text: string = "•\tService down\nsecond line";
    const edit: MarkdownTextEdit | null = toggleMarkdownList(
      text,
      0,
      text.length,
      "bullet",
    );

    expect(textOf(edit)).toBe("- Service down\n- second line");
  });

  it("repairs a double bullet saved before the fix instead of removing the list", () => {
    const text: string = "- •\tService down\n- o\tUsers cannot log in";

    expect(textOf(toggleMarkdownList(text, 0, text.length, "bullet"))).toBe(
      "- Service down\n- Users cannot log in",
    );
  });

  it("numbers the selected lines 1, 2, 3, replacing their bullets", () => {
    const text: string = "- a\n- b\n* c";

    expect(textOf(toggleMarkdownList(text, 0, text.length, "ordered"))).toBe(
      "1. a\n2. b\n3. c",
    );
  });

  it("leaves blank lines in the selection alone", () => {
    const text: string = "a\n\nb";

    expect(textOf(toggleMarkdownList(text, 0, text.length, "bullet"))).toBe(
      "- a\n\n- b",
    );
  });

  it("takes the markers off when every selected line already has them", () => {
    const text: string = "- a\n  - b";

    expect(textOf(toggleMarkdownList(text, 0, text.length, "bullet"))).toBe(
      "a\n  b",
    );
    expect(textOf(toggleMarkdownList("1. a\n2. b", 0, 9, "ordered"))).toBe(
      "a\nb",
    );
  });

  it("adds the marker to every line when only some have it", () => {
    const text: string = "- a\nb";

    expect(textOf(toggleMarkdownList(text, 0, text.length, "bullet"))).toBe(
      "- a\n- b",
    );
  });

  it("keeps a task item's checked state and adds boxes to the rest", () => {
    const text: string = "- [x] done\nnext";

    expect(textOf(toggleMarkdownList(text, 0, text.length, "task"))).toBe(
      "- [x] done\n- [ ] next",
    );
    expect(textOf(toggleMarkdownList("- [x] a\n- [ ] b", 0, 15, "task"))).toBe(
      "a\nb",
    );
  });

  it("turns a task item into a plain bullet", () => {
    expect(textOf(toggleMarkdownList("- [x] a", 0, 0, "bullet"))).toBe("- a");
  });

  it("keeps each line's indentation", () => {
    const text: string = "a\n  b";

    expect(textOf(toggleMarkdownList(text, 0, text.length, "bullet"))).toBe(
      "- a\n  - b",
    );
  });

  it("starts a list on an empty line, with the caret after the marker", () => {
    const edit: MarkdownTextEdit | null = toggleMarkdownList(
      "",
      0,
      0,
      "bullet",
    );

    expect(edit).toEqual({ text: "- ", selectionStart: 2, selectionEnd: 2 });
    expect(toggleMarkdownList("a\n\nb", 2, 2, "ordered")).toEqual({
      text: "a\n1. \nb",
      selectionStart: 5,
      selectionEnd: 5,
    });
  });

  it("uses only the caret's line when nothing is selected", () => {
    const text: string = "a\nb\nc";
    const edit: MarkdownTextEdit | null = toggleMarkdownList(
      text,
      at(text, "b"),
      at(text, "b"),
      "bullet",
    );

    expect(textOf(edit)).toBe("a\n- b\nc");
    expect(edit?.selectionStart).toBe(4);
  });

  it("does not touch lines inside a fenced code block", () => {
    const text: string = "a\n```\ncode\n```\nb";

    expect(textOf(toggleMarkdownList(text, 0, text.length, "bullet"))).toBe(
      "- a\n```\ncode\n```\n- b",
    );
    expect(
      toggleMarkdownList(text, at(text, "code"), at(text, "code"), "bullet"),
    ).toBeNull();
  });

  it("leaves out the line a selection ends at column 0 of", () => {
    const text: string = "a\nb\nc";

    expect(textOf(toggleMarkdownList(text, 0, at(text, "c"), "ordered"))).toBe(
      "1. a\n2. b\nc",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Visual mode
 * ---------------------------------------------------------------------------
 */

// The editor's own sanitizer config (MarkdownEditor.tsx).
const sanitize: (html: string) => string = (html: string): string => {
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
};

let editable: HTMLDivElement | null = null;

const mountEditable: (markdown: string) => HTMLDivElement = (
  markdown: string,
): HTMLDivElement => {
  const root: HTMLDivElement = document.createElement("div");
  root.setAttribute("contenteditable", "true");
  root.innerHTML = sanitize(markdownToHtml(markdown));
  document.body.appendChild(root);
  editable = root;
  return root;
};

afterEach(() => {
  editable?.remove();
  editable = null;
  window.getSelection()?.removeAllRanges();
});

const itemContaining: (root: HTMLElement, text: string) => HTMLLIElement = (
  root: HTMLElement,
  text: string,
): HTMLLIElement => {
  const item: HTMLLIElement | undefined = Array.from(
    root.querySelectorAll("li"),
  ).find((li: HTMLLIElement): boolean => {
    return (li.firstChild?.textContent || "").trim() === text;
  });
  if (!item) {
    throw new Error(`no item "${text}"`);
  }
  return item;
};

// Puts the caret `offset` characters into the item's own text.
const caretIn: (item: HTMLElement, offset: number) => void = (
  item: HTMLElement,
  offset: number,
): void => {
  const range: Range = document.createRange();
  range.setStart(item.firstChild as Node, offset);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

const select: (
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number,
) => void = (
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number,
): void => {
  const range: Range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

const markdownOf: (root: HTMLElement) => string = (
  root: HTMLElement,
): string => {
  return htmlToMarkdown(root.innerHTML);
};

describe("sinkListItems", () => {
  it("nests the item under the one before it, with its own nested items", () => {
    const root: HTMLDivElement = mountEditable("- a\n- b\n  - c\n- d");
    caretIn(itemContaining(root, "b"), 1);

    expect(sinkListItems(root)).toBe(true);
    expect(markdownOf(root)).toBe("- a\n  - b\n    - c\n- d");
  });

  it("starts a nested list of the same kind for a numbered item", () => {
    const root: HTMLDivElement = mountEditable("1. a\n2. b\n3. c");
    caretIn(itemContaining(root, "b"), 0);

    expect(sinkListItems(root)).toBe(true);
    expect(markdownOf(root)).toBe("1. a\n   1. b\n2. c");
  });

  it("joins the nested list the item before already has, taking its kind", () => {
    const root: HTMLDivElement = mountEditable("- a\n  1. x\n- b");
    caretIn(itemContaining(root, "b"), 0);

    expect(sinkListItems(root)).toBe(true);
    expect(markdownOf(root)).toBe("- a\n  1. x\n  2. b");
  });

  it("keeps a task item a task item in its new nested list", () => {
    const root: HTMLDivElement = mountEditable("- [ ] a\n- [x] b");
    const item: HTMLLIElement = root.querySelectorAll("li")[1] as HTMLLIElement;
    const range: Range = document.createRange();
    range.setStart(item.lastChild as Node, 1);
    range.collapse(true);
    window.getSelection()?.addRange(range);

    expect(sinkListItems(root)).toBe(true);
    expect(root.querySelector("li ul")?.className).toBe("task-list");
    expect(markdownOf(root)).toBe("- [ ] a\n  - [x] b");
  });

  it("moves every item the selection reaches, and keeps the selection", () => {
    const root: HTMLDivElement = mountEditable("- a\n- bb\n- cc\n- d");
    const b: HTMLLIElement = itemContaining(root, "bb");
    const c: HTMLLIElement = itemContaining(root, "cc");
    select(b.firstChild as Node, 1, c.firstChild as Node, 1);

    expect(sinkListItems(root)).toBe(true);
    expect(markdownOf(root)).toBe("- a\n  - bb\n  - cc\n- d");
    expect(window.getSelection()?.toString()).toBe("bc");
    expect(window.getSelection()?.anchorNode).toBe(b.firstChild);
    expect(window.getSelection()?.anchorOffset).toBe(1);
  });

  /*
   * A triple click selects an item's text and ends the selection at the
   * start of the next item. That item is not part of the selection.
   */
  it("leaves out an item the selection only reaches the start of", () => {
    const root: HTMLDivElement = mountEditable("- a\n- b\n- c");
    const b: HTMLLIElement = itemContaining(root, "b");
    const c: HTMLLIElement = itemContaining(root, "c");
    select(b.firstChild as Node, 0, c.firstChild as Node, 0);

    expect(sinkListItems(root)).toBe(true);
    expect(markdownOf(root)).toBe("- a\n  - b\n- c");
  });

  it("keeps the caret where it was in the moved item", () => {
    const root: HTMLDivElement = mountEditable("- a\n- bravo");
    const item: HTMLLIElement = itemContaining(root, "bravo");
    caretIn(item, 2);

    expect(sinkListItems(root)).toBe(true);
    expect(window.getSelection()?.anchorNode).toBe(item.firstChild);
    expect(window.getSelection()?.anchorOffset).toBe(2);
  });

  it("treats a caret on the list itself as in the item after it", () => {
    const root: HTMLDivElement = mountEditable("- a\n- b");
    const list: HTMLUListElement = root.querySelector("ul") as HTMLUListElement;
    const range: Range = document.createRange();
    range.setStart(list, 1);
    range.collapse(true);
    window.getSelection()?.addRange(range);

    expect(sinkListItems(root)).toBe(true);
    expect(markdownOf(root)).toBe("- a\n  - b");
  });

  describe("does nothing, so Tab can move focus on", () => {
    it("for the first item of a list", () => {
      const root: HTMLDivElement = mountEditable("- a\n- b");
      const before: string = root.innerHTML;
      caretIn(itemContaining(root, "a"), 0);

      expect(sinkListItems(root)).toBe(false);
      expect(root.innerHTML).toBe(before);
    });

    it("outside a list", () => {
      const root: HTMLDivElement = mountEditable("para\n\n- a");
      const range: Range = document.createRange();
      range.setStart(root.querySelector("p")?.firstChild as Node, 1);
      window.getSelection()?.addRange(range);

      expect(sinkListItems(root)).toBe(false);
    });

    it("when the selection is outside the editor", () => {
      const root: HTMLDivElement = mountEditable("- a\n- b");
      const outside: HTMLParagraphElement = document.createElement("p");
      outside.textContent = "elsewhere";
      document.body.appendChild(outside);
      select(outside.firstChild as Node, 0, outside.firstChild as Node, 0);

      expect(sinkListItems(root)).toBe(false);
      outside.remove();
    });

    it("with no selection at all", () => {
      const root: HTMLDivElement = mountEditable("- a\n- b");

      expect(sinkListItems(root)).toBe(false);
    });
  });
});

describe("liftListItems", () => {
  it("moves a nested item out beside its parent", () => {
    const root: HTMLDivElement = mountEditable("- a\n  - b\n    - c\n- d");
    caretIn(itemContaining(root, "b"), 0);

    expect(liftListItems(root)).toBe(true);
    expect(markdownOf(root)).toBe("- a\n- b\n  - c\n- d");
  });

  it("makes the items after it its children, so the text keeps its order", () => {
    const root: HTMLDivElement = mountEditable("- a\n  - b\n  - c\n  - d");
    caretIn(itemContaining(root, "c"), 0);

    expect(liftListItems(root)).toBe(true);
    expect(markdownOf(root)).toBe("- a\n  - b\n- c\n  - d");
  });

  it("removes the nested list its last item leaves empty", () => {
    const root: HTMLDivElement = mountEditable("- a\n  - b");
    caretIn(itemContaining(root, "b"), 0);

    expect(liftListItems(root)).toBe(true);
    expect(root.innerHTML).toBe("<ul><li>a</li><li>b</li></ul>");
  });

  it("moves an item into a numbered parent list as a numbered item", () => {
    const root: HTMLDivElement = mountEditable("1. a\n   - b\n2. c");
    caretIn(itemContaining(root, "b"), 0);

    expect(liftListItems(root)).toBe(true);
    expect(markdownOf(root)).toBe("1. a\n2. b\n3. c");
  });

  it("moves every selected sibling and keeps the selection", () => {
    const root: HTMLDivElement = mountEditable("- a\n  - bb\n  - cc");
    const b: HTMLLIElement = itemContaining(root, "bb");
    const c: HTMLLIElement = itemContaining(root, "cc");
    select(b.firstChild as Node, 0, c.firstChild as Node, 2);

    expect(liftListItems(root)).toBe(true);
    expect(markdownOf(root)).toBe("- a\n- bb\n- cc");
    expect(window.getSelection()?.toString()).toBe("bbcc");
  });

  describe("does nothing, so Shift+Tab can move focus back", () => {
    it("for a top-level item", () => {
      const root: HTMLDivElement = mountEditable("- a\n- b");
      const before: string = root.innerHTML;
      caretIn(itemContaining(root, "b"), 0);

      expect(liftListItems(root)).toBe(false);
      expect(root.innerHTML).toBe(before);
    });

    /*
     * The editor can itself sit inside a list item on the page. Its
     * top-level items must not be lifted out of it into the page's list.
     */
    it("for a top-level item of an editor that sits inside a list item", () => {
      const pageList: HTMLUListElement = document.createElement("ul");
      const pageItem: HTMLLIElement = document.createElement("li");
      pageList.appendChild(pageItem);
      document.body.appendChild(pageList);
      const root: HTMLDivElement = document.createElement("div");
      root.innerHTML = "<ul><li>a</li></ul>";
      pageItem.appendChild(root);
      caretIn(root.querySelector("li") as HTMLElement, 0);

      expect(liftListItems(root)).toBe(false);
      expect(pageList.children).toHaveLength(1);
      pageList.remove();
    });
  });
});

describe("stripTextListMarkers", () => {
  const selectAll: (root: HTMLElement) => void = (root: HTMLElement): void => {
    const range: Range = document.createRange();
    range.selectNodeContents(root);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  };

  /*
   * What execCommand("insertUnorderedList") leaves when it turns pasted
   * Word lines into a list: the items still start with their bullets.
   */
  it("strips the bullet characters the list now draws itself", () => {
    const root: HTMLDivElement = mountEditable("");
    root.innerHTML =
      "<ul><li>•\tService down</li><li>o\tUsers cannot log in</li><li>§\tDeep</li><li>●  Round</li></ul>";
    selectAll(root);

    expect(stripTextListMarkers(root)).toBe(true);
    expect(markdownOf(root)).toBe(
      "- Service down\n- Users cannot log in\n- Deep\n- Round",
    );
  });

  it("strips a marker split over several nodes and drops what it leaves empty", () => {
    const root: HTMLDivElement = mountEditable("");
    root.innerHTML =
      "<ul><li><strong>•</strong>\u00a0Service <em>down</em></li><li><span>-</span> <b>Users</b></li></ul>";
    selectAll(root);

    expect(stripTextListMarkers(root)).toBe(true);
    expect(markdownOf(root)).toBe("- Service *down*\n- **Users**");
    expect(root.querySelector("strong")).toBeNull();
  });

  it("strips a number written with a tab or a run of spaces", () => {
    const root: HTMLDivElement = mountEditable("");
    root.innerHTML = "<ol><li>1.\tFirst</li><li>2.   Second</li></ol>";
    selectAll(root);

    expect(stripTextListMarkers(root)).toBe(true);
    expect(markdownOf(root)).toBe("1. First\n2. Second");
  });

  it("leaves a sentence that starts with a number, and a word starting with o", () => {
    const root: HTMLDivElement = mountEditable("");
    root.innerHTML = "<ul><li>2021. was a year</li><li>o nobody</li></ul>";
    const before: string = root.innerHTML;
    selectAll(root);

    expect(stripTextListMarkers(root)).toBe(false);
    expect(root.innerHTML).toBe(before);
  });

  it("only touches the items the selection reaches", () => {
    const root: HTMLDivElement = mountEditable("");
    root.innerHTML = "<ul><li>• a</li><li>• b</li></ul>";
    caretIn(root.querySelectorAll("li")[1] as HTMLElement, 2);

    expect(stripTextListMarkers(root)).toBe(true);
    expect(root.innerHTML).toBe("<ul><li>• a</li><li>b</li></ul>");
  });

  it("does nothing without a selection in the editor", () => {
    const root: HTMLDivElement = mountEditable("");
    root.innerHTML = "<ul><li>• a</li></ul>";

    expect(stripTextListMarkers(root)).toBe(false);
  });
});
