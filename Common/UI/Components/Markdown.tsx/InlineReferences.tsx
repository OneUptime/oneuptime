import React, {
  Context,
  FunctionComponent,
  ReactElement,
  ReactNode,
  createContext,
  useContext,
} from "react";
import {
  InvestigationEventReferenceToken,
  getCitationMarkerRegex,
  tokenizeEventReferences,
} from "../../../Utils/AI/InvestigationReport";

/*
 * Inline references inside rendered markdown: citation markers ("[C12]") and
 * incident / alert numbers ("#6954").
 *
 * react-markdown v9 has no text renderer — hast text nodes become plain
 * strings and `components` only maps element tag names — so the supported way
 * to turn a pattern inside prose into a React element is a remark plugin that
 * splits mdast `text` nodes into custom nodes carrying `data.hName`, plus a
 * `components` entry for that tag name.
 *
 * This is used for AI-authored (prompt-injectable) markdown rendered in
 * safeMode, so the plugin holds three lines:
 *
 *   - It only ever captures regex-validated tokens (`C\d{1,3}`, `\d{1,9}`) and
 *     never creates `link` or `image` nodes. The custom tag names are ours;
 *     remark-parse never sets `hName` and raw HTML renders as text, so model
 *     text cannot author one of these elements.
 *   - It never splits text inside links, link references, code or HTML, so no
 *     interactive element ever nests inside a neutralized link.
 *   - A model can turn "[C12]" into a link reference by also writing a
 *     "[C12]: https://..." definition. Those references are reverted to text
 *     and the definitions dropped, so a citation can never become a link.
 *
 * The React side never trusts the markdown for anything but the token: the
 * caller's renderers look the token up in data resolved from the database and
 * build any link themselves.
 */

export const CITATION_REFERENCE_TAG_NAME: string = "oneuptime-citation-ref";
export const EVENT_REFERENCE_TAG_NAME: string = "oneuptime-event-ref";

export const CITATION_REFERENCE_NODE_TYPE: string =
  "oneuptimeCitationReference";
export const EVENT_REFERENCE_NODE_TYPE: string = "oneuptimeEventReference";

export type MarkdownEventReferenceKind = "incident" | "alert";

export interface MarkdownEventReference {
  // null when the text had no "incident"/"alert" qualifier; the caller decides.
  kind: MarkdownEventReferenceKind | null;
  number: number;
  // The reference as written, e.g. "#6954".
  text: string;
}

export interface MarkdownInlineReferenceRenderers {
  // Return null to leave the marker as plain text "[C1]".
  renderCitation?: ((citationId: string) => ReactElement | null) | undefined;
  // Return null to leave the reference as plain text "#6954".
  renderEventReference?:
    | ((reference: MarkdownEventReference) => ReactElement | null)
    | undefined;
}

export interface InlineReferenceTransformOptions {
  citations: boolean;
  eventReferences: boolean;
}

/*
 * A structural view of the mdast nodes the transform reads and writes.
 * Declared locally rather than imported from @types/mdast for the same reason
 * as MarkdownSafety.ts: the version hoisted into Common/node_modules is v3
 * while the unified 11 tree react-markdown builds is v4. The index signature
 * keeps every other mdast field (url, depth, lang...) assignable.
 */
export interface InlineReferenceMarkdownNode {
  type: string;
  value?: string | undefined;
  identifier?: string | undefined;
  label?: string | null | undefined;
  referenceType?: string | undefined;
  alt?: string | null | undefined;
  data?: InlineReferenceNodeData | undefined;
  position?: InlineReferenceNodePosition | undefined;
  children?: Array<InlineReferenceMarkdownNode> | undefined;
  [field: string]: unknown;
}

export interface InlineReferenceNodeData {
  hName?: string | undefined;
  hProperties?: Record<string, string> | undefined;
  [field: string]: unknown;
}

export interface InlineReferenceNodePosition {
  start?: unknown;
  end?: unknown;
}

// "c12" is how mdast normalises the identifier of a "[C12]" link reference.
const CITATION_IDENTIFIER_REGEX: RegExp = /^c\d{1,3}$/i;
const CITATION_ID_REGEX: RegExp = /^C\d{1,3}$/;
const EVENT_NUMBER_REGEX: RegExp = /^\d{1,9}$/;

/*
 * Subtrees whose text must never be split: link text (the safeMode renderer
 * already neutralizes it, and an element nested inside would be an interactive
 * control inside a link), code and HTML (literal content; these have no text
 * children anyway), and our own reference nodes (keeps the transform
 * idempotent).
 */
