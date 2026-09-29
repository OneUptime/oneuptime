/*
 * Indenting and outdenting list items, in both of the MarkdownEditor's modes,
 * and the list buttons' clean-up of bullet characters typed as text.
 *
 * Visual mode works on the contenteditable DOM directly: the selected items
 * are moved under the item before them (indent) or out beside their parent
 * (outdent). document.execCommand("indent") is no substitute -- Chromium,
 * Firefox and WebKit all answer it with a <ul> directly inside a <ul>, which
 * is not a list item at all, and the serializer drops that item on save.
 *
 * Markdown mode works on the source lines. A nested item has to start at its
 * parent's content column -- two columns in under "- ", three under "1. ",
 * four under "10. " -- or CommonMark (and the email renderer, marked) reads
 * it as a sibling rather than a child, so indenting moves a line to the
 * content column of the item above it rather than by a fixed width.
 *
 * Both return whether they changed anything. The editor only claims the Tab
 * key when they did, so Tab still moves focus out of the editor everywhere
 * else -- a list's first item, a top-level item on Shift+Tab, a paragraph --
 * and a keyboard user is never trapped inside the field.
 */

/*
 * Characters other apps put in front of a list item as plain text: Word and
 * Outlook ("•", and "·" / U+F0B7 from the Symbol font), Slack ("•", "◦",
 * "▪"), Google Docs and PowerPoint (the squares, diamonds and arrows), and
 * the dashes many people type by hand. Word's second and third levels are
 * "o" and "§" (U+F0A7 from Wingdings), recognised only before a tab so that
 * a sentence starting with the word "o" is left alone.
 */
export const TEXT_BULLET_GLYPHS: string = "•◦▪▫‣⁃∙·●○■□◆◇➢➤►▶–—\uF0B7\uF0A7";

// Word's level-two and level-three bullets, which only count before a tab.
export const TAB_ONLY_BULLET_GLYPHS: string = "o§";

/*
 * A marker at the start of a list item's own text that the list itself now
 * draws: a bullet character followed by a space or tab (or on its own),
 * Word's "o" / "§" before a tab, a "- " left behind as text, or a number the
 * way Word and Outlook write one into plain text -- "1." followed by a tab
 * or a run of spaces. A number followed by a single space is left alone:
 * "2021. was a good year" is a sentence. So is a line whose text merely
 * starts with one of the characters -- the dash in "–5°C overnight low" is a
 * minus sign, and "—Mark Twain" an attribution -- which the paste's own
 * bullet rule (MarkdownPaste) leaves alone too.
 * \u00a0 is included because Word and browsers write the space after a
 * marker as a non-breaking one.
 */
const RE_LEADING_TEXT_MARKER: RegExp = new RegExp(
  `^[ \\t\\u00a0]*(?:[${TEXT_BULLET_GLYPHS}](?:[ \\t\\u00a0]+|$)|[${TAB_ONLY_BULLET_GLYPHS}]\\t[ \\t\\u00a0]*|[-*+][ \\t\\u00a0]+|\\d{1,9}[.)](?:\\t|[ \\u00a0]{2,})[ \\t\\u00a0]*)`,
);

// A tab advances to the next multiple of four columns, as in CommonMark.
const TAB_WIDTH: number = 4;

/*
 * ---------------------------------------------------------------------------
 * Visual mode: the contenteditable DOM
 * ---------------------------------------------------------------------------
 */

const tagOf: (node: Node | null | undefined) => string = (
  node: Node | null | undefined,
): string => {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }
  return (node as Element).localName.toLowerCase();
};

const isList: (node: Node | null | undefined) => boolean = (
  node: Node | null | undefined,
): boolean => {
  const tag: string = tagOf(node);
  return tag === "ul" || tag === "ol";
};

const isListItem: (node: Node | null | undefined) => boolean = (
  node: Node | null | undefined,
): boolean => {
  return tagOf(node) === "li";
};

interface SelectionInRoot {
  selection: Selection;
  range: Range;
}

const getSelectionInRoot: (root: HTMLElement) => SelectionInRoot | null = (
  root: HTMLElement,
): SelectionInRoot | null => {
  const selection: Selection | null = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const range: Range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) {
    return null;
  }
  return { selection, range };
};

/*
 * The nearest <li> at or above `node`, without leaving `root`. None from
 * inside a code block, even one in a list item: Tab there is not a list
 * edit, as the source mode skips the lines of a fenced block.
 */
const closestListItem: (
  node: Node | null,
  root: HTMLElement,
) => HTMLElement | null = (
  node: Node | null,
  root: HTMLElement,
): HTMLElement | null => {
  let current: Node | null = node;
  while (current && current !== root) {
    if (isListItem(current)) {
      return current as HTMLElement;
    }
    if (tagOf(current) === "pre") {
      return null;
    }
    current = current.parentNode;
  }
  return null;
};

/*
 * The <li> the selection starts in. A boundary that sits on a list itself,
 * or in the whitespace between two of its items, belongs to the item after
 * it.
 */
