import {
  OVER_LONG_LINE_LENGTH,
  holdBackOverLongText,
  mayHoldBack,
} from "../../../Utils/Markdown/OverLongText";

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
 * What is left after that can still be more than remark reads in good time:
 * its time grows with the square of a long table, list or paragraph whose
 * lines are not plain (a log whose every line holds a "|", a "<" or a "`")
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

export interface HeldBackViewerText {
  // The Markdown react-markdown reads.
  markdown: string;
  // What was held back, by index: empty when nothing was.
  held: Array<string>;
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
  if (typeof text !== "string" || !mayHoldBack(text)) {
    return { markdown: text, held: [], showAsText: false };
  }

  const held: Array<string> = [];

  const hold: (value: string) => string = (value: string): string => {
    held.push(putBackHeldText(value, held));

    return `${HELD_OPEN}${held.length - 1}${HELD_CLOSE}`;
  };

  // Token characters already in the text are held back as they are.
  let withoutTokens: string = "";
  let copiedUpTo: number = 0;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code === HELD_OPEN_CODE || code === HELD_CLOSE_CODE) {
      withoutTokens += text.slice(copiedUpTo, index) + hold(text.charAt(index));
      copiedUpTo = index + 1;
    }
  }

  withoutTokens += text.slice(copiedUpTo);

  const heldTokenCharacters: number = held.length;
  const markdown: string = holdBackOverLongText(withoutTokens, hold);

  if (held.length === heldTokenCharacters) {
    return {
      markdown: text,
      held: [],
      showAsText: text.length > MAX_PARSED_MARKDOWN_LENGTH,
    };
  }

  return {
    markdown: markdown,
    held: held,
    showAsText: markdown.length > MAX_PARSED_MARKDOWN_LENGTH,
  };
};

/*
 * A node of the HTML tree remark-rehype builds (hast): what
 * rehypePutBackHeldText reads of one.
 */
export interface HeldTextTreeNode {
  type: string;
  value?: unknown;
  properties?: Record<string, unknown> | undefined;
  children?: Array<HeldTextTreeNode> | undefined;
}

/*
 * A rehype plugin: every text, and every property (an address, alt text, a
 * title, a class), in the tree with what was held back put back. Walked
 * with a stack, not recursion: the tree of a long text is deep and wide.
 */
export const rehypePutBackHeldText: (options: {
  held: ReadonlyArray<string>;
}) => (tree: HeldTextTreeNode) => void = (options: {
  held: ReadonlyArray<string>;
}): ((tree: HeldTextTreeNode) => void) => {
  const held: ReadonlyArray<string> = options.held;

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

      for (const child of node.children || []) {
        stack.push(child);
      }
    }
  };
};
