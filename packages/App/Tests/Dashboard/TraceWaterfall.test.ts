import { describe, expect, test } from "@jest/globals";
import Span, { SpanKind, SpanStatus } from "Common/Models/AnalyticsModels/Span";
import ObjectID from "Common/Types/ObjectID";
import {
  BarGeometry,
  FULL_VIEWPORT,
  MIN_VIEWPORT_WIDTH,
  SpanFilterOptions,
  SpanTree,
  SpanVisibility,
  TimeViewport,
  TimelineTick,
  TreeKeyAction,
  VirtualWindow,
  WATERFALL_ROW_HEIGHT_PX,
  WaterfallNode,
  WaterfallRow,
  WaterfallSpan,
  buildSpanFilterPredicate,
  buildSpanTree,
  clampViewport,
  computeTimelineTicks,
  computeVirtualWindow,
  countMatches,
  filterSpanTree,
  flattenVisibleRows,
  formatTickLabel,
  getAncestorIds,
  getBarGeometry,
  getCollapsibleSpanIds,
  getNiceTickStep,
  getScrollTopToReveal,
  getViewportForSpan,
  getWaterfallBodyHeight,
  isFullViewport,
  resolveTreeKeyAction,
  revealSpans,
  toCriticalPathSpanData,
  toWaterfallSpans,
  zoomViewport,
} from "../../FeatureSet/Dashboard/src/Utils/TraceWaterfall";

/*
 * The trace detail waterfall's model: how spans become a tree, which rows
 * show, how the time axis and bars are laid out, and how the keyboard moves.
 * Times below are small nanosecond offsets unless a test is about real
 * epoch timestamps.
 */

const MS: number = 1_000_000;

function span(
  spanId: string,
  parentSpanId: string,
  startMs: number,
  durationMs: number,
  overrides: Partial<WaterfallSpan> = {},
): WaterfallSpan {
  return {
    spanId,
    parentSpanId,
    name: spanId,
    serviceId: "svc-a",
    startTimeUnixNano: startMs * MS,
    endTimeUnixNano: (startMs + durationMs) * MS,
    durationUnixNano: durationMs * MS,
    isError: false,
    kind: SpanKind.Internal,
    ...overrides,
  };
}

/*
 *   root (0-100)
 *   ├── a (10-40)
 *   │   ├── a1 (12-20)
 *   │   └── a2 (22-38)
 *   └── b (50-95)  [error]
 *       └── b1 (55-90)
 */
function sampleSpans(): Array<WaterfallSpan> {
  return [
    span("b1", "b", 55, 35, { serviceId: "svc-c" }),
    span("root", "", 0, 100),
    span("a2", "a", 22, 16),
    span("a", "root", 10, 30, { serviceId: "svc-b" }),
    span("b", "root", 50, 45, {
      isError: true,
      serviceId: "svc-c",
      name: "Checkout",
    }),
    span("a1", "a", 12, 8),
  ];
}

function rowIds(rows: Array<WaterfallRow>): Array<string> {
  return rows.map((row: WaterfallRow) => {
    return row.node.span.spanId;
  });
}

describe("toWaterfallSpans", () => {
  function model(values: Partial<Span>): Span {
    return Object.assign(new Span(), values);
  }

  test("normalizes ids, parents, service and status", () => {
    const [result] = toWaterfallSpans([
      model({
        spanId: "abc",
        parentSpanId: "  parent  ",
        name: "GET /",
        primaryEntityId: new ObjectID("60000000-0000-4000-8000-000000000001"),
        startTimeUnixNano: 10,
        endTimeUnixNano: 30,
        durationUnixNano: 20,
        statusCode: SpanStatus.Error,
        kind: SpanKind.Server,
      }),
    ]);

    expect(result).toEqual({
      spanId: "abc",
      parentSpanId: "parent",
      name: "GET /",
      serviceId: "60000000-0000-4000-8000-000000000001",
      startTimeUnixNano: 10,
      endTimeUnixNano: 30,
      durationUnixNano: 20,
      isError: true,
      kind: SpanKind.Server,
    });
  });

  test("a span without an id still renders under a synthetic id", () => {
    const result: Array<WaterfallSpan> = toWaterfallSpans([
      model({ name: "first", startTimeUnixNano: 1, endTimeUnixNano: 2 }),
      model({ name: "second", startTimeUnixNano: 1, endTimeUnixNano: 2 }),
    ]);

    expect(result[0]!.spanId).not.toBe(result[1]!.spanId);
    expect(result[0]!.spanId.length).toBeGreaterThan(0);
    expect(result[0]!.parentSpanId).toBe("");
    expect(result[0]!.serviceId).toBe("");
    expect(result[0]!.isError).toBe(false);
  });

  test("an end before the start is clamped to the start", () => {
    const [result] = toWaterfallSpans([
      model({
        spanId: "x",
        startTimeUnixNano: 500,
        endTimeUnixNano: 100,
        durationUnixNano: 0,
      }),
    ]);

    expect(result!.endTimeUnixNano).toBe(500);
    expect(result!.durationUnixNano).toBe(0);
  });

  test("a missing end is derived from the duration, and a missing duration from the end", () => {
    const [fromDuration, fromEnd] = toWaterfallSpans([
      model({ spanId: "x", startTimeUnixNano: 100, durationUnixNano: 40 }),
      model({ spanId: "y", startTimeUnixNano: 100, endTimeUnixNano: 175 }),
    ]);

    expect(fromDuration!.endTimeUnixNano).toBe(140);
    expect(fromEnd!.durationUnixNano).toBe(75);
  });

  test("non-numeric times become zero rather than NaN", () => {
    const [result] = toWaterfallSpans([
      model({
        spanId: "x",
        startTimeUnixNano: Number.NaN,
        endTimeUnixNano: undefined,
      }),
    ]);

    expect(result!.startTimeUnixNano).toBe(0);
    expect(result!.endTimeUnixNano).toBe(0);
    expect(result!.durationUnixNano).toBe(0);
  });

  test("OK and unset statuses are not errors", () => {
    const result: Array<WaterfallSpan> = toWaterfallSpans([
      model({ spanId: "ok", statusCode: SpanStatus.Ok }),
      model({ spanId: "unset", statusCode: SpanStatus.Unset }),
    ]);

    expect(
      result.map((item: WaterfallSpan) => {
        return item.isError;
      }),
    ).toEqual([false, false]);
  });
});

