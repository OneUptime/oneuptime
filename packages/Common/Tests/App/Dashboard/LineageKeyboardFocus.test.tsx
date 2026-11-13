import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import React, { ReactElement, ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE KEYBOARD'S FOCUS STAYS IN VIEW ON A LINEAGE DRAWING (#6779).
 *
 * A drawing too wide to read whole opens on its table, its pipeline or an
 * alert's cause, at a zoom its names can be read at, so most cards are off
 * the view. Tab still reaches every card and count on it. Each one the
 * keyboard's focus goes to is brought into view with a pan of React Flow's
 * viewport - the least that shows it whole, 24px inside the canvas, from
 * whichever side it was off - never a scroll of React Flow's element, which
 * would slide the drawing and its controls off the canvas while React Flow
 * thinks its view never moved; a scroll the browser makes anyway is turned
 * into the same pan. Focus a pointer gives is left alone: the card is under
 * the pointer. The view is the reader's once it followed the focus: the
 * canvas resizing no longer fits the drawing again, and tables a count draws
 * keep the card pressed where it is, as after a drag.
 *
 * On a table's Lineage tab, a pipeline's page and a data alert's Lineage
 * card. The API is mocked; React Flow is the stand-in of LineageFlowStandIn,
 * whose store pans the view as React Flow's panBy does. jsdom lays nothing
 * out, so where the canvas and each card and count are on screen is said
 * here (layOut), from the view the stand-in shows; nor does it tell the
 * keyboard's focus from a pointer's, so the tests say how focus came
 * (focusCameBy) and :focus-visible answers from it, as a browser's does.
 */

const getTableLineageMock: MockFunction = getJestMockFunction();
const getPipelineLineageMock: MockFunction = getJestMockFunction();
const getAlertLineageMock: MockFunction = getJestMockFunction();
const expandLineageMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi",
  () => {
    return {
      __esModule: true,
      default: {
        getTableLineage: (...args: Array<any>) => {
          return getTableLineageMock(...args);
        },
        getPipelineLineage: (...args: Array<any>) => {
          return getPipelineLineageMock(...args);
        },
        getAlertLineage: (...args: Array<any>) => {
          return getAlertLineageMock(...args);
        },
        expandLineage: (...args: Array<any>) => {
          return expandLineageMock(...args);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
        dataTestId?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          {
            href: props.to?.toString(),
            className: props.className,
            "data-testid": props.dataTestId,
          },
          props.children,
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Pipelines",
  () => {
    return {
      __esModule: true,
      getRunStatePill: (state: string | undefined): ReactElement => {
        return React.createElement(
          "span",
          { "data-testid": "run-state" },
          state || "No run yet",
        );
      },
    };
  },
);

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("11111111-1111-4111-8111-111111111111");
      },
    },
  };
});

jest.mock("reactflow", () => {
  return jest.requireActual("./LineageFlowStandIn");
});

/*
 * The components come last: requiring them runs the factories above, which
 * use ObjectID.
 */
