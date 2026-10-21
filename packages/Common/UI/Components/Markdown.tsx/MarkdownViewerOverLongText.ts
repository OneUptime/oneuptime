import {
  OVER_LONG_LINE_LENGTH,
  holdBackOverLongText,
} from "../../../Utils/Markdown/OverLongText";
import {
  SLOW_MARKDOWN_MAX_INLINE_WORK,
  SLOW_MARKDOWN_MAX_NESTING_DEPTH,
  SlowMarkdownLimits,
  holdBackSlowMarkdown,
} from "../../../Utils/Markdown/SlowMarkdown";

/*
 * TEXT TOO LONG FOR THE VIEWER'S MARKDOWN PARSER.
 *
 * A description, a note or a root cause can carry a response body or a log
 * a description template placed - megabytes on one line, or a paragraph of
 * a hundred thousand lines. react-markdown reads Markdown with remark, which
 * ran out of stack ("Maximum call stack size exceeded") on a line of a few
 * megabytes and took minutes on others, and the page that showed the
 * incident broke with it.
 *
 * So the viewer holds back what Utils/Markdown/OverLongText holds back from
 * every parser - the middle of an over-long line, the plain lines of an
 * over-long run of lines - before react-markdown reads the text, puts a
 * short token in its place, and rehypePutBackHeldText writes it back into
 * the rendered tree as text: React escapes it, and an address it is part of
 * is put back together before the viewer's urlTransform judges it. A text
 * of at most 64 KB holds back nothing, and renders exactly as it always
 * has.
 *
 * Text of some shapes takes remark long before it is that long: its time
 * grows with the square of a run of emphasis or brackets it cannot close
 * ("a* a* ..." took 29 s on 64 KB, "[[[...]]]" 69 s), and of a long list or
 * table (16,000 items took 8 s), and a line nested two thousand quotes deep
 * ran it out of stack. So the blocks Utils/Markdown/SlowMarkdown finds too
 * costly for it are held back whole as well (VIEWER_SLOW_MARKDOWN_LIMITS),
 * and written back as text, a line on each line; the content of fenced
 * code, which remark reads a line at a time, goes back where it was.
 *
 * What is left after that can still be more than remark reads in good time
 * - a 128 KB table took seconds, a few megabytes did not finish. A text
 * with more than MAX_PARSED_MARKDOWN_LENGTH left is shown as it was written
 * instead (showAsText), the way an email shows a text marked cannot read.
 *
 * Pure, with no React or DOM: the plugin works on remark's HTML tree.
 */

/*
 * Private Use Area characters the viewer puts around a held-back text's
 * index: HELD_OPEN + index + HELD_CLOSE. Any already in the text are held
 * back too, so every one the parser sees is one the viewer put there.
 */
const HELD_OPEN: string = "\uE005";
const HELD_CLOSE: string = "\uE006";
const HELD_OPEN_CODE: number = 0xe005;
const HELD_CLOSE_CODE: number = 0xe006;

// Code longer than this is shown as it is: highlighting it took minutes.
export const MAX_HIGHLIGHTED_CODE_LENGTH: number = OVER_LONG_LINE_LENGTH;

/*
 * The most Markdown the viewer hands react-markdown, once what is too long
 * is held back: a text with more left is shown as it was written.
 */
export const MAX_PARSED_MARKDOWN_LENGTH: number = 2 * OVER_LONG_LINE_LENGTH;

/*
 * What remark is given at most (Utils/Markdown/SlowMarkdown): the inline
 * work every parser takes in good time, runs of at most 1,024 lines and
 * 2,048 lines in all - remark took a fifth of a second for 2,048 list items
 * in a browser - at most sixteen quotes and lists deep, and table rows of
 * at most 128 cells. remark reads a long paragraph in linear time, so its
 * length is not limited.
 */
export const VIEWER_SLOW_MARKDOWN_LIMITS: SlowMarkdownLimits = {
  maxInlineWork: SLOW_MARKDOWN_MAX_INLINE_WORK,
  maxRunLines: 1024,
  maxLines: 2048,
  maxUnitLines: Number.POSITIVE_INFINITY,
  maxUnitLength: Number.POSITIVE_INFINITY,
  maxNestingDepth: SLOW_MARKDOWN_MAX_NESTING_DEPTH,
  maxCellsPerLine: 128,
  holdBackCodeBlockContent: true,
  countUrlLiterals: true,
  countWordUnderscores: true,
};