describe("toCriticalPathSpanData", () => {
  test("maps empty parents and services to undefined", () => {
    expect(
      toCriticalPathSpanData([span("root", "", 0, 10, { serviceId: "" })]),
    ).toEqual([
      {
        spanId: "root",
        parentSpanId: undefined,
        startTimeUnixNano: 0,
        endTimeUnixNano: 10 * MS,
        durationUnixNano: 10 * MS,
        primaryEntityId: undefined,
        name: "root",
      },
    ]);
  });
});

describe("buildSpanTree", () => {
  test("links children to parents and orders everything by start time", () => {
    const tree: SpanTree = buildSpanTree(sampleSpans());

    expect(
      tree.roots.map((node: WaterfallNode) => {
        return node.span.spanId;
      }),
    ).toEqual(["root"]);
    const root: WaterfallNode = tree.roots[0]!;
    expect(
      root.children.map((node: WaterfallNode) => {
        return node.span.spanId;
      }),
    ).toEqual(["a", "b"]);
    expect(
      root.children[0]!.children.map((node: WaterfallNode) => {
        return node.span.spanId;
      }),
    ).toEqual(["a1", "a2"]);
    expect(tree.spanCount).toBe(6);
  });

  test("computes depth, max depth and descendant counts", () => {
    const tree: SpanTree = buildSpanTree(sampleSpans());

    expect(tree.nodesById.get("root")!.depth).toBe(0);
    expect(tree.nodesById.get("a")!.depth).toBe(1);
    expect(tree.nodesById.get("b1")!.depth).toBe(2);
    expect(tree.maxDepth).toBe(2);
    expect(tree.nodesById.get("root")!.descendantCount).toBe(5);
    expect(tree.nodesById.get("a")!.descendantCount).toBe(2);
    expect(tree.nodesById.get("a1")!.descendantCount).toBe(0);
  });

  test("records the trace bounds from the earliest start to the latest end", () => {
    const tree: SpanTree = buildSpanTree([
      span("late", "", 40, 80),
      span("early", "", 5, 10),
    ]);

    expect(tree.startTimeUnixNano).toBe(5 * MS);
    expect(tree.endTimeUnixNano).toBe(120 * MS);
    expect(tree.durationUnixNano).toBe(115 * MS);
  });

  test("bounds work on real epoch nanosecond timestamps", () => {
    const epoch: number = 1_757_890_000_000 * MS;
    const tree: SpanTree = buildSpanTree([
      {
        ...span("root", "", 0, 0),
        startTimeUnixNano: epoch,
        endTimeUnixNano: epoch + 716 * MS,
      },
    ]);

    expect(tree.durationUnixNano).toBeCloseTo(716 * MS, -3);
  });

  test("an empty trace has no roots and zero bounds", () => {
    const tree: SpanTree = buildSpanTree([]);

    expect(tree.roots).toEqual([]);
    expect(tree.spanCount).toBe(0);
    expect(tree.startTimeUnixNano).toBe(0);
    expect(tree.durationUnixNano).toBe(0);
    expect(tree.maxDepth).toBe(0);
  });

  test("a span whose parent was never received becomes an orphan root", () => {
    const tree: SpanTree = buildSpanTree([
      span("root", "", 0, 100),
      span("lost", "missing-parent", 20, 10),
      span("lost-child", "lost", 22, 5),
    ]);

    expect(
      tree.roots.map((node: WaterfallNode) => {
        return node.span.spanId;
      }),
    ).toEqual(["root", "lost"]);
    expect(tree.nodesById.get("lost")!.isOrphan).toBe(true);
    expect(tree.nodesById.get("root")!.isOrphan).toBe(false);
    expect(tree.nodesById.get("lost-child")!.depth).toBe(1);
    expect(tree.parentById.has("lost")).toBe(false);
  });

  test("a true root sorts ahead of an orphan that started at the same time", () => {
    const tree: SpanTree = buildSpanTree([
      span("orphan", "gone", 0, 10),
      span("root", "", 0, 10),
    ]);

    expect(
      tree.roots.map((node: WaterfallNode) => {
        return node.span.spanId;
      }),
    ).toEqual(["root", "orphan"]);
  });

  test("a span naming itself as parent is a root, not an infinite loop", () => {
    const tree: SpanTree = buildSpanTree([span("self", "self", 0, 10)]);

    expect(
      tree.roots.map((node: WaterfallNode) => {
        return node.span.spanId;
      }),
    ).toEqual(["self"]);
    expect(tree.nodesById.get("self")!.isOrphan).toBe(true);
  });

  test("a parent cycle is broken at its earliest span", () => {
    const tree: SpanTree = buildSpanTree([
      span("x", "z", 30, 5),
      span("y", "x", 10, 5),
      span("z", "y", 20, 5),
    ]);

    expect(
      tree.roots.map((node: WaterfallNode) => {
        return node.span.spanId;
      }),
    ).toEqual(["y"]);
    expect(tree.nodesById.get("y")!.isOrphan).toBe(true);
    expect(tree.nodesById.get("z")!.depth).toBe(1);
    expect(tree.nodesById.get("x")!.depth).toBe(2);
    expect(getAncestorIds(tree, "x")).toEqual(["y", "z"]);
  });

  test("a cycle hanging off a healthy tree does not disturb the tree", () => {
    const tree: SpanTree = buildSpanTree([
      span("root", "", 0, 100),
      span("child", "root", 5, 10),
      span("p", "q", 50, 5),
      span("q", "p", 60, 5),
    ]);

    expect(
      tree.roots.map((node: WaterfallNode) => {
        return node.span.spanId;
      }),
    ).toEqual(["root", "p"]);
    expect(tree.nodesById.get("child")!.depth).toBe(1);
    expect(tree.nodesById.get("q")!.depth).toBe(1);
  });

  test("duplicate span ids keep the first row", () => {
    const tree: SpanTree = buildSpanTree([
      span("dup", "", 0, 10, { name: "first" }),
      span("dup", "", 5, 10, { name: "second" }),
    ]);

    expect(tree.spanCount).toBe(1);
    expect(tree.nodesById.get("dup")!.span.name).toBe("first");
  });

  test("a 20,000-level chain builds without overflowing the stack", () => {
    const spans: Array<WaterfallSpan> = [];
    for (let index: number = 0; index < 20000; index++) {
      spans.push(
        span(`s${index}`, index === 0 ? "" : `s${index - 1}`, index, 1),
      );
    }

    const tree: SpanTree = buildSpanTree(spans);

    expect(tree.maxDepth).toBe(19999);
    expect(tree.nodesById.get("s0")!.descendantCount).toBe(19999);
    expect(flattenVisibleRows(tree, new Set(), null)).toHaveLength(20000);
  });

  test("input order does not change the tree", () => {
    const forward: SpanTree = buildSpanTree(sampleSpans());
    const reversed: SpanTree = buildSpanTree([...sampleSpans()].reverse());

    expect(rowIds(flattenVisibleRows(forward, new Set(), null))).toEqual(
      rowIds(flattenVisibleRows(reversed, new Set(), null)),
    );
  });
});

