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
import { Edge as FlowEdge, Node as FlowNode, ReactFlowProps } from "reactflow";
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
 * A pipeline's lineage diagram, on its page between its stats and its runs:
 * it asks the pipeline-lineage route for the pipeline and the steps chosen
 * (one by default), and draws the answer with the pipeline in the middle -
 * the tables it reads on the left, the tables it writes on the right, each
 * opening its own Lineage tab - and says how many it reads and writes. The
 * API is mocked and React Flow is a stand-in that draws each card with the
 * component's own card, as TableLineageDiagram.test.tsx does.
 */

const getPipelineLineageMock: MockFunction = getJestMockFunction();

// The props of the latest React Flow drawing: its cards and arrows.
let mockFlowProps: ReactFlowProps | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi",
  () => {
    return {
      __esModule: true,
      default: {
        getPipelineLineage: (...args: Array<any>) => {
          return getPipelineLineageMock(...args);
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

// React Flow measures nothing in jsdom: each card and arrow drawn with the diagram's own.
jest.mock("reactflow", () => {
  const MockReactFlow: (props: any) => React.ReactElement = (
    props: any,
  ): React.ReactElement => {
    mockFlowProps = props;

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
  DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH,
  DataLineageEdgeKind,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  getLineageEdgeId,
} from "../../../Types/DataObservability/DataTableLineage";
import PipelineLineageDiagram from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/PipelineLineageDiagram";
import {
  LINEAGE_NEUTRAL_COLOR,
  LINEAGE_PROBLEM_COLOR,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageGraphModel";

const ETL: string = "33333333-3333-4333-8333-000000000001";
const OTHER_ETL: string = "33333333-3333-4333-8333-000000000002";
const RAW: string = "22222222-2222-4222-8222-000000000001";
const CUSTOMERS: string = "22222222-2222-4222-8222-000000000002";
const STAGING: string = "22222222-2222-4222-8222-000000000003";
const SOURCE: string = "22222222-2222-4222-8222-000000000004";

const ETL_NODE: string = `pipeline:${ETL}`;

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
 * orders_etl, whose latest run failed, reads raw.orders (late) and
 * raw.customers - and three more tables not drawn - and writes
 * staging.orders.
 */
function aLineage(fields: Partial<DataTableLineage> = {}): DataTableLineage {
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
        lastRunState: "FAIL",
        lastRunStartedAt: null,
        lastErrorMessage: "relation does not exist",
        hiddenUpstreamCount: 3,
        hiddenDownstreamCount: 0,
      },
      table(RAW, DataLineageSide.Upstream, -1, {
        name: "raw.orders",
        freshness: DataAssetFreshness.Late,
        lateBySeconds: 5 * 3600,
      }),
      table(CUSTOMERS, DataLineageSide.Upstream, -1, {
        name: "raw.customers",
      }),
      table(STAGING, DataLineageSide.Downstream, 1, {
        name: "staging.orders",
      }),
    ],
    edges: [
      arrow(DataLineageEdgeKind.Reads, `table:${RAW}`, ETL_NODE),
      arrow(DataLineageEdgeKind.Reads, `table:${CUSTOMERS}`, ETL_NODE),
      arrow(DataLineageEdgeKind.Writes, ETL_NODE, `table:${STAGING}`, {
        pipelines: [
          { dataPipelineId: ETL, name: "orders_etl", lastRunState: "FAIL" },
        ],
      }),
    ],
    hiddenDashboardCount: 0,
    isTruncated: false,
    ...fields,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise: Promise<T> = new Promise<T>((yes: (value: T) => void) => {
    resolve = yes;
  });

  return { promise, resolve };
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

function flowNode(id: string): FlowNode {
  const found: FlowNode | undefined = (mockFlowProps?.nodes || []).find(
    (node: FlowNode): boolean => {
      return node.id === id;
    },
  );

  expect(found).toBeDefined();

  return found!;
}

async function renderDrawn(
  lineage: DataTableLineage = aLineage(),
): Promise<void> {
  getPipelineLineageMock.mockResolvedValue(lineage);
  render(<PipelineLineageDiagram dataPipelineId={new ObjectID(ETL)} />);
  await screen.findByTestId("mock-react-flow");
}

beforeEach(() => {
  getPipelineLineageMock.mockReset();
  mockFlowProps = null;
});

afterEach(() => {
  cleanup();
});

describe("reading a pipeline's lineage", () => {
  test("asks for the pipeline, one step each way, and shows a loader until the answer comes", async () => {
    const answer: ReturnType<typeof deferred<DataTableLineage>> =
      deferred<DataTableLineage>();
    getPipelineLineageMock.mockReturnValue(answer.promise);

    render(<PipelineLineageDiagram dataPipelineId={new ObjectID(ETL)} />);

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(getPipelineLineageMock).toHaveBeenCalledTimes(1);
    expect(
      (getPipelineLineageMock.mock.calls[0]![0] as ObjectID).toString(),
    ).toBe(ETL);
    expect(getPipelineLineageMock.mock.calls[0]![1]).toBe(
      DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH,
    );
    expect(screen.getByTestId("lineage-depth-1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await act(async () => {
      answer.resolve(aLineage());
    });

    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
    expect(screen.getByTestId("pipeline-lineage-diagram")).toBeInTheDocument();
    expect(screen.getByTestId("lineage-graph")).toHaveAttribute(
      "aria-label",
      "The tables this pipeline reads and the tables it writes, with the lineage around them",
    );
  });

  test("the steps switch asks again for the steps chosen", async () => {
    await renderDrawn();

    getPipelineLineageMock.mockResolvedValue(aLineage({ depth: 3 }));
    fireEvent.click(screen.getByTestId("lineage-depth-3"));

    await waitFor(() => {
      expect(getPipelineLineageMock).toHaveBeenCalledTimes(2);
    });
    expect(getPipelineLineageMock.mock.calls[1]![1]).toBe(3);
    expect(screen.getByTestId("lineage-depth-3")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("another pipeline is read afresh", async () => {
    getPipelineLineageMock.mockResolvedValue(aLineage());

    const view: ReturnType<typeof render> = render(
      <PipelineLineageDiagram dataPipelineId={new ObjectID(ETL)} />,
    );

    await screen.findByTestId("mock-react-flow");

    view.rerender(
      <PipelineLineageDiagram dataPipelineId={new ObjectID(OTHER_ETL)} />,
    );

    await waitFor(() => {
      expect(getPipelineLineageMock).toHaveBeenCalledTimes(2);
    });
    expect(
      (getPipelineLineageMock.mock.calls[1]![0] as ObjectID).toString(),
    ).toBe(OTHER_ETL);
  });

  test("a read that fails says why, and reads again on Refresh", async () => {
    getPipelineLineageMock.mockRejectedValueOnce(
      new Error("You do not have permission to do this in Data Observability."),
    );
    render(<PipelineLineageDiagram dataPipelineId={new ObjectID(ETL)} />);

    expect(
      await screen.findByText(
        "You do not have permission to do this in Data Observability.",
      ),
    ).toBeInTheDocument();

    getPipelineLineageMock.mockResolvedValueOnce(aLineage());
    fireEvent.click(screen.getByTestId("refresh-button"));

    await screen.findByTestId("mock-react-flow");
    expect(getPipelineLineageMock).toHaveBeenCalledTimes(2);
  });

  test("a read that fails with nothing to say says the lineage could not be read", async () => {
    getPipelineLineageMock.mockRejectedValueOnce(new Error(""));
    render(<PipelineLineageDiagram dataPipelineId={new ObjectID(ETL)} />);

    expect(
      await screen.findByText("Could not read this pipeline's lineage."),
    ).toBeInTheDocument();
  });

  test("a pipeline no table has been seen read or written by says where they come from, and draws nothing", async () => {
    getPipelineLineageMock.mockResolvedValue(
      aLineage({ nodes: [aLineage().nodes[0]!], edges: [] }),
    );
    render(<PipelineLineageDiagram dataPipelineId={new ObjectID(ETL)} />);

    expect(await screen.findByTestId("lineage-empty")).toHaveTextContent(
      "No table has been seen read or written by this pipeline yet.",
    );
    expect(screen.queryByTestId("lineage-graph")).not.toBeInTheDocument();
  });
});

describe("the pipeline and its tables", () => {
  test("the pipeline is in the middle: ringed, says so and how its run went, and opens nothing", async () => {
    await renderDrawn();

    const focus: HTMLElement = card(ETL_NODE);

    expect(focus).toHaveTextContent("orders_etl");
    expect(focus).toHaveTextContent("This pipeline");
    expect(within(focus).getByTestId("run-state")).toHaveTextContent("FAIL");
    // Its own page is the page it is on.
    expect(within(focus).queryByRole("link")).not.toBeInTheDocument();
  });

  test("what it reads is on its left, what it writes on its right", async () => {
    await renderDrawn();

    const middle: number = flowNode(ETL_NODE).position.x;

    expect(flowNode(`table:${RAW}`).position.x).toBeLessThan(middle);
    expect(flowNode(`table:${CUSTOMERS}`).position.x).toBeLessThan(middle);
    expect(flowNode(`table:${STAGING}`).position.x).toBeGreaterThan(middle);
  });

  test("a table it reads or writes opens its own Lineage tab", async () => {
    await renderDrawn();

    for (const id of [RAW, STAGING]) {
      const link: HTMLElement = within(card(`table:${id}`)).getByTestId(
        "lineage-card",
      );

      expect(link.getAttribute("href")).toContain(
        `/data-observability/tables/${id}/lineage`,
      );
    }
  });

  test("the tables it reads that are not drawn are counted on its card, as tables it reads", async () => {
    await renderDrawn();

    const hidden: HTMLElement = within(card(ETL_NODE)).getByTestId(
      "lineage-hidden-left",
    );

    expect(hidden).toHaveTextContent("+3");
    expect(hidden.getAttribute("title")).toBe(
      "3 more tables this pipeline reads are not drawn.",
    );
    expect(
      within(card(ETL_NODE)).queryByTestId("lineage-hidden-right"),
    ).not.toBeInTheDocument();
  });

  test("one table it writes not drawn is told in the singular", async () => {
    const lineage: DataTableLineage = aLineage();
    lineage.nodes[0] = { ...lineage.nodes[0]!, hiddenDownstreamCount: 1 };
    await renderDrawn(lineage);

    expect(
      within(card(ETL_NODE))
        .getByTestId("lineage-hidden-right")
        .getAttribute("title"),
    ).toBe("1 more table this pipeline writes is not drawn.");
  });

  test("a table further away keeps a table's own count", async () => {
    const lineage: DataTableLineage = aLineage({ depth: 2 });
    lineage.nodes.push(
      table(SOURCE, DataLineageSide.Upstream, -2, {
        name: "landing.orders",
        hiddenUpstreamCount: 2,
      }),
    );
    lineage.edges.push(
      arrow(DataLineageEdgeKind.Feeds, `table:${SOURCE}`, `table:${RAW}`),
    );
    await renderDrawn(lineage);

    expect(
      within(card(`table:${SOURCE}`))
        .getByTestId("lineage-hidden-left")
        .getAttribute("title"),
    ).toBe(
      "2 more tables upstream are not drawn. Open this table to center the diagram on it.",
    );
    expect(flowNode(`table:${SOURCE}`).position.x).toBeLessThan(
      flowNode(`table:${RAW}`).position.x,
    );
  });
});

describe("its arrows", () => {
  test("what it reads comes in as any arrow does, never as a dashboard's light read", async () => {
    await renderDrawn();

    const read: FlowEdge = flowEdge(
      getLineageEdgeId({
        kind: DataLineageEdgeKind.Reads,
        source: `table:${RAW}`,
        target: ETL_NODE,
      }),
    );

    expect(read.style?.stroke).toBe(LINEAGE_NEUTRAL_COLOR);
    expect(read.data).toEqual({});
  });

  test("what it writes goes out red when its run failed, its own name on no arrow", async () => {
    await renderDrawn();

    const write: FlowEdge = flowEdge(
      getLineageEdgeId({
        kind: DataLineageEdgeKind.Writes,
        source: ETL_NODE,
        target: `table:${STAGING}`,
      }),
    );

    expect(write.style?.stroke).toBe(LINEAGE_PROBLEM_COLOR);
    // Its card says it failed: the arrow carries no label.
    expect(write.data).toEqual({});
    expect(screen.queryByTestId("lineage-edge-label")).not.toBeInTheDocument();
  });

  test("nothing is picked out on a pipeline's page", async () => {
    await renderDrawn();

    expect(screen.queryByTestId("lineage-edge-halo")).not.toBeInTheDocument();
    expect(document.querySelector("[data-dimmed]")).toBeNull();
    expect(document.querySelector("[data-role]")).toBeNull();
    // Nor marked: the ways' mark is the alert's page's own.
    expect(
      screen.queryByTestId("lineage-highlight-mark"),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getByTestId("lineage-legend")
        .querySelector("line[stroke-opacity]"),
    ).toBeNull();
  });
});

describe("the summary", () => {
  test("says how many tables it reads and writes, those not drawn included, and where the problems are", async () => {
    await renderDrawn();

    const summary: HTMLElement = screen.getByTestId("lineage-summary");

    expect(summary).toHaveTextContent("Reads 5 tables");
    expect(summary).toHaveTextContent("Writes 1 table");
    // The late table it reads.
    expect(within(summary).getByText("1 problem upstream")).toHaveClass(
      "text-red-600",
    );
    expect(summary).not.toHaveTextContent("tables upstream");
    expect(summary).not.toHaveTextContent("downstream");
  });
});
