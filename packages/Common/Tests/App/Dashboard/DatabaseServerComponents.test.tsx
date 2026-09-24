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
 * The Databases components other pages render: the chip for the
 * databaseServers relation, the "no telemetry scope" banner, the calling
 * services table and the engine-metrics section of the Overview. Rendered
 * for real (charts replaced by a marker) on a project URL so every link is
 * a concrete, project-scoped href.
 */

const chartCardMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();

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

// The arrow wrapper is load bearing: jest.mock is hoisted above the mock.
jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
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
      description?: string;
      children?: React.ReactNode;
      onClose?: () => void;
    }) => {
      return (
        <section role="dialog" aria-label={props.title}>
          <p>{props.description}</p>
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
      default: () => {
        return <div data-testid="time-range-picker" />;
      },
    };
  },
);

jest.mock("../../../UI/Components/ComponentLoader/ComponentLoader", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="component-loader" />;
    },
  };
});

jest.mock("../../../UI/Components/Card/Card", () => {
  return {
    __esModule: true,
    default: (props: {
      title?: string;
      description?: string;
      children?: React.ReactNode;
    }) => {
      return (
        <section data-testid="card" aria-label={props.title}>
          <p>{props.description}</p>
          {props.children}
        </section>
      );
    },
  };
});

import DatabaseServerElement from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseServerElement";
import DatabaseServersElement from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseServersElement";
import DatabaseServerUnscopedBanner from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseServerUnscopedBanner";
import DatabaseCallingServicesCard from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseCallingServicesCard";
import DatabaseEngineMetricsSection, {
  ENGINE_METRICS_NO_DATA_TITLE,
  ENGINE_METRICS_NOT_CONNECTED_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseEngineMetricsSection";
import DatabaseMetricChartModal from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseMetricChartModal";
import { DatabaseEngineMetricsStatus } from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation";
import {
  DatabaseEngineMetricResult,
  toEngineMetricResult,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import {
  DatabaseServerMetricDefinition,
  getDatabaseServerMetrics,
} from "../../../Types/DatabaseServer/DatabaseServerMetricCatalog";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";

const MODEL_ID: ObjectID = new ObjectID("84858d6c-1111-4aaa-8bbb-000000000001");
const SERVICE_ID: string = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const START: Date = new Date("2026-09-24T10:00:00.000Z");

function at(minute: number): Date {
  return new Date(START.getTime() + minute * 60 * 1000);
}

function inRouter(element: React.ReactElement): React.ReactElement {
  return <MemoryRouter>{element}</MemoryRouter>;
}

function databasePath(suffix: string = ""): string {
  return `/dashboard/${PROJECT_ID}/databases/${MODEL_ID.toString()}${suffix}`;
}

beforeEach(() => {
  chartCardMock.mockReset();
  aggregateMock.mockReset();
  goTo(`/dashboard/${PROJECT_ID}/databases`);
});

afterEach(() => {
  cleanup();
});

describe("DatabaseServerElement", () => {
  test("links to the database's page in the current project", () => {
    const database: DatabaseServer = new DatabaseServer();
    database._id = MODEL_ID.toString();
    database.name = "PostgreSQL db.prod.internal:5432";

    render(inRouter(<DatabaseServerElement databaseServer={database} />));

    const link: HTMLElement = screen.getByRole("link", {
      name: /PostgreSQL db\.prod\.internal:5432/,
    });
    expect(link).toHaveAttribute("href", databasePath());
  });

  test("without an id it renders the plain name", () => {
    const database: DatabaseServer = new DatabaseServer();
    database.name = "orders-db";

    render(inRouter(<DatabaseServerElement databaseServer={database} />));

    expect(screen.getByText("orders-db")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  test("the list renders one chip per database and an empty message", () => {
    const first: DatabaseServer = new DatabaseServer();
    first._id = MODEL_ID.toString();
    first.name = "orders-db";

    const { unmount } = render(
      inRouter(<DatabaseServersElement databaseServers={[first]} />),
    );
    expect(screen.getByRole("link", { name: /orders-db/ })).toBeVisible();
    unmount();

    render(inRouter(<DatabaseServersElement databaseServers={[]} />));
    expect(screen.getByText("No databases.")).toBeInTheDocument();
  });
});

describe("DatabaseServerUnscopedBanner", () => {
  test("explains the missing scope and offers both ways out", () => {
    render(
      inRouter(
        <DatabaseServerUnscopedBanner modelId={MODEL_ID} signal="logs" />,
      ),
    );

    const card: HTMLElement = screen.getByRole("region", {
      name: "No telemetry scope yet",
    });
    expect(card).toHaveTextContent("no logs can be attributed to it");
    expect(
      within(card).getByRole("link", { name: /Add an endpoint/ }),
    ).toHaveAttribute("href", databasePath("/endpoints"));
    expect(
      within(card).getByRole("link", { name: /Connect the Database Agent/ }),
    ).toHaveAttribute("href", databasePath("/documentation"));
  });

  test("defaults the signal to telemetry", () => {
    render(inRouter(<DatabaseServerUnscopedBanner modelId={MODEL_ID} />));

    expect(
      screen.getByRole("region", { name: "No telemetry scope yet" }),
    ).toHaveTextContent("no telemetry can be attributed to it");
  });
});

describe("DatabaseCallingServicesCard", () => {
  test("shows a loader while loading", () => {
    render(
      inRouter(
        <DatabaseCallingServicesCard
          services={[]}
          serviceNames={{}}
          isLoading={true}
        />,
      ),
    );

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
  });

  test("says so when nothing queried the database", () => {
    render(
      inRouter(
        <DatabaseCallingServicesCard
          services={[]}
          serviceNames={{}}
          isLoading={false}
        />,
      ),
    );

    expect(
      screen.getByTestId("database-calling-services-empty"),
    ).toHaveTextContent("No instrumented application queried this database");
  });

  test("lists named services as links and unknown ids as text", () => {
    render(
      inRouter(
        <DatabaseCallingServicesCard
          services={[
            {
              serviceId: SERVICE_ID,
              calls: 1500,
              errors: 15,
              errorRatePercent: 1,
              p95DurationMs: 12.5,
            },
            {
              serviceId: "unknown-service",
              calls: 3,
              errors: 0,
              errorRatePercent: 0,
              p95DurationMs: null,
            },
          ]}
          serviceNames={{ [SERVICE_ID]: "checkout" }}
          isLoading={false}
        />,
      ),
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "database-calling-service-row",
    );
    expect(rows).toHaveLength(2);

    expect(
      within(rows[0]!).getByRole("link", { name: "checkout" }),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/service/${SERVICE_ID}`);
    expect(rows[0]).toHaveTextContent("1.5k");
    expect(rows[0]).toHaveTextContent("1.0%");
    expect(rows[0]).toHaveTextContent("13 ms");

    expect(within(rows[1]!).queryByRole("link")).not.toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("unknown-service");
    expect(rows[1]).toHaveTextContent("—");
  });
});

describe("DatabaseEngineMetricsSection", () => {
  const catalog: Array<DatabaseServerMetricDefinition> =
    getDatabaseServerMetrics("postgresql");

  function renderSection(data: {
    status: DatabaseEngineMetricsStatus;
    results: Array<DatabaseEngineMetricResult>;
    hasCollectorReceiver?: boolean;
    hasCatalog?: boolean;
    isLoading?: boolean;
  }): void {
    render(
      inRouter(
        <DatabaseEngineMetricsSection
          modelId={MODEL_ID}
          engineLabel="PostgreSQL"
          status={data.status}
          hasCatalog={data.hasCatalog ?? true}
          hasCollectorReceiver={data.hasCollectorReceiver ?? true}
          results={data.results}
          isLoading={data.isLoading ?? false}
          windowStart={at(0)}
          windowEnd={at(60)}
        />,
      ),
    );
  }

  test("shows a loader while loading", () => {
    renderSection({
      status: DatabaseEngineMetricsStatus.Connected,
      results: [],
      isLoading: true,
    });

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(chartCardMock).not.toHaveBeenCalled();
  });

  test("never connected: explains the agent and links to the prefilled guide", () => {
    renderSection({
      status: DatabaseEngineMetricsStatus.NotConnected,
      results: catalog.map((definition: DatabaseServerMetricDefinition) => {
        return toEngineMetricResult(definition, []);
      }),
    });

    const card: HTMLElement = screen.getByRole("region", {
      name: ENGINE_METRICS_NOT_CONNECTED_TITLE,
    });
    expect(card).toHaveTextContent("Install the OneUptime Database Agent");
    expect(card).toHaveTextContent("Not connected");
    expect(
      within(card).getByRole("link", { name: /Connect engine metrics/ }),
    ).toHaveAttribute("href", databasePath("/documentation"));
    expect(chartCardMock).not.toHaveBeenCalled();
  });

  test("disconnected: says the agent stopped reporting", () => {
    renderSection({
      status: DatabaseEngineMetricsStatus.Disconnected,
      results: [],
    });

    expect(
      screen.getByRole("region", { name: ENGINE_METRICS_NOT_CONNECTED_TITLE }),
    ).toHaveTextContent("stopped reporting");
  });

  test("connected with nothing in range: points at the Metrics tab, not the install guide", () => {
    renderSection({
      status: DatabaseEngineMetricsStatus.Connected,
      results: catalog.map((definition: DatabaseServerMetricDefinition) => {
        return toEngineMetricResult(definition, []);
      }),
    });

    const card: HTMLElement = screen.getByRole("region", {
      name: ENGINE_METRICS_NO_DATA_TITLE,
    });
    expect(card).toHaveTextContent("is connected");
    expect(card).toHaveTextContent("Connected");
    expect(card).not.toHaveTextContent("Install the OneUptime Database Agent");
    expect(
      within(card).getByRole("link", { name: /All metrics/ }),
    ).toHaveAttribute("href", databasePath("/metrics"));
    expect(
      screen.queryByRole("region", {
        name: ENGINE_METRICS_NOT_CONNECTED_TITLE,
      }),
    ).not.toBeInTheDocument();
    expect(chartCardMock).not.toHaveBeenCalled();
  });

  test("connected, but the engine has no curated overview", () => {
    renderSection({
      status: DatabaseEngineMetricsStatus.Connected,
      results: [],
      hasCatalog: false,
    });

    const card: HTMLElement = screen.getByRole("region", {
      name: ENGINE_METRICS_NO_DATA_TITLE,
    });
    expect(card).toHaveTextContent("no curated overview");
    expect(
      within(card).getByRole("link", { name: /All metrics/ }),
    ).toHaveAttribute("href", databasePath("/metrics"));
  });

  test("an engine without a collector receiver offers no connect link", () => {
    renderSection({
      status: DatabaseEngineMetricsStatus.NotConnected,
      results: [],
      hasCollectorReceiver: false,
    });

    const card: HTMLElement = screen.getByRole("region", {
      name: ENGINE_METRICS_NOT_CONNECTED_TITLE,
    });
    expect(card).toHaveTextContent(
      "There is no OpenTelemetry Collector receiver",
    );
    expect(within(card).queryByRole("link")).not.toBeInTheDocument();
  });

  test("with data: a tile per catalog metric and a chart per metric with points", () => {
    const gauge: DatabaseServerMetricDefinition = catalog.find(
      (definition: DatabaseServerMetricDefinition): boolean => {
        return definition.metricName === "postgresql.backends";
      },
    )!;
    const counter: DatabaseServerMetricDefinition = catalog.find(
      (definition: DatabaseServerMetricDefinition): boolean => {
        return definition.metricName === "postgresql.commits";
      },
    )!;

    renderSection({
      status: DatabaseEngineMetricsStatus.Connected,
      results: [
        toEngineMetricResult(gauge, [
          { x: at(0), y: 10 },
          { x: at(1), y: 12 },
        ]),
        toEngineMetricResult(counter, [
          { x: at(0), y: 0 },
          { x: at(1), y: 600 },
        ]),
        ...catalog
          .filter((definition: DatabaseServerMetricDefinition): boolean => {
            return definition !== gauge && definition !== counter;
          })
          .map((definition: DatabaseServerMetricDefinition) => {
            return toEngineMetricResult(definition, []);
          }),
      ],
    });

    expect(screen.getByTestId("database-engine-metrics")).toBeInTheDocument();
    expect(screen.getAllByTestId("database-engine-metric-tile")).toHaveLength(
      catalog.length,
    );
    expect(screen.getByText("12 connections")).toBeInTheDocument();
    expect(screen.getByText("10 commits/s")).toBeInTheDocument();

    // Only metrics that returned points are charted; counters say "per second".
    const titles: Array<string> = screen
      .getAllByTestId("chart-card")
      .map((element: HTMLElement): string => {
        return element.textContent || "";
      });
    expect(titles).toEqual(["Connections", "Commits (per second)"]);
    expect(screen.getByRole("link", { name: /All metrics/ })).toHaveAttribute(
      "href",
      databasePath("/metrics"),
    );
  });
});

/*
 * The Metrics tab charts a clicked metric here, over the database's key set
 * (the explorer would chart the whole project). The query goes through the
 * scoped helper: keys only, no request at all without keys, a curated
 * counter as a per-second rate with no aggregation to pick.
 */
describe("DatabaseMetricChartModal", () => {
  const KEY: string = "0123456789abcdef";

  type ChartProps = {
    title: string;
    loading?: boolean;
    series: Array<{ seriesName: string; data: Array<{ x: Date; y: number }> }>;
  };

  function lastChart(): ChartProps {
    const calls: Array<Array<unknown>> = chartCardMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1]![0] as ChartProps;
  }

  function lastAggregateBy(): Record<string, unknown> {
    const calls: Array<Array<unknown>> = aggregateMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return (
      calls[calls.length - 1]![0] as { aggregateBy: Record<string, unknown> }
    ).aggregateBy;
  }

  function renderChart(data: {
    metricName: string;
    keys: Array<string>;
    onClose?: () => void;
  }): void {
    render(
      <DatabaseMetricChartModal
        metricName={data.metricName}
        keys={data.keys}
        projectId={PROJECT_ID}
        dbSystem="postgresql"
        onClose={data.onClose || ((): void => {})}
      />,
    );
  }

  test("a curated counter is charted as a per-second rate over the key set", async () => {
    aggregateMock.mockResolvedValue({
      data: [
        { timestamp: at(0), value: 0 },
        { timestamp: at(1), value: 600 },
      ],
    });

    renderChart({ metricName: "postgresql.commits", keys: [KEY] });

    await waitFor(() => {
      expect(lastChart().loading).toBe(false);
    });
    expect(lastChart().series[0]!.data).toEqual([{ x: at(1), y: 10 }]);
    expect(
      screen.getByRole("dialog", { name: "Commits (per second)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Aggregation" }),
    ).not.toBeInTheDocument();

    const aggregateBy: Record<string, unknown> = lastAggregateBy();
    expect(aggregateBy["aggregationType"]).toBe(AggregationType.Max);
    const query: Record<string, unknown> = aggregateBy["query"] as Record<
      string,
      unknown
    >;
    expect(query["name"]).toBe("postgresql.commits");
    expect((query["entityKeys"] as Includes).values).toEqual([KEY]);
    expect(query["attributes"]).toBeUndefined();
  });

  test("any other metric offers the aggregations and refetches on a change", async () => {
    aggregateMock.mockResolvedValue({
      data: [{ timestamp: at(0), value: 3 }],
    });

    renderChart({ metricName: "db.client.connection.count", keys: [KEY] });

    await waitFor(() => {
      expect(lastChart().loading).toBe(false);
    });
    expect(
      screen.getByRole("dialog", { name: "db.client.connection.count" }),
    ).toBeInTheDocument();
    expect(lastAggregateBy()["aggregationType"]).toBe(AggregationType.Avg);

    const group: HTMLElement = screen.getByRole("group", {
      name: "Aggregation",
    });
    expect(
      within(group).getByRole("button", { name: "Average" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(group).getByRole("button", { name: "Max" }));

    await waitFor(() => {
      expect(lastAggregateBy()["aggregationType"]).toBe(AggregationType.Max);
    });
    expect(within(group).getByRole("button", { name: "Max" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("never queries without keys and closes on request", async () => {
    const onClose: MockFunction = getJestMockFunction();

    renderChart({
      metricName: "postgresql.backends",
      keys: [],
      onClose: () => {
        onClose();
      },
    });

    await waitFor(() => {
      expect(lastChart().loading).toBe(false);
    });
    expect(aggregateMock).not.toHaveBeenCalled();
    expect(lastChart().series[0]!.data).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
