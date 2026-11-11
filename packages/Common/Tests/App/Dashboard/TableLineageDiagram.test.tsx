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
import { Edge as FlowEdge, ReactFlowProps } from "reactflow";
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
 * A table's lineage diagram, at the top of its Lineage tab: it asks the
 * table-lineage route for the table and the steps chosen (three by
 * default), and draws the answer - a card per table, pipeline and
 * dashboard, each saying how it is and opening its own page; arrows styled
 * by where they were seen and red when their pipeline failed; a summary of
 * what lies each way; and notes when the drawing could not hold it all.
 * The API is mocked and React Flow is a stand-in that draws each card with
 * the component's own card, so what a card shows and opens is pinned.
 */

const getTableLineageMock: MockFunction = getJestMockFunction();

// The props of the latest React Flow drawing: its cards and arrows.
let mockFlowProps: ReactFlowProps | null = null;

// The instance the stand-in hands onInit: what the diagram asks of the view.
const setViewportMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi",
  () => {
    return {
      __esModule: true,
      default: {
        getTableLineage: (...args: Array<any>) => {
          return getTableLineageMock(...args);
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

// The run-state pill of the Pipelines page, as a word to look for.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Pipelines",
  () => {
    return {
      __esModule: true,
      getRunStatePill: (
        state: string | undefined,
        size: string | undefined,
      ): ReactElement => {
        return React.createElement(
          "span",
          { "data-testid": "run-state", "data-size": size || "" },
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

/*
 * React Flow measures nothing in jsdom: the stand-in draws each node with
 * the component type the diagram registered for it, and keeps the props.
 */
jest.mock("reactflow", () => {
  const MockReactFlow: (props: any) => React.ReactElement = (
    props: any,
  ): React.ReactElement => {
    mockFlowProps = props;

    React.useEffect(() => {
      if (props.onInit) {
        props.onInit({
          setViewport: (...args: Array<any>) => {
            return setViewportMock(...args);
          },
        });
      }
    }, []);

    return React.createElement(
      "div",
      { "data-testid": "mock-react-flow" },
      (props.edges || []).map((edge: any) => {
        const Arrow: any = props.edgeTypes?.[edge.type];

        return Arrow
          ? React.createElement(
              "div",
              { key: edge.id, "data-testid": `flow-edge-${edge.id}` },
              React.createElement(Arrow, {
                id: edge.id,
                source: edge.source,
                target: edge.target,
                data: edge.data,
                style: edge.style,
                markerEnd: "url(#arrow)",
                sourceX: 0,
                sourceY: 0,
                targetX: 100,
                targetY: 0,
                sourcePosition: "right",
                targetPosition: "left",
              }),
            )
          : null;
      }),
      (props.nodes || []).map((node: any) => {
        const Card: any = props.nodeTypes[node.type];

        return React.createElement(
          "div",
          { key: node.id, "data-testid": `flow-node-${node.id}` },
          React.createElement(Card, {
            id: node.id,
            data: node.data,
            type: node.type,
            selected: false,
            isConnectable: false,
            xPos: node.position.x,
            yPos: node.position.y,
            zIndex: 0,
            dragging: false,
          }),
        );
      }),
      props.children,
    );
  };

  return {
    __esModule: true,
    default: MockReactFlow,
    Background: () => {
      return null;
    },
    Controls: () => {
      return null;
    },
    Handle: () => {
      return null;
    },
    Position: {
      Top: "top",
      Bottom: "bottom",
      Left: "left",
      Right: "right",
    },
    BackgroundVariant: { Dots: "dots" },
    MarkerType: { ArrowClosed: "arrowclosed" },
    // An arrow's line, and its label drawn where it is.
    BaseEdge: (props: any) => {
      return React.createElement("svg", {
        "data-testid": "base-edge",
        "data-path": props.path,
      });
    },
    EdgeLabelRenderer: (props: any) => {
      return React.createElement(React.Fragment, null, props.children);
    },
    getBezierPath: () => {
      return ["M0,0 C50,0 50,0 100,0", 50, 0];
    },
  };
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
  DEFAULT_DATA_LINEAGE_DEPTH,
  DataLineageEdgeKind,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  getLineageEdgeId,
} from "../../../Types/DataObservability/DataTableLineage";
import TableLineageDiagram from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/TableLineageDiagram";
import {
  LINEAGE_EDGE_LABEL_MAX_WIDTH,
  LINEAGE_PROBLEM_COLOR,
  LINEAGE_QUERY_HISTORY_DASH,
  LINEAGE_READABLE_ZOOM,
  layoutLineage,
  getLineageViewport,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageGraphModel";
import { PillSize } from "../../../UI/Components/Pill/Pill";

const TABLE: string = "22222222-2222-4222-8222-000000000001";
const SOURCE: string = "22222222-2222-4222-8222-000000000002";
const STAGING: string = "22222222-2222-4222-8222-000000000003";
const MART: string = "22222222-2222-4222-8222-000000000004";
const DROPPED: string = "22222222-2222-4222-8222-000000000005";
const SYNC: string = "33333333-3333-4333-8333-000000000001";
const ETL: string = "33333333-3333-4333-8333-000000000002";
const BOARD: string = "44444444-4444-4444-8444-000000000001";
const SHADY_BOARD: string = "44444444-4444-4444-8444-000000000002";

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
  fields: Partial<DataTableLineageEdge> = {},
): DataTableLineageEdge {
  return {
    id: getLineageEdgeId({ kind, source, target }),
    source,
    target,
    kind,
    seenIn: [DataAssetLineageSource.Pipeline],
    pipelines: [],
    lastSeenAt: null,
    ...fields,
  };
}

/*
 * raw.orders (late, loaded by a Fivetran sync) -> staging (dropped? no:
 * fresh, with five more upstream not drawn) -> the table -> mart (two open
 * alerts) -> a revenue dashboard. The table is also built from a dropped
 * table, seen only in query history.
 */
function aLineage(fields: Partial<DataTableLineage> = {}): DataTableLineage {
  return {
    focusNodeId: `table:${TABLE}`,
    depth: 3,
    nodes: [
      table(TABLE, DataLineageSide.Focus, 0, { name: "analytics.orders" }),
      table(STAGING, DataLineageSide.Upstream, -1, {
        name: "staging.orders",
        hiddenUpstreamCount: 5,
      }),
      table(DROPPED, DataLineageSide.Upstream, -1, {
        name: "legacy.orders",
        isDropped: true,
      }),
      table(SOURCE, DataLineageSide.Upstream, -2, {
        name: "raw.orders",
        freshness: DataAssetFreshness.Late,
        lateBySeconds: 22 * 3600,
      }),
      table(MART, DataLineageSide.Downstream, 1, {
        name: "mart.revenue",
        assetKind: DataAssetKind.View,
        freshness: DataAssetFreshness.NotApplicable,
        openAlertCount: 2,
      }),
      {
        id: `pipeline:${SYNC}`,
        kind: DataLineageNodeKind.Pipeline,
        side: DataLineageSide.Upstream,
        depth: -3,
        name: "shopify_orders",
        dataPipelineId: SYNC,
        jobNamespace: "fivetran",
        lastRunState: "FAIL",
        lastRunStartedAt: null,
        lastErrorMessage: "rate limited",
      },
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
      {
        id: `dashboard:${SHADY_BOARD}`,
        kind: DataLineageNodeKind.Dashboard,
        side: DataLineageSide.Downstream,
        depth: 1,
        name: "Not a web link",
        dataDashboardId: SHADY_BOARD,
        tool: "Looker",
        url: "javascript:alert(1)",
      },
    ],
    edges: [
      arrow(DataLineageEdgeKind.Writes, `pipeline:${SYNC}`, `table:${SOURCE}`, {
        pipelines: [
          {
            dataPipelineId: SYNC,
            name: "shopify_orders",
            lastRunState: "FAIL",
          },
        ],
      }),
      arrow(DataLineageEdgeKind.Feeds, `table:${SOURCE}`, `table:${STAGING}`, {
        pipelines: [
          { dataPipelineId: ETL, name: "orders_etl", lastRunState: "FAIL" },
        ],
      }),
      arrow(DataLineageEdgeKind.Feeds, `table:${STAGING}`, `table:${TABLE}`),
      arrow(DataLineageEdgeKind.Feeds, `table:${DROPPED}`, `table:${TABLE}`, {
        seenIn: [DataAssetLineageSource.QueryHistory],
      }),
      arrow(DataLineageEdgeKind.Feeds, `table:${TABLE}`, `table:${MART}`),
      arrow(DataLineageEdgeKind.Reads, `table:${MART}`, `dashboard:${BOARD}`, {
        seenIn: [],
      }),
      arrow(
        DataLineageEdgeKind.Reads,
        `table:${TABLE}`,
        `dashboard:${SHADY_BOARD}`,
        { seenIn: [] },
      ),
    ],
    hiddenDashboardCount: 0,
    isTruncated: false,
    ...fields,
  };
}

// A promise and the hands that settle it, for answers a test times.
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

function flowEdge(id: string): FlowEdge {
  const found: FlowEdge | undefined = (mockFlowProps?.edges || []).find(
    (edge: FlowEdge): boolean => {
      return edge.id === id;
    },
  );

  expect(found).toBeDefined();

  return found!;
}

async function renderDrawn(
  lineage: DataTableLineage = aLineage(),
): Promise<void> {
  getTableLineageMock.mockResolvedValue(lineage);
  render(<TableLineageDiagram dataAssetId={new ObjectID(TABLE)} />);
  await screen.findByTestId("mock-react-flow");
}

beforeEach(() => {
  getTableLineageMock.mockReset();
  setViewportMock.mockReset();
  mockFlowProps = null;
});

afterEach(() => {
  cleanup();
});

describe("reading the lineage", () => {
  test("asks for the table, three steps each way, and shows a loader until the answer comes", async () => {
    const answer: ReturnType<typeof deferred<DataTableLineage>> =
      deferred<DataTableLineage>();
    getTableLineageMock.mockReturnValue(answer.promise);

    render(<TableLineageDiagram dataAssetId={new ObjectID(TABLE)} />);

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(getTableLineageMock).toHaveBeenCalledTimes(1);
    expect((getTableLineageMock.mock.calls[0]![0] as ObjectID).toString()).toBe(
      TABLE,
    );
    expect(getTableLineageMock.mock.calls[0]![1]).toBe(
      DEFAULT_DATA_LINEAGE_DEPTH,
    );

    await act(async () => {
      answer.resolve(aLineage());
    });

    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
    expect(screen.getByTestId("lineage-graph")).toBeInTheDocument();
    expect(screen.getByTestId("lineage-legend")).toBeInTheDocument();
  });

  test("the steps switch asks again for the steps chosen", async () => {
    await renderDrawn();

    expect(
      screen.getByTestId(`lineage-depth-${DEFAULT_DATA_LINEAGE_DEPTH}`),
    ).toHaveAttribute("aria-pressed", "true");

    getTableLineageMock.mockResolvedValue(aLineage({ depth: 5 }));
    fireEvent.click(screen.getByTestId("lineage-depth-5"));

    await waitFor(() => {
      expect(getTableLineageMock).toHaveBeenCalledTimes(2);
    });
    expect(getTableLineageMock.mock.calls[1]![1]).toBe(5);
    expect(screen.getByTestId("lineage-depth-5")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await screen.findByTestId("mock-react-flow");
  });

  test("offers one, two, three and five steps", async () => {
    await renderDrawn();

    for (const steps of ["1", "2", "3", "5"]) {
      expect(screen.getByTestId(`lineage-depth-${steps}`)).toBeInTheDocument();
    }

    expect(screen.getByTestId("lineage-depth-1")).toHaveTextContent("1 step");
    expect(screen.getByTestId("lineage-depth-5")).toHaveTextContent("5 steps");
  });

  test("an answer for steps no longer chosen never replaces the one asked for", async () => {
    const first: ReturnType<typeof deferred<DataTableLineage>> =
      deferred<DataTableLineage>();
    const second: ReturnType<typeof deferred<DataTableLineage>> =
      deferred<DataTableLineage>();
    getTableLineageMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    render(<TableLineageDiagram dataAssetId={new ObjectID(TABLE)} />);
    fireEvent.click(screen.getByTestId("lineage-depth-1"));

    await act(async () => {
      second.resolve(
        aLineage({
          depth: 1,
          nodes: [table(TABLE, DataLineageSide.Focus, 0, { name: "only" })],
          edges: [],
        }),
      );
    });
    await act(async () => {
      first.resolve(aLineage());
    });

    // The one-step answer: nothing but the table, so nothing drawn.
    expect(screen.getByTestId("lineage-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-react-flow")).not.toBeInTheDocument();
  });

  test("another table is read afresh", async () => {
    getTableLineageMock.mockResolvedValue(aLineage());
    const view: ReturnType<typeof render> = render(
      <TableLineageDiagram dataAssetId={new ObjectID(TABLE)} />,
    );
    await screen.findByTestId("mock-react-flow");

    view.rerender(<TableLineageDiagram dataAssetId={new ObjectID(MART)} />);

    await waitFor(() => {
      expect(getTableLineageMock).toHaveBeenCalledTimes(2);
    });
    expect((getTableLineageMock.mock.calls[1]![0] as ObjectID).toString()).toBe(
      MART,
    );
  });

  test("a read that fails says why, and reads again on Refresh", async () => {
    getTableLineageMock.mockRejectedValueOnce(
      new Error("You do not have permission to do this in Data Observability."),
    );
    render(<TableLineageDiagram dataAssetId={new ObjectID(TABLE)} />);

    expect(
      await screen.findByText(
        "You do not have permission to do this in Data Observability.",
      ),
    ).toBeInTheDocument();

    getTableLineageMock.mockResolvedValueOnce(aLineage());
    fireEvent.click(screen.getByTestId("refresh-button"));

    await screen.findByTestId("mock-react-flow");
    expect(getTableLineageMock).toHaveBeenCalledTimes(2);
  });

  test("a table with no lineage says where lineage comes from, and draws nothing", async () => {
    getTableLineageMock.mockResolvedValue(
      aLineage({
        nodes: [table(TABLE, DataLineageSide.Focus, 0)],
        edges: [],
      }),
    );
    render(<TableLineageDiagram dataAssetId={new ObjectID(TABLE)} />);

    expect(await screen.findByTestId("lineage-empty")).toHaveTextContent(
      "No lineage has been seen for this table yet.",
    );
    expect(screen.queryByTestId("lineage-graph")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lineage-legend")).not.toBeInTheDocument();
  });
});

describe("the cards", () => {
  test("the table itself is ringed, says so, and opens nothing", async () => {
    await renderDrawn();

    const focus: HTMLElement = card(`table:${TABLE}`);

    expect(focus).toHaveTextContent("analytics.orders");
    expect(focus).toHaveTextContent("This table");
    expect(within(focus).queryByRole("link")).not.toBeInTheDocument();
  });

  test("another table opens its own Lineage tab, to center the diagram on it", async () => {
    await renderDrawn();

    const link: HTMLElement = within(card(`table:${STAGING}`)).getByTestId(
      "lineage-card",
    );

    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toContain(
      `/data-observability/tables/${STAGING}/lineage`,
    );
    expect(link.getAttribute("href")).toContain(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  test("a table says where it lives and what it is", async () => {
    await renderDrawn();

    expect(card(`table:${STAGING}`)).toHaveTextContent("Warehouse · Table");
    expect(card(`table:${MART}`)).toHaveTextContent("Warehouse · View");
  });

  test("a late table says by how much, a fresh one that it is fresh", async () => {
    await renderDrawn();

    expect(card(`table:${SOURCE}`)).toHaveTextContent("Late by 22 hours");
    expect(card(`table:${STAGING}`)).toHaveTextContent("Fresh");
  });

  test("a table with open alerts counts them", async () => {
    await renderDrawn();

    expect(card(`table:${MART}`)).toHaveTextContent("2 open alerts");
  });

  test("a dropped table says so and nothing else", async () => {
    await renderDrawn();

    const dropped: HTMLElement = card(`table:${DROPPED}`);

    expect(dropped).toHaveTextContent("Dropped");
    expect(dropped).not.toHaveTextContent("Fresh");
  });

  test("tables a card does not draw are counted on its outer side, with what to do", async () => {
    await renderDrawn();

    const hidden: HTMLElement = within(card(`table:${STAGING}`)).getByTestId(
      "lineage-hidden-left",
    );

    expect(hidden).toHaveTextContent("+5");
    expect(hidden.getAttribute("title")).toBe(
      "5 more tables upstream are not drawn. Open this table to center the diagram on it.",
    );
    expect(
      within(card(`table:${MART}`)).queryByTestId("lineage-hidden-right"),
    ).not.toBeInTheDocument();
  });

  test("on the table itself, the tables not drawn are in the lists below", async () => {
    const lineage: DataTableLineage = aLineage();
    lineage.nodes[0] = table(TABLE, DataLineageSide.Focus, 0, {
      hiddenDownstreamCount: 1,
    });
    await renderDrawn(lineage);

    expect(
      within(card(`table:${TABLE}`))
        .getByTestId("lineage-hidden-right")
        .getAttribute("title"),
    ).toBe(
      "1 more table built from this one is not drawn. Feeds below lists them all.",
    );
  });

  test("a pipeline says how its latest run went and opens its page", async () => {
    await renderDrawn();

    const sync: HTMLElement = card(`pipeline:${SYNC}`);

    expect(sync).toHaveTextContent("shopify_orders");
    expect(sync).toHaveTextContent("fivetran");
    expect(within(sync).getByTestId("run-state")).toHaveTextContent("FAIL");
    // Small, as every other chip on a card.
    expect(within(sync).getByTestId("run-state")).toHaveAttribute(
      "data-size",
      PillSize.Small,
    );
    expect(
      within(sync).getByTestId("lineage-card").getAttribute("href"),
    ).toContain(`/data-observability/pipelines/${SYNC}`);
  });

  test("a dashboard opens in its tool, in a new tab", async () => {
    await renderDrawn();

    const board: HTMLElement = within(card(`dashboard:${BOARD}`)).getByTestId(
      "lineage-card",
    );

    expect(board.getAttribute("href")).toBe(
      "https://metabase.example.com/dashboard/7",
    );
    expect(board.getAttribute("target")).toBe("_blank");
    expect(card(`dashboard:${BOARD}`)).toHaveTextContent("Metabase");
  });

  test("a dashboard whose link is not on the web opens nothing", async () => {
    await renderDrawn();

    const shady: HTMLElement = card(`dashboard:${SHADY_BOARD}`);

    expect(within(shady).queryByRole("link")).not.toBeInTheDocument();
    expect(shady.innerHTML).not.toContain("javascript:");
  });
});

describe("the arrows", () => {
  test("an arrow whose pipeline's latest run failed is red and carries the pipeline's name", async () => {
    await renderDrawn();

    const id: string = getLineageEdgeId({
      kind: DataLineageEdgeKind.Feeds,
      source: `table:${SOURCE}`,
      target: `table:${STAGING}`,
    });
    const failed: FlowEdge = flowEdge(id);

    expect(failed.type).toBe("lineageArrow");
    expect(failed.data).toEqual({
      label: "orders_etl",
      title: "orders_etl failed",
    });
    expect(failed.style?.stroke).toBe(LINEAGE_PROBLEM_COLOR);
    expect(failed.markerEnd).toMatchObject({ color: LINEAGE_PROBLEM_COLOR });

    // Drawn: the name on the arrow, cut to the room between columns, the sentence under the pointer.
    const label: HTMLElement = within(
      screen.getByTestId(`flow-edge-${id}`),
    ).getByTestId("lineage-edge-label");

    expect(label).toHaveTextContent("orders_etl");
    expect(label).toHaveAttribute("title", "orders_etl failed");
    expect(label).toHaveClass("truncate");
    expect(label.style.maxWidth).toBe(`${LINEAGE_EDGE_LABEL_MAX_WIDTH}px`);
  });

  test("an arrow seen only in query history is dashed, one moved by a pipeline solid and unlabelled", async () => {
    await renderDrawn();

    expect(
      flowEdge(
        getLineageEdgeId({
          kind: DataLineageEdgeKind.Feeds,
          source: `table:${DROPPED}`,
          target: `table:${TABLE}`,
        }),
      ).style?.strokeDasharray,
    ).toBe(LINEAGE_QUERY_HISTORY_DASH);

    const solid: FlowEdge = flowEdge(
      getLineageEdgeId({
        kind: DataLineageEdgeKind.Feeds,
        source: `table:${STAGING}`,
        target: `table:${TABLE}`,
      }),
    );

    expect(solid.style?.strokeDasharray).toBeUndefined();
    expect(solid.data).toEqual({});
    expect(
      within(screen.getByTestId(`flow-edge-${solid.id}`)).queryByTestId(
        "lineage-edge-label",
      ),
    ).not.toBeInTheDocument();
  });

  test("every card and arrow is handed to the drawing, nothing dragged or zoomed by the wheel", async () => {
    await renderDrawn();

    expect(mockFlowProps?.nodes).toHaveLength(aLineage().nodes.length);
    expect(mockFlowProps?.edges).toHaveLength(aLineage().edges.length);
    expect(mockFlowProps?.nodesDraggable).toBe(false);
    expect(mockFlowProps?.zoomOnScroll).toBe(false);
    expect(mockFlowProps?.preventScrolling).toBe(false);
  });
});

describe("the summary and notes", () => {
  test("says what lies each way and where the problems are", async () => {
    await renderDrawn();

    const summary: HTMLElement = screen.getByTestId("lineage-summary");

    expect(summary).toHaveTextContent("3 tables upstream");
    // The late source and the failed sync.
    expect(within(summary).getByText("2 problems upstream")).toHaveClass(
      "text-red-600",
    );
    expect(summary).toHaveTextContent("1 table downstream");
    expect(summary).toHaveTextContent("1 problem downstream");
    expect(summary).toHaveTextContent("2 dashboards");
  });

  test("no problems: no problem is named", async () => {
    await renderDrawn(
      aLineage({
        nodes: [
          table(TABLE, DataLineageSide.Focus, 0),
          table(STAGING, DataLineageSide.Upstream, -1),
        ],
        edges: [
          arrow(
            DataLineageEdgeKind.Feeds,
            `table:${STAGING}`,
            `table:${TABLE}`,
          ),
        ],
      }),
    );

    const summary: HTMLElement = screen.getByTestId("lineage-summary");

    expect(summary).toHaveTextContent("1 table upstream");
    expect(summary).toHaveTextContent("0 tables downstream");
    expect(summary).not.toHaveTextContent("problem");
    expect(summary).not.toHaveTextContent("dashboard");
    expect(screen.queryByTestId("lineage-notes")).not.toBeInTheDocument();
  });

  test("a drawing that could not hold it all says so, and counts the dashboards left out", async () => {
    await renderDrawn(aLineage({ isTruncated: true, hiddenDashboardCount: 3 }));

    const notes: HTMLElement = screen.getByTestId("lineage-notes");

    expect(notes).toHaveTextContent(
      "This lineage is larger than one diagram holds",
    );
    expect(notes).toHaveTextContent(
      "3 more dashboards are built on these tables and are not drawn.",
    );
  });

  test("the legend says what each line and colour means", async () => {
    await renderDrawn();

    const legend: HTMLElement = screen.getByTestId("lineage-legend");

    for (const words of [
      "Pipeline run",
      "Query history",
      "View definition",
      "Latest run failed",
      "Late, open alert or failed run",
      "Fresh or last run complete",
      "Dropped",
    ]) {
      expect(legend).toHaveTextContent(words);
    }
  });
});

describe("where the drawing is looked at from", () => {
  type ResizeCallback = () => void;

  let resizeCallbacks: Array<ResizeCallback>;
  let canvasBox: { width: number; height: number };
  let realResizeObserver: unknown;
  let realGetBoundingClientRect: () => DOMRect;

  beforeEach(() => {
    resizeCallbacks = [];
    canvasBox = { width: 1000, height: 400 };
    realResizeObserver = (globalThis as any).ResizeObserver;
    (globalThis as any).ResizeObserver = class {
      private callback: ResizeCallback;

      public constructor(callback: ResizeCallback) {
        this.callback = callback;
      }

      public observe(): void {
        resizeCallbacks.push(this.callback);
      }

      public disconnect(): void {
        resizeCallbacks = resizeCallbacks.filter((callback: ResizeCallback) => {
          return callback !== this.callback;
        });
      }
    };
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
    (globalThis as any).ResizeObserver = realResizeObserver;
    HTMLElement.prototype.getBoundingClientRect = realGetBoundingClientRect;
  });

  test("a drawing too wide to read whole opens on the table, at a readable zoom", async () => {
    await renderDrawn();

    const expected: ReturnType<typeof getLineageViewport> = getLineageViewport({
      layout: layoutLineage(aLineage()),
      focusNodeId: `table:${TABLE}`,
      width: 1000,
      height: 400,
    });

    expect(expected?.zoom).toBe(LINEAGE_READABLE_ZOOM);
    expect(mockFlowProps?.fitView).toBe(false);
    expect(mockFlowProps?.defaultViewport).toEqual(expected);
  });

  test("a small drawing opens whole", async () => {
    canvasBox = { width: 2400, height: 600 };
    await renderDrawn(
      aLineage({
        nodes: [
          table(TABLE, DataLineageSide.Focus, 0),
          table(STAGING, DataLineageSide.Upstream, -1),
        ],
        edges: [
          arrow(
            DataLineageEdgeKind.Feeds,
            `table:${STAGING}`,
            `table:${TABLE}`,
          ),
        ],
      }),
    );

    const viewport: { x: number; y: number; zoom: number } | undefined =
      mockFlowProps?.defaultViewport;

    // Fitted, never past life size.
    expect(viewport?.zoom).toBe(1);
    expect(viewport?.x).toBeGreaterThan(0);
  });

  test("follows the canvas's size until the reader moves the view, then never again", async () => {
    await renderDrawn();

    expect(resizeCallbacks).toHaveLength(1);

    canvasBox = { width: 1400, height: 500 };
    act(() => {
      resizeCallbacks[0]!();
    });

    expect(setViewportMock).toHaveBeenCalledTimes(1);
    expect(setViewportMock.mock.calls[0]![0]).toEqual(
      getLineageViewport({
        layout: layoutLineage(aLineage()),
        focusNodeId: `table:${TABLE}`,
        width: 1400,
        height: 500,
      }),
    );

    // A move of the view's own (no event) leaves it following; the reader's own move ends it.
    act(() => {
      mockFlowProps?.onMoveStart?.(null as never, { x: 0, y: 0, zoom: 1 });
    });
    act(() => {
      resizeCallbacks[0]!();
    });

    expect(setViewportMock).toHaveBeenCalledTimes(2);

    act(() => {
      mockFlowProps?.onMoveStart?.(new MouseEvent("mousedown") as never, {
        x: 0,
        y: 0,
        zoom: 1,
      });
    });
    canvasBox = { width: 800, height: 400 };
    act(() => {
      resizeCallbacks[0]!();
    });

    expect(setViewportMock).toHaveBeenCalledTimes(2);
  });

  test("a canvas with no size is fitted by React Flow", async () => {
    canvasBox = { width: 0, height: 0 };
    await renderDrawn();

    expect(mockFlowProps?.fitView).toBe(true);
    expect(mockFlowProps?.defaultViewport).toBeUndefined();
  });
});
