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
 * FOLLOWING ONE COLUMN UP AND DOWN A TABLE'S LINEAGE DIAGRAM (#6665).
 *
 * The Lineage tab reads its drawing with the columns each arrow between
 * two tables carries. When an arrow next to the table names any, Follow a
 * column offers the table's columns they name, in the table's own order;
 * picking one picks out where it comes from and where it goes - renamed on
 * the way, built from several - as an alert's ways are: each card on its
 * way names the column there in place of the line under its name, its
 * arrows are drawn wide, and everything else is faint. A sentence above
 * the drawing says what is picked out, and another when an arrow on its way
 * says nothing of its columns, so it may go further. The column stays
 * followed as the drawing grows, and into what is drawn.
 *
 * The API is mocked and React Flow is the stand-in of LineageFlowStandIn.
 */

const getTableLineageMock: MockFunction = getJestMockFunction();
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
import { DataLineageExpansion } from "../../../Types/DataObservability/DataLineageExpansion";
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
import { flowProps, resetFlowStandIn } from "./LineageFlowStandIn";

const TABLE: string = "22222222-2222-4222-8222-000000000001";
const STAGING: string = "22222222-2222-4222-8222-000000000002";
const SOURCE: string = "22222222-2222-4222-8222-000000000003";
const LEGACY: string = "22222222-2222-4222-8222-000000000004";
const MART: string = "22222222-2222-4222-8222-000000000005";
const REPORT: string = "22222222-2222-4222-8222-000000000006";
const ARCHIVE: string = "22222222-2222-4222-8222-000000000007";
const BOARD: string = "44444444-4444-4444-8444-000000000001";

// The table's own columns, as its last collection read them.
const COLUMN_ORDER: Array<string> = [
  "order_id",
  "customer_id",
  "amount",
  "created_at",
];

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

function feeds(
  source: string,
  target: string,
  columns?: Array<[string, string]>,
): DataTableLineageEdge {
  const from: string = `table:${source}`;
  const to: string = `table:${target}`;

  return {
    id: getLineageEdgeId({
      kind: DataLineageEdgeKind.Feeds,
      source: from,
      target: to,
    }),
    source: from,
    target: to,
    kind: DataLineageEdgeKind.Feeds,
    seenIn: [DataAssetLineageSource.Pipeline],
    pipelines: [],
    lastSeenAt: null,
    ...(columns
      ? {
          columnMappings: columns.map(
            ([upstreamColumn, downstreamColumn]: [string, string]) => {
              return { upstreamColumn, downstreamColumn };
            },
          ),
        }
      : {}),
  };
}

/*
 * raw.orders -> staging.orders -> analytics.orders -> mart.revenue ->
 * report.revenue -> a dashboard; legacy.orders also feeds the table, its
 * arrow naming no columns. raw.orders keeps its names in capitals; staging
 * renames customer_id cust_id and builds amount from amount_cents and
 * tax_cents; the mart renames amount revenue, and the report total_revenue.
 */
function aLineage(fields: { withLegacy?: boolean } = {}): DataTableLineage {
  const withLegacy: boolean = fields.withLegacy ?? true;

  return {
    focusNodeId: `table:${TABLE}`,
    depth: 3,
    nodes: [
      table(TABLE, DataLineageSide.Focus, 0, { name: "analytics.orders" }),
      table(STAGING, DataLineageSide.Upstream, -1, { name: "staging.orders" }),
      table(SOURCE, DataLineageSide.Upstream, -2, { name: "raw.orders" }),
      ...(withLegacy
        ? [
            table(LEGACY, DataLineageSide.Upstream, -1, {
              name: "legacy.orders",
            }),
          ]
        : []),
      table(MART, DataLineageSide.Downstream, 1, {
        name: "mart.revenue",
        hiddenDownstreamCount: 1,
      }),
      table(REPORT, DataLineageSide.Downstream, 2, { name: "report.revenue" }),
      {
        id: `dashboard:${BOARD}`,
        kind: DataLineageNodeKind.Dashboard,
        side: DataLineageSide.Downstream,
        depth: 3,
        name: "Revenue",
        dataDashboardId: BOARD,
        tool: "Metabase",
        url: "https://metabase.example.com/dashboard/7",
      },
    ],
    edges: [
      feeds(SOURCE, STAGING, [
        ["ID", "id"],
        ["CUSTOMER", "cust_id"],
      ]),
      feeds(STAGING, TABLE, [
        ["id", "order_id"],
        ["cust_id", "customer_id"],
        ["amount_cents", "amount"],
        ["tax_cents", "amount"],
      ]),
      ...(withLegacy ? [feeds(LEGACY, TABLE)] : []),
      feeds(TABLE, MART, [
        ["order_id", "order_id"],
        ["amount", "revenue"],
        ["customer_id", "customer_id"],
      ]),
      feeds(MART, REPORT, [["revenue", "total_revenue"]]),
      {
        id: getLineageEdgeId({
          kind: DataLineageEdgeKind.Reads,
          source: `table:${REPORT}`,
          target: `dashboard:${BOARD}`,
        }),
        source: `table:${REPORT}`,
        target: `dashboard:${BOARD}`,
        kind: DataLineageEdgeKind.Reads,
        seenIn: [],
        pipelines: [],
        lastSeenAt: null,
      },
    ],
    hiddenDashboardCount: 0,
    isTruncated: false,
  };
}

