import { describe, expect, test } from "@jest/globals";
import {
  APP_SERVICE_METRICS,
  APP_SERVICE_SITE_TYPE,
  AppServiceMetric,
  AppServiceSeries,
  AppServiceSeriesPoint,
  CloudAppPlatformResourceSource,
  CloudPlatformResourceCandidate,
  formatAppServiceCpuTime,
  getAppServiceStoredMetricName,
  getCloudAppSiteName,
  getCloudAppSlotName,
  hasCloudAppPlatformResource,
  matchCloudAppPlatformResource,
  summarizeAppServiceSeries,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppPlatformResource";
import {
  getAzureKeyMetrics,
  getAzureKeyMetricOfStoredName,
} from "../../../Types/Cloud/CloudKeyMetrics";
import { ManagedCloudPlatform } from "../../../Types/Cloud/CloudPlatform";
import { getCloudReadingKey } from "../../../Types/Cloud/CloudResourceHealth";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";

/*
 * THE AZURE SITE AN APP SERVICE APP RUNS AS (#6770).
 *
 * An App Service app that sends no traces has no requests of its own to
 * show, and App Service gives no app CPU or memory. Azure Monitor measures
 * the site whatever the app sends, and a connected subscription brings each
 * site in as a Cloud Resource. The app's page finds its site and shows its
 * requests, server errors, response time, CPU time and memory:
 *
 *   - by the app's cloud.resource_id, the ARM id the detectors set, matched
 *     as ARM matches ids (without regard to case); else by the site's name,
 *     which is the app's service.name and unique across Azure;
 *   - never another resource that shares the name's start (a plan, a
 *     second site "checkout-api-v2"), and never for a deployment slot other
 *     than production, whose numbers the site's are not;
 *   - each metric read under the name the connection stores it by, the
 *     aggregation Azure calls primary, unless the site's own reading says
 *     which;
 *   - summed or averaged over the range, with nothing measured shown as
 *     unknown rather than 0.
 */

const SUBSCRIPTION: string = "d6252cc9-f01c-428b-924d-9896199f9a13";

function siteId(name: string, group: string = "rg-apps"): string {
  return `/subscriptions/${SUBSCRIPTION}/resourceGroups/${group}/providers/Microsoft.Web/sites/${name}`;
}

interface Row extends CloudPlatformResourceCandidate {
  label: string;
}

function row(label: string, id: string, lastSeenAt?: Date | string): Row {
  return { label, providerResourceId: id, lastSeenAt };
}

function appServiceApp(
  fields: Partial<CloudAppPlatformResourceSource> = {},
): CloudAppPlatformResourceSource {
  return {
    name: "checkout-api",
    cloudPlatform: ManagedCloudPlatform.AzureAppService,
    ...fields,
  };
}

function labelOf(match: Row | null): string | null {
  return match ? match.label : null;
}

describe("which apps have a site to look up", () => {
  test("an App Service app does, by its name or its resource id", () => {
    expect(hasCloudAppPlatformResource(appServiceApp())).toBe(true);
    expect(
      hasCloudAppPlatformResource(
        appServiceApp({ name: "", providerResourceId: siteId("checkout-api") }),
      ),
    ).toBe(true);
  });

  test("an app on another platform, or one with no name to go by, does not", () => {
    for (const platform of Object.values(ManagedCloudPlatform)) {
      if (platform === ManagedCloudPlatform.AzureAppService) {
        continue;
      }

      expect({
        platform,
        has: hasCloudAppPlatformResource({
          name: "checkout-api",
          cloudPlatform: platform,
        }),
      }).toEqual({ platform, has: false });
    }

    expect(hasCloudAppPlatformResource(appServiceApp({ name: "   " }))).toBe(
      false,
    );
  });

  test("an app of the production slot does, and an app of another slot does not", () => {
    expect(
      hasCloudAppPlatformResource(appServiceApp({ groupName: "production" })),
    ).toBe(true);
    expect(
      hasCloudAppPlatformResource(appServiceApp({ groupName: "Production" })),
    ).toBe(true);
    expect(
      hasCloudAppPlatformResource(appServiceApp({ groupName: "staging" })),
    ).toBe(false);
  });
});

describe("the site's name and the app's slot", () => {
  test("the resource id names the site, whatever the app is called", () => {
    expect(
      getCloudAppSiteName(
        appServiceApp({
          name: "Checkout API",
          providerResourceId: siteId("checkout-api-prod"),
        }),
      ),
    ).toBe("checkout-api-prod");
  });

  test("without an id of a site, the app's own name does, trimmed", () => {
    expect(getCloudAppSiteName(appServiceApp({ name: " checkout-api " }))).toBe(
      "checkout-api",
    );
    expect(
      getCloudAppSiteName(
        appServiceApp({ providerResourceId: "not an ARM id" }),
      ),
    ).toBe("checkout-api");
    expect(
      getCloudAppSiteName(
        appServiceApp({
          providerResourceId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-apps/providers/Microsoft.Web/serverfarms/checkout-plan`,
        }),
      ),
    ).toBe("checkout-api");
  });

  test("production is the site itself; any other slot is a slot", () => {
    expect(getCloudAppSlotName(appServiceApp())).toBeNull();
    expect(getCloudAppSlotName(appServiceApp({ groupName: "" }))).toBeNull();
    expect(
      getCloudAppSlotName(appServiceApp({ groupName: "PRODUCTION" })),
    ).toBeNull();
    expect(getCloudAppSlotName(appServiceApp({ groupName: " staging " }))).toBe(
      "staging",
    );
  });
});

describe("finding the app's site among what the connection lists", () => {
  const SITE: Row = row("site", siteId("checkout-api"));
  const SITE_V2: Row = row("site v2", siteId("checkout-api-v2"));
  const PLAN: Row = row(
    "plan",
    `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-apps/providers/Microsoft.Web/serverfarms/checkout-api`,
  );
  const SLOT: Row = row(
    "staging slot",
    `${siteId("checkout-api")}/slots/staging`,
  );

  test("by the app's own id first, matched without regard to case as ARM does", () => {
    const sameNameOtherGroup: Row = row(
      "same name, other group",
      siteId("checkout-api", "rg-other"),
    );

    expect(
      labelOf(
        matchCloudAppPlatformResource({
          app: appServiceApp({
            providerResourceId: siteId(
              "checkout-api",
              "rg-other",
            ).toUpperCase(),
          }),
          candidates: [SITE, sameNameOtherGroup, SITE_V2],
        }),
      ),
    ).toBe("same name, other group");
  });

  test("else by the site's name - never a plan, another site that starts alike, or a slot", () => {
    expect(
      labelOf(
        matchCloudAppPlatformResource({
          app: appServiceApp(),
          candidates: [PLAN, SITE_V2, SLOT, SITE],
        }),
      ),
    ).toBe("site");

    expect(
      labelOf(
        matchCloudAppPlatformResource({
          app: appServiceApp({ name: "CHECKOUT-API" }),
          candidates: [SITE],
        }),
      ),
    ).toBe("site");
  });

  test("an id no row has falls back to the name", () => {
    expect(
      labelOf(
        matchCloudAppPlatformResource({
          app: appServiceApp({
            providerResourceId: siteId("checkout-api", "rg-moved"),
          }),
          candidates: [SITE_V2, SITE],
        }),
      ),
    ).toBe("site");
  });

  test("two rows of one site: the one seen last wins", () => {
    const older: Row = row(
      "older",
      siteId("checkout-api"),
      new Date("2026-11-10T10:00:00Z"),
    );
    const newer: Row = row(
      "newer",
      siteId("Checkout-Api"),
      "2026-11-11T10:00:00.000Z",
    );

    expect(
      labelOf(
        matchCloudAppPlatformResource({
          app: appServiceApp(),
          candidates: [older, newer],
        }),
      ),
    ).toBe("newer");
  });

  test("an app of another slot has none: the site's numbers are the production slot's", () => {
    expect(
      matchCloudAppPlatformResource({
        app: appServiceApp({
          groupName: "staging",
          providerResourceId: siteId("checkout-api"),
        }),
        candidates: [SITE, SLOT],
      }),
    ).toBeNull();
  });

  test("rows with no id, or an id that is not ARM's, are passed over; with no match there is none", () => {
    const noId: Row = { label: "no id" };
    const badId: Row = row("bad id", "checkout-api");

    expect(
      matchCloudAppPlatformResource({
        app: appServiceApp(),
        candidates: [noId, badId, SITE_V2, PLAN],
      }),
    ).toBeNull();
    expect(
      matchCloudAppPlatformResource({
        app: appServiceApp({ name: "" }),
        candidates: [SITE],
      }),
    ).toBeNull();
  });

  test("the order the rows come in never changes which one is picked", () => {
    const random: SeededRandom = seededRandom(6770);
    const candidates: Array<Row> = [
      PLAN,
      SITE_V2,
      SLOT,
      row("older", siteId("checkout-api"), "2026-11-09T00:00:00.000Z"),
      row("latest", siteId("checkout-api"), "2026-11-11T00:00:00.000Z"),
      row(
        "other group",
        siteId("checkout-api", "rg-other"),
        "2026-11-12T00:00:00.000Z",
      ),
    ];

    for (let draw: number = 0; draw < 200; draw++) {
      const order: Array<Row> = shuffled(candidates, random);

      expect(
        labelOf(
          matchCloudAppPlatformResource({
            app: appServiceApp({ providerResourceId: siteId("checkout-api") }),
            candidates: order,
          }),
        ),
      ).toBe("latest");
    }
  });
});

describe("the site's metrics, as the connection stores them", () => {
  test("each is one of the site type's key metrics, so a connected subscription reads it", () => {
    const keyMetrics: Array<string> =
      getAzureKeyMetrics(APP_SERVICE_SITE_TYPE)?.metrics || [];

    for (const definition of Object.values(APP_SERVICE_METRICS)) {
      expect(keyMetrics).toContain(definition.metricName);
    }
  });

  test("with no reading of its own, each is read under Azure's primary aggregation", () => {
    expect({
      requests: getAppServiceStoredMetricName({
        metric: AppServiceMetric.Requests,
      }),
      serverErrors: getAppServiceStoredMetricName({
        metric: AppServiceMetric.ServerErrors,
      }),
      responseTime: getAppServiceStoredMetricName({
        metric: AppServiceMetric.ResponseTime,
      }),
      cpuTime: getAppServiceStoredMetricName({
        metric: AppServiceMetric.CpuTime,
      }),
      memory: getAppServiceStoredMetricName({
        metric: AppServiceMetric.MemoryWorkingSet,
      }),
    }).toEqual({
      requests: "azure_requests_total",
      serverErrors: "azure_http5xx_total",
      responseTime: "azure_httpresponsetime_average",
      cpuTime: "azure_cputime_total",
      memory: "azure_memoryworkingset_average",
    });
  });

  test("each stored name is the key metric it means, and keys the site's readings by the metric", () => {
    for (const metric of Object.values(AppServiceMetric)) {
      const stored: string = getAppServiceStoredMetricName({ metric });

      expect(getAzureKeyMetricOfStoredName(APP_SERVICE_SITE_TYPE, stored)).toBe(
        APP_SERVICE_METRICS[metric].metricName,
      );
      expect(getCloudReadingKey("azure", stored)).toBe(metric);
    }
  });

  test("the name the site's reading was stored under wins", () => {
    expect(
      getAppServiceStoredMetricName({
        metric: AppServiceMetric.MemoryWorkingSet,
        readings: {
          memoryworkingset: {
            value: 1024,
            time: "2026-11-11T10:00:00.000Z",
            metric: " AZURE_MEMORYWORKINGSET_MAXIMUM ",
          },
        },
      }),
    ).toBe("azure_memoryworkingset_maximum");
  });

  test("a reading with no name, or readings that are not readings, leave the primary one", () => {
    for (const readings of [
      null,
      "oops",
      [],
      { requests: { value: 3, time: "2026-11-11T10:00:00.000Z" } },
      {
        requests: {
          value: "x",
          time: "2026-11-11T10:00:00.000Z",
          metric: "azure_requests_count",
        },
      },
    ]) {
      expect(
        getAppServiceStoredMetricName({
          metric: AppServiceMetric.Requests,
          readings,
        }),
      ).toBe("azure_requests_total");
    }
  });
});

describe("the site's numbers over the range", () => {
  const START: number = new Date("2026-11-11T10:00:00.000Z").getTime();

  function points(values: Array<number>): Array<AppServiceSeriesPoint> {
    return values.map((value: number, index: number): AppServiceSeriesPoint => {
      return { x: new Date(START + index * 60_000), y: value };
    });
  }

  function series(fields: Partial<AppServiceSeries>): AppServiceSeries {
    return {
      requests: [],
      serverErrors: [],
      responseTimeSeconds: [],
      cpuTimeSeconds: [],
      memoryBytes: [],
      ...fields,
    };
  }

  test("what is counted adds up, and what is measured averages over the intervals", () => {
    expect(
      summarizeAppServiceSeries(
        series({
          requests: points([100, 300, 600]),
          serverErrors: points([1, 4, 5]),
          responseTimeSeconds: points([0.2, 0.4]),
          cpuTimeSeconds: points([1.5, 2.5, 6]),
          memoryBytes: points([100, 200, 300, 400]),
        }),
      ),
    ).toEqual({
      requests: 1000,
      serverErrors: 10,
      serverErrorRatePercent: 1,
      responseTimeMs: 300.00000000000006,
      cpuTimeSeconds: 10,
      memoryBytes: 250,
    });
  });

  test("nothing measured is unknown, not 0", () => {
    expect(summarizeAppServiceSeries(series({}))).toEqual({
      requests: null,
      serverErrors: null,
      serverErrorRatePercent: null,
      responseTimeMs: null,
      cpuTimeSeconds: null,
      memoryBytes: null,
    });
  });

  test("a site that served nothing has no error rate, and one whose 5xx count was not read has none either", () => {
    expect(
      summarizeAppServiceSeries(
        series({ requests: points([0, 0]), serverErrors: points([0]) }),
      ).serverErrorRatePercent,
    ).toBeNull();
    expect(
      summarizeAppServiceSeries(series({ requests: points([40]) }))
        .serverErrorRatePercent,
    ).toBeNull();
    // Azure's zeros are a count: no 5xx answer is 0%.
    expect(
      summarizeAppServiceSeries(
        series({ requests: points([40]), serverErrors: points([0]) }),
      ).serverErrorRatePercent,
    ).toBe(0);
  });

  test("a bucket that read no number is passed over, in a sum and in a mean", () => {
    expect(
      summarizeAppServiceSeries(
        series({
          requests: points([10, Number.NaN, 30]),
          memoryBytes: points([100, Number.POSITIVE_INFINITY, 300]),
          responseTimeSeconds: points([Number.NaN]),
        }),
      ),
    ).toEqual({
      requests: 40,
      serverErrors: null,
      serverErrorRatePercent: null,
      responseTimeMs: null,
      cpuTimeSeconds: null,
      memoryBytes: 200,
    });
  });

  test("over any series, the totals are the sums and the means lie between the smallest and largest", () => {
    const random: SeededRandom = seededRandom(20261111);

    for (let draw: number = 0; draw < 300; draw++) {
      const count: number = 1 + random(48);
      const requests: Array<number> = [];
      const errors: Array<number> = [];
      const memory: Array<number> = [];

      for (let index: number = 0; index < count; index++) {
        const served: number = random(5_000);
        requests.push(served);
        errors.push(random(served + 1));
        memory.push(64_000_000 + random(1_000_000_000));
      }

      const summary: ReturnType<typeof summarizeAppServiceSeries> =
        summarizeAppServiceSeries(
          series({
            requests: points(requests),
            serverErrors: points(errors),
            memoryBytes: points(memory),
          }),
        );
      const totalRequests: number = requests.reduce((a: number, b: number) => {
        return a + b;
      }, 0);
      const totalErrors: number = errors.reduce((a: number, b: number) => {
        return a + b;
      }, 0);

      expect(summary.requests).toBe(totalRequests);
      expect(summary.serverErrors).toBe(totalErrors);
      expect(summary.serverErrorRatePercent).toBe(
        totalRequests > 0 ? (totalErrors / totalRequests) * 100 : null,
      );
      expect(summary.memoryBytes).toBeGreaterThanOrEqual(Math.min(...memory));
      expect(summary.memoryBytes).toBeLessThanOrEqual(Math.max(...memory));
    }
  });
});

describe("the site's CPU time, as a reader says a duration", () => {
  test("under a minute it reads as the response time does", () => {
    expect(formatAppServiceCpuTime(0.45)).toBe("450 ms");
    expect(formatAppServiceCpuTime(0.004)).toBe("4.0 ms");
    expect(formatAppServiceCpuTime(12.5)).toBe("12.50 s");
    expect(formatAppServiceCpuTime(59.9)).toBe("59.90 s");
    expect(formatAppServiceCpuTime(0)).toBe("0 µs");
  });

  test("from a minute, its two largest whole units - never thousands of seconds", () => {
    expect(formatAppServiceCpuTime(60)).toBe("1m");
    expect(formatAppServiceCpuTime(90)).toBe("1m 30s");
    expect(formatAppServiceCpuTime(5400)).toBe("1h 30m");
    expect(formatAppServiceCpuTime(2 * 3600 + 5 * 60 + 59)).toBe("2h 5m");
    expect(formatAppServiceCpuTime(3 * 86400 + 4 * 3600)).toBe("3d 4h");
  });

  test("unknown is a dash, never 0", () => {
    expect(formatAppServiceCpuTime(null)).toBe("—");
    expect(formatAppServiceCpuTime(Number.NaN)).toBe("—");
    expect(formatAppServiceCpuTime(Number.POSITIVE_INFINITY)).toBe("—");
  });

  test("in the reader's language, with the language's own short unit names", () => {
    const german: string = formatAppServiceCpuTime(5400, "de");

    expect(german).not.toBe("1h 30m");
    expect(german).toContain("30");
    expect(german).toContain("Min.");
    // English, and a duration under a minute, read as before.
    expect(formatAppServiceCpuTime(5400, "en")).toBe("1h 30m");
    expect(formatAppServiceCpuTime(12.5, "de")).toBe("12.50 s");
  });

  test("a seeded sweep: every reading from a minute up names at most two whole units", () => {
    const random: SeededRandom = seededRandom(677060);

    for (let draw: number = 0; draw < 500; draw++) {
      const seconds: number = 60 + random(10 * 86400);
      const text: string = formatAppServiceCpuTime(seconds);
      const parts: Array<string> = text.split(" ");

      expect(parts.length).toBeGreaterThanOrEqual(1);
      expect(parts.length).toBeLessThanOrEqual(2);
      for (const part of parts) {
        expect(part).toMatch(/^[1-9]\d*[dhms]$/);
      }
    }
  });
});
