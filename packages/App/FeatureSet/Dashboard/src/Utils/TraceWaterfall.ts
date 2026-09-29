import Span, { SpanKind, SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { SpanData } from "Common/Utils/Traces/CriticalPath";

/*
 * The data model behind the trace detail page's waterfall: the span tree,
 * which rows are visible, the time axis, zoom and keyboard navigation. Kept
 * free of React so every rule the waterfall draws by is unit tested.
 */

export interface WaterfallSpan {
  spanId: string;
  // "" when the span is a root. May point at a span that was never received.
  parentSpanId: string;
  name: string;
  // The span's primary entity (usually a Service); "" when unattributed.
  serviceId: string;
  startTimeUnixNano: number;
  endTimeUnixNano: number;
  durationUnixNano: number;
  isError: boolean;
  kind: SpanKind | undefined;
}

export interface WaterfallNode {
  span: WaterfallSpan;
  children: Array<WaterfallNode>;
  depth: number;
  /*
   * True when the span names a parent that is not in the loaded spans (the
   * parent was dropped, sampled out, or is in a batch not loaded yet), or when
   * the span was lifted out of a parent cycle.
   */
  isOrphan: boolean;
  descendantCount: number;
}

export interface SpanTree {
  roots: Array<WaterfallNode>;
  nodesById: Map<string, WaterfallNode>;
  // Parent of each span in the tree (roots are absent).
  parentById: Map<string, string>;
  spanCount: number;
  maxDepth: number;
  startTimeUnixNano: number;
  endTimeUnixNano: number;
  durationUnixNano: number;
}

export type SpanVisibility = "match" | "context";

export interface WaterfallRow {
  node: WaterfallNode;
  depth: number;
  hasChildren: boolean;
  isCollapsed: boolean;
  // Children that pass the active filter (all children when none is active).
  visibleChildCount: number;
  // Shown only because a descendant matched the active filter.
  isContext: boolean;
}

export interface TimeViewport {
  // Fractions of the trace duration, 0 <= start < end <= 1.
  start: number;
  end: number;
}

export const FULL_VIEWPORT: TimeViewport = { start: 0, end: 1 };

// A zoom narrower than this fraction of the trace is not useful to draw.
export const MIN_VIEWPORT_WIDTH: number = 0.002;

const MISSING_SPAN_ID_PREFIX: string = "__missing_span_";

function toFiniteNumber(value: unknown): number {
  const numberValue: number = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

/**
 * Normalize the explorer's light Span rows into the fields the waterfall
 * needs. A span with no id still renders (under a synthetic id) instead of
 * silently disappearing, and an end before the start is clamped.
 */
export function toWaterfallSpans(spans: Array<Span>): Array<WaterfallSpan> {
  return spans.map((span: Span, index: number): WaterfallSpan => {
    const startTimeUnixNano: number = toFiniteNumber(span.startTimeUnixNano);
    const durationFromRow: number = toFiniteNumber(span.durationUnixNano);
    const endFromRow: number = toFiniteNumber(span.endTimeUnixNano);
    const endTimeUnixNano: number = Math.max(
      startTimeUnixNano,
      endFromRow > 0 ? endFromRow : startTimeUnixNano + durationFromRow,
    );
    const durationUnixNano: number =
      durationFromRow > 0
        ? durationFromRow
        : Math.max(0, endTimeUnixNano - startTimeUnixNano);

    return {
      spanId: span.spanId?.toString() || `${MISSING_SPAN_ID_PREFIX}${index}`,
      parentSpanId: span.parentSpanId?.toString().trim() || "",
      name: span.name?.toString() || "",
      serviceId: span.primaryEntityId?.toString() || "",
      startTimeUnixNano,
      endTimeUnixNano,
      durationUnixNano,
      isError: span.statusCode === SpanStatus.Error,
      kind: span.kind,
    };
  });
}

export function toCriticalPathSpanData(
  spans: Array<WaterfallSpan>,
): Array<SpanData> {
  return spans.map((span: WaterfallSpan): SpanData => {
    return {
      spanId: span.spanId,
      parentSpanId: span.parentSpanId || undefined,
      startTimeUnixNano: span.startTimeUnixNano,
      endTimeUnixNano: span.endTimeUnixNano,
      durationUnixNano: span.durationUnixNano,
      primaryEntityId: span.serviceId || undefined,
      name: span.name,
    };
  });
}

function compareByStart(left: WaterfallNode, right: WaterfallNode): number {
  return left.span.startTimeUnixNano - right.span.startTimeUnixNano;
}

/**
 * Build the span tree. Iterative throughout, so a 10,000-level chain cannot
 * overflow the stack; duplicate span ids keep the first row; a span naming
 * itself or a cycle of parents is lifted to a root instead of recursing
 * forever; children and roots are ordered by start time.
 */
export function buildSpanTree(spans: Array<WaterfallSpan>): SpanTree {
  const nodesById: Map<string, WaterfallNode> = new Map();
  const orderedNodes: Array<WaterfallNode> = [];

  for (const span of spans) {
    if (nodesById.has(span.spanId)) {
      continue;
    }
    const node: WaterfallNode = {
      span,
      children: [],
      depth: 0,
      isOrphan: false,
      descendantCount: 0,
    };
    nodesById.set(span.spanId, node);
    orderedNodes.push(node);
  }

  const parentById: Map<string, string> = new Map();

  for (const node of orderedNodes) {
    const parentId: string = node.span.parentSpanId;
    if (!parentId) {
      continue;
    }
    const parent: WaterfallNode | undefined = nodesById.get(parentId);
    if (!parent || parent === node) {
      node.isOrphan = true;
      continue;
    }
    parentById.set(node.span.spanId, parentId);
  }

  /*
   * Break parent cycles: walk each span's ancestor chain; if it revisits a
   * span on the same walk, the chain is a loop with no root, so the earliest
   * span in the loop becomes a root.
   */
  const settled: Set<string> = new Set();
  for (const node of orderedNodes) {
    const walk: Array<string> = [];
    const onWalk: Set<string> = new Set();
    let currentId: string | undefined = node.span.spanId;

    while (currentId && !settled.has(currentId)) {
      if (onWalk.has(currentId)) {
        const loop: Array<string> = walk.slice(walk.indexOf(currentId));
        let earliestId: string = loop[0]!;
        for (const loopId of loop) {
          if (
            nodesById.get(loopId)!.span.startTimeUnixNano <
            nodesById.get(earliestId)!.span.startTimeUnixNano
          ) {
            earliestId = loopId;
          }
        }
        parentById.delete(earliestId);
        nodesById.get(earliestId)!.isOrphan = true;
        break;
      }
      onWalk.add(currentId);
      walk.push(currentId);
      currentId = parentById.get(currentId);
    }

    for (const walkedId of walk) {
      settled.add(walkedId);
    }
  }

  const roots: Array<WaterfallNode> = [];
  for (const node of orderedNodes) {
    const parentId: string | undefined = parentById.get(node.span.spanId);
    if (parentId) {
      nodesById.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  roots.sort((left: WaterfallNode, right: WaterfallNode): number => {
    // A true root sorts ahead of an orphan that started at the same moment.
    return (
      compareByStart(left, right) ||
      Number(left.isOrphan) - Number(right.isOrphan)
    );
  });

  let maxDepth: number = 0;
  const postOrder: Array<WaterfallNode> = [];
  const stack: Array<WaterfallNode> = [...roots].reverse();

  while (stack.length > 0) {
    const node: WaterfallNode = stack.pop()!;
    node.children.sort(compareByStart);
    postOrder.push(node);
    maxDepth = Math.max(maxDepth, node.depth);
    for (let index: number = node.children.length - 1; index >= 0; index--) {
      const child: WaterfallNode = node.children[index]!;
      child.depth = node.depth + 1;
      stack.push(child);
    }
  }

  for (let index: number = postOrder.length - 1; index >= 0; index--) {
    const node: WaterfallNode = postOrder[index]!;
    node.descendantCount = node.children.reduce(
      (total: number, child: WaterfallNode): number => {
        return total + 1 + child.descendantCount;
      },
      0,
    );
  }

  let startTimeUnixNano: number = Infinity;
  let endTimeUnixNano: number = -Infinity;
  for (const node of orderedNodes) {
    startTimeUnixNano = Math.min(
      startTimeUnixNano,
      node.span.startTimeUnixNano,
    );
    endTimeUnixNano = Math.max(endTimeUnixNano, node.span.endTimeUnixNano);
  }

  if (orderedNodes.length === 0) {
    startTimeUnixNano = 0;
    endTimeUnixNano = 0;
  }

  return {
    roots,
    nodesById,
    parentById,
    spanCount: orderedNodes.length,
    maxDepth,
    startTimeUnixNano,
    endTimeUnixNano,
    durationUnixNano: Math.max(0, endTimeUnixNano - startTimeUnixNano),
  };
}

/** Every span id from the root down to (not including) this span. */
export function getAncestorIds(tree: SpanTree, spanId: string): Array<string> {
  const ancestors: Array<string> = [];
  let parentId: string | undefined = tree.parentById.get(spanId);
  while (parentId) {
    ancestors.unshift(parentId);
    parentId = tree.parentById.get(parentId);
  }
  return ancestors;
}

/** The ids of every span that has children: "collapse all". */
export function getCollapsibleSpanIds(tree: SpanTree): Set<string> {
  const ids: Set<string> = new Set();
  for (const node of tree.nodesById.values()) {
    if (node.children.length > 0) {
      ids.add(node.span.spanId);
    }
  }
  return ids;
}

/**
 * Expand whatever hides the given spans. Returns the same set when nothing
 * had to change, so a React state update can bail out.
 */
export function revealSpans(
  tree: SpanTree,
  collapsedIds: Set<string>,
  spanIds: Array<string>,
): Set<string> {
  let next: Set<string> | null = null;
  for (const spanId of spanIds) {
    for (const ancestorId of getAncestorIds(tree, spanId)) {
      if (collapsedIds.has(ancestorId)) {
        next = next || new Set(collapsedIds);
        next.delete(ancestorId);
      }
    }
  }
  return next || collapsedIds;
}

/**
 * Keep the spans that match, plus every ancestor of a match so the tree still
 * reads top-down. Returns null when there is no predicate (nothing filtered).
 */
export function filterSpanTree(
  tree: SpanTree,
  predicate: ((span: WaterfallSpan) => boolean) | null,
): Map<string, SpanVisibility> | null {
  if (!predicate) {
    return null;
  }

  const visibility: Map<string, SpanVisibility> = new Map();

  for (const node of tree.nodesById.values()) {
    if (!predicate(node.span)) {
      continue;
    }
    visibility.set(node.span.spanId, "match");
    for (const ancestorId of getAncestorIds(tree, node.span.spanId)) {
      if (!visibility.has(ancestorId)) {
        visibility.set(ancestorId, "context");
      }
    }
  }

  return visibility;
}

export function countMatches(
  visibility: Map<string, SpanVisibility> | null,
): number {
  if (!visibility) {
    return 0;
  }
  let count: number = 0;
  for (const value of visibility.values()) {
    if (value === "match") {
      count += 1;
    }
  }
  return count;
}

/**
 * The rows the waterfall draws, in tree order: children of a collapsed span
 * and spans the filter removed are skipped.
 */
export function flattenVisibleRows(
  tree: SpanTree,
  collapsedIds: Set<string>,
  visibility: Map<string, SpanVisibility> | null,
): Array<WaterfallRow> {
  const rows: Array<WaterfallRow> = [];

  const isVisible: (node: WaterfallNode) => boolean = (
    node: WaterfallNode,
  ): boolean => {
    return !visibility || visibility.has(node.span.spanId);
  };

  const stack: Array<WaterfallNode> = tree.roots.filter(isVisible).reverse();

  while (stack.length > 0) {
    const node: WaterfallNode = stack.pop()!;
    const visibleChildren: Array<WaterfallNode> =
      node.children.filter(isVisible);
    const isCollapsed: boolean =
      visibleChildren.length > 0 && collapsedIds.has(node.span.spanId);

    rows.push({
      node,
      depth: node.depth,
      hasChildren: visibleChildren.length > 0,
      isCollapsed,
      visibleChildCount: visibleChildren.length,
      isContext: visibility?.get(node.span.spanId) === "context",
    });

    if (!isCollapsed) {
      for (
        let index: number = visibleChildren.length - 1;
        index >= 0;
        index--
      ) {
        stack.push(visibleChildren[index]!);
      }
    }
  }

  return rows;
}

export interface SpanFilterOptions {
  searchText: string;
  errorsOnly: boolean;
  serviceIds: Array<string>;
  serviceNameById: Map<string, string>;
}

/**
 * One predicate for every waterfall filter, or null when none is active.
 * Search is case-insensitive and every whitespace-separated word must appear
 * in the span name, span id or service name.
 */
export function buildSpanFilterPredicate(
  options: SpanFilterOptions,
): ((span: WaterfallSpan) => boolean) | null {
  const terms: Array<string> = options.searchText
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term: string) => {
      return term.length > 0;
    });
  const serviceIds: Set<string> = new Set(options.serviceIds);

  if (terms.length === 0 && !options.errorsOnly && serviceIds.size === 0) {
    return null;
  }

  return (span: WaterfallSpan): boolean => {
    if (options.errorsOnly && !span.isError) {
      return false;
    }
    if (serviceIds.size > 0 && !serviceIds.has(span.serviceId)) {
      return false;
    }
    if (terms.length === 0) {
      return true;
    }
    const haystack: string = [
      span.name,
      span.spanId,
      options.serviceNameById.get(span.serviceId) || "",
    ]
      .join("\n")
      .toLowerCase();
    return terms.every((term: string) => {
      return haystack.includes(term);
    });
  };
}

export interface TimelineTick {
  // Nanoseconds from the start of the trace.
  offsetUnixNano: number;
  // Position in the visible window, 0..100.
  percent: number;
  label: string;
}

const NICE_STEP_MULTIPLIERS: Array<number> = [1, 2, 2.5, 5, 10];

/** A 1-2-2.5-5 step so that at most `maxTicks` intervals fit in `range`. */
export function getNiceTickStep(range: number, maxTicks: number): number {
  if (!(range > 0) || !(maxTicks > 0)) {
    return 1;
  }
  const rawStep: number = range / maxTicks;
  const magnitude: number = Math.pow(10, Math.floor(Math.log10(rawStep)));
  for (const multiplier of NICE_STEP_MULTIPLIERS) {
    if (multiplier * magnitude >= rawStep) {
      return multiplier * magnitude;
    }
  }
  return 10 * magnitude;
}

interface TimeUnit {
  label: string;
  nanoseconds: number;
}

const TIME_UNITS: Array<TimeUnit> = [
  { label: "ns", nanoseconds: 1 },
  // Greek mu, the same glyph as the duration labels on the bars.
  { label: "μs", nanoseconds: 1e3 },
  { label: "ms", nanoseconds: 1e6 },
  { label: "s", nanoseconds: 1e9 },
];

function formatNumber(value: number, decimals: number): string {
  const text: string = value.toFixed(decimals);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

// The fewest decimals (up to 3) that write `value` exactly.
function getDecimals(value: number): number {
  for (let decimals: number = 0; decimals < 3; decimals++) {
    const scaled: number = value * Math.pow(10, decimals);
    if (Math.abs(Math.round(scaled) - scaled) < 1e-6) {
      return decimals;
    }
  }
  return 3;
}

/**
 * An axis label. The unit comes from the far end of the axis and the
 * decimals from the step, so every tick on one axis reads in the same unit
 * and precision: 0, 0.25 s, 0.5 s, 0.75 s, 1 s, 1.25 s.
 */
export function formatTickLabel(
  offsetUnixNano: number,
  stepUnixNano: number,
  axisEndUnixNano: number = offsetUnixNano,
): string {
  if (offsetUnixNano === 0) {
    return "0";
  }
  const reference: number = Math.max(axisEndUnixNano, stepUnixNano);
  let unit: TimeUnit = TIME_UNITS[0]!;
  for (const candidate of TIME_UNITS) {
    if (reference >= candidate.nanoseconds) {
      unit = candidate;
    }
  }
  const decimals: number = getDecimals(stepUnixNano / unit.nanoseconds);
  return `${formatNumber(offsetUnixNano / unit.nanoseconds, decimals)} ${unit.label}`;
}

/** Ticks for the visible slice of the trace, labelled from the trace start. */
export function computeTimelineTicks(
  durationUnixNano: number,
  viewport: TimeViewport,
  maxTicks: number,
): Array<TimelineTick> {
  if (!(durationUnixNano > 0)) {
    return [{ offsetUnixNano: 0, percent: 0, label: "0" }];
  }
  const windowStart: number = durationUnixNano * viewport.start;
  const windowEnd: number = durationUnixNano * viewport.end;
  const windowSize: number = windowEnd - windowStart;
  const step: number = getNiceTickStep(windowSize, maxTicks);
  const ticks: Array<TimelineTick> = [];
  // Math.max also turns the -0 that ceil(-1e-9) yields into 0.
  const firstIndex: number = Math.max(0, Math.ceil(windowStart / step - 1e-9));

  for (
    let index: number = firstIndex;
    index * step <= windowEnd + step * 1e-9;
    index++
  ) {
    const offsetUnixNano: number = index * step;
    ticks.push({
      offsetUnixNano,
      percent: ((offsetUnixNano - windowStart) / windowSize) * 100,
      label: formatTickLabel(offsetUnixNano, step, windowEnd),
    });
    if (ticks.length > maxTicks * 3) {
      break;
    }
  }

  return ticks;
}

export interface BarGeometry {
  leftPercent: number;
  widthPercent: number;
  // The span runs past the visible window on that side.
  isClippedStart: boolean;
  isClippedEnd: boolean;
  // Entirely outside the visible window.
  isOutside: boolean;
  labelPlacement: "after" | "before" | "inside";
}

// Room (in % of the track) a duration label needs beside its bar.
const LABEL_ROOM_PERCENT: number = 12;

export function getBarGeometry(data: {
  span: Pick<WaterfallSpan, "startTimeUnixNano" | "endTimeUnixNano">;
  traceStartUnixNano: number;
  traceDurationUnixNano: number;
  viewport: TimeViewport;
}): BarGeometry {
  const duration: number = data.traceDurationUnixNano;
  const windowStart: number = duration * data.viewport.start;
  const windowSize: number =
    duration * (data.viewport.end - data.viewport.start);

  if (!(duration > 0) || !(windowSize > 0)) {
    return {
      leftPercent: 0,
      widthPercent: 100,
      isClippedStart: false,
      isClippedEnd: false,
      isOutside: false,
      labelPlacement: "inside",
    };
  }

  const start: number =
    ((data.span.startTimeUnixNano - data.traceStartUnixNano - windowStart) /
      windowSize) *
    100;
  const end: number =
    ((data.span.endTimeUnixNano - data.traceStartUnixNano - windowStart) /
      windowSize) *
    100;

  const leftPercent: number = Math.min(100, Math.max(0, start));
  const rightPercent: number = Math.min(100, Math.max(0, end));
  const isOutside: boolean = end < 0 || start > 100;
  const widthPercent: number = Math.max(0, rightPercent - leftPercent);

  let labelPlacement: BarGeometry["labelPlacement"] = "after";
  if (100 - rightPercent < LABEL_ROOM_PERCENT) {
    labelPlacement = leftPercent >= LABEL_ROOM_PERCENT ? "before" : "inside";
  }

  return {
    leftPercent,
    widthPercent,
    isClippedStart: start < 0 && end > 0,
    isClippedEnd: end > 100 && start < 100,
    isOutside,
    labelPlacement,
  };
}

export const WATERFALL_ROW_HEIGHT_PX: number = 32;
const MIN_BODY_HEIGHT_PX: number = WATERFALL_ROW_HEIGHT_PX * 3;
const MIN_SCROLLING_BODY_HEIGHT_PX: number = 384;
// Room kept for the minimap, axis and toolbar when sizing to the window.
const BODY_WINDOW_ALLOWANCE_PX: number = 260;

/**
 * Tall enough to show every row of a small trace; a large one scrolls inside
 * a body sized to the window, so the axis stays in view.
 */
export function getWaterfallBodyHeight(data: {
  totalHeight: number;
  windowHeight: number;
}): number {
  const maxHeight: number = Math.max(
    MIN_SCROLLING_BODY_HEIGHT_PX,
    data.windowHeight - BODY_WINDOW_ALLOWANCE_PX,
  );
  return Math.max(MIN_BODY_HEIGHT_PX, Math.min(data.totalHeight, maxHeight));
}

export interface VirtualWindow {
  startIndex: number;
  // Exclusive.
  endIndex: number;
  offsetTop: number;
  totalHeight: number;
}

/** Which rows to render for a scroll position: only those in view plus overscan. */
export function computeVirtualWindow(data: {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  rowCount: number;
  overscan: number;
}): VirtualWindow {
  const rowHeight: number = Math.max(1, data.rowHeight);
  const rowCount: number = Math.max(0, data.rowCount);
  const totalHeight: number = rowCount * rowHeight;
  const scrollTop: number = Math.min(
    Math.max(0, data.scrollTop),
    Math.max(0, totalHeight - Math.max(0, data.viewportHeight)),
  );
  const firstVisible: number = Math.floor(scrollTop / rowHeight);
  const visibleCount: number = Math.ceil(
    Math.max(0, data.viewportHeight) / rowHeight,
  );
  const startIndex: number = Math.max(0, firstVisible - data.overscan);
  const endIndex: number = Math.min(
    rowCount,
    firstVisible + visibleCount + data.overscan,
  );

  return {
    startIndex,
    endIndex: Math.max(startIndex, endIndex),
    offsetTop: startIndex * rowHeight,
    totalHeight,
  };
}

/**
 * The scrollTop that brings a row fully into view, or null when it already
 * is. Rows below scroll to the bottom edge, rows above to the top edge.
 */
export function getScrollTopToReveal(data: {
  rowIndex: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
}): number | null {
  const rowTop: number = data.rowIndex * data.rowHeight;
  const rowBottom: number = rowTop + data.rowHeight;
  if (rowTop < data.scrollTop) {
    return rowTop;
  }
  if (rowBottom > data.scrollTop + data.viewportHeight) {
    return Math.max(0, rowBottom - data.viewportHeight);
  }
  return null;
}

export type TreeKeyAction =
  | { type: "select"; spanId: string }
  | { type: "expand"; spanId: string }
  | { type: "collapse"; spanId: string }
  | { type: "clear" };

/**
 * Keyboard behaviour of the waterfall, following the WAI-ARIA tree pattern:
 * Up/Down move, Right expands then steps into the first child, Left
 * collapses then steps out to the parent, Home/End jump, Escape clears.
 */
export function resolveTreeKeyAction(data: {
  key: string;
  rows: Array<WaterfallRow>;
  selectedSpanId: string | null;
  parentById: Map<string, string>;
}): TreeKeyAction | null {
  const { key, rows } = data;

  if (rows.length === 0) {
    return null;
  }

  if (key === "Escape") {
    return data.selectedSpanId ? { type: "clear" } : null;
  }

  if (key === "Home") {
    return { type: "select", spanId: rows[0]!.node.span.spanId };
  }

  if (key === "End") {
    return { type: "select", spanId: rows[rows.length - 1]!.node.span.spanId };
  }

  const index: number = data.selectedSpanId
    ? rows.findIndex((row: WaterfallRow) => {
        return row.node.span.spanId === data.selectedSpanId;
      })
    : -1;

  if (index === -1) {
    if (key === "ArrowDown" || key === "ArrowUp") {
      const row: WaterfallRow =
        key === "ArrowDown" ? rows[0]! : rows[rows.length - 1]!;
      return { type: "select", spanId: row.node.span.spanId };
    }
    return null;
  }

  const row: WaterfallRow = rows[index]!;
  const spanId: string = row.node.span.spanId;

  switch (key) {
    case "ArrowDown":
      return index < rows.length - 1
        ? { type: "select", spanId: rows[index + 1]!.node.span.spanId }
        : null;
    case "ArrowUp":
      return index > 0
        ? { type: "select", spanId: rows[index - 1]!.node.span.spanId }
        : null;
    case "ArrowRight":
      if (!row.hasChildren) {
        return null;
      }
      if (row.isCollapsed) {
        return { type: "expand", spanId };
      }
      return index < rows.length - 1
        ? { type: "select", spanId: rows[index + 1]!.node.span.spanId }
        : null;
    case "ArrowLeft": {
      if (row.hasChildren && !row.isCollapsed) {
        return { type: "collapse", spanId };
      }
      const parentId: string | undefined = data.parentById.get(spanId);
      const parentIsVisible: boolean = rows.some((candidate: WaterfallRow) => {
        return candidate.node.span.spanId === parentId;
      });
      return parentId && parentIsVisible
        ? { type: "select", spanId: parentId }
        : null;
    }
    default:
      return null;
  }
}

export function clampViewport(viewport: TimeViewport): TimeViewport {
  let start: number = Math.min(
    1,
    Math.max(0, Math.min(viewport.start, viewport.end)),
  );
  let end: number = Math.min(
    1,
    Math.max(0, Math.max(viewport.start, viewport.end)),
  );

  if (end - start < MIN_VIEWPORT_WIDTH) {
    const center: number = (start + end) / 2;
    start = Math.max(0, center - MIN_VIEWPORT_WIDTH / 2);
    end = Math.min(1, start + MIN_VIEWPORT_WIDTH);
    start = Math.max(0, end - MIN_VIEWPORT_WIDTH);
  }

  return { start, end };
}

export function isFullViewport(viewport: TimeViewport): boolean {
  return viewport.start <= 0 && viewport.end >= 1;
}

/**
 * The window to zoom into so a span fills most of the axis, with a little
 * air either side.
 */
export function getViewportForSpan(data: {
  span: Pick<WaterfallSpan, "startTimeUnixNano" | "endTimeUnixNano">;
  traceStartUnixNano: number;
  traceDurationUnixNano: number;
}): TimeViewport {
  if (!(data.traceDurationUnixNano > 0)) {
    return FULL_VIEWPORT;
  }
  const start: number =
    (data.span.startTimeUnixNano - data.traceStartUnixNano) /
    data.traceDurationUnixNano;
  const end: number =
    (data.span.endTimeUnixNano - data.traceStartUnixNano) /
    data.traceDurationUnixNano;
  const padding: number = Math.max(
    (end - start) * 0.05,
    MIN_VIEWPORT_WIDTH / 2,
  );
  return clampViewport({ start: start - padding, end: end + padding });
}

/** Zoom by `factor` (< 1 zooms in) around a focus point in the window. */
export function zoomViewport(
  viewport: TimeViewport,
  factor: number,
  focus: number = 0.5,
): TimeViewport {
  const width: number = viewport.end - viewport.start;
  const nextWidth: number = Math.min(
    1,
    Math.max(MIN_VIEWPORT_WIDTH, width * factor),
  );
  const anchor: number =
    viewport.start + width * Math.min(1, Math.max(0, focus));
  let start: number = anchor - (anchor - viewport.start) * (nextWidth / width);
  let end: number = start + nextWidth;
  if (start < 0) {
    end -= start;
    start = 0;
  }
  if (end > 1) {
    start -= end - 1;
    end = 1;
  }
  return clampViewport({ start, end });
}