const listItemAtSelectionStart: (
  range: Range,
  root: HTMLElement,
) => HTMLElement | null = (
  range: Range,
  root: HTMLElement,
): HTMLElement | null => {
  let node: Node = range.startContainer;
  if (node.nodeType === Node.ELEMENT_NODE) {
    const child: ChildNode | undefined = node.childNodes[range.startOffset];
    if (child) {
      node = child;
    }
  }
  if (isList(node)) {
    const firstItem: Element | null = (node as Element).querySelector(
      ":scope > li",
    );
    if (firstItem) {
      node = firstItem;
    }
  } else if (!isListItem(node) && isList(node.parentNode)) {
    let next: Node | null = node.nextSibling;
    while (next && !isListItem(next)) {
      next = next.nextSibling;
    }
    if (next) {
      node = next;
    }
  }
  return closestListItem(node, root);
};

/*
 * Whether the range selects any of `item` -- not merely touches it. A
 * selection dragged down to the very start of the next item (which is what
 * a triple click leaves behind) does not take that item along, the same way
 * a textarea selection ending at column 0 does not take that line.
 */
const rangeSelectsInto: (range: Range, item: HTMLElement) => boolean = (
  range: Range,
  item: HTMLElement,
): boolean => {
  if (!range.intersectsNode(item)) {
    return false;
  }
  if (!item.contains(range.endContainer)) {
    return true;
  }
  const head: Range = item.ownerDocument.createRange();
  head.setStart(item, 0);
  head.setEnd(range.endContainer, range.endOffset);
  return head.toString().length > 0;
};

/*
 * The items an indent or outdent moves: the one the selection starts in,
 * plus the siblings after it that the selection reaches. Items at other
 * levels move along with these (as their children) rather than on their own.
 */
const selectedSiblingItems: (
  range: Range,
  root: HTMLElement,
) => Array<HTMLElement> = (
  range: Range,
  root: HTMLElement,
): Array<HTMLElement> => {
  const first: HTMLElement | null = listItemAtSelectionStart(range, root);
  if (!first || !isList(first.parentNode)) {
    return [];
  }
  const items: Array<HTMLElement> = [first];
  let sibling: Element | null = first.nextElementSibling;
  while (
    sibling &&
    isListItem(sibling) &&
    rangeSelectsInto(range, sibling as HTMLElement)
  ) {
    items.push(sibling as HTMLElement);
    sibling = sibling.nextElementSibling;
  }
  return items;
};

interface SavedSelection {
  anchorNode: Node;
  anchorOffset: number;
  focusNode: Node;
  focusOffset: number;
}

const saveSelection: (selection: Selection) => SavedSelection | null = (
  selection: Selection,
): SavedSelection | null => {
  if (!selection.anchorNode || !selection.focusNode) {
    return null;
  }
  return {
    anchorNode: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode,
    focusOffset: selection.focusOffset,
  };
};

const nodeLength: (node: Node) => number = (node: Node): number => {
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.COMMENT_NODE) {
    return (node as CharacterData).length;
  }
  return node.childNodes.length;
};

/*
 * Moving a node collapses any selection inside it to the spot it was moved
 * from, so the selection is put back by hand. The nodes it was anchored in
 * move rather than get recreated, so the same boundary points still name the
 * same characters.
 */
const restoreSelection: (
  selection: Selection,
  saved: SavedSelection | null,
  root: HTMLElement,
  fallback: HTMLElement,
) => void = (
  selection: Selection,
  saved: SavedSelection | null,
  root: HTMLElement,
  fallback: HTMLElement,
): void => {
  try {
    if (
      saved &&
      root.contains(saved.anchorNode) &&
      root.contains(saved.focusNode)
    ) {
      selection.setBaseAndExtent(
        saved.anchorNode,
        Math.min(saved.anchorOffset, nodeLength(saved.anchorNode)),
        saved.focusNode,
        Math.min(saved.focusOffset, nodeLength(saved.focusNode)),
      );
      return;
    }
    const caret: Range = root.ownerDocument.createRange();
    caret.setStart(fallback, 0);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
  } catch {
    // Leave the selection where the browser put it rather than fail the edit.
  }
};

// The list an item's children sit in, created (like `list`) when it has none.
const trailingSublist: (item: HTMLElement, like: HTMLElement) => HTMLElement = (
  item: HTMLElement,
  like: HTMLElement,
): HTMLElement => {
  const last: Element | null = item.lastElementChild;
  if (last && isList(last)) {
    return last as HTMLElement;
  }
  const sublist: HTMLElement = item.ownerDocument.createElement(tagOf(like));
  if (like.classList.contains("task-list")) {
    sublist.className = "task-list";
  }
  item.appendChild(sublist);
  return sublist;
};

/*
 * Indent: the selected items become the last children of the item before
 * them, joining its nested list when it has one (and taking that list's kind)
 * or starting a new one of their own list's kind. Their own nested items move
 * with them. The first item of a list has nothing to nest under, so it is left
 * alone and this returns false.
 */
