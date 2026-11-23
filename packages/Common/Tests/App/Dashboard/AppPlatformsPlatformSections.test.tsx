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
 * EACH MANAGED PLATFORM'S OWN NUMBERS ON ITS APP'S PAGE (#6794).
 *
 * A Container App, a Cloud Run, App Engine, App Runner or ECS service is
 * measured by its provider whatever the app sends - by Azure Monitor,
 * Google Cloud Monitoring or Amazon CloudWatch - and a connected account
 * brings each in as a Cloud Resource. The Overview is mounted here as its
 * page mounts it, through useCloudAppPlatform, and the reads are answered
 * as the server would:
 *
 *   - once the resource is found, a section named after the provider's
 *     service shows what it measured - each platform's own figures, Cloud
 *     Run's and App Engine's server errors read from their request count
 *     by response code - and links to the resource's own page;
 *   - the Setup check's row for it says Checking while it is looked up,
 *     Connected once it is found, Not connected with what to connect, or
 *     what is looked for, while it is not - and is left out when the
 *     look-up fails;
 *   - where the section shows CPU and memory, the app's own CPU and Memory
 *     tiles, which would only say "Not reported" above them, give way; an
 *     App Engine app, whose section has neither, keeps them.
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

interface ListRequest {
  modelType: { name: string };
  query: Record<string, unknown>;
}

interface MetricAsk {
  name: string;
  attributes: Record<string, string>;
  groupBy?: string | undefined;
}

// What the reads answer, set by each test.
const mockReads: {
  resources: Array<unknown>;
  resourceRead: "answer" | "fail" | "pending";
  resourceRequests: Array<ListRequest>;
  connections: number;
  connectionCounts: Array<ListRequest>;
  // Each metric's points, by its stored name.
  metricValues: Record<string, number>;
  // A grouped read's groups, by the stored name it reads.
  groupedValues: Record<string, Array<{ group: string; value: number }>>;
  asks: Array<MetricAsk>;
} = {
  resources: [],
  resourceRead: "answer",
  resourceRequests: [],
  connections: 1,
  connectionCounts: [],
  metricValues: {},
  groupedValues: {},
  asks: [],
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
        return {
          total: 0,
          errors: 0,
          errorRatePercent: null,
          p95DurationMs: null,
          countSeries: [],
          errorSeries: [],
          p95Series: [],
        };
      },
      fetchMetricSeries: async (
        scope: {
          name: string;
          attributes: Record<string, string>;
          start: Date;
        },
        scale: number = 1,
      ): Promise<Array<{ x: Date; y: number }>> => {
        mockReads.asks.push({ name: scope.name, attributes: scope.attributes });
        const value: number | undefined = mockReads.metricValues[scope.name];

        return value === undefined
          ? []
          : [{ x: scope.start, y: value * scale }];
      },
      fetchGroupedMetricSeries: async (scope: {
        name: string;
        attributes: Record<string, string>;
        start: Date;
        groupBy: string;
      }): Promise<Array<{ x: Date; group: string; y: number }>> => {
        mockReads.asks.push({
          name: scope.name,
          attributes: scope.attributes,
          groupBy: scope.groupBy,
        });

        return (mockReads.groupedValues[scope.name] || []).map(
          (entry: { group: string; value: number }) => {
            return { x: scope.start, group: entry.group, y: entry.value };
          },
        );
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
          mockReads.resourceRequests.push(request);

          if (mockReads.resourceRead === "fail") {
            return Promise.reject(new Error("403"));
          }

          if (mockReads.resourceRead === "pending") {
            return new Promise((): void => {});
          }
        }

        const data: Array<unknown> =
          request.modelType.name === "CloudResource" ? mockReads.resources : [];

        return Promise.resolve({
          data,
          count: data.length,
          skip: 0,
          limit: 50,
        });
      },
      count: async (request: ListRequest): Promise<number> => {
        mockReads.connectionCounts.push(request);
        return mockReads.connections;
      },
    },
  };
});

