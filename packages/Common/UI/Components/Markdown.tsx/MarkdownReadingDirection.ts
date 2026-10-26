import {
  getTextReadingDirection,
  getTextReadingDirectionByMostLetters,
  ReadingDirection,
  TEXT_DIRECTION_SCAN_LENGTH,
} from "../../../Types/ReadingDirection";

/*
 * NOTES READ THE WAY THEY ARE WRITTEN.
 *
 * A note, a description, an AI answer is written in its author's language,
 * whatever the page's: an English postmortem on a Persian page laid out
 * from the right put its full stops and list bullets on the wrong side,
 * and a Persian note on an English page did the same the other way.
 *
 * The viewer lays each paragraph, heading, list, quote and table of a note
 * out the way most of its letters read (rehypeBlocksReadTheirOwnWay): an
 * English note left to right on a Persian page, a Persian paragraph in it
 * right to left, a list of English names left to right with its bullets
 * beside them. Inside a list, a quote or a table, an item written the other
 * way - a Persian name in an English list - reads its own way in an
 * isolate (bdi) and stays on its list's side, beside its bullet.
 *
 * The editor reads a note as it is typed, the way its first letter reads,
 * as a browser decides dir="auto", so a line never turns round mid-word.
 * A text with no letter yet - an empty editor, its placeholder - follows
 * the page.
 *
 * React-free, so the viewer, the editor and the tests share it.
 */

// The editor's direction: its first letter's, or undefined to follow the page.
export const getMarkdownReadingDirection: (
  markdown: string | null | undefined,
) => ReadingDirection | undefined = (
  markdown: string | null | undefined,
): ReadingDirection | undefined => {
  return getTextReadingDirection(markdown) || undefined;
};

/*
 * The words a note shows, as far as its direction goes: its Markdown with
 * the addresses of its links and images ("](https://...)") and its code
 * spans left out - a Persian sentence linking to /dashboard/... is still
 * Persian. Only the start is read (TEXT_DIRECTION_SCAN_LENGTH characters
 * of words), in one pass: once a closing mark is not found, it is not
 * looked for again.
 */
export const getMarkdownWords: (
  markdown: string | null | undefined,
) => string = (markdown: string | null | undefined): string => {
  const source: string = markdown || "";
  let words: string = "";
  let index: number = 0;
  let isBacktickAhead: boolean = true;
  let isParenthesisAhead: boolean = true;

  while (index < source.length && words.length < TEXT_DIRECTION_SCAN_LENGTH) {
    const character: string = source[index]!;

    // A code span: up to its closing backtick.
    if (character === "`" && isBacktickAhead) {
      const close: number = source.indexOf("`", index + 1);

      if (close !== -1) {
        index = close + 1;
        continue;
      }

      isBacktickAhead = false;
    }

    // A link's or an image's address: up to its closing parenthesis.
    if (character === "]" && source[index + 1] === "(" && isParenthesisAhead) {
      const close: number = source.indexOf(")", index + 2);

      if (close !== -1) {
        index = close + 1;
        continue;
      }

      isParenthesisAhead = false;
    }

    words += character;
    index++;
  }

  return words;
};

/*
 * The viewer's direction: most of the letters of its words', or undefined
 * to follow the page.
 */
export const getShownMarkdownReadingDirection: (
  markdown: string | null | undefined,
) => ReadingDirection | undefined = (
  markdown: string | null | undefined,
): ReadingDirection | undefined => {
  return (
    getTextReadingDirectionByMostLetters(getMarkdownWords(markdown)) ||
    undefined
  );
};

/*
 * What is not read to find a block's direction: code is always left to
 * right (Theme.css) and says nothing about the language of the words
 * around it.
 */
const NOT_READ_FOR_DIRECTION: ReadonlySet<string> = new Set<string>([
  "code",
  "pre",
  "kbd",
  "samp",
  "script",
  "style",
]);

