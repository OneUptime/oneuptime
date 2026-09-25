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

// The arrow wrapper is load bearing: jest.mock is hoisted above the mock.
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
      default: (props: { value?: { range?: string } }) => {
        return (
          <div data-testid="time-range-picker">{props.value?.range || ""}</div>
        );
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
import DatabaseServerUnscopedBanner, {
  DATABASE_SERVER_ID_ONLY_TITLE,
  getDatabaseServerScopeBannerDescription,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseServerUnscopedBanner";
import { isDatabaseServerScopedByIdOnly } from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseTelemetryScope";
import DatabaseCallingServicesCard, {
  getCallingServicesFooter,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseCallingServicesCard";
import DatabaseEngineMetricsSection, {
  ENGINE_METRICS_DISCONNECTED_TITLE,
  ENGINE_METRICS_NO_CURATED_OVERVIEW_TITLE,
  ENGINE_METRICS_NO_DATA_TITLE,
  ENGINE_METRICS_NOT_CONNECTED_TITLE,
  EngineMetricsGuidance,
  getEngineMetricsGuidance,
  getEngineMetricsMissingDescription,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseEngineMetricsSection";
import DatabaseMetricChartModal from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseMetricChartModal";
import DatabaseRuntimeSection from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseRuntimeSection";
import {
  DatabaseRunsOnLink,
  DatabaseWorkloadLink,
  getDatabaseRunsOnRoute,
  getDatabaseWorkloadRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseRunsOnLink";
import {
  DatabaseEngineMetricsStatus,
  DatabaseRuntimePlatform,
  formatDatabaseFraction,
  formatDatabaseMetricValue,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation";
import {
  DatabaseEngineMetricResult,
  toEngineMetricResult,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries";
import {
  getDatabaseAgentCollectedMetricsText,
  getDatabaseAgentEngine,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DocumentationMarkdown";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import {
  DatabaseServerMetricDefinition,
  getDatabaseServerMetrics,
} from "../../../Types/DatabaseServer/DatabaseServerMetricCatalog";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

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
  getListAnalyticsMock.mockReset();
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

  test("the 'id only' hint says only data sent with its id shows, and how to get more", () => {
    render(
      inRouter(
        <DatabaseServerUnscopedBanner
          modelId={MODEL_ID}
          signal="metrics"
          variant="id-only"
        />,
      ),
    );

    const card: HTMLElement = screen.getByRole("region", {
      name: DATABASE_SERVER_ID_ONLY_TITLE,
    });
    expect(card).toHaveTextContent(
      "what shows here is only the metrics sent with its id",
    );
    expect(card).toHaveTextContent("DATABASE_SERVER_ID");
    expect(card).toHaveTextContent("oneuptime.database.server.id.");
    // Never claims nothing can be attributed: the row key is a real scope.
    expect(card).not.toHaveTextContent("can be attributed");
    expect(
      screen.queryByRole("region", { name: "No telemetry scope yet" }),
    ).not.toBeInTheDocument();
    expect(
      within(card).getByTestId("database-server-unscoped-banner"),
    ).toHaveAttribute("data-variant", "id-only");
    expect(
      within(card).getByRole("link", { name: /Add an endpoint/ }),
    ).toHaveAttribute("href", databasePath("/endpoints"));
    expect(
      within(card).getByRole("link", { name: /Connect the Database Agent/ }),
    ).toHaveAttribute("href", databasePath("/documentation"));
  });

  test("the description for each variant", () => {
    expect(getDatabaseServerScopeBannerDescription("unscoped", "logs")).toBe(
      "This database has no endpoint and no Kubernetes or container members yet, so no logs can be attributed to it.",
    );
    expect(getDatabaseServerScopeBannerDescription("id-only")).toBe(
      "This database has no endpoint and no Kubernetes or container members yet, so what shows here is only the telemetry sent with its id. The queries your applications send it are matched by endpoint.",
    );
  });
});

/*
 * A loaded row always has its row key, so "unscoped" only happens without a
 * project; "id only" is a row whose row key is its whole scope.
 */
describe("isDatabaseServerScopedByIdOnly", () => {
  const PROJECT: string = "10000000-0000-4000-8000-000000000001";

  test("a row with no parseable endpoint and no members is scoped by its id alone", () => {
    expect(
      isDatabaseServerScopedByIdOnly({
        projectId: PROJECT,
        id: MODEL_ID,
        endpoints: ["localhost:5432", "not a host", { endpoint: null }],
        dbSystem: "postgresql",
        memberEntityKeys: {},
      }),
    ).toBe(true);
    expect(
      isDatabaseServerScopedByIdOnly({
        projectId: PROJECT,
        id: MODEL_ID.toString(),
        endpoints: [],
      }),
    ).toBe(true);
  });

  test("an endpoint or a member is more than the id", () => {
    expect(
      isDatabaseServerScopedByIdOnly({
        projectId: PROJECT,
        id: MODEL_ID,
        endpoints: ["db.prod.internal:5432"],
        dbSystem: "postgresql",
      }),
    ).toBe(false);
    expect(
      isDatabaseServerScopedByIdOnly({
        projectId: PROJECT,
        id: MODEL_ID,
        endpoints: [],
        dbSystem: "postgresql",
        memberEntityKeys: { "0123456789abcdef": "2026-09-23T10:00:00.000Z" },
      }),
    ).toBe(false);
  });

  test("without an id or a project it is unscoped, not id-only", () => {
    expect(
      isDatabaseServerScopedByIdOnly({
        projectId: PROJECT,
        id: null,
        endpoints: [],
      }),
    ).toBe(false);
    expect(
      isDatabaseServerScopedByIdOnly({
        projectId: null,
        id: MODEL_ID,
        endpoints: [],
      }),
    ).toBe(false);
    expect(isDatabaseServerScopedByIdOnly(null)).toBe(false);
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

describe("DatabaseCallingServicesCard totals", () => {
  const service: {
    serviceId: string;
    calls: number;
    errors: number;
    errorRatePercent: number;
    p95DurationMs: number;
  } = {
    serviceId: SERVICE_ID,
    calls: 10,
    errors: 0,
    errorRatePercent: 0,
    p95DurationMs: 1,
  };

  test("says how many services called when the table holds fewer", () => {
    render(
      inRouter(
        <DatabaseCallingServicesCard
          services={[service]}
          serviceNames={{}}
          isLoading={false}
          totalServices={25}
        />,
      ),
    );

    expect(
      screen.getByTestId("database-calling-services-footer"),
    ).toHaveTextContent("Showing the 1 busiest of 25 calling services.");
  });

  test("no footer when the table is the whole list", () => {
    render(
      inRouter(
        <DatabaseCallingServicesCard
          services={[service]}
          serviceNames={{}}
          isLoading={false}
          totalServices={1}
        />,
      ),
    );

    expect(
      screen.queryByTestId("database-calling-services-footer"),
    ).not.toBeInTheDocument();
    expect(getCallingServicesFooter(10, 10)).toBe("");
    expect(getCallingServicesFooter(10, undefined)).toBe("");
    expect(getCallingServicesFooter(10, 1500)).toBe(
      "Showing the 10 busiest of 1.5k calling services.",
    );
  });
});

describe("DatabaseEngineMetricsSection", () => {
  const catalog: Array<DatabaseServerMetricDefinition> =
    getDatabaseServerMetrics("postgresql");

  function renderSection(data: {
    status: DatabaseEngineMetricsStatus;
    results: Array<DatabaseEngineMetricResult>;
    dbSystem?: string;
    hasCatalog?: boolean;
    isLoading?: boolean;
    lastReceivedAt?: Date | null;
    engineLabel?: string;
  }): void {
    render(
      inRouter(
        <DatabaseEngineMetricsSection
          modelId={MODEL_ID}
          engineLabel={data.engineLabel || "PostgreSQL"}
          status={data.status}
          hasCatalog={data.hasCatalog ?? true}
          dbSystem={data.dbSystem ?? "postgresql"}
          lastReceivedAt={data.lastReceivedAt}
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

  test("never connected: a gray 'Not connected', and the install guide — never 'stopped reporting'", () => {
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
    expect(card).not.toHaveTextContent("stopped");
    expect(
      within(card).getByTestId("database-engine-metrics-status"),
    ).toHaveAttribute("data-status", DatabaseEngineMetricsStatus.NotConnected);
    expect(
      within(card).getByRole("link", { name: /Install the Database Agent/ }),
    ).toHaveAttribute("href", databasePath("/documentation"));
    expect(chartCardMock).not.toHaveBeenCalled();
  });

  test("disconnected: a red status, when it last reported, and a way to check the agent", () => {
    const lastReceivedAt: Date = new Date("2026-09-20T08:00:00.000Z");
    renderSection({
      status: DatabaseEngineMetricsStatus.Disconnected,
      results: [],
      lastReceivedAt,
    });

    const card: HTMLElement = screen.getByRole("region", {
      name: ENGINE_METRICS_DISCONNECTED_TITLE,
    });
    expect(card).toHaveTextContent("stopped reporting");
    expect(card).toHaveTextContent(
      OneUptimeDate.getDateAsLocalFormattedString(lastReceivedAt),
    );
    expect(card).not.toHaveTextContent("Install the OneUptime Database Agent");
    expect(
      within(card).getByTestId("database-engine-metrics-status"),
    ).toHaveAttribute("data-status", DatabaseEngineMetricsStatus.Disconnected);
    expect(
      within(card).getByTestId("database-engine-metrics-status").className,
    ).toContain("red");
    expect(
      within(card).getByRole("link", { name: /Check the agent setup/ }),
    ).toHaveAttribute("href", databasePath("/documentation"));
  });

  test("the missing-metrics wording for each situation", () => {
    expect(
      getEngineMetricsMissingDescription({
        status: DatabaseEngineMetricsStatus.NotConnected,
        engineLabel: "MySQL",
        dbSystem: "mysql",
      }),
    ).toContain("no Database Agent or OpenTelemetry Collector has sent them");
    expect(
      getEngineMetricsMissingDescription({
        status: DatabaseEngineMetricsStatus.Disconnected,
        engineLabel: "MySQL",
        dbSystem: "mysql",
      }),
    ).toContain("has stopped reporting");
    // The engine's metrics CAN be collected: never "there is no receiver".
    for (const dbSystem of [
      "cockroachdb",
      "couchdb",
      "aws.dynamodb",
      "ibm.db2",
      "acme-unknown-db",
    ]) {
      const text: string = getEngineMetricsMissingDescription({
        status: DatabaseEngineMetricsStatus.NotConnected,
        engineLabel: "X",
        dbSystem,
      });
      expect({
        dbSystem,
        saysNoReceiver: text.includes("There is no OpenTelemetry Collector"),
        pointsAtGuide: text.includes("Documentation tab"),
      }).toEqual({ dbSystem, saysNoReceiver: false, pointsAtGuide: true });
    }
  });

  /*
   * UI review: every engine's card said "Connections, throughput, cache hit
   * ratio, locks and replication come from the … engine itself" — Memcached
   * has no locks or replication. An engine the agent ships a config for now
   * names what that config really collects, the list the Documentation tab
   * opens with, as plain text (the card is not markdown).
   */
  test.each([
    ["memcached", "Memcached", "memcached", "get hits and misses"],
    ["opensearch", "OpenSearch", "elasticsearch", "cluster health"],
    ["valkey", "Valkey", "redis", "keyspace hits and misses"],
    ["mariadb", "MariaDB", "mysql", "the InnoDB buffer pool"],
    ["postgresql", "PostgreSQL", "postgresql", "max_connections"],
  ])(
    "not connected, %s: names the metrics its agent config collects",
    (
      dbSystem: string,
      engineLabel: string,
      agentEngine: string,
      named: string,
    ) => {
      const text: string = getEngineMetricsMissingDescription({
        status: DatabaseEngineMetricsStatus.NotConnected,
        engineLabel,
        dbSystem,
      });

      expect(getDatabaseAgentEngine(dbSystem)).toBe(agentEngine);
      expect(text).toContain(
        `Engine metrics — ${getDatabaseAgentCollectedMetricsText(
          getDatabaseAgentEngine(dbSystem)!,
        )} — come from the ${engineLabel} engine itself, and no Database Agent or OpenTelemetry Collector has sent them for this database yet.`,
      );
      expect(text).toContain(named);
      expect(text).not.toContain("`");
      expect(text).not.toContain("DATABASE_QUERY_EVENTS");
      expect(text).not.toContain("throughput, cache hit ratio, locks");
    },
  );

  test("Memcached and Elasticsearch are never promised locks or replication", () => {
    for (const dbSystem of ["memcached", "elasticsearch"]) {
      const text: string = getEngineMetricsMissingDescription({
        status: DatabaseEngineMetricsStatus.NotConnected,
        engineLabel: "X",
        dbSystem,
      });
      expect({
        dbSystem,
        locks: text.split(/\W+/).some((word: string): boolean => {
          return word === "lock" || word === "locks";
        }),
        replication: text.includes("replication"),
      }).toEqual({ dbSystem, locks: false, replication: false });
    }
  });

  test("an engine the agent has no config for keeps the generic words", () => {
    expect(
      getEngineMetricsMissingDescription({
        status: DatabaseEngineMetricsStatus.NotConnected,
        engineLabel: "CouchDB",
        dbSystem: "couchdb",
      }),
    ).toContain(
      "Connections, throughput, cache hit ratio, locks and replication come from the CouchDB engine itself",
    );
  });

  /*
   * What "not connected" offers follows where the engine's metrics come
   * from — the same source the Documentation tab builds its guide from.
   */
  test.each([
    [
      "an engine the Database Agent ships a config for",
      "mysql",
      "MySQL",
      "Install the OneUptime Database Agent",
      "Install the Database Agent →",
    ],
    [
      "a fork the agent monitors with its family's config",
      "mariadb",
      "MariaDB",
      "Install the OneUptime Database Agent",
      "Install the Database Agent →",
    ],
    [
      "an engine with a collector receiver but no agent config",
      "couchdb",
      "CouchDB",
      "ready-made collector config",
      "Connect engine metrics →",
    ],
    [
      "an engine that serves Prometheus metrics",
      "cockroachdb",
      "CockroachDB",
      "serves Prometheus metrics itself",
      "Connect engine metrics →",
    ],
    [
      "a managed service read from its provider's monitoring API",
      "aws.dynamodb",
      "Amazon DynamoDB",
      "provider's monitoring API",
      "Connect engine metrics →",
    ],
    [
      "an engine with no ready-made path",
      "ibm.db2",
      "IBM Db2",
      "can still be collected",
      "Connect engine metrics →",
    ],
    [
      "an engine OneUptime does not know",
      "acme-unknown-db",
      "acme-unknown-db",
      "can still be collected",
      "Connect engine metrics →",
    ],
  ])(
    "not connected, %s: says how and links the Documentation tab",
    (
      _case: string,
      dbSystem: string,
      engineLabel: string,
      wording: string,
      linkLabel: string,
    ) => {
      renderSection({
        status: DatabaseEngineMetricsStatus.NotConnected,
        results: [],
        hasCatalog: false,
        dbSystem,
        engineLabel,
      });

      const card: HTMLElement = screen.getByRole("region", {
        name: ENGINE_METRICS_NOT_CONNECTED_TITLE,
      });
      expect(card).toHaveTextContent(wording);
      expect(card).not.toHaveTextContent("There is no OpenTelemetry Collector");
      expect(card).not.toHaveTextContent("stopped");
      const link: HTMLElement = within(card).getByRole("link");
      expect(link).toHaveTextContent(linkLabel);
      expect(link).toHaveAttribute("href", databasePath("/documentation"));
    },
  );

  test("a disconnected engine always offers the setup check, whatever its source", () => {
    const guidance: EngineMetricsGuidance = getEngineMetricsGuidance({
      status: DatabaseEngineMetricsStatus.Disconnected,
      engineLabel: "CockroachDB",
      dbSystem: "cockroachdb",
    });
    expect(guidance.description).toContain("has stopped reporting");
    expect(guidance.linkLabel).toBe("Check the agent setup →");
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

  /*
   * E2E: a Connected Memcached (7f1cbfa6, engine metrics last at 00:38) read
   * "No engine metrics in this range" while 69-76 metrics arrived every
   * 30 s. Its metrics DO arrive; only the curated overview is missing.
   */
  test("connected, but the engine has no curated overview", () => {
    renderSection({
      status: DatabaseEngineMetricsStatus.Connected,
      results: [],
      hasCatalog: false,
      dbSystem: "memcached",
      engineLabel: "Memcached",
    });

    const card: HTMLElement = screen.getByRole("region", {
      name: ENGINE_METRICS_NO_CURATED_OVERVIEW_TITLE,
    });
    expect(
      screen.queryByRole("region", { name: ENGINE_METRICS_NO_DATA_TITLE }),
    ).not.toBeInTheDocument();
    expect(card).toHaveTextContent("no curated overview for Memcached");
    expect(
      within(card).getByRole("link", { name: /All metrics/ }),
    ).toHaveAttribute("href", databasePath("/metrics"));
  });

  test("an engine inside the application's process has nothing to connect, and says so", () => {
    renderSection({
      status: DatabaseEngineMetricsStatus.NotConnected,
      results: [],
      hasCatalog: false,
      dbSystem: "sqlite",
      engineLabel: "SQLite",
    });

    const card: HTMLElement = screen.getByRole("region", {
      name: ENGINE_METRICS_NOT_CONNECTED_TITLE,
    });
    expect(card).toHaveTextContent(
      "SQLite runs inside your application's process",
    );
    expect(card).toHaveTextContent("the queries they send");
    expect(within(card).queryByRole("link")).not.toBeInTheDocument();
    expect(
      getEngineMetricsGuidance({
        status: DatabaseEngineMetricsStatus.NotConnected,
        engineLabel: "DuckDB",
        dbSystem: "duckdb",
      }).linkLabel,
    ).toBeNull();
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
        // A counter's series arrives as its per-second rate.
        toEngineMetricResult(counter, [{ x: at(1), y: 10 }]),
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
    // Every tile explains itself in an (i), not a bare title attribute.
    expect(
      screen.getByRole("button", { name: "About Connections" }),
    ).toBeInTheDocument();

    // Only metrics that returned points are charted; counters say "per second".
    const titles: Array<string> = screen
      .getAllByTestId("chart-card")
      .map((element: HTMLElement): string => {
        return element.textContent || "";
      });
    expect(titles).toEqual(["Connections", "Commits (per second)"]);
    expect(
      (chartCardMock.mock.calls[0]![0] as { description: string }).description,
    ).toBe(gauge.description);
    expect(screen.getByRole("link", { name: /All metrics/ })).toHaveAttribute(
      "href",
      databasePath("/metrics"),
    );
  });

  test("two entries of one metric (MySQL threads) render as two tiles and charts", () => {
    const mysql: Array<DatabaseServerMetricDefinition> =
      getDatabaseServerMetrics("mysql");
    const consoleError: ReturnType<typeof jest.spyOn> = jest
      .spyOn(console, "error")
      .mockImplementation((): void => {});

    renderSection({
      status: DatabaseEngineMetricsStatus.Connected,
      engineLabel: "MySQL",
      results: mysql.map((definition: DatabaseServerMetricDefinition) => {
        return toEngineMetricResult(definition, [{ x: at(0), y: 3 }]);
      }),
    });

    expect(screen.getAllByTestId("database-engine-metric-tile")).toHaveLength(
      mysql.length,
    );
    // One tile and one chart each.
    expect(screen.getAllByText("Connected threads")).toHaveLength(2);
    expect(screen.getAllByText("Running threads")).toHaveLength(2);
    // No duplicate React keys.
    const duplicateKeyWarnings: Array<unknown> = consoleError.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return String(call[0]).includes("same key");
      },
    );
    expect(duplicateKeyWarnings).toEqual([]);
    consoleError.mockRestore();
  });

  test("Oracle's tiles read in their own units: a fullness as a percentage, DB time per second", () => {
    const oracle: Array<DatabaseServerMetricDefinition> =
      getDatabaseServerMetrics("oracle.db");
    const values: Record<string, number> = {
      "oracledb.tablespace.utilization": 0.853,
      "oracledb.sga.usage": 1610612736,
      "oracledb.db.time": 0.35,
    };

    renderSection({
      status: DatabaseEngineMetricsStatus.Connected,
      engineLabel: "Oracle",
      dbSystem: "oracle.db",
      results: oracle.map((definition: DatabaseServerMetricDefinition) => {
        const value: number | undefined = values[definition.metricName];
        return toEngineMetricResult(
          definition,
          value === undefined ? [] : [{ x: at(0), y: value }],
        );
      }),
    });

    const tile: (title: string) => HTMLElement = (
      title: string,
    ): HTMLElement => {
      return screen
        .getAllByTestId("database-engine-metric-tile")
        .find((element: HTMLElement): boolean => {
          return (element.textContent || "").startsWith(title);
        })!;
    };
    expect(tile("Fullest tablespace")).toHaveTextContent("85%");
    expect(tile("SGA in use")).toHaveTextContent("1.5 GiB");
    expect(tile("DB time")).toHaveTextContent("0.35 s/s");
    // No tile for a metric a pluggable database never reports.
    expect(screen.queryByText("Session limit")).not.toBeInTheDocument();
    expect(screen.queryByText("Processes")).not.toBeInTheDocument();
  });

  test("a 0..1 share reads as a percentage without rounding a small one away", () => {
    expect(formatDatabaseFraction(0.853)).toBe("85%");
    expect(formatDatabaseFraction(0.042)).toBe("4.2%");
    expect(formatDatabaseFraction(0.000389)).toBe("0.04%");
    expect(formatDatabaseFraction(0)).toBe("0%");
    expect(formatDatabaseFraction(1)).toBe("100%");
    expect(formatDatabaseFraction(null)).toBe("—");
    expect(formatDatabaseFraction(Number.NaN)).toBe("—");
    expect(formatDatabaseMetricValue(0.5, "fraction", "gauge")).toBe("50%");
  });

  test("with data from a stopped agent, the header still says so", () => {
    renderSection({
      status: DatabaseEngineMetricsStatus.Disconnected,
      results: [toEngineMetricResult(catalog[0]!, [{ x: at(0), y: 1 }])],
    });

    expect(
      within(screen.getByTestId("database-engine-metrics")).getByTestId(
        "database-engine-metrics-status",
      ),
    ).toHaveTextContent("Disconnected");
  });

  test("charts with no collector sighting carry no status pill", () => {
    renderSection({
      status: DatabaseEngineMetricsStatus.NotConnected,
      results: [toEngineMetricResult(catalog[0]!, [{ x: at(0), y: 1 }])],
    });

    expect(screen.getByTestId("database-engine-metrics")).toBeInTheDocument();
    expect(
      screen.queryByTestId("database-engine-metrics-status"),
    ).not.toBeInTheDocument();
  });
});

describe("DatabaseRunsOnLink", () => {
  const CLUSTER_ID: string = "c1a5e000-0000-4000-8000-000000000001";
  const HOST_ID: string = "d0c4e000-0000-4000-8000-000000000001";

  function server(data: Partial<DatabaseServer>): DatabaseServer {
    const row: DatabaseServer = new DatabaseServer();
    Object.assign(row, data);
    return row;
  }

  test("a Kubernetes database links to its cluster, its StatefulSet to the StatefulSet page", () => {
    const row: DatabaseServer = server({
      kubernetesClusterId: new ObjectID(CLUSTER_ID),
      kubernetesNamespace: "payments",
      workloadKind: "StatefulSet",
      workloadName: "postgres",
    });
    (
      row as unknown as { kubernetesCluster: { name: string } }
    ).kubernetesCluster = { name: "prod-eu" };

    render(
      inRouter(
        <div>
          <DatabaseRunsOnLink source={row} />
          <DatabaseWorkloadLink source={row} />
        </div>,
      ),
    );

    expect(
      screen.getByRole("link", { name: "Kubernetes · prod-eu" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}`,
    );
    expect(
      screen.getByRole("link", { name: "payments/StatefulSet/postgres" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/statefulsets/postgres`,
    );
  });

  test.each([
    ["Deployment", "deployments"],
    ["DaemonSet", "daemonsets"],
    ["Pod", "pods"],
  ])("a %s workload links to its page", (kind: string, segment: string) => {
    const route: string | undefined = getDatabaseWorkloadRoute({
      kubernetesClusterId: CLUSTER_ID,
      workloadKind: kind,
      workloadName: "redis",
    })?.toString();
    expect(route).toBe(
      `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/${segment}/redis`,
    );
  });

  test("an operator's Cluster or a ReplicaSet has no page to link", () => {
    for (const kind of ["Cluster", "ReplicaSet", ""]) {
      expect(
        getDatabaseWorkloadRoute({
          kubernetesClusterId: CLUSTER_ID,
          workloadKind: kind,
          workloadName: "pg",
        }),
      ).toBeNull();
    }
  });

  test("Docker and Podman databases link to their host and its containers", () => {
    expect(
      getDatabaseRunsOnRoute({
        dockerHostId: new ObjectID(HOST_ID),
      })?.toString(),
    ).toBe(`/dashboard/${PROJECT_ID}/docker/${HOST_ID}`);
    expect(
      getDatabaseWorkloadRoute({
        dockerHostId: HOST_ID,
        workloadKind: "Container",
        workloadName: "shop-db",
      })?.toString(),
    ).toBe(`/dashboard/${PROJECT_ID}/docker/${HOST_ID}/containers`);
    expect(getDatabaseRunsOnRoute({ podmanHostId: HOST_ID })?.toString()).toBe(
      `/dashboard/${PROJECT_ID}/podman/${HOST_ID}`,
    );
    expect(
      getDatabaseWorkloadRoute({
        podmanHostId: HOST_ID,
        workloadName: "shop-db",
      })?.toString(),
    ).toBe(`/dashboard/${PROJECT_ID}/podman/${HOST_ID}/containers`);
  });

  test("without a parent id it is plain text; off-platform it is a dash", () => {
    const { unmount } = render(
      inRouter(
        <DatabaseRunsOnLink
          source={{ discoverySource: "kubernetes", workloadName: "pg" }}
        />,
      ),
    );
    expect(screen.getByText("Kubernetes")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    unmount();

    render(inRouter(<DatabaseRunsOnLink source={{ serverAddress: "db" }} />));
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(getDatabaseRunsOnRoute(null)).toBeNull();
    expect(getDatabaseWorkloadRoute({ serverAddress: "db" })).toBeNull();
  });
});

describe("DatabaseRuntimeSection", () => {
  test("renders Runs on and Workload as links, and explains its charts", () => {
    const row: DatabaseServer = new DatabaseServer();
    row.kubernetesClusterId = new ObjectID(
      "c1a5e000-0000-4000-8000-000000000001",
    );
    row.kubernetesNamespace = "payments";
    row.workloadKind = "StatefulSet";
    row.workloadName = "postgres";

    render(
      inRouter(
        <DatabaseRuntimeSection
          modelId={MODEL_ID}
          platform={DatabaseRuntimePlatform.Kubernetes}
          source={row}
          instanceCount={3}
          memberCount={3}
          cpuSeries={[]}
          memorySeries={[]}
          isLoading={false}
          windowStart={at(0)}
          windowEnd={at(60)}
        />,
      ),
    );

    expect(screen.getByRole("link", { name: "Kubernetes" })).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/kubernetes/c1a5e000-0000-4000-8000-000000000001`,
    );
    expect(
      screen.getByRole("link", { name: "payments/StatefulSet/postgres" }),
    ).toBeInTheDocument();
    for (const call of chartCardMock.mock.calls) {
      expect(
        ((call[0] as { description?: string }).description || "").length,
      ).toBeGreaterThan(0);
    }
  });
});

/*
 * The Metrics tab charts a clicked metric here, over the database's key set
 * (the explorer would chart the whole project). The query goes through the
 * scoped helper: keys only, no request at all without keys, each metric
 * charted by what it is — a curated counter as a per-second rate with no
 * aggregation to pick, a histogram by percentile, a cumulative counter as a
 * rate — with values in the metric's unit.
 */
describe("DatabaseMetricChartModal", () => {
  const KEY: string = "0123456789abcdef";

  type ChartProps = {
    title: string;
    loading?: boolean;
    yFormatter?: (value: number) => string;
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

  function shapeRow(row: Record<string, unknown>): void {
    getListAnalyticsMock.mockResolvedValue({ data: [row], count: 1 });
  }

  function renderChart(data: {
    metricName: string;
    keys: Array<string>;
    unit?: string;
    dbSystem?: string;
    initialTimeRange?: RangeStartAndEndDateTime;
    onClose?: () => void;
  }): void {
    render(
      <DatabaseMetricChartModal
        metricName={data.metricName}
        unit={data.unit}
        keys={data.keys}
        projectId={PROJECT_ID}
        dbSystem={data.dbSystem || "postgresql"}
        initialTimeRange={data.initialTimeRange}
        onClose={data.onClose || ((): void => {})}
      />,
    );
  }

  test("a curated counter is charted as a per-second rate over the key set", async () => {
    aggregateMock.mockResolvedValue({
      data: [
        { timestamp: at(0), value: 0, attributes: { "db.namespace": "a" } },
        { timestamp: at(1), value: 600, attributes: { "db.namespace": "a" } },
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
    // A curated metric needs no shape lookup.
    expect(getListAnalyticsMock).not.toHaveBeenCalled();

    const aggregateBy: Record<string, unknown> = lastAggregateBy();
    expect(aggregateBy["aggregationType"]).toBe(AggregationType.Max);
    expect(aggregateBy["groupBy"]).toEqual({ attributes: true });
    const query: Record<string, unknown> = aggregateBy["query"] as Record<
      string,
      unknown
    >;
    expect(query["name"]).toBe("postgresql.commits");
    expect((query["entityKeys"] as Includes).values).toEqual([KEY]);
    expect(query["attributes"]).toBeUndefined();
    /*
     * The axis carries the number; the unit is said once, by the title (a
     * 64 px axis clipped "2.5 commits/s" to "ommits/s").
     */
    expect(lastChart().yFormatter!(2.5)).toBe("2.5");
    expect(lastChart().title).toBe("postgresql.commits (per second)");
  });

  /*
   * e2e: MariaDB 11.4's mysql.buffer_pool.limit is its page count (8112),
   * sent under the receiver's unit "By" — the chart read it as "7.9 KiB".
   */
  test("MariaDB's buffer pool limit is charted as a page count, with a note saying why", async () => {
    shapeRow({ metricPointType: "Sum", isMonotonic: false });
    aggregateMock.mockResolvedValue({
      data: [{ timestamp: at(0), value: 8112 }],
    });

    renderChart({
      metricName: "mysql.buffer_pool.limit",
      keys: [KEY],
      unit: "By",
      dbSystem: "mariadb",
    });

    await waitFor(() => {
      expect(lastChart().loading).toBe(false);
    });
    expect(lastChart().series[0]!.data).toEqual([{ x: at(0), y: 8112 }]);
    expect(lastChart().title).toBe("mysql.buffer_pool.limit (pages)");
    expect(lastChart().yFormatter!(8112)).not.toMatch(/B\b/);
    expect(screen.getByTestId("database-metric-chart-note")).toHaveTextContent(
      "size in pages (Innodb_buffer_pool_pages_total), not in bytes",
    );
  });

  test("a gauge offers the aggregations and refetches on a change", async () => {
    shapeRow({ metricPointType: "Gauge", isMonotonic: false });
    aggregateMock.mockResolvedValue({
      data: [{ timestamp: at(0), value: 3 }],
    });

    renderChart({
      metricName: "db.client.connection.count",
      keys: [KEY],
      unit: "{connection}",
    });

    await waitFor(() => {
      expect(lastChart().loading).toBe(false);
    });
    expect(
      screen.getByRole("dialog", { name: "db.client.connection.count" }),
    ).toBeInTheDocument();
    expect(lastAggregateBy()["aggregationType"]).toBe(AggregationType.Avg);
    // The annotation word moves from every tick to the title.
    expect(lastChart().yFormatter!(3)).toBe("3");
    expect(lastChart().title).toBe("db.client.connection.count (connection)");

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

  test("a histogram opens on p95, offers percentiles and reads in its unit", async () => {
    shapeRow({
      metricPointType: "Histogram",
      isMonotonic: false,
      aggregationTemporality: "Cumulative",
    });
    aggregateMock.mockResolvedValue({
      data: [{ timestamp: at(0), value: 0.004 }],
    });

    renderChart({
      metricName: "db.client.operation.duration",
      keys: [KEY],
      unit: "s",
    });

    await waitFor(() => {
      expect(lastChart().loading).toBe(false);
    });
    expect(lastAggregateBy()["aggregationType"]).toBe(AggregationType.P95);
    const group: HTMLElement = screen.getByRole("group", {
      name: "Aggregation",
    });
    for (const label of ["p50", "p90", "p95", "p99", "Average"]) {
      expect(
        within(group).getByRole("button", { name: label }),
      ).toBeInTheDocument();
    }
    expect(
      within(group).queryByRole("button", { name: "Sum" }),
    ).not.toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "p95" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // 4 ms in seconds reads as a latency, not "0".
    expect(lastChart().yFormatter!(0.004)).toBe("4 ms");
    expect(screen.getByTestId("database-metric-chart-note")).toHaveTextContent(
      "percentiles",
    );

    fireEvent.click(within(group).getByRole("button", { name: "p99" }));
    await waitFor(() => {
      expect(lastAggregateBy()["aggregationType"]).toBe(AggregationType.P99);
    });
  });

  test("a cumulative counter outside the catalog is a per-second rate", async () => {
    shapeRow({
      metricPointType: "Sum",
      isMonotonic: true,
      aggregationTemporality: "Cumulative",
    });
    aggregateMock.mockResolvedValue({
      data: [
        { timestamp: at(0), value: 0, attributes: { "db.namespace": "a" } },
        { timestamp: at(1), value: 120, attributes: { "db.namespace": "a" } },
      ],
    });

    renderChart({ metricName: "postgresql.deadlocks", keys: [KEY], unit: "1" });

    await waitFor(() => {
      expect(lastChart().loading).toBe(false);
    });
    expect(
      screen.getByRole("dialog", { name: "postgresql.deadlocks (per second)" }),
    ).toBeInTheDocument();
    expect(lastChart().series[0]!.data).toEqual([{ x: at(1), y: 2 }]);
    expect(lastAggregateBy()["groupBy"]).toEqual({ attributes: true });
    expect(lastChart().yFormatter!(2)).toBe("2/s");
    expect(
      screen.queryByRole("group", { name: "Aggregation" }),
    ).not.toBeInTheDocument();
  });

  test("opens on the range the metric list shows", async () => {
    shapeRow({ metricPointType: "Gauge" });
    aggregateMock.mockResolvedValue({ data: [] });

    renderChart({
      metricName: "db.client.connection.count",
      keys: [KEY],
      initialTimeRange: { range: TimeRange.PAST_ONE_DAY },
    });

    expect(screen.getByTestId("time-range-picker")).toHaveTextContent(
      TimeRange.PAST_ONE_DAY,
    );
    await waitFor(() => {
      expect(lastChart().loading).toBe(false);
    });
    const start: Date = lastAggregateBy()["startTimestamp"] as Date;
    const end: Date = lastAggregateBy()["endTimestamp"] as Date;
    expect((end.getTime() - start.getTime()) / 3_600_000).toBeCloseTo(24, 0);
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
    expect(getListAnalyticsMock).not.toHaveBeenCalled();
    expect(lastChart().series[0]!.data).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
