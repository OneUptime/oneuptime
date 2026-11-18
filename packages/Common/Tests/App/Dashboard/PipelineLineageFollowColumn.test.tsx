import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
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
 * FOLLOWING A COLUMN ACROSS A PIPELINE, ON ITS PAGE (#6854).
 *
 * A pipeline's Lineage card reads its drawing with the columns its runs
 * moved, and offers a column picker as a table's Lineage tab does: the
 * columns it writes, in the order of the first table it writes them to,
 * then by name. Nothing is followed until the reader picks a column; one
 * picked lights its way across the pipeline - up to the column of each
 * table it reads that it was built from, down to each table it writes it
 * to - and the sentence over the drawing says so. A table it reads whose
 * columns its runs never named may carry the column too: the drawing says
 * it may go further. In English, Arabic and Persian. The API is mocked and
 * React Flow is the shared stand-in.
 */

const getPipelineLineageMock: MockFunction = getJestMockFunction();
const expandLineageMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi",
  () => {
    return {
      __esModule: true,
      default: {
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
  DataLineageEdgeKind,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  getLineageEdgeId,
} from "../../../Types/DataObservability/DataTableLineage";
import PipelineLineageDiagram from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/PipelineLineageDiagram";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { flowProps, resetFlowStandIn } from "./LineageFlowStandIn";

const ETL: string = "33333333-3333-4333-8333-000000000001";
const RAW: string = "22222222-2222-4222-8222-000000000001";
const CRM: string = "22222222-2222-4222-8222-000000000002";
const ORDERS: string = "22222222-2222-4222-8222-000000000003";
const CUSTOMERS: string = "22222222-2222-4222-8222-000000000004";

const ETL_NODE: string = `pipeline:${ETL}`;

const FOLLOWED: string =
  "{{column}} is highlighted where it comes from and where it goes.";
const MAY_GO_FURTHER: string =
  "Some arrows on its way do not say which columns they carry, so it may go further than is highlighted.";

function table(
  id: string,
  side: DataLineageSide,
  depth: number,
  name: string,
): DataTableLineageNode {
  return {
    id: `table:${id}`,
    kind: DataLineageNodeKind.Table,
    side,
    depth,
    name,
    dataAssetId: id,
    database: "Warehouse",
    assetKind: DataAssetKind.Table,
    freshness: DataAssetFreshness.Fresh,
    lateBySeconds: 0,
    isDropped: false,
    openAlertCount: 0,
    hiddenUpstreamCount: 0,
    hiddenDownstreamCount: 0,
  };
}

function own(
  kind: DataLineageEdgeKind,
  source: string,
  target: string,
  columns?: Array<[string, string]>,
): DataTableLineageEdge {
  return {
    id: getLineageEdgeId({ kind, source, target }),
    source,
    target,
    kind,
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

const READ_RAW: string = getLineageEdgeId({
  kind: DataLineageEdgeKind.Reads,
  source: `table:${RAW}`,
  target: ETL_NODE,
});
const WRITE_ORDERS: string = getLineageEdgeId({
  kind: DataLineageEdgeKind.Writes,
  source: ETL_NODE,
  target: `table:${ORDERS}`,
});
const WRITE_CUSTOMERS: string = getLineageEdgeId({
  kind: DataLineageEdgeKind.Writes,
  source: ETL_NODE,
  target: `table:${CUSTOMERS}`,
});

/*
 * orders_etl reads raw.orders - its runs name cust_id -> customer_id and
 * amount -> total for public.orders, cust_id -> id for public.customers -
 * and crm.accounts, whose columns they never name. public.orders lists its
 * columns total, customer_id.
 */
function etlLineage(
  fields: { withColumns?: boolean; columnOrder?: Array<string> } = {},
): DataTableLineage {
  const withColumns: boolean = fields.withColumns ?? true;

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
        hiddenUpstreamCount: 0,
        hiddenDownstreamCount: 0,
      },
      table(RAW, DataLineageSide.Upstream, -1, "raw.orders"),
      table(CRM, DataLineageSide.Upstream, -1, "crm.accounts"),
      table(ORDERS, DataLineageSide.Downstream, 1, "public.orders"),
      table(CUSTOMERS, DataLineageSide.Downstream, 1, "public.customers"),
    ],
    edges: [
      own(
        DataLineageEdgeKind.Reads,
        `table:${RAW}`,
        ETL_NODE,
        withColumns
          ? [
              ["amount", "total"],
              ["cust_id", "customer_id"],
              ["cust_id", "id"],
            ]
          : undefined,
      ),
      own(DataLineageEdgeKind.Reads, `table:${CRM}`, ETL_NODE),
      own(
        DataLineageEdgeKind.Writes,
        ETL_NODE,
        `table:${ORDERS}`,
        withColumns
          ? [
              ["customer_id", "customer_id"],
              ["total", "total"],
            ]
          : undefined,
      ),
      own(
        DataLineageEdgeKind.Writes,
        ETL_NODE,
        `table:${CUSTOMERS}`,
        withColumns ? [["id", "id"]] : undefined,
      ),
    ],
    hiddenDashboardCount: 0,
    isTruncated: false,
    ...(fields.columnOrder ? { columnOrder: fields.columnOrder } : {}),
  };
}

function card(nodeId: string): HTMLElement {
  return screen.getByTestId(`flow-node-${nodeId}`);
}

// The column a card names, or null when it is off the column's way.
function columnOn(nodeId: string): string | null {
  return (
    within(card(nodeId)).queryByTestId("lineage-card-columns")?.textContent ||
    null
  );
}

function picker(): HTMLElement {
  return screen.getByRole("combobox", {
    name: /./,
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

function columnNotes(): Array<string> {
  return Array.from(
    screen.getByTestId("lineage-column-notes").querySelectorAll("p"),
  ).map((note: HTMLParagraphElement): string => {
    return withoutIsolateMarks(note.textContent || "");
  });
}

// The arrows drawn wide, by id.
function wideArrows(): Array<string> {
  return (flowProps()?.edges || [])
    .filter((edge: { data?: { isHighlighted?: boolean } }): boolean => {
      return Boolean(edge.data?.isHighlighted);
    })
    .map((edge: { id: string }): string => {
      return edge.id;
    })
    .sort();
}

async function renderDrawn(
  lineage: DataTableLineage = etlLineage({
    columnOrder: ["total", "customer_id"],
  }),
): Promise<void> {
  getPipelineLineageMock.mockResolvedValue(lineage);
  render(<PipelineLineageDiagram dataPipelineId={new ObjectID(ETL)} />);
  await screen.findByTestId("mock-react-flow");
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

const LANGUAGES: ReadonlyArray<string> = ["ar", "fa"];

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
  getPipelineLineageMock.mockReset();
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

describe("a pipeline's Lineage card, read with its columns", () => {
  test("asks for the columns its runs moved", async () => {
    await renderDrawn();

    expect(getPipelineLineageMock).toHaveBeenCalledTimes(1);
    expect(getPipelineLineageMock.mock.calls[0]![2]).toBe(true);
  });

  test("offers the columns it writes, in the order of the first table it writes them to, the rest by name", async () => {
    await renderDrawn();

    expect(offered()).toEqual(["total", "customer_id", "id"]);
  });

  test("an answer without that order offers them by name", async () => {
    await renderDrawn(etlLineage());

    expect(offered()).toEqual(["customer_id", "id", "total"]);
  });

  test("nothing is followed when the page opens: the reader picks", async () => {
    await renderDrawn();

    expect(
      screen.queryByTestId("lineage-column-notes"),
    ).not.toBeInTheDocument();
    expect(columnOn(`table:${RAW}`)).toBeNull();
    expect(columnOn(ETL_NODE)).toBeNull();
    expect(wideArrows()).toEqual([]);
    expect(document.querySelector('[data-dimmed="true"]')).toBeNull();
  });

  test("a column picked lights its way across the pipeline: up to the column it was built from, down to the table it is written to", async () => {
    await renderDrawn();

    follow("customer_id");

    expect(columnNotes()).toEqual([
      FOLLOWED.replace("{{column}}", "customer_id"),
      // crm.accounts' arrow names no columns: it may carry this one.
      MAY_GO_FURTHER,
    ]);
    expect(columnOn(ETL_NODE)).toBe("customer_id");
    expect(columnOn(`table:${RAW}`)).toBe("cust_id");
    expect(columnOn(`table:${ORDERS}`)).toBe("customer_id");
    // public.customers takes another column: off the way, drawn faint.
    expect(columnOn(`table:${CUSTOMERS}`)).toBeNull();
    expect(wideArrows()).toEqual([READ_RAW, WRITE_ORDERS].sort());
  });

  test("another column follows its own way: id goes to customers", async () => {
    await renderDrawn();

    follow("id");

    expect(columnOn(`table:${CUSTOMERS}`)).toBe("id");
    expect(columnOn(`table:${RAW}`)).toBe("cust_id");
    expect(columnOn(`table:${ORDERS}`)).toBeNull();
    expect(wideArrows()).toEqual([READ_RAW, WRITE_CUSTOMERS].sort());
  });

  test("a drawing whose runs named no columns offers no picker", async () => {
    await renderDrawn(etlLineage({ withColumns: false }));

    expect(screen.queryByTestId("lineage-column")).not.toBeInTheDocument();
  });

  test.each(LANGUAGES)(
    "%s: the columns are offered as written, and the column followed is said in the reader's language",
    async (language: string) => {
      await inLanguage(language);
      await renderDrawn();

      const words: Record<string, string> = readDashboardLocale(language);

      expect(words[FOLLOWED]).toBeDefined();
      expect(words[FOLLOWED]).not.toBe(FOLLOWED);
      expect(offered()).toEqual(["total", "customer_id", "id"]);

      follow("customer_id");

      expect(columnNotes()[0]).toBe(
        words[FOLLOWED]!.replace("{{column}}", "customer_id"),
      );
      expect(columnOn(`table:${RAW}`)).toBe("cust_id");
    },
  );
});
