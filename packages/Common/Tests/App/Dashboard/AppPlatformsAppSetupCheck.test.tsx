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
 * AN APP PLATFORMS APP THAT SENDS NO TRACES (#6770), ITS OVERVIEW RENDERED.
 *
 * The customer's two Azure App Service apps sent only metrics. Their pages
 * read "Running", 0 requests, 0 instances, no CPU or memory and "No
 * revision reported yet", with nothing to say the zeros were never
 * measured. Now the page says what is missing and what to do:
 *
 *   - the trace tiles read "No traces received", the Instances tile "Not
 *     reported" and CPU and Memory "Not on Azure App Service" - each in
 *     place of a number never sent - and the trace charts and Running now,
 *     which would draw nothing, give way;
 *   - a Setup check leads the page: each kind of telemetry, whether it
 *     arrives, and for what is missing what to add, with the way to connect
 *     the Azure subscription;
 *   - once the subscription is connected and the site found, an Azure
 *     Monitor section shows the site's requests, server errors, response
 *     time, CPU time and memory, whatever the app sends;
 *   - an app that sends traces, names its instances and its version reads
 *     as before: its numbers, its charts, no Setup check.
 *
 * Rendered for real; the reads (spans, metrics, the site look-up) are
 * answered here.
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
  query: Record<string, unknown>;
}

// What the reads answer, set by each test.
const mockReads: {
  span: SpanReply;
  sites: Array<unknown>;
  siteRead: "answer" | "fail" | "pending";
  siteRequests: Array<ListRequest>;
  metricNames: Array<string>;
  metricValues: Record<string, number>;
} = {
  span: { total: 0, errors: 0, errorRatePercent: null, p95DurationMs: null },
  sites: [],
  siteRead: "answer",
  siteRequests: [],
  metricNames: [],
  metricValues: {},
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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: ListRequest): Promise<unknown> => {
        mockReads.siteRequests.push(request);

        if (mockReads.siteRead === "fail") {
          return Promise.reject(new Error("403"));
        }

        if (mockReads.siteRead === "pending") {
          return new Promise((): void => {});
        }

        return Promise.resolve({
          data: mockReads.sites,
          count: mockReads.sites.length,
          skip: 0,
          limit: 50,
        });
      },
      count: async (): Promise<number> => {
        return 0;
      },
    },
  };
});