// Elements that hold blocks, not words: an item holding one is not wrapped.
const BLOCK_TAGS: ReadonlySet<string> = new Set<string>([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

// The elements inside a block whose words can read the other way.
const TEXT_ITEM_TAGS: ReadonlySet<string> = new Set<string>([
  "li",
  "td",
  "th",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "dt",
  "dd",
  "figcaption",
  "summary",
]);

// A task list's check box.
const CHECK_BOX_TAGS: ReadonlySet<string> = new Set<string>(["input"]);

// The node of a rendered note react-markdown hands its rehype plugins (hast).
export interface MarkdownTreeNode {
  type: string;
  tagName?: string | undefined;
  value?: unknown;
  properties?: Record<string, unknown> | undefined;
  children?: Array<MarkdownTreeNode> | undefined;
}

const isElement: (
  node: MarkdownTreeNode,
  tagNames?: ReadonlySet<string>,
) => boolean = (
  node: MarkdownTreeNode,
  tagNames?: ReadonlySet<string>,
): boolean => {
  return (
    node.type === "element" &&
    typeof node.tagName === "string" &&
    (!tagNames || tagNames.has(node.tagName))
  );
};

/*
 * The words of a block, its code left out, up to the length a direction is
 * read from. Walked with a stack: the tree of a long note is deep.
 */
export const getMarkdownBlockText: (block: MarkdownTreeNode) => string = (
  block: MarkdownTreeNode,
): string => {
  let text: string = "";
  const stack: Array<MarkdownTreeNode> = [block];

  while (stack.length > 0 && text.length < TEXT_DIRECTION_SCAN_LENGTH) {
    const node: MarkdownTreeNode = stack.pop()!;

    if (node.type === "text" && typeof node.value === "string") {
      text += node.value.slice(0, TEXT_DIRECTION_SCAN_LENGTH - text.length);
      continue;
    }

    if (isElement(node, NOT_READ_FOR_DIRECTION)) {
      continue;
    }

    // Last child pushed first, so the words come off the stack in order.
    const children: Array<MarkdownTreeNode> = node.children || [];

    for (let index: number = children.length - 1; index >= 0; index--) {
      stack.push(children[index]!);
    }
  }

  return text;
};

/*
 * An item written the other way from the block it is in: its words, after
 * any check box of a task list, go in an isolate that reads their way
 * (bdi), and the item itself keeps its block's side - its bullet, its
 * column. Only an item that holds words alone; one that holds paragraphs or
 * a list has them read in turn.
 */
const readItemsInBlock: (
  block: MarkdownTreeNode,
  blockDirection: ReadingDirection,
) => void = (
  block: MarkdownTreeNode,
  blockDirection: ReadingDirection,
): void => {
  const stack: Array<MarkdownTreeNode> = [block];

  while (stack.length > 0) {
    const node: MarkdownTreeNode = stack.pop()!;

    for (const child of node.children || []) {
      if (!isElement(child) || isElement(child, NOT_READ_FOR_DIRECTION)) {
        continue;
      }

      const children: Array<MarkdownTreeNode> = child.children || [];
      const holdsBlocks: boolean = children.some(
        (grandchild: MarkdownTreeNode): boolean => {
          return isElement(grandchild, BLOCK_TAGS);
        },
      );

      if (!isElement(child, TEXT_ITEM_TAGS) || holdsBlocks) {
        stack.push(child);
        continue;
      }

      const itemDirection: ReadingDirection | null =
        getTextReadingDirectionByMostLetters(getMarkdownBlockText(child));

      if (!itemDirection || itemDirection === blockDirection) {
        continue;
      }

      // A task list's check box stays where its bullet would be.
      let firstWord: number = 0;

      while (
        firstWord < children.length &&
        (isElement(children[firstWord]!, CHECK_BOX_TAGS) ||
          (children[firstWord]!.type === "text" &&
            String(children[firstWord]!.value).trim() === ""))
      ) {
        firstWord++;
      }

      child.children = [
        ...children.slice(0, firstWord),
        {
          type: "element",
          tagName: "bdi",
          properties: { dir: itemDirection },
          children: children.slice(firstWord),
        },
      ];
    }
  }
};

/*
 * A rehype plugin: every block of the note - a paragraph, a heading, a
 * list, a quote, a table - gets the direction most of its words read in
 * (dir), so it lays out, aligns and puts its bullets and quote rule on that
 * side; an item inside it written the other way reads its own way where it
 * stands (readItemsInBlock). Code keeps the page's own rules (left to right
 * everywhere). A block with no letters follows the note.
 */
export const rehypeBlocksReadTheirOwnWay: () => (
  tree: MarkdownTreeNode,
) => void = (): ((tree: MarkdownTreeNode) => void) => {
  return (tree: MarkdownTreeNode): void => {
    for (const block of tree.children || []) {
      if (!isElement(block) || isElement(block, NOT_READ_FOR_DIRECTION)) {
        continue;
      }

      const direction: ReadingDirection | null =
        getTextReadingDirectionByMostLetters(getMarkdownBlockText(block));

      if (!direction) {
        continue;
      }

      block.properties = { ...(block.properties || {}), dir: direction };
      readItemsInBlock(block, direction);
    }
  };
};

/*
 * The editor's own stylesheet (its visual mode's blocks), as the note is
 * typed: each paragraph and heading reads the way its first letter does
 * and starts on that side. A list's items, and the paragraphs of a list, a
 * quote or a table, read the editor's way, beside their bullets: an item
 * turned round by its own first letter put its bullet on the other side in
 * Safari.
 */
export const MARKDOWN_EDITOR_BLOCKS_READ_THEIR_OWN_WAY_CSS: string =
  ".oneuptime-wysiwyg :is(p, h1, h2, h3, h4, h5, h6, dt, dd, figcaption):not(li *, blockquote *, td *, th *) { unicode-bidi: plaintext; text-align: start; }";