const OPAQUE_NODE_TYPES: Set<string> = new Set<string>([
  "link",
  "linkReference",
  "image",
  "imageReference",
  "definition",
  "inlineCode",
  "code",
  "html",
  CITATION_REFERENCE_NODE_TYPE,
  EVENT_REFERENCE_NODE_TYPE,
]);

function isCitationIdentifier(identifier: string | undefined): boolean {
  return typeof identifier === "string"
    ? CITATION_IDENTIFIER_REGEX.test(identifier)
    : false;
}

function createTextNode(value: string): InlineReferenceMarkdownNode {
  return { type: "text", value: value };
}

function createCitationNode(
  citationId: string,
  text: string,
): InlineReferenceMarkdownNode {
  return {
    type: CITATION_REFERENCE_NODE_TYPE,
    data: {
      hName: CITATION_REFERENCE_TAG_NAME,
      hProperties: { dataCitationId: citationId },
    },
    children: [createTextNode(text)],
  };
}

function createEventReferenceNode(
  kind: MarkdownEventReferenceKind | null,
  referenceNumber: number,
  text: string,
): InlineReferenceMarkdownNode {
  return {
    type: EVENT_REFERENCE_NODE_TYPE,
    data: {
      hName: EVENT_REFERENCE_TAG_NAME,
      hProperties: {
        dataRefKind: kind ?? "",
        dataRefNumber: referenceNumber.toString(),
      },
    },
    children: [createTextNode(text)],
  };
}

/*
 * Turns a citation link/image reference back into the text it was written
 * as. Mirrors mdast-util-to-hast's own revert() for references without a
 * definition, so the result reads exactly as if the definition had never
 * existed.
 */
function revertReference(
  node: InlineReferenceMarkdownNode,
): Array<InlineReferenceMarkdownNode> {
  let suffix: string = "]";

  if (node.referenceType === "collapsed") {
    suffix += "[]";
  } else if (node.referenceType === "full") {
    suffix += `[${node.label || node.identifier || ""}]`;
  }

  if (node.type === "imageReference") {
    return [
      withPosition(
        createTextNode(`![${node.alt || ""}${suffix}`),
        node.position?.start,
        node.position?.end,
      ),
    ];
  }

  const contents: Array<InlineReferenceMarkdownNode> = [
    ...(node.children || []),
  ];

  /*
   * The brackets widen the head and tail text to the reference's own source
   * range, so a merged run still reports where it came from.
   */
  const head: InlineReferenceMarkdownNode | undefined = contents[0];
  if (head && head.type === "text") {
    contents[0] = withPosition(
      createTextNode(`[${head.value || ""}`),
      node.position?.start,
      head.position?.end,
    );
  } else {
    contents.unshift(createTextNode("["));
  }

  const tailIndex: number = contents.length - 1;
  const tail: InlineReferenceMarkdownNode | undefined = contents[tailIndex];
  if (tail && tail.type === "text") {
    contents[tailIndex] = withPosition(
      createTextNode(`${tail.value || ""}${suffix}`),
      tailIndex === 0 ? node.position?.start : tail.position?.start,
      node.position?.end,
    );
  } else {
    contents.push(createTextNode(suffix));
  }

  return contents;
}

function withPosition(
  node: InlineReferenceMarkdownNode,
  start: unknown,
  end: unknown,
): InlineReferenceMarkdownNode {
  if (start && end) {
    node.position = { start: start, end: end };
  }
  return node;
}

/*
 * A reverted reference leaves its brackets as separate text nodes next to the
 * surrounding prose; merge them so a marker such as "[C12]" is one text run
 * again before it is split.
 */
function mergeTextRun(
  run: Array<InlineReferenceMarkdownNode>,
): InlineReferenceMarkdownNode {
  const first: InlineReferenceMarkdownNode | undefined = run[0];
  const last: InlineReferenceMarkdownNode | undefined = run[run.length - 1];

  if (!first || !last || run.length === 1) {
    return first || createTextNode("");
  }

  const merged: InlineReferenceMarkdownNode = createTextNode(
    run
      .map((node: InlineReferenceMarkdownNode): string => {
        return node.value || "";
      })
      .join(""),
  );

  // The run spans from the first node's start to the last node's end.
  return withPosition(merged, first.position?.start, last.position?.end);
}

function mergeAdjacentTextNodes(
  nodes: Array<InlineReferenceMarkdownNode>,
): Array<InlineReferenceMarkdownNode> {
  const merged: Array<InlineReferenceMarkdownNode> = [];
  let run: Array<InlineReferenceMarkdownNode> = [];

  for (const node of nodes) {
    if (node.type === "text") {
      run.push(node);
      continue;
    }

    if (run.length > 0) {
      merged.push(mergeTextRun(run));
      run = [];
    }

    merged.push(node);
  }

  if (run.length > 0) {
    merged.push(mergeTextRun(run));
  }

  return merged;
}

