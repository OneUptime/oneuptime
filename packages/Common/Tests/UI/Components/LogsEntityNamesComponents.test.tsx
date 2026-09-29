import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
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
 * Name resolution settles over a few promise hops after the first render;
 * generous bounds keep these from flaking on a loaded CI machine without
 * slowing a healthy run (waitFor returns as soon as the assertion holds).
 */
const SETTLE: { timeout: number } = { timeout: 30000 };
jest.setTimeout(300000);

/*
 * Component-level coverage for the logs viewer's entity naming: the table's
 * Service column, the details header, the facet sidebar rows and the
 * analytics view (top list, table header / cells, timeseries legend). The
 * pure precedence rules are pinned in LogsEntityNames.test.ts; these check
 * each component actually reads them.
 */

const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const ObjectIDActual: any = (
          jest.requireActual("../../../Types/ObjectID") as any
        ).default;
        return new ObjectIDActual("9e1b6b0e-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts") as Record<
    string,
    any
  >;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return React.cloneElement(children, { width: 600, height: 300 });
    },
  };
});

import LogsTable from "../../../UI/Components/LogsViewer/components/LogsTable";
import LogDetailsPanel from "../../../UI/Components/LogsViewer/components/LogDetailsPanel";
import LogsFacetSidebar from "../../../UI/Components/LogsViewer/components/LogsFacetSidebar";
import LogsAnalyticsView, {
  pivotTimeseriesData,
} from "../../../UI/Components/LogsViewer/components/LogsAnalyticsView";
import TelemetryEntityNameResolver, {
  TelemetryEntityNameMap,
} from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import Log from "../../../Models/AnalyticsModels/Log";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import Color from "../../../Types/Color";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import TimeRange from "../../../Types/Time/TimeRange";

const SERVICE_ID: string = "11111111-0000-4000-8000-000000000001";
const RUM_ID: string = "22222222-0000-4000-8000-000000000001";
const RUM_ID_2: string = "22222222-0000-4000-8000-000000000002";
const MISSING_ID: string = "99999999-0000-4000-8000-000000000001";
const HOST_ID: string = "33333333-0000-4000-8000-000000000001";
const CLUSTER_ID: string = "66666666-0000-4000-8000-000000000001";

const makeHost: () => Host = (): Host => {
  const host: Host = new Host();
  host.id = new ObjectID(HOST_ID);
  host.name = "web-1";
  host.hostIdentifier = "ip-10-0-0-1";
  return host;
};

const makeCluster: () => KubernetesCluster = (): KubernetesCluster => {
  const cluster: KubernetesCluster = new KubernetesCluster();
  cluster.id = new ObjectID(CLUSTER_ID);
  cluster.clusterIdentifier = "prod-cluster";
  return cluster;
};

type ModelType = { new (): BaseModel };

const NAME_MAP: TelemetryEntityNameMap = {
  [RUM_ID]: {
    id: RUM_ID,
    name: "checkout-web",
    entityType: ServiceType.RealUserMonitor,
    typeLabel: "RUM Application",
  },
  [SERVICE_ID]: {
    id: SERVICE_ID,
    name: "resolver-service-name",
    entityType: ServiceType.OpenTelemetry,
    typeLabel: "Service",
  },
};

const makeService: () => Service = (): Service => {
  const service: Service = new Service();
  service.id = new ObjectID(SERVICE_ID);
  service.name = "checkout-api";
  service.serviceColor = new Color("#ff0000");
  return service;
};

const makeRum: (id: string, name: string) => RumApplication = (
  id: string,
  name: string,
): RumApplication => {
  const app: RumApplication = new RumApplication();
  app.id = new ObjectID(id);
  app.name = name;
  return app;
};

const makeLog: (primaryEntityId: string, body: string) => Log = (
  primaryEntityId: string,
  body: string,
): Log => {
  const log: Log = new Log();
  log.setColumnValue("_id", `log-${body}`);
  log.primaryEntityId = new ObjectID(primaryEntityId);
  log.body = body;
  log.time = new Date("2026-08-10T10:15:00.000Z");
  log.severityText = LogSeverity.Error;
  return log;
};

