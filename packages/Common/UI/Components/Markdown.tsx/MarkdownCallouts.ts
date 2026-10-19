/*
 * QUOTES AND CALLOUTS IN RENDERED MARKDOWN.
 *
 * A blockquote is somebody's words: a reply quoted in a note, a quote in a
 * Slack message saved as one (ChatMessageMarkdown writes it as "> "), a line
 * of a log. The viewer drew every one of them as an amber box with an
 * exclamation mark, so a quote read as a warning - in the feed, on the
 * Notes pages, on a status page - while the editor the note was written in
 * showed it as a quote. Now a blockquote is a quote, drawn as the editor
 * draws it, unless it asks to be a callout:
 *
 *   > [!WARNING]           GitHub's alert syntax, as the docs write it: note,
 *   > Do not restart it.   tip, info, important, warning, caution or danger,
 *                          in any case, alone on the quote's first line or
 *                          followed by its text. The marker is not shown.
 *
 *   > **Note:** The ...    The older form the docs read too: one of those
 *                          words, in bold, opening the quote, with or
 *                          without its colon. The label stays as written.
 *
 * Every other blockquote stays a quote, and a marker that names no kind, or
 * is followed by nothing at all, is left as the text it is.
 *
 * This is a remark transform: it marks a callout's blockquote with
 * data-callout (data.hProperties, which only a plugin can set - remark reads
 * no attribute from the Markdown, and the viewer renders no HTML), and the
 * viewer's blockquote renderer reads that mark. It walks the tree once,
 * without recursion, reading at most the first words of each blockquote, so
 * its time grows with the size of the tree, however deeply quotes nest.
 *
 * Pure, with no React: react-markdown and the remark packages are ESM and do
 * not run under Common's jest, so the transform is tested on hand-built
 * trees, and HugeTextInLongRunningProcess runs it with the real parser.
 */

export type MarkdownCalloutKind =
  | "note"
  | "tip"
  | "info"
  | "important"
  | "warning"
  | "caution"
  | "danger";

// The kinds, in the docs' order (MarkdownDocsExtensions.DOCS_CALLOUT_TYPES).
export const MARKDOWN_CALLOUT_KINDS: ReadonlyArray<MarkdownCalloutKind> = [
  "note",
  "tip",
  "info",
  "important",
  "warning",
  "caution",
  "danger",
];

// The hast property a callout's blockquote is marked with...
export const MARKDOWN_CALLOUT_PROPERTY: string = "dataCallout";

// ...and the attribute it reaches the renderer as.
export const MARKDOWN_CALLOUT_ATTRIBUTE: string = "data-callout";

/*
 * A structural view of the mdast nodes the transform reads and writes,
 * declared here for the reason InlineReferences.tsx gives: the @types/mdast
 * Common resolves is not the version react-markdown builds its tree with.
 */
export interface CalloutMarkdownNode {
  type: string;
  value?: string | undefined;
  children?: Array<CalloutMarkdownNode> | undefined;
  data?: CalloutMarkdownNodeData | undefined;
  [field: string]: unknown;
}

export interface CalloutMarkdownNodeData {
  hProperties?: Record<string, unknown> | undefined;
  [field: string]: unknown;
}

// "[!WARNING]" at the very start of the quote's text; the kind is checked below.
const ALERT_MARKER: RegExp = /^\[!([A-Za-z]{1,16})\]/;

// A bold label: "Note:" or "Note", the kind checked below.
const BOLD_LABEL: RegExp = /^([A-Za-z]{1,16}):?$/;

// What may follow a marker on its line: nothing, or white space.
const STARTS_WITH_WHITESPACE: RegExp = /^\s/;

// The nodes a blockquote can be inside of.
const BLOCK_CONTAINER_TYPES: ReadonlySet<string> = new Set<string>([
  "root",
  "blockquote",
  "list",
  "listItem",
  "footnoteDefinition",
]);

// The kind a value names, or null: "WARNING", "warning" and "Warning" alike.
export const getMarkdownCalloutKind: (
  value: unknown,
) => MarkdownCalloutKind | null = (
  value: unknown,
): MarkdownCalloutKind | null => {
  if (typeof value !== "string") {
    return null;
  }

  const lowerCase: string = value.toLowerCase();

  return (
    MARKDOWN_CALLOUT_KINDS.find((kind: MarkdownCalloutKind): boolean => {
      return kind === lowerCase;
    }) || null
  );
};

/*
 * The kind a bold label opening a quote names - "Note:" or "Note" - or null.
 * MarkdownPaste reads a copied callout's label with it too.
 */
export const getMarkdownCalloutKindOfLabel: (
  label: string,
) => MarkdownCalloutKind | null = (
  label: string,
): MarkdownCalloutKind | null => {
  const match: RegExpExecArray | null = BOLD_LABEL.exec(label);

  return match ? getMarkdownCalloutKind(match[1]) : null;
};

const markAsCallout: (
  blockquote: CalloutMarkdownNode,
  kind: MarkdownCalloutKind,
) => void = (
  blockquote: CalloutMarkdownNode,
  kind: MarkdownCalloutKind,
): void => {
  const data: CalloutMarkdownNodeData = blockquote.data || {};

  blockquote.data = {
    ...data,
    hProperties: {
      ...(data.hProperties || {}),
      [MARKDOWN_CALLOUT_PROPERTY]: kind,
    },
  };
};

