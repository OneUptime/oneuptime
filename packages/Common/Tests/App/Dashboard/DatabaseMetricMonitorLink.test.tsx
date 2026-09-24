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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * "Create monitor" on a database's in-place metric chart. The monitor it
 * seeds must be scoped by the database's id (oneuptime.database.server.id —
 * the filter that scopes it AND links what it opens to the database), keep
 * a catalog tile's own pins and the chart's aggregation, and travel to
 * Monitor Create in the metric explorer's URL schema. It is refused, with
 * the reason on screen, for a metric no such monitor could watch: a
 * cumulative counter (the monitor path has no rate) and a metric that does
 * not carry the database's id (applications' db.client.* metrics, the pods'
 * CPU). Whether a metric carries the id costs one one-row lookup.
 */

const chartCardMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const getListAnalyticsMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ChartCard",
  () => {
    return {
      __esModule: true,
      default: (props: { title: string }) => {
        chartCardMock(props);
        return <div data-testid="chart-card">{props.title}</div>;
      },
    };
  },
);

// The arrow wrappers are load bearing: jest.mock is hoisted above the mocks.
jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListAnalyticsMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/Modal/Modal", () => {
  return {
    __esModule: true,
    ModalWidth: { Normal: 0, Medium: 1, Large: 2 },
    default: (props: {
      title: string;
      children?: React.ReactNode;
      onClose?: () => void;
    }) => {
      return (
        <section role="dialog" aria-label={props.title}>
          {props.children}
          <button onClick={props.onClose}>Close</button>
        </section>
      );
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: (props: { value?: { range?: string } }) => {
        return (
          <div data-testid="time-range-picker">{props.value?.range || ""}</div>
        );
      },
    };
  },
);

