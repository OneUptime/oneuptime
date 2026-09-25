import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The metric list on a page pinned to entity keys alone (a Database's
 * Metrics tab), against what the end-to-end run saw on pg16 (3df04aa4):
 *
 *   - the `db.client.operation.duration` row named "billing-api,
 *     e2e-orders-app, reports-api, inventory-api +4 more" — every service
 *     that ever reported the metric, project-wide — while ClickHouse had
 *     only e2e-orders-app reporting it for pg16's endpoint. The row now
 *     names the services the key-scoped query itself found;
 *   - `postgresql.backends` read 4 (the average of its per-database series)
 *     beside an Overview showing 8. A host that knows how a metric combines
 *     supplies the row's value, and the list does not fetch its average.
 *
 * Every product without those props keeps its old rows.
 */

const rowProps: Array<Record<string, unknown>> = [];
const metricTypeRows: Array<unknown> = [];
const analyticsGetListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: {
      items: Array<{ name: string }>;
      renderRow: (metric: { name: string }) => React.ReactElement;
    }) => {
      return (
        <div>
          {props.items.map((item: { name: string }) => {
            return (
              <React.Fragment key={item.name}>
                {props.renderRow(item)}
              </React.Fragment>
            );
          })}
        </div>
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricRow",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>) => {
        rowProps.push(props);
        return <div data-testid="row" />;
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({
          data: metricTypeRows,
          count: metricTypeRows.length,
        });
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return analyticsGetListMock(...args);
      },
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: () => {
        return Promise.resolve({ data: { facets: {} } });
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        getTelemetryAttributes: () => {
          return Promise.resolve([]);
        },
        fetchSparklineAggregates: () => {
          return Promise.resolve(new Map());
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return {};
    },
  };
});

import MetricsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsViewer";
import { MetricRowProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricRow";
import {
  MetricRowValueOverrideMap,
  getMetricServiceIdsByName,
  getMetricServicesWithin,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricRowScope";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import Service from "../../../Models/DatabaseModels/Service";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "21075038-d9f1-4d3a-b878-f64ae861f7be",
);
const PG16_KEYS: Array<string> = ["35b0817780236296", "4368de1139c723fd"];
const PG16_ID: string = "3df04aa4-a899-40bb-96f0-e487733aee03";
const ORDERS_APP_ID: string = "fb098730-455f-43a3-8a70-29fcd09e0af5";

const PROJECT_SERVICE_NAMES: Array<[string, string]> = [
  ["11111111-1111-4111-8111-000000000001", "billing-api"],
  [ORDERS_APP_ID, "e2e-orders-app"],
  ["11111111-1111-4111-8111-000000000003", "reports-api"],
  ["11111111-1111-4111-8111-000000000004", "inventory-api"],
  ["11111111-1111-4111-8111-000000000005", "reports-worker"],
  ["11111111-1111-4111-8111-000000000006", "valkey"],
  ["11111111-1111-4111-8111-000000000007", "checkout"],
  ["11111111-1111-4111-8111-000000000008", "payments"],
];

function service(id: string, name: string): Service {
  const item: Service = new Service();
  item.id = new ObjectID(id);
  item.name = name;
  return item;
}

function metricType(name: string, services: Array<Service>): MetricType {
  const item: MetricType = new MetricType();
  item.name = name;
  item.services = services;
  return item;
}

const RealMetricRow: React.FunctionComponent<MetricRowProps> = (
  jest.requireActual(
    "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricRow",
  ) as { default: React.FunctionComponent<MetricRowProps> }
).default;

function lastRowFor(name: string): Record<string, unknown> {
  const rows: Array<Record<string, unknown>> = rowProps.filter(
    (props: Record<string, unknown>): boolean => {
      return (props["metric"] as MetricType).name === name;
    },
  );
  expect(rows.length).toBeGreaterThan(0);
  return rows[rows.length - 1]!;
}

async function renderViewer(
  props: React.ComponentProps<typeof MetricsViewer>,
): Promise<void> {
  await act(async () => {
    render(<MetricsViewer {...props} disableUrlSync={true} />);
  });
  // Let the name lookup, the list and the sparklines settle.
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
  });
}