interface InlineReferenceMatch {
  start: number;
  end: number;
  node: InlineReferenceMarkdownNode;
}

function findCitationMatches(value: string): Array<InlineReferenceMatch> {
  const matches: Array<InlineReferenceMatch> = [];
  const regex: RegExp = getCitationMarkerRegex();
  let match: RegExpExecArray | null = regex.exec(value);

  while (match) {
    const citationId: string | undefined = match[1];

    if (citationId && CITATION_ID_REGEX.test(citationId)) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        node: createCitationNode(citationId, match[0]),
      });
    }

    // A zero-width match would never advance a global regex.
    if (match[0].length === 0) {
      regex.lastIndex += 1;
    }

    match = regex.exec(value);
  }

  return matches;
}

function findEventReferenceMatches(value: string): Array<InlineReferenceMatch> {
  const matches: Array<InlineReferenceMatch> = [];

  for (const token of tokenizeEventReferences(value)) {
    const text: string = value.slice(token.start, token.end);
    const digits: string = text.slice(1);

    /*
     * Re-validate the token against the text it claims to cover, so the
     * rendered node can only ever carry "#" plus the digits it shows.
     */
    if (
      token.start < 0 ||
      token.end > value.length ||
      text.charAt(0) !== "#" ||
      !EVENT_NUMBER_REGEX.test(digits) ||
      parseInt(digits, 10) !== token.number
    ) {
      continue;
    }

    matches.push({
      start: token.start,
      end: token.end,
      node: createEventReferenceNode(getTokenKind(token), token.number, text),
    });
  }

  return matches;
}

function getTokenKind(
  token: InvestigationEventReferenceToken,
): MarkdownEventReferenceKind | null {
  return token.kind === "incident" || token.kind === "alert"
    ? token.kind
    : null;
}

function splitTextNode(
  node: InlineReferenceMarkdownNode,
  options: InlineReferenceTransformOptions,
): Array<InlineReferenceMarkdownNode> {
  const value: string = node.value || "";

  if (!value) {
    return [node];
  }

  const matches: Array<InlineReferenceMatch> = [
    ...(options.citations ? findCitationMatches(value) : []),
    ...(options.eventReferences ? findEventReferenceMatches(value) : []),
  ].sort((a: InlineReferenceMatch, b: InlineReferenceMatch): number => {
    return a.start - b.start;
  });

  if (matches.length === 0) {
    return [node];
  }

  const result: Array<InlineReferenceMarkdownNode> = [];
  let cursor: number = 0;

  for (const match of matches) {
    // Overlapping tokens cannot happen with today's patterns; keep the first.
    if (match.start < cursor) {
      continue;
    }

    if (match.start > cursor) {
      result.push(createTextNode(value.slice(cursor, match.start)));
    }

    result.push(match.node);
    cursor = match.end;
  }

  if (cursor < value.length) {
    result.push(createTextNode(value.slice(cursor)));
  }

  return result;
}

function transformChildren(
  parent: InlineReferenceMarkdownNode,
  options: InlineReferenceTransformOptions,
): void {
  if (!Array.isArray(parent.children)) {
    return;
  }

  let children: Array<InlineReferenceMarkdownNode> = parent.children;

  if (options.citations) {
    let didRevert: boolean = false;
    const withoutCitationLinks: Array<InlineReferenceMarkdownNode> = [];
    /*
     * A work stack rather than a single pass: the children a revert hoists
     * into this parent are examined too, so a citation reference can never
     * survive by being nested inside another one. Each revert removes a
     * node, so this always terminates.
     */
    const pending: Array<InlineReferenceMarkdownNode> = [...children].reverse();

    while (pending.length > 0) {
      const child: InlineReferenceMarkdownNode | undefined = pending.pop();

      if (!child) {
        break;
      }

      if (
        child.type === "definition" &&
        isCitationIdentifier(child.identifier)
      ) {
        continue;
      }

      if (
        (child.type === "linkReference" || child.type === "imageReference") &&
        isCitationIdentifier(child.identifier)
      ) {
        pending.push(...revertReference(child).reverse());
        didRevert = true;
        continue;
      }

      withoutCitationLinks.push(child);
    }

    children = didRevert
      ? mergeAdjacentTextNodes(withoutCitationLinks)
      : withoutCitationLinks;
  }

  const result: Array<InlineReferenceMarkdownNode> = [];

  for (const child of children) {
    if (child.type === "text") {
      result.push(...splitTextNode(child, options));
      continue;
    }

    if (!OPAQUE_NODE_TYPES.has(child.type)) {
      transformChildren(child, options);
    }

    result.push(child);
  }

  parent.children = result;
}