/*
 * "> [!WARNING]" opening the quote: the kind, with the marker taken out of
 * the text. Nothing is changed when the marker names no kind, runs into the
 * next word ("[!NOTE]text"), or is all the quote holds.
 */
const readAlertMarker: (
  blockquote: CalloutMarkdownNode,
  paragraph: CalloutMarkdownNode,
) => MarkdownCalloutKind | null = (
  blockquote: CalloutMarkdownNode,
  paragraph: CalloutMarkdownNode,
): MarkdownCalloutKind | null => {
  const inlines: Array<CalloutMarkdownNode> = paragraph.children || [];
  const first: CalloutMarkdownNode | undefined = inlines[0];

  if (!first || first.type !== "text" || typeof first.value !== "string") {
    return null;
  }

  const match: RegExpExecArray | null = ALERT_MARKER.exec(first.value);

  if (!match) {
    return null;
  }

  const kind: MarkdownCalloutKind | null = getMarkdownCalloutKind(match[1]);
  const after: string = first.value.slice(match[0].length);

  if (!kind || (after !== "" && !STARTS_WITH_WHITESPACE.test(after))) {
    return null;
  }

  const rest: string = after.trimStart();
  let remainingInlines: Array<CalloutMarkdownNode> = inlines.slice(1);

  // A hard break after the marker ("[!NOTE]\" or two spaces) ends its line.
  if (rest === "" && remainingInlines[0]?.type === "break") {
    remainingInlines = remainingInlines.slice(1);
  }

  const blocks: Array<CalloutMarkdownNode> = blockquote.children || [];
  const isAllTheQuoteHolds: boolean =
    rest === "" && remainingInlines.length === 0 && blocks.length === 1;

  if (isAllTheQuoteHolds) {
    return null;
  }

  if (rest !== "") {
    first.value = rest;
    paragraph.children = [first, ...remainingInlines];
  } else if (remainingInlines.length > 0) {
    paragraph.children = remainingInlines;
  } else {
    // The marker had a line of its own: its paragraph goes with it.
    blockquote.children = blocks.filter(
      (block: CalloutMarkdownNode): boolean => {
        return block !== paragraph;
      },
    );
  }

  return kind;
};

// "> **Note:** ..." opening the quote: the kind. The label stays as written.
const readBoldLabel: (
  paragraph: CalloutMarkdownNode,
) => MarkdownCalloutKind | null = (
  paragraph: CalloutMarkdownNode,
): MarkdownCalloutKind | null => {
  const first: CalloutMarkdownNode | undefined = (paragraph.children || [])[0];

  if (!first || first.type !== "strong") {
    return null;
  }

  const label: Array<CalloutMarkdownNode> = first.children || [];
  const text: CalloutMarkdownNode | undefined = label[0];

  if (
    label.length !== 1 ||
    !text ||
    text.type !== "text" ||
    typeof text.value !== "string"
  ) {
    return null;
  }

  return getMarkdownCalloutKindOfLabel(text.value);
};

/*
 * The kind of callout a blockquote asks to be, marked on it, or null for a
 * quote. Reads only the start of its first paragraph.
 */
export const markMarkdownCallout: (
  blockquote: CalloutMarkdownNode,
) => MarkdownCalloutKind | null = (
  blockquote: CalloutMarkdownNode,
): MarkdownCalloutKind | null => {
  // Marked already: its marker is gone, and what now opens it is its text.
  const marked: MarkdownCalloutKind | null = getMarkdownCalloutKind(
    blockquote.data?.hProperties?.[MARKDOWN_CALLOUT_PROPERTY],
  );

  if (marked) {
    return marked;
  }

  const paragraph: CalloutMarkdownNode | undefined = (blockquote.children ||
    [])[0];

  if (!paragraph || paragraph.type !== "paragraph") {
    return null;
  }

  const kind: MarkdownCalloutKind | null =
    readAlertMarker(blockquote, paragraph) || readBoldLabel(paragraph);

  if (kind) {
    markAsCallout(blockquote, kind);
  }

  return kind;
};

/*
 * The transform behind the remark plugin, exported so it can be tested on
 * hand-built mdast. Mutates `tree` in place.
 */
export const applyMarkdownCallouts: (tree: CalloutMarkdownNode) => void = (
  tree: CalloutMarkdownNode,
): void => {
  if (!tree || typeof tree !== "object") {
    return;
  }

  const pending: Array<CalloutMarkdownNode> = [tree];

  while (pending.length > 0) {
    const node: CalloutMarkdownNode | undefined = pending.pop();

    if (!node) {
      continue;
    }

    if (node.type === "blockquote") {
      markMarkdownCallout(node);
    }

    for (const child of node.children || []) {
      if (child && BLOCK_CONTAINER_TYPES.has(child.type)) {
        pending.push(child);
      }
    }
  }
};

// remark plugin: `remarkPlugins={[remarkGfm, remarkMarkdownCallouts]}`.
export function remarkMarkdownCallouts(): (tree: CalloutMarkdownNode) => void {
  return (tree: CalloutMarkdownNode): void => {
    applyMarkdownCallouts(tree);
  };
}