function card(nodeId: string): HTMLElement {
  return screen.getByTestId(`flow-node-${nodeId}`);
}

// The column a card names, or null when it is off the column's way.
function columnOn(id: string): string | null {
  return (
    within(card(`table:${id}`)).queryByTestId("lineage-card-columns")
      ?.textContent || null
  );
}

function isFaint(nodeId: string): boolean {
  return (
    card(nodeId)
      .querySelector("[data-node-id]")
      ?.getAttribute("data-dimmed") === "true"
  );
}

// The arrows drawn wide, as their ends: "source>target".
function wideArrows(): Array<string> {
  return (flowProps()?.edges || [])
    .filter((edge: { data?: { isHighlighted?: boolean } }): boolean => {
      return Boolean(edge.data?.isHighlighted);
    })
    .map((edge: { source: string; target: string }): string => {
      return `${edge.source.slice(-4)}>${edge.target.slice(-4)}`;
    })
    .sort();
}

function picker(): HTMLElement {
  return screen.getByRole("combobox", {
    name: "Column to follow",
    hidden: true,
  });
}

function offered(): Array<string> {
  fireEvent.keyDown(picker(), { key: "ArrowDown", code: "ArrowDown" });

  const labels: Array<string> = screen
    .getAllByRole("option")
    .map((option: HTMLElement): string => {
      return option.textContent || "";
    });

  fireEvent.keyDown(picker(), { key: "Escape", code: "Escape" });

  return labels;
}

function follow(column: string): void {
  fireEvent.keyDown(picker(), { key: "ArrowDown", code: "ArrowDown" });

  const option: HTMLElement = screen.getByRole("option", { name: column });

  fireEvent.mouseDown(option);
  fireEvent.click(option);
}

function stopFollowing(): void {
  const clear: HTMLElement | null = screen
    .getByTestId("lineage-column")
    .querySelector<HTMLElement>(".ou-select__clear-indicator");

  expect(clear).not.toBeNull();
  // react-select clears on a primary-button mousedown, not on click.
  fireEvent.mouseDown(clear as HTMLElement, { button: 0 });
}

function notes(): Array<string> {
  return Array.from(
    screen.getByTestId("lineage-column-notes").querySelectorAll("p"),
  ).map((note: HTMLParagraphElement): string => {
    return note.textContent || "";
  });
}

async function renderDrawn(
  lineage: DataTableLineage = aLineage(),
  columnOrder: Array<string> = COLUMN_ORDER,
): Promise<void> {
  getTableLineageMock.mockResolvedValue(lineage);
  render(
    <TableLineageDiagram
      dataAssetId={new ObjectID(TABLE)}
      columnOrder={columnOrder}
    />,
  );
  await screen.findByTestId("mock-react-flow");
}

beforeEach(() => {
  getTableLineageMock.mockReset();
  expandLineageMock.mockReset();
  resetFlowStandIn();
});

afterEach(() => {
  cleanup();
});

describe("what can be followed", () => {
  test("the table's columns its arrows name, in the table's own order, and no other", async () => {
    await renderDrawn();

    expect(screen.getByTestId("lineage-column")).toHaveTextContent(
      "Follow a column",
    );
    expect(offered()).toEqual(["order_id", "customer_id", "amount"]);
  });

  test("each as the table names it, the columns it does not list after them by name", async () => {
    await renderDrawn(aLineage(), ["AMOUNT", "Order_ID"]);

    expect(offered()).toEqual(["AMOUNT", "Order_ID", "customer_id"]);
  });

  test("no arrow next to the table names a column: nothing to pick", async () => {
    const lineage: DataTableLineage = aLineage();
    lineage.edges = lineage.edges.map(
      (edge: DataTableLineageEdge): DataTableLineageEdge => {
        const bare: DataTableLineageEdge = { ...edge };

        delete bare.columnMappings;

        return bare;
      },
    );
    await renderDrawn(lineage);

    expect(screen.queryByTestId("lineage-column")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("lineage-column-notes"),
    ).not.toBeInTheDocument();
  });

  test("nothing is picked out until a column is followed", async () => {
    await renderDrawn();

    expect(
      screen.queryByTestId("lineage-column-notes"),
    ).not.toBeInTheDocument();
    expect(wideArrows()).toEqual([]);
    expect(isFaint(`table:${SOURCE}`)).toBe(false);
    expect(columnOn(TABLE)).toBeNull();
  });
});

