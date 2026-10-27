import { describe, expect, jest, test } from "@jest/globals";

/*
 * One request recorded twice — by the Kubernetes agent's eBPF tracer and by
 * an SDK in the application — is two SERVER spans under the same caller.
 * buildSpanTree nests the inner recording under the outer one so the
 * request's database calls (seen on the wire by eBPF) and its code-level
 * spans (from the SDK) read as one subtree, and flags the move.
 *
 * The waterfall reads only these two enums from the Span model; the mock
 * keeps this suite free of the model's schema imports.
 */
jest.mock("Common/Models/AnalyticsModels/Span", () => {
  return {
    __esModule: true,
    default: class Span {},
    SpanKind: {
      Server: "SPAN_KIND_SERVER",
      Client: "SPAN_KIND_CLIENT",
      Producer: "SPAN_KIND_PRODUCER",
      Consumer: "SPAN_KIND_CONSUMER",
      Internal: "SPAN_KIND_INTERNAL",
    },
    SpanStatus: { Unset: 0, Ok: 1, Error: 2 },
  };
});

import { SpanKind } from "Common/Models/AnalyticsModels/Span";
import {
  SpanTree,
  WaterfallNode,
  WaterfallSpan,
  buildSpanTree,
  getAncestorIds,
} from "../../FeatureSet/Dashboard/src/Utils/TraceWaterfall";

const MS: number = 1_000_000;
const US: number = 1_000;

function span(
  spanId: string,
  parentSpanId: string,
  startUnixNano: number,
  durationUnixNano: number,
  kind: SpanKind,
  serviceId: string = "svc",
): WaterfallSpan {
  return {
    spanId,
    parentSpanId,
    name: spanId,
    serviceId,
    startTimeUnixNano: startUnixNano,
    endTimeUnixNano: startUnixNano + durationUnixNano,
    durationUnixNano,
    isError: false,
    kind,
  };
}

function childIds(tree: SpanTree, spanId: string): Array<string> {
  return tree.nodesById.get(spanId)!.children.map((node: WaterfallNode) => {
    return node.span.spanId;
  });
}

/*
 * The shape seen on the test cluster when both tracers watch one app:
 *
 *   nginx SERVER (eBPF)
 *   └── nginx CLIENT (eBPF), injects traceparent
 *       ├── app SERVER (eBPF)    0.0 – 20.0 ms
 *       │   ├── redis set        2.0 – 2.4 ms
 *       │   └── SELECT Project   5.0 – 6.0 ms
 *       └── app SERVER (SDK)     0.3 – 19.6 ms, start stamped to the ms
 *           └── ProjectService.findOneBy (INTERNAL)
 */
function eBpfAndSdkSpans(): Array<WaterfallSpan> {
  return [
    span("nginx-server", "", 0, 25 * MS, SpanKind.Server, "nginx"),
    span(
      "nginx-client",
      "nginx-server",
      100 * US,
      22 * MS,
      SpanKind.Client,
      "nginx",
    ),
    span(
      "app-ebpf",
      "nginx-client",
      MS,
      20 * MS,
      SpanKind.Server,
      "oneuptime-app",
    ),
    span(
      "redis-set",
      "app-ebpf",
      3 * MS,
      400 * US,
      SpanKind.Client,
      "oneuptime-app",
    ),
    span("select", "app-ebpf", 6 * MS, MS, SpanKind.Client, "oneuptime-app"),
    // The SDK stamps start times to the millisecond: 1.3 ms reads as 1 ms.
    span(
      "app-sdk",
      "nginx-client",
      MS,
      19 * MS + 600 * US,
      SpanKind.Server,
      "api",
    ),
    span("find-one", "app-sdk", 5 * MS, 2 * MS, SpanKind.Internal, "api"),
  ];
}