import DatabaseMetricChartModal from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseMetricChartModal";
import {
  DATABASE_METRIC_MONITOR_NOT_LINKED_BLOCKER,
  DATABASE_METRIC_MONITOR_RATE_BLOCKER,
  buildDatabaseMetricMonitorRoute,
  buildDatabaseMetricMonitorViewData,
  fetchDatabaseMetricCarriesServerId,
  getDatabaseMetricMonitorBlocker,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseMetricMonitorLink";
import {
  DatabaseMetricChartSpec,
  getDatabaseMetricChartSpec,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries";
import { buildQueryConfigsFromSerializedQueries } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricConfigReconstruct";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import MetricExplorerUrl, {
  SerializedMetricQuery,
} from "../../../Utils/Metrics/MetricExplorerUrl";

const DATABASE_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const ID_ATTRIBUTE: string = "oneuptime.database.server.id";
const KEY: string = "0123456789abcdef";
const START: Date = new Date("2026-09-24T10:00:00.000Z");
const END: Date = new Date("2026-09-24T11:00:00.000Z");

interface ListCall {
  query: Record<string, unknown>;
  limit: number;
  select: Record<string, unknown>;
}

function listCalls(): Array<ListCall> {
  return getListAnalyticsMock.mock.calls.map(
    (call: Array<unknown>): ListCall => {
      return call[0] as ListCall;
    },
  );
}

function idChecks(): Array<ListCall> {
  return listCalls().filter((call: ListCall): boolean => {
    const attributes: Record<string, unknown> | undefined = call.query[
      "attributes"
    ] as Record<string, unknown> | undefined;
    return Boolean(attributes && attributes[ID_ATTRIBUTE]);
  });
}

/*
 * The Metric table as the modal reads it: the id check (a query filtering
 * the id attribute) answers `carriesId`, the shape lookup answers `shape`.
 */
function useMetricTable(data: {
  shape?: Record<string, unknown>;
  carriesId: boolean | "fail";
}): void {
  getListAnalyticsMock.mockImplementation(async (args: unknown) => {
    const query: Record<string, unknown> = (args as ListCall).query;
    const attributes: Record<string, unknown> | undefined = query[
      "attributes"
    ] as Record<string, unknown> | undefined;
    if (attributes && attributes[ID_ATTRIBUTE]) {
      if (data.carriesId === "fail") {
        throw new Error("ClickHouse is down");
      }
      return data.carriesId
        ? { data: [{ time: START }], count: 1 }
        : { data: [], count: 0 };
    }
    return data.shape
      ? { data: [data.shape], count: 1 }
      : { data: [], count: 0 };
  });
}

function renderChart(data: {
  metricName: string;
  dbSystem?: string;
  unit?: string;
  databaseServerId?: string | null;
}): void {
  render(
    <MemoryRouter>
      <DatabaseMetricChartModal
        metricName={data.metricName}
        unit={data.unit}
        keys={[KEY]}
        projectId={PROJECT_ID}
        dbSystem={data.dbSystem || "postgresql"}
        databaseServerId={
          data.databaseServerId === undefined
            ? new ObjectID(DATABASE_ID)
            : data.databaseServerId
        }
        initialTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        onClose={(): void => {}}
      />
    </MemoryRouter>,
  );
}

async function monitorLink(): Promise<HTMLElement> {
  return await screen.findByRole("link", { name: "Create monitor" });
}

function seededQueries(href: string): Array<SerializedMetricQuery> {
  const search: URLSearchParams = new URLSearchParams(href.split("?")[1] || "");
  return MetricExplorerUrl.parseMetricQueriesParam(
    search.get("metricQueries") || "",
  );
}

beforeEach(() => {
  chartCardMock.mockReset();
  aggregateMock.mockReset();
  getListAnalyticsMock.mockReset();
  aggregateMock.mockResolvedValue({ data: [] });
  goTo(`/dashboard/${PROJECT_ID}/databases/${DATABASE_ID}/metrics`);
});

afterEach(() => {
  cleanup();
});

describe("Create monitor on the database metric chart", () => {
  test("a curated gauge opens Monitor Create with a query scoped by the database's id", async () => {
    useMetricTable({ carriesId: true });

    renderChart({ metricName: "postgresql.backends" });

    const link: HTMLElement = await monitorLink();
    const href: string = link.getAttribute("href") || "";
    expect(href.startsWith(`/dashboard/${PROJECT_ID}/monitors/create?`)).toBe(
      true,
    );

    expect(seededQueries(href)).toEqual([
      expect.objectContaining({
        metricName: "postgresql.backends",
        variable: "a",
        attributes: { [ID_ATTRIBUTE]: DATABASE_ID },
        aggregationType: AggregationType.Avg,
      }),
    ]);
    const search: URLSearchParams = new URLSearchParams(href.split("?")[1]);
    expect(search.get("startTime")).toBeTruthy();
    expect(search.get("endTime")).toBeTruthy();
    expect(search.get("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(
      screen.queryByTestId("database-metric-monitor-blocker"),
    ).not.toBeInTheDocument();

    // One one-row lookup: this metric, under the keys, with the id.
    expect(idChecks()).toHaveLength(1);
    const check: ListCall = idChecks()[0]!;
    expect(check.limit).toBe(1);
    expect(check.query["name"]).toBe("postgresql.backends");
    expect((check.query["entityKeys"] as Includes).values).toEqual([KEY]);
    expect(check.query["attributes"]).toEqual({ [ID_ATTRIBUTE]: DATABASE_ID });
    expect(Object.keys(check.select)).toEqual(["time"]);
  });

  test("a pinned catalog tile keeps its pin next to the id", async () => {
    useMetricTable({ carriesId: true });

    renderChart({ metricName: "mysql.threads", dbSystem: "mysql" });

    const href: string = (await monitorLink()).getAttribute("href") || "";
    expect(seededQueries(href)[0]!.attributes).toEqual({
      kind: "connected",
      [ID_ATTRIBUTE]: DATABASE_ID,
    });
  });

  test("the picked aggregation is the monitor's", async () => {
    useMetricTable({
      shape: { metricPointType: "Gauge", isMonotonic: false },
      carriesId: true,
    });

    renderChart({ metricName: "postgresql.temp_files", unit: "{file}" });
    await monitorLink();

    fireEvent.click(
      within(screen.getByRole("group", { name: "Aggregation" })).getByRole(
        "button",
        { name: "Max" },
      ),
    );

    await waitFor(() => {
      const href: string =
        screen
          .getByRole("link", { name: "Create monitor" })
          .getAttribute("href") || "";
      expect(seededQueries(href)[0]!.aggregationType).toBe(AggregationType.Max);
    });
  });

  test("a curated counter is refused, says why, and costs no lookup", async () => {
    useMetricTable({ carriesId: true });

    renderChart({ metricName: "postgresql.commits" });

    const button: HTMLElement = await screen.findByRole("button", {
      name: "Create monitor",
    });
    expect(button).toBeDisabled();
    expect(
      screen.queryByRole("link", { name: "Create monitor" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("database-metric-monitor-blocker"),
    ).toHaveTextContent("cannot compute a per-second rate");
    expect(button).toHaveAttribute(
      "aria-describedby",
      "database-metric-monitor-blocker",
    );
    expect(idChecks()).toHaveLength(0);
  });

  test("a cumulative counter outside the catalog is refused too", async () => {
    useMetricTable({
      shape: {
        metricPointType: "Sum",
        isMonotonic: true,
        aggregationTemporality: "Cumulative",
      },
      carriesId: true,
    });

    renderChart({ metricName: "postgresql.deadlocks", unit: "1" });

    await waitFor(() => {
      expect(
        screen.getByTestId("database-metric-monitor-blocker"),
      ).toHaveTextContent(DATABASE_METRIC_MONITOR_RATE_BLOCKER);
    });
    expect(
      screen.getByRole("button", { name: "Create monitor" }),
    ).toBeDisabled();
    expect(idChecks()).toHaveLength(0);
  });

  test("a metric that does not carry the database's id is refused: the monitor would watch nothing", async () => {
    useMetricTable({
      shape: { metricPointType: "Gauge", isMonotonic: false },
      carriesId: false,
    });

    renderChart({
      metricName: "db.client.connection.count",
      unit: "{connection}",
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("database-metric-monitor-blocker"),
      ).toHaveTextContent("does not carry this database's id");
    });
    expect(
      screen.getByRole("button", { name: "Create monitor" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("link", { name: "Create monitor" }),
    ).not.toBeInTheDocument();
  });

  test("a failed id lookup is not held against the metric", async () => {
    useMetricTable({ carriesId: "fail" });

    renderChart({ metricName: "postgresql.backends" });

    expect(await monitorLink()).toBeInTheDocument();
    expect(
      screen.queryByTestId("database-metric-monitor-blocker"),
    ).not.toBeInTheDocument();
  });

  test("while the id lookup runs the button waits, disabled", async () => {
    getListAnalyticsMock.mockReturnValue(new Promise(() => {}));

    renderChart({ metricName: "postgresql.backends" });

    const button: HTMLElement = await screen.findByRole("button", {
      name: "Create monitor",
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "title",
      "Checking whether this metric carries this database's id…",
    );
    expect(
      screen.queryByTestId("database-metric-monitor-blocker"),
    ).not.toBeInTheDocument();
  });

  test("without a database id there is no button and no lookup", async () => {
    useMetricTable({ carriesId: true });

    renderChart({ metricName: "postgresql.backends", databaseServerId: null });

    await waitFor(() => {
      expect(chartCardMock).toHaveBeenCalled();
    });
    expect(
      screen.queryByRole("link", { name: "Create monitor" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create monitor" }),
    ).not.toBeInTheDocument();
    expect(idChecks()).toHaveLength(0);
  });
});

describe("DatabaseMetricMonitorLink helpers", () => {
  const gauge: DatabaseMetricChartSpec = getDatabaseMetricChartSpec(
    "postgresql.backends",
    "postgresql",
  );

  test("the blocker: a rate always, an unlinked metric only when known", () => {
    expect(
      getDatabaseMetricMonitorBlocker({
        spec: { isRate: true },
        carriesServerId: true,
      }),
    ).toBe(DATABASE_METRIC_MONITOR_RATE_BLOCKER);
    expect(
      getDatabaseMetricMonitorBlocker({
        spec: { isRate: false },
        carriesServerId: false,
      }),
    ).toBe(DATABASE_METRIC_MONITOR_NOT_LINKED_BLOCKER);
    expect(
      getDatabaseMetricMonitorBlocker({
        spec: { isRate: false },
        carriesServerId: null,
      }),
    ).toBeNull();
    expect(
      getDatabaseMetricMonitorBlocker({
        spec: { isRate: false },
        carriesServerId: true,
      }),
    ).toBeNull();
  });

  test("the view: one query 'a', the id filter, the aggregation and the window", () => {
    const view: MetricViewData = buildDatabaseMetricMonitorViewData({
      spec: gauge,
      databaseServerId: new ObjectID(DATABASE_ID),
      aggregationType: AggregationType.Max,
      startAndEndDate: new InBetween<Date>(START, END),
      rangeToken: TimeRange.PAST_ONE_HOUR,
    });

    expect(view.formulaConfigs).toEqual([]);
    expect(view.queryConfigs).toHaveLength(1);
    expect(view.queryConfigs[0]!.metricAliasData?.metricVariable).toBe("a");
    expect(view.queryConfigs[0]!.metricAliasData?.title).toBe("Connections");
    expect(view.queryConfigs[0]!.metricQueryData.filterData).toEqual({
      metricName: "postgresql.backends",
      attributes: { [ID_ATTRIBUTE]: DATABASE_ID },
      aggegationType: AggregationType.Max,
      aggregateBy: {},
    });
    // Ungrouped: every alert reads as "this database".
    expect(view.queryConfigs[0]!.metricQueryData.groupBy).toBeUndefined();
    expect(view.startAndEndDate?.startValue).toEqual(START);
  });

  test("a catalog pin never replaces the id filter", () => {
    const spec: DatabaseMetricChartSpec = getDatabaseMetricChartSpec(
      "mysql.threads",
      "mysql",
    );
    const view: MetricViewData = buildDatabaseMetricMonitorViewData({
      spec: {
        ...spec,
        definition: {
          ...spec.definition!,
          attributes: { [ID_ATTRIBUTE]: "someone-else", kind: "running" },
        },
      },
      databaseServerId: DATABASE_ID,
      aggregationType: AggregationType.Avg,
    });
    expect(
      (
        view.queryConfigs[0]!.metricQueryData.filterData as {
          attributes: Record<string, string>;
        }
      ).attributes,
    ).toEqual({ kind: "running", [ID_ATTRIBUTE]: DATABASE_ID });
  });

  test("the route round-trips through the explorer's URL schema", () => {
    const route: string = buildDatabaseMetricMonitorRoute(
      buildDatabaseMetricMonitorViewData({
        spec: gauge,
        databaseServerId: DATABASE_ID,
        aggregationType: AggregationType.Avg,
        startAndEndDate: new InBetween<Date>(START, END),
        rangeToken: TimeRange.CUSTOM,
      }),
    ).toString();

    expect(route.startsWith(`/dashboard/${PROJECT_ID}/monitors/create?`)).toBe(
      true,
    );
    const search: URLSearchParams = new URLSearchParams(route.split("?")[1]);
    // A custom window travels as the absolute window only.
    expect(search.get("range")).toBeNull();
    expect(new Date(search.get("startTime") || "").getTime()).toBe(
      START.getTime(),
    );
    expect(seededQueries(route)).toEqual([
      expect.objectContaining({
        metricName: "postgresql.backends",
        attributes: { [ID_ATTRIBUTE]: DATABASE_ID },
      }),
    ]);
  });

  test("Monitor Create rebuilds the seeded query with the id filter and aggregation", () => {
    const route: string = buildDatabaseMetricMonitorRoute(
      buildDatabaseMetricMonitorViewData({
        spec: gauge,
        databaseServerId: DATABASE_ID,
        aggregationType: AggregationType.Min,
        startAndEndDate: new InBetween<Date>(START, END),
      }),
    ).toString();

    const rebuilt: Array<MetricQueryConfigData> =
      buildQueryConfigsFromSerializedQueries(seededQueries(route));
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0]!.metricAliasData?.metricVariable).toBe("a");
    expect(rebuilt[0]!.metricQueryData.filterData).toEqual(
      expect.objectContaining({
        metricName: "postgresql.backends",
        attributes: { [ID_ATTRIBUTE]: DATABASE_ID },
        aggegationType: AggregationType.Min,
      }),
    );
  });

  test("the id lookup sends nothing it cannot scope", async () => {
    await expect(
      fetchDatabaseMetricCarriesServerId({
        projectId: PROJECT_ID,
        keys: [KEY],
        start: START,
        end: END,
        metricName: "postgresql.backends",
        databaseServerId: null,
      }),
    ).resolves.toBeNull();
    await expect(
      fetchDatabaseMetricCarriesServerId({
        projectId: PROJECT_ID,
        keys: [],
        start: START,
        end: END,
        metricName: "postgresql.backends",
        databaseServerId: DATABASE_ID,
      }),
    ).resolves.toBeNull();
    expect(getListAnalyticsMock).not.toHaveBeenCalled();
  });
});