describe("tree helpers", () => {
  test("getAncestorIds lists the path from the root", () => {
    const tree: SpanTree = buildSpanTree(sampleSpans());

    expect(getAncestorIds(tree, "b1")).toEqual(["root", "b"]);
    expect(getAncestorIds(tree, "root")).toEqual([]);
    expect(getAncestorIds(tree, "not-there")).toEqual([]);
  });

  test("getCollapsibleSpanIds returns every span with children", () => {
    const tree: SpanTree = buildSpanTree(sampleSpans());

    expect([...getCollapsibleSpanIds(tree)].sort()).toEqual(["a", "b", "root"]);
  });

  test("revealSpans expands the ancestors hiding a span", () => {
    const tree: SpanTree = buildSpanTree(sampleSpans());
    const collapsed: Set<string> = new Set(["root", "b", "a"]);

    const next: Set<string> = revealSpans(tree, collapsed, ["b1"]);

    expect([...next].sort()).toEqual(["a"]);
    expect(collapsed.size).toBe(3);
  });

  test("revealSpans returns the same set when nothing hides the spans", () => {
    const tree: SpanTree = buildSpanTree(sampleSpans());
    const collapsed: Set<string> = new Set(["a"]);

    expect(revealSpans(tree, collapsed, ["b1", "root"])).toBe(collapsed);
  });
});