/*
 * The pure transform behind the remark plugin, exported so it can be tested
 * on hand-built mdast (react-markdown and the remark packages are ESM and
 * cannot run under Common's jest). Mutates `tree` in place.
 */
export function applyInlineReferences(
  tree: InlineReferenceMarkdownNode,
  options: InlineReferenceTransformOptions,
): void {
  if (!tree || typeof tree !== "object") {
    return;
  }

  if (!options.citations && !options.eventReferences) {
    return;
  }

  transformChildren(tree, options);
}

// remark plugin: `remarkPlugins={[remarkGfm, [remarkInlineReferences, options]]}`.
export function remarkInlineReferences(
  options?: Partial<InlineReferenceTransformOptions> | undefined,
): (tree: InlineReferenceMarkdownNode) => void {
  const resolvedOptions: InlineReferenceTransformOptions = {
    citations: options?.citations !== false,
    eventReferences: options?.eventReferences !== false,
  };

  return (tree: InlineReferenceMarkdownNode): void => {
    applyInlineReferences(tree, resolvedOptions);
  };
}

/*
 * Renderer callbacks reach the elements through context rather than through
 * the `components` map: MarkdownViewer re-renders on every parent render
 * (InvestigationPanel polls), and element components with a new identity each
 * time would remount every chip. The components below are module-scope, so
 * only the context value changes.
 */
export const MarkdownInlineReferenceContext: Context<MarkdownInlineReferenceRenderers | null> =
  createContext<MarkdownInlineReferenceRenderers | null>(null);

export interface MarkdownInlineReferenceElementProps {
  children?: ReactNode | undefined;
  "data-citation-id"?: string | undefined;
  "data-ref-kind"?: string | undefined;
  "data-ref-number"?: string | number | undefined;
}

function getTextFromChildren(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }

  if (Array.isArray(children)) {
    return children
      .map((child: ReactNode): string => {
        return getTextFromChildren(child);
      })
      .join("");
  }

  return "";
}

function renderPlainText(
  children: ReactNode,
  fallbackText: string,
): ReactElement {
  return (
    <>{children === undefined || children === null ? fallbackText : children}</>
  );
}

export const MarkdownCitationReferenceElement: FunctionComponent<
  MarkdownInlineReferenceElementProps
> = (props: MarkdownInlineReferenceElementProps): ReactElement => {
  const renderers: MarkdownInlineReferenceRenderers | null = useContext(
    MarkdownInlineReferenceContext,
  );
  const rawCitationId: string = String(props["data-citation-id"] ?? "");
  const citationId: string | null = CITATION_ID_REGEX.test(rawCitationId)
    ? rawCitationId
    : null;

  if (citationId && renderers?.renderCitation) {
    const rendered: ReactElement | null | undefined =
      renderers.renderCitation(citationId);

    if (rendered) {
      return rendered;
    }
  }

  return renderPlainText(props.children, citationId ? `[${citationId}]` : "");
};

export const MarkdownEventReferenceElement: FunctionComponent<
  MarkdownInlineReferenceElementProps
> = (props: MarkdownInlineReferenceElementProps): ReactElement => {
  const renderers: MarkdownInlineReferenceRenderers | null = useContext(
    MarkdownInlineReferenceContext,
  );
  const rawNumber: string = String(props["data-ref-number"] ?? "");
  const referenceNumber: number | null = EVENT_NUMBER_REGEX.test(rawNumber)
    ? parseInt(rawNumber, 10)
    : null;
  const rawKind: string | undefined = props["data-ref-kind"];
  const kind: MarkdownEventReferenceKind | null =
    rawKind === "incident" || rawKind === "alert" ? rawKind : null;
  const fallbackText: string =
    referenceNumber === null ? "" : `#${referenceNumber}`;

  if (referenceNumber !== null && renderers?.renderEventReference) {
    const text: string = getTextFromChildren(props.children) || fallbackText;
    const rendered: ReactElement | null | undefined =
      renderers.renderEventReference({
        kind: kind,
        number: referenceNumber,
        text: text,
      });

    if (rendered) {
      return rendered;
    }
  }

  return renderPlainText(props.children, fallbackText);
};

/*
 * Registered in MarkdownViewer's `components` only when the caller passes
 * `inlineReferences`. Keyed by custom tag name, which react-markdown's
 * `Components` type does not allow, hence the cast at the call site.
 */
export const MARKDOWN_INLINE_REFERENCE_COMPONENTS: Record<
  string,
  FunctionComponent<MarkdownInlineReferenceElementProps>
> = {
  [CITATION_REFERENCE_TAG_NAME]: MarkdownCitationReferenceElement,
  [EVENT_REFERENCE_TAG_NAME]: MarkdownEventReferenceElement,
};