beforeEach(() => {
  rowProps.length = 0;
  metricTypeRows.length = 0;
  analyticsGetListMock.mockReset();
  aggregateMock.mockReset();
  aggregateMock.mockResolvedValue({
    data: [{ timestamp: new Date("2026-09-25T01:11:00.000Z"), value: 4 }],
  });
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);

  const everyService: Array<Service> = PROJECT_SERVICE_NAMES.map(
    ([id, name]: [string, string]): Service => {
      return service(id, name);
    },
  );
  metricTypeRows.push(
    metricType("db.client.operation.duration", everyService),
    metricType("postgresql.backends", []),
  );
  // GROUP BY name, primaryEntityId under pg16's keys (ClickHouse, 6 h).
  analyticsGetListMock.mockResolvedValue({
    data: [
      { name: "db.client.operation.duration", primaryEntityId: ORDERS_APP_ID },
      { name: "postgresql.backends", primaryEntityId: PG16_ID },
    ],
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("service chips on a list pinned to entity keys", () => {
  test("a row names only the services that reported the metric under the keys", async () => {
    await renderViewer({ entityKeysFilter: PG16_KEYS });

    const request: Record<string, unknown> = analyticsGetListMock.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(request["groupBy"]).toEqual({ name: true, primaryEntityId: true });

    expect(
      lastRowFor("db.client.operation.duration")["restrictServicesToIds"],
    ).toEqual([ORDERS_APP_ID]);
    // Engine metrics are the database's own: no service to name.
    expect(lastRowFor("postgresql.backends")["restrictServicesToIds"]).toEqual([
      PG16_ID,
    ]);
  });

  test("a service-scoped list keeps its own chips and its name-only query", async () => {
    await renderViewer({
      entityKeysFilter: PG16_KEYS,
      serviceIdsToDisplay: [new ObjectID(ORDERS_APP_ID)],
    });

    const request: Record<string, unknown> = analyticsGetListMock.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(request["groupBy"]).toEqual({ name: true });
    expect(
      lastRowFor("db.client.operation.duration")["restrictServicesToIds"],
    ).toBeUndefined();
  });

  test("the row renders only those services (was '+4 more' of the project's)", () => {
    const services: Array<Service> = PROJECT_SERVICE_NAMES.map(
      ([id, name]: [string, string]): Service => {
        return service(id, name);
      },
    );
    render(
      <RealMetricRow
        metric={metricType("db.client.operation.duration", services)}
        restrictServicesToIds={[ORDERS_APP_ID]}
      />,
    );
    expect(screen.getByText("e2e-orders-app")).toBeInTheDocument();
    expect(screen.queryByText("billing-api")).not.toBeInTheDocument();
    expect(screen.queryByText(/more/)).not.toBeInTheDocument();

    expect(
      getMetricServicesWithin({ services, allowedServiceIds: [] }),
    ).toEqual([]);
    expect(
      getMetricServiceIdsByName([
        { name: "a", primaryEntityId: ORDERS_APP_ID },
        { name: "a", primaryEntityId: ORDERS_APP_ID },
        { name: "b", primaryEntityId: null },
      ]),
    ).toEqual({ a: [ORDERS_APP_ID], b: [] });
  });
});

describe("row values a host supplies", () => {
  test("an overridden row shows the host's value and caption; its average is not fetched", async () => {
    const fetchRowValueOverrides: MockFunction = getJestMockFunction();
    fetchRowValueOverrides.mockImplementation(
      (data: unknown): Promise<MetricRowValueOverrideMap> => {
        const request: {
          metricNames: Array<string>;
          startAndEndDate: InBetween<Date>;
        } = data as {
          metricNames: Array<string>;
          startAndEndDate: InBetween<Date>;
        };
        expect(request.startAndEndDate).toBeInstanceOf(InBetween);
        const overrides: MetricRowValueOverrideMap = new Map();
        if (request.metricNames.includes("postgresql.backends")) {
          overrides.set("postgresql.backends", {
            points: [{ time: "2026-09-25T01:11:00.000Z", value: 19 }],
            caption: "total of series",
          });
        }
        return Promise.resolve(overrides);
      },
    );

    await renderViewer({
      entityKeysFilter: PG16_KEYS,
      fetchRowValueOverrides: fetchRowValueOverrides as unknown as (data: {
        metricNames: Array<string>;
        startAndEndDate: InBetween<Date>;
      }) => Promise<MetricRowValueOverrideMap>,
      defaultRowValueCaption: "average of series",
    });

    const backends: Record<string, unknown> = lastRowFor("postgresql.backends");
    expect(backends["lastValue"]).toBe(19);
    expect(backends["valueCaption"]).toBe("total of series");

    const duration: Record<string, unknown> = lastRowFor(
      "db.client.operation.duration",
    );
    expect(duration["lastValue"]).toBe(4);
    expect(duration["valueCaption"]).toBe("average of series");

    const averaged: Array<string> = aggregateMock.mock.calls.map(
      (call: Array<unknown>): string => {
        return (
          (call[0] as { aggregateBy: { query: { name: string } } }).aggregateBy
            .query.name || ""
        );
      },
    );
    expect(averaged).toContain("db.client.operation.duration");
    expect(averaged).not.toContain("postgresql.backends");
  });

  test("a user's own attribute filter narrows the rows, so the host's whole-scope values step aside", async () => {
    const fetchRowValueOverrides: MockFunction = getJestMockFunction();
    fetchRowValueOverrides.mockResolvedValue(new Map());
    window.history.pushState(
      {},
      "",
      `/metrics?filters=${encodeURIComponent(
        JSON.stringify([["attributes.db.namespace", "orders"]]),
      )}`,
    );

    await act(async () => {
      render(
        <MetricsViewer
          entityKeysFilter={PG16_KEYS}
          fetchRowValueOverrides={
            fetchRowValueOverrides as unknown as (data: {
              metricNames: Array<string>;
              startAndEndDate: InBetween<Date>;
            }) => Promise<MetricRowValueOverrideMap>
          }
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });
    });
    window.history.pushState({}, "", "/");

    expect(rowProps.length).toBeGreaterThan(0);
    expect(fetchRowValueOverrides).not.toHaveBeenCalled();
  });

  test("without an override, rows read exactly as before (no caption, no suffix)", async () => {
    await renderViewer({ entityKeysFilter: PG16_KEYS });

    const backends: Record<string, unknown> = lastRowFor("postgresql.backends");
    expect(backends["lastValue"]).toBe(4);
    expect(backends["valueCaption"]).toBeUndefined();
    expect(backends["valueSuffix"]).toBeUndefined();
  });

  test("the row shows a rate's suffix and the caption under the value", () => {
    render(
      <RealMetricRow
        metric={metricType("postgresql.commits", [])}
        lastValue={2.5}
        valueSuffix="/s"
        valueCaption="per second, all series"
      />,
    );
    expect(screen.getByText(/2\.5.*\/s/)).toBeInTheDocument();
    expect(screen.getByTestId("metric-row-value-caption")).toHaveTextContent(
      "per second, all series",
    );
  });
});