describe("flattenVisibleRows", () => {
  test("lists every span in depth-first order", () => {
    const tree: SpanTree = buildSpanTree(sampleSpans());
    const rows: Array<WaterfallRow> = flattenVisibleRows(tree, new Set(), null);

    expect(rowIds(rows)).toEqual(["root", "a", "a1", "a2", "b", "b1"]);
    expect(
      rows.map((row: WaterfallRow) => {
        return row.depth;
      }),
    ).toEqual([0, 1, 2, 2, 1, 2]);
    expect(rows[0]!.hasChildren).toBe(true);
    expect(rows[0]!.visibleChildCount).toBe(2);
    expect(rows[2]!.hasChildren).toBe(false);
    expect(
      rows.some((row: WaterfallRow) => {
        return row.isContext;
      }),
    ).toBe(false);
  });

  test("a collapsed span hides its descendants but not its siblings", () => {
    const tree: SpanTree = buildSpanTree(sampleSpans());
    const rows: Array<WaterfallRow> = flattenVisibleRows(
      tree,
      new Set(["a"]),
      null,
    );

    expect(rowIds(rows)).toEqual(["root", "a", "b", "b1"]);
    expect(rows[1]!.isCollapsed).toBe(true);
  });

  test("collapsing a leaf changes nothing and is not reported as collapsed", () => {
    const tree: SpanTree = buildSpanTree(sampleSpans());
    const rows: Array<WaterfallRow> = flattenVisibleRows(
      tree,
      new Set(["a1"]),
      null,
    );

    expect(rowIds(rows)).toHaveLength(6);
    expect(
      rows.find((row: WaterfallRow) => {
        return row.node.span.spanId === "a1";
      })!.isCollapsed,
    ).toBe(false);
  });

  test("collapsing the root leaves one row", () => {
    const tree: SpanTree = buildSpanTree(sampleSpans());

    expect(rowIds(flattenVisibleRows(tree, new Set(["root"]), null))).toEqual([
      "root",
    ]);
  });

  test("a filter keeps matches with their ancestors as context", () => {
    const tree: SpanTree = buildSpanTree(sampleSpans());
    const visibility: Map<string, SpanVisibility> | null = filterSpanTree(
      tree,
      (item: WaterfallSpan) => {
        return item.spanId === "b1";
      },
    );
    const rows: Array<WaterfallRow> = flattenVisibleRows(
      tree,
      new Set(),
      visibility,
    );

    expect(rowIds(rows)).toEqual(["root", "b", "b1"]);
    expect(
      rows.map((row: WaterfallRow) => {
        return row.isContext;
      }),
    ).toEqual([true, true, false]);
    expect(rows[0]!.visibleChildCount).toBe(1);
  });

  test("a filtered-out child does not count towards hasChildren", () => {
    const tree: SpanTree = buildSpanTree(sampleSpans());
    const visibility: Map<string, SpanVisibility> | null = filterSpanTree(
      tree,
      (item: WaterfallSpan) => {
        return item.spanId === "a" || item.spanId === "b";
      },
    );
    const rows: Array<WaterfallRow> = flattenVisibleRows(
      tree,
      new Set(["a"]),
      visibility,
    );

    const a: WaterfallRow = rows.find((row: WaterfallRow) => {
      return row.node.span.spanId === "a";
    })!;
    expect(a.hasChildren).toBe(false);
    expect(a.isCollapsed).toBe(false);
  });

  test("an empty filter result renders no rows", () => {
    const tree: SpanTree = buildSpanTree(sampleSpans());
    const visibility: Map<string, SpanVisibility> | null = filterSpanTree(
      tree,
      () => {
        return false;
      },
    );

    expect(flattenVisibleRows(tree, new Set(), visibility)).toEqual([]);
  });
});

describe("filterSpanTree and countMatches", () => {
  test("no predicate means no filter", () => {
    const tree: SpanTree = buildSpanTree(sampleSpans());

    expect(filterSpanTree(tree, null)).toBeNull();
    expect(countMatches(null)).toBe(0);
  });

  test("a match that is also an ancestor of another match stays a match", () => {
    const tree: SpanTree = buildSpanTree(sampleSpans());
    const visibility: Map<string, SpanVisibility> = filterSpanTree(
      tree,
      (item: WaterfallSpan) => {
        return item.spanId === "b" || item.spanId === "b1";
      },
    )!;

    expect(visibility.get("b")).toBe("match");
    expect(visibility.get("b1")).toBe("match");
    expect(visibility.get("root")).toBe("context");
    expect(visibility.has("a")).toBe(false);
    expect(countMatches(visibility)).toBe(2);
  });
});

