import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * AN APP SERVICE APP'S PLATFORM METRICS, FROM AZURE'S ANSWERS TO ITS PAGE
 * (#10294).
 *
 * The customer asked for an App Service app's requests, response time,
 * HTTP errors, CPU and memory through the Azure connection they already
 * have. A connection reads them as its site's key metrics; the app's page
 * reads them back by name. The two sides were only ever tested apart. Here
 * one site's metrics go the whole way:
 *
 *   1. the Azure connector reads them from Resource Manager answers shaped
 *      as Azure writes them - the site's metric definitions and its metrics
 *      for each minute - and writes the datapoints the ingest stores;
 *   2. the app page's Azure Monitor section asks for each of them by the
 *      name it computes (getAppServiceStoredMetricName) and the site row's
 *      filter, and finds the stored series under exactly that name;
 *   3. its tiles and charts show the sums, the rates and the averages.
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

// The series the page asks for, answered from what the connector wrote.
const mockStore: {
  points: Array<{
    metricName: string;
    stored: Record<string, unknown>;
    value: number;
    time: Date;
  }>;
  asked: Array<{ name: string; attributes: Record<string, string> }>;
} = { points: [], asked: [] };

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics",
    ) as Record<string, unknown>;

    return {
      ...actual,
      fetchMetricSeries: async (scope: {
        name: string;
        attributes: Record<string, string>;
      }): Promise<Array<{ x: Date; y: number }>> => {
        mockStore.asked.push({
          name: scope.name,
          attributes: scope.attributes,
        });

        // Exactly the stored name, and every attribute of the filter.
        return mockStore.points
          .filter(
            (point: {
              metricName: string;
              stored: Record<string, unknown>;
            }) => {
              return (
                point.metricName === scope.name &&
                Object.entries(scope.attributes).every(
                  ([key, value]: [string, string]): boolean => {
                    return point.stored[key] === value;
                  },
                )
              );
            },
          )
          .map((point: { time: Date; value: number }) => {
            return { x: point.time, y: point.value };
          });
      },
    };
  },
);