import ObjectID from "../../../Types/ObjectID";
import { DataAssetFreshness } from "../../../Types/DataObservability/DataAssetFreshness";
import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";
import DataAssetLineageSource from "../../../Types/DataObservability/DataAssetLineageSource";
import { DataLineageExpansion } from "../../../Types/DataObservability/DataLineageExpansion";
import {
  DataAlertLineageAnswer,
  DataLineageEdgeKind,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  getLineageEdgeId,
} from "../../../Types/DataObservability/DataTableLineage";
import TableLineageDiagram from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/TableLineageDiagram";
import PipelineLineageDiagram from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/PipelineLineageDiagram";
import AlertLineageDiagram from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/AlertLineageDiagram";
import {
  LINEAGE_CARD_HEIGHT,
  LINEAGE_CARD_WIDTH,
  LINEAGE_READABLE_ZOOM,
  LineageViewport,
  getLineageViewport,
  getLineageViewportAfterExpanding,
  layoutLineage,
  mergeLineageExpansion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageGraphModel";
import {
  FOCUS_REVEAL_PADDING_PX,
  WINDOW_REFOCUS_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/FlowKeyboardFocus";
import {
  currentViewport,
  flowDomNode,
  flowProps,
  moveView,
  pansMade,
  resetFlowStandIn,
  setViewportCalls,
} from "./LineageFlowStandIn";

const ALERT: string = "55555555-5555-4555-8555-000000000001";
const TABLE: string = "22222222-2222-4222-8222-000000000001";
const RAW: string = "22222222-2222-4222-8222-000000000002";
const MART: string = "22222222-2222-4222-8222-000000000003";
const FORECAST: string = "22222222-2222-4222-8222-000000000004";
const CUSTOMERS: string = "22222222-2222-4222-8222-000000000005";
const ETL: string = "33333333-3333-4333-8333-000000000001";
const ETL_NODE: string = `pipeline:${ETL}`;

// The tables of the column a table is built from, one above the other.
function staging(index: number): string {
  return `66666666-6666-4666-8666-${index.toString().padStart(12, "0")}`;
}

// The tables a count draws.
function more(index: number): string {
  return `77777777-7777-4777-8777-${index.toString().padStart(12, "0")}`;
}

function table(
  id: string,
  side: DataLineageSide,
  depth: number,
  fields: Partial<DataTableLineageNode> = {},
): DataTableLineageNode {
  return {
    id: `table:${id}`,
    kind: DataLineageNodeKind.Table,
    side,
    depth,
    name: `public.${id.slice(-4)}`,
    dataAssetId: id,
    database: "Warehouse",
    assetKind: DataAssetKind.Table,
    freshness: DataAssetFreshness.Fresh,
    lateBySeconds: 0,
    isDropped: false,
    openAlertCount: 0,
    hiddenUpstreamCount: 0,
    hiddenDownstreamCount: 0,
    ...fields,
  };
}

function arrow(
  kind: DataLineageEdgeKind,
  source: string,
  target: string,
): DataTableLineageEdge {
  return {
    id: getLineageEdgeId({ kind, source, target }),
    source,
    target,
    kind,
    seenIn: [DataAssetLineageSource.Pipeline],
    pipelines: [],
    lastSeenAt: null,
  };
}

function feeds(source: string, target: string): DataTableLineageEdge {
  return arrow(DataLineageEdgeKind.Feeds, `table:${source}`, `table:${target}`);
}

// How many tables the column the table is built from holds.
const STAGING_TABLES: number = 7;

/*
 * Wide and tall: raw.orders (four more upstream not drawn) -> seven
 * staging tables, one above the other -> the table -> mart.revenue (three
 * more downstream not drawn) -> mart.forecast. Five columns: far wider
 * than a phone's canvas, and taller, at the zoom names are read at.
 */
function wideLineage(): DataTableLineage {
  const nodes: Array<DataTableLineageNode> = [
    table(TABLE, DataLineageSide.Focus, 0, { name: "analytics.orders" }),
    table(RAW, DataLineageSide.Upstream, -2, {
      name: "raw.orders",
      hiddenUpstreamCount: 4,
    }),
    table(MART, DataLineageSide.Downstream, 1, {
      name: "mart.revenue",
      hiddenDownstreamCount: 3,
    }),
    table(FORECAST, DataLineageSide.Downstream, 2, {
      name: "mart.forecast",
    }),
  ];
  const edges: Array<DataTableLineageEdge> = [
    feeds(TABLE, MART),
    feeds(MART, FORECAST),
  ];

  for (let index: number = 1; index <= STAGING_TABLES; index++) {
    nodes.push(
      table(staging(index), DataLineageSide.Upstream, -1, {
        name: `staging.orders_${index}`,
      }),
    );
    edges.push(feeds(RAW, staging(index)));
    edges.push(feeds(staging(index), TABLE));
  }

  return {
    focusNodeId: `table:${TABLE}`,
    depth: 3,
    nodes,
    edges,
    hiddenDashboardCount: 0,
    isTruncated: false,
  };
}

/*
 * Four staging tables, one above the other -> the table -> mart.revenue
 * (two more downstream not drawn): on a wide canvas of the least height
 * it reads whole, fitted to the canvas's height.
 */
function fittedLineage(): DataTableLineage {
  const nodes: Array<DataTableLineageNode> = [
    table(TABLE, DataLineageSide.Focus, 0, { name: "analytics.orders" }),
    table(MART, DataLineageSide.Downstream, 1, {
      name: "mart.revenue",
      hiddenDownstreamCount: 2,
    }),
  ];
  const edges: Array<DataTableLineageEdge> = [feeds(TABLE, MART)];

  for (let index: number = 1; index <= 4; index++) {
    nodes.push(
      table(staging(index), DataLineageSide.Upstream, -1, {
        name: `staging.orders_${index}`,
      }),
    );
    edges.push(feeds(staging(index), TABLE));
  }

  return {
    focusNodeId: `table:${TABLE}`,
    depth: 3,
    nodes,
    edges,
    hiddenDashboardCount: 0,
    isTruncated: false,
  };
}

// The two more tables built from mart.revenue: all of them.
function martExpansion(): DataLineageExpansion {
  return {
    nodeId: `table:${MART}`,
    side: DataLineageSide.Downstream,
    hiddenCount: 0,
    nodes: [1, 2].map((index: number): DataTableLineageNode => {
      return table(more(index), DataLineageSide.Downstream, 2, {
        name: `mart.revenue_${index}`,
      });
    }),
    edges: [1, 2].map((index: number): DataTableLineageEdge => {
      return feeds(MART, more(index));
    }),
    hiddenDashboardCount: 0,
    isTruncated: false,
  };
}

// orders_etl reads raw.orders and raw.customers, writes the table, which builds mart.revenue.
function pipelineLineage(): DataTableLineage {
  return {
    focusNodeId: ETL_NODE,
    depth: 2,
    nodes: [
      {
        id: ETL_NODE,
        kind: DataLineageNodeKind.Pipeline,
        side: DataLineageSide.Focus,
        depth: 0,
        name: "orders_etl",
        dataPipelineId: ETL,
        jobNamespace: "airflow",
        lastRunState: "COMPLETE",
        lastRunStartedAt: null,
        lastErrorMessage: null,
        hiddenUpstreamCount: 0,
        hiddenDownstreamCount: 0,
      },
      table(RAW, DataLineageSide.Upstream, -1, { name: "raw.orders" }),
      table(CUSTOMERS, DataLineageSide.Upstream, -1, {
        name: "raw.customers",
      }),
      table(TABLE, DataLineageSide.Downstream, 1, {
        name: "analytics.orders",
      }),
      table(MART, DataLineageSide.Downstream, 2, { name: "mart.revenue" }),
    ],
    edges: [
      arrow(DataLineageEdgeKind.Reads, `table:${RAW}`, ETL_NODE),
      arrow(DataLineageEdgeKind.Reads, `table:${CUSTOMERS}`, ETL_NODE),
      arrow(DataLineageEdgeKind.Writes, ETL_NODE, `table:${TABLE}`),
      feeds(TABLE, MART),
    ],
    hiddenDashboardCount: 0,
    isTruncated: false,
  };
}

/*
 * The alert is on the table; raw.orders, two steps up, caused it, and it
 * caused one on mart.forecast, two steps down.
 */
function alertAnswer(): DataAlertLineageAnswer {
  const lineage: DataTableLineage = wideLineage();
  const way: Array<string> = [
    `table:${RAW}`,
    `table:${staging(1)}`,
    `table:${TABLE}`,
    `table:${MART}`,
    `table:${FORECAST}`,
  ];

  return {
    lineage: {
      ...lineage,
      highlight: {
        nodeIds: way,
        edgeIds: [
          feeds(RAW, staging(1)).id,
          feeds(staging(1), TABLE).id,
          feeds(TABLE, MART).id,
          feeds(MART, FORECAST).id,
        ].sort(),
        causeNodeIds: [`table:${RAW}`],
        consequenceNodeIds: [`table:${FORECAST}`],
        dataPipelineIds: [],
        causeDataPipelineIds: [],
      },
    },
    hasCause: true,
    isCauseDrawn: true,
    consequenceCount: 1,
    drawnConsequenceCount: 1,
    column: null,
  };
}

/*
 * WHERE THINGS ARE ON SCREEN. The canvas sits at (CANVAS_LEFT, CANVAS_TOP)
 * at the size a test gives it: the drawing's figure, React Flow's element
 * in it and the renderer inside that all cover it. A card is where the
 * view the stand-in shows puts its box, and a count is across its card's
 * outer edge, its inner edge 8px in; both move with a scroll of React
 * Flow's element, as a browser moves them.
 */
const CANVAS_LEFT: number = 40;
const CANVAS_TOP: number = 120;
// A phone's canvas: the card's width less its padding, at the canvas's least height.
const PHONE_CANVAS: { width: number; height: number } = {
  width: 400,
  height: 360,
};
const COUNT_WIDTH: number = 27;
const COUNT_HEIGHT: number = 21;
const COUNT_REACH: number = 8;

let canvas: { width: number; height: number } = { ...PHONE_CANVAS };

interface FlowBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function screenRect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  const box: Omit<DOMRect, "toJSON"> = {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };

  return {
    ...box,
    toJSON: (): Omit<DOMRect, "toJSON"> => {
      return box;
    },
  };
}

function canvasRect(): DOMRect {
  return screenRect(CANVAS_LEFT, CANVAS_TOP, canvas.width, canvas.height);
}

function flowScroll(): { left: number; top: number } {
  const domNode: HTMLDivElement | null = flowDomNode();

  return { left: domNode?.scrollLeft || 0, top: domNode?.scrollTop || 0 };
}

// A box of the drawing on screen, through the view shown and React Flow's element's scroll.
function onScreen(box: FlowBox): DOMRect {
  const view: LineageViewport = currentViewport();
  const scroll: { left: number; top: number } = flowScroll();

  return screenRect(
    CANVAS_LEFT + view.x + box.x * view.zoom - scroll.left,
    CANVAS_TOP + view.y + box.y * view.zoom - scroll.top,
    box.width * view.zoom,
    box.height * view.zoom,
  );
}

function nodeBox(nodeId: string): FlowBox {
  const node: { id: string; position: { x: number; y: number } } | undefined = (
    flowProps()?.nodes || []
  ).find((candidate: { id: string }): boolean => {
    return candidate.id === nodeId;
  });

  expect(node).toBeDefined();

  return {
    x: node!.position.x,
    y: node!.position.y,
    width: LINEAGE_CARD_WIDTH,
    height: LINEAGE_CARD_HEIGHT,
  };
}

function countBox(nodeId: string, side: "left" | "right"): FlowBox {
  const card: FlowBox = nodeBox(nodeId);
  const top: number = card.y + (card.height - COUNT_HEIGHT) / 2;

  return {
    x:
      side === "left"
        ? card.x + COUNT_REACH - COUNT_WIDTH
        : card.x + card.width - COUNT_REACH,
    y: top,
    width: COUNT_WIDTH,
    height: COUNT_HEIGHT,
  };
}

let realGetBoundingClientRect: () => DOMRect;

function layOut(): void {
  HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement,
  ): DOMRect {
    if (
      this.getAttribute("data-testid") === "lineage-graph" ||
      this.classList.contains("react-flow")
    ) {
      return canvasRect();
    }

    if (this.classList.contains("react-flow__renderer")) {
      const scroll: { left: number; top: number } = flowScroll();

      return screenRect(
        CANVAS_LEFT - scroll.left,
        CANVAS_TOP - scroll.top,
        canvas.width,
        canvas.height,
      );
    }

    const wrapper: Element | null = this.closest('[data-testid^="flow-node-"]');

    if (wrapper) {
      const nodeId: string = wrapper
        .getAttribute("data-testid")!
        .slice("flow-node-".length);
      const testId: string | null = this.getAttribute("data-testid");

      if (testId === "lineage-hidden-left") {
        return onScreen(countBox(nodeId, "left"));
      }

      if (testId === "lineage-hidden-right") {
        return onScreen(countBox(nodeId, "right"));
      }

      return onScreen(nodeBox(nodeId));
    }

    return screenRect(0, 0, 0, 0);
  };
}

