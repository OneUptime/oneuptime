import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { ReactElement, ReactNode } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A DATA ALERT FROM A CHECK ON ONE COLUMN, ON ITS PAGE (#6783), AND THE
 * CAUSE'S PIPELINE NAMED ON ITS ARROWS (#6687).
 *
 * An alert from a check on one column - a null rate on
 * analytics.orders.customer_id - is first a question of which columns
 * feed that column. Its Lineage card is read with the columns each arrow
 * carries and the column the check reads (DataAlertLineageAnswer.column),
 * and opens with that column followed beside the alert's ways: the picker
 * names it first, a sentence says it is followed, each card on its way
 * names the column there, and the cause and what it caused stay named.
 * Another column can be picked, or none. An alert from a check on the
 * whole table draws as before, with no picker.
 *
 * A cause on a pipeline drawn on the arrows it moves data along says
 * Cause under its name on the arrows the way up ends on, as a cause's card
 * does, inside the arrow label's room, in the reader's language.
 *
 * The API is mocked and React Flow is the stand-in of LineageFlowStandIn.
 */

const getAlertLineageMock: MockFunction = getJestMockFunction();
const expandLineageMock: MockFunction = getJestMockFunction();

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
  DataAlertLineageAnswer,
  DataLineageEdgeKind,
  DataLineageHighlight,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  DataTableLineagePipeline,
  getLineageEdgeId,
} from "../../../Types/DataObservability/DataTableLineage";
import AlertLineageDiagram from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/AlertLineageDiagram";
import { LineageDiagramBody } from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageDiagram";
import {
  LINEAGE_EDGE_LABEL_MAX_WIDTH,
  LINEAGE_HIGHLIGHT_COLOR,
  LINEAGE_PROBLEM_COLOR,
  LineagePlace,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageGraphModel";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { flowProps, resetFlowStandIn } from "./LineageFlowStandIn";

const ALERT: string = "55555555-5555-4555-8555-000000000001";
const OTHER_ALERT: string = "55555555-5555-4555-8555-000000000002";
const TABLE: string = "22222222-2222-4222-8222-000000000001";
const STAGING: string = "22222222-2222-4222-8222-000000000002";
const SOURCE: string = "22222222-2222-4222-8222-000000000003";
const LEGACY: string = "22222222-2222-4222-8222-000000000004";
const MART: string = "22222222-2222-4222-8222-000000000005";
const SIDE: string = "22222222-2222-4222-8222-000000000006";
const ARCHIVE: string = "22222222-2222-4222-8222-000000000007";
const LOAD: string = "33333333-3333-4333-8333-000000000001";
const OTHER_RUN: string = "33333333-3333-4333-8333-000000000002";

const FOLLOWED: string =
  "{{column}} is highlighted where it comes from and where it goes.";

// The pipeline the cause is on, in the drawings where it is a pipeline's.
const ORDERS_LOAD: DataTableLineagePipeline = {
  dataPipelineId: LOAD,
  name: "orders_load",
  lastRunState: "COMPLETE",
};

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

function edgeId(source: string, target: string): string {
  return getLineageEdgeId({
    kind: DataLineageEdgeKind.Feeds,
    source: `table:${source}`,
    target: `table:${target}`,
  });
}

function feeds(
  source: string,
  target: string,
  fields: {
    columns?: Array<[string, string]>;
    pipelines?: Array<DataTableLineagePipeline>;
  } = {},
): DataTableLineageEdge {
  return {
    id: edgeId(source, target),
    source: `table:${source}`,
    target: `table:${target}`,
    kind: DataLineageEdgeKind.Feeds,
    seenIn: [DataAssetLineageSource.Pipeline],
    pipelines: fields.pipelines || [],
    lastSeenAt: null,
    ...(fields.columns
      ? {
          columnMappings: fields.columns.map(
            ([upstreamColumn, downstreamColumn]: [string, string]) => {
              return { upstreamColumn, downstreamColumn };
            },
          ),
        }
      : {}),
  };
}

/*
 * The alert is on analytics.orders, from a check on customer_id. Its cause
 * is on raw.orders, two steps up through staging.orders; it caused an
 * alert on mart.revenue. raw.orders names the column CUSTOMER, staging
 * cust_id, legacy.orders - off the alert's ways - legacy_customer, and the
 * mart buyer_id; side.orders is built from order_id only.
 */
function aLineage(
  fields: {
    withColumns?: boolean;
    edges?: Array<DataTableLineageEdge>;
    highlight?: DataLineageHighlight;
  } = {},
): DataTableLineage {
  const withColumns: boolean = fields.withColumns ?? true;
  const columns: (
    pairs: Array<[string, string]>,
  ) => Array<[string, string]> | undefined = (
    pairs: Array<[string, string]>,
  ): Array<[string, string]> | undefined => {
    return withColumns ? pairs : undefined;
  };
  const optional: (pairs: Array<[string, string]> | undefined) => {
    columns?: Array<[string, string]>;
  } = (
    pairs: Array<[string, string]> | undefined,
  ): { columns?: Array<[string, string]> } => {
    return pairs ? { columns: pairs } : {};
  };

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
      table(LEGACY, DataLineageSide.Upstream, -1, {
        name: "legacy.orders",
        hiddenUpstreamCount: 1,
      }),
      table(MART, DataLineageSide.Downstream, 1, {
        name: "mart.revenue",
        openAlertCount: 1,
      }),
      table(SIDE, DataLineageSide.Downstream, 1, { name: "side.orders" }),
    ],
    edges: fields.edges || [
      feeds(
        SOURCE,
        STAGING,
        optional(
          columns([
            ["CUSTOMER", "cust_id"],
            ["ID", "id"],
          ]),
        ),
      ),
      feeds(
        STAGING,
        TABLE,
        optional(
          columns([
            ["cust_id", "customer_id"],
            ["id", "order_id"],
            ["amount_cents", "amount"],
          ]),
        ),
      ),
      feeds(
        LEGACY,
        TABLE,
        optional(columns([["legacy_customer", "customer_id"]])),
      ),
      feeds(
        TABLE,
        MART,
        optional(
          columns([
            ["customer_id", "buyer_id"],
            ["amount", "revenue"],
          ]),
        ),
      ),
      feeds(TABLE, SIDE, optional(columns([["order_id", "order_id"]]))),
    ],
    hiddenDashboardCount: 0,
    isTruncated: false,
    highlight: fields.highlight || {
      nodeIds: [
        `table:${TABLE}`,
        `table:${STAGING}`,
        `table:${SOURCE}`,
        `table:${MART}`,
      ],
      edgeIds: [
        edgeId(SOURCE, STAGING),
        edgeId(STAGING, TABLE),
        edgeId(TABLE, MART),
      ].sort(),
      causeNodeIds: [`table:${SOURCE}`],
      consequenceNodeIds: [`table:${MART}`],
      dataPipelineIds: [],
      causeDataPipelineIds: [],
    },
  };
}

