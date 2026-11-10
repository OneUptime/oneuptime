import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
 * A data alert's lineage, on its page under its Data card: it asks the
 * alert-lineage route once, for the alert, and draws the lineage around
 * the alert's table or pipeline with the way up to the alert that caused
 * it and down to the alerts it caused picked out - those cards and arrows
 * in indigo, the cause and each consequence named on its card, the rest
 * faint - says in words what is picked out, and opens the lineage to
 * explore. An alert there is nothing to draw for shows nothing at all. The
 * API is mocked and React Flow is a stand-in, as in
 * TableLineageDiagram.test.tsx.
 */

const getAlertLineageMock: MockFunction = getJestMockFunction();

let mockFlowProps: ReactFlowProps | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi",
  () => {
    return {
      __esModule: true,
      default: {
        getAlertLineage: (...args: Array<any>) => {
          return getAlertLineageMock(...args);
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

import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import { DataAssetFreshness } from "../../../Types/DataObservability/DataAssetFreshness";
import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";
import DataAssetLineageSource from "../../../Types/DataObservability/DataAssetLineageSource";
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
import Navigation from "../../../UI/Utils/Navigation";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import AlertLineageDiagram, {
  getAlertLineageSentences,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/AlertLineageDiagram";
import {
  LINEAGE_DIMMED_OPACITY,
  LINEAGE_HIGHLIGHT_COLOR,
  LINEAGE_HIGHLIGHT_WIDTH,
  LINEAGE_PROBLEM_COLOR,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageGraphModel";

const ALERT: string = "55555555-5555-4555-8555-000000000001";
const TABLE: string = "22222222-2222-4222-8222-000000000001";
const STAGING: string = "22222222-2222-4222-8222-000000000002";
const SOURCE: string = "22222222-2222-4222-8222-000000000003";
const OTHER: string = "22222222-2222-4222-8222-000000000004";
const MART: string = "22222222-2222-4222-8222-000000000005";
const SIDE: string = "22222222-2222-4222-8222-000000000006";
const REPORT: string = "22222222-2222-4222-8222-000000000007";
const MART_ETL: string = "33333333-3333-4333-8333-000000000001";
const ETL: string = "33333333-3333-4333-8333-000000000002";

const ENGLISH: Translator = createTranslator(undefined, "en");

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

function feeds(source: string, target: string): string {
  return getLineageEdgeId({
    kind: DataLineageEdgeKind.Feeds,
    source: `table:${source}`,
    target: `table:${target}`,
  });
}

/*
 * The alert is on analytics.orders. Its cause is on raw.orders, two steps
 * up through staging.orders; it caused an alert on mart.revenue and one
 * on orders_mart, the pipeline building reports.orders from it. Off the
 * ways: legacy.orders upstream and side.orders downstream.
 */
function aLineage(fields: Partial<DataTableLineage> = {}): DataTableLineage {
  return {
    focusNodeId: `table:${TABLE}`,
    depth: 3,
    nodes: [
      table(TABLE, DataLineageSide.Focus, 0, { name: "analytics.orders" }),
      table(STAGING, DataLineageSide.Upstream, -1, { name: "staging.orders" }),
      table(SOURCE, DataLineageSide.Upstream, -2, {
        name: "raw.orders",
        freshness: DataAssetFreshness.Late,
        lateBySeconds: 3 * 3600,
        openAlertCount: 1,
      }),
      table(OTHER, DataLineageSide.Upstream, -1, { name: "legacy.orders" }),
      table(MART, DataLineageSide.Downstream, 1, {
        name: "mart.revenue",
        openAlertCount: 1,
      }),
      table(REPORT, DataLineageSide.Downstream, 1, { name: "reports.orders" }),
      table(SIDE, DataLineageSide.Downstream, 1, { name: "side.orders" }),
    ],
    edges: [
      arrow(DataLineageEdgeKind.Feeds, `table:${SOURCE}`, `table:${STAGING}`),
      arrow(DataLineageEdgeKind.Feeds, `table:${STAGING}`, `table:${TABLE}`),
      arrow(DataLineageEdgeKind.Feeds, `table:${OTHER}`, `table:${TABLE}`),
      arrow(DataLineageEdgeKind.Feeds, `table:${TABLE}`, `table:${MART}`),
      arrow(DataLineageEdgeKind.Feeds, `table:${TABLE}`, `table:${REPORT}`, {
        pipelines: [
          {
            dataPipelineId: MART_ETL,
            name: "orders_mart",
            lastRunState: "COMPLETE",
          },
        ],
      }),
      arrow(DataLineageEdgeKind.Feeds, `table:${TABLE}`, `table:${SIDE}`),
    ],
    hiddenDashboardCount: 0,
    isTruncated: false,
    highlight: {
      nodeIds: [
        `table:${TABLE}`,
        `table:${STAGING}`,
        `table:${SOURCE}`,
        `table:${MART}`,
        `table:${REPORT}`,
      ],
      edgeIds: [
        feeds(SOURCE, STAGING),
        feeds(STAGING, TABLE),
        feeds(TABLE, MART),
        feeds(TABLE, REPORT),
      ].sort(),
      causeNodeIds: [`table:${SOURCE}`],
      consequenceNodeIds: [`table:${MART}`],
      dataPipelineIds: [MART_ETL],
    },
    ...fields,
  };
}

function anAnswer(
  fields: Partial<DataAlertLineageAnswer> = {},
): DataAlertLineageAnswer {
  return {
    lineage: aLineage(),
    hasCause: true,
    isCauseDrawn: true,
    consequenceCount: 3,
    drawnConsequenceCount: 2,
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

// The card's own box, where it says whether it is on a way.
function cardBox(nodeId: string): HTMLElement {
  const box: Element | null = card(nodeId).querySelector("[data-node-id]");

  expect(box).not.toBeNull();

  return box as HTMLElement;
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
  answer: DataAlertLineageAnswer = anAnswer(),
): Promise<void> {
  getAlertLineageMock.mockResolvedValue(answer);
  render(<AlertLineageDiagram alertId={new ObjectID(ALERT)} />);
  await screen.findByTestId("mock-react-flow");
}

// Lets the read settle: an answer with nothing to draw renders no drawing to wait for.
async function settle(answer: DataAlertLineageAnswer): Promise<HTMLElement> {
  getAlertLineageMock.mockResolvedValue(answer);

  let container!: HTMLElement;

  await act(async () => {
    container = render(
      <AlertLineageDiagram alertId={new ObjectID(ALERT)} />,
    ).container;
  });

  return container;
}

let navigateSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  getAlertLineageMock.mockReset();
  mockFlowProps = null;
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  navigateSpy.mockRestore();
});

describe("reading an alert's lineage", () => {
  test("asks once, for the alert, and shows a loader under the card until the answer comes", async () => {
    const answer: ReturnType<typeof deferred<DataAlertLineageAnswer>> =
      deferred<DataAlertLineageAnswer>();
    getAlertLineageMock.mockReturnValue(answer.promise);

    render(<AlertLineageDiagram alertId={new ObjectID(ALERT)} />);

    expect(screen.getByTestId("alert-lineage-diagram")).toBeInTheDocument();
    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(getAlertLineageMock).toHaveBeenCalledTimes(1);
    expect((getAlertLineageMock.mock.calls[0]![0] as ObjectID).toString()).toBe(
      ALERT,
    );

    await act(async () => {
      answer.resolve(anAnswer());
    });

    expect(screen.getByTestId("lineage-graph")).toHaveAttribute(
      "aria-label",
      "The lineage around this alert, with the way to the alert that caused it and to the alerts it caused",
    );
    // No steps to pick: the drawing walks as far as its ways need.
    expect(screen.queryByTestId("lineage-depth-1")).not.toBeInTheDocument();
  });

  test("an alert about a whole database shows nothing at all", async () => {
    const container: HTMLElement = await settle(
      anAnswer({
        lineage: null,
        isCauseDrawn: false,
        drawnConsequenceCount: 0,
      }),
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("an alert on a table no lineage has been seen for shows nothing at all", async () => {
    const container: HTMLElement = await settle(
      anAnswer({
        lineage: aLineage({
          nodes: [table(TABLE, DataLineageSide.Focus, 0)],
          edges: [],
        }),
      }),
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("a read that fails says why, and reads again on Refresh", async () => {
    getAlertLineageMock.mockRejectedValueOnce(new Error("Alert not found."));
    render(<AlertLineageDiagram alertId={new ObjectID(ALERT)} />);

    expect(await screen.findByText("Alert not found.")).toBeInTheDocument();

    getAlertLineageMock.mockResolvedValueOnce(anAnswer());
    fireEvent.click(screen.getByTestId("refresh-button"));

    await screen.findByTestId("mock-react-flow");
    expect(getAlertLineageMock).toHaveBeenCalledTimes(2);
  });
});

describe("the ways picked out", () => {
  test("the cause and the alert it caused are named on their cards", async () => {
    await renderDrawn();

    expect(cardBox(`table:${SOURCE}`)).toHaveAttribute("data-role", "Cause");
    expect(card(`table:${SOURCE}`)).toHaveTextContent("Cause");
    expect(cardBox(`table:${MART}`)).toHaveAttribute(
      "data-role",
      "Consequence",
    );
    expect(card(`table:${MART}`)).toHaveTextContent("Consequence");
    // The alert's own table says whose page this is.
    expect(card(`table:${TABLE}`)).toHaveTextContent("This alert");
    expect(cardBox(`table:${TABLE}`)).not.toHaveAttribute("data-role");
  });

  test("the cards along the ways are drawn whole, every other card faint", async () => {
    await renderDrawn();

    for (const id of [TABLE, STAGING, SOURCE, MART, REPORT]) {
      expect(cardBox(`table:${id}`)).not.toHaveAttribute("data-dimmed");
      expect(cardBox(`table:${id}`).style.opacity).toBe("");
    }

    for (const id of [OTHER, SIDE]) {
      expect(cardBox(`table:${id}`)).toHaveAttribute("data-dimmed", "true");
      expect(cardBox(`table:${id}`).style.opacity).toBe(
        String(LINEAGE_DIMMED_OPACITY),
      );
      expect(card(`table:${id}`)).not.toHaveTextContent("Cause");
      expect(card(`table:${id}`)).not.toHaveTextContent("Consequence");
    }
  });

  test("the arrows along the ways are indigo, wide, over a halo, and above the rest", async () => {
    await renderDrawn();

    for (const id of [
      feeds(SOURCE, STAGING),
      feeds(STAGING, TABLE),
      feeds(TABLE, MART),
    ]) {
      const edge: FlowEdge = flowEdge(id);

      expect(edge.style?.stroke).toBe(LINEAGE_HIGHLIGHT_COLOR);
      expect(edge.style?.strokeWidth).toBe(LINEAGE_HIGHLIGHT_WIDTH);
      expect(edge.style?.opacity).toBeUndefined();
      expect(edge.zIndex).toBe(1);
      expect(edge.markerEnd).toMatchObject({ color: LINEAGE_HIGHLIGHT_COLOR });
      expect(
        within(screen.getByTestId(`flow-edge-${id}`)).getByTestId(
          "lineage-edge-halo",
        ),
      ).toBeInTheDocument();
    }
  });

  test("every other arrow is faint, with no halo", async () => {
    await renderDrawn();

    for (const id of [feeds(OTHER, TABLE), feeds(TABLE, SIDE)]) {
      const edge: FlowEdge = flowEdge(id);

      expect(edge.style?.opacity).toBe(LINEAGE_DIMMED_OPACITY);
      expect(edge.style?.stroke).not.toBe(LINEAGE_HIGHLIGHT_COLOR);
      expect(edge.zIndex).toBeUndefined();
      expect(
        within(screen.getByTestId(`flow-edge-${id}`)).queryByTestId(
          "lineage-edge-halo",
        ),
      ).not.toBeInTheDocument();
    }
  });

  test("a pipeline an alert is about, drawn on the arrows it moves data along, is named there in indigo", async () => {
    await renderDrawn();

    const id: string = feeds(TABLE, REPORT);

    expect(flowEdge(id).data).toEqual({
      label: "orders_mart",
      title: "orders_mart",
      isLabelHighlighted: true,
      isHighlighted: true,
    });

    const label: HTMLElement = within(
      screen.getByTestId(`flow-edge-${id}`),
    ).getByTestId("lineage-edge-label");

    expect(label).toHaveTextContent("orders_mart");
    expect(label.style.color).toBe("rgb(99, 102, 241)");
  });

  test("a failed run on a way stays red, and says it failed", async () => {
    const lineage: DataTableLineage = aLineage();
    lineage.edges[1] = arrow(
      DataLineageEdgeKind.Feeds,
      `table:${STAGING}`,
      `table:${TABLE}`,
      {
        pipelines: [
          { dataPipelineId: ETL, name: "orders_etl", lastRunState: "FAIL" },
        ],
      },
    );
    await renderDrawn(anAnswer({ lineage }));

    const edge: FlowEdge = flowEdge(feeds(STAGING, TABLE));

    expect(edge.style?.stroke).toBe(LINEAGE_PROBLEM_COLOR);
    expect(edge.style?.strokeWidth).toBe(LINEAGE_HIGHLIGHT_WIDTH);
    expect(edge.data).toEqual({
      label: "orders_etl",
      title: "orders_etl failed",
      isHighlighted: true,
    });
  });

  test("the legend says what the indigo way is", async () => {
    await renderDrawn();

    expect(screen.getByTestId("lineage-legend")).toHaveTextContent(
      "Way to the cause and the alerts it caused",
    );
  });

  test("a drawing with no way picked out draws nothing faint, and its legend says nothing of ways", async () => {
    await renderDrawn(
      anAnswer({
        lineage: aLineage({ highlight: undefined }),
        hasCause: false,
        isCauseDrawn: false,
        consequenceCount: 0,
        drawnConsequenceCount: 0,
      }),
    );

    expect(document.querySelector("[data-dimmed]")).toBeNull();
    expect(screen.queryByTestId("lineage-edge-halo")).not.toBeInTheDocument();
    expect(screen.getByTestId("lineage-legend")).not.toHaveTextContent(
      "Way to the cause",
    );
    expect(
      screen.queryByTestId("lineage-highlight-notes"),
    ).not.toBeInTheDocument();
  });
});

describe("what is said, and where it leads", () => {
  test("says in words what is picked out", async () => {
    await renderDrawn();

    const notes: HTMLElement = screen.getByTestId("lineage-highlight-notes");

    expect(notes).toHaveTextContent(
      "The way up to the alert that caused this one is highlighted.",
    );
    expect(notes).toHaveTextContent(
      "The ways down to 2 of the 3 alerts this one caused are highlighted. The rest are further down than the diagram reaches.",
    );
  });

  test("the alert's own table opens its Lineage tab, to walk on from it", async () => {
    await renderDrawn();

    const link: HTMLElement = within(card(`table:${TABLE}`)).getByTestId(
      "lineage-card",
    );

    expect(link.getAttribute("href")).toContain(
      `/data-observability/tables/${TABLE}/lineage`,
    );
  });

  test("Explore Lineage opens the table's Lineage tab", async () => {
    await renderDrawn();

    const button: HTMLElement = screen.getByTestId("card-button");

    expect(button).toHaveTextContent("Explore Lineage");

    fireEvent.click(button);

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect((navigateSpy.mock.calls[0]![0] as Route).toString()).toContain(
      `/data-observability/tables/${TABLE}/lineage`,
    );
  });

  test("an alert on a pipeline: drawn around the pipeline, and Explore Lineage opens its page", async () => {
    const lineage: DataTableLineage = {
      focusNodeId: `pipeline:${ETL}`,
      depth: 2,
      nodes: [
        {
          id: `pipeline:${ETL}`,
          kind: DataLineageNodeKind.Pipeline,
          side: DataLineageSide.Focus,
          depth: 0,
          name: "orders_etl",
          dataPipelineId: ETL,
          jobNamespace: "airflow",
          lastRunState: "FAIL",
          lastRunStartedAt: null,
          lastErrorMessage: null,
          hiddenUpstreamCount: 0,
          hiddenDownstreamCount: 0,
        },
        table(STAGING, DataLineageSide.Upstream, -1),
        table(MART, DataLineageSide.Downstream, 1),
        table(REPORT, DataLineageSide.Downstream, 2),
      ],
      edges: [
        arrow(DataLineageEdgeKind.Reads, `table:${STAGING}`, `pipeline:${ETL}`),
        arrow(DataLineageEdgeKind.Writes, `pipeline:${ETL}`, `table:${MART}`, {
          pipelines: [
            { dataPipelineId: ETL, name: "orders_etl", lastRunState: "FAIL" },
          ],
        }),
        arrow(DataLineageEdgeKind.Feeds, `table:${MART}`, `table:${REPORT}`),
      ],
      hiddenDashboardCount: 0,
      isTruncated: false,
      highlight: {
        nodeIds: [`pipeline:${ETL}`, `table:${MART}`, `table:${REPORT}`],
        edgeIds: [
          getLineageEdgeId({
            kind: DataLineageEdgeKind.Writes,
            source: `pipeline:${ETL}`,
            target: `table:${MART}`,
          }),
          feeds(MART, REPORT),
        ].sort(),
        causeNodeIds: [],
        consequenceNodeIds: [`table:${MART}`, `table:${REPORT}`],
        dataPipelineIds: [],
      },
    };

    await renderDrawn(
      anAnswer({
        lineage,
        hasCause: false,
        isCauseDrawn: false,
        consequenceCount: 2,
        drawnConsequenceCount: 2,
      }),
    );

    expect(card(`pipeline:${ETL}`)).toHaveTextContent("This alert");
    expect(
      within(card(`pipeline:${ETL}`))
        .getByTestId("lineage-card")
        .getAttribute("href"),
    ).toContain(`/data-observability/pipelines/${ETL}`);
    expect(screen.getByTestId("lineage-summary")).toHaveTextContent(
      "Reads 1 table",
    );
    expect(screen.getByTestId("lineage-highlight-notes")).toHaveTextContent(
      "The ways down to the 2 alerts this one caused are highlighted.",
    );

    fireEvent.click(screen.getByTestId("card-button"));

    expect((navigateSpy.mock.calls[0]![0] as Route).toString()).toContain(
      `/data-observability/pipelines/${ETL}`,
    );
  });
});

describe("the sentences under the card's header", () => {
  test("nothing caused it and it caused nothing: nothing to say", () => {
    expect(
      getAlertLineageSentences(
        ENGLISH,
        anAnswer({
          hasCause: false,
          isCauseDrawn: false,
          consequenceCount: 0,
          drawnConsequenceCount: 0,
        }),
      ),
    ).toEqual([]);
  });

  test("a cause the drawing reaches, or one it does not and why", () => {
    expect(
      getAlertLineageSentences(
        ENGLISH,
        anAnswer({ consequenceCount: 0, drawnConsequenceCount: 0 }),
      ),
    ).toEqual(["The way up to the alert that caused this one is highlighted."]);
    expect(
      getAlertLineageSentences(
        ENGLISH,
        anAnswer({
          isCauseDrawn: false,
          consequenceCount: 0,
          drawnConsequenceCount: 0,
        }),
      ),
    ).toEqual([
      "The alert that caused this one is not on this diagram: it is about a whole database, or further up than the diagram reaches.",
    ]);
  });

  test.each([
    [1, 1, "The way down to the alert this one caused is highlighted."],
    [4, 4, "The ways down to the 4 alerts this one caused are highlighted."],
    [
      4,
      1,
      "The ways down to 1 of the 4 alerts this one caused are highlighted. The rest are further down than the diagram reaches.",
    ],
    [
      1,
      0,
      "The alert this one caused is further down than the diagram reaches.",
    ],
    [
      1200,
      0,
      "The 1,200 alerts this one caused are further down than the diagram reaches.",
    ],
    // More drawn than there are is all of them.
    [2, 5, "The ways down to the 2 alerts this one caused are highlighted."],
  ])(
    "%p alerts it caused, %p drawn: %p",
    (count: number, drawn: number, sentence: string) => {
      expect(
        getAlertLineageSentences(
          ENGLISH,
          anAnswer({
            hasCause: false,
            isCauseDrawn: false,
            consequenceCount: count,
            drawnConsequenceCount: drawn,
          }),
        ),
      ).toEqual([sentence]);
    },
  );

  test("the cause first, then what it caused", () => {
    expect(getAlertLineageSentences(ENGLISH, anAnswer())).toHaveLength(2);
    expect(getAlertLineageSentences(ENGLISH, anAnswer())[0]).toContain(
      "caused this one",
    );
  });
});