/*
 * How focus last came to an element: a key (Tab), or a pointer pressing it.
 * :focus-visible matches the focused element only for the first, as a
 * browser's does; jsdom parses it but never matches it.
 */
let focusCameBy: "keyboard" | "pointer" = "keyboard";
let matchesSpy: SpyInstance<(selectors: string) => boolean>;

function answerFocusVisible(): SpyInstance<(selectors: string) => boolean> {
  const jsdomMatches: (selectors: string) => boolean =
    Element.prototype.matches;

  return jest.spyOn(Element.prototype, "matches").mockImplementation(function (
    this: Element,
    selectors: string,
  ): boolean {
    if (selectors === ":focus-visible") {
      return focusCameBy === "keyboard" && this === document.activeElement;
    }

    return jsdomMatches.call(this, selectors);
  });
}

function tabOnto(element: HTMLElement): void {
  focusCameBy = "keyboard";
  act(() => {
    element.focus();
  });
  expect(document.activeElement).toBe(element);
}

function pointerFocuses(element: HTMLElement): void {
  focusCameBy = "pointer";
  act(() => {
    element.focus();
  });
  expect(document.activeElement).toBe(element);
}

/*
 * The canvas resizing, as React Flow's canvas does when the window or the
 * card it is in does: what the drawing's own ResizeObserver reports.
 */