function anAnswer(
  fields: Partial<DataAlertLineageAnswer> = {},
): DataAlertLineageAnswer {
  return {
    lineage: aLineage(),
    hasCause: true,
    isCauseDrawn: true,
    consequenceCount: 1,
    drawnConsequenceCount: 1,
    column: "customer_id",
    ...fields,
  };
}

/*
 * A cause on orders_load, the pipeline loading staging.orders from
 * raw.orders: the way up ends on its arrow. It also builds mart.revenue
 * from the table, on the way down to the alert this one caused.
 */
function causeOnPipeline(
  pipeline: DataTableLineagePipeline = ORDERS_LOAD,
  sourceArrowPipelines: Array<DataTableLineagePipeline> = [pipeline],
  causeDataPipelineIds: Array<string> | null = [LOAD],
): DataAlertLineageAnswer {
  const edges: Array<DataTableLineageEdge> = [
    feeds(SOURCE, STAGING, { pipelines: sourceArrowPipelines }),
    feeds(STAGING, TABLE),
    feeds(LEGACY, TABLE),
    feeds(TABLE, MART, { pipelines: [pipeline] }),
    feeds(TABLE, SIDE),
  ];
  const highlight: DataLineageHighlight = {
    nodeIds: [
      `table:${TABLE}`,
      `table:${STAGING}`,
      `table:${SOURCE}`,
      `table:${MART}`,
    ],
    edgeIds: [
      edgeId(SOURCE, STAGING),
      edgeId(STAGING, TABLE),
      edgeId(TABLE, MART),
    ].sort(),
    causeNodeIds: [],
    consequenceNodeIds: [`table:${MART}`],
    dataPipelineIds: [LOAD],
    causeDataPipelineIds: causeDataPipelineIds || [],
  };

  if (!causeDataPipelineIds) {
    // An answer from before the cause's pipelines were sent.
    delete (highlight as Partial<DataLineageHighlight>).causeDataPipelineIds;
  }

  return anAnswer({
    lineage: aLineage({ withColumns: false, edges, highlight }),
    column: null,
  });
}