export interface HeldBackViewerText {
  // The Markdown react-markdown reads.
  markdown: string;
  // What was held back, by index: empty when nothing was.
  held: Array<string>;
  /*
   * The indexes of what was held back as whole lines: written back with a
   * line break between its lines (rehypePutBackHeldText).
   */
  heldLines: Array<number>;
  /*
   * Whether the text is shown as it was written rather than read as
   * Markdown: more than MAX_PARSED_MARKDOWN_LENGTH of it is left once what
   * is too long is held back.
   */
  showAsText: boolean;
}

// `value` with every token in it replaced by the text it stands for.
export const putBackHeldText: (
  value: string,
  held: ReadonlyArray<string>,
) => string = (value: string, held: ReadonlyArray<string>): string => {
  if (held.length === 0 || value.indexOf(HELD_OPEN) === -1) {
    return value;
  }

  let restored: string = "";
  let restoredUpTo: number = 0;

  for (
    let open: number = value.indexOf(HELD_OPEN);
    open !== -1;
    open = value.indexOf(HELD_OPEN, restoredUpTo)
  ) {
    const close: number = value.indexOf(HELD_CLOSE, open + 1);

    if (close === -1) {
      break;
    }

    restored +=
      value.slice(restoredUpTo, open) +
      (held[Number(value.slice(open + 1, close))] ?? "");
    restoredUpTo = close + 1;
  }

  return restored + value.slice(restoredUpTo);
};

/*
 * The Markdown the viewer gives react-markdown for `text`, with what is too
 * long for it held back (see the top of this file). `text` itself, with
 * nothing held, when nothing in it is that long - and showAsText when what
 * is left is more than react-markdown reads in good time.
 */
export const holdBackForViewer: (text: string) => HeldBackViewerText = (
  text: string,
): HeldBackViewerText => {
  if (typeof text !== "string" || !text) {
    return { markdown: text, held: [], heldLines: [], showAsText: false };
  }

  const held: Array<string> = [];
  const heldLines: Array<number> = [];

  const hold: (value: string) => string = (value: string): string => {
    held.push(putBackHeldText(value, held));

    return `${HELD_OPEN}${held.length - 1}${HELD_CLOSE}`;
  };

  const holdLines: (value: string) => string = (value: string): string => {
    const token: string = hold(value);

    heldLines.push(held.length - 1);

    return token;
  };

  // Token characters already in the text are held back as they are.
  let withoutTokens: string = text;

  if (text.indexOf(HELD_OPEN) !== -1 || text.indexOf(HELD_CLOSE) !== -1) {
    let copiedUpTo: number = 0;

    withoutTokens = "";

    for (let index: number = 0; index < text.length; index++) {
      const code: number = text.charCodeAt(index);

      if (code === HELD_OPEN_CODE || code === HELD_CLOSE_CODE) {
        withoutTokens +=
          text.slice(copiedUpTo, index) + hold(text.charAt(index));
        copiedUpTo = index + 1;
      }
    }

    withoutTokens += text.slice(copiedUpTo);
  }

  const heldTokenCharacters: number = held.length;
  const markdown: string = holdBackSlowMarkdown(
    holdBackOverLongText(withoutTokens, hold),
    { holdLines: holdLines, holdCode: hold },
    VIEWER_SLOW_MARKDOWN_LIMITS,
  );

  if (held.length === heldTokenCharacters) {
    return {
      markdown: text,
      held: [],
      heldLines: [],
      showAsText: text.length > MAX_PARSED_MARKDOWN_LENGTH,
    };
  }

  return {
    markdown: markdown,
    held: held,
    heldLines: heldLines,
    showAsText: markdown.length > MAX_PARSED_MARKDOWN_LENGTH,
  };
};

/*
 * A node of the HTML tree remark-rehype builds (hast): what
 * rehypePutBackHeldText reads of one.
 */
export interface HeldTextTreeNode {
  type: string;
  tagName?: string | undefined;
  value?: unknown;
  properties?: Record<string, unknown> | undefined;
  children?: Array<HeldTextTreeNode> | undefined;
}