describe("buildSpanFilterPredicate", () => {
  const serviceNameById: Map<string, string> = new Map([
    ["svc-a", "api-gateway"],
    ["svc-b", "inventory-service"],
    ["svc-c", "payment-service"],
  ]);

  function predicate(
    options: Partial<SpanFilterOptions>,
  ): ((item: WaterfallSpan) => boolean) | null {
    return buildSpanFilterPredicate({
      searchText: "",
      errorsOnly: false,
      serviceIds: [],
      serviceNameById,
      ...options,
    });
  }

  test("is null when no filter is active, including whitespace-only search", () => {
    expect(predicate({})).toBeNull();
    expect(predicate({ searchText: "   " })).toBeNull();
  });

  test("errors only keeps error spans", () => {
    const test_: (item: WaterfallSpan) => boolean = predicate({
      errorsOnly: true,
    })!;

    expect(test_(span("x", "", 0, 1, { isError: true }))).toBe(true);
    expect(test_(span("y", "", 0, 1))).toBe(false);
  });

  test("service filter keeps spans from any selected service", () => {
    const test_: (item: WaterfallSpan) => boolean = predicate({
      serviceIds: ["svc-b", "svc-c"],
    })!;

    expect(test_(span("x", "", 0, 1, { serviceId: "svc-b" }))).toBe(true);
    expect(test_(span("y", "", 0, 1, { serviceId: "svc-c" }))).toBe(true);
    expect(test_(span("z", "", 0, 1, { serviceId: "svc-a" }))).toBe(false);
  });

  test("search matches name, span id and service name, case-insensitively", () => {
    expect(
      predicate({ searchText: "CHECKOUT" })!(
        span("x", "", 0, 1, { name: "POST /checkout" }),
      ),
    ).toBe(true);
    expect(
      predicate({ searchText: "36fbeee7" })!(
        span("36fbeee7103ae663", "", 0, 1, { name: "other" }),
      ),
    ).toBe(true);
    expect(
      predicate({ searchText: "inventory" })!(
        span("x", "", 0, 1, { name: "UPDATE", serviceId: "svc-b" }),
      ),
    ).toBe(true);
    expect(predicate({ searchText: "nothing" })!(span("x", "", 0, 1))).toBe(
      false,
    );
  });

  test("every search word must match, in any field", () => {
    const test_: (item: WaterfallSpan) => boolean = predicate({
      searchText: "  update   inventory ",
    })!;

    expect(
      test_(span("x", "", 0, 1, { name: "UPDATE stock", serviceId: "svc-b" })),
    ).toBe(true);
    expect(
      test_(span("y", "", 0, 1, { name: "UPDATE stock", serviceId: "svc-a" })),
    ).toBe(false);
  });

  test("a search word does not match across the boundary of two fields", () => {
    const test_: (item: WaterfallSpan) => boolean = predicate({
      searchText: "stockx",
    })!;

    expect(test_(span("x", "", 0, 1, { name: "stock" }))).toBe(false);
  });

  test("filters combine", () => {
    const test_: (item: WaterfallSpan) => boolean = predicate({
      searchText: "stock",
      errorsOnly: true,
      serviceIds: ["svc-b"],
    })!;

    expect(
      test_(
        span("x", "", 0, 1, {
          name: "UPDATE stock",
          serviceId: "svc-b",
          isError: true,
        }),
      ),
    ).toBe(true);
    expect(
      test_(span("y", "", 0, 1, { name: "UPDATE stock", serviceId: "svc-b" })),
    ).toBe(false);
    expect(
      test_(
        span("z", "", 0, 1, {
          name: "UPDATE stock",
          serviceId: "svc-c",
          isError: true,
        }),
      ),
    ).toBe(false);
  });

  test("an unknown service has no name to match", () => {
    expect(
      predicate({ searchText: "gateway" })!(
        span("x", "", 0, 1, { serviceId: "svc-missing" }),
      ),
    ).toBe(false);
  });
});

