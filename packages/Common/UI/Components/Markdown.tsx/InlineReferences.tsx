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
 *     text cannot author one of these elements. A reference - or a run of
 *     citations written one right after another - and the punctuation
 *     right after it go into a group of our own that only keeps them on
 *     one line (REFERENCE_GROUP_NODE_TYPE): it holds those references and
 *     those marks, nothing else.
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
/*
 * A reference - or a run of citations - and the punctuation written right
 * after it, kept on one line (REFERENCE_GROUP_NODE_TYPE).
 */
export const REFERENCE_GROUP_TAG_NAME: string = "oneuptime-ref-group";

export const CITATION_REFERENCE_NODE_TYPE: string =
  "oneuptimeCitationReference";
export const EVENT_REFERENCE_NODE_TYPE: string = "oneuptimeEventReference";
/*
 * A chip or a record's pill is drawn as a box of its own (an inline-flex
 * button or link), and a browser may break the line right after such a box
 * even where the text goes on with a full stop: on a phone a sentence ending
 * "... not users [C7]." left its "." alone at the start of the next line,
 * and "#305," its comma. So a reference and the punctuation that follows it
 * with no space between - "[C7].", "#305,", "[C2]).", "[C4]،" - go into one
 * node that is drawn as a span that never wraps inside
 * (MarkdownReferenceGroupElement). A browser breaks a line between two
 * chips as readily, so citations written one right after another -
 * "[C2][C3][C6]." - go into one group too, with the marks after the last:
 * on a phone the run read "C2" at the end of one line and "C3 C6." at the
 * start of the next. A reference followed by a space, a letter or nothing,
 * on its own, stays as it was.
 */
export const REFERENCE_GROUP_NODE_TYPE: string = "oneuptimeReferenceGroup";

/*
 * How many punctuation marks right after a reference are kept with it:
 * enough for a closing bracket or quote and a full stop (").", "”.") or an
 * ellipsis, few enough that a run of marks never makes a long line that
 * cannot wrap.
 */
export const MAX_PUNCTUATION_KEPT_WITH_REFERENCE: number = 4;

/*
 * How many citations written one right after another stay on one line
 * together: more than the runs an answer writes ("[C2][C3][C6]"), few
 * enough that a run of chips is never wider than a phone's line. A longer
 * run is kept together this many at a time. Record pills are written apart
 * ("#1017, #1029") and are wider: each keeps only its own marks.
 */
export const MAX_CITATIONS_KEPT_TOGETHER: number = 5;

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
 * The punctuation a reference keeps with it: marks of any script (Unicode's
 * punctuation categories - the Latin "." and ",", the Persian "،" and "؟",
 * the Japanese "。" and "、", the Hindi "।", closing brackets and quotes),
 * at most MAX_PUNCTUATION_KEPT_WITH_REFERENCE of them, from the reference's
 * end. Anchored and bounded, so it reads a few characters whatever follows.
 */
const PUNCTUATION_AFTER_REFERENCE_REGEX: RegExp = /^\p{P}{1,4}/u;

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
  REFERENCE_GROUP_NODE_TYPE,
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
 * A reference - or a run of citations - and the punctuation right after
 * it, drawn on one line (REFERENCE_GROUP_NODE_TYPE). It holds nothing but
 * the reference nodes and the marks' text, when there are marks.
 */
function createReferenceGroupNode(
  references: Array<InlineReferenceMarkdownNode>,
  punctuation: string,
): InlineReferenceMarkdownNode {
  return {
    type: REFERENCE_GROUP_NODE_TYPE,
    data: {
      hName: REFERENCE_GROUP_TAG_NAME,
    },
    children: punctuation
      ? [...references, createTextNode(punctuation)]
      : [...references],
  };
}

function isCitationMatch(match: InlineReferenceMatch | undefined): boolean {
  return match?.node.type === CITATION_REFERENCE_NODE_TYPE;
}