beforeEach(() => {
  TelemetryEntityNameResolver.clearCache();
  getListMock.mockReset();
  postMock.mockReset();

  const tables: Map<ModelType, Array<BaseModel>> = new Map<
    ModelType,
    Array<BaseModel>
  >([
    [
      RumApplication,
      [makeRum(RUM_ID, "checkout-web"), makeRum(RUM_ID_2, "marketing-site")],
    ],
  ]);

  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: ModelType; query: Record<string, unknown> } =
      args[0] as { modelType: ModelType; query: Record<string, unknown> };
    const includes: unknown = request.query["_id"];
    const wanted: Array<string> =
      includes instanceof Includes
        ? (includes.values as Array<string>).map((value: string): string => {
            return value.toString();
          })
        : [];
    const data: Array<BaseModel> = (tables.get(request.modelType) || []).filter(
      (row: BaseModel): boolean => {
        return wanted.includes(row.id!.toString());
      },
    );
    return Promise.resolve({ data, count: data.length, skip: 0, limit: 10 });
  });
});

afterEach(() => {
  cleanup();
});

describe("LogsTable Service column", () => {
  const renderTable: (
    logs: Array<Log>,
    entityNameMap?: TelemetryEntityNameMap,
  ) => void = (logs: Array<Log>, entityNameMap?: TelemetryEntityNameMap) => {
    render(
      <LogsTable
        logs={logs}
        serviceMap={{ [SERVICE_ID]: makeService() }}
        entityNameMap={entityNameMap}
        isLoading={false}
        onRowClick={() => {}}
      />,
    );
  };

  test("regression: a RUM application's log shows the app name, with its type in the tooltip", () => {
    renderTable([makeLog(RUM_ID, "page loaded")], NAME_MAP);

    const cell: HTMLElement = screen.getByTitle(
      "RUM Application: checkout-web",
    );
    expect(cell).toHaveTextContent("checkout-web");
    expect(screen.queryByText(RUM_ID)).not.toBeInTheDocument();
  });

  test("a preloaded Service keeps its name, colour and plain tooltip (serviceMap beats the resolver)", () => {
    renderTable([makeLog(SERVICE_ID, "order placed")], NAME_MAP);

    const cell: HTMLElement = screen.getByTitle("checkout-api");
    expect(cell).toHaveTextContent("checkout-api");
    expect(screen.queryByText("resolver-service-name")).not.toBeInTheDocument();

    const dot: HTMLElement = cell.previousElementSibling as HTMLElement;
    expect(dot.style.backgroundColor).toBe("rgb(255, 0, 0)");
  });

  test("an unresolved entity falls back to its id with the neutral colour", () => {
    renderTable([makeLog(MISSING_ID, "mystery")], NAME_MAP);

    const cell: HTMLElement = screen.getByTitle(MISSING_ID);
    const dot: HTMLElement = cell.previousElementSibling as HTMLElement;
    expect(dot.style.backgroundColor).toBe("rgb(148, 163, 184)");
  });

  test("without an entityNameMap the table behaves as before (raw id)", () => {
    renderTable([makeLog(RUM_ID, "page loaded")]);
    expect(screen.getByTitle(RUM_ID)).toHaveTextContent(RUM_ID);
  });

  test("regression: an unhinted log of a preloaded host / cluster shows its name and type from the preloaded maps", () => {
    render(
      <LogsTable
        logs={[makeLog(HOST_ID, "disk full"), makeLog(CLUSTER_ID, "evicted")]}
        serviceMap={{ [SERVICE_ID]: makeService() }}
        resourceEntityMaps={{
          hostMap: { [HOST_ID]: makeHost() },
          kubernetesClusterMap: { [CLUSTER_ID]: makeCluster() },
        }}
        entityNameMap={{}}
        isLoading={false}
        onRowClick={() => {}}
      />,
    );

    expect(screen.getByTitle("Host: web-1")).toHaveTextContent("web-1");
    expect(
      screen.getByTitle("Kubernetes Cluster: prod-cluster"),
    ).toHaveTextContent("prod-cluster");
    expect(screen.queryByText(HOST_ID)).not.toBeInTheDocument();
    expect(screen.queryByText(CLUSTER_ID)).not.toBeInTheDocument();
  });

  test("a log with no primaryEntityId reads 'Unknown'", () => {
    const log: Log = new Log();
    log.body = "orphan";
    renderTable([log], NAME_MAP);
    expect(screen.getByTitle("Unknown")).toBeInTheDocument();
  });
});