import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import CloudAppRevision from "../../../Models/DatabaseModels/CloudAppRevision";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import CloudResourceInstance from "../../../Models/DatabaseModels/CloudResourceInstance";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import CloudAppOverviewTab from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppOverviewTab";
import {
  CLOUD_APP_AZURE_MONITOR_HINT,
  CLOUD_APP_CHART_LOAD_FAILED,
  CLOUD_APP_INSTANCES_HINT,
  CLOUD_APP_NO_TRACES_NOTE,
  CLOUD_APP_NOT_REPORTED_NOTE,
  CLOUD_APP_REVISION_HINT,
  CLOUD_APP_SETUP_TITLE,
  CLOUD_APP_TRACES_HINT,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppTelemetrySetup";
import { APP_SERVICE_SITE_TYPE } from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppPlatformResource";
import { CLOUD_APP_CONNECT_AZURE } from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppSetupCheckCard";
import {
  AZURE_MONITOR_OPEN_RESOURCE,
  AZURE_MONITOR_SECTION_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppAzureMonitorCard";

const MINUTE_MS: number = 60 * 1000;
const APP_ID: string = "76000000-0000-4000-8000-000000000001";
const ENVIRONMENT_ID: string = "76100000-0000-4000-8000-000000000001";
const SITE_ROW_ID: string = "76200000-0000-4000-8000-000000000001";
const SUBSCRIPTION: string = "3f1c9a52-7d4e-4b8a-9e21-6c5d0b7a2f13";
const SITE: string = "telemetry-relay-northcentralus";
const SITE_ID: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-monitoring/providers/Microsoft.Web/sites/${SITE}`;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE_MS);
}

const APP_SERVICE_ENVIRONMENT: CloudResource = Object.assign(
  new CloudResource(),
  {
    _id: ENVIRONMENT_ID,
    name: "Azure App Service · northcentralus",
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

function siteRow(): CloudResource {
  return Object.assign(new CloudResource(), {
    _id: SITE_ROW_ID,
    name: SITE,
    cloudResourceKind: "resource",
    cloudResourceType: APP_SERVICE_SITE_TYPE,
    cloudProvider: "azure",
    providerResourceId: SITE_ID,
    telemetryAttributes: { "azuremonitor.resource_id": SITE_ID },
    lastSeenAt: minutesAgo(5),
  });
}

function instance(revision: string): CloudResourceInstance {
  return Object.assign(new CloudResourceInstance(), {
    cloudAppId: APP_ID,
    revision,
    lastSeenAt: minutesAgo(1),
  });
}

async function renderTab(data: {
  app: CloudApp;
  instances?: Array<CloudResourceInstance>;
}): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <CloudAppOverviewTab
          app={data.app}
          environment={APP_SERVICE_ENVIRONMENT}
          instances={data.instances || []}
          revisions={[] as Array<CloudAppRevision>}
          start={minutesAgo(60)}
          end={new Date()}
          refreshToken={0}
        />
      </MemoryRouter>,
    );
  });
  // The site look-up and the metric reads settle on later ticks.
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void): void => {
      setTimeout(resolve, 0);
    });
  });
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
  tone: string;
  label: string;
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
        tone: item.getAttribute("data-tone") || "",
        label: (item.firstElementChild?.textContent || "").trim(),
        text: (
          within(item).getByTestId(`cloud-app-setup-${key}-text`).textContent ||
          ""
        ).trim(),
        hint: hint ? (hint.textContent || "").trim() : null,
      };
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
  mockReads.siteRead = "answer";
  mockReads.siteRequests = [];
  mockReads.metricNames = [];
  mockReads.metricValues = {};
});

afterEach(() => {
  cleanup();
});

describe("the issue's app: an App Service app that sends only metrics", () => {
  test("its tiles say what is missing, never a zero it was not sent", async () => {
    await renderTab({ app: metricsOnlyApp() });

    const tiles: Array<DrawnTile> = appTiles();

    for (const title of ["Requests", "Error rate", "p95 latency"]) {
      expect(tileOf(tiles, title).note).toBe(CLOUD_APP_NO_TRACES_NOTE);
    }
    expect(tileOf(tiles, "Instances").note).toBe(CLOUD_APP_NOT_REPORTED_NOTE);
    expect(tileOf(tiles, "CPU").note).toBe("Not on Azure App Service");
    expect(tileOf(tiles, "Memory").note).toBe("Not on Azure App Service");

    // No tile draws a value under its note: "0" nowhere.
    for (const tile of tiles) {
      expect({ title: tile.title, value: tile.value }).toEqual({
        title: tile.title,
        value: "",
      });
    }
  });

  test("the trace charts and Running now, which would draw nothing, give way", async () => {
    await renderTab({ app: metricsOnlyApp() });

    expect(screen.queryByTestId("cloud-app-trace-charts")).toBeNull();
    expect(screen.queryByTestId("cloud-app-running-now-empty")).toBeNull();
    expect(screen.queryByTestId("cloud-app-running-revision")).toBeNull();
  });

  test("its Setup check leads the page, row by row, with what to add", async () => {
    await renderTab({ app: metricsOnlyApp() });

    const card: HTMLElement = screen.getByTestId("cloud-app-setup-check");
    const page: HTMLElement = screen.getByTestId("cloud-app-overview");

    // First on the page, above the tiles.
    expect(page.firstElementChild).toBe(card);
    expect(within(card).getByText(CLOUD_APP_SETUP_TITLE)).toBeInTheDocument();

    expect(
      setupRows().map((row: DrawnRow): Omit<DrawnRow, "text"> => {
        return {
          key: row.key,
          tone: row.tone,
          label: row.label,
          hint: row.hint,
        };
      }),
    ).toEqual([
      {
        key: "traces",
        tone: "warning",
        label: "Traces",
        hint: CLOUD_APP_TRACES_HINT,
      },
      { key: "metrics", tone: "ok", label: "Metrics", hint: null },
      { key: "logs", tone: "off", label: "Logs", hint: null },
      {
        key: "instances",
        tone: "warning",
        label: "Instances",
        hint: CLOUD_APP_INSTANCES_HINT,
      },
      {
        key: "revision",
        tone: "warning",
        label: "Revision",
        hint: CLOUD_APP_REVISION_HINT,
      },
      {
        key: "azure-monitor",
        tone: "off",
        label: "Azure Monitor",
        hint: CLOUD_APP_AZURE_MONITOR_HINT,
      },
    ]);

    const texts: Record<string, string> = Object.fromEntries(
      setupRows().map((row: DrawnRow): [string, string] => {
        return [row.key, row.text];
      }),
    );

    expect(texts["traces"]).toMatch(/^None since .+\.$/);
    expect(texts["metrics"]).toMatch(/^Arriving\. The latest came in .+\.$/);
    expect(texts["instances"]).toBe("Not reported");
    expect(texts["azure-monitor"]).toBe("Not connected");
  });

  test("the Setup check links to the environment's guide, and to connecting the subscription", async () => {
    await renderTab({ app: metricsOnlyApp() });

    const connect: HTMLElement = screen.getByTestId(
      "cloud-app-setup-azure-monitor-action",
    );

    expect(connect).toHaveTextContent(CLOUD_APP_CONNECT_AZURE);
    expect(connect.getAttribute("href")).toMatch(/\/cloud\/connect$/);
    expect(
      within(screen.getByTestId("cloud-app-setup-check")).getByRole("button", {
        name: /Setup guide/,
      }),
    ).toBeInTheDocument();
  });

  test("with no subscription connected there is no Azure Monitor section, and the site was looked up by its name", async () => {
    await renderTab({ app: metricsOnlyApp() });

    expect(screen.queryByTestId("cloud-app-azure-monitor")).toBeNull();
    expect(mockReads.siteRequests).toHaveLength(1);

    const query: Record<string, unknown> = mockReads.siteRequests[0]!.query;

    expect(query["cloudResourceType"]).toBe(APP_SERVICE_SITE_TYPE);
    expect(query["cloudProvider"]).toBe("azure");
    expect(query["name"]).toBeInstanceOf(StartsWith);
    expect((query["name"] as StartsWith<string>).toString()).toBe(SITE);
  });
});

describe("once the subscription is connected", () => {
  beforeEach(() => {
    mockReads.sites = [siteRow()];
    mockReads.metricValues = {
      azure_requests_total: 1200,
      azure_http5xx_total: 24,
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

    expect(
      tiles.map((tile: DrawnTile): string => {
        return tile.title;
      }),
    ).toEqual([
      "Requests",
      "Server errors",
      "Response time",
      "CPU time",
      "Memory",
    ]);
    expect(tileOf(tiles, "Requests").value).toBe("1.2k");
    expect(tileOf(tiles, "Server errors").value).toBe("2.0%");
    expect(tileOf(tiles, "Server errors").sublabel).toBe("24 errored");
    expect(tileOf(tiles, "Response time").value).toBe("250 ms");
    // 90 s of CPU reads as a duration, not "90.00 s".
    expect(tileOf(tiles, "CPU time").value).toBe("1m 30s");
    expect(tileOf(tiles, "Memory").value).toBe("512 MiB");

    // Read under the names the connection stores them by.
    expect(new Set(mockReads.metricNames)).toEqual(
      new Set([
        "azure_requests_total",
        "azure_http5xx_total",
        "azure_httpresponsetime_average",
        "azure_cputime_total",
        "azure_memoryworkingset_average",
      ]),
    );
  });

  test("its heading links to the site's own page", async () => {
    await renderTab({ app: metricsOnlyApp() });

    const open: HTMLElement = screen.getByTestId(
      "cloud-app-azure-monitor-open",
    );

    expect(open).toHaveTextContent(AZURE_MONITOR_OPEN_RESOURCE);
    expect(open.getAttribute("href")).toContain(SITE_ROW_ID);
  });

  test("the Setup check says it is connected, and asks for nothing", async () => {
    await renderTab({ app: metricsOnlyApp() });

    const row: DrawnRow | undefined = setupRows().find(
      (candidate: DrawnRow): boolean => {
        return candidate.key === "azure-monitor";
      },
    );

    expect(row).toEqual(
      expect.objectContaining({ tone: "ok", text: "Connected" }),
    );
    expect(
      screen.queryByTestId("cloud-app-setup-azure-monitor-action"),
    ).toBeNull();
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
    // "Not on Azure App Service" is said nowhere above the site's numbers.
    expect(
      screen.queryByText("Not on Azure App Service"),
    ).not.toBeInTheDocument();
  });

  test("without the section, the two tiles stay and say why they hold no number", async () => {
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
    expect(screen.getByTestId("cloud-app-tiles").className).toContain(
      "lg:grid-cols-3",
    );
  });
});

describe("when the site cannot be looked up", () => {
  test("a failed look-up shows no section and no Azure Monitor row: it is not 'not connected'", async () => {
    mockReads.siteRead = "fail";

    await renderTab({ app: metricsOnlyApp() });

    expect(screen.queryByTestId("cloud-app-azure-monitor")).toBeNull();
    expect(
      setupRows().map((row: DrawnRow): string => {
        return row.key;
      }),
    ).toEqual(["traces", "metrics", "logs", "instances", "revision"]);
  });

  test("while the look-up is out, the row says it is checking", async () => {
    mockReads.siteRead = "pending";

    await renderTab({ app: metricsOnlyApp() });

    expect(
      setupRows().find((row: DrawnRow): boolean => {
        return row.key === "azure-monitor";
      }),
    ).toEqual(
      expect.objectContaining({
        tone: "waiting",
        text: "Checking…",
        hint: null,
      }),
    );
  });

  test("an app of a staging slot is not looked up: the site's numbers are the production slot's", async () => {
    mockReads.sites = [siteRow()];

    await renderTab({ app: metricsOnlyApp({ groupName: "staging" }) });

    expect(mockReads.siteRequests).toHaveLength(0);
    expect(screen.queryByTestId("cloud-app-azure-monitor")).toBeNull();
    expect(
      setupRows().some((row: DrawnRow): boolean => {
        return row.key === "azure-monitor";
      }),
    ).toBe(false);
  });
});

describe("an app that sends traces, names its instances and its version", () => {
  test("reads its numbers and charts, with no Setup check and no notes", async () => {
    mockReads.span = {
      total: 1200,
      errors: 12,
      errorRatePercent: 1,
      p95DurationMs: 180,
    };

    await renderTab({
      app: metricsOnlyApp({
        tracesLastReceivedAt: minutesAgo(1),
        currentRevision: "2026.11.1",
        revisionAttribute: "service.version",
      }),
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
    // App Service still gives an app no CPU or memory of its own.
    expect(tileOf(tiles, "CPU").note).toBe("Not on Azure App Service");
  });

  test("an app whose traces arrive and that served nothing reads a real 0", async () => {
    await renderTab({
      app: metricsOnlyApp({
        tracesLastReceivedAt: minutesAgo(30),
        currentRevision: "2026.11.1",
      }),
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
        value: "—",
        note: null,
        sublabel: "could not load",
      }),
    );
    expect(
      within(screen.getByTestId("cloud-app-trace-charts")).getAllByText(
        CLOUD_APP_CHART_LOAD_FAILED,
      ).length,
    ).toBeGreaterThan(0);
  });
});