describe("time axis", () => {
  test("getNiceTickStep picks 1-2-2.5-5 steps", () => {
    expect(getNiceTickStep(1284 * MS, 6)).toBe(250 * MS);
    expect(getNiceTickStep(716 * MS, 6)).toBe(200 * MS);
    expect(getNiceTickStep(100, 5)).toBe(20);
    expect(getNiceTickStep(9 * MS, 6)).toBe(2 * MS);
    expect(getNiceTickStep(0, 6)).toBe(1);
    expect(getNiceTickStep(100, 0)).toBe(1);
  });

  test("formatTickLabel uses one unit per axis, chosen by its far end", () => {
    expect(formatTickLabel(0, 250 * MS, 1250 * MS)).toBe("0");
    expect(formatTickLabel(250 * MS, 250 * MS, 1250 * MS)).toBe("0.25 s");
    expect(formatTickLabel(1000 * MS, 250 * MS, 1250 * MS)).toBe("1 s");
    expect(formatTickLabel(1250 * MS, 250 * MS, 1250 * MS)).toBe("1.25 s");
    expect(formatTickLabel(200 * MS, 200 * MS, 716 * MS)).toBe("200 ms");
    expect(formatTickLabel(500, 500, 2000)).toBe("0.5 μs");
    expect(formatTickLabel(40, 20, 90)).toBe("40 ns");
    expect(formatTickLabel(10 * MS, 10 * MS, 50 * MS)).toBe("10 ms");
  });

  test("computeTimelineTicks covers the whole trace", () => {
    const ticks: Array<TimelineTick> = computeTimelineTicks(
      1284 * MS,
      FULL_VIEWPORT,
      6,
    );

    expect(
      ticks.map((tick: TimelineTick) => {
        return tick.label;
      }),
    ).toEqual(["0", "0.25 s", "0.5 s", "0.75 s", "1 s", "1.25 s"]);
    expect(ticks[0]!.percent).toBe(0);
    expect(ticks[4]!.percent).toBeCloseTo((1000 / 1284) * 100, 5);
    expect(
      ticks.every((tick: TimelineTick) => {
        return tick.percent >= 0 && tick.percent <= 100;
      }),
    ).toBe(true);
  });

  test("computeTimelineTicks labels a zoomed window from the trace start", () => {
    const ticks: Array<TimelineTick> = computeTimelineTicks(
      1000 * MS,
      { start: 0.5, end: 0.6 },
      5,
    );

    expect(ticks[0]!.offsetUnixNano).toBe(500 * MS);
    expect(ticks[0]!.percent).toBeCloseTo(0, 5);
    expect(ticks[ticks.length - 1]!.offsetUnixNano).toBeLessThanOrEqual(
      600 * MS,
    );
    expect(
      ticks.map((tick: TimelineTick) => {
        return tick.label;
      }),
    ).toContain("520 ms");
  });

  test("a zero-length trace draws one tick", () => {
    expect(computeTimelineTicks(0, FULL_VIEWPORT, 6)).toEqual([
      { offsetUnixNano: 0, percent: 0, label: "0" },
    ]);
  });

  test("ticks never exceed a sane count", () => {
    const ticks: Array<TimelineTick> = computeTimelineTicks(
      123456789,
      { start: 0.1234, end: 0.9876 },
      6,
    );

    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.length).toBeLessThanOrEqual(18);
  });
});

describe("getBarGeometry", () => {
  const trace: { traceStartUnixNano: number; traceDurationUnixNano: number } = {
    traceStartUnixNano: 1000 * MS,
    traceDurationUnixNano: 100 * MS,
  };

  function geometry(
    startMs: number,
    durationMs: number,
    viewport: TimeViewport = FULL_VIEWPORT,
  ): BarGeometry {
    return getBarGeometry({
      span: {
        startTimeUnixNano: (1000 + startMs) * MS,
        endTimeUnixNano: (1000 + startMs + durationMs) * MS,
      },
      ...trace,
      viewport,
    });
  }

  test("positions a bar as a share of the trace", () => {
    const result: BarGeometry = geometry(10, 30);

    expect(result.leftPercent).toBeCloseTo(10, 5);
    expect(result.widthPercent).toBeCloseTo(30, 5);
    expect(result.isOutside).toBe(false);
    expect(result.isClippedStart).toBe(false);
    expect(result.isClippedEnd).toBe(false);
    expect(result.labelPlacement).toBe("after");
  });

  test("a bar that reaches the end puts its label before the bar", () => {
    expect(geometry(50, 50).labelPlacement).toBe("before");
  });

  test("a bar spanning the whole axis puts its label inside", () => {
    expect(geometry(0, 100).labelPlacement).toBe("inside");
  });

  test("a zoomed window clips bars that run past it", () => {
    const viewport: TimeViewport = { start: 0.2, end: 0.4 };

    const clippedStart: BarGeometry = geometry(10, 20, viewport);
    expect(clippedStart.leftPercent).toBe(0);
    expect(clippedStart.widthPercent).toBeCloseTo(50, 5);
    expect(clippedStart.isClippedStart).toBe(true);

    const clippedEnd: BarGeometry = geometry(35, 20, viewport);
    expect(clippedEnd.leftPercent).toBeCloseTo(75, 5);
    expect(clippedEnd.widthPercent).toBeCloseTo(25, 5);
    expect(clippedEnd.isClippedEnd).toBe(true);
  });

  test("a bar outside the zoomed window is flagged", () => {
    const viewport: TimeViewport = { start: 0.5, end: 0.6 };

    expect(geometry(0, 10, viewport).isOutside).toBe(true);
    expect(geometry(90, 5, viewport).isOutside).toBe(true);
    expect(geometry(90, 5, viewport).leftPercent).toBe(100);
  });

  test("a zero-length trace fills the track", () => {
    const result: BarGeometry = getBarGeometry({
      span: { startTimeUnixNano: 5, endTimeUnixNano: 5 },
      traceStartUnixNano: 5,
      traceDurationUnixNano: 0,
      viewport: FULL_VIEWPORT,
    });

    expect(result.leftPercent).toBe(0);
    expect(result.widthPercent).toBe(100);
  });
});

