import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
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
 * THE CHIPS UNDER A LINEAGE CARD'S NAME (#6851).
 *
 * A card shows at most two chips in one row under its name: what the card
 * is to the drawing (This alert, This table), its part in an alert's ways
 * (Cause, Consequence), then its open alerts, or that it was dropped, then
 * how fresh it is - or a pipeline's last run. The card is as wide as the
 * layout places it, so two chips can be wider than it: "Deze waarschuwing"
 * and "1 open waarschuwing" are. The first chip keeps its width; the second
 * gives way, its words ending in "..." - whole under the pointer and in the
 * card's name read aloud - rather than being cut off at the card's edge in
 * the middle of a word.
 *
 * And on an alert's own card the one open alert its table counts is, while
 * the alert is open, the alert itself, which This alert says already: the
 * card leaves that count out, so the chip after This alert says how fresh
 * the table is. The alert's lineage says whether it was open when it was
 * read (DataAlertLineageAnswer.isAlertOpen); a count of more than one, a
 * resolved alert's card, and a drawing that does not say, show the count.
 *
 * The API is mocked; React Flow is the stand-in of LineageFlowStandIn,
 * which draws each card with the component's own card.
 */

const getTableLineageMock: MockFunction = getJestMockFunction();
const getPipelineLineageMock: MockFunction = getJestMockFunction();
const getAlertLineageMock: MockFunction = getJestMockFunction();

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
import { LineagePlace } from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageGraphModel";
import {
  LINEAGE_FIRST_CHIP_CLASS_NAME,
  LINEAGE_SECOND_CHIP_CLASS_NAME,
  getLineageCardOpenAlerts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageGraph";
import { resetFlowStandIn } from "./LineageFlowStandIn";

const ALERT: string = "55555555-5555-4555-8555-000000000001";
const LEDGER: string = "22222222-2222-4222-8222-000000000001";
const CALLBACKS: string = "22222222-2222-4222-8222-000000000002";
const MART: string = "22222222-2222-4222-8222-000000000003";
const OLD: string = "22222222-2222-4222-8222-000000000004";
const ETL: string = "33333333-3333-4333-8333-000000000001";
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

function feeds(source: string, target: string): DataTableLineageEdge {
  return {
    id: getLineageEdgeId({
      kind: DataLineageEdgeKind.Feeds,
      source: `table:${source}`,
      target: `table:${target}`,
    }),
    source: `table:${source}`,
    target: `table:${target}`,
    kind: DataLineageEdgeKind.Feeds,
    seenIn: [DataAssetLineageSource.Pipeline],
    pipelines: [],
    lastSeenAt: null,
  };
}

/*
 * The Event Overview's data alert: payments.ledger_entries, the alert's
 * table, with an open alert, built from payments.provider_callbacks, which
 * has one too; ledger_entries builds mart.revenue (late, one open alert)
 * and the dropped legacy.ledger. Both alerts' tables are fresh.
 */
function aLineage(
  ownOpenAlerts: number = 1,
  fields: Partial<DataTableLineage> = {},
): DataTableLineage {
  return {
    focusNodeId: `table:${LEDGER}`,
    depth: 3,
    nodes: [
      table(LEDGER, DataLineageSide.Focus, 0, {
        name: "payments.ledger_entries",
        openAlertCount: ownOpenAlerts,
      }),
      table(CALLBACKS, DataLineageSide.Upstream, -1, {
        name: "payments.provider_callbacks",
        openAlertCount: 1,
      }),
      table(MART, DataLineageSide.Downstream, 1, {
        name: "mart.revenue",
        freshness: DataAssetFreshness.Late,
        lateBySeconds: 2 * 3600,
        openAlertCount: 1,
      }),
      table(OLD, DataLineageSide.Downstream, 1, {
        name: "legacy.ledger",
        isDropped: true,
        openAlertCount: 3,
      }),
    ],
    edges: [feeds(CALLBACKS, LEDGER), feeds(LEDGER, MART), feeds(LEDGER, OLD)],
    hiddenDashboardCount: 0,
    isTruncated: false,
    ...fields,
  };
}

function anAnswer(
  fields: Partial<DataAlertLineageAnswer> = {},
  ownOpenAlerts: number = 1,
): DataAlertLineageAnswer {
  return {
    lineage: aLineage(ownOpenAlerts),
    hasCause: false,
    isCauseDrawn: false,
    consequenceCount: 0,
    drawnConsequenceCount: 0,
    column: null,
    ...fields,
  };
}

// The chips' row on a card, and what each chip in it says, in order.
function chipRow(nodeId: string): HTMLElement {
  return within(screen.getByTestId(`flow-node-${nodeId}`)).getByTestId(
    "lineage-card-chips",
  );
}

function chipWrappers(nodeId: string): Array<HTMLElement> {
  return Array.from(chipRow(nodeId).children) as Array<HTMLElement>;
}

function chips(nodeId: string): Array<string> {
  return chipWrappers(nodeId).map((wrapper: HTMLElement): string => {
    return wrapper.textContent || "";
  });
}

async function renderAlert(answer: DataAlertLineageAnswer): Promise<void> {
  getAlertLineageMock.mockResolvedValue(answer);
  render(<AlertLineageDiagram alertId={new ObjectID(ALERT)} />);
  await screen.findByTestId("mock-react-flow");
}

beforeEach(() => {
  getTableLineageMock.mockReset();
  getPipelineLineageMock.mockReset();
  getAlertLineageMock.mockReset();
  resetFlowStandIn();
});

afterEach(() => {
  cleanup();
});

describe("how many open alerts a card's chip counts", () => {
  const own: DataTableLineageNode = table(LEDGER, DataLineageSide.Focus, 0, {
    openAlertCount: 1,
  });

  test("on an alert's own card, while the alert is open, one open alert is the alert itself: none is counted", () => {
    expect(
      getLineageCardOpenAlerts({
        node: own,
        isFocus: true,
        place: LineagePlace.Alert,
        isAlertOpen: true,
      }),
    ).toBe(0);
  });

  test("a resolved alert's card, or one whose drawing does not say, counts the open alert: it is another", () => {
    expect(
      getLineageCardOpenAlerts({
        node: own,
        isFocus: true,
        place: LineagePlace.Alert,
        isAlertOpen: false,
      }),
    ).toBe(1);
    expect(
      getLineageCardOpenAlerts({
        node: own,
        isFocus: true,
        place: LineagePlace.Alert,
      }),
    ).toBe(1);
  });

  test("more than one open alert is counted whole, the alert itself among them", () => {
    expect(
      getLineageCardOpenAlerts({
        node: { ...own, openAlertCount: 2 },
        isFocus: true,
        place: LineagePlace.Alert,
        isAlertOpen: true,
      }),
    ).toBe(2);
  });

  test("any other card counts its open alerts: one beside the alert's own, and a table's or a pipeline's own card", () => {
    expect(
      getLineageCardOpenAlerts({
        node: own,
        isFocus: false,
        place: LineagePlace.Alert,
        isAlertOpen: true,
      }),
    ).toBe(1);
    expect(
      getLineageCardOpenAlerts({
        node: own,
        isFocus: true,
        place: LineagePlace.Table,
        isAlertOpen: true,
      }),
    ).toBe(1);
    expect(
      getLineageCardOpenAlerts({
        node: own,
        isFocus: true,
        place: LineagePlace.Pipeline,
        isAlertOpen: true,
      }),
    ).toBe(1);
  });

  test("a count that is not there, or below none, is none", () => {
    expect(
      getLineageCardOpenAlerts({
        node: { ...own, openAlertCount: undefined },
        isFocus: false,
        place: LineagePlace.Table,
      }),
    ).toBe(0);
    expect(
      getLineageCardOpenAlerts({
        node: { ...own, openAlertCount: -2 },
        isFocus: false,
        place: LineagePlace.Table,
      }),
    ).toBe(0);
  });
});

describe("an alert's own card", () => {
  test("while the alert is open: This alert, then how fresh its table is - not the one open alert that is the alert itself", async () => {
    await renderAlert(anAnswer({ isAlertOpen: true }));

    expect(chips(`table:${LEDGER}`)).toEqual(["This alert", "Fresh"]);
    // Its top edge still says a problem: the alert is open on it.
    expect(
      within(screen.getByTestId(`flow-node-table:${LEDGER}`)).queryByText(
        "1 open alert",
      ),
    ).not.toBeInTheDocument();
  });

  test("the card beside it still counts its own open alert", async () => {
    await renderAlert(anAnswer({ isAlertOpen: true }));

    expect(chips(`table:${CALLBACKS}`)).toEqual(["1 open alert", "Fresh"]);
    expect(chips(`table:${MART}`)).toEqual(["1 open alert", "Late by 2 hours"]);
    // A dropped table says so, whatever it counted.
    expect(chips(`table:${OLD}`)).toEqual(["Dropped"]);
  });

  test("a resolved alert's card counts the one open alert: it is another alert", async () => {
    await renderAlert(anAnswer({ isAlertOpen: false }));

    expect(chips(`table:${LEDGER}`)).toEqual(["This alert", "1 open alert"]);
  });

  test("a drawing that does not say whether the alert is open shows the count as it is", async () => {
    await renderAlert(anAnswer());

    expect(chips(`table:${LEDGER}`)).toEqual(["This alert", "1 open alert"]);
  });

  test("more than one open alert is counted, the alert itself among them", async () => {
    await renderAlert(anAnswer({ isAlertOpen: true }, 2));

    expect(chips(`table:${LEDGER}`)).toEqual(["This alert", "2 open alerts"]);
  });

  test("on a table's own Lineage tab, its one open alert is counted: no alert is this page's", async () => {
    getTableLineageMock.mockResolvedValue(aLineage(1));
    render(<TableLineageDiagram dataAssetId={new ObjectID(LEDGER)} />);
    await screen.findByTestId("mock-react-flow");

    expect(chips(`table:${LEDGER}`)).toEqual(["This table", "1 open alert"]);
  });
});

describe("two chips wider than the card", () => {
  test("the row never wraps and clips nothing outside the card; the first chip keeps its width, the second gives way", async () => {
    await renderAlert(anAnswer());

    const row: HTMLElement = chipRow(`table:${LEDGER}`);
    const [first, second] = chipWrappers(`table:${LEDGER}`);

    expect(row).toHaveClass(
      "flex",
      "flex-nowrap",
      "items-center",
      "gap-1",
      "overflow-hidden",
    );
    expect(LINEAGE_FIRST_CHIP_CLASS_NAME.split(" ")).toEqual([
      "flex",
      "max-w-full",
      "shrink-0",
    ]);
    expect(LINEAGE_SECOND_CHIP_CLASS_NAME.split(" ")).toEqual([
      "flex",
      "min-w-0",
    ]);
    expect(first!.className).toBe(LINEAGE_FIRST_CHIP_CLASS_NAME);
    expect(second!.className).toBe(LINEAGE_SECOND_CHIP_CLASS_NAME);
    // The second chip's pill: no wider than what it is given, its words cut with "...".
    expect(within(second!).getByTestId("pill")).toHaveClass("max-w-full");
    expect(within(second!).getByTestId("pill-text")).toHaveClass(
      "min-w-0",
      "truncate",
    );
  });

  test("every card's chips are wrapped so, at most two of them, each named for what it says", async () => {
    await renderAlert(anAnswer({ isAlertOpen: true }));

    for (const id of [LEDGER, CALLBACKS, MART, OLD]) {
      const wrappers: Array<HTMLElement> = chipWrappers(`table:${id}`);

      expect(wrappers.length).toBeGreaterThan(0);
      expect(wrappers.length).toBeLessThanOrEqual(2);
      wrappers.forEach((wrapper: HTMLElement, index: number): void => {
        expect(wrapper.className).toBe(
          index === 0
            ? LINEAGE_FIRST_CHIP_CLASS_NAME
            : LINEAGE_SECOND_CHIP_CLASS_NAME,
        );
      });
    }

    expect(
      chipWrappers(`table:${LEDGER}`).map((wrapper: HTMLElement) => {
        return wrapper.getAttribute("data-lineage-chip");
      }),
    ).toEqual(["focus", "fresh"]);
    expect(
      chipWrappers(`table:${MART}`).map((wrapper: HTMLElement) => {
        return wrapper.getAttribute("data-lineage-chip");
      }),
    ).toEqual(["alerts", "late"]);
  });

  test("a chip cut short says all of itself under the pointer, and all of it is in the card's name", async () => {
    await renderAlert(anAnswer());

    const second: HTMLElement = chipWrappers(`table:${LEDGER}`)[1]!;
    const words: HTMLElement = within(second).getByTestId("pill-text");

    // The browser cut its words to fit: wider than the room it shows them in.
    Object.defineProperty(words, "scrollWidth", {
      configurable: true,
      value: 140,
    });
    Object.defineProperty(words, "clientWidth", {
      configurable: true,
      value: 52,
    });
    fireEvent.mouseEnter(words);

    expect(words).toHaveAttribute("title", "1 open alert");
    // Cut only on screen: its words are whole in the page, which the card's link is named from.
    expect(words).toHaveTextContent("1 open alert");

    const link: HTMLElement = within(
      screen.getByTestId(`flow-node-table:${LEDGER}`),
    ).getByTestId("lineage-card");

    expect(link.tagName).toBe("A");
    expect(link).toHaveTextContent("This alert");
    expect(link).toHaveTextContent("1 open alert");
  });

  test("a chip that fits says nothing more under the pointer", async () => {
    await renderAlert(anAnswer());

    const words: HTMLElement = within(
      chipWrappers(`table:${LEDGER}`)[0]!,
    ).getByTestId("pill-text");

    Object.defineProperty(words, "scrollWidth", {
      configurable: true,
      value: 52,
    });
    Object.defineProperty(words, "clientWidth", {
      configurable: true,
      value: 52,
    });
    fireEvent.mouseEnter(words);

    expect(words).not.toHaveAttribute("title");
  });

  test("a pipeline's card: This pipeline, then its last run, each wrapped as any chip is", async () => {
    getPipelineLineageMock.mockResolvedValue({
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
          lastErrorMessage: null,
          hiddenUpstreamCount: 0,
          hiddenDownstreamCount: 0,
        },
        table(LEDGER, DataLineageSide.Downstream, 1),
      ],
      edges: [
        {
          id: getLineageEdgeId({
            kind: DataLineageEdgeKind.Writes,
            source: ETL_NODE,
            target: `table:${LEDGER}`,
          }),
          source: ETL_NODE,
          target: `table:${LEDGER}`,
          kind: DataLineageEdgeKind.Writes,
          seenIn: [DataAssetLineageSource.Pipeline],
          pipelines: [],
          lastSeenAt: null,
        },
      ],
      hiddenDashboardCount: 0,
      isTruncated: false,
    } as DataTableLineage);
    render(<PipelineLineageDiagram dataPipelineId={new ObjectID(ETL)} />);
    await screen.findByTestId("mock-react-flow");

    const wrappers: Array<HTMLElement> = chipWrappers(ETL_NODE);

    expect(chips(ETL_NODE)).toEqual(["This pipeline", "Failed"]);
    expect(wrappers[0]!.className).toBe(LINEAGE_FIRST_CHIP_CLASS_NAME);
    expect(wrappers[1]!.className).toBe(LINEAGE_SECOND_CHIP_CLASS_NAME);
    expect(wrappers[1]!.getAttribute("data-lineage-chip")).toBe("run");
    // The run's pill sits straight in its wrapper, which gives it the room.
    expect(wrappers[1]!.firstElementChild).toBe(
      within(wrappers[1]!).getByTestId("pill"),
    );
  });
});
