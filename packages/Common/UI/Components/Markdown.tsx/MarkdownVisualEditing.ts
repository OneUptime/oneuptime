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
 * to that item. A list inserted into a list item is the exception: its items
 * join the item's list (insertListItemsAtCaret).
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

// Elements that show something with nothing inside them.
const SHOWN_EMPTY_TAGS: Set<string> = new Set<string>([
  "br",
  "img",
  "input",
  "hr",
  "video",
  "audio",
  "iframe",
]);

/*
 * Tidies one edge of a split: from `edge`, the node next to the split,
 * forward into what follows it or back into what precedes it, up to the
 * first text a browser shows -- within `container`, the line or item that
 * was split.
 *
 * The space the caret sat next to ends up at the edge of a line once the
 * line is split there. A browser does not show a space at a line's edge,
 * but the serializer would still write it -- "Run this \n\n```" -- so it
 * goes. A non-breaking space is shown, and stays.
 *
 * And text nodes and inline elements left with nothing in them go. With the
 * caret at the very end of a bold word, a link or inline code, the split
 * copies that element into the part after the caret with nothing in it; at
 * the very start of one, it leaves the element where it was, emptied; and a
 * selection pasted over can leave one emptied too. None of them shows, but
 * the serializer wrote them: "**** then check", "`` now", and an empty link
 * as its address, a second link the note never had.
 *
 * This runs once both parts are back in the editor. The part after the
 * caret can hold nodes the split moved out whole, and a change made to them
 * while they were out of the editor is one an undo cannot check the editor
 * against (MarkdownEditorHistory): with the caret between a bold word and
 * the space after it, Ctrl+Z refused to take the insert back.
 */