import AzureCloudConnector from "../../../Server/Utils/CloudConnection/Azure/AzureCloudConnector";
import { storedAttributesOf } from "../../../Server/Utils/CloudConnection/CloudMetricPayload";
import {
  CloudConnectionSettings,
  CloudReadResult,
} from "../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../Server/Utils/DataSource/HttpFetch";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import { CloudConnectionAuthMethod } from "../../../Types/CloudConnection/CloudConnectionCatalog";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import {
  APP_SERVICE_METRICS,
  AppServiceMetric,
  AppServiceSeries,
  AppServiceSummary,
  getAppServiceStoredMetricName,
  summarizeAppServiceSeries,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppPlatformResource";
import { getCloudMonitoredResourceAttributeFilters } from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Utils/CloudMonitoredResourceScope";
import CloudAppAzureMonitorCard from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppAzureMonitorCard";
import {
  FakeProviderApi,
  FakeResponse,
  createFakeProviderApi,
  json,
} from "../../Server/Utils/LlmObservability/FakeProviderApi";

const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const CLIENT: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const SUBSCRIPTION: string = "d6252cc9-f01c-428b-924d-9896199f9a13";
const SITE_NAME: string = "azure-monitor-collector-northcentralus";
const SITE_ID: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-monitoring/providers/Microsoft.Web/sites/${SITE_NAME}`;
const NOW: Date = new Date("2026-11-20T12:07:00Z");

/*
 * The site's metric definitions, as "Metric Definitions - List" answers
 * them: each name, unit, primary aggregation and grains Azure documents for
 * Microsoft.Web/sites.
 */
function definition(
  name: string,
  aggregation: string,
  unit: string,
): JSONObject {
  return {
    id: `${SITE_ID}/providers/microsoft.insights/metricdefinitions/${name}`,
    resourceId: SITE_ID,
    namespace: "Microsoft.Web/sites",
    name: { value: name, localizedValue: name },
    unit,
    primaryAggregationType: aggregation,
    supportedAggregationTypes: [
      "None",
      "Average",
      "Minimum",
      "Maximum",
      "Total",
      "Count",
    ],
    metricAvailabilities: [
      { timeGrain: "PT1M", retention: "P93D" },
      { timeGrain: "PT5M", retention: "P93D" },
      { timeGrain: "PT1H", retention: "P93D" },
    ],
    dimensions: [{ value: "Instance", localizedValue: "Instance" }],
  };
}

const SITE_DEFINITIONS: Array<JSONObject> = [
  definition("Requests", "Total", "Count"),
  definition("Http5xx", "Total", "Count"),
  definition("Http4xx", "Total", "Count"),
  definition("Http2xx", "Total", "Count"),
  definition("HttpResponseTime", "Average", "Seconds"),
  definition("CpuTime", "Total", "Seconds"),
  definition("MemoryWorkingSet", "Average", "Bytes"),
  definition("AppConnections", "Average", "Count"),
];

/*
 * Two minutes of each metric, as "Metrics - List" answers a site's: each
 * aggregation's value per minute, Total for what is counted and Average
 * for what is measured.
 */
const RECORDED: Record<string, Array<{ total?: number; average?: number }>> = {
  Requests: [{ total: 420 }, { total: 780 }],
  Http5xx: [{ total: 9 }, { total: 15 }],
  Http4xx: [{ total: 30 }, { total: 30 }],
  Http2xx: [{ total: 381 }, { total: 735 }],
  HttpResponseTime: [{ average: 0.2 }, { average: 0.3 }],
  CpuTime: [{ total: 40 }, { total: 50 }],
  MemoryWorkingSet: [
    { average: 500 * 1024 * 1024 },
    { average: 524 * 1024 * 1024 },
  ],
  AppConnections: [{ average: 12 }, { average: 14 }],
};

function fakeAzure(): FakeProviderApi {
  return createFakeProviderApi([
    {
      host: "login.microsoftonline.com",
      path: `/${TENANT}/oauth2/v2.0/token`,
      method: "POST",
      respond: (): FakeResponse => {
        return json({ access_token: "azure-access-token", expires_in: 3599 });
      },
    },
    {
      host: "management.azure.com",
      path: "/subscriptions",
      respond: (): FakeResponse => {
        return json({
          value: [
            {
              subscriptionId: SUBSCRIPTION,
              displayName: "Production",
              state: "Enabled",
            },
          ],
        });
      },
    },
    {
      host: "management.azure.com",
      path: `/subscriptions/${SUBSCRIPTION}/resources`,
      respond: (): FakeResponse => {
        return json({
          value: [
            {
              id: SITE_ID,
              name: SITE_NAME,
              type: "Microsoft.Web/sites",
              kind: "app,linux,container",
              location: "northcentralus",
            },
          ],
        });
      },
    },
    {
      host: "management.azure.com",
      path: /\/providers\/Microsoft\.Insights\/metricDefinitions$/,
      respond: (): FakeResponse => {
        return json({ value: SITE_DEFINITIONS });
      },
    },
    {
      host: "management.azure.com",
      path: /\/providers\/Microsoft\.Insights\/metrics$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        const start: number = Date.parse(
          (url.searchParams.get("timespan") || "").split("/")[0]!,
        );
        const names: Array<string> = (url.searchParams.get("metricnames") || "")
          .split(",")
          .filter((name: string): boolean => {
            return Boolean(name);
          });

        return json({
          cost: names.length * 2,
          timespan: url.searchParams.get("timespan"),
          interval: url.searchParams.get("interval") || "PT1M",
          namespace: "Microsoft.Web/sites",
          resourceregion: "northcentralus",
          value: names.map((name: string): JSONObject => {
            const minutes: Array<{ total?: number; average?: number }> =
              RECORDED[name] || [];

            return {
              id: `${SITE_ID}/providers/Microsoft.Insights/metrics/${name}`,
              type: "Microsoft.Insights/metrics",
              name: { value: name, localizedValue: name },
              unit: "Count",
              errorCode: "Success",
              timeseries: [
                {
                  metadatavalues: [],
                  data: minutes.map(
                    (
                      minute: { total?: number; average?: number },
                      index: number,
                    ): JSONObject => {
                      return {
                        timeStamp: new Date(
                          start + index * 60000,
                        ).toISOString(),
                        ...(minute as JSONObject),
                      };
                    },
                  ),
                },
              ],
            };
          }),
        });
      },
    },
  ]);
}

function settings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.Azure,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.AzureClientSecret,
      tenantId: TENANT,
      clientId: CLIENT,
      cloud: "public",
    },
    secrets: { clientSecret: "client-secret~value" },
  };
}

// What the connector wrote, as the ingest stores each datapoint.
function storedPoints(result: CloudReadResult): typeof mockStore.points {
  const points: typeof mockStore.points = [];

  for (const payload of result.payloads) {
    for (const rm of payload["resourceMetrics"] as JSONArray) {
      const resourceAttributes: JSONArray = (
        (rm as JSONObject)["resource"] as JSONObject
      )["attributes"] as JSONArray;

      for (const sm of (rm as JSONObject)["scopeMetrics"] as JSONArray) {
        for (const metric of (sm as JSONObject)["metrics"] as JSONArray) {
          for (const point of ((metric as JSONObject)["gauge"] as JSONObject)[
            "dataPoints"
          ] as JSONArray) {
            points.push({
              metricName: (metric as JSONObject)["name"] as string,
              stored: storedAttributesOf(
                resourceAttributes as never,
                (point as JSONObject)["attributes"] as never,
              ) as Record<string, unknown>,
              value: (point as JSONObject)["asDouble"] as number,
              time: new Date(
                Number(
                  BigInt(String((point as JSONObject)["timeUnixNano"])) /
                    BigInt(1000000),
                ),
              ),
            });
          }
        }
      }
    }
  }

  return points;
}

async function readSite(): Promise<typeof mockStore.points> {
  const result: CloudReadResult = await new AzureCloudConnector().read(
    settings(),
    {
      transport: fakeAzure().transport,
      now: () => {
        return NOW;
      },
      sleep: async () => {},
      state: {},
      serviceName: "Microsoft Azure",
      connectionId: "33333333-3333-4333-8333-333333333333",
      maxRequests: 100,
      maxDurationMs: 60000,
    } as Parameters<AzureCloudConnector["read"]>[1],
  );

  return storedPoints(result);
}

// The site's row, as the connection's reads file it.
function siteRow(): CloudResource {
  return Object.assign(new CloudResource(), {
    _id: "76200000-0000-4000-8000-000000000001",
    name: SITE_NAME,
    cloudResourceKind: CloudResourceKind.Resource,
    cloudProvider: CloudProvider.Azure,
    cloudResourceType: "Microsoft.Web/sites",
    providerResourceId: SITE_ID,
    telemetryAttributes: { "azuremonitor.resource_id": SITE_ID },
  });
}

function seriesOf(
  points: typeof mockStore.points,
  metric: AppServiceMetric,
): Array<{ x: Date; y: number }> {
  return points
    .filter((point: { metricName: string }): boolean => {
      return point.metricName === getAppServiceStoredMetricName({ metric });
    })
    .map((point: { time: Date; value: number }) => {
      return { x: point.time, y: point.value };
    });
}

afterEach(() => {
  cleanup();
  mockStore.points = [];
  mockStore.asked = [];
});

describe("a site's platform metrics, read from Azure's answers", () => {
  test("every metric the page shows is one the connection writes, under the name the page asks for", async () => {
    const points: typeof mockStore.points = await readSite();
    const written: Set<string> = new Set<string>(
      points.map((point: { metricName: string }): string => {
        return point.metricName;
      }),
    );

    for (const metric of Object.values(AppServiceMetric)) {
      expect({
        metric,
        name: getAppServiceStoredMetricName({ metric }),
        written: written.has(getAppServiceStoredMetricName({ metric })),
      }).toEqual({
        metric,
        name: getAppServiceStoredMetricName({ metric }),
        written: true,
      });
    }
    expect(Object.keys(APP_SERVICE_METRICS)).toHaveLength(6);
  });

  test("each datapoint is filed under the site, as the site's row selects its metrics", async () => {
    const points: typeof mockStore.points = await readSite();
    const filter: Record<string, string> =
      getCloudMonitoredResourceAttributeFilters(siteRow());

    expect(Object.keys(filter).length).toBeGreaterThan(0);

    for (const point of points) {
      for (const [key, value] of Object.entries(filter)) {
        expect({
          metric: point.metricName,
          key,
          value: point.stored[key],
        }).toEqual({
          metric: point.metricName,
          key,
          value,
        });
      }
    }
  });

  test("its numbers: requests and errors added up, response time and memory averaged, CPU time added up", async () => {
    const points: typeof mockStore.points = await readSite();
    const series: AppServiceSeries = {
      requests: seriesOf(points, AppServiceMetric.Requests),
      serverErrors: seriesOf(points, AppServiceMetric.ServerErrors),
      clientErrors: seriesOf(points, AppServiceMetric.ClientErrors),
      responseTimeSeconds: seriesOf(points, AppServiceMetric.ResponseTime),
      cpuTimeSeconds: seriesOf(points, AppServiceMetric.CpuTime),
      memoryBytes: seriesOf(points, AppServiceMetric.MemoryWorkingSet),
    };

    // Whatever minutes the read kept, each is one Azure answered.
    const requests: Array<number> = series.requests.map(
      (point: { y: number }): number => {
        return point.y;
      },
    );

    expect(requests.length).toBeGreaterThan(0);
    for (const value of requests) {
      expect([420, 780]).toContain(value);
    }

    const summary: AppServiceSummary = summarizeAppServiceSeries(series);
    const sum: (values: Array<{ y: number }>) => number = (
      values: Array<{ y: number }>,
    ): number => {
      return values.reduce((total: number, point: { y: number }): number => {
        return total + point.y;
      }, 0);
    };

    expect(summary.requests).toBe(sum(series.requests));
    expect(summary.serverErrors).toBe(sum(series.serverErrors));
    expect(summary.serverErrorRatePercent).toBeCloseTo(
      (sum(series.serverErrors) / sum(series.requests)) * 100,
      6,
    );
    expect(summary.responseTimeMs).toBeCloseTo(
      (sum(series.responseTimeSeconds) / series.responseTimeSeconds.length) *
        1000,
      6,
    );
    expect(summary.cpuTimeSeconds).toBe(sum(series.cpuTimeSeconds));
  });
});

describe("the app page's Azure Monitor section, drawn from what the connection wrote", () => {
  test("its tiles show the site's numbers, and its Requests chart draws 5xx and 4xx beside the requests", async () => {
    mockStore.points = await readSite();
    const start: Date = new Date(NOW.getTime() - 60 * 60 * 1000);

    await act(async () => {
      render(
        <MemoryRouter>
          <CloudAppAzureMonitorCard
            resource={siteRow()}
            start={start}
            end={NOW}
            refreshToken={0}
            syncId="app-service-e2e"
          />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void): void => {
        setTimeout(resolve, 0);
      });
    });

    // Asked by the names and the filter the connection wrote them under.
    expect(
      new Set(
        mockStore.asked.map((ask: { name: string }): string => {
          return ask.name;
        }),
      ),
    ).toEqual(
      new Set(
        Object.values(AppServiceMetric).map((metric: AppServiceMetric) => {
          return getAppServiceStoredMetricName({ metric });
        }),
      ),
    );
    for (const ask of mockStore.asked) {
      expect(ask.attributes).toEqual({ "azuremonitor.resource_id": SITE_ID });
    }

    const section: HTMLElement = screen.getByTestId("cloud-app-azure-monitor");
    const tiles: HTMLElement = within(section).getByTestId(
      "cloud-app-azure-monitor-tiles",
    );
    const values: Array<string> = Array.from(tiles.children).map(
      (tile: Element): string => {
        return (tile.querySelector(".text-2xl")?.textContent || "").trim();
      },
    );

    // Requests, the 5xx share, response time, CPU time, memory: each a number.
    expect(values).toHaveLength(5);
    for (const value of values) {
      expect(value).toMatch(/\d/);
    }

    // The Requests chart's three lines.
    const charts: Array<string> = Array.from(
      section.querySelectorAll("[data-testid='zoom-chart']"),
    ).map((chart: Element): string => {
      return chart.getAttribute("data-series") || "";
    });

    expect(charts).toContain("Requests,Server errors,Client errors");
    expect(charts).toContain("Response time");
  });
});