describe("LogDetailsPanel header", () => {
  test("names a RUM application and shows its type badge", () => {
    render(
      <LogDetailsPanel
        log={makeLog(RUM_ID, "page loaded")}
        serviceMap={{ [SERVICE_ID]: makeService() }}
        entityNameMap={NAME_MAP}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "checkout-web" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("log-details-entity-type")).toHaveTextContent(
      "RUM Application",
    );
    expect(screen.queryByText(RUM_ID)).not.toBeInTheDocument();
  });

  test("regression: names a preloaded host from its map and badges it 'Host'", () => {
    render(
      <LogDetailsPanel
        log={makeLog(HOST_ID, "disk full")}
        serviceMap={{ [SERVICE_ID]: makeService() }}
        resourceEntityMaps={{ hostMap: { [HOST_ID]: makeHost() } }}
        entityNameMap={{}}
      />,
    );

    expect(screen.getByRole("heading", { name: "web-1" })).toBeInTheDocument();
    expect(screen.getByTestId("log-details-entity-type")).toHaveTextContent(
      "Host",
    );
    expect(screen.queryByText(HOST_ID)).not.toBeInTheDocument();
  });

  test("a preloaded Service shows no type badge", () => {
    render(
      <LogDetailsPanel
        log={makeLog(SERVICE_ID, "order placed")}
        serviceMap={{ [SERVICE_ID]: makeService() }}
        entityNameMap={NAME_MAP}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "checkout-api" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("log-details-entity-type"),
    ).not.toBeInTheDocument();
  });

  test("a Service named only by the resolver gets no redundant 'Service' badge", () => {
    render(
      <LogDetailsPanel
        log={makeLog(SERVICE_ID, "order placed")}
        serviceMap={{}}
        entityNameMap={NAME_MAP}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "resolver-service-name" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("log-details-entity-type"),
    ).not.toBeInTheDocument();
  });

  test("unresolved ids still render (the id), and no id reads 'Unknown service'", () => {
    const { unmount } = render(
      <LogDetailsPanel
        log={makeLog(MISSING_ID, "mystery")}
        serviceMap={{}}
        entityNameMap={NAME_MAP}
      />,
    );
    expect(
      screen.getByRole("heading", { name: MISSING_ID }),
    ).toBeInTheDocument();
    unmount();

    const orphan: Log = new Log();
    orphan.body = "orphan";
    render(<LogDetailsPanel log={orphan} serviceMap={{}} />);
    expect(
      screen.getByRole("heading", { name: "Unknown service" }),
    ).toBeInTheDocument();
  });
});

