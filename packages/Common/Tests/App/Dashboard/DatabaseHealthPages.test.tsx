import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A DATABASE'S HEALTH ON ITS PAGES, rendered for real against a stubbed
 * data layer: the Overview's health pill beside its liveness pill, its
 * Needs attention card (one row per kind of line crossed, the most urgent
 * first, each one step from where to look), the Database alerts card that
 * says which of its engine's alerts watch it, and the Databases list's
 * Status cell. The rules (DatabaseHealth) have their own suite; these hold
 * the pages to them.
 */

const PROJECT_ID_STRING: string = "21075038-d9f1-4d3a-b878-f64ae861f7be";
const DATABASE_ID_STRING: string = "42b6aaae-7558-42fe-999b-395bbfc79d63";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const alertsCardMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: () => {
        return Promise.resolve({ data: [] });
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0 });
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
        return new ObjectIDType("42b6aaae-7558-42fe-999b-395bbfc79d63");
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
        return new ObjectIDType("21075038-d9f1-4d3a-b878-f64ae861f7be");
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

// The sections the health does not touch are markers.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ChartCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="chart-card" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="auto-refresh" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="activity-cards" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseRuntimeSection",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="runtime-section" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseEngineMetricsSection",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="engine-section" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseCallingServicesCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="calling-services" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseServerUnscopedBanner",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="database-unscoped-banner" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatusSummaryCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="ai-agent-card" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartAlertsCard",
  () => {
    return {
      __esModule: true,
      default: (props: { testId: string; title: string }) => {
        alertsCardMock(props);
        return <div data-testid={props.testId}>{props.title}</div>;
      },
    };
  },
);

import DatabaseServerOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Overview";
import ResourceStatusCell from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceStatusCell";
import {
  DATABASE_HEALTH_DESCRIPTION,
  getDatabaseStatusCell,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseHealthPresentation";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "../../../Models/DatabaseModels/DatabaseServerEndpoint";
import Route from "../../../Types/API/Route";
import { assessDatabase } from "../../../Types/DatabaseServer/DatabaseHealth";
import { MonitorRecommendationResourceType } from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/test/databases/test"),
  currentProject: null,
  hasPaymentMethod: true,
};

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

const CALM_POSTGRESQL: Record<string, number> = {
  "Count|postgresql.connection.max|": 1,
  "Sum|postgresql.backends|": 20,
  "Sum|postgresql.connection.max|": 100,
  "Max|postgresql.wal.delay|operation=replay": 0.2,
  "Max|postgresql.replication.data_delay|": 100,
  "Max|postgresql.db_size|": 4_000_000_000,
};

function ordersDb(data: {
  readings?: Record<string, number> | undefined;
  status?: string | undefined;
  collectorLastSeenAt?: Date | undefined;
  readAt?: Date | undefined;
  dbSystem?: string | undefined;
}): DatabaseServer {
  const row: DatabaseServer = new DatabaseServer();
  row.id = new ObjectID(DATABASE_ID_STRING);
  row.projectId = new ObjectID(PROJECT_ID_STRING);
  row.name = "orders-db";
  row.dbSystem = data.dbSystem || "postgresql";
  row.serverAddress = "orders-db.internal";
  row.serverPort = 5432;
  row.discoverySource = "collector";
  row.lastSeenAt = minutesAgo(1);
  if (data.status) {
    row.otelCollectorStatus = data.status;
  }
  if (data.collectorLastSeenAt) {
    row.collectorLastSeenAt = data.collectorLastSeenAt;
  }
  if (data.readings) {
    const at: Date = data.readAt || minutesAgo(1);
    row.engineReadings = {
      instances: {
        "orders-db.internal:5432": {
          at: at.toISOString(),
          values: data.readings,
        },
      },
    };
    row.engineReadingsAt = at;
  }
  return row;
}

function serveEndpoints(): void {
  getListMock.mockImplementation((request: unknown) => {
    const modelType: unknown = (request as { modelType?: unknown }).modelType;
    if (modelType === DatabaseServerEndpoint) {
      const endpoint: DatabaseServerEndpoint = new DatabaseServerEndpoint();
      endpoint.endpoint = "orders-db.internal:5432";
      return Promise.resolve({ data: [endpoint], count: 1 });
    }
    return Promise.resolve({ data: [], count: 0 });
  });
}

