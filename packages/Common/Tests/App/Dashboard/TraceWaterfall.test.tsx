import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import * as React from "react";
import TraceWaterfall from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceDetail/TraceWaterfall";
import { TraceServiceInfo } from "../../../../App/FeatureSet/Dashboard/src/Utils/TraceDetailPresentation";
import {
  FULL_VIEWPORT,
  SpanTree,
  SpanVisibility,
  TimeViewport,
  WaterfallRow,
  WaterfallSpan,
  buildSpanTree,
  filterSpanTree,
  flattenVisibleRows,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/TraceWaterfall";
import { SpanKind } from "../../../Models/AnalyticsModels/Span";

/*
 * The waterfall component: what each row shows, how it hands selection,
 * collapse and zoom back to the explorer, keyboard navigation, and that only
 * the rows in view are in the DOM.
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
    serviceId: "svc-gateway",
    startTimeUnixNano: startMs * MS,
    endTimeUnixNano: (startMs + durationMs) * MS,
    durationUnixNano: durationMs * MS,
    isError: false,
    kind: SpanKind.Internal,
    ...overrides,
  };
}

const SERVICES: Map<string, TraceServiceInfo> = new Map([
  ["svc-gateway", { id: "svc-gateway", name: "api-gateway", color: "#6366f1" }],
  [
    "svc-inventory",
    { id: "svc-inventory", name: "inventory-service", color: "#f59e0b" },
  ],
]);

function checkoutTree(): SpanTree {
  return buildSpanTree([
    span("root", "", 0, 1000, { name: "POST /api/v1/checkout" }),
    span("auth", "root", 5, 20, { name: "auth.verifyToken" }),
    span("reserve", "root", 100, 300, {
      name: "POST /reserve",
      serviceId: "svc-inventory",
      isError: true,
    }),
    span("update", "reserve", 150, 200, {
      name: "UPDATE stock",
      serviceId: "svc-inventory",
    }),
  ]);
}

type Callbacks = {
  onSelectSpan: Mock<(spanId: string | null) => void>;
  onSetCollapsed: Mock<(spanId: string, isCollapsed: boolean) => void>;
  onExpandAll: Mock<() => void>;
  onCollapseAll: Mock<() => void>;
  onViewportChange: Mock<(viewport: TimeViewport) => void>;
};

let callbacks: Callbacks;

beforeEach(() => {
  callbacks = {
    onSelectSpan: jest.fn<(spanId: string | null) => void>(),
    onSetCollapsed: jest.fn<(spanId: string, isCollapsed: boolean) => void>(),
    onExpandAll: jest.fn<() => void>(),
    onCollapseAll: jest.fn<() => void>(),
    onViewportChange: jest.fn<(viewport: TimeViewport) => void>(),
  };
});

afterEach(() => {
  cleanup();
});

interface RenderOptions {
  tree?: SpanTree;
  collapsed?: Array<string>;
  visibility?: Map<string, SpanVisibility> | null;
  selectedSpanId?: string | null;
  linkedSpanIds?: Array<string>;
  criticalPathSpanIds?: Array<string> | null;
  searchText?: string;
  viewport?: TimeViewport;
}

function renderWaterfall(options: RenderOptions = {}): {
  rerender: (next: RenderOptions) => void;
} {
  const build: (renderOptions: RenderOptions) => React.ReactElement = (
    renderOptions: RenderOptions,
  ): React.ReactElement => {
    const tree: SpanTree = renderOptions.tree || checkoutTree();
    const rows: Array<WaterfallRow> = flattenVisibleRows(
      tree,
      new Set(renderOptions.collapsed || []),
      renderOptions.visibility || null,
    );
    return (
      <TraceWaterfall
        tree={tree}
        rows={rows}
        serviceInfoById={SERVICES}
        selectedSpanId={renderOptions.selectedSpanId ?? null}
        onSelectSpan={callbacks.onSelectSpan}
        onSetCollapsed={callbacks.onSetCollapsed}
        onExpandAll={callbacks.onExpandAll}
        onCollapseAll={callbacks.onCollapseAll}
        linkedSpanIds={new Set(renderOptions.linkedSpanIds || [])}
        criticalPathSpanIds={
          renderOptions.criticalPathSpanIds
            ? new Set(renderOptions.criticalPathSpanIds)
            : null
        }
        searchText={renderOptions.searchText || ""}
        viewport={renderOptions.viewport || FULL_VIEWPORT}
        onViewportChange={callbacks.onViewportChange}
        revealRequest={0}
        emptyMessage="No spans match the current filters."
      />
    );
  };

  const result: ReturnType<typeof render> = render(build(options));

  return {
    rerender: (next: RenderOptions) => {
      result.rerender(build(next));
    },
  };
}

function row(spanId: string): HTMLElement {
  return document.querySelector(`[data-span-id="${spanId}"]`) as HTMLElement;
}

describe("rows", () => {
  test("draws one tree item per span, in tree order, with its level", () => {
    renderWaterfall();

    const items: Array<HTMLElement> = screen.getAllByRole("treeitem");
    expect(
      items.map((item: HTMLElement) => {
        return item.getAttribute("data-span-id");
      }),
    ).toEqual(["root", "auth", "reserve", "update"]);
    expect(row("root")).toHaveAttribute("aria-level", "1");
    expect(row("update")).toHaveAttribute("aria-level", "3");
    expect(row("root")).toHaveAttribute("aria-expanded", "true");
    expect(row("auth")).not.toHaveAttribute("aria-expanded");
  });

  test("shows each span's name and duration", () => {
    renderWaterfall();

    expect(
      within(row("root")).getByText("POST /api/v1/checkout"),
    ).toBeInTheDocument();
    expect(within(row("root")).getByText("1 s")).toBeInTheDocument();
    expect(within(row("update")).getByText("200 ms")).toBeInTheDocument();
  });

  test("names the service only where it changes from the parent", () => {
    renderWaterfall();

    expect(within(row("root")).getByText("api-gateway")).toBeInTheDocument();
    expect(
      within(row("auth")).queryByText("api-gateway"),
    ).not.toBeInTheDocument();
    expect(
      within(row("reserve")).getByText("inventory-service"),
    ).toBeInTheDocument();
    expect(
      within(row("update")).queryByText("inventory-service"),
    ).not.toBeInTheDocument();
  });

  test("marks error spans and colours bars by service", () => {
    renderWaterfall();

    expect(
      within(row("reserve")).getByTitle("This span has an error status"),
    ).toBeInTheDocument();
    const errorBar: HTMLElement = within(row("reserve")).getByTestId(
      "trace-waterfall-bar",
    );
    expect(errorBar).toHaveAttribute("data-error", "true");
    expect(errorBar.style.backgroundColor).toBe("rgb(245, 158, 11)");
    expect(
      within(row("auth")).getByTestId("trace-waterfall-bar"),
    ).not.toHaveAttribute("data-error");
  });

  test("positions bars on the trace's time axis", () => {
    renderWaterfall();

    expect(
      within(row("root")).getByTestId("trace-waterfall-bar").style.left,
    ).toBe("0%");
    expect(
      within(row("reserve")).getByTestId("trace-waterfall-bar").style.left,
    ).toBe("10%");
    expect(
      within(row("update")).getByTestId("trace-waterfall-bar").style.left,
    ).toBe("15%");
  });

  test("labels the axis in one unit", () => {
    renderWaterfall();

    expect(
      screen.getAllByTestId("trace-axis-tick").map((tick: HTMLElement) => {
        return tick.textContent;
      }),
    ).toEqual(["0", "0.2 s", "0.4 s", "0.6 s", "0.8 s", "1 s"]);
  });

  test("a collapsed span shows how many spans it hides", () => {
    renderWaterfall({ collapsed: ["reserve"] });

    expect(row("update")).toBeNull();
    expect(row("reserve")).toHaveAttribute("aria-expanded", "false");
    expect(within(row("reserve")).getByText("+1")).toBeInTheDocument();
  });

  test("filter context rows are marked and not highlighted; matches are", () => {
    const tree: SpanTree = checkoutTree();
    renderWaterfall({
      tree,
      visibility: filterSpanTree(tree, (item: WaterfallSpan) => {
        return item.spanId === "update";
      }),
      searchText: "stock",
    });

    expect(screen.getAllByRole("treeitem")).toHaveLength(3);
    expect(row("root")).toHaveAttribute("data-context", "true");
    expect(row("update")).not.toHaveAttribute("data-context");
    const mark: HTMLElement = within(row("update")).getByText("stock");
    expect(mark.tagName).toBe("MARK");
  });

  test("an empty filter result says so", () => {
    const tree: SpanTree = checkoutTree();
    renderWaterfall({
      tree,
      visibility: filterSpanTree(tree, () => {
        return false;
      }),
    });

    expect(screen.getByTestId("trace-waterfall-empty")).toHaveTextContent(
      "No spans match the current filters.",
    );
    expect(screen.queryAllByRole("treeitem")).toHaveLength(0);
  });

  test("a span named by the page link is flagged", () => {
    renderWaterfall({ linkedSpanIds: ["update"] });

    expect(row("update")).toHaveAttribute("data-linked", "true");
    expect(within(row("update")).getByText("Linked")).toBeInTheDocument();
    expect(row("auth")).not.toHaveAttribute("data-linked");
  });

  test("the selected span is marked selected", () => {
    renderWaterfall({ selectedSpanId: "auth" });

    expect(row("auth")).toHaveAttribute("aria-selected", "true");
    expect(row("auth")).toHaveAttribute("data-selected", "true");
    expect(row("root")).toHaveAttribute("aria-selected", "false");
  });

  test("the critical path dims spans that are not on it", () => {
    renderWaterfall({ criticalPathSpanIds: ["root", "reserve", "update"] });

    const offPath: HTMLElement = within(row("auth")).getByTestId(
      "trace-waterfall-bar",
    ).parentElement as HTMLElement;
    const onPath: HTMLElement = within(row("update")).getByTestId(
      "trace-waterfall-bar",
    ).parentElement as HTMLElement;
    expect(offPath.className).toContain("opacity-30");
    expect(onPath.className).not.toContain("opacity-30");
    expect(
      within(row("update")).getByTestId("trace-waterfall-bar").style.boxShadow,
    ).toContain("rgba(17, 24, 39, 0.7)");
  });

  test("spans outside a zoomed window are drawn as edge markers", () => {
    renderWaterfall({ viewport: { start: 0.5, end: 0.6 } });

    expect(
      within(row("auth")).queryByTestId("trace-waterfall-bar"),
    ).not.toBeInTheDocument();
    expect(within(row("auth")).getByText("◂")).toBeInTheDocument();
    expect(
      within(row("root")).getByTestId("trace-waterfall-bar"),
    ).toBeInTheDocument();
  });
});

describe("interaction", () => {
  test("clicking a row selects it; clicking the selected row clears it", () => {
    const { rerender } = renderWaterfall();

    fireEvent.click(row("reserve"));
    expect(callbacks.onSelectSpan).toHaveBeenLastCalledWith("reserve");

    rerender({ selectedSpanId: "reserve" });
    fireEvent.click(row("reserve"));
    expect(callbacks.onSelectSpan).toHaveBeenLastCalledWith(null);
  });

  test("the chevron collapses and expands without selecting", () => {
    const { rerender } = renderWaterfall();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse POST /reserve" }),
    );
    expect(callbacks.onSetCollapsed).toHaveBeenLastCalledWith("reserve", true);
    expect(callbacks.onSelectSpan).not.toHaveBeenCalled();

    rerender({ collapsed: ["reserve"] });
    fireEvent.click(
      screen.getByRole("button", { name: "Expand POST /reserve" }),
    );
    expect(callbacks.onSetCollapsed).toHaveBeenLastCalledWith("reserve", false);
  });

  test("expand all and collapse all", () => {
    renderWaterfall();

    fireEvent.click(screen.getByTestId("trace-expand-all"));
    fireEvent.click(screen.getByTestId("trace-collapse-all"));

    expect(callbacks.onExpandAll).toHaveBeenCalledTimes(1);
    expect(callbacks.onCollapseAll).toHaveBeenCalledTimes(1);
  });

  test("arrow keys move the selection and open or close spans", () => {
    const { rerender } = renderWaterfall();
    const tree: HTMLElement = screen.getByRole("tree");

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    expect(callbacks.onSelectSpan).toHaveBeenLastCalledWith("root");

    rerender({ selectedSpanId: "reserve" });
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    expect(callbacks.onSelectSpan).toHaveBeenLastCalledWith("update");
    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(callbacks.onSetCollapsed).toHaveBeenLastCalledWith("reserve", true);
    fireEvent.keyDown(tree, { key: "Escape" });
    expect(callbacks.onSelectSpan).toHaveBeenLastCalledWith(null);

    rerender({ selectedSpanId: "reserve", collapsed: ["reserve"] });
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    expect(callbacks.onSetCollapsed).toHaveBeenLastCalledWith("reserve", false);
    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(callbacks.onSelectSpan).toHaveBeenLastCalledWith("root");
  });

  test("zoom buttons narrow and widen the window, and reset returns to the whole trace", () => {
    const { rerender } = renderWaterfall();

    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    expect(screen.queryByTestId("trace-reset-zoom")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(callbacks.onViewportChange).toHaveBeenLastCalledWith({
      start: 0.25,
      end: 0.75,
    });

    rerender({ viewport: { start: 0.25, end: 0.75 } });
    expect(screen.getByTestId("trace-minimap-window")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(callbacks.onViewportChange).toHaveBeenLastCalledWith({
      start: 0,
      end: 1,
    });
    fireEvent.click(screen.getByTestId("trace-reset-zoom"));
    expect(callbacks.onViewportChange).toHaveBeenLastCalledWith({
      start: 0,
      end: 1,
    });
  });

  test("the name column resizes from the keyboard", () => {
    renderWaterfall();
    const separator: HTMLElement = screen.getByRole("separator");

    expect(separator).toHaveAttribute("aria-valuenow", "40");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator).toHaveAttribute("aria-valuenow", "44");
    for (let index: number = 0; index < 30; index++) {
      fireEvent.keyDown(separator, { key: "ArrowLeft" });
    }
    expect(separator).toHaveAttribute("aria-valuenow", "18");
  });
});

describe("virtualisation", () => {
  function largeTree(count: number): SpanTree {
    const spans: Array<WaterfallSpan> = [span("root", "", 0, count)];
    for (let index: number = 0; index < count; index++) {
      spans.push(
        span(`child-${index}`, "root", index, 1, {
          name: `work item ${index}`,
        }),
      );
    }
    return buildSpanTree(spans);
  }

  test("only the rows in view are rendered", () => {
    renderWaterfall({ tree: largeTree(5000) });

    const rendered: number = screen.getAllByRole("treeitem").length;
    expect(rendered).toBeGreaterThan(10);
    expect(rendered).toBeLessThan(60);
    expect(screen.getByText("work item 0")).toBeInTheDocument();
    expect(screen.queryByText("work item 4999")).not.toBeInTheDocument();
  });

  test("scrolling renders the rows scrolled to", () => {
    renderWaterfall({ tree: largeTree(5000) });
    const body: HTMLElement = screen.getByTestId("trace-waterfall-body");

    Object.defineProperty(body, "scrollTop", {
      value: 2500 * 32,
      writable: true,
      configurable: true,
    });
    fireEvent.scroll(body);

    expect(screen.queryByText("work item 0")).not.toBeInTheDocument();
    expect(screen.getByText("work item 2500")).toBeInTheDocument();
    expect(row("child-2500").style.top).toBe(`${2501 * 32}px`);
  });

  test("selecting a far away span scrolls it into view", () => {
    const tree: SpanTree = largeTree(5000);
    const { rerender } = renderWaterfall({ tree });

    expect(row("child-4000")).toBeNull();

    rerender({ tree, selectedSpanId: "child-4000" });

    expect(row("child-4000")).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("work item 0")).not.toBeInTheDocument();
  });
});
