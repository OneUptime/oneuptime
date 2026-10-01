import { afterEach, describe, expect, it } from "@jest/globals";
import MarkdownEditorHistory from "../../../UI/Components/Markdown.tsx/MarkdownEditorHistory";

/*
 * Undo and redo for the visual editor's own DOM edits (list moves, inserts
 * made by hand), which the browser's undo stack never hears of. An edit is
 * taken back by reverting the mutations it made, so the very same nodes go
 * back where they were -- the browser's own undo entries for earlier typing
 * point at those nodes and have to keep working.
 */

let root: HTMLDivElement | null = null;

const mount: (html: string) => HTMLDivElement = (
  html: string,
): HTMLDivElement => {
  const element: HTMLDivElement = document.createElement("div");
  element.setAttribute("contenteditable", "true");
  element.innerHTML = html;
  document.body.appendChild(element);
  root = element;
  return element;
};

afterEach(() => {
  root?.remove();
  root = null;
  window.getSelection()?.removeAllRanges();
});

const caretIn: (node: Node, offset: number) => void = (
  node: Node,
  offset: number,
): void => {
  const range: Range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

// An indent as the editor makes it: the second item moves into a new sublist of the first.
const indentSecondItem: (element: HTMLElement) => boolean = (
  element: HTMLElement,
): boolean => {
  const items: NodeListOf<HTMLLIElement> = element.querySelectorAll("li");
  const sublist: HTMLUListElement = document.createElement("ul");
  items[0]?.appendChild(sublist);
  sublist.appendChild(items[1] as HTMLLIElement);
  return true;
};

describe("MarkdownEditorHistory", () => {
  it("takes an edit back by putting the same nodes back where they were", () => {
    const element: HTMLDivElement = mount("<ul><li>a</li><li>b</li></ul>");
    const history: MarkdownEditorHistory = new MarkdownEditorHistory();
    const b: HTMLLIElement = element.querySelectorAll("li")[1] as HTMLLIElement;

    expect(
      history.record(element, () => {
        return indentSecondItem(element);
      }),
    ).toBe(true);
    expect(element.innerHTML).toBe("<ul><li>a<ul><li>b</li></ul></li></ul>");

    expect(history.undo(element)).toBe(true);
    expect(element.innerHTML).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(element.querySelectorAll("li")[1]).toBe(b);
    // Nothing left to undo: the next Ctrl+Z is the browser's.
    expect(history.undo(element)).toBe(false);
  });

  it("makes an undone edit again, and undoes it again", () => {
    const element: HTMLDivElement = mount("<ul><li>a</li><li>b</li></ul>");
    const history: MarkdownEditorHistory = new MarkdownEditorHistory();
    history.record(element, () => {
      return indentSecondItem(element);
    });

    history.undo(element);
    expect(history.redo(element)).toBe(true);
    expect(element.innerHTML).toBe("<ul><li>a<ul><li>b</li></ul></li></ul>");
    expect(history.redo(element)).toBe(false);
    expect(history.undo(element)).toBe(true);
    expect(element.innerHTML).toBe("<ul><li>a</li><li>b</li></ul>");
  });

  it("takes back several edits, newest first", () => {
    const element: HTMLDivElement = mount("<p>one</p>");
    const history: MarkdownEditorHistory = new MarkdownEditorHistory();
    history.record(element, () => {
      element.appendChild(document.createElement("hr"));
      return true;
    });
    history.record(element, () => {
      (element.firstChild?.firstChild as Text).data = "two";
      return true;
    });

    history.undo(element);
    expect(element.innerHTML).toBe("<p>one</p><hr>");
    history.undo(element);
    expect(element.innerHTML).toBe("<p>one</p>");
  });

  it("puts back changed text and attributes", () => {
    const element: HTMLDivElement = mount('<p class="a">hello</p>');
    const history: MarkdownEditorHistory = new MarkdownEditorHistory();
    history.record(element, () => {
      const paragraph: HTMLElement = element.firstChild as HTMLElement;
      (paragraph.firstChild as Text).data = "bye";
      paragraph.className = "b";
      paragraph.setAttribute("title", "new");
      return true;
    });

    history.undo(element);

    expect(element.innerHTML).toBe('<p class="a">hello</p>');
  });

  it("records nothing for an edit that changed nothing", () => {
    const element: HTMLDivElement = mount("<ul><li>a</li></ul>");
    const history: MarkdownEditorHistory = new MarkdownEditorHistory();

    expect(
      history.record(element, () => {
        return false;
      }),
    ).toBe(false);
    expect(history.undo(element)).toBe(false);
  });

  /*
   * Typing after the edit is newer history in the browser's own stack: while
   * it is there, undo is left to the browser. Once the browser's undo has
   * taken it back, the editor is as the edit left it, and the next undo takes
   * the edit back -- dropped at the first keystroke, it never was, and the
   * browser's next entry, older typing, went instead.
   */
  it("waits for the browser to take newer edits back, then takes its edit back", () => {
    const element: HTMLDivElement = mount("<ul><li>a</li><li>b</li></ul>");
    const history: MarkdownEditorHistory = new MarkdownEditorHistory();
    history.record(element, () => {
      return indentSecondItem(element);
    });
    const text: Text = element.querySelectorAll("li")[1]?.firstChild as Text;

    text.data = "bx";
    expect(history.undo(element)).toBe(false);
    expect(element.innerHTML).toBe("<ul><li>a<ul><li>bx</li></ul></li></ul>");

    // What the browser's undo of the typing does.
    text.data = "b";
    expect(history.undo(element)).toBe(true);
    expect(element.innerHTML).toBe("<ul><li>a</li><li>b</li></ul>");
  });

  /*
   * A new edit of the browser's own drops what could be redone, as it drops
   * the browser's redo -- but not what can be undone.
   */
  it("forgets only what could be redone when the redo is cleared", () => {
    const element: HTMLDivElement = mount("<p>x</p>");
    const history: MarkdownEditorHistory = new MarkdownEditorHistory();
    history.record(element, () => {
      element.appendChild(document.createElement("hr"));
      return true;
    });
    history.record(element, () => {
      element.appendChild(document.createElement("br"));
      return true;
    });
    history.undo(element);

    history.clearRedo();

    expect(history.redo(element)).toBe(false);
    expect(history.undo(element)).toBe(true);
    expect(element.innerHTML).toBe("<p>x</p>");
  });

  it("leaves the editor as it is when its nodes are no longer the recorded ones", () => {
    const element: HTMLDivElement = mount("<ul><li>a</li><li>b</li></ul>");
    const history: MarkdownEditorHistory = new MarkdownEditorHistory();
    history.record(element, () => {
      return indentSecondItem(element);
    });
    // The same HTML, made of new nodes.
    const before: string = element.innerHTML;
    element.innerHTML = `${before}`;

    expect(history.undo(element)).toBe(false);
    expect(element.innerHTML).toBe(before);
  });

  it("puts the selection back where it was before the edit", () => {
    const element: HTMLDivElement = mount("<ul><li>a</li><li>bravo</li></ul>");
    const history: MarkdownEditorHistory = new MarkdownEditorHistory();
    const text: Text = element.querySelectorAll("li")[1]?.firstChild as Text;
    caretIn(text, 3);
    history.record(element, () => {
      indentSecondItem(element);
      caretIn(element.firstChild as Node, 0);
      return true;
    });

    history.undo(element);

    const selection: Selection = window.getSelection() as Selection;
    expect(selection.anchorNode).toBe(text);
    expect(selection.anchorOffset).toBe(3);
  });

  it("drops what could be redone once a new edit is made", () => {
    const element: HTMLDivElement = mount("<p>x</p>");
    const history: MarkdownEditorHistory = new MarkdownEditorHistory();
    history.record(element, () => {
      element.appendChild(document.createElement("hr"));
      return true;
    });
    history.undo(element);

    history.record(element, () => {
      element.appendChild(document.createElement("br"));
      return true;
    });

    expect(history.redo(element)).toBe(false);
  });

  it("forgets everything when cleared", () => {
    const element: HTMLDivElement = mount("<ul><li>a</li><li>b</li></ul>");
    const history: MarkdownEditorHistory = new MarkdownEditorHistory();
    history.record(element, () => {
      return indentSecondItem(element);
    });

    history.clear();

    expect(history.undo(element)).toBe(false);
  });
});