import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import CloudAppRevision from "../../../Models/DatabaseModels/CloudAppRevision";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import CloudResourceInstance from "../../../Models/DatabaseModels/CloudResourceInstance";
import CloudAppOverviewTab from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppOverviewTab";
import useCloudAppPlatform, {
  CloudAppPlatform,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/useCloudAppPlatform";
import {
  CLOUD_APP_PLATFORM_CONNECT_HINT,
  CLOUD_APP_PLATFORM_NOT_FOUND_HINT,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppTelemetrySetup";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";

const MINUTE_MS: number = 60 * 1000;
const APP_ID: string = "77000000-0000-4000-8000-000000000001";
const ENVIRONMENT_ID: string = "77100000-0000-4000-8000-000000000001";
const RESOURCE_ID: string = "77200000-0000-4000-8000-000000000001";
const SUBSCRIPTION: string = "d6252cc9-f01c-428b-924d-9896199f9a13";

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE_MS);
}

interface PlatformCase {
  platform: string;
  environment: { cloudAccountId: string; cloudRegion: string };
  app: { name: string; groupName?: string };
  resource: Record<string, unknown>;
}

const CASES: Record<string, PlatformCase> = {
  containerApps: {
    platform: "azure_container_apps",
    environment: { cloudAccountId: SUBSCRIPTION, cloudRegion: "eastus" },
    app: { name: "checkout" },
    resource: {
      name: "checkout (Container App)",
      cloudProvider: "azure",
      cloudResourceType: "Microsoft.App/containerApps",
      cloudRegion: "eastus",
      providerResourceId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-apps/providers/Microsoft.App/containerApps/checkout`,
      telemetryAttributes: {
        "azuremonitor.resource_id": `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-apps/providers/Microsoft.App/containerApps/checkout`,
      },
    },
  },
  cloudRun: {
    platform: "gcp_cloud_run",
    environment: { cloudAccountId: "shop-prod", cloudRegion: "us-central1" },
    app: { name: "checkout" },
    resource: {
      name: "checkout (Cloud Run Service)",
      cloudProvider: "gcp",
      cloudResourceType: "cloud_run_revision",
      cloudAccountId: "shop-prod",
      providerResourceId:
        "//run.googleapis.com/projects/shop-prod/locations/us-central1/services/checkout",
      telemetryAttributes: {
        "resource.gcp.resource_type": "cloud_run_revision",
        "resource.project_id": "shop-prod",
        "resource.location": "us-central1",
        "resource.service_name": "checkout",
      },
    },
  },
  appEngine: {
    platform: "gcp_app_engine",
    environment: { cloudAccountId: "shop-prod", cloudRegion: "us-central1" },
    app: { name: "default" },
    resource: {
      name: "default (App Engine Service)",
      cloudProvider: "gcp",
      cloudResourceType: "gae_app",
      cloudAccountId: "shop-prod",
      providerResourceId:
        "//appengine.googleapis.com/apps/shop-prod/services/default",
      telemetryAttributes: {
        "resource.gcp.resource_type": "gae_app",
        "resource.project_id": "shop-prod",
        "resource.module_id": "default",
      },
    },
  },
  appRunner: {
    platform: "aws_app_runner",
    environment: { cloudAccountId: "123456789012", cloudRegion: "us-east-1" },
    app: { name: "checkout" },
    resource: {
      name: "checkout (App Runner Service)",
      cloudProvider: "aws",
      cloudResourceType: "AWS::AppRunner::Service",
      providerResourceId:
        "arn:aws:apprunner:us-east-1:123456789012:service/checkout/8fe1e10304f84fd2b0df550fe98a71fa",
      telemetryAttributes: {
        Namespace: "AWS/AppRunner",
        "Dimensions.ServiceName": "checkout",
        "resource.cloud.account.id": "123456789012",
        "resource.cloud.region": "us-east-1",
      },
    },
  },
  ecs: {
    platform: "aws_ecs",
    environment: { cloudAccountId: "123456789012", cloudRegion: "us-east-1" },
    app: { name: "checkout", groupName: "prod" },
    resource: {
      name: "web (prod)",
      cloudProvider: "aws",
      cloudResourceType: "AWS::ECS::Service",
      providerResourceId: "arn:aws:ecs:us-east-1:123456789012:service/prod/web",
      cloudProperties: {
        TaskDefinition:
          "arn:aws:ecs:us-east-1:123456789012:task-definition/checkout:14",
      },
      telemetryAttributes: {
        Namespace: "AWS/ECS",
        "Dimensions.ClusterName": "prod",
        "Dimensions.ServiceName": "web",
        "resource.cloud.account.id": "123456789012",
        "resource.cloud.region": "us-east-1",
      },
    },
  },
};

function environmentOf(entry: PlatformCase): CloudResource {
  return Object.assign(new CloudResource(), {
    _id: ENVIRONMENT_ID,
    name: entry.platform,
    cloudPlatform: entry.platform,
    ...entry.environment,
  });
}

// A running app that sends metrics only: no trace, no instance, no version.
function appOf(
  entry: PlatformCase,
  fields: Record<string, unknown> = {},
): CloudApp {
  return Object.assign(new CloudApp(), {
    _id: APP_ID,
    cloudResourceId: ENVIRONMENT_ID,
    cloudPlatform: entry.platform,
    telemetryAttributes: { "service.name": entry.app.name },
    lastSeenAt: minutesAgo(1),
    createdAt: minutesAgo(3 * 24 * 60),
    metricsLastReceivedAt: minutesAgo(1),
    signalArrivalsTrackedSince: minutesAgo(2 * 24 * 60),
    ...entry.app,
    ...fields,
  });
}

function resourceOf(entry: PlatformCase): CloudResource {
  return Object.assign(new CloudResource(), {
    _id: RESOURCE_ID,
    cloudResourceKind: "resource",
    lastSeenAt: minutesAgo(5),
    cloudReadings: {},
    ...entry.resource,
  });
}

const PageOverview: React.FunctionComponent<{
  app: CloudApp;
  environment: CloudResource;
}> = (props: {
  app: CloudApp;
  environment: CloudResource;
}): React.ReactElement => {
  const platform: CloudAppPlatform = useCloudAppPlatform({
    app: props.app,
    environment: props.environment,
    refreshToken: 0,
  });

  return (
    <CloudAppOverviewTab
      app={props.app}
      environment={props.environment}
      instances={[] as Array<CloudResourceInstance>}
      revisions={[] as Array<CloudAppRevision>}
      start={minutesAgo(60)}
      end={new Date()}
      refreshToken={0}
      platform={platform}
      onSetUpTelemetry={() => {}}
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

async function renderCase(
  entry: PlatformCase,
  fields: Record<string, unknown> = {},
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <PageOverview
          app={appOf(entry, fields)}
          environment={environmentOf(entry)}
        />
      </MemoryRouter>,
    );
  });
  await settle();
}

interface DrawnTile {
  title: string;
  value: string;
  sublabel: string;
}

function drawnTile(tile: Element): DrawnTile {
  const value: Element | null = tile.querySelector(".text-2xl");
  const note: Element | null = tile.querySelector(
    "[data-testid='resource-overview-tile-value-note']",
  );
  const sublabel: Element | null = tile.querySelector("div.line-clamp-2");

  return {
    title: (tile.querySelector("span.uppercase")?.textContent || "").trim(),
    value: (note?.textContent || value?.textContent || "").trim(),
    sublabel: (sublabel?.textContent || "").trim(),
  };
}

function sectionTiles(): Record<string, DrawnTile> {
  const tiles: Record<string, DrawnTile> = {};

  for (const tile of Array.from(
    screen.getByTestId("cloud-app-platform-monitor-tiles").children,
  ).map(drawnTile)) {
    tiles[tile.title] = tile;
  }

  return tiles;
}

function appTileTitles(): Array<string> {
  return Array.from(screen.getByTestId("cloud-app-tiles").children).map(
    (tile: Element): string => {
      return drawnTile(tile).title;
    },
  );
}

interface DrawnRow {
  key: string;
  status: string;
  label: string;
  statusLabel: string;
  text: string;
  hint: string | null;
}

function platformRow(): DrawnRow | null {
  const item: HTMLElement | null = screen.queryByTestId(
    "cloud-app-setup-platform-monitor",
  );

  if (!item) {
    return null;
  }

  const hint: HTMLElement | null = within(item).queryByTestId(
    "cloud-app-setup-platform-monitor-hint",
  );

  return {
    key: "platform-monitor",
    status: item.getAttribute("data-status") || "",
    label: (item.firstElementChild?.textContent || "").trim(),
    statusLabel: (
      within(item).getByTestId("cloud-app-setup-platform-monitor-status")
        .textContent || ""
    ).trim(),
    text: (
      within(item).getByTestId("cloud-app-setup-platform-monitor-text")
        .textContent || ""
    ).trim(),
    hint: hint ? (hint.textContent || "").trim() : null,
  };
}

beforeEach(() => {
  mockReads.resources = [];
  mockReads.resourceRead = "answer";
  mockReads.resourceRequests = [];
  mockReads.connections = 1;
  mockReads.connectionCounts = [];
  mockReads.metricValues = {};
  mockReads.groupedValues = {};
  mockReads.asks = [];
});

afterEach(() => {
  cleanup();
});

describe("a Container App's Azure Monitor section", () => {
  test("its requests, response time, CPU, memory and restarts, read by its ARM id - and no 5xx share it does not have", async () => {
    mockReads.resources = [resourceOf(CASES["containerApps"]!)];
    mockReads.metricValues = {
      azure_requests_total: 4200,
      azure_responsetime_average: 85,
      azure_cpupercentage_average: 37.5,
      azure_workingsetbytes_average: 256 * 1024 * 1024,
      azure_restartcount_total: 2,
    };

    await renderCase(CASES["containerApps"]!);

    const section: HTMLElement = screen.getByTestId(
      "cloud-app-platform-monitor",
    );
    expect(
      within(section).getByRole("heading", { name: "Azure Monitor" }),
    ).toBeInTheDocument();

    const tiles: Record<string, DrawnTile> = sectionTiles();
    expect(Object.keys(tiles)).toEqual([
      "Requests",
      "Response time",
      "CPU",
      "Memory",
      "Restarts",
    ]);
    expect(tiles["Requests"]!.value).toBe("4.2k");
    expect(tiles["Response time"]!.value).toBe("85\u00A0ms");
    expect(tiles["CPU"]!.value).toBe("37.5%");
    expect(tiles["Memory"]!.value).toBe("256\u00A0MiB");
    expect(tiles["Restarts"]!.value).toBe("2");

    // Every read is scoped to the Container App's own ARM id.
    for (const ask of mockReads.asks) {
      expect(ask.attributes).toEqual(
        (CASES["containerApps"]!.resource as { telemetryAttributes: unknown })
          .telemetryAttributes,
      );
    }
    expect(
      screen
        .getByTestId("cloud-app-platform-monitor-open")
        .getAttribute("href"),
    ).toContain(RESOURCE_ID);
  });

  test("its Setup row is Azure Monitor's, Connected, and its own CPU and Memory tiles give way", async () => {
    mockReads.resources = [resourceOf(CASES["containerApps"]!)];

    await renderCase(CASES["containerApps"]!);

    expect(platformRow()).toEqual({
      key: "platform-monitor",
      status: "received",
      label: "Azure Monitor connection",
      statusLabel: "Connected",
      text: "OneUptime reads checkout (Container App).",
      hint: "Its numbers, as Azure Monitor measures them, are below.",
    });
    expect(appTileTitles()).toEqual([
      "Requests",
      "Error rate",
      "p95 latency",
      "Instances",
    ]);
  });
});

describe("a Cloud Run service's Google Cloud Monitoring section", () => {
  test("its requests and server errors from one read of its request count by response_code_class, its p95, CPU and memory", async () => {
    mockReads.resources = [resourceOf(CASES["cloudRun"]!)];
    mockReads.groupedValues = {
      // Each a minute's rate: 3 a second for a minute is 180 requests.
      "run.googleapis.com/request_count": [
        { group: "2xx", value: 3 },
        { group: "4xx", value: 0.5 },
        { group: "5xx", value: 0.5 },
      ],
    };
    mockReads.metricValues = {
      "run.googleapis.com/request_latencies": 120,
      // A ratio of 1: 0.42 is 42%.
      "run.googleapis.com/container/cpu/utilizations": 0.42,
      "run.googleapis.com/container/memory/utilizations": 0.61,
    };

    await renderCase(CASES["cloudRun"]!);

    const section: HTMLElement = screen.getByTestId(
      "cloud-app-platform-monitor",
    );
    expect(
      within(section).getByRole("heading", { name: "Google Cloud Monitoring" }),
    ).toBeInTheDocument();

    const tiles: Record<string, DrawnTile> = sectionTiles();
    expect(Object.keys(tiles)).toEqual([
      "Requests",
      "Server errors",
      "p95 latency",
      "CPU",
      "Memory",
    ]);
    expect(tiles["Requests"]!.value).toBe("240");
    expect(tiles["Server errors"]!.value).toBe("12.5%");
    expect(tiles["Server errors"]!.sublabel).toBe("30 errored");
    expect(tiles["p95 latency"]!.value).toBe("120\u00A0ms");
    expect(tiles["CPU"]!.value).toBe("42.0%");
    expect(tiles["Memory"]!.value).toBe("61.0%");

    const grouped: MetricAsk | undefined = mockReads.asks.find(
      (ask: MetricAsk): boolean => {
        return ask.name === "run.googleapis.com/request_count";
      },
    );
    expect(grouped?.groupBy).toBe("response_code_class");
  });

  test("requests and no 5xx group: 0% server errors, read, not unknown", async () => {
    mockReads.resources = [resourceOf(CASES["cloudRun"]!)];
    mockReads.groupedValues = {
      "run.googleapis.com/request_count": [{ group: "2xx", value: 2 }],
    };

    await renderCase(CASES["cloudRun"]!);

    expect(sectionTiles()["Server errors"]!.value).toBe("0.0%");
  });

  test("its Setup row is Google Cloud Monitoring's", async () => {
    mockReads.resources = [resourceOf(CASES["cloudRun"]!)];

    await renderCase(CASES["cloudRun"]!);

    expect(platformRow()).toEqual(
      expect.objectContaining({
        status: "received",
        label: "Google Cloud Monitoring connection",
        text: "OneUptime reads checkout (Cloud Run Service).",
      }),
    );
  });
});

describe("an App Engine service's Google Cloud Monitoring section", () => {
  test("its requests and the 500s to 599s among its response codes, and its p95 - and the app keeps its own CPU and Memory tiles", async () => {
    mockReads.resources = [resourceOf(CASES["appEngine"]!)];
    mockReads.groupedValues = {
      "appengine.googleapis.com/http/server/response_count": [
        { group: "200", value: 9 },
        { group: "404", value: 0.5 },
        { group: "503", value: 0.5 },
      ],
    };
    mockReads.metricValues = {
      "appengine.googleapis.com/http/server/response_latencies": 64,
    };

    await renderCase(CASES["appEngine"]!);

    const tiles: Record<string, DrawnTile> = sectionTiles();
    expect(Object.keys(tiles)).toEqual([
      "Requests",
      "Server errors",
      "p95 latency",
    ]);
    expect(tiles["Requests"]!.value).toBe("600");
    expect(tiles["Server errors"]!.value).toBe("5.0%");
    expect(tiles["p95 latency"]!.value).toBe("64\u00A0ms");

    // No CPU or memory of an App Engine app is read yet (#10838): its own tiles stay.
    expect(appTileTitles()).toEqual([
      "Requests",
      "Error rate",
      "p95 latency",
      "Instances",
      "CPU",
      "Memory",
    ]);
    expect(
      mockReads.asks.find((ask: MetricAsk): boolean => {
        return (
          ask.name === "appengine.googleapis.com/http/server/response_count"
        );
      })?.groupBy,
    ).toBe("response_code");
  });
});

describe("an App Runner service's Amazon CloudWatch section", () => {
  test("its requests, 5xx, response time, CPU and memory, by its CloudWatch dimensions", async () => {
    mockReads.resources = [resourceOf(CASES["appRunner"]!)];
    mockReads.metricValues = {
      "amazonaws.com/AWS/AppRunner/Requests": 2000,
      "amazonaws.com/AWS/AppRunner/5xxStatusResponses": 40,
      "amazonaws.com/AWS/AppRunner/RequestLatency": 35,
      "amazonaws.com/AWS/AppRunner/CPUUtilization": 18,
      "amazonaws.com/AWS/AppRunner/MemoryUtilization": 44,
    };

    await renderCase(CASES["appRunner"]!);

    const section: HTMLElement = screen.getByTestId(
      "cloud-app-platform-monitor",
    );
    expect(
      within(section).getByRole("heading", { name: "Amazon CloudWatch" }),
    ).toBeInTheDocument();

    const tiles: Record<string, DrawnTile> = sectionTiles();
    expect(tiles["Requests"]!.value).toBe("2k");
    expect(tiles["Server errors"]!.value).toBe("2.0%");
    expect(tiles["Response time"]!.value).toBe("35\u00A0ms");
    expect(tiles["CPU"]!.value).toBe("18.0%");
    expect(tiles["Memory"]!.value).toBe("44.0%");
    // App Runner gives an app no CPU or memory of its own: the section's stand in.
    expect(screen.queryByText("Not on AWS App Runner")).not.toBeInTheDocument();
    expect(platformRow()?.label).toBe("Amazon CloudWatch connection");
  });
});

describe("an ECS service's Amazon CloudWatch section", () => {
  test("its CPU and memory alone: ECS counts no requests of its own", async () => {
    mockReads.resources = [resourceOf(CASES["ecs"]!)];
    mockReads.metricValues = {
      "amazonaws.com/AWS/ECS/CPUUtilization": 23.4,
      "amazonaws.com/AWS/ECS/MemoryUtilization": 51,
    };

    await renderCase(CASES["ecs"]!);

    const tiles: Record<string, DrawnTile> = sectionTiles();
    expect(Object.keys(tiles)).toEqual(["CPU", "Memory"]);
    expect(tiles["CPU"]!.value).toBe("23.4%");
    expect(tiles["Memory"]!.value).toBe("51.0%");
    expect(
      mockReads.asks.map((ask: MetricAsk): string => {
        return ask.name;
      }),
    ).toEqual([
      "amazonaws.com/AWS/ECS/CPUUtilization",
      "amazonaws.com/AWS/ECS/MemoryUtilization",
    ]);
    // Its tiles that would only say Not reported give way.
    expect(appTileTitles()).toEqual([
      "Requests",
      "Error rate",
      "p95 latency",
      "Instances",
    ]);
  });

  test("the services of its cluster are read, and the one that runs its family is its", async () => {
    mockReads.resources = [resourceOf(CASES["ecs"]!)];

    await renderCase(CASES["ecs"]!);

    expect(
      String(mockReads.resourceRequests[0]!.query["providerResourceId"]),
    ).toBe(":service/prod/");
    expect(platformRow()?.text).toBe("OneUptime reads web (prod).");
  });
});

describe("the platform's Setup row while no resource is found", () => {
  test("Not connected with no connection of its cloud: what to connect, and no section", async () => {
    mockReads.connections = 0;

    for (const [name, provider] of [
      ["cloudRun", CloudProvider.GCP],
      ["appRunner", CloudProvider.AWS],
      ["containerApps", CloudProvider.Azure],
    ] as Array<[string, CloudProvider]>) {
      await renderCase(CASES[name]!);

      expect(screen.queryByTestId("cloud-app-platform-monitor")).toBeNull();
      expect({ name, row: platformRow() }).toEqual({
        name,
        row: expect.objectContaining({
          status: "needs-setup",
          statusLabel: "Not connected",
          hint: CLOUD_APP_PLATFORM_CONNECT_HINT[provider],
        }),
      });
      expect(
        mockReads.connectionCounts[mockReads.connectionCounts.length - 1]!
          .query,
      ).toEqual({ provider });
      cleanup();
    }
  });

  test("Not connected with a connection that reads none of its name: what is looked for, and how", async () => {
    mockReads.connections = 2;

    await renderCase(CASES["ecs"]!);

    expect(platformRow()).toEqual(
      expect.objectContaining({
        status: "needs-setup",
        text: "No ECS service in cluster prod that runs task definition checkout is read yet.",
        hint: CLOUD_APP_PLATFORM_NOT_FOUND_HINT["aws_ecs"],
      }),
    );
    // The app's own tiles stay, saying why they are empty.
    expect(appTileTitles()).toContain("CPU");
  });

  test("Checking while the resource is looked up", async () => {
    mockReads.resourceRead = "pending";

    await renderCase(CASES["appEngine"]!);

    expect(platformRow()).toEqual(
      expect.objectContaining({
        status: "checking",
        label: "Google Cloud Monitoring connection",
        text: "Checking…",
      }),
    );
  });

  test("a look-up that fails leaves the row out, and shows no section", async () => {
    mockReads.resourceRead = "fail";

    await renderCase(CASES["cloudRun"]!);

    expect(platformRow()).toBeNull();
    expect(screen.queryByTestId("cloud-app-platform-monitor")).toBeNull();
  });
});