export const sinkListItems: (root: HTMLElement) => boolean = (
  root: HTMLElement,
): boolean => {
  const context: SelectionInRoot | null = getSelectionInRoot(root);
  if (!context) {
    return false;
  }
  const items: Array<HTMLElement> = selectedSiblingItems(context.range, root);
  const first: HTMLElement | undefined = items[0];
  if (!first) {
    return false;
  }
  const previous: Element | null = first.previousElementSibling;
  if (!previous || !isListItem(previous)) {
    return false;
  }
  const list: HTMLElement = first.parentNode as HTMLElement;
  const saved: SavedSelection | null = saveSelection(context.selection);

  const target: HTMLElement = trailingSublist(previous as HTMLElement, list);
  for (const item of items) {
    target.appendChild(item);
  }

  restoreSelection(context.selection, saved, root, first);
  return true;
};

/*
 * Outdent: the selected items move out of their list to sit right after the
 * item that held it. The items that followed them in that list stay below
 * them, so they become the last moved item's children -- as in Google Docs
 * and Word, the text keeps its order -- and so does whatever that item held
 * after the list: a paragraph that goes on below the nested items, or a
 * nested list of the other kind. Left in place, those came out above the
 * moved items. The markdown-source outdent keeps the same order. A top-level
 * item has nowhere to go, so this returns false for it (and never lifts an
 * item out of `root` itself).
 */
export const liftListItems: (root: HTMLElement) => boolean = (
  root: HTMLElement,
): boolean => {
  const context: SelectionInRoot | null = getSelectionInRoot(root);
  if (!context) {
    return false;
  }
  const items: Array<HTMLElement> = selectedSiblingItems(context.range, root);
  const first: HTMLElement | undefined = items[0];
  const last: HTMLElement | undefined = items[items.length - 1];
  if (!first || !last) {
    return false;
  }
  const list: HTMLElement = first.parentNode as HTMLElement;
  const parentItem: Node | null = list.parentNode;
  const outerList: ParentNode | null = parentItem
    ? parentItem.parentNode
    : null;
  if (
    !parentItem ||
    !outerList ||
    !isListItem(parentItem) ||
    parentItem === root ||
    !root.contains(parentItem)
  ) {
    return false;
  }
  const saved: SavedSelection | null = saveSelection(context.selection);

  const trailing: Array<Element> = [];
  let next: Element | null = last.nextElementSibling;
  while (next) {
    trailing.push(next);
    next = next.nextElementSibling;
  }
  if (trailing.length > 0) {
    const sublist: HTMLElement = trailingSublist(last, list);
    for (const item of trailing) {
      sublist.appendChild(item);
    }
  }
  /*
   * After the items that followed, not before: a nested list of the other
   * kind moved in first would be taken for the last item's own sublist, and
   * the followers would go into it.
   */
  let after: ChildNode | null = list.nextSibling;
  while (after) {
    const following: ChildNode | null = after.nextSibling;
    last.appendChild(after);
    after = following;
  }

  let anchor: Node = parentItem;
  for (const item of items) {
    outerList.insertBefore(item, anchor.nextSibling);
    anchor = item;
  }
  if (list.children.length === 0) {
    list.remove();
  }

  restoreSelection(context.selection, saved, root, first);
  return true;
};

// The text nodes that make up an item's own text, in order -- not its sublists'.
const ownTextNodes: (item: HTMLElement) => Array<Text> = (
  item: HTMLElement,
): Array<Text> => {
  const texts: Array<Text> = [];
  const walk: (node: Node) => void = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        texts.push(child as Text);
      } else if (child.nodeType === Node.ELEMENT_NODE && !isList(child)) {
        walk(child);
      }
    }
  };
  walk(item);
  return texts;
};

const INLINE_CONTENT_SELECTOR: string = "img, br, input";

/*
 * Removes the marker at the start of one item's text. The marker can be
 * split over several text nodes -- "•" in a <span>, the space after it
 * outside -- so the leading text is matched as one string and then trimmed
 * node by node. Inline elements the marker leaves empty go too, or an empty
 * <strong> would come back as "****".
 */
const stripLeadingMarker: (item: HTMLElement) => boolean = (
  item: HTMLElement,
): boolean => {
  const texts: Array<Text> = ownTextNodes(item);
  const leading: string = texts
    .map((text: Text): string => {
      return text.data;
    })
    .join("");
  const match: RegExpMatchArray | null = leading.match(RE_LEADING_TEXT_MARKER);
  if (!match || match[0].length === 0) {
    return false;
  }
  let remaining: number = match[0].length;
  for (const text of texts) {
    if (remaining === 0) {
      break;
    }
    const take: number = Math.min(remaining, text.data.length);
    remaining -= take;
    text.data = text.data.slice(take);
    if (text.data.length > 0) {
      continue;
    }
    let emptied: Node | null = text.parentNode;
    text.remove();
    while (
      emptied &&
      emptied !== item &&
      emptied.nodeType === Node.ELEMENT_NODE &&
      (emptied.textContent || "").length === 0 &&
      !(emptied as Element).querySelector(INLINE_CONTENT_SELECTOR)
    ) {
      const parent: Node | null = emptied.parentNode;
      (emptied as Element).remove();
      emptied = parent;
    }
  }
  return true;
};

/*
 * The list buttons turn lines into list items with execCommand, which keeps
 * whatever the lines started with. Text pasted from Word or Slack that still
 * begins with "•" or "o" therefore showed two bullets -- the list's own and
 * the character -- and saved as "- •\tService down". This strips such a
 * marker from every item the selection reaches.
 */