const resizeCallbacks: Array<() => void> = [];
const realResizeObserver: unknown = (global as any).ResizeObserver;

class FakeResizeObserver {
  private callback: () => void;

  public constructor(callback: () => void) {
    this.callback = callback;
  }

  public observe(): void {
    resizeCallbacks.push(this.callback);
  }

  public disconnect(): void {
    const at: number = resizeCallbacks.indexOf(this.callback);

    if (at >= 0) {
      resizeCallbacks.splice(at, 1);
    }
  }
}

function canvasResizedTo(width: number, height: number): void {
  canvas = { width, height };
  act(() => {
    for (const callback of [...resizeCallbacks]) {
      callback();
    }
  });
}

// The card of a node: what Tab stops at on it.
function cardLink(nodeId: string): HTMLElement {
  return within(screen.getByTestId(`flow-node-${nodeId}`)).getByTestId(
    "lineage-card",
  );
}

function countOn(nodeId: string, side: "left" | "right"): HTMLElement {
  return within(screen.getByTestId(`flow-node-${nodeId}`)).getByTestId(
    `lineage-hidden-${side}`,
  );
}

// Whole inside the canvas, `margin` pixels in from each edge (with rounding's slack).
function isInside(box: DOMRect, margin: number): boolean {
  const slack: number = 1e-6;

  return (
    box.left >= CANVAS_LEFT + margin - slack &&
    box.top >= CANVAS_TOP + margin - slack &&
    box.right <= CANVAS_LEFT + canvas.width - margin + slack &&
    box.bottom <= CANVAS_TOP + canvas.height - margin + slack
  );
}