describe("buildSpanTree with one request recorded twice", () => {
  test("nests the SDK's server span inside the eBPF one, under their common caller", () => {
    const tree: SpanTree = buildSpanTree(eBpfAndSdkSpans());

    expect(childIds(tree, "nginx-client")).toEqual(["app-ebpf"]);
    expect(childIds(tree, "app-ebpf")).toEqual([
      "app-sdk",
      "redis-set",
      "select",
    ]);
    expect(childIds(tree, "app-sdk")).toEqual(["find-one"]);
    expect(getAncestorIds(tree, "find-one")).toEqual([
      "nginx-server",
      "nginx-client",
      "app-ebpf",
      "app-sdk",
    ]);
  });

  test("flags only the moved span, and nothing becomes an orphan", () => {
    const tree: SpanTree = buildSpanTree(eBpfAndSdkSpans());

    const flagged: Array<string> = [...tree.nodesById.values()]
      .filter((node: WaterfallNode) => {
        return node.isSameRequest;
      })
      .map((node: WaterfallNode) => {
        return node.span.spanId;
      });
    expect(flagged).toEqual(["app-sdk"]);
    expect(
      [...tree.nodesById.values()].some((node: WaterfallNode) => {
        return node.isOrphan;
      }),
    ).toBe(false);
    expect(tree.roots).toHaveLength(1);
    expect(tree.spanCount).toBe(7);
    expect(tree.nodesById.get("nginx-server")!.descendantCount).toBe(6);
    expect(tree.maxDepth).toBe(4);
  });

  test("nests whichever recording is inside the other, in any input order", () => {
    const reversed: Array<WaterfallSpan> = [...eBpfAndSdkSpans()].reverse();
    const tree: SpanTree = buildSpanTree(reversed);

    expect(childIds(tree, "nginx-client")).toEqual(["app-ebpf"]);
    expect(tree.nodesById.get("app-sdk")!.isSameRequest).toBe(true);
  });

  test("keeps one of two recordings with identical times as the outer one", () => {
    const tree: SpanTree = buildSpanTree([
      span("caller", "", 0, 10 * MS, SpanKind.Client),
      span("first", "caller", MS, 5 * MS, SpanKind.Server),
      span("second", "caller", MS, 5 * MS, SpanKind.Server),
    ]);

    expect(childIds(tree, "caller")).toEqual(["first"]);
    expect(childIds(tree, "first")).toEqual(["second"]);
  });
});

describe("buildSpanTree leaves real siblings alone", () => {
  test("a retry: a second SERVER span after the first, not inside it", () => {
    const tree: SpanTree = buildSpanTree([
      span("caller", "", 0, 30 * MS, SpanKind.Client),
      span("attempt-1", "caller", MS, 10 * MS, SpanKind.Server),
      span("attempt-2", "caller", 15 * MS, 10 * MS, SpanKind.Server),
    ]);

    expect(childIds(tree, "caller")).toEqual(["attempt-1", "attempt-2"]);
    expect(tree.nodesById.get("attempt-2")!.isSameRequest).toBeUndefined();
  });

  test("overlapping SERVER spans that do not nest", () => {
    const tree: SpanTree = buildSpanTree([
      span("caller", "", 0, 30 * MS, SpanKind.Client),
      span("left", "caller", MS, 10 * MS, SpanKind.Server),
      span("right", "caller", 6 * MS, 10 * MS, SpanKind.Server),
    ]);

    expect(childIds(tree, "caller")).toEqual(["left", "right"]);
  });

  test("a request's concurrent client calls", () => {
    const tree: SpanTree = buildSpanTree([
      span("request", "", 0, 30 * MS, SpanKind.Server),
      span("call-a", "request", MS, 20 * MS, SpanKind.Client),
      span("call-b", "request", 2 * MS, 5 * MS, SpanKind.Client),
    ]);

    expect(childIds(tree, "request")).toEqual(["call-a", "call-b"]);
  });

  test("a message's several consumers", () => {
    const tree: SpanTree = buildSpanTree([
      span("publish", "", 0, 2 * MS, SpanKind.Producer),
      span("consumer-a", "publish", 3 * MS, 20 * MS, SpanKind.Consumer),
      span("consumer-b", "publish", 4 * MS, 5 * MS, SpanKind.Consumer),
    ]);

    expect(childIds(tree, "publish")).toEqual(["consumer-a", "consumer-b"]);
  });

  test("SERVER spans whose common parent was never received", () => {
    const tree: SpanTree = buildSpanTree([
      span("app-ebpf", "missing", MS, 20 * MS, SpanKind.Server),
      span("app-sdk", "missing", 2 * MS, 10 * MS, SpanKind.Server),
    ]);

    expect(
      tree.roots.map((node: WaterfallNode) => {
        return node.span.spanId;
      }),
    ).toEqual(["app-ebpf", "app-sdk"]);
    expect(tree.nodesById.get("app-sdk")!.isOrphan).toBe(true);
    expect(tree.nodesById.get("app-sdk")!.isSameRequest).toBeUndefined();
  });

  test("root SERVER spans of a trace, which have no caller to share", () => {
    const tree: SpanTree = buildSpanTree([
      span("root-a", "", 0, 20 * MS, SpanKind.Server),
      span("root-b", "", MS, 5 * MS, SpanKind.Server),
    ]);

    expect(tree.roots).toHaveLength(2);
  });

  test("a SERVER span nested under its parent by its own parentSpanId is untouched", () => {
    const tree: SpanTree = buildSpanTree([
      span("gateway", "", 0, 20 * MS, SpanKind.Server),
      span("gateway-call", "gateway", MS, 18 * MS, SpanKind.Client),
      span("backend", "gateway-call", 2 * MS, 15 * MS, SpanKind.Server),
    ]);

    expect(getAncestorIds(tree, "backend")).toEqual([
      "gateway",
      "gateway-call",
    ]);
    expect(tree.nodesById.get("backend")!.isSameRequest).toBeUndefined();
  });
});