/*
 * The citations from `kept[index]` on that are written one right after
 * another - nothing between them - up to MAX_CITATIONS_KEPT_TOGETHER: the
 * run that stays on one line. A record's pill is a run of its own.
 */
function readCitationRun(
  kept: Array<InlineReferenceMatch>,
  index: number,
): Array<InlineReferenceMatch> {
  const run: Array<InlineReferenceMatch> = [kept[index]!];

  if (!isCitationMatch(kept[index])) {
    return run;
  }

  while (run.length < MAX_CITATIONS_KEPT_TOGETHER) {
    const next: InlineReferenceMatch | undefined = kept[index + run.length];

    if (!isCitationMatch(next) || next!.start !== run[run.length - 1]!.end) {
      break;
    }

    run.push(next!);
  }

  return run;
}

/*
 * The punctuation a reference ending at `start` keeps with it: the marks
 * written right there, up to `limit` (where the next reference starts) -
 * "" when a space, a letter or nothing follows.
 */
function readPunctuationAfterReference(
  value: string,
  start: number,
  limit: number,
): string {
  if (start >= limit) {
    return "";
  }

  /*
   * A mark is at most two UTF-16 units, so twice the bound is all the
   * pattern can ever read.
   */
  const following: string = value.slice(
    start,
    Math.min(limit, start + MAX_PUNCTUATION_KEPT_WITH_REFERENCE * 2),
  );
  const match: RegExpExecArray | null =
    PUNCTUATION_AFTER_REFERENCE_REGEX.exec(following);

  return match ? match[0] : "";
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

  // Overlapping tokens cannot happen with today's patterns; keep the first.
  const kept: Array<InlineReferenceMatch> = [];

  for (const match of matches) {
    const previous: InlineReferenceMatch | undefined = kept[kept.length - 1];

    if (!previous || match.start >= previous.end) {
      kept.push(match);
    }
  }

  const result: Array<InlineReferenceMarkdownNode> = [];
  let cursor: number = 0;
  let index: number = 0;

  while (index < kept.length) {
    const match: InlineReferenceMatch = kept[index]!;

    if (match.start > cursor) {
      result.push(createTextNode(value.slice(cursor, match.start)));
    }

    // The citations written right after it stay with it ("[C2][C3][C6]").
    const run: Array<InlineReferenceMatch> = readCitationRun(kept, index);
    const last: InlineReferenceMatch = run[run.length - 1]!;

    index += run.length;

    /*
     * The punctuation written right after the run goes with it, up to the
     * next reference ("[C4].[C5]" keeps the "." with C4 alone).
     */
    const punctuation: string = readPunctuationAfterReference(
      value,
      last.end,
      kept[index]?.start ?? value.length,
    );

    if (run.length > 1 || punctuation) {
      result.push(
        createReferenceGroupNode(
          run.map(
            (reference: InlineReferenceMatch): InlineReferenceMarkdownNode => {
              return reference.node;
            },
          ),
          punctuation,
        ),
      );
      cursor = last.end + punctuation.length;
      continue;
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
 * A reference - or a run of citations - and the punctuation right after it,
 * on one line: the browser may break the line after a chip's or a pill's
 * box, and a full stop then started the next line alone, or a run of
 * sources was split between two lines. Nothing inside it wraps, and it
 * holds a few characters only (MAX_PUNCTUATION_KEPT_WITH_REFERENCE marks
 * and one pill, or at most MAX_CITATIONS_KEPT_TOGETHER citation chips), so
 * it never makes a line too long to fit.
 */
export interface MarkdownReferenceGroupElementProps {
  children?: ReactNode | undefined;
}

export const MarkdownReferenceGroupElement: FunctionComponent<
  MarkdownReferenceGroupElementProps
> = (props: MarkdownReferenceGroupElementProps): ReactElement => {
  return (
    <span className="whitespace-nowrap" data-testid="markdown-reference-group">
      {props.children}
    </span>
  );
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
  [REFERENCE_GROUP_TAG_NAME]: MarkdownReferenceGroupElement,
};