function expectInView(element: HTMLElement): void {
  const box: DOMRect = element.getBoundingClientRect();

  expect(isInside(box, FOCUS_REVEAL_PADDING_PX)).toBe(true);
}

function expectUnscrolled(): void {
  expect(flowDomNode()).not.toBeNull();
  expect(flowDomNode()!.scrollLeft).toBe(0);
  expect(flowDomNode()!.scrollTop).toBe(0);
}

async function renderTable(
  lineage: DataTableLineage = wideLineage(),
): Promise<void> {
  getTableLineageMock.mockResolvedValue(lineage);
  render(<TableLineageDiagram dataAssetId={new ObjectID(TABLE)} />);
  await screen.findByTestId("mock-react-flow");
}

async function renderPipeline(): Promise<void> {
  getPipelineLineageMock.mockResolvedValue(pipelineLineage());
  render(<PipelineLineageDiagram dataPipelineId={new ObjectID(ETL)} />);
  await screen.findByTestId("mock-react-flow");
}

async function renderAlert(): Promise<void> {
  getAlertLineageMock.mockResolvedValue(alertAnswer());
  render(<AlertLineageDiagram alertId={new ObjectID(ALERT)} />);
  await screen.findByTestId("mock-react-flow");
}

beforeEach(() => {
  getTableLineageMock.mockReset();
  getPipelineLineageMock.mockReset();
  getAlertLineageMock.mockReset();
  expandLineageMock.mockReset();
  resetFlowStandIn();
  canvas = { ...PHONE_CANVAS };
  resizeCallbacks.length = 0;
  (global as any).ResizeObserver = FakeResizeObserver;
  realGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  layOut();
  focusCameBy = "keyboard";
  matchesSpy = answerFocusVisible();
});

