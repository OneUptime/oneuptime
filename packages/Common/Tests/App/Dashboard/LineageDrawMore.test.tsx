import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
 * DRAWING MORE OF A LINEAGE DIAGRAM WHERE IT IS (#6667).
 *
 * A card's count of tables not drawn ("+12") is a button: pressed, it asks
 * the route that draws more (expandLineage) for the next of them, naming
 * every table and dashboard drawn, and adds the answer to the drawing in
 * place - the card pressed counting what is left, a card drawn before
 * counting one fewer for each table it counted that is drawn now - with
 * Reset diagram to go back to the drawing as it was read. One card's at a
 * time: the count pressed turns and no other can be pressed meanwhile. A
 * draw that fails says why, and leaves the drawing as it was; an answer
 * for a drawing no longer on the screen is never added to another. The
 * view keeps the card pressed in place (getLineageViewportAfterExpanding).
 *
 * And how it reads: a count straddles its card's edge, growing outward and
 * never over the card's words; every card is drawn over every arrow; the
 * cards a count drew are marked (data-lineage-drawn) and tinted a moment;
 * a draw that failed says so over the drawing, where the count pressed
 * is; and the keyboard keeps its place - a count pressed from it has the
 * focus back once its tables are drawn, or its card when the count is
 * gone, or the drawing when the card opens nothing, as Reset diagram,
 * pressed, hands it to the drawing.
 *
 * The API is mocked and React Flow is the stand-in of LineageFlowStandIn,
 * which draws each card with the component's own card.
 */

const getTableLineageMock: MockFunction = getJestMockFunction();
const getPipelineLineageMock: MockFunction = getJestMockFunction();
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
 * The component comes last: requiring it runs the factories above, which
 * use ObjectID.
 */
import ObjectID from "../../../Types/ObjectID";
import { DataAssetFreshness } from "../../../Types/DataObservability/DataAssetFreshness";
import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";
import DataAssetLineageSource from "../../../Types/DataObservability/DataAssetLineageSource";
import {
  DataLineageExpandRequest,
  DataLineageExpansion,
} from "../../../Types/DataObservability/DataLineageExpansion";
import {
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
import {
  LINEAGE_CARD_HEIGHT,
  LINEAGE_CARD_WIDTH,
  LineageViewport,
  getLineageViewportAfterExpanding,
  layoutLineage,
  mergeLineageExpansion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageGraphModel";
import {
  LINEAGE_CARD_Z_INDEX,
  LINEAGE_DRAWN_ATTRIBUTE,
  getLineageHiddenCountStyle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageGraph";
import fs from "fs";
import path from "path";
import {
  cardClicksSeen,
  currentViewport,
  flowProps,
  moveView,
  resetFlowStandIn,
  setViewportCalls,
} from "./LineageFlowStandIn";

const TABLE: string = "22222222-2222-4222-8222-000000000001";
const STAGING: string = "22222222-2222-4222-8222-000000000002";
const SOURCE: string = "22222222-2222-4222-8222-000000000003";
const MART: string = "22222222-2222-4222-8222-000000000004";
const RAW: string = "22222222-2222-4222-8222-000000000005";
const CUSTOMERS: string = "22222222-2222-4222-8222-000000000006";
const ETL: string = "33333333-3333-4333-8333-000000000001";
const BOARD: string = "44444444-4444-4444-8444-000000000001";

const ETL_NODE: string = `pipeline:${ETL}`;

// The tables a card did not draw, the next of them drawn now.
function more(index: number): string {
  return `55555555-5555-4555-8555-${index.toString().padStart(12, "0")}`;
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

/*
 * raw.orders (one more upstream not drawn) -> staging.orders (twelve more
 * upstream not drawn) -> the table -> mart.revenue (three more downstream
 * not drawn) -> a revenue dashboard.
 */
function aLineage(): DataTableLineage {
  return {
    focusNodeId: `table:${TABLE}`,
    depth: 3,
    nodes: [
      table(TABLE, DataLineageSide.Focus, 0, { name: "analytics.orders" }),
      table(STAGING, DataLineageSide.Upstream, -1, {
        name: "staging.orders",
        hiddenUpstreamCount: 12,
      }),
      table(SOURCE, DataLineageSide.Upstream, -2, {
        name: "raw.orders",
        hiddenUpstreamCount: 1,
      }),
      table(MART, DataLineageSide.Downstream, 1, {
        name: "mart.revenue",
        hiddenDownstreamCount: 3,
      }),
      {
        id: `dashboard:${BOARD}`,
        kind: DataLineageNodeKind.Dashboard,
        side: DataLineageSide.Downstream,
        depth: 2,
        name: "Revenue",
        dataDashboardId: BOARD,
        tool: "Metabase",
        url: "https://metabase.example.com/dashboard/7",
      },
    ],
    edges: [
      feeds(SOURCE, STAGING),
      feeds(STAGING, TABLE),
      feeds(TABLE, MART),
      {
        ...arrow(
          DataLineageEdgeKind.Reads,
          `table:${MART}`,
          `dashboard:${BOARD}`,
        ),
        seenIn: [],
      },
    ],
    hiddenDashboardCount: 0,
    isTruncated: false,
  };
}

/*
 * The next ten tables staging.orders is built from, two still not drawn.
 * The first also feeds raw.orders: the one table raw.orders counted.
 */
function stagingExpansion(): DataLineageExpansion {
  const nodes: Array<DataTableLineageNode> = [];
  const edges: Array<DataTableLineageEdge> = [];

  for (let index: number = 1; index <= 10; index++) {
    nodes.push(
      table(more(index), DataLineageSide.Upstream, -2, {
        name: `landing.orders_${index}`,
      }),
    );
    edges.push(feeds(more(index), STAGING));
  }

  edges.push(feeds(more(1), SOURCE));

  return {
    nodeId: `table:${STAGING}`,
    side: DataLineageSide.Upstream,
    hiddenCount: 2,
    nodes,
    edges,
    hiddenDashboardCount: null,
    isTruncated: false,
  };
}

// The three more tables built from mart.revenue: all of them.
function martExpansion(): DataLineageExpansion {
  return {
    nodeId: `table:${MART}`,
    side: DataLineageSide.Downstream,
    hiddenCount: 0,
    nodes: [21, 22, 23].map((index: number): DataTableLineageNode => {
      return table(more(index), DataLineageSide.Downstream, 2);
    }),
    edges: [21, 22, 23].map((index: number): DataTableLineageEdge => {
      return feeds(MART, more(index));
    }),
    hiddenDashboardCount: 0,
    isTruncated: false,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise: Promise<T> = new Promise<T>(
    (yes: (value: T) => void, no: (error: Error) => void) => {
      resolve = yes;
      reject = no;
    },
  );

  return { promise, resolve, reject };
}

function card(nodeId: string): HTMLElement {
  return screen.getByTestId(`flow-node-${nodeId}`);
}

function countOn(nodeId: string, side: "left" | "right"): HTMLElement {
  return within(card(nodeId)).getByTestId(`lineage-hidden-${side}`);
}

function hasCount(nodeId: string, side: "left" | "right"): boolean {
  return Boolean(within(card(nodeId)).queryByTestId(`lineage-hidden-${side}`));
}

function drawnIds(): Array<string> {
  return (flowProps()?.nodes || [])
    .map((node: { id: string }): string => {
      return node.id;
    })
    .sort();
}

async function renderTable(
  lineage: DataTableLineage = aLineage(),
): Promise<void> {
  getTableLineageMock.mockResolvedValue(lineage);
  render(<TableLineageDiagram dataAssetId={new ObjectID(TABLE)} />);
  await screen.findByTestId("mock-react-flow");
}

// Presses a count and waits for its answer to be drawn.
async function press(nodeId: string, side: "left" | "right"): Promise<void> {
  await act(async () => {
    fireEvent.click(countOn(nodeId, side));
  });
}

/*
 * Presses a count from the keyboard: the count has the focus, and a
 * browser moves it off the count to the page itself once the count turns
 * (a disabled control cannot hold it). jsdom does not, nor blurs a
 * disabled control: the focus is moved to a field that then goes, which
 * leaves it on the page itself, as the browser does.
 */
function pressFromKeyboard(count: HTMLElement): void {
  act(() => {
    count.focus();
  });
  expect(document.activeElement).toBe(count);

  fireEvent.click(count);

  expect(count).toBeDisabled();

  act(() => {
    const away: HTMLInputElement = document.createElement("input");

    document.body.appendChild(away);
    away.focus();
    away.remove();
  });
  expect(document.activeElement).toBe(document.body);
}

// The face of a card - what is tinted when it was just drawn - by its node.
function cardFace(nodeId: string): HTMLElement {
  const face: HTMLElement | undefined = Array.from(
    card(nodeId).querySelectorAll<HTMLElement>("span"),
  ).find((span: HTMLElement): boolean => {
    return span.style.height === `${LINEAGE_CARD_HEIGHT}px`;
  });

  expect(face).toBeDefined();

  return face!;
}

function drawnCards(): Array<string> {
  return (flowProps()?.nodes || [])
    .filter((node: { id: string }): boolean => {
      return cardFace(node.id).hasAttribute(LINEAGE_DRAWN_ATTRIBUTE);
    })
    .map((node: { id: string }): string => {
      return node.id;
    })
    .sort();
}

beforeEach(() => {
  getTableLineageMock.mockReset();
  getPipelineLineageMock.mockReset();
  expandLineageMock.mockReset();
  resetFlowStandIn();
});

afterEach(() => {
  cleanup();
});

describe("pressing a card's count", () => {
  test("says what it draws: the next ten of twelve, or all of three", async () => {
    await renderTable();

    expect(countOn(`table:${STAGING}`, "left")).toHaveAttribute(
      "aria-label",
      "Draw 10 of the 12 more tables upstream",
    );
    expect(countOn(`table:${MART}`, "right")).toHaveAttribute(
      "aria-label",
      "Draw 3 more tables downstream",
    );
  });

  test("asks for the next of its tables, naming every table and dashboard drawn, with their columns", async () => {
    expandLineageMock.mockResolvedValue(stagingExpansion());
    await renderTable();

    await press(`table:${STAGING}`, "left");

    expect(expandLineageMock).toHaveBeenCalledTimes(1);

    const request: DataLineageExpandRequest = expandLineageMock.mock
      .calls[0]![0] as DataLineageExpandRequest;

    expect(request).toEqual({
      focusNodeId: `table:${TABLE}`,
      nodeId: `table:${STAGING}`,
      side: DataLineageSide.Upstream,
      tables: [
        { dataAssetId: TABLE, side: DataLineageSide.Focus, depth: 0 },
        { dataAssetId: STAGING, side: DataLineageSide.Upstream, depth: -1 },
        { dataAssetId: SOURCE, side: DataLineageSide.Upstream, depth: -2 },
        { dataAssetId: MART, side: DataLineageSide.Downstream, depth: 1 },
      ],
      dataDashboardIds: [BOARD],
      // The Lineage tab was read with its arrows' columns: the new arrows come with theirs.
      withColumns: true,
    });
    // Never the whole drawing again: it grows where it is.
    expect(getTableLineageMock).toHaveBeenCalledTimes(1);
  });

  test("draws them where they are: the card pressed counts what is left, a card that counted one of them one fewer", async () => {
    expandLineageMock.mockResolvedValue(stagingExpansion());
    await renderTable();

    await press(`table:${STAGING}`, "left");

    for (let index: number = 1; index <= 10; index++) {
      expect(card(`table:${more(index)}`)).toHaveTextContent(
        `landing.orders_${index}`,
      );
    }

    expect(countOn(`table:${STAGING}`, "left")).toHaveTextContent("+2");
    expect(countOn(`table:${STAGING}`, "left")).toHaveAttribute(
      "aria-label",
      "Draw 2 more tables upstream",
    );
    // raw.orders counted the first of them, drawn now.
    expect(hasCount(`table:${SOURCE}`, "left")).toBe(false);
    // The other way is as it was.
    expect(countOn(`table:${MART}`, "right")).toHaveTextContent("+3");
    expect(screen.getByTestId("lineage-summary")).toHaveTextContent(
      "12 tables upstream",
    );
    // Every arrow of the answer is drawn, once.
    expect(
      (flowProps()?.edges || []).map((edge: { id: string }): string => {
        return edge.id;
      }),
    ).toEqual(
      mergeLineageExpansion(aLineage(), stagingExpansion()).edges.map(
        (edge: DataTableLineageEdge): string => {
          return edge.id;
        },
      ),
    );
  });

  test("a second count asks naming what the first drew, and its answer is drawn beside it", async () => {
    expandLineageMock
      .mockResolvedValueOnce(stagingExpansion())
      .mockResolvedValueOnce(martExpansion());
    await renderTable();

    await press(`table:${STAGING}`, "left");
    await press(`table:${MART}`, "right");

    const second: DataLineageExpandRequest = expandLineageMock.mock
      .calls[1]![0] as DataLineageExpandRequest;

    expect(second.nodeId).toBe(`table:${MART}`);
    expect(second.side).toBe(DataLineageSide.Downstream);
    expect(second.tables).toHaveLength(14);
    expect(second.tables).toContainEqual({
      dataAssetId: more(10),
      side: DataLineageSide.Upstream,
      depth: -2,
    });
    expect(hasCount(`table:${MART}`, "right")).toBe(false);
    expect(drawnIds()).toEqual(
      [
        ...aLineage().nodes.map((node: DataTableLineageNode): string => {
          return node.id;
        }),
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 21, 22, 23].map(
          (index: number): string => {
            return `table:${more(index)}`;
          },
        ),
      ].sort(),
    );
    expect(screen.getByTestId("lineage-summary")).toHaveTextContent(
      "4 tables downstream",
    );
  });

  test("draws, and only that: the card under the count is not pressed", async () => {
    expandLineageMock.mockResolvedValue(stagingExpansion());
    await renderTable();

    let isDefaultDone: boolean = true;

    await act(async () => {
      isDefaultDone = fireEvent.click(countOn(`table:${STAGING}`, "left"));
    });

    expect(isDefaultDone).toBe(false);
    expect(cardClicksSeen()).toEqual([]);

    // A press on the card itself reaches it, as React Flow would see it.
    fireEvent.click(
      card(`table:${MART}`).querySelector("[data-node-id]") as HTMLElement,
    );

    expect(cardClicksSeen()).toEqual([`table:${MART}`]);
  });

  test("one card's at a time: the count pressed turns, no other can be pressed until it is drawn", async () => {
    const answer: ReturnType<typeof deferred<DataLineageExpansion>> =
      deferred<DataLineageExpansion>();
    expandLineageMock.mockReturnValueOnce(answer.promise);
    await renderTable();

    fireEvent.click(countOn(`table:${STAGING}`, "left"));

    const pressed: HTMLElement = countOn(`table:${STAGING}`, "left");
    const other: HTMLElement = countOn(`table:${MART}`, "right");

    expect(pressed).toHaveAttribute("aria-busy", "true");
    expect(pressed).toBeDisabled();
    expect(other).toBeDisabled();
    expect(other).not.toHaveAttribute("aria-busy");

    /*
     * It turns in its own place: the spinner over the number, which stays
     * unseen so the count keeps its size and does not grow over the card.
     */
    const pressedText: string = pressed.textContent || "";

    expect(pressedText).toMatch(/^\+\d+$/);
    expect(
      within(pressed).getByTestId("lineage-hidden-left-spinner"),
    ).toHaveClass("absolute", "inset-0");
    expect(within(pressed).getByText(pressedText)).toHaveClass("invisible");
    expect(
      within(other).queryByTestId("lineage-hidden-right-spinner"),
    ).not.toBeInTheDocument();
    expect(within(other).getByText(other.textContent || "-")).not.toHaveClass(
      "invisible",
    );

    fireEvent.click(other);
    fireEvent.click(pressed);

    expect(expandLineageMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer.resolve(stagingExpansion());
    });

    expect(countOn(`table:${STAGING}`, "left")).toBeEnabled();
    expect(countOn(`table:${STAGING}`, "left")).not.toHaveAttribute(
      "aria-busy",
    );
    expect(
      within(countOn(`table:${STAGING}`, "left")).queryByTestId(
        "lineage-hidden-left-spinner",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(countOn(`table:${STAGING}`, "left")).getByText(
        countOn(`table:${STAGING}`, "left").textContent || "-",
      ),
    ).not.toHaveClass("invisible");
    expect(countOn(`table:${MART}`, "right")).toBeEnabled();
  });
});

describe("Reset diagram", () => {
  test("is not offered until the drawing grows", async () => {
    await renderTable();

    expect(screen.queryByTestId("lineage-reset")).not.toBeInTheDocument();
  });

  test("goes back to the drawing as it was read, without reading it again", async () => {
    expandLineageMock.mockResolvedValue(stagingExpansion());
    await renderTable();

    await press(`table:${STAGING}`, "left");

    const reset: HTMLElement = screen.getByTestId("lineage-reset");

    expect(reset).toHaveTextContent("Reset diagram");

    fireEvent.click(reset);

    expect(drawnIds()).toEqual(
      aLineage()
        .nodes.map((node: DataTableLineageNode): string => {
          return node.id;
        })
        .sort(),
    );
    expect(countOn(`table:${STAGING}`, "left")).toHaveTextContent("+12");
    expect(countOn(`table:${SOURCE}`, "left")).toHaveTextContent("+1");
    expect(screen.getByTestId("lineage-summary")).toHaveTextContent(
      "2 tables upstream",
    );
    expect(screen.queryByTestId("lineage-reset")).not.toBeInTheDocument();
    expect(getTableLineageMock).toHaveBeenCalledTimes(1);
  });

  test("cannot be pressed while more is being drawn", async () => {
    const second: ReturnType<typeof deferred<DataLineageExpansion>> =
      deferred<DataLineageExpansion>();
    expandLineageMock
      .mockResolvedValueOnce(stagingExpansion())
      .mockReturnValueOnce(second.promise);
    await renderTable();

    await press(`table:${STAGING}`, "left");
    fireEvent.click(countOn(`table:${MART}`, "right"));

    expect(screen.getByTestId("lineage-reset")).toBeDisabled();

    await act(async () => {
      second.resolve(martExpansion());
    });

    expect(screen.getByTestId("lineage-reset")).toBeEnabled();
  });
});

describe("a draw that fails", () => {
  test("says why, and leaves the drawing as it was, its count pressable again", async () => {
    expandLineageMock.mockRejectedValueOnce(new Error("Table not found."));
    await renderTable();

    await press(`table:${STAGING}`, "left");

    const error: HTMLElement = screen.getByTestId("lineage-draw-error");

    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent("Table not found.");
    expect(drawnIds()).toHaveLength(aLineage().nodes.length);
    expect(countOn(`table:${STAGING}`, "left")).toHaveTextContent("+12");
    expect(countOn(`table:${STAGING}`, "left")).toBeEnabled();
    expect(screen.queryByTestId("lineage-reset")).not.toBeInTheDocument();

    // Pressed again, it draws; what failed is no longer said.
    expandLineageMock.mockResolvedValueOnce(stagingExpansion());
    await press(`table:${STAGING}`, "left");

    expect(screen.queryByTestId("lineage-draw-error")).not.toBeInTheDocument();
    expect(card(`table:${more(1)}`)).toBeInTheDocument();
  });

  test("with nothing to say, says it could not draw more", async () => {
    expandLineageMock.mockRejectedValueOnce(new Error(""));
    await renderTable();

    await press(`table:${STAGING}`, "left");

    expect(screen.getByTestId("lineage-draw-error")).toHaveTextContent(
      "Could not draw more of this lineage.",
    );
  });
});

describe("an answer for a drawing no longer shown", () => {
  test("is never added to the drawing read since", async () => {
    const answer: ReturnType<typeof deferred<DataLineageExpansion>> =
      deferred<DataLineageExpansion>();
    expandLineageMock.mockReturnValueOnce(answer.promise);
    await renderTable();

    fireEvent.click(countOn(`table:${STAGING}`, "left"));

    // Two steps each way: read afresh.
    getTableLineageMock.mockResolvedValue({ ...aLineage(), depth: 2 });
    fireEvent.click(screen.getByTestId("lineage-depth-2"));

    await waitFor(() => {
      expect(getTableLineageMock).toHaveBeenCalledTimes(2);
    });
    await screen.findByTestId("mock-react-flow");

    await act(async () => {
      answer.resolve(stagingExpansion());
    });

    expect(drawnIds()).toHaveLength(aLineage().nodes.length);
    expect(screen.queryByTestId("lineage-reset")).not.toBeInTheDocument();
    expect(countOn(`table:${STAGING}`, "left")).toBeEnabled();
    expect(countOn(`table:${STAGING}`, "left")).toHaveTextContent("+12");
  });
});

describe("a pipeline's drawing", () => {
  /*
   * orders_etl reads raw.orders and raw.customers - and three more not
   * drawn - and writes the table.
   */
  function pipelineLineage(): DataTableLineage {
    return {
      focusNodeId: ETL_NODE,
      depth: 1,
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
          hiddenUpstreamCount: 3,
          hiddenDownstreamCount: 0,
        },
        table(RAW, DataLineageSide.Upstream, -1),
        table(CUSTOMERS, DataLineageSide.Upstream, -1),
        table(TABLE, DataLineageSide.Downstream, 1),
      ],
      edges: [
        arrow(DataLineageEdgeKind.Reads, `table:${RAW}`, ETL_NODE),
        arrow(DataLineageEdgeKind.Reads, `table:${CUSTOMERS}`, ETL_NODE),
        arrow(DataLineageEdgeKind.Writes, ETL_NODE, `table:${TABLE}`),
      ],
      hiddenDashboardCount: 0,
      isTruncated: false,
    };
  }

  test("the pipeline's count draws the tables it reads, asked without columns", async () => {
    expandLineageMock.mockResolvedValue({
      nodeId: ETL_NODE,
      side: DataLineageSide.Upstream,
      hiddenCount: 0,
      nodes: [31, 32, 33].map((index: number): DataTableLineageNode => {
        return table(more(index), DataLineageSide.Upstream, -1);
      }),
      edges: [31, 32, 33].map((index: number): DataTableLineageEdge => {
        return arrow(
          DataLineageEdgeKind.Reads,
          `table:${more(index)}`,
          ETL_NODE,
        );
      }),
      hiddenDashboardCount: null,
      isTruncated: false,
    } as DataLineageExpansion);
    getPipelineLineageMock.mockResolvedValue(pipelineLineage());
    render(<PipelineLineageDiagram dataPipelineId={new ObjectID(ETL)} />);
    await screen.findByTestId("mock-react-flow");

    expect(screen.getByTestId("lineage-summary")).toHaveTextContent(
      "Reads 5 tables",
    );

    await press(ETL_NODE, "left");

    // A pipeline's page follows no column: its drawing was read without them.
    expect(expandLineageMock.mock.calls[0]![0]).toEqual({
      focusNodeId: ETL_NODE,
      nodeId: ETL_NODE,
      side: DataLineageSide.Upstream,
      tables: [
        { dataAssetId: RAW, side: DataLineageSide.Upstream, depth: -1 },
        { dataAssetId: CUSTOMERS, side: DataLineageSide.Upstream, depth: -1 },
        { dataAssetId: TABLE, side: DataLineageSide.Downstream, depth: 1 },
      ],
      dataDashboardIds: [],
    });
    expect(hasCount(ETL_NODE, "left")).toBe(false);

    for (const index of [31, 32, 33]) {
      expect(card(`table:${more(index)}`)).toBeInTheDocument();
    }

    // Still five: all of them drawn now.
    expect(screen.getByTestId("lineage-summary")).toHaveTextContent(
      "Reads 5 tables",
    );
    expect(screen.queryByTestId("lineage-column")).not.toBeInTheDocument();
  });

  test("a table draws more only its own way: one it reads, upstream and never downstream", async () => {
    const lineage: DataTableLineage = pipelineLineage();
    lineage.nodes[1] = table(RAW, DataLineageSide.Upstream, -1, {
      hiddenUpstreamCount: 2,
      hiddenDownstreamCount: 4,
    });
    getPipelineLineageMock.mockResolvedValue(lineage);
    render(<PipelineLineageDiagram dataPipelineId={new ObjectID(ETL)} />);
    await screen.findByTestId("mock-react-flow");

    expect(countOn(`table:${RAW}`, "left").tagName).toBe("BUTTON");
    expect(countOn(`table:${RAW}`, "right").tagName).toBe("SPAN");
    expect(countOn(`table:${RAW}`, "right")).toHaveAttribute(
      "title",
      "4 more tables downstream are not drawn. Open this table to center the diagram on it.",
    );
    // A count that only says where to see them sits where a pressable one does.
    expect(countOn(`table:${RAW}`, "right").style.left).toBe(
      "calc(100% - 8px)",
    );
    expect(countOn(`table:${RAW}`, "right")).toHaveClass("whitespace-nowrap");
  });

  test("the pipeline's count, pressed from the keyboard, draws all it reads: the pipeline opens nothing here, so the drawing takes the focus", async () => {
    const answer: ReturnType<typeof deferred<DataLineageExpansion>> =
      deferred<DataLineageExpansion>();
    expandLineageMock.mockReturnValueOnce(answer.promise);
    getPipelineLineageMock.mockResolvedValue(pipelineLineage());
    render(<PipelineLineageDiagram dataPipelineId={new ObjectID(ETL)} />);
    await screen.findByTestId("mock-react-flow");

    // The pipeline on its own page is no link.
    expect(within(card(ETL_NODE)).queryByRole("link")).not.toBeInTheDocument();

    pressFromKeyboard(countOn(ETL_NODE, "left"));

    await act(async () => {
      answer.resolve({
        nodeId: ETL_NODE,
        side: DataLineageSide.Upstream,
        hiddenCount: 0,
        nodes: [41, 42, 43].map((index: number): DataTableLineageNode => {
          return table(more(index), DataLineageSide.Upstream, -1);
        }),
        edges: [41, 42, 43].map((index: number): DataTableLineageEdge => {
          return arrow(
            DataLineageEdgeKind.Reads,
            `table:${more(index)}`,
            ETL_NODE,
          );
        }),
        hiddenDashboardCount: null,
        isTruncated: false,
      } as DataLineageExpansion);
    });

    expect(hasCount(ETL_NODE, "left")).toBe(false);
    expect(document.activeElement).toBe(screen.getByTestId("lineage-graph"));

    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
  });
});

describe("where a count sits on its card", () => {
  test("across the card's edge, its inner edge 8px in: a longer count grows outward, never over the card's words, which start 13px in", () => {
    expect(getLineageHiddenCountStyle("left")).toEqual({
      right: "calc(100% - 8px)",
    });
    expect(getLineageHiddenCountStyle("right")).toEqual({
      left: "calc(100% - 8px)",
    });
  });

  test("each count on a card is placed so, on one line, whatever its number", async () => {
    await renderTable();

    const upstream: HTMLElement = countOn(`table:${STAGING}`, "left");
    const downstream: HTMLElement = countOn(`table:${MART}`, "right");

    expect(upstream.style.right).toBe("calc(100% - 8px)");
    expect(upstream.style.left).toBe("");
    expect(downstream.style.left).toBe("calc(100% - 8px)");
    expect(downstream.style.right).toBe("");

    for (const count of [upstream, downstream]) {
      expect(count).toHaveClass("absolute", "whitespace-nowrap");
    }
  });
});

describe("the cards a count draws", () => {
  function idsOf(expansion: DataLineageExpansion): Array<string> {
    return expansion.nodes
      .map((node: DataTableLineageNode): string => {
        return node.id;
      })
      .sort();
  }

  test("are marked drawn - tinted a moment - until the next count draws others", async () => {
    expandLineageMock
      .mockResolvedValueOnce(stagingExpansion())
      .mockResolvedValueOnce(martExpansion());
    await renderTable();

    expect(drawnCards()).toEqual([]);

    await press(`table:${STAGING}`, "left");

    expect(drawnCards()).toEqual(idsOf(stagingExpansion()));
    // The card pressed, and a card that counted one of them, were there before.
    expect(cardFace(`table:${STAGING}`)).not.toHaveAttribute(
      LINEAGE_DRAWN_ATTRIBUTE,
    );
    expect(cardFace(`table:${SOURCE}`)).not.toHaveAttribute(
      LINEAGE_DRAWN_ATTRIBUTE,
    );

    await press(`table:${MART}`, "right");

    expect(drawnCards()).toEqual(idsOf(martExpansion()));
  });

  test("the mark is on the card's face, inside the link that opens it", async () => {
    expandLineageMock.mockResolvedValueOnce(stagingExpansion());
    await renderTable();

    await press(`table:${STAGING}`, "left");

    const face: HTMLElement = cardFace(`table:${more(1)}`);

    expect(face).toHaveAttribute(LINEAGE_DRAWN_ATTRIBUTE, "true");
    expect(face.closest("a")).toBe(
      within(card(`table:${more(1)}`)).getByTestId("lineage-card"),
    );
    // Only the face: not the card's wrapper, nor its counts.
    expect(
      card(`table:${more(1)}`).querySelectorAll(`[${LINEAGE_DRAWN_ATTRIBUTE}]`),
    ).toHaveLength(1);
  });

  test("Reset diagram takes the mark off with the cards it drew", async () => {
    expandLineageMock.mockResolvedValueOnce(stagingExpansion());
    await renderTable();

    await press(`table:${STAGING}`, "left");
    act(() => {
      fireEvent.click(screen.getByTestId("lineage-reset"));
    });

    expect(drawnCards()).toEqual([]);
  });

  test("a draw that fails marks nothing", async () => {
    expandLineageMock.mockRejectedValueOnce(new Error("Table not found."));
    await renderTable();

    await press(`table:${STAGING}`, "left");

    expect(drawnCards()).toEqual([]);
  });

  test("Theme.css tints the face it marks and fades the tint to the card's own colour, holding it still for less motion", () => {
    const sheet: string = fs
      .readFileSync(
        path.resolve(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
        "utf8",
      )
      .split(/\s+/)
      .join(" ");
    const marked: string = `[${LINEAGE_DRAWN_ATTRIBUTE}]`;

    expect(LINEAGE_DRAWN_ATTRIBUTE).toBe("data-lineage-drawn");
    // From the tint to the card's own colour: no frame of its own at the end.
    expect(sheet).toContain(
      "@keyframes ou-lineage-drawn { from { background-color: var(--ou-lineage-drawn-tint); } }",
    );
    // The card's colour with the indigo mixed in, in each theme, as a row a live list read in.
    expect(sheet).toContain(
      `${marked} { --ou-lineage-drawn-tint: color-mix( in srgb, rgb(99 102 241) 12%, var(--ou-surface-primary) ); }`,
    );
    expect(sheet).toContain(
      `html.dark ${marked} { --ou-lineage-drawn-tint: color-mix( in srgb, rgb(129 140 248) 18%, var(--ou-surface-primary) ); }`,
    );
    expect(sheet).toContain(
      `@media (prefers-reduced-motion: no-preference) { ${marked} { animation: ou-lineage-drawn 2.4s ease-out; } }`,
    );
    // The face's colour is its own inline style: only !important is drawn over it.
    expect(sheet).toContain(
      `@media (prefers-reduced-motion: reduce) { ${marked} { background-color: var(--ou-lineage-drawn-tint) !important; } }`,
    );
  });
});

describe("cards over arrows", () => {
  test("every card is drawn over every arrow, and has its size, so React Flow never hides it to measure it again", async () => {
    expandLineageMock.mockResolvedValueOnce(stagingExpansion());
    await renderTable();

    await press(`table:${STAGING}`, "left");

    const nodes: Array<{
      zIndex?: number | undefined;
      width?: number | null | undefined;
      height?: number | null | undefined;
    }> = flowProps()?.nodes || [];
    const arrowHeights: Array<number> = (flowProps()?.edges || []).map(
      (edge: { zIndex?: number | undefined }): number => {
        return edge.zIndex || 0;
      },
    );

    expect(nodes).toHaveLength(15);

    for (const node of nodes) {
      expect(node.zIndex).toBe(LINEAGE_CARD_Z_INDEX);
      expect(node.width).toBe(LINEAGE_CARD_WIDTH);
      expect(node.height).toBe(LINEAGE_CARD_HEIGHT);
    }

    expect(Math.max(...arrowHeights)).toBeLessThan(LINEAGE_CARD_Z_INDEX);
  });
});

describe("the keyboard's place", () => {
  afterEach(() => {
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
  });

  test("a count pressed from the keyboard has the focus back once its tables are drawn, saying what is left", async () => {
    const answer: ReturnType<typeof deferred<DataLineageExpansion>> =
      deferred<DataLineageExpansion>();
    expandLineageMock.mockReturnValueOnce(answer.promise);
    await renderTable();

    const count: HTMLElement = countOn(`table:${STAGING}`, "left");

    pressFromKeyboard(count);

    await act(async () => {
      answer.resolve(stagingExpansion());
    });

    // The same count, which stays while two are still not drawn.
    expect(countOn(`table:${STAGING}`, "left")).toBe(count);
    expect(document.activeElement).toBe(count);
    expect(count).toBeEnabled();
    expect(count).toHaveAttribute("aria-label", "Draw 2 more tables upstream");
  });

  test("a count that drew all its tables is gone: the focus goes to its card", async () => {
    const answer: ReturnType<typeof deferred<DataLineageExpansion>> =
      deferred<DataLineageExpansion>();
    expandLineageMock.mockReturnValueOnce(answer.promise);
    await renderTable();

    pressFromKeyboard(countOn(`table:${MART}`, "right"));

    await act(async () => {
      answer.resolve(martExpansion());
    });

    expect(hasCount(`table:${MART}`, "right")).toBe(false);
    expect(document.activeElement).toBe(
      within(card(`table:${MART}`)).getByTestId("lineage-card"),
    );
    expect(document.activeElement?.tagName).toBe("A");
  });

  test("a draw that fails gives the focus back to the count, to press again", async () => {
    const answer: ReturnType<typeof deferred<DataLineageExpansion>> =
      deferred<DataLineageExpansion>();
    expandLineageMock.mockReturnValueOnce(answer.promise);
    await renderTable();

    const count: HTMLElement = countOn(`table:${STAGING}`, "left");

    pressFromKeyboard(count);

    await act(async () => {
      answer.reject(new Error("Table not found."));
    });

    expect(screen.getByTestId("lineage-draw-error")).toBeInTheDocument();
    expect(document.activeElement).toBe(count);
    expect(count).toHaveAttribute(
      "aria-label",
      "Draw 10 of the 12 more tables upstream",
    );
  });

  test("a reader who moved on while it was drawn keeps their place", async () => {
    const answer: ReturnType<typeof deferred<DataLineageExpansion>> =
      deferred<DataLineageExpansion>();
    expandLineageMock.mockReturnValueOnce(answer.promise);
    await renderTable();

    pressFromKeyboard(countOn(`table:${STAGING}`, "left"));

    const elsewhere: HTMLElement = screen.getByTestId("lineage-depth-5");

    act(() => {
      elsewhere.focus();
    });

    await act(async () => {
      answer.resolve(stagingExpansion());
    });

    expect(document.activeElement).toBe(elsewhere);
  });

  test("a press that did not come from the keyboard's focus moves no focus", async () => {
    const answer: ReturnType<typeof deferred<DataLineageExpansion>> =
      deferred<DataLineageExpansion>();
    expandLineageMock.mockReturnValueOnce(answer.promise);
    await renderTable();

    // A tap, or Safari's click, which leaves the focus where it was.
    fireEvent.click(countOn(`table:${MART}`, "right"));

    await act(async () => {
      answer.resolve(martExpansion());
    });

    expect(hasCount(`table:${MART}`, "right")).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  test("Reset diagram, pressed, is gone: the drawing takes the focus, and can take it only from a script", async () => {
    expandLineageMock.mockResolvedValueOnce(stagingExpansion());
    await renderTable();

    await press(`table:${STAGING}`, "left");

    const reset: HTMLElement = screen.getByTestId("lineage-reset");

    act(() => {
      reset.focus();
    });
    act(() => {
      fireEvent.click(reset);
    });

    const figure: HTMLElement = screen.getByTestId("lineage-graph");

    expect(screen.queryByTestId("lineage-reset")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(figure);
    // Never a stop of its own for Tab: Tab goes on to the cards in it.
    expect(figure).toHaveAttribute("tabindex", "-1");
    expect(figure).toHaveClass(
      "focus:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-indigo-500",
    );
  });

  test("Reset diagram pressed with the focus elsewhere leaves it there", async () => {
    expandLineageMock.mockResolvedValueOnce(stagingExpansion());
    await renderTable();

    await press(`table:${STAGING}`, "left");

    const elsewhere: HTMLElement = screen.getByTestId("lineage-depth-5");

    act(() => {
      elsewhere.focus();
    });
    act(() => {
      fireEvent.click(screen.getByTestId("lineage-reset"));
    });

    expect(document.activeElement).toBe(elsewhere);
  });
});

describe("where a draw that failed says so", () => {
  test("over the drawing, under the controls, with its mark: never under the legend, out of sight of the count pressed", async () => {
    expandLineageMock.mockRejectedValueOnce(new Error("Table not found."));
    await renderTable();

    await press(`table:${STAGING}`, "left");

    const error: HTMLElement = screen.getByTestId("lineage-draw-error");
    const figure: HTMLElement = screen.getByTestId("lineage-graph");
    const legend: HTMLElement = screen.getByTestId("lineage-legend");
    const summary: HTMLElement = screen.getByTestId("lineage-summary");

    expect(
      error.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      error.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      summary.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveClass("border-red-200", "bg-red-50", "text-red-700");
    expect(error.querySelector("svg")).not.toBeNull();
    expect(error).toHaveTextContent("Table not found.");
  });
});

describe("where the drawing is looked at from once it grows", () => {
  let canvasBox: { width: number; height: number };
  let realGetBoundingClientRect: () => DOMRect;

  beforeEach(() => {
    canvasBox = { width: 1000, height: 400 };
    realGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    // The canvas has the size a test gives it; everything else none.
    HTMLElement.prototype.getBoundingClientRect = function (
      this: HTMLElement,
    ): DOMRect {
      const isCanvas: boolean =
        this.getAttribute("data-testid") === "lineage-graph";

      return {
        width: isCanvas ? canvasBox.width : 0,
        height: isCanvas ? canvasBox.height : 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => {
          return {};
        },
      } as DOMRect;
    };
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = realGetBoundingClientRect;
  });

  function newIds(): Array<string> {
    return stagingExpansion().nodes.map((node: DataTableLineageNode) => {
      return node.id;
    });
  }

  test("the view the reader has not moved goes where the drawing grown says, the drawing kept", async () => {
    expandLineageMock.mockResolvedValue(stagingExpansion());
    await renderTable();

    const opened: LineageViewport = currentViewport();
    const openedWith: unknown = flowProps()?.defaultViewport;

    await press(`table:${STAGING}`, "left");

    const expected: { viewport: LineageViewport; isFitted: boolean } | null =
      getLineageViewportAfterExpanding({
        before: layoutLineage(aLineage()),
        after: layoutLineage(
          mergeLineageExpansion(aLineage(), stagingExpansion()),
        ),
        viewport: opened,
        nodeId: `table:${STAGING}`,
        newNodeIds: newIds(),
        focusNodeId: `table:${TABLE}`,
        width: 1000,
        height: 400,
        hasReaderMoved: false,
      });

    expect(expected).not.toBeNull();
    expect(setViewportCalls()).toEqual([expected!.viewport]);
    // The same drawing, grown: React Flow is not drawn afresh.
    expect(flowProps()?.defaultViewport).toEqual(openedWith);
  });

  test("a view the reader moved keeps the card pressed where it is on the screen", async () => {
    expandLineageMock.mockResolvedValue(stagingExpansion());
    await renderTable();

    const moved: LineageViewport = { x: -120, y: 35, zoom: 0.8 };

    act(() => {
      moveView(moved);
    });

    await press(`table:${STAGING}`, "left");

    const expected: { viewport: LineageViewport; isFitted: boolean } | null =
      getLineageViewportAfterExpanding({
        before: layoutLineage(aLineage()),
        after: layoutLineage(
          mergeLineageExpansion(aLineage(), stagingExpansion()),
        ),
        viewport: moved,
        nodeId: `table:${STAGING}`,
        newNodeIds: newIds(),
        focusNodeId: `table:${TABLE}`,
        width: 1000,
        height: 400,
        hasReaderMoved: true,
      });

    expect(expected?.isFitted).toBe(false);
    expect(expected?.viewport.zoom).toBe(0.8);
    expect(setViewportCalls()).toEqual([expected!.viewport]);
  });

  test("a canvas with no size is left where it is", async () => {
    canvasBox = { width: 0, height: 0 };
    expandLineageMock.mockResolvedValue(stagingExpansion());
    await renderTable();

    await press(`table:${STAGING}`, "left");

    expect(card(`table:${more(1)}`)).toBeInTheDocument();
    expect(setViewportCalls()).toEqual([]);
  });

  test("Reset draws the drawing afresh, looked at as it was first", async () => {
    expandLineageMock.mockResolvedValue(stagingExpansion());
    await renderTable();

    const openedWith: unknown = flowProps()?.defaultViewport;

    await press(`table:${STAGING}`, "left");
    act(() => {
      fireEvent.click(screen.getByTestId("lineage-reset"));
    });

    expect(flowProps()?.defaultViewport).toEqual(openedWith);
    expect(flowProps()?.nodes).toHaveLength(aLineage().nodes.length);
  });
});