async function renderOverview(row: DatabaseServer): Promise<void> {
  getItemMock.mockResolvedValue(row);
  serveEndpoints();
  render(
    <MemoryRouter>
      <DatabaseServerOverview {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await screen.findByText(/Engine metrics: /, undefined, { timeout: 3000 });
}

beforeEach(() => {
  getItemMock.mockReset();
  getListMock.mockReset();
  alertsCardMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("a database's Overview: its health beside its liveness", () => {
  test("connections at 96%: Unhealthy, and why first on the page", async () => {
    await renderOverview(
      ordersDb({
        status: "connected",
        collectorLastSeenAt: minutesAgo(2),
        readings: {
          ...CALM_POSTGRESQL,
          "Sum|postgresql.backends|": 96,
          "Max|postgresql.wal.delay|operation=replay": 42,
        },
      }),
    );

    const health: HTMLElement = screen.getByTestId("resource-overview-health");
    expect(health).toHaveTextContent("Unhealthy");
    expect(health).toHaveAttribute("data-health", "unhealthy");
    // The liveness pill still says what it always said.
    expect(screen.getByTestId("resource-overview-status")).toHaveTextContent(
      "Seen recently",
    );

    const card: HTMLElement = screen.getByTestId("database-needs-attention");
    const items: Array<HTMLElement> = within(card).getAllByTestId(
      "database-needs-attention-item",
    );
    expect(
      items.map((item: HTMLElement): [string | null, string | null] => {
        return [item.getAttribute("data-key"), item.getAttribute("data-severity")];
      }),
    ).toEqual([
      ["connections", "critical"],
      ["replication", "warning"],
    ]);
    expect(items[0]).toHaveTextContent("Connections");
    expect(items[0]).toHaveTextContent(
      "Connections at 96% of max_connections",
    );
    expect(items[1]).toHaveTextContent("A replica 42 s behind");
    // Each row opens where its numbers are; no kind chip on a list of one database.
    expect(within(items[0]!).getByRole("link")).toHaveAttribute(
      "href",
      expect.stringContaining(`/databases/${DATABASE_ID_STRING}/metrics`),
    );
    expect(
      within(card).queryByTestId("database-needs-attention-kind"),
    ).not.toBeInTheDocument();
    expect(
      within(card).getByTestId("database-needs-attention-summary"),
    ).toHaveTextContent("1 critical");
  });

  test("calm readings: Healthy, and no Needs attention card", async () => {
    await renderOverview(
      ordersDb({
        status: "connected",
        collectorLastSeenAt: minutesAgo(2),
        readings: CALM_POSTGRESQL,
      }),
    );
    expect(screen.getByTestId("resource-overview-health")).toHaveTextContent(
      "Healthy",
    );
    expect(
      screen.queryByTestId("database-needs-attention"),
    ).not.toBeInTheDocument();
  });

  test("its engine metrics stopped: Health Unknown, and the stop is what needs attention", async () => {
    await renderOverview(
      ordersDb({
        status: "disconnected",
        collectorLastSeenAt: minutesAgo(40),
        readAt: minutesAgo(38),
        readings: { ...CALM_POSTGRESQL, "Sum|postgresql.backends|": 99 },
      }),
    );
    const health: HTMLElement = screen.getByTestId("resource-overview-health");
    expect(health).toHaveTextContent("Health Unknown");
    expect(health).toHaveAttribute("data-health", "stopped");

    const items: Array<HTMLElement> = screen.getAllByTestId(
      "database-needs-attention-item",
    );
    expect(items.length).toBe(1);
    expect(items[0]).toHaveAttribute("data-severity", "critical");
    expect(items[0]).toHaveTextContent("Engine metrics stopped");
    // What it reported last (99% of max_connections) is not shown as current.
    expect(items[0]).not.toHaveTextContent("max_connections");
    expect(
      within(items[0]!).getByTestId("database-needs-attention-last-report"),
    ).toHaveTextContent(/Last reported/);
    // It opens the setup guide and its diagnostic script.
    expect(within(items[0]!).getByRole("link")).toHaveAttribute(
      "href",
      expect.stringContaining(`/databases/${DATABASE_ID_STRING}/documentation`),
    );
  });

  test("no engine metrics ever: no health pill (Healthy would be a guess), no card", async () => {
    await renderOverview(ordersDb({}));
    expect(
      screen.queryByTestId("resource-overview-health"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("database-needs-attention"),
    ).not.toBeInTheDocument();
  });

  test("an engine without recommended alerts reports with no health pill", async () => {
    await renderOverview(
      ordersDb({
        dbSystem: "cockroachdb",
        status: "connected",
        collectorLastSeenAt: minutesAgo(1),
        readings: CALM_POSTGRESQL,
      }),
    );
    expect(
      screen.queryByTestId("resource-overview-health"),
    ).not.toBeInTheDocument();
    // And no Database alerts card: there are none to offer.
    expect(screen.queryByTestId("database-alerts")).not.toBeInTheDocument();
  });

  test("the health pill says in an (i) what it is judged by", async () => {
    await renderOverview(
      ordersDb({
        status: "connected",
        collectorLastSeenAt: minutesAgo(2),
        readings: CALM_POSTGRESQL,
      }),
    );
    expect(DATABASE_HEALTH_DESCRIPTION).toContain(
      "recommended alerts fire at",
    );
    expect(
      screen.getByRole("button", { name: /Database Health/ }),
    ).toBeInTheDocument();
  });
});

describe("a database's Overview: which of its engine's alerts watch it", () => {
  test("the Database alerts card lists the engine's templates, scoped to this database", async () => {
    await renderOverview(
      ordersDb({
        status: "connected",
        collectorLastSeenAt: minutesAgo(2),
        readings: CALM_POSTGRESQL,
      }),
    );
    expect(screen.getByTestId("database-alerts")).toHaveTextContent(
      "Database alerts",
    );
    const props: {
      resourceType: string;
      templateIds: Array<string>;
      resourceIdentifier: string;
      context: { databaseEngine: string; databaseEngineMetricsReported: boolean };
      getRecommendationsRoute: (ids: Array<string>) => Route;
    } = alertsCardMock.mock.calls[0]![0] as never;
    expect(props.resourceType).toBe(
      MonitorRecommendationResourceType.DatabaseServer,
    );
    expect(props.resourceIdentifier).toBe(DATABASE_ID_STRING);
    expect(props.templateIds).toEqual([
      "database-postgresql-engine-metrics-stopped",
      "database-postgresql-connections-exhausted",
      "database-postgresql-connections-high",
      "database-postgresql-replica-replay-lag",
      "database-postgresql-replication-byte-lag",
      "database-postgresql-database-size",
    ]);
    expect(props.context).toEqual({
      databaseEngine: "postgresql",
      databaseEngineMetricsReported: true,
    });
    expect(
      props.getRecommendationsRoute(["a", "b"]).toString(),
    ).toContain(`/databases/${DATABASE_ID_STRING}/recommendations`);
  });

  test("a database whose engine metrics never arrived is offered none yet", async () => {
    await renderOverview(ordersDb({}));
    const props: {
      context: { databaseEngineMetricsReported: boolean };
    } = alertsCardMock.mock.calls[0]![0] as never;
    expect(props.context.databaseEngineMetricsReported).toBe(false);
  });
});

describe("the Databases list's Status cell", () => {
  const NOW: Date = new Date();

  function renderCell(row: DatabaseServer): HTMLElement {
    render(
      <ResourceStatusCell
        resource={getDatabaseStatusCell({
          assessment: assessDatabase(row, { now: NOW }),
          language: "en",
          now: NOW,
        })}
      />,
    );
    return document.body;
  }

  test("Unhealthy in red, the most urgent reason first and the rest counted", () => {
    const cell: HTMLElement = renderCell(
      ordersDb({
        status: "connected",
        collectorLastSeenAt: minutesAgo(2),
        readings: {
          ...CALM_POSTGRESQL,
          "Sum|postgresql.backends|": 97,
          "Max|postgresql.db_size|": 700_000_000_000,
        },
      }),
    );
    expect(within(cell).getByText("Unhealthy")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    expect(within(cell).getByTestId("resource-status-reason")).toHaveTextContent(
      "Connections at 97% of max_connections +1 more",
    );
  });

  test("Degraded in amber", () => {
    const cell: HTMLElement = renderCell(
      ordersDb({
        status: "connected",
        collectorLastSeenAt: minutesAgo(2),
        readings: {
          ...CALM_POSTGRESQL,
          "Max|postgresql.wal.delay|operation=replay": 61,
        },
      }),
    );
    expect(within(cell).getByText("Degraded")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(within(cell).getByTestId("resource-status-reason")).toHaveTextContent(
      "A replica 1 min behind",
    );
  });

  test("Healthy in green, nothing under it", () => {
    const cell: HTMLElement = renderCell(
      ordersDb({
        status: "connected",
        collectorLastSeenAt: minutesAgo(2),
        readings: CALM_POSTGRESQL,
      }),
    );
    expect(within(cell).getByText("Healthy")).toHaveAttribute(
      "data-tone",
      "positive",
    );
    expect(
      within(cell).queryByTestId("resource-status-reason"),
    ).not.toBeInTheDocument();
  });

  test("Engine metrics stopped in red, with when they last arrived", () => {
    // One clock for the row and the cell: three hours and a bit before it.
    const cell: HTMLElement = renderCell(
      ordersDb({
        status: "disconnected",
        collectorLastSeenAt: new Date(NOW.getTime() - 185 * 60 * 1000),
      }),
    );
    expect(within(cell).getByText("Engine metrics stopped")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    expect(within(cell).getByTestId("resource-status-reason")).toHaveTextContent(
      "Last reported 3 hours ago",
    );
  });

  test("No engine metrics, and Reporting, in grey", () => {
    renderCell(ordersDb({}));
    expect(screen.getByText("No engine metrics")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
    cleanup();
    renderCell(
      ordersDb({
        dbSystem: "cockroachdb",
        status: "connected",
        collectorLastSeenAt: minutesAgo(1),
      }),
    );
    expect(screen.getByText("Reporting")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
  });
});