// A colour as the browser writes it back: #6366f1 as rgb(99, 102, 241).
function rgbOf(hex: string): string {
  const [red, green, blue]: Array<number> = [1, 3, 5].map(
    (start: number): number => {
      return parseInt(hex.slice(start, start + 2), 16);
    },
  );

  return `rgb(${red}, ${green}, ${blue})`;
}

function card(nodeId: string): HTMLElement {
  return screen.getByTestId(`flow-node-${nodeId}`);
}

// The card's own box, where it says whether it is on a way and what it is.
function cardBox(id: string): HTMLElement {
  const box: Element | null = card(`table:${id}`).querySelector(
    "[data-node-id]",
  );

  expect(box).not.toBeNull();

  return box as HTMLElement;
}

// The column a card names, or null when it is off the column's way.
function columnOn(id: string): string | null {
  return (
    within(card(`table:${id}`)).queryByTestId("lineage-card-columns")
      ?.textContent || null
  );
}

function isFaint(id: string): boolean {
  return cardBox(id).getAttribute("data-dimmed") === "true";
}

// The arrows drawn wide, as their ends' last four: "source>target".
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

function ends(source: string, target: string): string {
  return `${source.slice(-4)}>${target.slice(-4)}`;
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

function columnNotes(): Array<string> {
  return Array.from(
    screen.getByTestId("lineage-column-notes").querySelectorAll("p"),
  ).map((note: HTMLParagraphElement): string => {
    return withoutIsolateMarks(note.textContent || "");
  });
}

function wayNotes(): string {
  return withoutIsolateMarks(
    screen.getByTestId("lineage-highlight-notes").textContent || "",
  );
}

// The arrow's label, drawn where it is.
function arrowLabel(source: string, target: string): HTMLElement {
  return within(
    screen.getByTestId(`flow-edge-${edgeId(source, target)}`),
  ).getByTestId("lineage-edge-label");
}

function arrowData(
  source: string,
  target: string,
): Record<string, unknown> | undefined {
  return (flowProps()?.edges || []).find((edge: { id: string }): boolean => {
    return edge.id === edgeId(source, target);
  })?.data as Record<string, unknown> | undefined;
}

async function renderDrawn(
  answer: DataAlertLineageAnswer = anAnswer(),
  alertId: string = ALERT,
): Promise<RenderResult> {
  getAlertLineageMock.mockResolvedValue(answer);

  const view: RenderResult = render(
    <AlertLineageDiagram alertId={new ObjectID(alertId)} />,
  );

  await screen.findByTestId("mock-react-flow");

  return view;
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

const LANGUAGES: ReadonlyArray<string> = ["ar", "de", "fa"];

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  getAlertLineageMock.mockReset();
  expandLineageMock.mockReset();
  resetFlowStandIn();
  await inLanguage("en");
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("an alert from a check on one column", () => {
  test("opens with that column followed: named in the picker, said in a sentence, and on each card on its way", async () => {
    await renderDrawn();

    expect(getAlertLineageMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("lineage-column")).toHaveTextContent(
      "customer_id",
    );
    expect(columnNotes()).toEqual([
      "customer_id is highlighted where it comes from and where it goes.",
    ]);
    expect(columnOn(TABLE)).toBe("customer_id");
    expect(columnOn(STAGING)).toBe("cust_id");
    expect(columnOn(SOURCE)).toBe("CUSTOMER");
    expect(columnOn(LEGACY)).toBe("legacy_customer");
    expect(columnOn(MART)).toBe("buyer_id");
    // side.orders is built from order_id only.
    expect(columnOn(SIDE)).toBeNull();
  });

  test("its way is picked out beside the alert's: the cause and what it caused still named, and still said", async () => {
    await renderDrawn();

    expect(cardBox(SOURCE)).toHaveAttribute("data-role", "Cause");
    expect(cardBox(MART)).toHaveAttribute("data-role", "Consequence");
    // legacy.orders is on the column's way only; side.orders on neither.
    expect(cardBox(LEGACY)).not.toHaveAttribute("data-role");
    expect(isFaint(LEGACY)).toBe(false);
    expect(isFaint(SIDE)).toBe(true);

    for (const id of [TABLE, STAGING, SOURCE, MART]) {
      expect({ id, isFaint: isFaint(id) }).toEqual({ id, isFaint: false });
    }

    expect(wideArrows()).toEqual(
      [
        ends(SOURCE, STAGING),
        ends(STAGING, TABLE),
        ends(LEGACY, TABLE),
        ends(TABLE, MART),
      ].sort(),
    );
    expect(wayNotes()).toContain(
      "The way up to the alert that caused this one is highlighted.",
    );
    expect(wayNotes()).toContain(
      "The way down to the alert this one caused is highlighted.",
    );
  });

  test("the check's column is offered first, the rest of the columns its arrows name by name", async () => {
    await renderDrawn();

    expect(offered()).toEqual(["customer_id", "amount", "order_id"]);
  });

  test("another column picked follows that one instead, the alert's ways still picked out", async () => {
    await renderDrawn();

    follow("order_id");

    expect(columnNotes()).toEqual([
      "order_id is highlighted where it comes from and where it goes.",
    ]);
    expect(columnOn(STAGING)).toBe("id");
    expect(columnOn(SOURCE)).toBe("ID");
    expect(columnOn(SIDE)).toBe("order_id");
    expect(columnOn(LEGACY)).toBeNull();
    expect(columnOn(MART)).toBeNull();
    expect(isFaint(LEGACY)).toBe(true);
    expect(isFaint(SIDE)).toBe(false);
    expect(cardBox(SOURCE)).toHaveAttribute("data-role", "Cause");
    expect(cardBox(MART)).toHaveAttribute("data-role", "Consequence");
  });

  test("cleared: only the alert's ways are picked out, as for a check on the whole table, and nothing is read again", async () => {
    await renderDrawn();

    stopFollowing();

    expect(
      screen.queryByTestId("lineage-column-notes"),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("lineage-card-columns")).toHaveLength(0);
    expect(screen.getByTestId("lineage-column")).toHaveTextContent(
      "Follow a column",
    );
    expect(wideArrows()).toEqual(
      [ends(SOURCE, STAGING), ends(STAGING, TABLE), ends(TABLE, MART)].sort(),
    );
    expect(isFaint(LEGACY)).toBe(true);
    expect(cardBox(SOURCE)).toHaveAttribute("data-role", "Cause");
    expect(getAlertLineageMock).toHaveBeenCalledTimes(1);

    // It can be picked again.
    follow("customer_id");

    expect(columnOn(STAGING)).toBe("cust_id");
  });

  test("the check names the column in another case: followed all the same, named as the check names it", async () => {
    await renderDrawn(anAnswer({ column: "CUSTOMER_ID" }));

    expect(screen.getByTestId("lineage-column")).toHaveTextContent(
      "CUSTOMER_ID",
    );
    expect(columnNotes()).toEqual([
      "CUSTOMER_ID is highlighted where it comes from and where it goes.",
    ]);
    expect(columnOn(STAGING)).toBe("cust_id");
    expect(offered()).toEqual(["CUSTOMER_ID", "amount", "order_id"]);
  });

  test("a column no arrow names: nothing followed, and the columns the arrows name still offered", async () => {
    await renderDrawn(anAnswer({ column: "status" }));

    expect(
      screen.queryByTestId("lineage-column-notes"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("lineage-column")).toHaveTextContent(
      "Follow a column",
    );
    expect(offered()).toEqual(["amount", "customer_id", "order_id"]);
    expect(isFaint(LEGACY)).toBe(true);
  });

  test("drawing more asks for the columns of the new arrows, and the column goes on into the tables drawn", async () => {
    const expansion: DataLineageExpansion = {
      nodeId: `table:${LEGACY}`,
      side: DataLineageSide.Upstream,
      hiddenCount: 0,
      nodes: [
        table(ARCHIVE, DataLineageSide.Upstream, -2, {
          name: "legacy.archive",
        }),
      ],
      edges: [
        feeds(ARCHIVE, LEGACY, { columns: [["cust", "legacy_customer"]] }),
      ],
      hiddenDashboardCount: 0,
      isTruncated: false,
    };

    expandLineageMock.mockResolvedValue(expansion);
    await renderDrawn();

    await act(async () => {
      fireEvent.click(
        within(card(`table:${LEGACY}`)).getByTestId("lineage-hidden-left"),
      );
    });

    expect(
      (expandLineageMock.mock.calls[0]![0] as DataLineageExpandRequest)
        .withColumns,
    ).toBe(true);
    expect(columnOn(ARCHIVE)).toBe("cust");
    expect(columnNotes()[0]).toBe(
      "customer_id is highlighted where it comes from and where it goes.",
    );
  });

  test("another alert's page opens with its own check's column, whatever was picked on the last one", async () => {
    const view: RenderResult = await renderDrawn();

    stopFollowing();

    getAlertLineageMock.mockResolvedValue(anAnswer({ column: "order_id" }));

    await act(async () => {
      view.rerender(
        <AlertLineageDiagram alertId={new ObjectID(OTHER_ALERT)} />,
      );
    });

    expect(
      await screen.findByTestId("lineage-column-notes"),
    ).toBeInTheDocument();
    expect(columnNotes()).toEqual([
      "order_id is highlighted where it comes from and where it goes.",
    ]);
    expect(getAlertLineageMock).toHaveBeenCalledTimes(2);
  });
});

/*
 * The alert's card draws a new body for each read, but a body kept on
 * screen can be handed another column to open with: the column picked
 * over the last one is left behind, and one picked over the same one
 * stays.
 */
describe("a drawing kept on screen, handed a column to open with", () => {
  const drawn: DataTableLineage = aLineage();

  function body(initialColumn: string | null | undefined): ReactElement {
    return (
      <LineageDiagramBody
        lineage={drawn}
        place={LineagePlace.Alert}
        withColumns={true}
        columnOrder={[]}
        initialColumn={initialColumn}
      />
    );
  }

  function followedNow(): Array<string> {
    return screen.queryByTestId("lineage-column-notes") ? columnNotes() : [];
  }

  function says(column: string): Array<string> {
    return [FOLLOWED.replace("{{column}}", column)];
  }

  test("a column picked stays while the same one is handed again; another one handed is followed instead", async () => {
    const view: RenderResult = render(body("customer_id"));

    await screen.findByTestId("mock-react-flow");
    expect(followedNow()).toEqual(says("customer_id"));
    expect(columnOn(STAGING)).toBe("cust_id");

    follow("order_id");
    expect(followedNow()).toEqual(says("order_id"));

    // Drawn again with the same column to open with: what was picked stays.
    view.rerender(body("customer_id"));
    expect(followedNow()).toEqual(says("order_id"));
    expect(columnOn(SIDE)).toBe("order_id");

    // Another column to open with: it is followed, the pick left behind.
    view.rerender(body("amount"));
    expect(followedNow()).toEqual(says("amount"));
    expect(columnOn(MART)).toBe("revenue");
    expect(screen.getByTestId("lineage-column")).toHaveTextContent("amount");
    expect(expandLineageMock).not.toHaveBeenCalled();
  });

  test("cleared, then handed none: nothing followed; handed one again: it is followed", async () => {
    const view: RenderResult = render(body("amount"));

    await screen.findByTestId("mock-react-flow");
    stopFollowing();
    expect(followedNow()).toEqual([]);

    // The same column to open with, again: cleared stays cleared.
    view.rerender(body("amount"));
    expect(followedNow()).toEqual([]);

    view.rerender(body(null));
    expect(followedNow()).toEqual([]);
    expect(columnOn(STAGING)).toBeNull();

    view.rerender(body("customer_id"));
    expect(followedNow()).toEqual(says("customer_id"));
    expect(columnOn(SOURCE)).toBe("CUSTOMER");
  });

  test("no column to open with, then one: a column picked meanwhile gives way to it", async () => {
    const view: RenderResult = render(body(undefined));

    await screen.findByTestId("mock-react-flow");
    expect(followedNow()).toEqual([]);

    follow("order_id");
    expect(followedNow()).toEqual(says("order_id"));

    // Still none to open with: the pick stays.
    view.rerender(body(null));
    expect(followedNow()).toEqual(says("order_id"));

    view.rerender(body("customer_id"));
    expect(followedNow()).toEqual(says("customer_id"));
  });
});

describe("an alert from a check on the whole table", () => {
  test("draws as before: no column to follow, nothing said of one, the alert's ways alone", async () => {
    await renderDrawn(
      anAnswer({ lineage: aLineage({ withColumns: false }), column: null }),
    );

    expect(screen.queryByTestId("lineage-column")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("lineage-column-notes"),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("lineage-card-columns")).toHaveLength(0);
    expect(wideArrows()).toEqual(
      [ends(SOURCE, STAGING), ends(STAGING, TABLE), ends(TABLE, MART)].sort(),
    );
    expect(cardBox(SOURCE)).toHaveAttribute("data-role", "Cause");
  });

  test("an answer from before the check's column was sent draws the same", async () => {
    const answer: DataAlertLineageAnswer = anAnswer({
      lineage: aLineage({ withColumns: false }),
    });

    delete (answer as Partial<DataAlertLineageAnswer>).column;

    await renderDrawn(answer);

    expect(screen.queryByTestId("lineage-column")).not.toBeInTheDocument();
    expect(cardBox(SOURCE)).toHaveAttribute("data-role", "Cause");
  });

  test("drawing more asks for no columns", async () => {
    expandLineageMock.mockResolvedValue({
      nodeId: `table:${LEGACY}`,
      side: DataLineageSide.Upstream,
      hiddenCount: 0,
      nodes: [table(ARCHIVE, DataLineageSide.Upstream, -2)],
      edges: [feeds(ARCHIVE, LEGACY)],
      hiddenDashboardCount: 0,
      isTruncated: false,
    });
    await renderDrawn(
      anAnswer({ lineage: aLineage({ withColumns: false }), column: null }),
    );

    await act(async () => {
      fireEvent.click(
        within(card(`table:${LEGACY}`)).getByTestId("lineage-hidden-left"),
      );
    });

    expect(expandLineageMock).toHaveBeenCalledTimes(1);
    expect(
      Boolean(
        (expandLineageMock.mock.calls[0]![0] as DataLineageExpandRequest)
          .withColumns,
      ),
    ).toBe(false);
  });
});

describe("the cause's pipeline on its arrows", () => {
  test("the arrow the way up ends on names it in indigo, and says Cause under its name", async () => {
    await renderDrawn(causeOnPipeline());

    expect(arrowData(SOURCE, STAGING)).toEqual({
      label: "orders_load",
      title: "orders_load",
      isLabelHighlighted: true,
      isCause: true,
      isHighlighted: true,
    });

    const label: HTMLElement = arrowLabel(SOURCE, STAGING);

    expect(within(label).getByTestId("lineage-edge-name")).toHaveTextContent(
      "orders_load",
    );
    expect(within(label).getByTestId("lineage-edge-cause")).toHaveTextContent(
      "Cause",
    );
    expect(label.style.color).toBe(rgbOf(LINEAGE_HIGHLIGHT_COLOR));
  });

  test("the same pipeline on the way down to the alert it caused is named there, without Cause", async () => {
    await renderDrawn(causeOnPipeline());

    expect(arrowData(TABLE, MART)).toEqual({
      label: "orders_load",
      title: "orders_load",
      isLabelHighlighted: true,
      isHighlighted: true,
    });
    expect(
      within(arrowLabel(TABLE, MART)).queryByTestId("lineage-edge-cause"),
    ).not.toBeInTheDocument();
    // One arrow says Cause in the whole drawing.
    expect(screen.getAllByTestId("lineage-edge-cause")).toHaveLength(1);
  });

  test("its run failed: red, says it failed under the pointer, and still Cause", async () => {
    const failed: DataTableLineagePipeline = {
      ...ORDERS_LOAD,
      lastRunState: "FAIL",
    };

    await renderDrawn(causeOnPipeline(failed));

    expect(arrowData(SOURCE, STAGING)).toEqual({
      label: "orders_load",
      title: "orders_load failed",
      isCause: true,
      isHighlighted: true,
    });

    const label: HTMLElement = arrowLabel(SOURCE, STAGING);

    expect(label).toHaveAttribute("title", "orders_load failed");
    expect(label.style.color).toBe(rgbOf(LINEAGE_PROBLEM_COLOR));
    expect(within(label).getByTestId("lineage-edge-cause")).toHaveTextContent(
      "Cause",
    );
  });

  test("another pipeline's failed run on the cause's arrow is named first, and says nothing of the cause", async () => {
    const otherFailed: DataTableLineagePipeline = {
      dataPipelineId: OTHER_RUN,
      name: "orders_backfill",
      lastRunState: "FAIL",
    };

    await renderDrawn(causeOnPipeline(ORDERS_LOAD, [ORDERS_LOAD, otherFailed]));

    expect(arrowData(SOURCE, STAGING)).toEqual({
      label: "orders_backfill",
      title: "orders_backfill failed",
      isHighlighted: true,
    });
    expect(screen.queryByTestId("lineage-edge-cause")).not.toBeInTheDocument();
  });

  test("a cause on a table: no arrow says Cause, its card does", async () => {
    await renderDrawn();

    expect(screen.queryByTestId("lineage-edge-cause")).not.toBeInTheDocument();
    expect(cardBox(SOURCE)).toHaveAttribute("data-role", "Cause");
  });

  test("an answer from before the cause's pipelines were sent: named on its arrow, without Cause", async () => {
    await renderDrawn(causeOnPipeline(ORDERS_LOAD, [ORDERS_LOAD], null));

    expect(arrowData(SOURCE, STAGING)).toEqual({
      label: "orders_load",
      title: "orders_load",
      isLabelHighlighted: true,
      isHighlighted: true,
    });
    expect(screen.queryByTestId("lineage-edge-cause")).not.toBeInTheDocument();
  });

  test("the name and Cause keep to the label's room: the name cut short at its end, Cause under it, the whole name under the pointer", async () => {
    const long: DataTableLineagePipeline = {
      ...ORDERS_LOAD,
      name: "orders_load_from_the_payments_provider_callbacks_every_hour",
    };

    await renderDrawn(causeOnPipeline(long));

    const label: HTMLElement = arrowLabel(SOURCE, STAGING);
    const name: HTMLElement = within(label).getByTestId("lineage-edge-name");
    const cause: HTMLElement = within(label).getByTestId("lineage-edge-cause");

    expect(label.style.maxWidth).toBe(`${LINEAGE_EDGE_LABEL_MAX_WIDTH}px`);
    expect(label).toHaveClass("truncate", "flex", "flex-col", "items-center");
    expect(label).toHaveAttribute("title", long.name);
    // The name on one line, cut at its own end, as wide as the label at most.
    expect(name).toHaveClass("block", "max-w-full", "truncate");
    expect(name).toHaveAttribute("dir", "ltr");
    // Cause under it, never wider than the label: a word too long ends in "..." too.
    expect(cause).toHaveClass("max-w-full");
    expect(within(cause).getByTestId("pill")).toHaveClass("max-w-full");
    expect(within(cause).getByTestId("pill-text")).toHaveClass(
      "min-w-0",
      "truncate",
    );
    expect(name.compareDocumentPosition(cause)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});

describe("in the reader's language", () => {
  test("Arabic: the check's column is followed, said in Arabic with its name kept whole", async () => {
    await inLanguage("ar");
    await renderDrawn();

    const arabic: Record<string, string> = readDashboardLocale("ar");

    expect(arabic[FOLLOWED]).toBeDefined();
    expect(arabic[FOLLOWED]).not.toBe(FOLLOWED);
    expect(columnNotes()).toEqual([
      arabic[FOLLOWED]!.replace("{{column}}", "customer_id"),
    ]);
    expect(screen.getByTestId("lineage-column")).toHaveTextContent(
      "customer_id",
    );
    expect(columnOn(STAGING)).toBe("cust_id");
    // The cause's card says so in Arabic.
    expect(
      within(cardBox(SOURCE))
        .getAllByTestId("pill-text")
        .map((pill: HTMLElement): string => {
          return pill.textContent || "";
        }),
    ).toContain(arabic["Cause"]);
    expect(arabic["Cause"]).toBe("السبب");
  });

  test.each([
    ["ar", "السبب"],
    ["de", "Ursache"],
    ["fa", "علت"],
  ])(
    "%s: the cause's arrow says %s, as its card would, inside the label's room",
    async (language: string, word: string) => {
      await inLanguage(language);
      await renderDrawn(causeOnPipeline());

      const label: HTMLElement = arrowLabel(SOURCE, STAGING);
      const cause: HTMLElement =
        within(label).getByTestId("lineage-edge-cause");

      expect(readDashboardLocale(language)["Cause"]).toBe(word);
      expect(cause).toHaveTextContent(word);
      // The pipeline's Latin name still reads left to right, cut at its own end.
      expect(within(label).getByTestId("lineage-edge-name")).toHaveAttribute(
        "dir",
        "ltr",
      );
      expect(label.style.maxWidth).toBe(`${LINEAGE_EDGE_LABEL_MAX_WIDTH}px`);
    },
  );
});
