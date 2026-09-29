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

/*
 * ---------------------------------------------------------------------------
 * Deleting a selection before an insert
 * ---------------------------------------------------------------------------
 */

// Elements that hold a line of text: where what is typed or pasted can go.
const LINE_TAGS: Set<string> = new Set<string>([
  ...Array.from(SPLITTABLE_LINE_TAGS),
  ...Array.from(BLOCK_HOLDER_TAGS),
  "pre",
  "dt",
  "dd",
]);

// Elements whose children are only rows, cells or items -- never text.
const STRUCTURE_ONLY_TAGS: Set<string> = new Set<string>([
  "ul",
  "ol",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
]);

const nodeLength: (node: Node) => number = (node: Node): number => {
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.COMMENT_NODE) {
    return (node as CharacterData).length;
  }
  return node.childNodes.length;
};

/*
 * The line `node` is in: its nearest paragraph, heading, <div> line, list
 * item, table cell, code block or quote -- or the editor itself.
 */
const lineOf: (editable: HTMLElement, node: Node) => Node = (
  editable: HTMLElement,
  node: Node,
): Node => {
  let current: Node | null = node;
  while (current && current !== editable) {
    if (LINE_TAGS.has(tagOf(current))) {
      return current;
    }
    current = current.parentNode;
  }
  return editable;
};

/*
 * Whether the range takes any of `line` -- not merely reaches its start, as
 * a triple click or Shift+Down that stops at the next line does.
 */
const selectsIntoLine: (range: Range, line: Node) => boolean = (
  range: Range,
  line: Node,
): boolean => {
  const head: Range = (line.ownerDocument as Document).createRange();
  head.setStart(line, 0);
  head.setEnd(range.endContainer, range.endOffset);
  return !holdsNothing(head.cloneContents());
};

/*
 * Removes `line` when it is left with nothing in it, and the lists its
 * removal leaves without an item.
 */
const removeEmptiedLine: (line: Node, editable: HTMLElement) => void = (
  line: Node,
  editable: HTMLElement,
): void => {
  if (!holdsNothing(line)) {
    return;
  }
  let parent: Node | null = line.parentNode;
  line.parentNode?.removeChild(line);
  while (
    parent &&
    parent !== editable &&
    STRUCTURE_ONLY_TAGS.has(tagOf(parent)) &&
    (parent as Element).children.length === 0
  ) {
    const empty: Node = parent;
    parent = parent.parentNode;
    parent?.removeChild(empty);
  }
};

/*
 * What is left of the line a selection ended in joins the line it started
 * in, at the caret -- as when the selection is typed over. Only its own text
 * moves: a list nested in a list item goes along to the item it joins, and
 * the line, left empty, goes.
 */
const joinLineAtCaret: (
  range: Range,
  startLine: Node,
  endLine: Node,
  editable: HTMLElement,
) => void = (
  range: Range,
  startLine: Node,
  endLine: Node,
  editable: HTMLElement,
): void => {
  const text: DocumentFragment = (
    endLine.ownerDocument as Document
  ).createDocumentFragment();
  while (endLine.firstChild && !isBlock(endLine.firstChild)) {
    text.appendChild(endLine.firstChild);
  }
  if (text.firstChild) {
    range.insertNode(text);
    range.collapse(true);
  }
  if (tagOf(startLine) === "li" && tagOf(endLine) === "li") {
    while (endLine.firstChild) {
      startLine.appendChild(endLine.firstChild);
    }
  }
  removeEmptiedLine(endLine, editable);
};

/*
 * A caret straight inside a list or a table, between its items or rows,
 * moved into the item or cell next to it -- the serializer reads only a
 * list's items and a table's cells, so nothing inserted between them would
 * be saved.
 */
const moveCaretIntoLine: (range: Range) => void = (range: Range): void => {
  let container: Node = range.startContainer;
  let offset: number = range.startOffset;
  while (STRUCTURE_ONLY_TAGS.has(tagOf(container))) {
    const after: ChildNode | undefined = container.childNodes[offset];
    const before: ChildNode | undefined = container.childNodes[offset - 1];
    if (after && after.nodeType === Node.ELEMENT_NODE) {
      container = after;
      offset = 0;
    } else if (before && before.nodeType === Node.ELEMENT_NODE) {
      container = before;
      offset = nodeLength(before);
    } else {
      return;
    }
  }
  range.setStart(container, offset);
  range.collapse(true);
};

/*
 * Deletes what the range selects, the way typing over it does: when the
 * selection runs from one line into another -- two list items, two
 * paragraphs -- what is left of the second line joins the first, and the
 * caret ends up at the join, inside a line. Range.deleteContents on its own
 * leaves both lines and puts the caret between them -- straight inside the
 * <ul> when they were list items, where the serializer, which reads only a
 * list's items, never saw what was pasted next: a link pasted over part of
 * two items showed in the editor and was lost from the saved note. A
 * selection that stops at the very start of a line -- a triple click,
 * Shift+Down -- takes none of that line, and it stays as it is.
 */
export const deleteSelectionForInsert: (
  editable: HTMLElement,
  range: Range,
) => void = (editable: HTMLElement, range: Range): void => {
  if (range.collapsed) {
    return;
  }
  const startNode: Node = range.startContainer;
  const startOffset: number = range.startOffset;
  const startLine: Node = lineOf(editable, startNode);
  const endLine: Node = lineOf(editable, range.endContainer);
  const joins: boolean =
    startLine !== endLine &&
    startLine !== editable &&
    endLine !== editable &&
    !endLine.contains(startLine) &&
    selectsIntoLine(range, endLine);
  range.deleteContents();
  /*
   * The start of a selection is never removed by the delete (only cut short),
   * so the caret goes back there: inside the line the selection started in.
   */
  range.setStart(startNode, Math.min(startOffset, nodeLength(startNode)));
  range.collapse(true);
  if (joins && endLine.isConnected && startLine.isConnected) {
    joinLineAtCaret(range, startLine, endLine, editable);
  }
  moveCaretIntoLine(range);
};