afterEach(() => {
  act(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  cleanup();
  matchesSpy.mockRestore();
  HTMLElement.prototype.getBoundingClientRect = realGetBoundingClientRect;
  (global as any).ResizeObserver = realResizeObserver;
});

describe("a table's drawing on a phone's canvas", () => {
  test("opens at the zoom names are read at, most of it off the view: the stand-in lays it out as the page would", async () => {
    await renderTable();

    expect(currentViewport().zoom).toBe(LINEAGE_READABLE_ZOOM);
    expect(isInside(cardLink(`table:${RAW}`).getBoundingClientRect(), 0)).toBe(
      false,
    );
    expect(
      isInside(cardLink(`table:${FORECAST}`).getBoundingClientRect(), 0),
    ).toBe(false);
    // React Flow's element is the store's, around the renderer the cards are in.
    expect(flowDomNode()).toHaveClass("react-flow");
    expect(
      flowDomNode()!
        .querySelector(".react-flow__renderer")!
        .contains(cardLink(`table:${RAW}`)),
    ).toBe(true);
    expect(pansMade()).toEqual([]);
  });

  test("Tab to a card wholly left of the view pans it in from the left, 24px inside the canvas, and pans no further", async () => {
    await renderTable();

    const raw: HTMLElement = cardLink(`table:${RAW}`);
    const before: DOMRect = raw.getBoundingClientRect();

    expect(before.right).toBeLessThan(CANVAS_LEFT);

    tabOnto(raw);

    expectInView(raw);
    // The least pan that shows it: its left edge 24px inside the canvas's.
    expect(raw.getBoundingClientRect().left).toBeCloseTo(
      CANVAS_LEFT + FOCUS_REVEAL_PADDING_PX,
      6,
    );
    expect(pansMade()).toHaveLength(1);
    expect(pansMade()[0]!.x).toBeGreaterThan(0);
    expect(currentViewport().zoom).toBe(LINEAGE_READABLE_ZOOM);
    expectUnscrolled();
  });

  test("Tab to a card wholly right of the view pans it in from the right", async () => {
    await renderTable();

    const forecast: HTMLElement = cardLink(`table:${FORECAST}`);

    expect(forecast.getBoundingClientRect().left).toBeGreaterThan(
      CANVAS_LEFT + canvas.width,
    );

    tabOnto(forecast);

    expectInView(forecast);
    expect(forecast.getBoundingClientRect().right).toBeCloseTo(
      CANVAS_LEFT + canvas.width - FOCUS_REVEAL_PADDING_PX,
      6,
    );
    expect(pansMade()).toHaveLength(1);
    expect(pansMade()[0]!.x).toBeLessThan(0);
    expectUnscrolled();
  });

  test("Tab to a card above the view pans it down into view, and to one below pans it up", async () => {
    await renderTable();

    const top: HTMLElement = cardLink(`table:${staging(1)}`);
    const bottom: HTMLElement = cardLink(`table:${staging(STAGING_TABLES)}`);
    const tops: Array<number> = [];

    for (let index: number = 1; index <= STAGING_TABLES; index++) {
      tops.push(
        cardLink(`table:${staging(index)}`).getBoundingClientRect().top,
      );
    }

    // The column is taller than the canvas: its first and last cards are off it.
    expect(Math.min(...tops)).toBe(top.getBoundingClientRect().top);
    expect(top.getBoundingClientRect().top).toBeLessThan(CANVAS_TOP);
    expect(bottom.getBoundingClientRect().bottom).toBeGreaterThan(
      CANVAS_TOP + canvas.height,
    );

    tabOnto(top);

    expectInView(top);
    expect(top.getBoundingClientRect().top).toBeCloseTo(
      CANVAS_TOP + FOCUS_REVEAL_PADDING_PX,
      6,
    );
    expect(pansMade()).toHaveLength(1);
    expect(pansMade()[0]!.y).toBeGreaterThan(0);

    tabOnto(bottom);

    expectInView(bottom);
    expect(bottom.getBoundingClientRect().bottom).toBeCloseTo(
      CANVAS_TOP + canvas.height - FOCUS_REVEAL_PADDING_PX,
      6,
    );
    expect(pansMade()).toHaveLength(2);
    expect(pansMade()[1]!.y).toBeLessThan(0);
    expectUnscrolled();
  });

  test("Tab to a count off the view brings the count itself into view, whichever side its card is on", async () => {
    await renderTable();

    const upstream: HTMLElement = countOn(`table:${RAW}`, "left");

    expect(upstream.getBoundingClientRect().right).toBeLessThan(CANVAS_LEFT);

    tabOnto(upstream);

    expectInView(upstream);
    expect(upstream.getBoundingClientRect().left).toBeCloseTo(
      CANVAS_LEFT + FOCUS_REVEAL_PADDING_PX,
      6,
    );

    const downstream: HTMLElement = countOn(`table:${MART}`, "right");

    expect(isInside(downstream.getBoundingClientRect(), 0)).toBe(false);

    tabOnto(downstream);

    expectInView(downstream);
    expect(downstream.getBoundingClientRect().right).toBeCloseTo(
      CANVAS_LEFT + canvas.width - FOCUS_REVEAL_PADDING_PX,
      6,
    );
    expect(pansMade()).toHaveLength(2);
    expectUnscrolled();
  });

  test("Tab on through every card and count keeps each one whole in view as the focus gets to it", async () => {
    await renderTable();

    const stops: Array<HTMLElement> = Array.from(
      flowDomNode()!.querySelectorAll<HTMLElement>("a[href], button"),
    );

    // Every table but the drawing's own opens its Lineage tab, and two counts draw more.
    expect(stops.length).toBe(wideLineage().nodes.length - 1 + 2);

    for (const stop of stops) {
      tabOnto(stop);
      expectInView(stop);
      expectUnscrolled();
    }

    // Never zoomed: the names stay readable.
    expect(currentViewport().zoom).toBe(LINEAGE_READABLE_ZOOM);
  });

  test("a card already whole in view, 24px inside, is not panned to", async () => {
    await renderTable();

    tabOnto(cardLink(`table:${RAW}`));

    const pans: number = pansMade().length;
    const view: LineageViewport = currentViewport();

    // Away and back: it is where the last pan left it.
    tabOnto(screen.getByTestId("lineage-depth-5"));
    tabOnto(cardLink(`table:${RAW}`));

    expect(pansMade()).toHaveLength(pans);
    expect(currentViewport()).toEqual(view);
  });

  test("a pointer pressing a card cut by the canvas's edge pans nothing: the card is under the pointer", async () => {
    await renderTable();

    const opened: LineageViewport = currentViewport();
    const cut: HTMLElement = cardLink(`table:${staging(1)}`);

    expect(isInside(cut.getBoundingClientRect(), 0)).toBe(false);

    pointerFocuses(cut);
    pointerFocuses(countOn(`table:${MART}`, "right"));

    expect(pansMade()).toEqual([]);
    expect(currentViewport()).toEqual(opened);
    expect(setViewportCalls()).toEqual([]);
  });

  test("the scroll Chromium makes of React Flow's element before it tells of the focus is dropped: one pan, and the element unscrolled", async () => {
    await renderTable();

    const forecast: HTMLElement = cardLink(`table:${FORECAST}`);
    const domNode: HTMLDivElement = flowDomNode()!;

    // Chromium scrolls the element to show the card, then fires focusin.
    domNode.scrollLeft = 600;
    domNode.scrollTop = 0;

    tabOnto(forecast);

    expectUnscrolled();
    expectInView(forecast);
    expect(pansMade()).toHaveLength(1);

    // The scroll's own event, a frame later, finds nothing scrolled: no second pan.
    act(() => {
      domNode.dispatchEvent(new Event("scroll"));
    });

    expect(pansMade()).toHaveLength(1);
    expectInView(forecast);
  });

  test("a scroll of React Flow's element the browser makes anyway is undone and made the same pan, the drawing and its controls kept on the canvas", async () => {
    await renderTable();

    const opened: LineageViewport = currentViewport();
    const domNode: HTMLDivElement = flowDomNode()!;

    act(() => {
      domNode.scrollLeft = 120;
      domNode.scrollTop = 40;
      domNode.dispatchEvent(new Event("scroll"));
    });

    expectUnscrolled();
    expect(pansMade()).toEqual([{ x: -120, y: -40 }]);
    expect(currentViewport()).toEqual({
      x: opened.x - 120,
      y: opened.y - 40,
      zoom: opened.zoom,
    });
  });

  test("focus the browser hands back as the window regains it is left where it is: the view may have moved on since", async () => {
    await renderTable();

    const raw: HTMLElement = cardLink(`table:${RAW}`);

    tabOnto(raw);

    const view: LineageViewport = {
      x: -900,
      y: 0,
      zoom: LINEAGE_READABLE_ZOOM,
    };

    // The reader drags the card away, then leaves the tab and comes back.
    act(() => {
      moveView(view);
    });

    const clock: SpyInstance<() => number> = jest
      .spyOn(Event.prototype, "timeStamp", "get")
      .mockReturnValue(1000);

    act(() => {
      window.dispatchEvent(new FocusEvent("focus"));
      raw.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    expect(pansMade()).toHaveLength(1);
    expect(currentViewport()).toEqual(view);

    // A focusin well after the window came back is the reader's own.
    clock.mockReturnValue(1000 + WINDOW_REFOCUS_MS);
    act(() => {
      raw.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    expect(pansMade()).toHaveLength(2);
    expectInView(raw);
    clock.mockRestore();
  });
});

describe("once the view followed the focus, it is the reader's", () => {
  test("before any pan, the canvas resizing looks at the drawing afresh", async () => {
    await renderTable();

    canvasResizedTo(420, 360);

    expect(setViewportCalls()).toHaveLength(1);
  });

  test("after a pan that followed the focus, the canvas resizing leaves the view where it is", async () => {
    await renderTable();

    const raw: HTMLElement = cardLink(`table:${RAW}`);

    tabOnto(raw);

    const panned: LineageViewport = currentViewport();

    canvasResizedTo(420, 360);
    canvasResizedTo(380, 400);

    expect(setViewportCalls()).toEqual([]);
    expect(currentViewport()).toEqual(panned);
    expectInView(raw);
  });

  test("a pointer's focus leaves the view the drawing's: the canvas resizing still looks at it afresh", async () => {
    await renderTable();

    pointerFocuses(cardLink(`table:${staging(1)}`));
    canvasResizedTo(420, 360);

    expect(setViewportCalls()).toHaveLength(1);
  });

  test("tables a count draws after a pan keep the card pressed where it is, as after a drag: the drawing is not fitted again", async () => {
    canvas = { width: 1000, height: 360 };
    expandLineageMock.mockResolvedValue(martExpansion());
    await renderTable(fittedLineage());

    const before: ReturnType<typeof layoutLineage> =
      layoutLineage(fittedLineage());
    const opened: LineageViewport = currentViewport();

    // It reads whole, fitted to the canvas's height: its top card is less than 24px in.
    expect(opened).toEqual(
      getLineageViewport({
        layout: before,
        focusNodeId: `table:${TABLE}`,
        width: canvas.width,
        height: canvas.height,
      }),
    );
    expect(opened.zoom).toBeGreaterThanOrEqual(LINEAGE_READABLE_ZOOM);

    const top: HTMLElement = cardLink(`table:${staging(1)}`);

    expect(top.getBoundingClientRect().top).toBeGreaterThanOrEqual(CANVAS_TOP);
    expect(top.getBoundingClientRect().top).toBeLessThan(
      CANVAS_TOP + FOCUS_REVEAL_PADDING_PX,
    );

    tabOnto(top);

    expect(pansMade()).toHaveLength(1);

    const panned: LineageViewport = currentViewport();

    await act(async () => {
      fireEvent.click(countOn(`table:${MART}`, "right"));
    });

    const after: ReturnType<typeof layoutLineage> = layoutLineage(
      mergeLineageExpansion(fittedLineage(), martExpansion()),
    );
    const newNodeIds: Array<string> = [`table:${more(1)}`, `table:${more(2)}`];
    const asReaders: { viewport: LineageViewport; isFitted: boolean } | null =
      getLineageViewportAfterExpanding({
        before,
        after,
        viewport: panned,
        nodeId: `table:${MART}`,
        newNodeIds,
        focusNodeId: `table:${TABLE}`,
        width: canvas.width,
        height: canvas.height,
        hasReaderMoved: true,
      });
    const fitted: { viewport: LineageViewport; isFitted: boolean } | null =
      getLineageViewportAfterExpanding({
        before,
        after,
        viewport: panned,
        nodeId: `table:${MART}`,
        newNodeIds,
        focusNodeId: `table:${TABLE}`,
        width: canvas.width,
        height: canvas.height,
        hasReaderMoved: false,
      });

    // Had the view stayed the drawing's, the grown drawing would be fitted again.
    expect(fitted?.isFitted).toBe(true);
    expect(asReaders?.isFitted).toBe(false);
    expect(asReaders!.viewport).not.toEqual(fitted!.viewport);
    expect(setViewportCalls()).toEqual([asReaders!.viewport]);
  });

  test("a new drawing - more steps - is looked at afresh, as after a drag", async () => {
    await renderTable();

    tabOnto(cardLink(`table:${RAW}`));

    const panned: LineageViewport = currentViewport();

    getTableLineageMock.mockResolvedValue({ ...wideLineage(), depth: 5 });
    await act(async () => {
      fireEvent.click(screen.getByTestId("lineage-depth-5"));
    });

    // Drawn afresh, opened where a new drawing opens: on the table, not where the pan left it.
    expect(currentViewport()).not.toEqual(panned);
    expect(currentViewport()).toEqual(flowProps()?.defaultViewport);
    expect(isInside(cardLink(`table:${RAW}`).getBoundingClientRect(), 0)).toBe(
      false,
    );
  });
});

describe("a pipeline's drawing", () => {
  test("Tab to the tables it reads and writes, off either side of the view, pans each one into view; a pointer pans nothing", async () => {
    await renderPipeline();

    expect(currentViewport().zoom).toBe(LINEAGE_READABLE_ZOOM);

    const mart: HTMLElement = cardLink(`table:${MART}`);
    const raw: HTMLElement = cardLink(`table:${RAW}`);

    expect(mart.getBoundingClientRect().left).toBeGreaterThan(
      CANVAS_LEFT + canvas.width,
    );
    expect(raw.getBoundingClientRect().left).toBeLessThan(CANVAS_LEFT);

    pointerFocuses(raw);
    expect(pansMade()).toEqual([]);

    tabOnto(mart);
    expectInView(mart);
    expect(pansMade()).toHaveLength(1);

    tabOnto(raw);
    expectInView(raw);
    expect(pansMade()).toHaveLength(2);
    expect(pansMade()[1]!.x).toBeGreaterThan(0);
    expectUnscrolled();

    // The view is the reader's: the canvas resizing leaves it be.
    const panned: LineageViewport = currentViewport();

    canvasResizedTo(440, 360);

    expect(setViewportCalls()).toEqual([]);
    expect(currentViewport()).toEqual(panned);
  });
});

describe("a data alert's drawing", () => {
  test("opens on its cause; Tab to the alert it caused, off the far side, pans it into view, and back to the cause pans back", async () => {
    await renderAlert();

    const raw: HTMLElement = cardLink(`table:${RAW}`);
    const forecast: HTMLElement = cardLink(`table:${FORECAST}`);

    expect(currentViewport().zoom).toBe(LINEAGE_READABLE_ZOOM);
    // Its cause is in view; the consequence, three columns along, is not.
    expect(isInside(raw.getBoundingClientRect(), 0)).toBe(true);
    expect(forecast.getBoundingClientRect().left).toBeGreaterThan(
      CANVAS_LEFT + canvas.width,
    );

    tabOnto(forecast);

    expectInView(forecast);
    expect(pansMade()).toHaveLength(1);
    expect(isInside(raw.getBoundingClientRect(), 0)).toBe(false);

    tabOnto(raw);

    expectInView(raw);
    expect(pansMade()).toHaveLength(2);
    expectUnscrolled();
  });

  test("the alert's own card opens its table, and is followed as any other; a pointer pans nothing", async () => {
    await renderAlert();

    const own: HTMLElement = cardLink(`table:${TABLE}`);

    expect(own.tagName).toBe("A");

    const opened: LineageViewport = currentViewport();

    pointerFocuses(cardLink(`table:${FORECAST}`));

    expect(pansMade()).toEqual([]);
    expect(currentViewport()).toEqual(opened);

    // The drawing opens on the cause, two columns up: the alert's own card is off the view.
    expect(isInside(own.getBoundingClientRect(), 0)).toBe(false);

    tabOnto(own);

    expectInView(own);
    expect(pansMade()).toHaveLength(1);

    // The view is the reader's now: the canvas resizing leaves it where the focus took it.
    const panned: LineageViewport = currentViewport();

    canvasResizedTo(400, 420);

    expect(setViewportCalls()).toEqual([]);
    expect(currentViewport()).toEqual(panned);
  });
});