export const stripTextListMarkers: (root: HTMLElement) => boolean = (
  root: HTMLElement,
): boolean => {
  const context: SelectionInRoot | null = getSelectionInRoot(root);
  if (!context) {
    return false;
  }
  const saved: SavedSelection | null = saveSelection(context.selection);
  let changed: boolean = false;
  const items: Array<HTMLElement> = Array.from(
    root.querySelectorAll("li"),
  ).filter((item: HTMLLIElement): boolean => {
    return context.range.intersectsNode(item);
  });
  for (const item of items) {
    if (stripLeadingMarker(item)) {
      changed = true;
    }
  }
  const first: HTMLElement | undefined = items[0];
  if (changed && first) {
    restoreSelection(context.selection, saved, root, first);
  }
  return changed;
};

/*
 * ---------------------------------------------------------------------------
 * Markdown mode: the source text
 * ---------------------------------------------------------------------------
 */

export interface MarkdownTextEdit {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

interface ListMarker {
  // "-", "*", "+", "1.", "10)".
  marker: string;
  ordered: boolean;
  // The item's number; 0 for a bullet.
  number: number;
  // "." or ")" for an ordered item, the bullet character otherwise.
  delimiter: string;
  // The whitespace between the marker and the item's text, as written.
  spacing: string;
  // Everything after that whitespace.
  rest: string;
  contentColumn: number;
}

interface SourceLine {
  blank: boolean;
  indent: number;
  // A fence line, or a line inside a fenced code block.
  fenced: boolean;
  // Null for anything that is not a list item, and for every fenced line.
  item: ListMarker | null;
}

const RE_SOURCE_LIST_ITEM: RegExp =
  /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
const RE_BULLET_MARKER: RegExp = /^[-*+]$/;
const RE_FENCE_OPEN: RegExp = /^[ \t]*(`{3,}|~{3,})/;
const RE_LEADING_WHITESPACE: RegExp = /^[ \t]*/;
const RE_BLANK: RegExp = /^[ \t]*$/;

// How many columns `text` covers when it starts at column `start`.
const columnsOf: (text: string, start: number) => number = (
  text: string,
  start: number,
): number => {
  let column: number = start;
  for (const ch of text) {
    column += ch === "\t" ? TAB_WIDTH - (column % TAB_WIDTH) : 1;
  }
  return column - start;
};

const leadingWhitespace: (line: string) => string = (line: string): string => {
  const match: RegExpMatchArray | null = line.match(RE_LEADING_WHITESPACE);
  return match ? match[0] : "";
};

/*
 * CommonMark's content column: the marker's indent, plus the marker, plus the
 * spaces after it -- unless there are none (an empty item) or five or more
 * (the text is indented code), in which case one space counts.
 */
const contentColumnOf: (
  indent: number,
  marker: string,
  spacing: string,
) => number = (indent: number, marker: string, spacing: string): number => {
  const markerEnd: number = indent + marker.length;
  const spacingWidth: number = columnsOf(spacing, markerEnd);
  if (spacingWidth === 0 || spacingWidth > 4) {
    return markerEnd + 1;
  }
  return markerEnd + spacingWidth;
};

const parseSourceLines: (lines: Array<string>) => Array<SourceLine> = (
  lines: Array<string>,
): Array<SourceLine> => {
  const parsed: Array<SourceLine> = [];
  let openFence: string | null = null;
  for (const line of lines) {
    const indent: number = columnsOf(leadingWhitespace(line), 0);
    const blank: boolean = RE_BLANK.test(line);
    const fence: RegExpMatchArray | null = line.match(RE_FENCE_OPEN);
    if (openFence !== null) {
      const fenceRun: string = fence ? fence[1] || "" : "";
      const closes: boolean =
        fenceRun.length >= openFence.length &&
        fenceRun.charAt(0) === openFence.charAt(0) &&
        RE_BLANK.test(line.slice(line.indexOf(fenceRun) + fenceRun.length));
      parsed.push({ blank, indent, fenced: true, item: null });
      if (closes) {
        openFence = null;
      }
      continue;
    }
    if (fence) {
      openFence = fence[1] || "```";
      parsed.push({ blank, indent, fenced: true, item: null });
      continue;
    }
    const match: RegExpMatchArray | null = line.match(RE_SOURCE_LIST_ITEM);
    if (!match) {
      parsed.push({ blank, indent, fenced: false, item: null });
      continue;
    }
    const marker: string = match[2] || "";
    const ordered: boolean = !RE_BULLET_MARKER.test(marker);
    const spacing: string = match[3] || "";
    parsed.push({
      blank,
      indent,
      fenced: false,
      item: {
        marker,
        ordered,
        number: ordered ? parseInt(marker, 10) : 0,
        delimiter: ordered ? marker.slice(-1) : marker,
        spacing,
        rest: match[4] || "",
        contentColumn: contentColumnOf(indent, marker, spacing),
      },
    });
  }
  return parsed;
};

/*
 * The end (exclusive) of the block that starts at `index`: the item's own
 * line and everything indented deeper than it below -- its continuation
 * lines, its nested items, a fenced block inside it -- up to the next line
 * that is not.
 */