const tidySplitEdge: (
  edge: Node | null,
  container: Node,
  forward: boolean,
) => void = (edge: Node | null, container: Node, forward: boolean): void => {
  const spaces: RegExp = forward ? RE_LEADING_SPACES : RE_TRAILING_SPACES;
  let node: Node | null = edge;
  while (node && node !== container && container.contains(node)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text: Text = node as Text;
      const trimmed: string = text.data.replace(spaces, "");
      if (trimmed !== text.data) {
        text.data = trimmed;
      }
      if (trimmed !== "") {
        return;
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (isBlock(node) || SHOWN_EMPTY_TAGS.has(tagOf(node))) {
        return;
      }
      const inner: ChildNode | null = forward
        ? node.firstChild
        : node.lastChild;
      if (inner) {
        node = inner;
        continue;
      }
    } else if (node.nodeType !== Node.COMMENT_NODE) {
      return;
    }
    /*
     * `node` shows nothing. It goes -- a comment is only stepped over -- and
     * so does each inline element that leaves with nothing in it, on the
     * way back out to the next node along.
     */
    let next: Node | null = forward ? node.nextSibling : node.previousSibling;
    let parent: Node | null = node.parentNode;
    if (node.nodeType !== Node.COMMENT_NODE) {
      parent?.removeChild(node);
    }
    while (!next && parent && parent !== container) {
      next = forward ? parent.nextSibling : parent.previousSibling;
      const grandparent: Node | null = parent.parentNode;
      if (parent.childNodes.length === 0) {
        grandparent?.removeChild(parent);
      }
      parent = grandparent;
    }
    node = next;
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
  let before: Node | null = line.nextSibling;
  if (!holdsNothing(rest)) {
    /*
     * Into the editor first, then filled: filled while still out of it, the
     * half took nodes the undo record never saw go in, and a redo after
     * Ctrl+Z was refused.
     */
    const half: Node = line.cloneNode(false);
    parent.insertBefore(half, before);
    half.appendChild(rest);
    tidySplitEdge(half.firstChild, half, true);
    before = half;
  }
  tidySplitEdge(line.lastChild, line, false);
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
  let before: Node | null = top.nextSibling;
  if (!holdsNothing(rest)) {
    const secondPart: Array<Node> = Array.from(rest.childNodes);
    holder.insertBefore(rest, before);
    tidySplitEdge(secondPart[0] || null, holder, true);
    before =
      secondPart.find((node: Node): boolean => {
        return node.parentNode === holder;
      }) || before;
  }
  tidySplitEdge(top, holder, false);
  if (top.parentNode === holder && holdsNothing(top) && !isBlock(top)) {
    holder.removeChild(top);
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
 * The items of `fragment` when it is lists and nothing else that shows --
 * a pasted list, bullets pasted as text, the Task List button's task --
 * and null for anything else.
 */
const listItemsOf: (fragment: DocumentFragment) => Array<Element> | null = (
  fragment: DocumentFragment,
): Array<Element> | null => {
  const items: Array<Element> = [];
  for (const child of Array.from(fragment.childNodes)) {
    const tag: string = tagOf(child);
    if (tag === "ul" || tag === "ol") {
      for (const item of Array.from((child as Element).children)) {
        if (tagOf(item) !== "li") {
          return null;
        }
        items.push(item);
      }
    } else if (!holdsNothing(child)) {
      return null;
    }
  }
  return items.length > 0 ? items : null;
};

/*
 * The list item whose list the items of a list inserted at the caret join:
 * the item the caret is in -- unless it is in a code block, a quote or a
 * table cell inside that item, which a list inserted there stays in.
 */
const listItemAtCaret: (
  editable: HTMLElement,
  range: Range,
) => HTMLElement | null = (
  editable: HTMLElement,
  range: Range,
): HTMLElement | null => {
  /*
   * Once the Bullet or Numbered List button has made a list in the empty
   * editor, Chromium leaves the selection on the editor itself, just before
   * the list -- though it shows the caret in the list's empty first item,
   * and types into it.
   */
  if (range.startContainer === editable) {
    const next: ChildNode | undefined = editable.childNodes[range.startOffset];
    const tag: string = tagOf(next);
    const first: Element | null =
      tag === "ul" || tag === "ol" ? (next as Element).firstElementChild : null;
    return first && tagOf(first) === "li" && holdsNothing(first)
      ? (first as HTMLElement)
      : null;
  }
  let current: Node | null = range.startContainer;
  while (current && current !== editable) {
    const tag: string = tagOf(current);
    if (tag === "li") {
      return current as HTMLElement;
    }
    if (tag === "pre" || tag === "blockquote" || tag === "td" || tag === "th") {
      return null;
    }
    current = current.parentNode;
  }
  return null;
};

/*
 * Puts `items`, the items of a list inserted at the caret, into the list of
 * `item`, the list item the caret is in: after what `item` holds before the
 * caret, and before a new item holding what came after it. Kept in the item
 * instead -- as a code block inserted into one is -- they were a list nested
 * in it: a list pasted into the empty item Enter leaves showed two bullets,
 * "- - a", which is the double bullet of issue #4114, and a task added with
 * the Task List button at the end of a task was a sub-task.
 *
 * A part left with nothing in it goes, so the empty item Enter or a list
 * button makes is replaced by the items. When what followed the caret is
 * the item's nested list, or another block of its own, that goes under the
 * last of the items, so the text keeps its order. Returns the caret: at the
 * end of what the last item holds.
 */
const insertListItemsAtCaret: (
  item: HTMLElement,
  range: Range,
  items: Array<Element>,
) => Range = (
  item: HTMLElement,
  range: Range,
  items: Array<Element>,
): Range => {
  const list: Node = item.parentNode as Node;
  const tail: Range = item.ownerDocument.createRange();
  if (item.contains(range.startContainer)) {
    tail.setStart(range.startContainer, range.startOffset);
  } else {
    tail.setStart(item, 0);
  }
  tail.setEnd(item, item.childNodes.length);
  const rest: DocumentFragment = tail.extractContents();
  const before: Node | null = item.nextSibling;
  for (const pasted of items) {
    list.insertBefore(pasted, before);
  }
  const last: Element = items[items.length - 1] as Element;
  const caret: Range = caretAtEndOf(last);
  if (!holdsNothing(rest)) {
    const lead: ChildNode | undefined = Array.from(rest.childNodes).find(
      (node: ChildNode): boolean => {
        return !holdsNothing(node);
      },
    );
    /*
     * As when a line is split, into the editor first and then filled and
     * tidied (MarkdownEditorHistory): the empty copies of formatting the
     * caret was at the edge of go.
     */
    if (lead && isBlock(lead)) {
      const first: ChildNode | null = rest.firstChild;
      last.appendChild(rest);
      tidySplitEdge(first, last, true);
    } else {
      const half: Node = item.cloneNode(false);
      list.insertBefore(half, before);
      half.appendChild(rest);
      tidySplitEdge(half.firstChild, half, true);
    }
  }
  tidySplitEdge(item.lastChild, item, false);
  if (holdsNothing(item)) {
    item.remove();
  }
  return caret;
};

/*
 * Inserts `fragment` -- one or more blocks -- at the caret, splitting the
 * line the caret is in rather than putting blocks inside it; the items of a
 * list inserted in a list item join that item's list. Returns where the
 * caret goes then -- at the end of what was inserted, so typing carries on
 * from it, as it does after a paste the browser makes -- or null when there
 * was nothing to insert.
 */
export const insertBlocksAtCaret: (
  editable: HTMLElement,
  range: Range,
  fragment: DocumentFragment,
) => Range | null = (
  editable: HTMLElement,
  range: Range,
  fragment: DocumentFragment,
): Range | null => {
  const last: Node | null = fragment.lastChild;
  if (!last) {
    return null;
  }
  const items: Array<Element> | null = listItemsOf(fragment);
  const item: HTMLElement | null = items
    ? listItemAtCaret(editable, range)
    : null;
  if (items && item) {
    return insertListItemsAtCaret(item, range, items);
  }
  const point: InsertionPoint = blockInsertionPoint(editable, range);
  point.parent.insertBefore(fragment, point.before);
  return caretAtEndOf(last);
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
 * What a list item joined to another held below its own text -- its nested
 * items, a code block -- goes to the item it joins, in the same place in the
 * text. For an item nested in that one, the place is right after the join,
 * ahead of what is left of the nested list the item was in, all of which
 * came after it; its own nested items take its place in that list. Added at
 * the end of the item instead, "deep" under "beta" came out after "gamma"
 * when "al|pha".."be|ta" was pasted over in "alpha > beta > deep, gamma".
 */
const moveBelowJoin: (startLine: Node, endLine: Node) => void = (
  startLine: Node,
  endLine: Node,
): void => {
  let place: Node | null = null;
  if (startLine.contains(endLine)) {
    place = endLine;
    while (place.parentNode && place.parentNode !== startLine) {
      place = place.parentNode;
    }
  }
  while (endLine.firstChild) {
    const child: ChildNode = endLine.firstChild;
    if (
      place &&
      endLine.parentNode === place &&
      tagOf(child) === tagOf(place)
    ) {
      while (child.firstChild) {
        place.insertBefore(child.firstChild, endLine);
      }
      endLine.removeChild(child);
    } else {
      startLine.insertBefore(child, place);
    }
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
    moveBelowJoin(startLine, endLine);
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