/*
 * The nodes a text becomes when it holds a token of whole lines (heldLines):
 * its text with everything held back put back, each stretch of held lines in
 * a span that keeps its line breaks and spaces (white-space: pre-wrap, as the
 * viewer shows a text it does not read as Markdown) - or null when it holds
 * no such token. Two nodes for a stretch, however many lines it has: a node
 * for each line made a log of thousands of lines slow to show.
 */
const getHeldLinesNodes: (
  value: string,
  held: ReadonlyArray<string>,
  heldLines: ReadonlySet<number>,
) => Array<HeldTextTreeNode> | null = (
  value: string,
  held: ReadonlyArray<string>,
  heldLines: ReadonlySet<number>,
): Array<HeldTextTreeNode> | null => {
  const nodes: Array<HeldTextTreeNode> = [];
  let text: string = "";
  let restoredUpTo: number = 0;
  let holdsLines: boolean = false;

  for (
    let open: number = value.indexOf(HELD_OPEN);
    open !== -1;
    open = value.indexOf(HELD_OPEN, restoredUpTo)
  ) {
    const close: number = value.indexOf(HELD_CLOSE, open + 1);

    if (close === -1) {
      break;
    }

    const index: number = Number(value.slice(open + 1, close));
    const heldText: string = held[index] ?? "";

    text += value.slice(restoredUpTo, open);

    if (heldLines.has(index)) {
      holdsLines = true;

      nodes.push(
        { type: "text", value: text },
        {
          type: "element",
          tagName: "span",
          properties: { className: ["whitespace-pre-wrap", "break-words"] },
          children: [
            { type: "text", value: heldText.split("\r\n").join("\n") },
          ],
        },
      );
      text = "";
    } else {
      text += heldText;
    }

    restoredUpTo = close + 1;
  }

  if (!holdsLines) {
    return null;
  }

  nodes.push({ type: "text", value: text + value.slice(restoredUpTo) });

  return nodes.filter((node: HeldTextTreeNode): boolean => {
    return node.type !== "text" || node.value !== "";
  });
};

/*
 * A rehype plugin: every text, and every property (an address, alt text, a
 * title, a class), in the tree with what was held back put back - held
 * lines (heldLines) in a span that keeps their line breaks. Walked with a
 * stack, not recursion: the tree of a long text is deep and wide.
 */
export const rehypePutBackHeldText: (options: {
  held: ReadonlyArray<string>;
  heldLines?: ReadonlyArray<number> | undefined;
}) => (tree: HeldTextTreeNode) => void = (options: {
  held: ReadonlyArray<string>;
  heldLines?: ReadonlyArray<number> | undefined;
}): ((tree: HeldTextTreeNode) => void) => {
  const held: ReadonlyArray<string> = options.held;
  const heldLines: ReadonlySet<number> = new Set<number>(
    options.heldLines || [],
  );

  return (tree: HeldTextTreeNode): void => {
    if (held.length === 0) {
      return;
    }

    const stack: Array<HeldTextTreeNode> = [tree];

    while (stack.length > 0) {
      const node: HeldTextTreeNode = stack.pop()!;

      if (typeof node.value === "string") {
        node.value = putBackHeldText(node.value, held);
      }

      if (node.properties) {
        for (const [name, property] of Object.entries(node.properties)) {
          if (typeof property === "string") {
            node.properties[name] = putBackHeldText(property, held);
          } else if (Array.isArray(property)) {
            node.properties[name] = property.map((item: unknown): unknown => {
              return typeof item === "string"
                ? putBackHeldText(item, held)
                : item;
            });
          }
        }
      }

      if (!node.children) {
        continue;
      }

      const children: Array<HeldTextTreeNode> = [];

      for (const child of node.children) {
        const lineNodes: Array<HeldTextTreeNode> | null =
          heldLines.size > 0 &&
          child.type === "text" &&
          typeof child.value === "string"
            ? getHeldLinesNodes(child.value, held, heldLines)
            : null;

        if (lineNodes === null) {
          children.push(child);
          stack.push(child);
        } else {
          // Already put back: not walked again.
          for (const lineNode of lineNodes) {
            children.push(lineNode);
          }
        }
      }

      node.children = children;
    }
  };
};