const blockEnd: (parsed: Array<SourceLine>, index: number) => number = (
  parsed: Array<SourceLine>,
  index: number,
): number => {
  const own: number = parsed[index]?.indent ?? 0;
  let end: number = index + 1;
  let j: number = index + 1;
  while (j < parsed.length) {
    const line: SourceLine = parsed[j] as SourceLine;
    if (!line.blank) {
      if (line.indent <= own) {
        break;
      }
      end = j + 1;
    }
    j++;
  }
  return end;
};

// The innermost list item whose block holds line `index`, or -1.
const itemHoldingLine: (parsed: Array<SourceLine>, index: number) => number = (
  parsed: Array<SourceLine>,
  index: number,
): number => {
  for (let k: number = index; k >= 0; k--) {
    const line: SourceLine = parsed[k] as SourceLine;
    if (line.item && (k === index || blockEnd(parsed, k) > index)) {
      return k;
    }
    if (k < index && !line.blank && line.indent === 0 && !line.item) {
      return -1;
    }
  }
  return -1;
};

// The item line `index` is nested in, or -1 for a top-level item.
const parentItemOf: (parsed: Array<SourceLine>, index: number) => number = (
  parsed: Array<SourceLine>,
  index: number,
): number => {
  const indent: number = parsed[index]?.indent ?? 0;
  for (let k: number = index - 1; k >= 0; k--) {
    const line: SourceLine = parsed[k] as SourceLine;
    if (
      line.item &&
      line.indent < indent &&
      line.item.contentColumn <= indent &&
      blockEnd(parsed, k) > index
    ) {
      return k;
    }
    if (!line.blank && line.indent === 0 && k < index && !line.item) {
      return -1;
    }
  }
  return -1;
};

/*
 * The item before `index` in the same list: the nearest item above it at
 * the same level, with nothing shallower in between.
 */
const previousSiblingOf: (
  parsed: Array<SourceLine>,
  index: number,
) => number = (parsed: Array<SourceLine>, index: number): number => {
  const indent: number = parsed[index]?.indent ?? 0;
  for (let k: number = index - 1; k >= 0; k--) {
    const line: SourceLine = parsed[k] as SourceLine;
    if (line.blank || line.indent > indent) {
      continue;
    }
    if (line.item && indent < line.item.contentColumn) {
      return k;
    }
    return -1;
  }
  return -1;
};

/*
 * The items after `index` in the same list, up to line `lastLine`. A marker
 * of the other kind at the same indent starts a list of its own, so it ends
 * the run.
 */
const followingSiblingsOf: (
  parsed: Array<SourceLine>,
  index: number,
  lastLine: number,
) => Array<number> = (
  parsed: Array<SourceLine>,
  index: number,
  lastLine: number,
): Array<number> => {
  const start: SourceLine | undefined = parsed[index];
  const siblings: Array<number> = [];
  if (!start || !start.item) {
    return siblings;
  }
  let j: number = blockEnd(parsed, index);
  while (j < parsed.length && j <= lastLine) {
    const line: SourceLine = parsed[j] as SourceLine;
    if (line.blank) {
      j++;
      continue;
    }
    if (
      !line.item ||
      line.indent !== start.indent ||
      line.item.ordered !== start.item.ordered
    ) {
      break;
    }
    siblings.push(j);
    j = blockEnd(parsed, j);
  }
  return siblings;
};

/*
 * The lines a selection covers. A selection that ends at column 0 of a line
 * -- what dragging to the end of the previous line or selecting whole lines
 * leaves -- does not include that line.
 */
const selectedLineRange: (
  text: string,
  selectionStart: number,
  selectionEnd: number,
) => { first: number; last: number } = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): { first: number; last: number } => {
  const start: number = Math.max(0, Math.min(selectionStart, text.length));
  let end: number = Math.max(start, Math.min(selectionEnd, text.length));
  if (end > start && text.charAt(end - 1) === "\n") {
    end--;
  }
  const lineOf: (offset: number) => number = (offset: number): number => {
    return text.slice(0, offset).split("\n").length - 1;
  };
  return { first: lineOf(start), last: lineOf(end) };
};

/*
 * The item an indent or outdent starts from: the one holding the first
 * non-blank selected line. Nothing, when that line is in a fenced code block
 * or is not in a list at all.
 */
const startItemOf: (
  parsed: Array<SourceLine>,
  first: number,
  last: number,
) => number = (
  parsed: Array<SourceLine>,
  first: number,
  last: number,
): number => {
  let line: number = first;
  while (line <= last && parsed[line]?.blank) {
    line++;
  }
  const at: SourceLine | undefined = parsed[line];
  if (line > last || !at || at.fenced) {
    return -1;
  }
  return itemHoldingLine(parsed, line);
};

const withIndent: (line: string, columns: number) => string = (
  line: string,
  columns: number,
): string => {
  return `${" ".repeat(Math.max(0, columns))}${line.slice(leadingWhitespace(line).length)}`;
};

/*
 * Rewrites item `index` to start at column `indent` with `marker`, and moves
 * every line of its block by as much as its content column moved, so the
 * lines nested in it stay nested in it -- including when the new marker is
 * wider or narrower than the old one ("9." becoming "10.").
 */