describe("LogsFacetSidebar resource rows", () => {
  test("rows use server displayName first, then the preloaded map, then resolver names", () => {
    render(
      <LogsFacetSidebar
        facetData={{
          primaryEntityId: [
            { value: SERVICE_ID, count: 5 },
            { value: RUM_ID, count: 3 },
            { value: RUM_ID_2, count: 1, displayName: "server-named" },
            { value: MISSING_ID, count: 1 },
          ],
        }}
        isLoading={false}
        serviceMap={{ [SERVICE_ID]: makeService() }}
        entityNameMap={{
          ...NAME_MAP,
          [RUM_ID_2]: {
            id: RUM_ID_2,
            name: "resolver-loses",
            entityType: ServiceType.RealUserMonitor,
            typeLabel: "RUM Application",
          },
        }}
        onIncludeFilter={() => {}}
        onExcludeFilter={() => {}}
      />,
    );

    expect(screen.getByText("checkout-api")).toBeInTheDocument();
    expect(screen.queryByText("resolver-service-name")).not.toBeInTheDocument();
    expect(screen.getByText("checkout-web")).toBeInTheDocument();
    expect(screen.getByText("server-named")).toBeInTheDocument();
    expect(screen.queryByText("resolver-loses")).not.toBeInTheDocument();
  });

  test("a displayName that only echoes the id (or is blank) does not hide the resolved name", () => {
    render(
      <LogsFacetSidebar
        facetData={{
          primaryEntityId: [
            { value: RUM_ID, count: 3, displayName: RUM_ID },
            { value: RUM_ID_2, count: 1, displayName: "" },
          ],
        }}
        isLoading={false}
        serviceMap={{}}
        entityNameMap={{
          ...NAME_MAP,
          [RUM_ID_2]: {
            id: RUM_ID_2,
            name: "marketing-site",
            entityType: ServiceType.RealUserMonitor,
            typeLabel: "RUM Application",
          },
        }}
        onIncludeFilter={() => {}}
        onExcludeFilter={() => {}}
      />,
    );

    expect(screen.getByText("checkout-web")).toBeInTheDocument();
    expect(screen.getByText("marketing-site")).toBeInTheDocument();
    expect(screen.queryByText(RUM_ID)).not.toBeInTheDocument();
  });

  test("including a resolver-named row still filters by the id", () => {
    const onInclude: MockFunction = getJestMockFunction();
    render(
      <LogsFacetSidebar
        facetData={{ primaryEntityId: [{ value: RUM_ID, count: 3 }] }}
        isLoading={false}
        serviceMap={{}}
        entityNameMap={NAME_MAP}
        onIncludeFilter={onInclude as any}
        onExcludeFilter={() => {}}
      />,
    );

    fireEvent.click(screen.getByTitle("Filter to checkout-web"));
    expect(onInclude).toHaveBeenCalledWith("primaryEntityId", RUM_ID);
  });
});

describe("pivotTimeseriesData", () => {
  test("keeps ids as series keys and exposes names as labels", () => {
    const result: ReturnType<typeof pivotTimeseriesData> = pivotTimeseriesData(
      [
        {
          time: "2026-08-10T10:00:00Z",
          count: 2,
          groupValues: { primaryEntityId: RUM_ID },
        },
        {
          time: "2026-08-10T10:00:00Z",
          count: 3,
          groupValues: { primaryEntityId: SERVICE_ID },
        },
        {
          time: "2026-08-10T10:01:00Z",
          count: 4,
          groupValues: { primaryEntityId: RUM_ID },
        },
      ],
      NAME_MAP,
    );

    expect(result.seriesKeys).toEqual([RUM_ID, SERVICE_ID]);
    expect(result.seriesLabels).toEqual({
      [RUM_ID]: "checkout-web",
      [SERVICE_ID]: "resolver-service-name",
    });
    expect(result.pivotedData).toEqual([
      { time: "2026-08-10T10:00:00Z", [RUM_ID]: 2, [SERVICE_ID]: 3 },
      { time: "2026-08-10T10:01:00Z", [RUM_ID]: 4 },
    ]);
  });

  test("two entities sharing a name stay two series", () => {
    const result: ReturnType<typeof pivotTimeseriesData> = pivotTimeseriesData(
      [
        { time: "t", count: 1, groupValues: { primaryEntityId: RUM_ID } },
        { time: "t", count: 1, groupValues: { primaryEntityId: RUM_ID_2 } },
      ],
      {
        [RUM_ID]: { ...NAME_MAP[RUM_ID]!, name: "web" },
        [RUM_ID_2]: { ...NAME_MAP[RUM_ID]!, id: RUM_ID_2, name: "web" },
      },
    );
    expect(result.seriesKeys).toHaveLength(2);
  });

  test("ungrouped rows use the 'count' series, and non-entity values are unchanged", () => {
    expect(
      pivotTimeseriesData([{ time: "t", count: 1, groupValues: {} }]),
    ).toEqual({
      pivotedData: [{ time: "t", count: 1 }],
      seriesKeys: ["count"],
      seriesLabels: { count: "count" },
    });

    expect(
      pivotTimeseriesData(
        [{ time: "t", count: 1, groupValues: { severityText: "Error" } }],
        NAME_MAP,
      ).seriesLabels,
    ).toEqual({ Error: "Error" });
  });
});

