import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Span column of the two exception tables: the Occurrences table on an
 * exception's page (OccuranceTable) and ExceptionInstanceTable, the list the
 * service, incident and alert pages embed.
 *
 * Every row in them is an exception, and recording an exception does not
 * change a span's status. So the status dot names the status alone, "Span
 * Status: Unset": the "Unset (no error)" the Traces pages say would
 * contradict the row it sits in.
 *
 * An exception taken from a log has no span behind it: log ingest stores a
 * placeholder Unset (spanStatusCode 0) with an empty spanId and spanName.
 * The Occurrences table drew that placeholder as a green status dot. It now
 * draws none, as ExceptionInstanceTable already rendered nothing there.
 *
 * The REAL tables are mounted, through AnalyticsModelTable, BaseModelTable
 * and Table, so every dot comes from the tables' own getElement renderers.
 * Only the edges are stubbed: the analytics API, the project, the viewer and
 * translation. The API stub answers like the server does, with only the
 * selected fields, made into models by AnalyticsBaseModel.fromJSONArray. So
 * a table that stopped selecting spanId or spanStatusCode would lose them
 * here too.
 */

const analyticsGetListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables and the imports below are still
 * unassigned when the factories run.
 */
jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

/*
 * Replaced whole rather than spied on: the real module loads the browser
 * telemetry SDK, whose zone.js swaps out the global Promise, and React then
 * reports every awaited act() as not awaited.
 */
jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
      // The card title asks, to badge a table the plan does not include.
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

/*
 * An ordinary project member rather than a master admin, so the table's
 * column permission checks run the way they do for most viewers.
 */
jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectMember];
      },
      getProjectPermissions: (): {
        permissions: Array<{ permission: Permission }>;
      } => {
        return { permissions: [{ permission: Permission.ProjectMember }] };
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: [] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import OccuranceTable from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/OccuranceTable";
import ExceptionInstanceTable from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionInstanceTable";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const FINGERPRINT: string = "9f86d081884c7d659a2feaa0c55ad015";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID: string = "a1b2c3d4e5f60718";
const TRACE_ROUTE: string = `/dashboard/${PROJECT_ID}/traces/view/${TRACE_ID}`;

// How jsdom reports the dots' inline colors: #10b981, #0891b2 and #ef4444.
const UNSET_RGB: string = "rgb(16, 185, 129)";
const OK_RGB: string = "rgb(8, 145, 178)";
const ERROR_RGB: string = "rgb(239, 68, 68)";

/*
 * An exception recorded on a span, as trace ingest stores it: the span's
 * id, name and status travel with the exception. The Occurrences table
 * shows the release and ExceptionInstanceTable the message, so the tests
 * find a row by one of those.
 */
const SPAN_EXCEPTION: JSONObject = {
  _id: "30000000-0000-4000-8000-000000000001",
  time: "2026-09-28T10:00:00.000Z",
  traceId: TRACE_ID,
  spanId: SPAN_ID,
  spanName: "GET /api/orders/:id",
  spanStatusCode: SpanStatus.Unset,
  exceptionType: "TimeoutError",
  message: "upstream timed out after 30s",
  escaped: false,
  release: "orders@4.2.0",
  environment: "production",
};

/*
 * An exception taken from a log line, as log ingest stores it
 * (OtelLogsIngestService.collectExceptionFromLog): no span behind it, so an
 * empty spanId and spanName and a placeholder Unset status.
 */
const LOG_EXCEPTION: JSONObject = {
  _id: "30000000-0000-4000-8000-000000000002",
  time: "2026-09-28T10:01:00.000Z",
  traceId: "",
  spanId: "",
  spanName: "",
  spanStatusCode: SpanStatus.Unset,
  exceptionType: "KeyError",
  message: "KeyError: 'customer_id'",
  escaped: null,
  release: "billing-worker@1.9.0",
  environment: "production",
};

interface SpanStatusCase {
  name: string;
  spanStatusCode: SpanStatus;
  dotName: string;
  rgb: string;
}

const SPAN_STATUS_CASES: Array<SpanStatusCase> = [
  {
    name: "Unset (0)",
    spanStatusCode: SpanStatus.Unset,
    dotName: "Span Status: Unset",
    rgb: UNSET_RGB,
  },
  {
    name: "Ok (1)",
    spanStatusCode: SpanStatus.Ok,
    dotName: "Span Status: Ok",
    rgb: OK_RGB,
  },
  {
    name: "Error (2)",
    spanStatusCode: SpanStatus.Error,
    dotName: "Span Status: Error",
    rgb: ERROR_RGB,
  },
];

interface LogShape {
  name: string;
  row: JSONObject;
}

const LOG_SHAPES: Array<LogShape> = [
  { name: "a log with no trace context", row: LOG_EXCEPTION },
  // Written inside a trace but outside any span: still no span behind it.
  {
    name: "a log with a trace id but no span id",
    row: { ...LOG_EXCEPTION, traceId: TRACE_ID },
  },
];

// What the stubbed API holds for the table's list request.
let apiRows: Array<JSONObject> = [];

interface ListRequest {
  select: Record<string, boolean | undefined>;
}

beforeEach(() => {
  apiRows = [];
  getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
  analyticsGetListMock.mockImplementation(
    async (request: ListRequest): Promise<ListResult<ExceptionInstance>> => {
      const selected: Array<JSONObject> = apiRows.map(
        (row: JSONObject): JSONObject => {
          const fields: JSONObject = {};
          for (const key of Object.keys(row)) {
            const value: JSONValue | undefined = row[key];
            if (request.select[key] && value !== undefined) {
              fields[key] = value;
            }
          }
          return fields;
        },
      );
      const data: Array<ExceptionInstance> =
        AnalyticsBaseModel.fromJSONArray<ExceptionInstance>(
          selected,
          ExceptionInstance,
        );
      return { data, count: data.length, skip: 0, limit: data.length };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

/*
 * Mounts a table over `rows` and waits for its first page. The list request
 * resolves after mount; every data row gets its own actions cell.
 */
const mountTable: (
  table: React.ReactElement,
  rows: Array<JSONObject>,
) => Promise<void> = async (
  table: React.ReactElement,
  rows: Array<JSONObject>,
): Promise<void> => {
  apiRows = rows;
  await act(async () => {
    render(<MemoryRouter>{table}</MemoryRouter>);
  });
  await waitFor(() => {
    expect(screen.queryAllByTestId("row-actions")).toHaveLength(rows.length);
  });
};

const renderOccurrences: (rows: Array<JSONObject>) => Promise<void> = async (
  rows: Array<JSONObject>,
): Promise<void> => {
  await mountTable(<OccuranceTable exceptionFingerprint={FINGERPRINT} />, rows);
};

const renderInstances: (rows: Array<JSONObject>) => Promise<void> = async (
  rows: Array<JSONObject>,
): Promise<void> => {
  await mountTable(
    <ExceptionInstanceTable
      title="Exceptions"
      description="Exceptions recorded by this service."
      query={{}}
    />,
    rows,
  );
};

/*
 * The Span column's cell in the row that shows `rowText`, found through the
 * column header so an empty cell can be asserted on too.
 */
const spanCellOf: (rowText: string) => HTMLElement = (
  rowText: string,
): HTMLElement => {
  const headers: Array<HTMLElement> = screen.getAllByRole("columnheader");
  const spanColumn: number = headers.findIndex(
    (header: HTMLElement): boolean => {
      return header.textContent === "Span";
    },
  );
  expect(spanColumn).toBeGreaterThan(-1);

  const row: HTMLTableRowElement | null = screen
    .getByText(rowText)
    .closest("tr");
  expect(row).not.toBeNull();
  // Header and row line up cell for cell, the bulk-select box included.
  expect(row!.cells).toHaveLength(headers.length);

  const cell: HTMLTableCellElement | null = row!.cells.item(spanColumn);
  expect(cell).not.toBeNull();
  return cell!;
};

// Every span status dot in the table, by its accessible name, in row order.
const statusDotNames: () => Array<string | null> = (): Array<string | null> => {
  return screen
    .queryAllByRole("img", { name: /^Span Status/ })
    .map((dot: HTMLElement): string | null => {
      return dot.getAttribute("aria-label");
    });
};

// The select of the table's list request.
const requestedSelect: () => Record<string, boolean | undefined> = (): Record<
  string,
  boolean | undefined
> => {
  expect(analyticsGetListMock).toHaveBeenCalled();
  const request: ListRequest = analyticsGetListMock.mock
    .calls[0]![0] as ListRequest;
  return request.select;
};

describe("OccuranceTable: the Span column's status dot", () => {
  test("REGRESSION: an exception on an Unset span names the status alone, 'Span Status: Unset', never 'no error'", async () => {
    await renderOccurrences([SPAN_EXCEPTION]);

    const cell: HTMLElement = spanCellOf("orders@4.2.0");
    expect(within(cell).getByTestId("occurrence-span")).toBeInTheDocument();

    const dot: HTMLElement = within(cell).getByRole("img");
    expect(dot).toHaveAccessibleName("Span Status: Unset");
    expect(dot.style.backgroundColor).toBe(UNSET_RGB);

    // The row is itself an exception: "no error" would contradict it.
    expect(statusDotNames()).toEqual(["Span Status: Unset"]);
    expect(document.body).not.toHaveTextContent("no error");

    // The span's name links to its trace; its id sits underneath.
    expect(
      within(cell).getByRole("link", { name: "GET /api/orders/:id" }),
    ).toHaveAttribute("href", TRACE_ROUTE);
    expect(within(cell).getByText(SPAN_ID)).toBeInTheDocument();
  });

  test.each(SPAN_STATUS_CASES)(
    "an exception on a span with status $name: one dot, named '$dotName'",
    async (statusCase: SpanStatusCase) => {
      await renderOccurrences([
        { ...SPAN_EXCEPTION, spanStatusCode: statusCase.spanStatusCode },
      ]);

      const dots: Array<HTMLElement> = within(
        spanCellOf("orders@4.2.0"),
      ).getAllByRole("img");
      expect(dots).toHaveLength(1);
      expect(dots[0]).toHaveAccessibleName(statusCase.dotName);
      expect(dots[0]!.style.backgroundColor).toBe(statusCase.rgb);
    },
  );

  test.each(LOG_SHAPES)(
    "REGRESSION: an exception taken from $name draws no status dot",
    async (shape: LogShape) => {
      await renderOccurrences([shape.row]);

      /*
       * Log ingest's placeholder Unset came out as a green "Span Status:
       * Unset (no error)" dot beside an empty span name.
       */
      const cell: HTMLElement = spanCellOf("billing-worker@1.9.0");
      expect(within(cell).queryByRole("img")).not.toBeInTheDocument();
      expect(within(cell).queryByRole("link")).not.toBeInTheDocument();
      expect(cell.textContent).toBe("");
      expect(statusDotNames()).toEqual([]);
    },
  );

  test("a page mixing both: only the exceptions with a span behind them get a dot", async () => {
    await renderOccurrences([
      SPAN_EXCEPTION,
      LOG_EXCEPTION,
      {
        ...SPAN_EXCEPTION,
        _id: "30000000-0000-4000-8000-000000000003",
        spanId: "b2c3d4e5f6071829",
        spanName: "POST /api/checkout",
        spanStatusCode: SpanStatus.Error,
        release: "checkout@7.0.1",
      },
    ]);

    expect(statusDotNames()).toEqual([
      "Span Status: Unset",
      "Span Status: Error",
    ]);
    expect(
      within(spanCellOf("billing-worker@1.9.0")).queryByRole("img"),
    ).not.toBeInTheDocument();
    expect(
      within(spanCellOf("checkout@7.0.1")).getByRole("img"),
    ).toHaveAccessibleName("Span Status: Error");
  });

  test("asks for the span's id, name and status", async () => {
    await renderOccurrences([SPAN_EXCEPTION]);

    expect(requestedSelect()).toMatchObject({
      spanId: true,
      spanName: true,
      spanStatusCode: true,
      traceId: true,
    });
  });
});

describe("ExceptionInstanceTable: the Span column's status dot", () => {
  test("REGRESSION: an exception on an Unset span names the status alone, 'Span Status: Unset', never 'no error'", async () => {
    await renderInstances([SPAN_EXCEPTION]);

    const cell: HTMLElement = spanCellOf("upstream timed out after 30s");
    const dot: HTMLElement = within(cell).getByRole("img");
    expect(dot).toHaveAccessibleName("Span Status: Unset");
    expect(dot.style.backgroundColor).toBe(UNSET_RGB);

    expect(statusDotNames()).toEqual(["Span Status: Unset"]);
    expect(document.body).not.toHaveTextContent("no error");

    // The span id links to its trace.
    expect(within(cell).getByRole("link", { name: SPAN_ID })).toHaveAttribute(
      "href",
      TRACE_ROUTE,
    );
  });

  test.each(SPAN_STATUS_CASES)(
    "an exception on a span with status $name: one dot, named '$dotName'",
    async (statusCase: SpanStatusCase) => {
      await renderInstances([
        { ...SPAN_EXCEPTION, spanStatusCode: statusCase.spanStatusCode },
      ]);

      const dots: Array<HTMLElement> = within(
        spanCellOf("upstream timed out after 30s"),
      ).getAllByRole("img");
      expect(dots).toHaveLength(1);
      expect(dots[0]).toHaveAccessibleName(statusCase.dotName);
      expect(dots[0]!.style.backgroundColor).toBe(statusCase.rgb);
    },
  );

  test.each(LOG_SHAPES)(
    "an exception taken from $name renders nothing in the Span column",
    async (shape: LogShape) => {
      await renderInstances([shape.row]);

      const cell: HTMLElement = spanCellOf("KeyError: 'customer_id'");
      expect(within(cell).queryByRole("img")).not.toBeInTheDocument();
      expect(within(cell).queryByRole("link")).not.toBeInTheDocument();
      expect(cell.textContent).toBe("");
      expect(statusDotNames()).toEqual([]);
    },
  );

  test("asks for the span's id and status", async () => {
    await renderInstances([SPAN_EXCEPTION]);

    expect(requestedSelect()).toMatchObject({
      spanId: true,
      spanStatusCode: true,
      traceId: true,
    });
  });
});