const moveItem: (
  lines: Array<string>,
  parsed: Array<SourceLine>,
  index: number,
  indent: number,
  marker: string,
) => void = (
  lines: Array<string>,
  parsed: Array<SourceLine>,
  index: number,
  indent: number,
  marker: string,
): void => {
  const item: ListMarker | null = parsed[index]?.item || null;
  if (!item) {
    return;
  }
  const end: number = blockEnd(parsed, index);
  // Tabs in the spacing would change width with the column; write spaces.
  const oldMarkerEnd: number =
    (parsed[index]?.indent ?? 0) + item.marker.length;
  const spacing: string = item.spacing.includes("\t")
    ? " ".repeat(columnsOf(item.spacing, oldMarkerEnd))
    : item.spacing;
  lines[index] = `${" ".repeat(indent)}${marker}${spacing}${item.rest}`;
  const shift: number =
    contentColumnOf(indent, marker, spacing) - item.contentColumn;
  for (let j: number = index + 1; j < end; j++) {
    const line: SourceLine = parsed[j] as SourceLine;
    if (!line.blank) {
      lines[j] = withIndent(lines[j] || "", line.indent + shift);
    }
  }
};

const markerAfter: (item: ListMarker, number: number) => string = (
  item: ListMarker,
  number: number,
): string => {
  return item.ordered ? `${number}${item.delimiter}` : item.marker;
};

/*
 * Numbers an ordered list's items one after another, from `startNumber`, so
 * the source reads the way the visual editor would write it. CommonMark only
 * takes a list's first number, so this changes what the text says rather than
 * how it renders -- except for the first item, whose number is the list's
 * start.
 */
const renumberList: (
  lines: Array<string>,
  firstItem: number,
  startNumber: number,
) => void = (
  lines: Array<string>,
  firstItem: number,
  startNumber: number,
): void => {
  let parsed: Array<SourceLine> = parseSourceLines(lines);
  const first: ListMarker | null = parsed[firstItem]?.item || null;
  if (!first || !first.ordered) {
    return;
  }
  const items: Array<number> = [
    firstItem,
    ...followingSiblingsOf(parsed, firstItem, lines.length),
  ];
  let number: number = startNumber;
  for (const index of items) {
    const item: ListMarker | null = parsed[index]?.item || null;
    if (item) {
      const marker: string = `${number}${item.delimiter}`;
      if (marker !== item.marker) {
        moveItem(lines, parsed, index, parsed[index]?.indent ?? 0, marker);
        parsed = parseSourceLines(lines);
      }
    }
    number++;
  }
};

/*
 * Where an offset in the old text lands in the new one. Only the start of a
 * line (its indent and marker) ever changes, so a position in the text after
 * that moves with it; a position inside the part that changed stays put, or
 * moves back to the new line's end if it would pass it. A non-empty selection
 * that started at column 0 keeps starting there, so whole lines stay selected
 * and a second Tab indents them again.
 */
const mapOffset: (
  before: Array<string>,
  after: Array<string>,
  offset: number,
  keepLineStart: boolean,
) => number = (
  before: Array<string>,
  after: Array<string>,
  offset: number,
  keepLineStart: boolean,
): number => {
  let remaining: number = offset;
  let line: number = 0;
  while (line < before.length - 1 && remaining > (before[line] || "").length) {
    remaining -= (before[line] || "").length + 1;
    line++;
  }
  const oldLine: string = before[line] || "";
  const newLine: string = after[line] || "";
  let column: number = Math.max(0, Math.min(remaining, oldLine.length));
  if (!(keepLineStart && column === 0)) {
    // Everything after the changed start of the line is shared by both.
    const unchanged: number = commonSuffixLength(oldLine, newLine);
    const oldChangedEnd: number = oldLine.length - unchanged;
    const newChangedEnd: number = newLine.length - unchanged;
    column =
      column >= oldChangedEnd
        ? column - oldChangedEnd + newChangedEnd
        : Math.min(column, newChangedEnd);
    column = Math.max(0, Math.min(column, newLine.length));
  }
  let result: number = 0;
  for (let k: number = 0; k < line; k++) {
    result += (after[k] || "").length + 1;
  }
  return result + column;
};

const commonSuffixLength: (a: string, b: string) => number = (
  a: string,
  b: string,
): number => {
  let length: number = 0;
  while (
    length < a.length &&
    length < b.length &&
    a.charAt(a.length - 1 - length) === b.charAt(b.length - 1 - length)
  ) {
    length++;
  }
  return length;
};

const finishEdit: (
  before: Array<string>,
  after: Array<string>,
  selectionStart: number,
  selectionEnd: number,
) => MarkdownTextEdit | null = (
  before: Array<string>,
  after: Array<string>,
  selectionStart: number,
  selectionEnd: number,
): MarkdownTextEdit | null => {
  const text: string = after.join("\n");
  if (text === before.join("\n")) {
    return null;
  }
  const collapsed: boolean = selectionStart === selectionEnd;
  const start: number = mapOffset(before, after, selectionStart, !collapsed);
  const end: number = collapsed
    ? start
    : Math.max(start, mapOffset(before, after, selectionEnd, false));
  return { text, selectionStart: start, selectionEnd: end };
};

