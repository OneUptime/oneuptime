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
const expandLineageMock: MockFunction = getJestMockFunction();

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
import {
  DataLineageExpandRequest,
  DataLineageExpansion,
  readDataLineageExpandRequest,
} from "../../../Types/DataObservability/DataLineageExpansion";
import Navigation from "../../../UI/Utils/Navigation";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import AlertLineageDiagram, {
  AlertLineageNote,
  getAlertLineageNotes,
  getAlertLineageSentences,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/AlertLineageDiagram";
import {
  LINEAGE_CARD_WIDTH,
  LINEAGE_DIMMED_OPACITY,
  LINEAGE_FIT_PADDING,
  LINEAGE_HIGHLIGHT_COLOR,
  LINEAGE_HIGHLIGHT_WIDTH,
  LINEAGE_PROBLEM_COLOR,
  LINEAGE_READABLE_ZOOM,
  LineageBox,
  LineageLayout,
  LineagePoint,
  getLineageArrowLabelBox,
  getLineageCardsInView,
  getLineageHighlightSets,
  getLineageViewport,
  layoutLineage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageGraphModel";
import { LINEAGE_CARD_Z_INDEX } from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageGraph";

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
      causeDataPipelineIds: [],
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
    column: null,
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
  expandLineageMock.mockReset();
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

  test("every card is drawn over every arrow, those along the ways too: an arrowhead never covers a card's count", async () => {
    await renderDrawn();

    const arrowHeights: Array<number> = (mockFlowProps?.edges || []).map(
      (edge: FlowEdge): number => {
        return edge.zIndex || 0;
      },
    );

    expect(Math.max(...arrowHeights)).toBe(1);

    for (const node of mockFlowProps?.nodes || []) {
      expect({ id: node.id, zIndex: node.zIndex }).toEqual({
        id: node.id,
        zIndex: LINEAGE_CARD_Z_INDEX,
      });
    }

    expect(LINEAGE_CARD_Z_INDEX).toBeGreaterThan(Math.max(...arrowHeights));
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

    // Not the cause's: it says no more than its name.
    expect(screen.queryByTestId("lineage-edge-cause")).not.toBeInTheDocument();

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
    // Indigo words in a class the dark page lightens: an inline colour would stay dim there.
    expect(label).toHaveClass("text-indigo-600");
    expect(label.style.color).toBe("");
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

  test("a cause on a pipeline says Cause under its name on the arrow the way up ends on; a pipeline an alert it caused is on does not", async () => {
    const lineage: DataTableLineage = aLineage();
    lineage.edges[0] = arrow(
      DataLineageEdgeKind.Feeds,
      `table:${SOURCE}`,
      `table:${STAGING}`,
      {
        pipelines: [
          { dataPipelineId: ETL, name: "orders_etl", lastRunState: "COMPLETE" },
        ],
      },
    );
    lineage.highlight = {
      ...lineage.highlight!,
      causeNodeIds: [],
      dataPipelineIds: [ETL, MART_ETL].sort(),
      causeDataPipelineIds: [ETL],
    };
    await renderDrawn(anAnswer({ lineage }));

    expect(flowEdge(feeds(SOURCE, STAGING)).data).toEqual({
      label: "orders_etl",
      title: "orders_etl",
      isLabelHighlighted: true,
      isCause: true,
      isHighlighted: true,
    });

    const cause: HTMLElement = within(
      screen.getByTestId(`flow-edge-${feeds(SOURCE, STAGING)}`),
    ).getByTestId("lineage-edge-label");

    expect(within(cause).getByTestId("lineage-edge-name")).toHaveTextContent(
      "orders_etl",
    );
    expect(within(cause).getByTestId("lineage-edge-cause")).toHaveTextContent(
      "Cause",
    );
    // The consequence's pipeline is named on its arrow, and says nothing more.
    expect(flowEdge(feeds(TABLE, REPORT)).data).toEqual({
      label: "orders_mart",
      title: "orders_mart",
      isLabelHighlighted: true,
      isHighlighted: true,
    });
    expect(screen.getAllByTestId("lineage-edge-cause")).toHaveLength(1);
    // No card is named the cause: the cause is the pipeline.
    expect(document.querySelector('[data-role="Cause"]')).toBeNull();
  });

  test("the legend is the diagram's own: the sentences above it say what the indigo ways are", async () => {
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

    expect(legend).not.toHaveTextContent("cause");
    // No line drawn over a halo: that is the ways' mark, and the sentences carry it.
    expect(legend.querySelector("line[stroke-opacity]")).toBeNull();
  });

  test("a drawing with no way picked out draws nothing faint, marks nothing and says nothing of ways", async () => {
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
    expect(
      screen.queryByTestId("lineage-highlight-notes"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("lineage-highlight-mark"),
    ).not.toBeInTheDocument();
  });
});

describe("the sentences' marks", () => {
  // The sentences, each a line: its mark (or the mark's room), then its words.
  function noteLines(): Array<HTMLElement> {
    return Array.from(
      screen.getByTestId("lineage-highlight-notes").children,
    ) as Array<HTMLElement>;
  }

  test("each sentence saying a way is highlighted starts with the way's own mark: indigo, as wide as the way, over its halo", async () => {
    await renderDrawn();

    const lines: Array<HTMLElement> = noteLines();

    expect(lines).toHaveLength(2);

    for (const line of lines) {
      const mark: HTMLElement = within(line).getByTestId(
        "lineage-highlight-mark",
      );

      // Before the words, so it is read as what the sentence is about.
      expect(line.firstElementChild).toBe(mark);
      expect(mark.querySelector("svg")).toHaveAttribute("aria-hidden", "true");

      const strokes: Array<Element> = Array.from(mark.querySelectorAll("line"));

      expect(strokes).toHaveLength(2);
      // The halo under the line, as the drawing's ways have.
      expect(strokes[0]).toHaveAttribute("stroke", LINEAGE_HIGHLIGHT_COLOR);
      expect(strokes[0]).toHaveAttribute("stroke-opacity");
      expect(strokes[1]).toHaveAttribute("stroke", LINEAGE_HIGHLIGHT_COLOR);
      expect(strokes[1]).toHaveAttribute(
        "stroke-width",
        String(LINEAGE_HIGHLIGHT_WIDTH),
      );
    }

    expect(lines[0]).toHaveTextContent(
      "The way up to the alert that caused this one is highlighted.",
    );
    expect(lines[1]).toHaveTextContent(
      "The ways down to 2 of the 3 alerts this one caused are highlighted.",
    );
  });

  test("a sentence about a way not drawn has no mark, but keeps the mark's room so the sentences line up", async () => {
    await renderDrawn(anAnswer({ drawnConsequenceCount: 0 }));

    const lines: Array<HTMLElement> = noteLines();

    expect(lines).toHaveLength(2);

    const mark: HTMLElement = within(lines[0]!).getByTestId(
      "lineage-highlight-mark",
    );

    expect(lines[1]).toHaveTextContent(
      "The 3 alerts this one caused are further down than the diagram reaches.",
    );
    expect(
      within(lines[1]!).queryByTestId("lineage-highlight-mark"),
    ).not.toBeInTheDocument();
    expect(lines[1]!.querySelector("svg")).toBeNull();

    // The room: as wide as the mark, empty, hidden from screen readers, before the words.
    const room: Element | null = lines[1]!.firstElementChild;

    expect(room).toHaveAttribute("aria-hidden", "true");
    expect(room).toBeEmptyDOMElement();
    expect(room).toHaveClass("w-7", "shrink-0");
    expect(mark).toHaveClass("w-7", "shrink-0");
  });

  test("no way drawn at all: the sentences stand alone, with no mark and no room", async () => {
    await renderDrawn(
      anAnswer({
        lineage: aLineage({ highlight: undefined }),
        isCauseDrawn: false,
        drawnConsequenceCount: 0,
      }),
    );

    const lines: Array<HTMLElement> = noteLines();

    expect(lines).toHaveLength(2);
    expect(
      screen.queryByTestId("lineage-highlight-mark"),
    ).not.toBeInTheDocument();

    for (const line of lines) {
      expect(line.children).toHaveLength(1);
      expect(line.querySelector("[aria-hidden]")).toBeNull();
    }
  });
});

describe("what is said, and where it leads", () => {
  test("the card says what it draws, briefly: the ways are left to the sentences under it", async () => {
    await renderDrawn();

    expect(screen.getByText("Lineage")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Where this alert's data comes from and where it goes, with how each table and pipeline is now.",
      ),
    ).toBeInTheDocument();
  });

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
        causeDataPipelineIds: [],
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

  test("the sentences are the notes' words, in the notes' order", () => {
    for (const answer of [
      anAnswer(),
      anAnswer({ isCauseDrawn: false, drawnConsequenceCount: 0 }),
      anAnswer({ hasCause: false, isCauseDrawn: false }),
    ]) {
      expect(getAlertLineageSentences(ENGLISH, answer)).toEqual(
        getAlertLineageNotes(ENGLISH, answer).map(
          (note: AlertLineageNote): string => {
            return note.text;
          },
        ),
      );
    }
  });
});

describe("which sentences say a way is highlighted", () => {
  function marked(answer: DataAlertLineageAnswer): Array<boolean> {
    return getAlertLineageNotes(ENGLISH, answer).map(
      (note: AlertLineageNote): boolean => {
        return note.isHighlighted;
      },
    );
  }

  test("a cause drawn does; a cause the drawing does not reach does not", () => {
    const nothingCaused: Partial<DataAlertLineageAnswer> = {
      consequenceCount: 0,
      drawnConsequenceCount: 0,
    };

    expect(marked(anAnswer(nothingCaused))).toEqual([true]);
    expect(marked(anAnswer({ ...nothingCaused, isCauseDrawn: false }))).toEqual(
      [false],
    );
  });

  test.each([
    [3, 3, true],
    [3, 1, true],
    [3, 0, false],
    [1, 0, false],
    // More drawn than there are is all of them.
    [2, 5, true],
  ])(
    "%p alerts it caused, %p drawn: highlighted %p",
    (count: number, drawn: number, isHighlighted: boolean) => {
      expect(
        marked(
          anAnswer({
            hasCause: false,
            isCauseDrawn: false,
            consequenceCount: count,
            drawnConsequenceCount: drawn,
          }),
        ),
      ).toEqual([isHighlighted]);
    },
  );

  test("the cause and what it caused each say so on their own", () => {
    expect(marked(anAnswer())).toEqual([true, true]);
    expect(marked(anAnswer({ drawnConsequenceCount: 0 }))).toEqual([
      true,
      false,
    ]);
    expect(marked(anAnswer({ isCauseDrawn: false }))).toEqual([false, true]);
    expect(
      marked(anAnswer({ isCauseDrawn: false, drawnConsequenceCount: 0 })),
    ).toEqual([false, false]);
  });

  test("nothing caused it and it caused nothing: no notes", () => {
    expect(
      getAlertLineageNotes(
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
});

describe("where the drawing opens", () => {
  let canvasBox: { width: number; height: number };
  let realResizeObserver: unknown;
  let realGetBoundingClientRect: () => DOMRect;

  beforeEach(() => {
    canvasBox = { width: 1000, height: 400 };
    realResizeObserver = (globalThis as any).ResizeObserver;
    (globalThis as any).ResizeObserver = class {
      public observe(): void {
        // The canvas's size is read when the drawing first shows.
      }

      public disconnect(): void {
        // Nothing was watched.
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

  // Where a point of the drawing lands on the canvas, across.
  function onCanvas(x: number): number {
    const viewport: { x: number; zoom: number } | undefined =
      mockFlowProps?.defaultViewport;

    expect(viewport).toBeDefined();

    return viewport!.x + x * viewport!.zoom;
  }

  // A canvas with room at the readable zoom for `room` of the drawing across.
  function canvasFor(room: number): number {
    return room * LINEAGE_READABLE_ZOOM * (1 + LINEAGE_FIT_PADDING);
  }

  test("too wide to read whole, it opens on the cause and the alert's own card, not centred on the alert", async () => {
    const layout: LineageLayout = layoutLineage(aLineage());
    const cause: LineagePoint = layout.positions.get(`table:${SOURCE}`)!;
    const focus: LineagePoint = layout.positions.get(`table:${TABLE}`)!;
    // Room for the cause to the alert's own card, and a little more.
    canvasBox = {
      width: canvasFor(focus.x + LINEAGE_CARD_WIDTH - cause.x + 40),
      height: 400,
    };

    await renderDrawn();

    expect(mockFlowProps?.fitView).toBe(false);
    expect(mockFlowProps?.defaultViewport?.zoom).toBe(LINEAGE_READABLE_ZOOM);
    expect(onCanvas(cause.x)).toBeGreaterThan(0);
    expect(onCanvas(focus.x + LINEAGE_CARD_WIDTH)).toBeLessThan(
      canvasBox.width,
    );

    // A table's drawing, centred on its table, would have left the cause off the canvas.
    const centred: ReturnType<typeof getLineageViewport> = getLineageViewport({
      layout,
      focusNodeId: `table:${TABLE}`,
      width: canvasBox.width,
      height: canvasBox.height,
    });

    expect(centred!.x + cause.x * centred!.zoom).toBeLessThan(0);
  });

  test("on a phone, the cause's card is the one in view", async () => {
    const layout: LineageLayout = layoutLineage(aLineage());
    const cause: LineagePoint = layout.positions.get(`table:${SOURCE}`)!;
    canvasBox = { width: 320, height: 400 };

    await renderDrawn();

    expect(onCanvas(cause.x)).toBeGreaterThanOrEqual(0);
    expect(onCanvas(cause.x + LINEAGE_CARD_WIDTH)).toBeLessThanOrEqual(320);
  });

  test("on a phone, a cause on the pipeline on an arrow: the label saying Cause is in view, whole, not cut at the canvas's edge", async () => {
    const lineage: DataTableLineage = aLineage();
    lineage.edges[0] = arrow(
      DataLineageEdgeKind.Feeds,
      `table:${SOURCE}`,
      `table:${STAGING}`,
      {
        pipelines: [
          { dataPipelineId: ETL, name: "orders_etl", lastRunState: "COMPLETE" },
        ],
      },
    );
    lineage.highlight = {
      ...lineage.highlight!,
      causeNodeIds: [],
      dataPipelineIds: [ETL, MART_ETL].sort(),
      causeDataPipelineIds: [ETL],
    };
    const layout: LineageLayout = layoutLineage(lineage);
    const label: LineageBox = getLineageArrowLabelBox(
      layout,
      lineage.edges[0]!,
    )!;
    canvasBox = { width: 320, height: 400 };

    await renderDrawn(anAnswer({ lineage }));

    expect(screen.getByTestId("lineage-edge-cause")).toHaveTextContent("Cause");
    expect(onCanvas(label.left)).toBeGreaterThanOrEqual(0);
    expect(onCanvas(label.right)).toBeLessThanOrEqual(320);

    // Opened on the alert's own card, as before, the label would have been off the canvas.
    const before: ReturnType<typeof getLineageViewport> = getLineageViewport({
      layout,
      focusNodeId: `table:${TABLE}`,
      width: 320,
      height: 400,
      inView: getLineageCardsInView(
        lineage,
        layout,
        getLineageHighlightSets(lineage),
      ),
    });

    expect(before!.x + label.right * before!.zoom).toBeLessThan(0);
  });

  test("an alert that caused others but has no cause opens on its own card", async () => {
    const lineage: DataTableLineage = aLineage();
    lineage.highlight = {
      ...lineage.highlight!,
      nodeIds: [`table:${TABLE}`, `table:${MART}`, `table:${REPORT}`],
      edgeIds: [feeds(TABLE, MART), feeds(TABLE, REPORT)].sort(),
      causeNodeIds: [],
    };
    const layout: LineageLayout = layoutLineage(lineage);
    const focus: LineagePoint = layout.positions.get(`table:${TABLE}`)!;
    canvasBox = { width: 320, height: 400 };

    await renderDrawn(
      anAnswer({ lineage, hasCause: false, isCauseDrawn: false }),
    );

    expect(onCanvas(focus.x)).toBeGreaterThanOrEqual(0);
    expect(onCanvas(focus.x + LINEAGE_CARD_WIDTH)).toBeLessThanOrEqual(320);
  });
});

/*
 * The alert's drawing is the shared diagram, so a card's count draws its
 * next tables here as on a table's Lineage tab (LineageDrawMore.test.tsx):
 * what is drawn now is off the alert's ways, so it is faint, and the ways
 * stay picked out. The alert's drawing is read without its columns, so
 * there is no column to follow and none is asked for.
 */
describe("drawing more on an alert's drawing", () => {
  const ARCHIVE: string = "22222222-2222-4222-8222-000000000008";

  // legacy.orders, off the ways upstream, does not draw two tables built into it.
  function withTwoMoreUpstream(): DataAlertLineageAnswer {
    const lineage: DataTableLineage = aLineage();

    lineage.nodes = lineage.nodes.map(
      (node: DataTableLineageNode): DataTableLineageNode => {
        return node.id === `table:${OTHER}`
          ? { ...node, hiddenUpstreamCount: 2 }
          : node;
      },
    );

    return anAnswer({ lineage });
  }

  function archiveExpansion(): DataLineageExpansion {
    return {
      nodeId: `table:${OTHER}`,
      side: DataLineageSide.Upstream,
      hiddenCount: 1,
      nodes: [
        table(ARCHIVE, DataLineageSide.Upstream, -2, {
          name: "legacy.archive",
        }),
      ],
      edges: [
        arrow(DataLineageEdgeKind.Feeds, `table:${ARCHIVE}`, `table:${OTHER}`),
      ],
      hiddenDashboardCount: null,
      isTruncated: false,
    };
  }

  function legacyCount(): HTMLElement {
    return within(card(`table:${OTHER}`)).getByTestId("lineage-hidden-left");
  }

  test("a card's count asks for its next tables, naming every table drawn, without columns", async () => {
    expandLineageMock.mockResolvedValue(archiveExpansion());
    await renderDrawn(withTwoMoreUpstream());

    expect(legacyCount().tagName).toBe("BUTTON");
    expect(legacyCount()).toHaveAccessibleName("Draw 2 more tables upstream");

    await act(async () => {
      fireEvent.click(legacyCount());
    });

    expect(expandLineageMock).toHaveBeenCalledTimes(1);

    const request: DataLineageExpandRequest = expandLineageMock.mock
      .calls[0]![0] as DataLineageExpandRequest;

    expect(request).toEqual({
      focusNodeId: `table:${TABLE}`,
      nodeId: `table:${OTHER}`,
      side: DataLineageSide.Upstream,
      tables: [
        { dataAssetId: TABLE, side: DataLineageSide.Focus, depth: 0 },
        { dataAssetId: STAGING, side: DataLineageSide.Upstream, depth: -1 },
        { dataAssetId: SOURCE, side: DataLineageSide.Upstream, depth: -2 },
        { dataAssetId: OTHER, side: DataLineageSide.Upstream, depth: -1 },
        { dataAssetId: MART, side: DataLineageSide.Downstream, depth: 1 },
        { dataAssetId: REPORT, side: DataLineageSide.Downstream, depth: 1 },
        { dataAssetId: SIDE, side: DataLineageSide.Downstream, depth: 1 },
      ],
      dataDashboardIds: [],
    });
    // One the route takes as it is sent.
    expect(
      readDataLineageExpandRequest(JSON.parse(JSON.stringify(request))),
    ).toEqual({ ...request, withColumns: false });
    // The alert's page has no column to follow.
    expect(screen.queryByTestId("lineage-column")).not.toBeInTheDocument();
  });

  test("what is drawn now is faint, off the alert's ways, which stay picked out; Reset goes back without reading again", async () => {
    expandLineageMock.mockResolvedValue(archiveExpansion());
    await renderDrawn(withTwoMoreUpstream());

    await act(async () => {
      fireEvent.click(legacyCount());
    });

    expect(card(`table:${ARCHIVE}`)).toHaveTextContent("legacy.archive");
    expect(cardBox(`table:${ARCHIVE}`)).toHaveAttribute("data-dimmed", "true");
    expect(flowEdge(feeds(ARCHIVE, OTHER)).style?.opacity).toBe(
      LINEAGE_DIMMED_OPACITY,
    );
    // The pressed card counts what it still does not draw.
    expect(legacyCount()).toHaveTextContent("+1");
    expect(legacyCount()).toHaveAccessibleName("Draw one more table upstream");

    // The ways are as they were: the cause and the alert it caused, in indigo.
    expect(cardBox(`table:${SOURCE}`)).toHaveAttribute("data-role", "Cause");
    expect(cardBox(`table:${MART}`)).toHaveAttribute(
      "data-role",
      "Consequence",
    );
    expect(flowEdge(feeds(SOURCE, STAGING)).style?.stroke).toBe(
      LINEAGE_HIGHLIGHT_COLOR,
    );
    expect(screen.getByTestId("lineage-graph")).toHaveAttribute(
      "aria-label",
      "The lineage around this alert, with the way to the alert that caused it and to the alerts it caused",
    );

    fireEvent.click(screen.getByTestId("lineage-reset"));

    expect(
      screen.queryByTestId(`flow-node-table:${ARCHIVE}`),
    ).not.toBeInTheDocument();
    expect(legacyCount()).toHaveTextContent("+2");
    expect(screen.queryByTestId("lineage-reset")).not.toBeInTheDocument();
    expect(getAlertLineageMock).toHaveBeenCalledTimes(1);
  });
});
