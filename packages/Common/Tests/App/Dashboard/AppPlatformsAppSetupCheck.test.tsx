import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * AN APP SERVICE APP'S OVERVIEW, RENDERED WITH THE PAGE'S OWN READS
 * (#6770, #10294).
 *
 * The customer's two App Service apps sent only metrics. #6792 made their
 * pages say what was missing; in 17.0.0 they still read "Azure Monitor:
 * Not connected" though their subscription's Azure connection was
 * connected, one Metrics row stood for two kinds of metrics, and the
 * Setup check went away while logs or Azure Monitor were still missing.
 * Here the Overview is mounted as its page mounts it - through
 * useCloudAppAzure, which reads the app's site, subscription and
 * connection - and the reads are answered as the server would:
 *
 *   - the Setup check lists every signal on a row of its own, with its
 *     status - Received, Not received, Needs setup - and what to do, for
 *     each set of signals an app sends: none, metrics only, metrics and
 *     traces, everything;
 *   - a connected subscription is never "Not connected": with no site of
 *     the app's name in it, the row says so, and the subscription is named;
 *   - once the site is found, the Azure Monitor section shows its numbers,
 *     and what Azure says of its instances and deployments fills what the
 *     telemetry does not name;
 *   - an app that sends everything leads with its numbers alone.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const harness: { StandInLineChart: unknown } = jest.requireActual(
    "./TimeRangeZoomPageHarness",
  ) as { StandInLineChart: unknown };
  return { __esModule: true, default: harness.StandInLineChart };
});

interface SpanReply {
  total: number;
  errors: number;
  errorRatePercent: number | null;
  p95DurationMs: number | null;
  failed?: boolean;
}

interface ListRequest {
  modelType: { name: string };
  query: Record<string, unknown>;
}

// What the reads answer, set by each test.
const mockReads: {
  span: SpanReply;
  sites: Array<unknown>;
  accounts: Array<unknown>;
  connections: Array<unknown>;
  siteRead: "answer" | "fail" | "pending";
  siteRequests: Array<ListRequest>;
  metricNames: Array<string>;
  metricValues: Record<string, number>;
  activity: unknown;
  activityReads: number;
  diagnosticLogsAt: Date | null;
} = {
  span: { total: 0, errors: 0, errorRatePercent: null, p95DurationMs: null },
  sites: [],
  accounts: [],
  connections: [],
  siteRead: "answer",
  siteRequests: [],
  metricNames: [],
  metricValues: {},
  activity: null,
  activityReads: 0,
  diagnosticLogsAt: null,
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics",
    ) as Record<string, unknown>;

    return {
      ...actual,
      fetchSpanMetrics: async (): Promise<unknown> => {
        if (mockReads.span.failed) {
          throw new Error("504 Gateway Timeout");
        }

        return {
          ...mockReads.span,
          countSeries: [],
          errorSeries: [],
          p95Series: [],
        };
      },
      fetchMetricSeries: async (scope: {
        name: string;
        start: Date;
      }): Promise<Array<{ x: Date; y: number }>> => {
        mockReads.metricNames.push(scope.name);
        const value: number | undefined = mockReads.metricValues[scope.name];

        return value === undefined ? [] : [{ x: scope.start, y: value }];
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppAzureReads",
  () => {
    return {
      fetchAppServiceSiteActivity: async (): Promise<unknown> => {
        mockReads.activityReads++;

        if (!mockReads.activity) {
          throw new Error("No cloud connection reads this App Service app.");
        }

        return mockReads.activity;
      },
      fetchSiteDiagnosticLogsLastReceivedAt: async (): Promise<Date | null> => {
        return mockReads.diagnosticLogsAt;
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: ListRequest): Promise<unknown> => {
        if (request.modelType.name === "CloudResource") {
          mockReads.siteRequests.push(request);

          if (mockReads.siteRead === "fail") {
            return Promise.reject(new Error("403"));
          }

          if (mockReads.siteRead === "pending") {
            return new Promise((): void => {});
          }
        }

        const data: Array<unknown> =
          request.modelType.name === "CloudResource"
            ? mockReads.sites
            : request.modelType.name === "CloudAccount"
              ? mockReads.accounts
              : mockReads.connections;

        return Promise.resolve({
          data,
          count: data.length,
          skip: 0,
          limit: 50,
        });
      },
      count: async (): Promise<number> => {
        return 4;
      },
    },
  };
});