/*
 * Indent in the source: the selected items move to the content column of the
 * item before them, and everything nested in them moves by the same amount.
 * An item that becomes the first child starts a new list (an ordered one is
 * renumbered from 1, or it would render as start="2"); one that joins
 * existing children takes their kind of marker and the next number. The list
 * the items left is renumbered. Returns null when there is nothing to indent
 * -- the caret is not in a list, the item is its list's first, or the line is
 * in a fenced code block.
 */
export const indentMarkdownLines: (
  text: string,
  selectionStart: number,
  selectionEnd: number,
) => MarkdownTextEdit | null = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownTextEdit | null => {
  const before: Array<string> = text.split("\n");
  const lines: Array<string> = before.slice();
  let parsed: Array<SourceLine> = parseSourceLines(lines);
  const range: { first: number; last: number } = selectedLineRange(
    text,
    selectionStart,
    selectionEnd,
  );
  const start: number = startItemOf(parsed, range.first, range.last);
  if (start === -1) {
    return null;
  }
  const previous: number = previousSiblingOf(parsed, start);
  const previousItem: ListMarker | null = parsed[previous]?.item || null;
  if (previous === -1 || !previousItem) {
    return null;
  }
  const items: Array<number> = [
    start,
    ...followingSiblingsOf(parsed, start, range.last),
  ];
  const column: number = previousItem.contentColumn;

  for (const index of items) {
    const item: ListMarker | null = parsed[index]?.item || null;
    if (!item) {
      continue;
    }
    let joins: number = -1;
    for (let k: number = index - 1; k > previous; k--) {
      if (parsed[k]?.item && parentItemOf(parsed, k) === previous) {
        joins = k;
        break;
      }
    }
    const joined: ListMarker | null = parsed[joins]?.item || null;
    let marker: string;
    if (joined) {
      marker = markerAfter(joined, joined.number + 1);
    } else {
      marker = item.ordered ? `1${item.delimiter}` : item.marker;
    }
    moveItem(lines, parsed, index, column, marker);
    parsed = parseSourceLines(lines);
  }

  if (previousItem.ordered) {
    renumberList(lines, previous, previousItem.number);
  }
  return finishEdit(before, lines, selectionStart, selectionEnd);
};

/*
 * Outdent in the source: the selected items move out to their parent's
 * column and take the parent list's kind of marker, numbered on from the
 * parent (otherwise "1. a\n   - b\n2. c" would come out as three separate
 * lists). The items that followed them at their old level stay where they
 * are, which now nests them in the last moved item -- re-indented to its
 * content column if its marker is wider -- and they start a new list, so an
 * ordered one is renumbered from 1. Returns null for a top-level item, a line
 * outside any list, or one in a fenced code block.
 */
export const outdentMarkdownLines: (
  text: string,
  selectionStart: number,
  selectionEnd: number,
) => MarkdownTextEdit | null = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownTextEdit | null => {
  const before: Array<string> = text.split("\n");
  const lines: Array<string> = before.slice();
  let parsed: Array<SourceLine> = parseSourceLines(lines);
  const range: { first: number; last: number } = selectedLineRange(
    text,
    selectionStart,
    selectionEnd,
  );
  const start: number = startItemOf(parsed, range.first, range.last);
  if (start === -1) {
    return null;
  }
  const parent: number = parentItemOf(parsed, start);
  const parentItem: ListMarker | null = parsed[parent]?.item || null;
  if (parent === -1 || !parentItem) {
    return null;
  }
  const items: Array<number> = [
    start,
    ...followingSiblingsOf(parsed, start, range.last),
  ];
  const lastMoved: number = items[items.length - 1] ?? start;
  const oldIndent: number = parsed[start]?.indent ?? 0;
  const trailing: Array<number> = followingSiblingsOf(
    parsed,
    lastMoved,
    lines.length,
  );
  const firstTrailing: number | undefined = trailing[0];
  const lastTrailing: number | undefined = trailing[trailing.length - 1];
  const trailingEnd: number =
    lastTrailing === undefined ? -1 : blockEnd(parsed, lastTrailing);
  const newIndent: number = parsed[parent]?.indent ?? 0;

  let number: number = parentItem.number;
  for (const index of items) {
    number++;
    moveItem(lines, parsed, index, newIndent, markerAfter(parentItem, number));
    parsed = parseSourceLines(lines);
  }

  if (firstTrailing !== undefined) {
    const moved: ListMarker | null = parsed[lastMoved]?.item || null;
    const shortfall: number = moved ? moved.contentColumn - oldIndent : 0;
    if (shortfall > 0) {
      for (let j: number = firstTrailing; j < trailingEnd; j++) {
        const line: SourceLine = parsed[j] as SourceLine;
        if (!line.blank) {
          lines[j] = withIndent(lines[j] || "", line.indent + shortfall);
        }
      }
      parsed = parseSourceLines(lines);
    }
    renumberList(lines, firstTrailing, 1);
  }

  if (parentItem.ordered) {
    renumberList(lines, parent, parentItem.number);
  }
  return finishEdit(before, lines, selectionStart, selectionEnd);
};

