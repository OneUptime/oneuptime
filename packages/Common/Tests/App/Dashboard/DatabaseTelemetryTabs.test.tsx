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
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A database's Logs, Traces and Metrics tabs, rendered for real with the
 * viewers replaced by markers. What they must get right:
 *
 *   - the viewer is scoped by EXACTLY the database's key set — its row key
 *     (telemetry sent with its id), its endpoint keys and its member keys —
 *     and nothing else;
 *   - a loaded row always has its row key, so a database with no endpoint
 *     and no members still mounts the viewer, scoped by that key alone, with
 *     an "id only" hint above it;
 *   - a source with no key at all (no project to hash the keys with) renders
 *     the "no telemetry scope" banner and never mounts a viewer (an
 *     unscoped viewer shows the whole project);
 *   - each key's locked chip is named (database / endpoint / instance), not
 *     a hash;
 *   - loading, lookup errors and a missing row render their own states.
 */

const MODEL_ID_STRING: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const PROJECT_ID_STRING: string = "10000000-0000-4000-8000-000000000001";

// What ProjectUtil.getCurrentProjectId returns; null for "no project".
let mockCurrentProjectId: string | null = PROJECT_ID_STRING;

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const logsViewerMock: MockFunction = getJestMockFunction();
const tracesViewerMock: MockFunction = getJestMockFunction();
const metricsViewerMock: MockFunction = getJestMockFunction();
const metricChartMock: MockFunction = getJestMockFunction();

// The arrow wrappers are load bearing: jest.mock is hoisted above the mocks.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return (
          ((error as { message?: unknown } | null)?.message as string) ||
          "Could not load"
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return mockCurrentProjectId
          ? new ObjectIDType(mockCurrentProjectId)
          : null;
      },
    },
  };
});

jest.mock("../../../UI/Components/Loader/PageLoader", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="page-loader" />;
    },
  };
});