import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import CloudAppRevision from "../../../Models/DatabaseModels/CloudAppRevision";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import CloudResourceInstance from "../../../Models/DatabaseModels/CloudResourceInstance";
import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import {
  AppServiceDeploymentStatus,
  AppServiceInstanceState,
  AppServiceSiteActivity,
} from "../../../Types/Cloud/AppServiceSiteActivity";
import CloudAppOverviewTab, {
  APP_INSTANCES_AS_AZURE_REPORTS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppOverviewTab";
import useCloudAppAzure, {
  CloudAppAzure,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/useCloudAppAzure";
import {
  CLOUD_APP_AZURE_MONITOR_HINT,
  CLOUD_APP_AZURE_SITE_NAME_HINT,
  CLOUD_APP_CHART_LOAD_FAILED,
  CLOUD_APP_INSTANCES_HINT,
  CLOUD_APP_NO_TRACES_NOTE,
  CLOUD_APP_NOT_REPORTED_NOTE,
  CLOUD_APP_REVISION_HINT,
  CLOUD_APP_ROW_NOT_CHECKED,
  CLOUD_APP_SERVICE_LOGS_HINT,
  CLOUD_APP_SET_UP_TELEMETRY,
  CLOUD_APP_SETUP_TITLE,
  CLOUD_APP_TRACES_HINT,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppTelemetrySetup";
import { APP_SERVICE_SITE_TYPE } from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppPlatformResource";
import { CLOUD_APP_CONNECT_AZURE } from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppSetupCheckCard";
import {
  AZURE_MONITOR_OPEN_RESOURCE,
  AZURE_MONITOR_SECTION_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppAzureMonitorCard";
import { QUIET_DASH_TEXT } from "../../Helpers/QuietDash";

const MINUTE_MS: number = 60 * 1000;
const APP_ID: string = "76000000-0000-4000-8000-000000000001";
const ENVIRONMENT_ID: string = "76100000-0000-4000-8000-000000000001";
const SITE_ROW_ID: string = "76200000-0000-4000-8000-000000000001";
const CONNECTION_ID: string = "76300000-0000-4000-8000-000000000001";
const SUBSCRIPTION: string = "d6252cc9-f01c-428b-924d-9896199f9a13";
const SITE: string = "azure-monitor-collector-northcentralus";
const SITE_ID: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-monitoring/providers/Microsoft.Web/sites/${SITE}`;
const INSTANCE_A: string =
  "8f0a3d1c2b4e6f8a0c2e4a6b8d0f1e3c5a7b9d1f3e5c7a9b1d3f5e7c9a1b3d5e";
const INSTANCE_B: string =
  "1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d";

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE_MS);
}

// The issue's environment: its subscription typed into cloud.account.id.
const APP_SERVICE_ENVIRONMENT: CloudResource = Object.assign(
  new CloudResource(),
  {
    _id: ENVIRONMENT_ID,
    name: `Azure App Service · northcentralus · ${SUBSCRIPTION}`,
    cloudPlatform: "azure_app_service",
    cloudProvider: "azure",
    cloudRegion: "northcentralus",
    cloudAccountId: SUBSCRIPTION,
  },
);

type CloudAppFields = { [K in keyof CloudApp]?: CloudApp[K] | undefined };

// The issue's app: running, sending metrics only, naming no instance or version.
function metricsOnlyApp(fields: CloudAppFields = {}): CloudApp {
  return Object.assign(new CloudApp(), {
    _id: APP_ID,
    cloudResourceId: ENVIRONMENT_ID,
    name: SITE,
    cloudPlatform: "azure_app_service",
    telemetryAttributes: { "service.name": SITE },
    lastSeenAt: minutesAgo(1),
    createdAt: minutesAgo(3 * 24 * 60),
    metricsLastReceivedAt: minutesAgo(1),
    signalArrivalsTrackedSince: minutesAgo(2 * 24 * 60),
    ...fields,
  });
}

// Everything: traces, logs, metrics, a version.
function everythingApp(fields: CloudAppFields = {}): CloudApp {
  return metricsOnlyApp({
    tracesLastReceivedAt: minutesAgo(1),
    logsLastReceivedAt: minutesAgo(2),
    currentRevision: "2026.11.1",
    revisionAttribute: "service.version",
    ...fields,
  });
}

function siteRow(fields: Record<string, unknown> = {}): CloudResource {
  return Object.assign(new CloudResource(), {
    _id: SITE_ROW_ID,
    name: SITE,
    cloudResourceKind: "resource",
    cloudResourceType: APP_SERVICE_SITE_TYPE,
    cloudProvider: "azure",
    cloudAccountId: SUBSCRIPTION,
    cloudRegion: "northcentralus",
    cloudConnectionId: CONNECTION_ID,
    providerResourceId: SITE_ID,
    telemetryAttributes: { "azuremonitor.resource_id": SITE_ID },
    cloudReadings: {
      requests: { value: 120, time: minutesAgo(6).toISOString() },
    },
    cloudReadingsAt: minutesAgo(4),
    lastSeenAt: minutesAgo(5),
    ...fields,
  });
}

function account(): CloudAccount {
  return Object.assign(new CloudAccount(), {
    _id: "76400000-0000-4000-8000-000000000001",
    name: "Production",
    accountId: SUBSCRIPTION,
    cloudConnectionId: CONNECTION_ID,
  });
}

function connection(fields: Record<string, unknown> = {}): CloudConnection {
  return Object.assign(new CloudConnection(), {
    _id: CONNECTION_ID,
    name: "Azure production",
    provider: "azure",
    config: { readIntervalInMinutes: 5 },
    isEnabled: true,
    lastPulledAt: minutesAgo(3),
    lastSuccessfulPullAt: minutesAgo(3),
    ...fields,
  });
}

function activity(
  fields: Partial<AppServiceSiteActivity> = {},
): AppServiceSiteActivity {
  return {
    readAt: new Date().toISOString(),
    instances: {
      items: [
        { id: INSTANCE_A, state: AppServiceInstanceState.Ready },
        { id: INSTANCE_B, state: AppServiceInstanceState.Ready },
      ],
    },
    deployments: {
      items: [
        {
          id: "4d1c9a8b7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b",
          status: AppServiceDeploymentStatus.Succeeded,
          active: true,
          author: "Ops Bot",
          deployer: "GitHub",
          message: "Merge pull request #212",
          startTime: minutesAgo(95).toISOString(),
          endTime: minutesAgo(90).toISOString(),
        },
      ],
    },
    image: null,
    ...fields,
  };
}

function instance(revision: string): CloudResourceInstance {
  return Object.assign(new CloudResourceInstance(), {
    cloudAppId: APP_ID,
    revision,
    lastSeenAt: minutesAgo(1),
  });
}

// The Overview as its page mounts it: through the page's own Azure reads.
const PageOverview: React.FunctionComponent<{
  app: CloudApp;
  instances: Array<CloudResourceInstance>;
  onSetUpTelemetry?: (() => void) | undefined;
}> = (props: {
  app: CloudApp;
  instances: Array<CloudResourceInstance>;
  onSetUpTelemetry?: (() => void) | undefined;
}): React.ReactElement => {
  const azure: CloudAppAzure = useCloudAppAzure({
    app: props.app,
    environment: APP_SERVICE_ENVIRONMENT,
    refreshToken: 0,
  });

  return (
    <CloudAppOverviewTab
      app={props.app}
      environment={APP_SERVICE_ENVIRONMENT}
      instances={props.instances}
      revisions={[] as Array<CloudAppRevision>}
      start={minutesAgo(60)}
      end={new Date()}
      refreshToken={0}
      azure={azure}
      onSetUpTelemetry={props.onSetUpTelemetry}
    />
  );
};

async function settle(): Promise<void> {
  for (let tick: number = 0; tick < 4; tick++) {
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void): void => {
        setTimeout(resolve, 0);
      });
    });
  }
}

async function renderTab(data: {
  app: CloudApp;
  instances?: Array<CloudResourceInstance>;
  onSetUpTelemetry?: (() => void) | undefined;
}): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <PageOverview
          app={data.app}
          instances={data.instances || []}
          onSetUpTelemetry={data.onSetUpTelemetry}
        />
      </MemoryRouter>,
    );
  });
  // The site, its connection and the metric reads settle on later ticks.
  await settle();
}

interface DrawnTile {
  title: string;
  value: string;
  note: string | null;
  sublabel: string;
}

// The app's own tiles, as drawn: a title, then a value or a note in its place.
function appTiles(): Array<DrawnTile> {
  return Array.from(screen.getByTestId("cloud-app-tiles").children).map(
    (tile: Element): DrawnTile => {
      return drawnTile(tile);
    },
  );
}

function drawnTile(tile: Element): DrawnTile {
  const note: Element | null = tile.querySelector(
    "[data-testid='resource-overview-tile-value-note']",
  );
  const value: Element | null = tile.querySelector(".text-2xl");
  // The line under the value (the title is small grey text too).
  const sublabel: Element | null = tile.querySelector("div.line-clamp-2");

  return {
    title: (tile.querySelector("span.uppercase")?.textContent || "").trim(),
    value: (value?.textContent || "").trim(),
    note: note ? (note.textContent || "").trim() : null,
    sublabel: (sublabel?.textContent || "").trim(),
  };
}

function tileOf(tiles: Array<DrawnTile>, title: string): DrawnTile {
  const tile: DrawnTile | undefined = tiles.find(
    (candidate: DrawnTile): boolean => {
      return candidate.title === title;
    },
  );

  expect({ title, found: Boolean(tile) }).toEqual({ title, found: true });

  return tile as DrawnTile;
}

interface DrawnRow {
  key: string;
  status: string;
  tone: string;
  label: string;
  statusLabel: string;
  text: string;
  hint: string | null;
}

function setupRows(): Array<DrawnRow> {
  return within(screen.getByTestId("cloud-app-setup-check"))
    .getAllByRole("listitem")
    .map((item: HTMLElement): DrawnRow => {
      const key: string = (item.getAttribute("data-testid") || "").replace(
        "cloud-app-setup-",
        "",
      );
      const hint: HTMLElement | null = within(item).queryByTestId(
        `cloud-app-setup-${key}-hint`,
      );

      return {
        key,
        status: item.getAttribute("data-status") || "",
        tone: item.getAttribute("data-tone") || "",
        label: (item.firstElementChild?.textContent || "").trim(),
        statusLabel: (
          within(item).getByTestId(`cloud-app-setup-${key}-status`)
            .textContent || ""
        ).trim(),
        text: (
          within(item).getByTestId(`cloud-app-setup-${key}-text`).textContent ||
          ""
        ).trim(),
        hint: hint ? (hint.textContent || "").trim() : null,
      };
    });
}

function rowOf(key: string): DrawnRow {
  const row: DrawnRow | undefined = setupRows().find(
    (candidate: DrawnRow): boolean => {
      return candidate.key === key;
    },
  );

  expect({ key, found: Boolean(row) }).toEqual({ key, found: true });

  return row as DrawnRow;
}

function statuses(): Array<[string, string]> {
  return setupRows().map((row: DrawnRow): [string, string] => {
    return [row.key, row.status];
  });
}

beforeEach(() => {
  mockReads.span = {
    total: 0,
    errors: 0,
    errorRatePercent: null,
    p95DurationMs: null,
  };
  mockReads.sites = [];
  // The issue: the subscription IS connected.
  mockReads.accounts = [account()];
  mockReads.connections = [connection()];
  mockReads.siteRead = "answer";
  mockReads.siteRequests = [];
  mockReads.metricNames = [];
  mockReads.metricValues = {};
  mockReads.activity = null;
  mockReads.activityReads = 0;
  mockReads.diagnosticLogsAt = null;
});

afterEach(() => {
  cleanup();
});

describe("the Setup check, for each set of signals an App Service app sends", () => {
  test("none - not even a subscription connected: each row says what to set up, the connection first", async () => {
    mockReads.accounts = [];
    mockReads.connections = [];

    await renderTab({
      app: metricsOnlyApp({ metricsLastReceivedAt: undefined }),
    });

    expect(statuses()).toEqual([
      ["azure-monitor", "needs-setup"],
      ["azure-monitor-metrics", "needs-setup"],
      ["traces", "needs-setup"],
      ["metrics", "not-set-up"],
      ["logs", "needs-setup"],
      ["instances", "needs-setup"],
      ["revision", "needs-setup"],
    ]);
    expect(rowOf("azure-monitor")).toEqual(
      expect.objectContaining({
        statusLabel: "Not connected",
        text: "No Azure subscription is connected yet.",
        hint: CLOUD_APP_AZURE_MONITOR_HINT,
      }),
    );

    const connect: HTMLElement = screen.getByTestId(
      "cloud-app-setup-azure-monitor-action",
    );

    expect(connect).toHaveTextContent(CLOUD_APP_CONNECT_AZURE);
    expect(connect.getAttribute("href")).toMatch(/\/cloud\/connect$/);
  });

  test("metrics only - the issue's apps: their connected subscription is named, and what is missing is the site", async () => {
    await renderTab({ app: metricsOnlyApp() });

    const card: HTMLElement = screen.getByTestId("cloud-app-setup-check");

    // First on the page, above the tiles.
    expect(screen.getByTestId("cloud-app-overview").firstElementChild).toBe(
      card,
    );
    expect(within(card).getByText(CLOUD_APP_SETUP_TITLE)).toBeInTheDocument();

    expect(statuses()).toEqual([
      ["azure-monitor", "needs-setup"],
      ["azure-monitor-metrics", "needs-setup"],
      ["traces", "needs-setup"],
      ["metrics", "received"],
      ["logs", "needs-setup"],
      ["instances", "needs-setup"],
      ["revision", "needs-setup"],
    ]);

    expect(rowOf("azure-monitor")).toEqual({
      key: "azure-monitor",
      status: "needs-setup",
      tone: "setup",
      label: "Azure Monitor connection",
      statusLabel: "Needs setup",
      text: `Subscription ${SUBSCRIPTION} is connected, but holds no App Service app named ${SITE}.`,
      hint: CLOUD_APP_AZURE_SITE_NAME_HINT,
    });
    // "Not connected" is said of no row: the subscription is.
    expect(within(card).queryByText("Not connected")).toBeNull();
    expect(
      screen.queryByTestId("cloud-app-setup-azure-monitor-action"),
    ).toBeNull();

    expect(rowOf("metrics")).toEqual(
      expect.objectContaining({
        label: "OpenTelemetry metrics",
        statusLabel: "Received",
      }),
    );
    expect(rowOf("metrics").text).toMatch(/^The latest came in .+\.$/);
    expect(rowOf("traces")).toEqual(
      expect.objectContaining({ hint: CLOUD_APP_TRACES_HINT }),
    );
    expect(rowOf("traces").text).toMatch(/^None since .+\.$/);
    expect(rowOf("logs").hint).toBe(CLOUD_APP_SERVICE_LOGS_HINT);
    expect(rowOf("instances")).toEqual(
      expect.objectContaining({
        text: "Not reported",
        hint: CLOUD_APP_INSTANCES_HINT,
      }),
    );
    expect(rowOf("revision")).toEqual(
      expect.objectContaining({
        label: "Revision",
        text: "Not reported",
        hint: CLOUD_APP_REVISION_HINT,
      }),
    );
  });

  test("metrics and traces, its site found: Azure Monitor connected and arriving, and still logs, instances and version", async () => {
    mockReads.sites = [siteRow()];

    await renderTab({
      app: metricsOnlyApp({ tracesLastReceivedAt: minutesAgo(1) }),
    });

    expect(statuses()).toEqual([
      ["azure-monitor", "received"],
      ["azure-monitor-metrics", "received"],
      ["traces", "received"],
      ["metrics", "received"],
      ["logs", "needs-setup"],
      ["instances", "needs-setup"],
      ["revision", "needs-setup"],
    ]);
    expect(rowOf("azure-monitor")).toEqual(
      expect.objectContaining({
        statusLabel: "Connected",
        text: `The connection Azure production reads ${SITE} in subscription ${SUBSCRIPTION}.`,
      }),
    );
  });

  test("everything: no Setup check, and the page is its numbers", async () => {
    mockReads.sites = [siteRow()];
    mockReads.activity = activity();

    await renderTab({
      app: everythingApp(),
      instances: [instance("2026.11.1")],
    });

    expect(screen.queryByTestId("cloud-app-setup-check")).toBeNull();
    expect(screen.getByTestId("cloud-app-azure-monitor")).toBeInTheDocument();
  });

  test("everything but logs from the app: its site's diagnostic logs count, and there is nothing to set up", async () => {
    mockReads.sites = [siteRow()];
    mockReads.activity = activity();
    mockReads.diagnosticLogsAt = minutesAgo(3);

    await renderTab({
      app: everythingApp({ logsLastReceivedAt: undefined }),
      instances: [instance("2026.11.1")],
    });

    expect(screen.queryByTestId("cloud-app-setup-check")).toBeNull();
  });

  test("its traces and logs rows lead to the steps that send them, when the page has them", async () => {
    let opened: number = 0;

    await renderTab({
      app: metricsOnlyApp(),
      onSetUpTelemetry: (): void => {
        opened++;
      },
    });

    const traces: HTMLElement = screen.getByTestId(
      "cloud-app-setup-traces-action",
    );

    expect(traces).toHaveTextContent(CLOUD_APP_SET_UP_TELEMETRY);

    await act(async () => {
      traces.click();
    });
    await act(async () => {
      screen.getByTestId("cloud-app-setup-logs-action").click();
    });

    expect(opened).toBe(2);
  });
});

describe("the site's look-up", () => {
  test("by its ARM id, never by a row's name", async () => {
    await renderTab({ app: metricsOnlyApp() });

    expect(mockReads.siteRequests).toHaveLength(1);

    const query: Record<string, unknown> = mockReads.siteRequests[0]!.query;

    expect(query["cloudResourceType"]).toBe(APP_SERVICE_SITE_TYPE);
    expect(query["cloudProvider"]).toBe("azure");
    expect(query["name"]).toBeUndefined();
    expect(query["providerResourceId"]).toBeInstanceOf(EndsWith);
    expect((query["providerResourceId"] as EndsWith<string>).toString()).toBe(
      `/providers/microsoft.web/sites/${SITE}`,
    );
  });

  test("a failed look-up says it could not check - never 'not connected' - and shows no section", async () => {
    mockReads.siteRead = "fail";

    await renderTab({ app: metricsOnlyApp() });

    expect(screen.queryByTestId("cloud-app-azure-monitor")).toBeNull();
    expect(rowOf("azure-monitor")).toEqual(
      expect.objectContaining({
        status: "not-available",
        text: CLOUD_APP_ROW_NOT_CHECKED,
      }),
    );
  });

  test("while the look-up is out, the row says it is checking", async () => {
    mockReads.siteRead = "pending";

    await renderTab({ app: metricsOnlyApp() });

    expect(rowOf("azure-monitor")).toEqual(
      expect.objectContaining({
        status: "checking",
        tone: "waiting",
        text: "Checking…",
        hint: null,
      }),
    );
  });

  test("an app of a staging slot is not looked up, and the row says why", async () => {
    mockReads.sites = [siteRow()];

    await renderTab({ app: metricsOnlyApp({ groupName: "staging" }) });

    expect(mockReads.siteRequests).toHaveLength(0);
    expect(screen.queryByTestId("cloud-app-azure-monitor")).toBeNull();
    expect(rowOf("azure-monitor")).toEqual(
      expect.objectContaining({
        status: "not-available",
        text: "It runs in deployment slot staging, which Azure Monitor reports as a resource of its own that OneUptime does not read yet.",
      }),
    );
  });
});

describe("once the site is found", () => {
  beforeEach(() => {
    mockReads.sites = [siteRow()];
    mockReads.metricValues = {
      azure_requests_total: 1200,
      azure_http5xx_total: 24,
      azure_http4xx_total: 60,
      azure_httpresponsetime_average: 0.25,
      azure_cputime_total: 90,
      azure_memoryworkingset_average: 512 * 1024 * 1024,
    };
  });

  test("an Azure Monitor section shows the site's numbers, whatever the app sends", async () => {
    await renderTab({ app: metricsOnlyApp() });

    const section: HTMLElement = screen.getByTestId("cloud-app-azure-monitor");

    expect(
      within(section).getByRole("heading", {
        name: AZURE_MONITOR_SECTION_TITLE,
      }),
    ).toBeInTheDocument();

    const tiles: Array<DrawnTile> = Array.from(
      within(section).getByTestId("cloud-app-azure-monitor-tiles").children,
    ).map(drawnTile);

    expect(tileOf(tiles, "Requests").value).toBe("1.2k");
    expect(tileOf(tiles, "Server errors").value).toBe("2.0%");
    expect(tileOf(tiles, "Server errors").sublabel).toBe("24 errored");
    expect(tileOf(tiles, "Response time").value).toBe("250 ms");
    // 90 s of CPU reads as a duration, not "90.00 s".
    expect(tileOf(tiles, "CPU time").value).toBe("1m 30s");
    expect(tileOf(tiles, "Memory").value).toBe("512 MiB");
  });

  test("its heading links to the site's own page", async () => {
    await renderTab({ app: metricsOnlyApp() });

    const open: HTMLElement = screen.getByTestId(
      "cloud-app-azure-monitor-open",
    );

    expect(open).toHaveTextContent(AZURE_MONITOR_OPEN_RESOURCE);
    expect(open.getAttribute("href")).toContain(SITE_ROW_ID);
  });

  test("the app's own CPU and Memory, which App Service never fills, give way to the site's: four tiles in one row", async () => {
    await renderTab({ app: metricsOnlyApp() });

    expect(
      appTiles().map((tile: DrawnTile): string => {
        return tile.title;
      }),
    ).toEqual(["Requests", "Error rate", "p95 latency", "Instances"]);
    expect(screen.getByTestId("cloud-app-tiles").className).toContain(
      "lg:grid-cols-4",
    );
    expect(
      screen.queryByText("Not on Azure App Service"),
    ).not.toBeInTheDocument();
  });

  test("without the site, the two tiles stay and say why they hold no number", async () => {
    mockReads.sites = [];

    await renderTab({ app: metricsOnlyApp() });

    expect(
      appTiles().map((tile: DrawnTile): string => {
        return tile.title;
      }),
    ).toEqual([
      "Requests",
      "Error rate",
      "p95 latency",
      "Instances",
      "CPU",
      "Memory",
    ]);
  });

  test("Azure's instances count on the Instances tile while the telemetry names none, and the deployment stands for the revision", async () => {
    mockReads.activity = activity();

    await renderTab({ app: metricsOnlyApp() });

    expect(mockReads.activityReads).toBe(1);
    expect(tileOf(appTiles(), "Instances")).toEqual(
      expect.objectContaining({
        value: "2",
        note: null,
        sublabel: APP_INSTANCES_AS_AZURE_REPORTS,
      }),
    );
    expect(rowOf("instances")).toEqual(
      expect.objectContaining({
        status: "received",
        text: "Azure runs 2 instances.",
      }),
    );
    expect(rowOf("revision")).toEqual(
      expect.objectContaining({ status: "received" }),
    );
    expect(rowOf("revision").text).toMatch(
      /^Azure's latest deployment, 4d1c9a8, finished .+\.$/,
    );
  });

  test("Azure's instances that could not be read leave the tile's note, never a 0", async () => {
    mockReads.activity = null;

    await renderTab({ app: metricsOnlyApp() });

    expect(tileOf(appTiles(), "Instances").note).toBe(
      CLOUD_APP_NOT_REPORTED_NOTE,
    );
  });
});

describe("an app that sends traces, names its instances and its version", () => {
  beforeEach(() => {
    mockReads.sites = [siteRow()];
  });

  test("reads its numbers and charts, with no notes", async () => {
    mockReads.span = {
      total: 1200,
      errors: 12,
      errorRatePercent: 1,
      p95DurationMs: 180,
    };

    await renderTab({
      app: everythingApp(),
      instances: [instance("2026.11.1"), instance("2026.11.1")],
    });

    expect(screen.queryByTestId("cloud-app-setup-check")).toBeNull();
    expect(screen.getByTestId("cloud-app-trace-charts")).toBeInTheDocument();

    const tiles: Array<DrawnTile> = appTiles();

    expect(tileOf(tiles, "Requests")).toEqual(
      expect.objectContaining({ value: "1.2k", note: null }),
    );
    expect(tileOf(tiles, "Error rate")).toEqual(
      expect.objectContaining({ value: "1.0%", note: null }),
    );
    expect(tileOf(tiles, "Instances")).toEqual(
      expect.objectContaining({ value: "2", note: null }),
    );
  });

  test("an app whose traces arrive and that served nothing reads a real 0", async () => {
    await renderTab({
      app: everythingApp({ tracesLastReceivedAt: minutesAgo(30) }),
      instances: [instance("2026.11.1")],
    });

    expect(tileOf(appTiles(), "Requests")).toEqual(
      expect.objectContaining({ value: "0", note: null }),
    );
    expect(screen.getByTestId("cloud-app-trace-charts")).toBeInTheDocument();
  });

  test("a span read that fails is unknown: a dash that says it could not load, never No traces received", async () => {
    mockReads.span = {
      total: 0,
      errors: 0,
      errorRatePercent: null,
      p95DurationMs: null,
      failed: true,
    };

    await renderTab({ app: metricsOnlyApp() });

    const requests: DrawnTile = tileOf(appTiles(), "Requests");

    expect(requests).toEqual(
      expect.objectContaining({
        value: QUIET_DASH_TEXT,
        note: null,
        sublabel: "could not load",
      }),
    );
    expect(requests.note).not.toBe(CLOUD_APP_NO_TRACES_NOTE);
    expect(
      within(screen.getByTestId("cloud-app-trace-charts")).getAllByText(
        CLOUD_APP_CHART_LOAD_FAILED,
      ).length,
    ).toBeGreaterThan(0);
  });
});