export type MarkdownListKind = "bullet" | "ordered" | "task";

const RE_TASK_LINE: RegExp = /^[-*+][ \t]+\[([ xX])\](?:[ \t]|$)/;
const RE_BULLET_LINE: RegExp = /^[-*+](?:[ \t]|$)/;
const RE_ORDERED_LINE: RegExp = /^\d{1,9}[.)](?:[ \t]|$)/;
/*
 * A marker at the start of a source line's text. As in the visual editor, a
 * bullet character only counts before a space or tab (or on its own):
 * "–5°C" keeps its minus sign, and "- –5°C" is an item, not a double bullet.
 */
const RE_SOURCE_MARKER: RegExp = new RegExp(
  `^(?:[-*+][ \\t]+(?:\\[[ xX]\\][ \\t]+)?|\\d{1,9}[.)][ \\t]+|[${TEXT_BULLET_GLYPHS}](?:[ \\t\\u00a0]+|$)|[${TAB_ONLY_BULLET_GLYPHS}]\\t[ \\t]*)`,
);

/*
 * The kind of item a line is. A line whose text still starts with a second
 * marker after its own -- the "- •\tService down" a double bullet saved as
 * -- counts as none, so the button repairs it instead of taking the list off.
 */
const listKindOf: (body: string) => MarkdownListKind | null = (
  body: string,
): MarkdownListKind | null => {
  let kind: MarkdownListKind | null = null;
  if (RE_TASK_LINE.test(body)) {
    kind = "task";
  } else if (RE_BULLET_LINE.test(body)) {
    kind = "bullet";
  } else if (RE_ORDERED_LINE.test(body)) {
    kind = "ordered";
  }
  const own: RegExpMatchArray | null = body.match(RE_SOURCE_MARKER);
  if (kind && own && RE_SOURCE_MARKER.test(body.slice(own[0].length))) {
    return null;
  }
  return kind;
};

// Every marker a line starts with -- "- •\tx" (a double bullet) loses both.
const stripSourceMarkers: (body: string) => string = (body: string): string => {
  let stripped: string = body;
  for (let pass: number = 0; pass < 3; pass++) {
    const match: RegExpMatchArray | null = stripped.match(RE_SOURCE_MARKER);
    if (!match || match[0].length === 0) {
      break;
    }
    stripped = stripped.slice(match[0].length);
  }
  return stripped;
};

/*
 * The Bullet List, Numbered List and Task List buttons in the source. Every
 * selected line that has text becomes an item of that kind: whatever marker
 * it already had -- another kind's, or a bullet character pasted as text --
 * is replaced rather than kept beside the new one, and numbered lines count
 * 1, 2, 3 down the selection. When every one of those lines already is an
 * item of that kind, the button takes the markers off instead. A task item
 * keeps its checked state. With no text selected, the caret's own line is
 * used even when it is empty, to start a list there. Returns null when
 * nothing changed (the caret is inside a fenced code block).
 */
export const toggleMarkdownList: (
  text: string,
  selectionStart: number,
  selectionEnd: number,
  kind: MarkdownListKind,
) => MarkdownTextEdit | null = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
  kind: MarkdownListKind,
): MarkdownTextEdit | null => {
  const before: Array<string> = text.split("\n");
  const lines: Array<string> = before.slice();
  const parsed: Array<SourceLine> = parseSourceLines(lines);
  const range: { first: number; last: number } = selectedLineRange(
    text,
    selectionStart,
    selectionEnd,
  );
  let targets: Array<number> = [];
  for (let index: number = range.first; index <= range.last; index++) {
    const line: SourceLine | undefined = parsed[index];
    if (line && !line.blank && !line.fenced) {
      targets.push(index);
    }
  }
  if (targets.length === 0 && range.first === range.last) {
    if (parsed[range.first]?.fenced) {
      return null;
    }
    targets = [range.first];
  }
  if (targets.length === 0) {
    return null;
  }

  const bodies: Array<{ indent: string; body: string }> = targets.map(
    (index: number): { indent: string; body: string } => {
      const line: string = lines[index] || "";
      const indent: string = leadingWhitespace(line);
      return { indent, body: line.slice(indent.length) };
    },
  );
  const allOfKind: boolean = bodies.every(
    (entry: { indent: string; body: string }): boolean => {
      return listKindOf(entry.body) === kind;
    },
  );

  let number: number = 0;
  targets.forEach((index: number, position: number): void => {
    const entry: { indent: string; body: string } | undefined =
      bodies[position];
    if (!entry) {
      return;
    }
    const content: string = stripSourceMarkers(entry.body);
    if (allOfKind) {
      lines[index] = `${entry.indent}${content}`;
      return;
    }
    let prefix: string;
    if (kind === "ordered") {
      number++;
      prefix = `${number}. `;
    } else if (kind === "task") {
      const task: RegExpMatchArray | null = entry.body.match(RE_TASK_LINE);
      const checked: boolean = Boolean(task && (task[1] || "").trim());
      prefix = checked ? "- [x] " : "- [ ] ";
    } else {
      prefix = "- ";
    }
    lines[index] = `${entry.indent}${prefix}${content}`;
  });

  return finishEdit(before, lines, selectionStart, selectionEnd);
};
