/*
 * Inserting into the visual editor's DOM by hand, where the browser's own
 * document.execCommand("insertHTML") gets it wrong.
 *
 * With the caret in the middle or at the end of a line, Chromium's and
 * Safari's insertHTML fold the first block of what is inserted into that
 * line: a <pre> becomes a monospace <span> inside the paragraph, and the
 * first line of a quote leaves the quote. The serializer reads a <span> as
 * plain text, so the Code Block button saved "hellocode block" and a fenced
 * block pasted after "Run:" saved "Run:npm install". Here the line is split
 * at the caret instead, and the blocks go in between its two halves -- what
 * Firefox's insertHTML does, and what the markdown means.
 *
 * Only onto an empty line -- or into the empty editor -- does insertHTML put
 * blocks where they belong in every browser, and there the editor still
 * uses it, since it puts the insert on the browser's undo stack.
 */

// A line of text, which a block inserted into its middle splits in two.
const SPLITTABLE_LINE_TAGS: Set<string> = new Set<string>([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

/*
 * Elements that hold blocks as well as text of their own: a block inserted
 * into one stays inside it, as a code block pasted into a list item belongs
 * to that item.
 */
const BLOCK_HOLDER_TAGS: Set<string> = new Set<string>([
  "li",
  "blockquote",
  "td",
  "th",
]);

// Elements that start a new line of their own, rather than run on in one.
const BLOCK_TAGS: Set<string> = new Set<string>([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);

// What makes a line hold something even with no text in it.
const CONTENT_ELEMENT_TAGS: Array<string> = [
  "img",
  "input",
  "hr",
  "table",
  "pre",
  "ul",
  "ol",
  "blockquote",
  "video",
  "audio",
  "iframe",
];
const CONTENT_ELEMENT_SELECTOR: string = CONTENT_ELEMENT_TAGS.join(", ");

// Whitespace a browser does not show; a non-breaking space is shown.
const RE_SHOWN_TEXT: RegExp = /[^ \t\n\r\f\u200b\ufeff]/;

const tagOf: (node: Node | null | undefined) => string = (
  node: Node | null | undefined,
): string => {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }
  return (node as Element).localName.toLowerCase();
};

const isBlock: (node: Node | null | undefined) => boolean = (
  node: Node | null | undefined,
): boolean => {
  return BLOCK_TAGS.has(tagOf(node));
};

/*
 * Whether `node` -- an element, a text node or a fragment -- shows nothing:
 * no text but whitespace, and no image, rule or other block. A lone <br>
 * (the placeholder a browser keeps in an empty line) counts as nothing.
 */
const holdsNothing: (node: Node) => boolean = (node: Node): boolean => {
  if (RE_SHOWN_TEXT.test(node.textContent || "")) {
    return false;
  }
  if (CONTENT_ELEMENT_TAGS.includes(tagOf(node))) {
    return false;
  }
  if (
    node.nodeType === Node.ELEMENT_NODE ||
    node.nodeType === Node.DOCUMENT_FRAGMENT_NODE
  ) {
    return (
      (node as Element | DocumentFragment).querySelector(
        CONTENT_ELEMENT_SELECTOR,
      ) === null
    );
  }
  return true;
};

/*
 * Whether the caret sits on an empty line of its own: in the empty editor,
 * or in a blank paragraph straight inside it -- "", or just the <br> a
 * browser keeps there. There insertHTML puts blocks where they belong in
 * every browser; anywhere else it may fold them into the line.
 */
export const isCaretOnEmptyLine: (
  editable: HTMLElement,
  range: Range,
) => boolean = (editable: HTMLElement, range: Range): boolean => {
  if (!range.collapsed || !editable.contains(range.startContainer)) {
    return false;
  }
  if (range.startContainer === editable) {
    return holdsNothing(editable) && (editable.textContent || "") === "";
  }
  let line: Node = range.startContainer;
  while (line.parentNode && line.parentNode !== editable) {
    line = line.parentNode;
  }
  if (!SPLITTABLE_LINE_TAGS.has(tagOf(line))) {
    return false;
  }
  /*
   * Strictly empty: Chromium folds a block into a line holding even a
   * single space, which it keeps as a non-breaking one.
   */
  return (line.textContent || "") === "" && holdsNothing(line);
};

interface InsertionPoint {
  parent: Node;
  before: Node | null;
}

const RE_LEADING_SPACES: RegExp = /^[ \t\n\r\f]+/;
const RE_TRAILING_SPACES: RegExp = /[ \t\n\r\f]+$/;

// The first (or last) text node at or inside `root`, in document order.
const edgeTextNode: (root: Node, last: boolean) => Text | null = (
  root: Node,
  last: boolean,
): Text | null => {
  if (root.nodeType === Node.TEXT_NODE) {
    return root as Text;
  }
  const walker: TreeWalker = (
    root.ownerDocument || (root as Document)
  ).createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let found: Text | null = null;
  let node: Node | null = walker.nextNode();
  while (node) {
    found = node as Text;
    if (!last) {
      break;
    }
    node = walker.nextNode();
  }
  return found;
};

/*
 * The space the caret sat next to ends up at the edge of a line once the
 * line is split there. A browser does not show a space at a line's edge,
 * but the serializer would still write it -- "Run this \n\n```" -- so it
 * goes. A non-breaking space is shown, and stays.
 */
const trimSpacesAtSplit: (head: Node | null, tail: Node | null) => void = (
  head: Node | null,
  tail: Node | null,
): void => {
  const headText: Text | null = head ? edgeTextNode(head, true) : null;
  if (headText) {
    headText.data = headText.data.replace(RE_TRAILING_SPACES, "");
  }
  const tailText: Text | null = tail ? edgeTextNode(tail, false) : null;
  if (tailText) {
    tailText.data = tailText.data.replace(RE_LEADING_SPACES, "");
  }
};

/*
 * Splits the line the caret is in -- a paragraph, a heading, the <div> a
 * browser writes for a new line -- at the caret, and returns the spot
 * between its two halves. Either half that is left with nothing in it is
 * removed, so a block inserted at the start or end of a line does not leave
 * an empty line behind.
 */
const splitLineAtCaret: (line: HTMLElement, range: Range) => InsertionPoint = (
  line: HTMLElement,
  range: Range,
): InsertionPoint => {
  const parent: Node = line.parentNode as Node;
  const tail: Range = line.ownerDocument.createRange();
  tail.setStart(range.startContainer, range.startOffset);
  tail.setEnd(line, line.childNodes.length);
  const rest: DocumentFragment = tail.extractContents();
  trimSpacesAtSplit(line, rest);
  let before: Node | null = line.nextSibling;
  if (!holdsNothing(rest)) {
    const secondHalf: Node = line.cloneNode(false);
    secondHalf.appendChild(rest);
    parent.insertBefore(secondHalf, before);
    before = secondHalf;
  }
  if (holdsNothing(line)) {
    line.remove();
  }
  return { parent, before };
};

/*
 * The same for text that sits straight inside a list item, a quote, a table
 * cell or the editor itself, with no paragraph around it: the run of inline
 * content the caret is in is split at the caret, and the blocks go between
 * the two parts -- still inside that item, quote or cell.
 */
const splitInlineRunAtCaret: (holder: Node, range: Range) => InsertionPoint = (
  holder: Node,
  range: Range,
): InsertionPoint => {
  if (range.startContainer === holder) {
    return {
      parent: holder,
      before: holder.childNodes[range.startOffset] || null,
    };
  }
  let top: Node = range.startContainer;
  while (top.parentNode && top.parentNode !== holder) {
    top = top.parentNode;
  }
  let runEnd: Node = top;
  while (runEnd.nextSibling && !isBlock(runEnd.nextSibling)) {
    runEnd = runEnd.nextSibling;
  }
  const tail: Range = (holder.ownerDocument as Document).createRange();
  tail.setStart(range.startContainer, range.startOffset);
  tail.setEndAfter(runEnd);
  const rest: DocumentFragment = tail.extractContents();
  trimSpacesAtSplit(top, rest);
  let before: Node | null = top.nextSibling;
  if (!holdsNothing(rest)) {
    const first: Node | null = rest.firstChild;
    holder.insertBefore(rest, before);
    before = first;
  }
  if (holdsNothing(top) && !isBlock(top)) {
    top.parentNode?.removeChild(top);
  }
  return { parent: holder, before };
};

/*
 * Where blocks inserted at the caret go: after the code block the caret is
 * in (a code block holds only its text), between the two halves of the line
 * it is in, or between the two parts of the text it is in.
 */
const blockInsertionPoint: (
  editable: HTMLElement,
  range: Range,
) => InsertionPoint = (editable: HTMLElement, range: Range): InsertionPoint => {
  let current: Node | null = range.startContainer;
  while (current && current !== editable) {
    const tag: string = tagOf(current);
    if (tag === "pre" && current.parentNode) {
      return { parent: current.parentNode, before: current.nextSibling };
    }
    if (SPLITTABLE_LINE_TAGS.has(tag) && current.parentNode) {
      return splitLineAtCaret(current as HTMLElement, range);
    }
    if (BLOCK_HOLDER_TAGS.has(tag)) {
      return splitInlineRunAtCaret(current, range);
    }
    current = current.parentNode;
  }
  return splitInlineRunAtCaret(editable, range);
};

/*
 * Inserts `fragment` -- one or more blocks -- at the caret, splitting the
 * line the caret is in rather than putting blocks inside it. Returns the
 * last node inserted, or null when there was nothing to insert.
 */
export const insertBlocksAtCaret: (
  editable: HTMLElement,
  range: Range,
  fragment: DocumentFragment,
) => Node | null = (
  editable: HTMLElement,
  range: Range,
  fragment: DocumentFragment,
): Node | null => {
  const last: Node | null = fragment.lastChild;
  if (!last) {
    return null;
  }
  const point: InsertionPoint = blockInsertionPoint(editable, range);
  point.parent.insertBefore(fragment, point.before);
  return last;
};

/*
 * A caret at the end of what `node` holds -- after its last character, and
 * before the <br> a browser keeps in an empty line -- so that typing carries
 * on from what was inserted, as it does after a paste the browser makes.
 */
export const caretAtEndOf: (node: Node) => Range = (node: Node): Range => {
  const caret: Range = (node.ownerDocument as Document).createRange();
  let target: Node = node;
  while (target.lastChild && target.lastChild.nodeType !== Node.COMMENT_NODE) {
    const last: ChildNode = target.lastChild;
    if (last.nodeType === Node.TEXT_NODE) {
      caret.setStart(last, (last as Text).length);
      caret.collapse(true);
      return caret;
    }
    const tag: string = tagOf(last);
    if (tag === "br" || tag === "img" || tag === "input" || tag === "hr") {
      caret.setStart(
        target,
        tag === "br" ? target.childNodes.length - 1 : target.childNodes.length,
      );
      caret.collapse(true);
      return caret;
    }
    target = last;
  }
  caret.setStart(target, target.childNodes.length);
  caret.collapse(true);
  return caret;
};
