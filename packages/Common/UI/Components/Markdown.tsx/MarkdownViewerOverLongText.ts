import { holdBackBase64Data } from "../../../Utils/Markdown/Base64Data";
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
 * the rendered tree as text: React escapes it. A text of at most 64 KB with
 * no screenshot holds back nothing, and renders exactly as it always has.
 *
 * A synthetic monitor's screenshot is an image whose address carries the
 * image itself, tens of thousands to millions of characters of base64 (see
 * Utils/Markdown/InlineImageDataUri). Its data is held back first, as the
 * emails hold it back (Utils/Markdown/Base64Data): remark has no use for
 * it, and read as Markdown it is one long word of punctuation, which
 * SlowMarkdown below would hold back - the screenshot's paragraph, its
 * other Markdown with it, was shown as text (issue #6010).
 *
 * An address - an image's, a link's, a link reference definition's - is
 * put back together in Markdown's own tree (remarkPutBackHeldUrls), before
 * remark-rehype reads it: remark-rehype writes an address out with every
 * character an address may not hold percent-encoded, a token's among them,
 * and a token left in one was never found again - a screenshot whose line
 * was over-long showed as an empty image. So the viewer's urlTransform
 * judges the address as it was written. remark-rehype copies a link
 * reference definition's address and title into every reference to it, so
 * what definitions carry that way is limited (MAX_HELD_TEXT_IN_REFERENCES).
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
  countAsMarked: false,
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
    holdBackOverLongText(holdBackBase64Data(withoutTokens, hold), hold),
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
 * A node of the Markdown tree remark builds (mdast): what
 * remarkPutBackHeldUrls reads of one.
 */
export interface HeldUrlTreeNode {
  type: string;
  url?: unknown;
  title?: unknown;
  identifier?: unknown;
  children?: Array<HeldUrlTreeNode> | undefined;
}

/*
 * The most held-back text link reference definitions carry to their
 * references, in all. remark-rehype writes a definition's address and title
 * into every reference to it, so what a definition holds counts once for
 * each reference. A screenshot of 3 MB defined once and referenced 200
 * times was 600 MB of addresses, and rendering it failed ("Invalid string
 * length"); a long title copied that way did the same. Within this, a
 * screenshot defined once can be shown a few times. A definition past it
 * carries neither its address nor its title, where they hold held-back
 * text: its references show an image or a link without them, as a blocked
 * address does.
 */
export const MAX_HELD_TEXT_IN_REFERENCES: number = 16 * 1024 * 1024;

// A definition's or reference's identifier, as remark-rehype matches them.
const identifierOf: (node: HeldUrlTreeNode) => string = (
  node: HeldUrlTreeNode,
): string => {
  return String(node.identifier).toUpperCase();
};

/*
 * A remark plugin: the address of every image, link and link reference
 * definition in the tree with what was held back put back, before
 * remark-rehype reads the tree (see the top of this file) - and a
 * definition's title with it, within MAX_HELD_TEXT_IN_REFERENCES. Everything
 * else - text, alt text, an image's or link's own title - is put back by
 * rehypePutBackHeldText. Walked with a stack, not recursion: the tree of a
 * long text is deep and wide.
 */
export const remarkPutBackHeldUrls: (options: {
  held: ReadonlyArray<string>;
}) => (tree: HeldUrlTreeNode) => void = (options: {
  held: ReadonlyArray<string>;
}): ((tree: HeldUrlTreeNode) => void) => {
  const held: ReadonlyArray<string> = options.held;

  return (tree: HeldUrlTreeNode): void => {
    if (held.length === 0) {
      return;
    }

    // In the order of the text: the first definitions are given first.
    const definitions: Array<HeldUrlTreeNode> = [];
    const referenceCounts: Map<string, number> = new Map();
    const stack: Array<HeldUrlTreeNode> = [tree];

    while (stack.length > 0) {
      const node: HeldUrlTreeNode = stack.pop()!;

      if (node.type === "definition") {
        definitions.push(node);
      } else {
        if (node.type === "imageReference" || node.type === "linkReference") {
          const identifier: string = identifierOf(node);

          referenceCounts.set(
            identifier,
            (referenceCounts.get(identifier) ?? 0) + 1,
          );
        }

        // An image's or a link's own: its text holds it once.
        if (typeof node.url === "string") {
          node.url = putBackHeldText(node.url, held);
        }
      }

      if (node.children) {
        for (
          let index: number = node.children.length - 1;
          index >= 0;
          index--
        ) {
          stack.push(node.children[index]!);
        }
      }
    }

    // remark-rehype reads the first definition of an identifier only.
    const used: Set<string> = new Set();
    let carried: number = 0;

    for (const definition of definitions) {
      const identifier: string = identifierOf(definition);
      const references: number = used.has(identifier)
        ? 0
        : referenceCounts.get(identifier) ?? 0;

      used.add(identifier);

      const url: unknown =
        typeof definition.url === "string"
          ? putBackHeldText(definition.url, held)
          : definition.url;
      const title: unknown =
        typeof definition.title === "string"
          ? putBackHeldText(definition.title, held)
          : definition.title;
      const urlHeld: boolean = url !== definition.url;
      const titleHeld: boolean = title !== definition.title;

      if (!urlHeld && !titleHeld) {
        continue;
      }

      const length: number =
        (urlHeld ? (url as string).length : 0) +
        (titleHeld ? (title as string).length : 0);

      if (carried + references * length <= MAX_HELD_TEXT_IN_REFERENCES) {
        carried += references * length;
        definition.url = url;
        definition.title = title;
        continue;
      }

      if (urlHeld) {
        definition.url = "";
      }

      if (titleHeld) {
        definition.title = null;
      }
    }
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