describe("virtualisation", () => {
  test("renders only the rows in view plus overscan", () => {
    const window_: VirtualWindow = computeVirtualWindow({
      scrollTop: 320,
      viewportHeight: 320,
      rowHeight: 32,
      rowCount: 1000,
      overscan: 5,
    });

    expect(window_.startIndex).toBe(5);
    expect(window_.endIndex).toBe(25);
    expect(window_.offsetTop).toBe(160);
    expect(window_.totalHeight).toBe(32000);
  });

  test("clamps at the top and bottom", () => {
    expect(
      computeVirtualWindow({
        scrollTop: -50,
        viewportHeight: 100,
        rowHeight: 10,
        rowCount: 5,
        overscan: 3,
      }),
    ).toEqual({
      startIndex: 0,
      endIndex: 5,
      offsetTop: 0,
      totalHeight: 50,
    });
    const bottom: VirtualWindow = computeVirtualWindow({
      scrollTop: 99999,
      viewportHeight: 100,
      rowHeight: 10,
      rowCount: 100,
      overscan: 2,
    });
    expect(bottom.endIndex).toBe(100);
    expect(bottom.startIndex).toBe(88);
  });

  test("no rows renders nothing", () => {
    expect(
      computeVirtualWindow({
        scrollTop: 0,
        viewportHeight: 300,
        rowHeight: 32,
        rowCount: 0,
        overscan: 10,
      }),
    ).toEqual({
      startIndex: 0,
      endIndex: 0,
      offsetTop: 0,
      totalHeight: 0,
    });
  });

  test("getScrollTopToReveal scrolls only when the row is out of view", () => {
    expect(
      getScrollTopToReveal({
        rowIndex: 5,
        rowHeight: 32,
        scrollTop: 0,
        viewportHeight: 320,
      }),
    ).toBeNull();
    expect(
      getScrollTopToReveal({
        rowIndex: 20,
        rowHeight: 32,
        scrollTop: 0,
        viewportHeight: 320,
      }),
    ).toBe(21 * 32 - 320);
    expect(
      getScrollTopToReveal({
        rowIndex: 2,
        rowHeight: 32,
        scrollTop: 400,
        viewportHeight: 320,
      }),
    ).toBe(64);
  });

  test("the body shows every row of a small trace and scrolls a large one", () => {
    expect(
      getWaterfallBodyHeight({
        totalHeight: 10 * WATERFALL_ROW_HEIGHT_PX,
        windowHeight: 1000,
      }),
    ).toBe(320);
    expect(
      getWaterfallBodyHeight({ totalHeight: 20000, windowHeight: 1000 }),
    ).toBe(740);
    expect(
      getWaterfallBodyHeight({ totalHeight: 20000, windowHeight: 500 }),
    ).toBe(384);
    expect(getWaterfallBodyHeight({ totalHeight: 0, windowHeight: 1000 })).toBe(
      3 * WATERFALL_ROW_HEIGHT_PX,
    );
  });
});