jest.mock("../../../UI/Components/ErrorMessage/ErrorMessage", () => {
  return {
    __esModule: true,
    default: (props: { message: string }) => {
      return <div data-testid="error-message">{props.message}</div>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseServerUnscopedBanner",
  () => {
    return {
      __esModule: true,
      default: (props: { signal?: string; variant?: string }) => {
        return (
          <div
            data-testid="database-unscoped-banner"
            data-variant={props.variant || "unscoped"}
          >
            {props.signal || ""}
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        logsViewerMock(props);
        return <div data-testid="logs-viewer" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        tracesViewerMock(props);
        return <div data-testid="traces-viewer" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsViewer",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        metricsViewerMock(props);
        return <div data-testid="metrics-viewer" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseMetricChartModal",
  () => {
    return {
      __esModule: true,
      default: (props: { metricName: string; onClose: () => void }) => {
        metricChartMock(props);
        return (
          <div data-testid="database-metric-chart-modal">
            {props.metricName}
            <button onClick={props.onClose}>Close chart</button>
          </div>
        );
      },
    };
  },
);

import DatabaseServerLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Logs";
import DatabaseServerMetrics, {
  DATABASE_METRIC_LIST_DEFAULT_CAPTION,
  toMetricRowValueOverrides,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Metrics";
import { MetricRowValueOverrideMap } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricRowScope";
import { DatabaseMetricListValue } from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries";
import {
  DatabaseServerMetricDefinition,
  findDatabaseServerMetricByName,
} from "../../../Types/DatabaseServer/DatabaseServerMetricCatalog";
import DatabaseServerTraces from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Traces";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "../../../Models/DatabaseModels/DatabaseServerEndpoint";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import Includes from "../../../Types/BaseDatabase/Includes";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  keyForDatabaseEndpoint,
  keyForDatabaseServerRow,
  keyForKubernetesPod,
} from "../../../Utils/Telemetry/EntityKey";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/test/databases/test"),
  currentProject: null,
  hasPaymentMethod: true,
};

// Telemetry sent with this database's id (oneuptime.database.server.id).
const ROW_KEY: string = keyForDatabaseServerRow(
  PROJECT_ID_STRING,
  MODEL_ID_STRING,
);

const POD_KEY: string = keyForKubernetesPod(PROJECT_ID_STRING, {
  clusterName: "prod",
  namespace: "payments",
  podName: "postgres-0",
});

const ENDPOINT_KEY: string = keyForDatabaseEndpoint(PROJECT_ID_STRING, {
  host: "db.prod.internal",
  port: 5432,
});

function databaseServer(data: {
  memberEntityKeys?: Record<string, string> | undefined;
  withoutProject?: boolean | undefined;
}): DatabaseServer {
  const item: DatabaseServer = new DatabaseServer();
  item.id = new ObjectID(MODEL_ID_STRING);
  item.name = "PostgreSQL db.prod.internal:5432";
  if (!data.withoutProject) {
    item.projectId = new ObjectID(PROJECT_ID_STRING);
  }
  item.dbSystem = "postgresql";
  if (data.memberEntityKeys) {
    item.memberEntityKeys = data.memberEntityKeys;
  }
  return item;
}

function endpointRows(values: Array<string>): {
  data: Array<DatabaseServerEndpoint>;
  count: number;
} {
  return {
    data: values.map((value: string): DatabaseServerEndpoint => {
      const row: DatabaseServerEndpoint = new DatabaseServerEndpoint();
      row.endpoint = value;
      return row;
    }),
    count: values.length,
  };
}

type ViewerProps = Record<string, unknown>;

function lastProps(mock: MockFunction): ViewerProps {
  const calls: Array<Array<unknown>> = mock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as ViewerProps;
}

interface TabCase {
  Page: React.FunctionComponent<PageComponentProps>;
  viewerTestId: string;
  viewerMock: MockFunction;
  signal: string;
}

const TABS: Array<[string, TabCase]> = [
  [
    "Logs",
    {
      Page: DatabaseServerLogs,
      viewerTestId: "logs-viewer",
      viewerMock: logsViewerMock,
      signal: "logs",
    },
  ],
  [
    "Traces",
    {
      Page: DatabaseServerTraces,
      viewerTestId: "traces-viewer",
      viewerMock: tracesViewerMock,
      signal: "traces",
    },
  ],
  [
    "Metrics",
    {
      Page: DatabaseServerMetrics,
      viewerTestId: "metrics-viewer",
      viewerMock: metricsViewerMock,
      signal: "metrics",
    },
  ],
];

/*
 * The scope a viewer received, whichever prop carries it: Logs puts the keys
 * in its log query, Traces and Metrics take them as entityKeysFilter.
 */
function scopedKeys(tab: string, props: ViewerProps): Array<string> {
  if (tab === "Logs") {
    const query: Record<string, unknown> = props["logQuery"] as Record<
      string,
      unknown
    >;
    expect(Object.keys(query)).toEqual(["entityKeys"]);
    expect(query["entityKeys"]).toBeInstanceOf(Includes);
    return (query["entityKeys"] as Includes).values as Array<string>;
  }
  expect(props["attributeFilters"]).toBeUndefined();
  return props["entityKeysFilter"] as Array<string>;
}

beforeEach(() => {
  mockCurrentProjectId = PROJECT_ID_STRING;
  getItemMock.mockReset();
  getListMock.mockReset();
  logsViewerMock.mockReset();
  tracesViewerMock.mockReset();
  metricsViewerMock.mockReset();
  metricChartMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe.each(TABS)("the database %s tab", (tab: string, tabCase: TabCase) => {
  test("scopes the viewer by the row, endpoint and member keys, and nothing else", async () => {
    getItemMock.mockResolvedValue(
      databaseServer({
        memberEntityKeys: { [POD_KEY]: "2026-09-23T10:00:00.000Z" },
      }),
    );
    getListMock.mockResolvedValue(endpointRows(["db.prod.internal:5432"]));

    render(<tabCase.Page {...PAGE_PROPS} />);
    await screen.findByTestId(tabCase.viewerTestId);

    expect(screen.getAllByTestId(tabCase.viewerTestId)).toHaveLength(1);
    // Scoped by an endpoint too: no "id only" hint, no unscoped banner.
    expect(
      screen.queryByTestId("database-unscoped-banner"),
    ).not.toBeInTheDocument();

    const props: ViewerProps = lastProps(tabCase.viewerMock);
    expect(scopedKeys(tab, props)).toEqual([ROW_KEY, ENDPOINT_KEY, POD_KEY]);
  });

  test("the row key is first even for a database with an endpoint only", async () => {
    getItemMock.mockResolvedValue(databaseServer({}));
    getListMock.mockResolvedValue(endpointRows(["db.prod.internal:5432"]));

    render(<tabCase.Page {...PAGE_PROPS} />);
    await screen.findByTestId(tabCase.viewerTestId);

    expect(scopedKeys(tab, lastProps(tabCase.viewerMock))).toEqual([
      ROW_KEY,
      ENDPOINT_KEY,
    ]);
    expect(
      screen.queryByTestId("database-unscoped-banner"),
    ).not.toBeInTheDocument();
  });

  test("names every key's locked chip", async () => {
    getItemMock.mockResolvedValue(
      databaseServer({
        memberEntityKeys: { [POD_KEY]: "2026-09-23T10:00:00.000Z" },
      }),
    );
    getListMock.mockResolvedValue(endpointRows(["db.prod.internal:5432"]));

    render(<tabCase.Page {...PAGE_PROPS} />);
    await screen.findByTestId(tabCase.viewerTestId);

    const displays: Record<
      string,
      { displayKey: string; displayValue: string }
    > = lastProps(tabCase.viewerMock)["entityKeyDisplays"] as Record<
      string,
      { displayKey: string; displayValue: string }
    >;

    expect(displays[ROW_KEY]).toEqual({
      displayKey: "Database",
      displayValue: "PostgreSQL db.prod.internal:5432",
    });
    expect(displays[ENDPOINT_KEY]).toEqual({
      displayKey: "Database Endpoint",
      displayValue: "db.prod.internal:5432",
    });
    expect(displays[POD_KEY]!.displayKey).toBe("Database Instance");
    expect(displays[POD_KEY]!.displayValue).toContain(
      "PostgreSQL db.prod.internal:5432",
    );
  });

  test("reads the endpoints of THIS database", async () => {
    getItemMock.mockResolvedValue(databaseServer({}));
    getListMock.mockResolvedValue(endpointRows(["db.prod.internal:5432"]));

    render(<tabCase.Page {...PAGE_PROPS} />);
    await screen.findByTestId(tabCase.viewerTestId);

    const request: {
      modelType: unknown;
      query: { databaseServerId: ObjectID };
      select: Record<string, unknown>;
    } = getListMock.mock.calls[0]![0] as {
      modelType: unknown;
      query: { databaseServerId: ObjectID };
      select: Record<string, unknown>;
    };
    expect(request.modelType).toBe(DatabaseServerEndpoint);
    expect(request.query.databaseServerId.toString()).toBe(MODEL_ID_STRING);
    expect(request.select["endpoint"]).toBe(true);

    const itemRequest: {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    } = getItemMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    };
    expect(itemRequest.modelType).toBe(DatabaseServer);
    expect(itemRequest.id.toString()).toBe(MODEL_ID_STRING);
    expect(itemRequest.select["memberEntityKeys"]).toBe(true);
  });

  test("a database with no usable endpoint and no members is scoped by its row key, with an 'id only' hint", async () => {
    getItemMock.mockResolvedValue(databaseServer({}));
    // Neither stored value parses to an endpoint key.
    getListMock.mockResolvedValue(
      endpointRows(["localhost:5432", "not a host"]),
    );

    render(<tabCase.Page {...PAGE_PROPS} />);
    await screen.findByTestId(tabCase.viewerTestId);

    // The viewer IS mounted: data sent with the database's id is its own.
    expect(scopedKeys(tab, lastProps(tabCase.viewerMock))).toEqual([ROW_KEY]);

    const hint: HTMLElement = screen.getByTestId("database-unscoped-banner");
    expect(hint).toHaveAttribute("data-variant", "id-only");
    expect(hint).toHaveTextContent(tabCase.signal);
    // The hint sits above the viewer.
    expect(
      hint.compareDocumentPosition(screen.getByTestId(tabCase.viewerTestId)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a source with no key at all shows the unscoped banner and never mounts the viewer", async () => {
    // No project to hash any key with: nothing, not everything.
    mockCurrentProjectId = null;
    getItemMock.mockResolvedValue(databaseServer({ withoutProject: true }));
    getListMock.mockResolvedValue(endpointRows(["db.prod.internal:5432"]));

    render(<tabCase.Page {...PAGE_PROPS} />);
    const banner: HTMLElement = await screen.findByTestId(
      "database-unscoped-banner",
    );

    expect(banner).toHaveAttribute("data-variant", "unscoped");
    expect(banner).toHaveTextContent(tabCase.signal);
    expect(screen.queryByTestId(tabCase.viewerTestId)).not.toBeInTheDocument();
    expect(tabCase.viewerMock).not.toHaveBeenCalled();
  });

  test("a workload-only database (members, no endpoint) is still scoped, with no hint", async () => {
    getItemMock.mockResolvedValue(
      databaseServer({
        memberEntityKeys: { [POD_KEY]: "2026-09-23T10:00:00.000Z" },
      }),
    );
    getListMock.mockResolvedValue(endpointRows([]));

    render(<tabCase.Page {...PAGE_PROPS} />);
    await screen.findByTestId(tabCase.viewerTestId);

    expect(scopedKeys(tab, lastProps(tabCase.viewerMock))).toEqual([
      ROW_KEY,
      POD_KEY,
    ]);
    expect(
      screen.queryByTestId("database-unscoped-banner"),
    ).not.toBeInTheDocument();
  });

  test("shows the loader while loading", () => {
    getItemMock.mockReturnValue(new Promise(() => {}));
    getListMock.mockReturnValue(new Promise(() => {}));

    render(<tabCase.Page {...PAGE_PROPS} />);

    expect(screen.getByTestId("page-loader")).toBeInTheDocument();
    expect(tabCase.viewerMock).not.toHaveBeenCalled();
  });

  test("a lookup failure shows the error, not a viewer", async () => {
    getItemMock.mockRejectedValue(new Error("Database lookup failed"));
    getListMock.mockResolvedValue(endpointRows(["db.prod.internal:5432"]));

    render(<tabCase.Page {...PAGE_PROPS} />);

    expect(await screen.findByTestId("error-message")).toHaveTextContent(
      "Database lookup failed",
    );
    expect(tabCase.viewerMock).not.toHaveBeenCalled();
  });

  test("a missing database says so", async () => {
    getItemMock.mockResolvedValue(null);
    getListMock.mockResolvedValue(endpointRows([]));

    render(<tabCase.Page {...PAGE_PROPS} />);

    expect(await screen.findByTestId("error-message")).toHaveTextContent(
      "Database not found.",
    );
    expect(tabCase.viewerMock).not.toHaveBeenCalled();
  });

  /*
   * E2E: a random UUID on /metrics rendered the tab scoped by that id's row
   * key. The API answers an unknown or deleted id with `{}`, which
   * ModelAPI.getItem turns into an EMPTY model — never null.
   */
  test("a deleted database (the API's `{}`, an empty model) says so", async () => {
    getItemMock.mockResolvedValue(new DatabaseServer());
    getListMock.mockResolvedValue(endpointRows([]));

    render(<tabCase.Page {...PAGE_PROPS} />);

    expect(await screen.findByTestId("error-message")).toHaveTextContent(
      "Database not found.",
    );
    expect(tabCase.viewerMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("database-unscoped-banner"),
    ).not.toBeInTheDocument();
  });
});

describe("the database Logs tab", () => {
  test("keeps its viewer id, filter bar, live tail and empty state", async () => {
    getItemMock.mockResolvedValue(databaseServer({}));
    getListMock.mockResolvedValue(endpointRows(["db.prod.internal:5432"]));

    render(<DatabaseServerLogs {...PAGE_PROPS} />);
    await screen.findByTestId("logs-viewer");

    const props: ViewerProps = lastProps(logsViewerMock);
    expect(props["id"]).toBe(`database-server-logs-${MODEL_ID_STRING}`);
    expect(props["showFilters"]).toBe(true);
    expect(props["enableRealtime"]).toBe(true);
    expect(props["noLogsMessage"]).toBe("No logs found for this database.");
  });
});

/*
 * A metric row opens the metric explorer by default, which scopes by
 * attributes only and would chart the metric across the whole project. The
 * Metrics tab takes the click instead and charts the metric in place, over
 * the same key set the list is scoped by.
 */
describe("the database Metrics tab's row click", () => {
  function clickMetric(name: string): void {
    const onMetricClick: (metric: MetricType) => void = lastProps(
      metricsViewerMock,
    )["onMetricClick"] as (metric: MetricType) => void;
    const metric: MetricType = new MetricType();
    metric.name = name;
    act(() => {
      onMetricClick(metric);
    });
  }

  test("takes the click instead of opening the explorer", async () => {
    getItemMock.mockResolvedValue(databaseServer({}));
    getListMock.mockResolvedValue(endpointRows(["db.prod.internal:5432"]));

    render(<DatabaseServerMetrics {...PAGE_PROPS} />);
    await screen.findByTestId("metrics-viewer");

    const props: ViewerProps = lastProps(metricsViewerMock);
    expect(typeof props["onMetricClick"]).toBe("function");
    expect(props["disableMetricDrillDown"]).toBeUndefined();
    expect(
      screen.queryByTestId("database-metric-chart-modal"),
    ).not.toBeInTheDocument();
  });

  test("charts the clicked metric in place over the same key set", async () => {
    getItemMock.mockResolvedValue(
      databaseServer({
        memberEntityKeys: { [POD_KEY]: "2026-09-23T10:00:00.000Z" },
      }),
    );
    getListMock.mockResolvedValue(endpointRows(["db.prod.internal:5432"]));

    render(<DatabaseServerMetrics {...PAGE_PROPS} />);
    await screen.findByTestId("metrics-viewer");

    clickMetric("postgresql.backends");

    expect(screen.getByTestId("database-metric-chart-modal")).toHaveTextContent(
      "postgresql.backends",
    );
    const chart: ViewerProps = lastProps(metricChartMock);
    expect(chart["keys"]).toEqual([ROW_KEY, ENDPOINT_KEY, POD_KEY]);
    expect(chart["keys"]).toEqual(
      lastProps(metricsViewerMock)["entityKeysFilter"],
    );
    expect(chart["dbSystem"]).toBe("postgresql");
    expect((chart["projectId"] as ObjectID).toString()).toBe(PROJECT_ID_STRING);
    // The chart's "Create monitor" scopes the monitor by this id.
    expect((chart["databaseServerId"] as ObjectID).toString()).toBe(
      MODEL_ID_STRING,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close chart" }));
    expect(
      screen.queryByTestId("database-metric-chart-modal"),
    ).not.toBeInTheDocument();
  });

  test("names the database in the new monitor's description", async () => {
    getItemMock.mockResolvedValue(databaseServer({}));
    getListMock.mockResolvedValue(endpointRows(["db.prod.internal:5432"]));

    render(<DatabaseServerMetrics {...PAGE_PROPS} />);
    await screen.findByTestId("metrics-viewer");

    clickMetric("postgresql.backends");
    expect(lastProps(metricChartMock)["databaseName"]).toBe(
      "PostgreSQL db.prod.internal:5432",
    );
  });
});

/*
 * E2E: pg16's list read `postgresql.backends 4` (the average of its
 * per-database series) beside an Overview showing 8, and counters as raw
 * totals. The tab hands the list the catalog's own values.
 */
describe("the database Metrics tab's list values", () => {
  test("hands the list the catalog's values and labels the rest as averages", async () => {
    getItemMock.mockResolvedValue(databaseServer({}));
    getListMock.mockResolvedValue(endpointRows(["db.prod.internal:5432"]));

    render(<DatabaseServerMetrics {...PAGE_PROPS} />);
    await screen.findByTestId("metrics-viewer");

    const props: ViewerProps = lastProps(metricsViewerMock);
    expect(typeof props["fetchRowValueOverrides"]).toBe("function");
    expect(props["defaultRowValueCaption"]).toBe(
      DATABASE_METRIC_LIST_DEFAULT_CAPTION,
    );
  });

  test("a rate row gets its '/s', a gauge row its caption", () => {
    const backends: DatabaseServerMetricDefinition =
      findDatabaseServerMetricByName("postgresql", "postgresql.backends")!;
    const commits: DatabaseServerMetricDefinition =
      findDatabaseServerMetricByName("postgresql", "postgresql.commits")!;
    const at: Date = new Date("2026-09-25T01:11:00.000Z");
    const values: Map<string, DatabaseMetricListValue> = new Map([
      [
        "postgresql.backends",
        {
          definition: backends,
          points: [{ x: at, y: 19 }],
          value: 19,
          isRate: false,
          caption: "total of series",
        },
      ],
      [
        "postgresql.commits",
        {
          definition: commits,
          points: [{ x: at, y: 2.5 }],
          value: 2.5,
          isRate: true,
          caption: "per second, all series",
        },
      ],
    ]);

    const overrides: MetricRowValueOverrideMap =
      toMetricRowValueOverrides(values);
    expect(overrides.get("postgresql.backends")).toEqual({
      points: [{ time: at.toISOString(), value: 19 }],
      value: 19,
      valueSuffix: undefined,
      caption: "total of series",
    });
    expect(overrides.get("postgresql.commits")!.valueSuffix).toBe("/s");
  });

  /*
   * e2e: MariaDB reports mysql.buffer_pool.limit (declared in bytes) as its
   * page count, and the row read "7.9 KiB" for 8112 pages.
   */
  test("on MariaDB the buffer pool limit's row reads in pages; elsewhere units stand", async () => {
    const mariadb: DatabaseServer = databaseServer({});
    mariadb.dbSystem = "mariadb";
    getItemMock.mockResolvedValue(mariadb);
    getListMock.mockResolvedValue(endpointRows(["db.prod.internal:3306"]));

    render(<DatabaseServerMetrics {...PAGE_PROPS} />);
    await screen.findByTestId("metrics-viewer");

    const getRowValueUnit: (metricName: string) => string | undefined =
      lastProps(metricsViewerMock)["getRowValueUnit"] as (
        metricName: string,
      ) => string | undefined;
    expect(getRowValueUnit("mysql.buffer_pool.limit")).toBe("{pages}");
    expect(getRowValueUnit("mysql.buffer_pool.usage")).toBeUndefined();
    expect(getRowValueUnit("db.client.operation.duration")).toBeUndefined();
  });

  test("a MySQL database's buffer pool limit keeps its bytes", async () => {
    const mysql: DatabaseServer = databaseServer({});
    mysql.dbSystem = "mysql";
    getItemMock.mockResolvedValue(mysql);
    getListMock.mockResolvedValue(endpointRows(["db.prod.internal:3306"]));

    render(<DatabaseServerMetrics {...PAGE_PROPS} />);
    await screen.findByTestId("metrics-viewer");

    const getRowValueUnit: (metricName: string) => string | undefined =
      lastProps(metricsViewerMock)["getRowValueUnit"] as (
        metricName: string,
      ) => string | undefined;
    expect(getRowValueUnit("mysql.buffer_pool.limit")).toBeUndefined();
  });
});