describe("following a column", () => {
  test("names it on each card on its way, renamed on the way and built from several", async () => {
    await renderDrawn();

    follow("amount");

    expect(columnOn(TABLE)).toBe("amount");
    // Built from two of staging's columns.
    expect(columnOn(STAGING)).toBe("amount_cents, tax_cents");
    expect(columnOn(MART)).toBe("revenue");
    expect(columnOn(REPORT)).toBe("total_revenue");
    // Nothing of raw.orders' builds amount_cents or tax_cents.
    expect(columnOn(SOURCE)).toBeNull();
    // In place of the line under the card's name.
    expect(card(`table:${MART}`)).not.toHaveTextContent("Warehouse");
    expect(card(`table:${SOURCE}`)).toHaveTextContent("Warehouse");
  });

  test("picks out its way as an alert's are: its arrows wide, everything off it faint", async () => {
    await renderDrawn();

    follow("amount");

    expect(wideArrows()).toEqual(
      [
        `${STAGING.slice(-4)}>${TABLE.slice(-4)}`,
        `${TABLE.slice(-4)}>${MART.slice(-4)}`,
        `${MART.slice(-4)}>${REPORT.slice(-4)}`,
      ].sort(),
    );

    for (const id of [TABLE, STAGING, MART, REPORT]) {
      expect({ id, isFaint: isFaint(`table:${id}`) }).toEqual({
        id,
        isFaint: false,
      });
    }

    expect(isFaint(`table:${SOURCE}`)).toBe(true);
    expect(isFaint(`table:${LEGACY}`)).toBe(true);
    expect(isFaint(`dashboard:${BOARD}`)).toBe(true);
    // No card on a column's way is named a cause or a consequence.
    expect(card(`table:${STAGING}`).querySelector("[data-role]")).toBeNull();
  });

  test("goes all the way up, whatever case each table writes the name in", async () => {
    await renderDrawn();

    follow("order_id");

    expect(columnOn(STAGING)).toBe("id");
    expect(columnOn(SOURCE)).toBe("ID");
    expect(columnOn(MART)).toBe("order_id");
    // The report is built from no order_id.
    expect(columnOn(REPORT)).toBeNull();
  });

  test("says what is picked out, after the highlight's own mark, and that an arrow naming no columns may carry it further", async () => {
    await renderDrawn();

    follow("amount");

    expect(notes()).toEqual([
      "amount is highlighted where it comes from and where it goes.",
      "Some arrows on its way do not say which columns they carry, so it may go further than is highlighted.",
    ]);
    expect(
      within(screen.getByTestId("lineage-column-notes")).getAllByTestId(
        "lineage-highlight-mark",
      ),
    ).toHaveLength(1);
  });

  test("every arrow on its way names its columns: nothing more is said", async () => {
    await renderDrawn(aLineage({ withLegacy: false }));

    follow("amount");

    expect(notes()).toEqual([
      "amount is highlighted where it comes from and where it goes.",
    ]);
  });

  test("another column picked follows that one instead", async () => {
    await renderDrawn();

    follow("amount");
    follow("customer_id");

    expect(columnOn(STAGING)).toBe("cust_id");
    expect(columnOn(SOURCE)).toBe("CUSTOMER");
    expect(columnOn(MART)).toBe("customer_id");
    expect(columnOn(REPORT)).toBeNull();
    expect(notes()[0]).toBe(
      "customer_id is highlighted where it comes from and where it goes.",
    );
  });

  test("cleared, nothing is picked out and every card says what it is again", async () => {
    await renderDrawn();

    follow("amount");
    stopFollowing();

    expect(
      screen.queryByTestId("lineage-column-notes"),
    ).not.toBeInTheDocument();
    expect(columnOn(TABLE)).toBeNull();
    expect(wideArrows()).toEqual([]);
    expect(isFaint(`table:${SOURCE}`)).toBe(false);
    expect(card(`table:${MART}`)).toHaveTextContent("Warehouse");
  });
});

describe("a followed column as the drawing grows", () => {
  // The table built from mart.revenue not drawn: report.archive, its revenue rev.
  function martExpansion(): DataLineageExpansion {
    return {
      nodeId: `table:${MART}`,
      side: DataLineageSide.Downstream,
      hiddenCount: 0,
      nodes: [table(ARCHIVE, DataLineageSide.Downstream, 2)],
      edges: [feeds(MART, ARCHIVE, [["revenue", "rev"]])],
      hiddenDashboardCount: 0,
      isTruncated: false,
    };
  }

  test("goes on into the tables drawn, and back to the drawing as read on Reset", async () => {
    expandLineageMock.mockResolvedValue(martExpansion());
    await renderDrawn();

    follow("amount");
    await act(async () => {
      fireEvent.click(
        within(card(`table:${MART}`)).getByTestId("lineage-hidden-right"),
      );
    });

    // Asked with the columns of the arrows it draws.
    expect(
      (expandLineageMock.mock.calls[0]![0] as { withColumns?: boolean })
        .withColumns,
    ).toBe(true);
    expect(columnOn(ARCHIVE)).toBe("rev");
    expect(columnOn(REPORT)).toBe("total_revenue");

    act(() => {
      fireEvent.click(screen.getByTestId("lineage-reset"));
    });

    expect(screen.queryByTestId(`flow-node-table:${ARCHIVE}`)).toBeNull();
    // Still followed, on the drawing as it was read.
    expect(columnOn(REPORT)).toBe("total_revenue");
    expect(notes()[0]).toBe(
      "amount is highlighted where it comes from and where it goes.",
    );
  });
});