describe("LogsAnalyticsView entity group-by", () => {
  type AnalyticsRequestBody = {
    chartType: string;
    groupBy?: Array<string>;
  };

  beforeEach(() => {
    postMock.mockImplementation((...args: Array<unknown>) => {
      const body: AnalyticsRequestBody = (
        args[0] as { data: AnalyticsRequestBody }
      ).data;
      const groupBy: Array<string> = body.groupBy || [];
      const byEntity: boolean = groupBy[0] === "primaryEntityId";

      if (body.chartType === "toplist") {
        return Promise.resolve({
          data: {
            data: byEntity
              ? [
                  { value: RUM_ID, count: 10 },
                  { value: MISSING_ID, count: 2 },
                ]
              : [{ value: "Error", count: 12 }],
          },
        });
      }

      if (body.chartType === "table") {
        return Promise.resolve({
          data: {
            data: byEntity
              ? [
                  { groupValues: { primaryEntityId: RUM_ID }, count: 10 },
                  { groupValues: { primaryEntityId: RUM_ID_2 }, count: 4 },
                ]
              : [{ groupValues: { severityText: "Error" }, count: 12 }],
          },
        });
      }

      return Promise.resolve({
        data: {
          data: byEntity
            ? [
                {
                  time: "2026-08-10T10:00:00Z",
                  count: 3,
                  groupValues: { primaryEntityId: RUM_ID },
                },
                {
                  time: "2026-08-10T10:00:00Z",
                  count: 1,
                  groupValues: { primaryEntityId: RUM_ID_2 },
                },
              ]
            : [
                {
                  time: "2026-08-10T10:00:00Z",
                  count: 3,
                  groupValues: { severityText: "Error" },
                },
              ],
        },
      });
    });
  });

  const renderView: () => void = (): void => {
    render(
      <LogsAnalyticsView
        timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        appliedFacetFilters={new Map()}
        logAttributes={[]}
      />,
    );
  };

  const pickSelect: (currentLabel: string, value: string) => void = (
    currentLabel: string,
    value: string,
  ): void => {
    fireEvent.change(screen.getByDisplayValue(currentLabel), {
      target: { value },
    });
  };

  test("the top list names entity values and leaves unresolved ids readable", async () => {
    renderView();
    pickSelect("Timeseries", "toplist");
    pickSelect("Severity", "primaryEntityId");

    await waitFor(() => {
      expect(screen.getByText("checkout-web")).toBeInTheDocument();
    }, SETTLE);
    expect(screen.getByText(MISSING_ID)).toBeInTheDocument();
    expect(screen.queryByText(RUM_ID)).not.toBeInTheDocument();
  });

  test("the table header is friendly and cells are named", async () => {
    renderView();
    pickSelect("Timeseries", "table");

    // Severity grouping: friendly header, not the raw column name.
    await waitFor(() => {
      expect(
        screen.getByRole("columnheader", { name: "Severity" }),
      ).toBeInTheDocument();
    }, SETTLE);
    expect(
      screen.queryByRole("columnheader", { name: "severityText" }),
    ).not.toBeInTheDocument();

    pickSelect("Severity", "primaryEntityId");

    await waitFor(() => {
      expect(screen.getByText("marketing-site")).toBeInTheDocument();
    }, SETTLE);
    const table: HTMLElement = screen.getByRole("table");
    expect(within(table).getByText("checkout-web")).toBeInTheDocument();
    // Every value is a RUM application, so the header says so.
    expect(
      within(table).getByRole("columnheader", { name: "RUM Application" }),
    ).toBeInTheDocument();
    expect(
      within(table).queryByRole("columnheader", { name: "primaryEntityId" }),
    ).not.toBeInTheDocument();
    expect(within(table).queryByText(RUM_ID)).not.toBeInTheDocument();
  });

  test("the timeseries legend names each entity series", async () => {
    renderView();
    pickSelect("Severity", "primaryEntityId");

    await waitFor(() => {
      expect(screen.getByText("checkout-web")).toBeInTheDocument();
    }, SETTLE);
    expect(screen.getByText("marketing-site")).toBeInTheDocument();
    expect(screen.queryByText(RUM_ID_2)).not.toBeInTheDocument();
  });

  test("entity ids are resolved in one request and only for entity dimensions", async () => {
    renderView();
    pickSelect("Timeseries", "toplist");

    await waitFor(() => {
      expect(screen.getByText("Error")).toBeInTheDocument();
    }, SETTLE);
    expect(getListMock).not.toHaveBeenCalled();
  });
});