describe("resolveTreeKeyAction", () => {
  const tree: SpanTree = buildSpanTree(sampleSpans());

  function act(
    key: string,
    selectedSpanId: string | null,
    collapsed: Array<string> = [],
  ): TreeKeyAction | null {
    return resolveTreeKeyAction({
      key,
      rows: flattenVisibleRows(tree, new Set(collapsed), null),
      selectedSpanId,
      parentById: tree.parentById,
    });
  }

  test("Down and Up move between visible rows", () => {
    expect(act("ArrowDown", "a")).toEqual({ type: "select", spanId: "a1" });
    expect(act("ArrowUp", "a")).toEqual({ type: "select", spanId: "root" });
    expect(act("ArrowDown", "a", ["a"])).toEqual({
      type: "select",
      spanId: "b",
    });
  });

  test("Down and Up stop at the ends", () => {
    expect(act("ArrowDown", "b1")).toBeNull();
    expect(act("ArrowUp", "root")).toBeNull();
  });

  test("with nothing selected, Down selects the first row and Up the last", () => {
    expect(act("ArrowDown", null)).toEqual({ type: "select", spanId: "root" });
    expect(act("ArrowUp", null)).toEqual({ type: "select", spanId: "b1" });
    expect(act("ArrowLeft", null)).toBeNull();
  });

  test("Right expands a collapsed span, then steps into its first child", () => {
    expect(act("ArrowRight", "a", ["a"])).toEqual({
      type: "expand",
      spanId: "a",
    });
    expect(act("ArrowRight", "a")).toEqual({ type: "select", spanId: "a1" });
    expect(act("ArrowRight", "a1")).toBeNull();
  });

  test("Left collapses an open span, then steps out to the parent", () => {
    expect(act("ArrowLeft", "a")).toEqual({ type: "collapse", spanId: "a" });
    expect(act("ArrowLeft", "a", ["a"])).toEqual({
      type: "select",
      spanId: "root",
    });
    expect(act("ArrowLeft", "a1")).toEqual({ type: "select", spanId: "a" });
    expect(act("ArrowLeft", "root", ["root"])).toBeNull();
  });

  test("Home and End jump, Escape clears", () => {
    expect(act("Home", "b")).toEqual({ type: "select", spanId: "root" });
    expect(act("End", "a")).toEqual({ type: "select", spanId: "b1" });
    expect(act("Escape", "a")).toEqual({ type: "clear" });
    expect(act("Escape", null)).toBeNull();
  });

  test("a selection the filter hid behaves like no selection", () => {
    expect(act("ArrowDown", "not-visible")).toEqual({
      type: "select",
      spanId: "root",
    });
  });

  test("other keys and empty trees do nothing", () => {
    expect(act("a", "a")).toBeNull();
    expect(
      resolveTreeKeyAction({
        key: "ArrowDown",
        rows: [],
        selectedSpanId: null,
        parentById: new Map(),
      }),
    ).toBeNull();
  });
});

describe("zoom", () => {
  test("clampViewport orders, clamps and enforces a minimum width", () => {
    expect(clampViewport({ start: 0.8, end: 0.2 })).toEqual({
      start: 0.2,
      end: 0.8,
    });
    expect(clampViewport({ start: -1, end: 2 })).toEqual({ start: 0, end: 1 });

    const narrow: TimeViewport = clampViewport({ start: 0.5, end: 0.5 });
    expect(narrow.end - narrow.start).toBeCloseTo(MIN_VIEWPORT_WIDTH, 10);

    const atEdge: TimeViewport = clampViewport({ start: 1, end: 1 });
    expect(atEdge.end).toBe(1);
    expect(atEdge.end - atEdge.start).toBeCloseTo(MIN_VIEWPORT_WIDTH, 10);
  });

  test("isFullViewport", () => {
    expect(isFullViewport(FULL_VIEWPORT)).toBe(true);
    expect(isFullViewport({ start: 0, end: 0.99 })).toBe(false);
  });

  test("getViewportForSpan frames a span with a little air", () => {
    const viewport: TimeViewport = getViewportForSpan({
      span: { startTimeUnixNano: 200, endTimeUnixNano: 400 },
      traceStartUnixNano: 0,
      traceDurationUnixNano: 1000,
    });

    expect(viewport.start).toBeCloseTo(0.19, 5);
    expect(viewport.end).toBeCloseTo(0.41, 5);
    expect(
      getViewportForSpan({
        span: { startTimeUnixNano: 0, endTimeUnixNano: 0 },
        traceStartUnixNano: 0,
        traceDurationUnixNano: 0,
      }),
    ).toEqual(FULL_VIEWPORT);
  });

  test("zoomViewport zooms in and out around a focus and stays inside the trace", () => {
    const zoomedIn: TimeViewport = zoomViewport(FULL_VIEWPORT, 0.5);
    expect(zoomedIn.start).toBeCloseTo(0.25, 10);
    expect(zoomedIn.end).toBeCloseTo(0.75, 10);

    const zoomedOut: TimeViewport = zoomViewport({ start: 0.1, end: 0.3 }, 2);
    expect(zoomedOut.end - zoomedOut.start).toBeCloseTo(0.4, 10);
    expect(zoomedOut.start).toBeGreaterThanOrEqual(0);

    expect(zoomViewport({ start: 0.25, end: 0.75 }, 10)).toEqual(FULL_VIEWPORT);

    const atEnd: TimeViewport = zoomViewport({ start: 0.8, end: 1 }, 2, 1);
    expect(atEnd.end).toBe(1);
    expect(atEnd.end - atEnd.start).toBeCloseTo(0.4, 10);
  });
});
