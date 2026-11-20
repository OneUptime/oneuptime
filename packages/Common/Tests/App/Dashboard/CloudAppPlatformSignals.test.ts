import { afterEach, describe, expect, jest, test } from "@jest/globals";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import ObjectID from "../../../Types/ObjectID";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import {
  CLOUD_APP_PLATFORM_SIGNAL_WINDOW_MINUTES,
  CloudAppPlatformMetricRead,
  CloudAppPlatformSignalResult,
  CloudAppPlatformSignalSource,
  CloudAppPlatformSignals,
  fetchCloudAppPlatformSignals,
  getCloudAppPlatformMetricReads,
  getCloudAppPlatformSiteIds,
  getPlatformSiteMetricKey,
  readPlatformMetricGroups,
  showsCloudAppPlatformSignals,
  summarizePlatformSite,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppPlatformSignals";
import {
  AppServiceMetric,
  getAppServiceStoredMetricName,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppPlatformResource";

/*
 * AN APP SERVICE APP'S SITE NUMBERS IN A LIST OF APPS (#10406).
 *
 * All Apps, an environment's Apps and its Overview's Apps card said "No
 * traces" for an App Service app that sends none, though Azure Monitor
 * counts its site's requests whatever the app sends. The list now reads the
 * site the server keeps on the app (#10407) - with the reader's own
 * permissions, so a site they may not read shows nothing - and its
 * requests, 5xx answers and response time over the last hour, in three
 * grouped reads for the whole page. These tests pin:
 *
 *   - which apps show their site's numbers: App Service, tied to a site,
 *     no trace ever - never one that sends traces, another slot or another
 *     platform;
 *   - the sites are read by the ids the server kept, as the reader, and
 *     only the sites read are asked for metrics - by their own attribute,
 *     never unscoped;
 *   - three reads for the page, each a total of the last hour, grouped by
 *     the site's attribute, under the name the site keeps each metric;
 *   - nothing measured is never 0: a metric a site did not report is
 *     unknown, and a read that fails says so.
 */

const PROJECT_ID: ObjectID = new ObjectID("7c000000-0000-4000-8000-000000000001");
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const SUBSCRIPTION: string = "d6252cc9-f01c-428b-924d-9896199f9a13";

function armId(name: string): string {
  return `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-web/providers/Microsoft.Web/sites/${name}`;
}

const CHECKOUT_SITE_ROW: string = "7c000000-0000-4000-8000-000000000101";
const ORDERS_SITE_ROW: string = "7c000000-0000-4000-8000-000000000102";
const HIDDEN_SITE_ROW: string = "7c000000-0000-4000-8000-000000000103";

function app(
  index: number,
  fields: Partial<CloudAppPlatformSignalSource> = {},
): CloudAppPlatformSignalSource {
  return {
    _id: `7c000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name: `app-${index}`,
    cloudPlatform: "azure_app_service",
    groupName: null,
    platformCloudResourceId: CHECKOUT_SITE_ROW,
    tracesLastReceivedAt: null,
    ...fields,
  };
}

function siteRow(
  id: string,
  name: string,
  fields: Partial<CloudResource> = {},
): CloudResource {
  return Object.assign(new CloudResource(), {
    _id: id,
    cloudResourceKind: CloudResourceKind.Resource,
    telemetryAttributes: { "azuremonitor.resource_id": armId(name) },
    cloudReadings: {},
    ...fields,
  });
}

function group(resourceId: string, value: number): AggregatedModel {
  return {
    timestamp: NOW,
    value,
    attributes: { "azuremonitor.resource_id": resourceId },
  } as unknown as AggregatedModel;
}

const REQUESTS: string = getAppServiceStoredMetricName({
  metric: AppServiceMetric.Requests,
});
const SERVER_ERRORS: string = getAppServiceStoredMetricName({
  metric: AppServiceMetric.ServerErrors,
});
const RESPONSE_TIME: string = getAppServiceStoredMetricName({
  metric: AppServiceMetric.ResponseTime,
});

interface AggregateCall {
  modelType: { name: string };
  aggregateBy: {
    query: Record<string, unknown>;
    aggregationType: AggregationType;
    aggregationInterval: AggregationInterval;
    groupByAttributeKeys: Array<string>;
    startTimestamp: Date;
    endTimestamp: Date;
  };
}

interface ListCall {
  modelType: { name: string };
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which apps show their site's numbers", () => {
  test("an App Service app tied to its site, that never sent a trace", () => {
    expect(showsCloudAppPlatformSignals(app(1))).toBe(true);
  });

  test("never one that sends traces: its own traced requests are its numbers", () => {
    expect(
      showsCloudAppPlatformSignals(app(1, { tracesLastReceivedAt: NOW })),
    ).toBe(false);
  });

  test("never one with no site kept, another platform's, or another slot's", () => {
    expect(
      showsCloudAppPlatformSignals(app(1, { platformCloudResourceId: null })),
    ).toBe(false);
    expect(
      showsCloudAppPlatformSignals(app(1, { cloudPlatform: "aws_ecs" })),
    ).toBe(false);
    expect(showsCloudAppPlatformSignals(app(1, { groupName: "staging" }))).toBe(
      false,
    );
  });

  test("each such app's kept site, by app id", () => {
    expect(
      Array.from(
        getCloudAppPlatformSiteIds([
          app(1),
          app(2, { platformCloudResourceId: ORDERS_SITE_ROW }),
          app(3, { tracesLastReceivedAt: NOW }),
          app(4, { platformCloudResourceId: undefined }),
        ]).entries(),
      ),
    ).toEqual([
      ["7c000000-0000-4000-8000-000000000001", CHECKOUT_SITE_ROW],
      ["7c000000-0000-4000-8000-000000000002", ORDERS_SITE_ROW],
    ]);
  });
});

describe("how a site's metrics are named", () => {
  test("by its azuremonitor.resource_id alone", () => {
    expect(
      getPlatformSiteMetricKey(siteRow(CHECKOUT_SITE_ROW, "checkout-api")),
    ).toBe(armId("checkout-api"));
  });

  test("never a row named otherwise, an environment, or one with no attribute: never read unscoped", () => {
    expect(
      getPlatformSiteMetricKey(
        siteRow(CHECKOUT_SITE_ROW, "checkout-api", {
          telemetryAttributes: {
            "azuremonitor.resource_id": armId("checkout-api"),
            Namespace: "AWS/EC2",
          },
        }),
      ),
    ).toBeNull();
    expect(
      getPlatformSiteMetricKey(
        siteRow(CHECKOUT_SITE_ROW, "checkout-api", {
          cloudResourceKind: CloudResourceKind.Environment,
        }),
      ),
    ).toBeNull();
    expect(
      getPlatformSiteMetricKey(
        siteRow(CHECKOUT_SITE_ROW, "checkout-api", { telemetryAttributes: {} }),
      ),
    ).toBeNull();
    expect(getPlatformSiteMetricKey(null)).toBeNull();
  });
});

describe("the reads a page of sites takes", () => {
  test("one per metric for every site, each under the name the sites keep it", () => {
    const reads: Array<CloudAppPlatformMetricRead> =
      getCloudAppPlatformMetricReads([
        siteRow(CHECKOUT_SITE_ROW, "checkout-api"),
        siteRow(ORDERS_SITE_ROW, "orders-api"),
      ]);

    expect(
      reads.map((read: CloudAppPlatformMetricRead) => {
        return [read.metric, read.storedName, read.aggregationType];
      }),
    ).toEqual([
      [AppServiceMetric.Requests, REQUESTS, AggregationType.Sum],
      [AppServiceMetric.ServerErrors, SERVER_ERRORS, AggregationType.Sum],
      [AppServiceMetric.ResponseTime, RESPONSE_TIME, AggregationType.Avg],
    ]);

    for (const read of reads) {
      expect(read.resourceIds).toEqual([
        armId("checkout-api"),
        armId("orders-api"),
      ]);
    }
  });

  test("a site whose reading names another stored name is read under it", () => {
    const reads: Array<CloudAppPlatformMetricRead> =
      getCloudAppPlatformMetricReads([
        siteRow(CHECKOUT_SITE_ROW, "checkout-api"),
        siteRow(ORDERS_SITE_ROW, "orders-api", {
          cloudReadings: {
            requests: { value: 3, time: NOW.toISOString(), metric: "azure_requests_count" },
          },
        }),
      ]);

    const requests: Array<CloudAppPlatformMetricRead> = reads.filter(
      (read: CloudAppPlatformMetricRead): boolean => {
        return read.metric === AppServiceMetric.Requests;
      },
    );

    expect(
      requests.map((read: CloudAppPlatformMetricRead) => {
        return [read.storedName, read.resourceIds];
      }),
    ).toEqual([
      [REQUESTS, [armId("checkout-api")]],
      ["azure_requests_count", [armId("orders-api")]],
    ]);
  });

  test("a site read once, however many apps keep it; none for a site named otherwise", () => {
    const reads: Array<CloudAppPlatformMetricRead> =
      getCloudAppPlatformMetricReads([
        siteRow(CHECKOUT_SITE_ROW, "checkout-api"),
        siteRow(CHECKOUT_SITE_ROW, "checkout-api"),
        siteRow(ORDERS_SITE_ROW, "orders-api", { telemetryAttributes: {} }),
      ]);

    expect(reads[0]!.resourceIds).toEqual([armId("checkout-api")]);
  });
});

describe("a site's hour, from the reads' groups", () => {
  test("the groups are read by the site's attribute; a split answer adds up", () => {
    expect(
      Array.from(
        readPlatformMetricGroups([
          group(armId("checkout-api"), 100),
          group(armId("checkout-api"), 20),
          group(armId("orders-api"), 7),
          { value: 9 } as unknown as AggregatedModel,
          group(armId("broken"), Number.NaN),
        ]).entries(),
      ),
    ).toEqual([
      [armId("checkout-api"), 120],
      [armId("orders-api"), 7],
    ]);
  });

  function summaryOf(values: {
    requests?: number;
    serverErrors?: number;
    responseTime?: number;
  }): CloudAppPlatformSignals {
    const id: string = armId("checkout-api");
    const valuesByRead: Map<string, Map<string, number>> = new Map();

    const put: (metric: AppServiceMetric, name: string, value?: number) => void =
      (metric: AppServiceMetric, name: string, value?: number): void => {
        valuesByRead.set(
          `${metric}|${name}`,
          new Map(value === undefined ? [] : [[id, value]]),
        );
      };

    put(AppServiceMetric.Requests, REQUESTS, values.requests);
    put(AppServiceMetric.ServerErrors, SERVER_ERRORS, values.serverErrors);
    put(AppServiceMetric.ResponseTime, RESPONSE_TIME, values.responseTime);

    return summarizePlatformSite({
      resourceId: id,
      readings: {},
      values: valuesByRead,
      at: NOW,
    });
  }

  test("its requests, 5xx answers and their share, and its mean response time in milliseconds", () => {
    expect(
      summaryOf({ requests: 1200, serverErrors: 6, responseTime: 0.18 }),
    ).toEqual({
      requests: 1200,
      serverErrors: 6,
      serverErrorRatePercent: 0.5,
      responseTimeMs: 180,
    });
  });

  test("a metric the site did not report is unknown, never 0", () => {
    expect(summaryOf({ requests: 1200 })).toEqual({
      requests: 1200,
      serverErrors: null,
      // No 5xx point at all was read: its share is unknown, not 0%.
      serverErrorRatePercent: null,
      responseTimeMs: null,
    });
    expect(summaryOf({})).toEqual({
      requests: null,
      serverErrors: null,
      serverErrorRatePercent: null,
      responseTimeMs: null,
    });
  });

  test("a site that answered nothing: 0 requests, measured, and no share", () => {
    expect(summaryOf({ requests: 0, serverErrors: 0 })).toEqual({
      requests: 0,
      serverErrors: 0,
      serverErrorRatePercent: null,
      responseTimeMs: null,
    });
  });

  test("a site's id in another case is still its own", () => {
    const valuesByRead: Map<string, Map<string, number>> = new Map([
      [
        `${AppServiceMetric.Requests}|${REQUESTS}`,
        new Map([[armId("checkout-api").toLowerCase(), 40]]),
      ],
    ]);

    expect(
      summarizePlatformSite({
        resourceId: armId("checkout-api"),
        readings: {},
        values: valuesByRead,
        at: NOW,
      }).requests,
    ).toBe(40);
  });
});

describe("fetchCloudAppPlatformSignals: as the reader may read", () => {
  interface Server {
    lists: Array<ListCall>;
    aggregates: Array<AggregateCall>;
  }

  function serve(data: {
    // The sites the reader may read, of those asked for.
    readable: Array<CloudResource>;
    groups?: Record<string, Array<AggregatedModel>>;
    failSites?: boolean;
    failMetrics?: boolean;
  }): Server {
    const server: Server = { lists: [], aggregates: [] };

    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
      PROJECT_ID,
    );
    getJestSpyOn(ModelAPI, "getList").mockImplementation(
      async (request: ListCall) => {
        server.lists.push(request);

        if (data.failSites) {
          throw new Error("403");
        }

        const asked: Array<string> = (
          ((request.query["_id"] as Includes).values || []) as Array<unknown>
        ).map((value: unknown): string => {
          return String(value);
        });

        const rows: Array<CloudResource> = data.readable.filter(
          (row: CloudResource): boolean => {
            return asked.includes(String(row._id));
          },
        );

        return { data: rows, count: rows.length, skip: 0, limit: 50 };
      },
    );
    getJestSpyOn(AnalyticsModelAPI, "aggregate").mockImplementation(
      async (request: AggregateCall) => {
        server.aggregates.push(request);

        if (data.failMetrics) {
          throw new Error("403");
        }

        return {
          data: (data.groups || {})[String(request.aggregateBy.query["name"])] || [],
        };
      },
    );

    return server;
  }

  test("nothing is read when no app shows its site's numbers", async () => {
    const server: Server = serve({ readable: [] });

    const result: CloudAppPlatformSignalResult =
      await fetchCloudAppPlatformSignals({
        apps: [app(1, { tracesLastReceivedAt: NOW }), app(2, { cloudPlatform: "aws_ecs" })],
        now: NOW,
      });

    expect(result).toEqual({ signals: new Map(), failed: false });
    expect(server.lists).toEqual([]);
    expect(server.aggregates).toEqual([]);
  });

  test("the kept sites are read by id, as the reader; then three grouped reads of the last hour", async () => {
    const server: Server = serve({
      readable: [
        siteRow(CHECKOUT_SITE_ROW, "checkout-api"),
        siteRow(ORDERS_SITE_ROW, "orders-api"),
      ],
      groups: {
        [REQUESTS]: [
          group(armId("checkout-api"), 1200),
          group(armId("orders-api"), 50),
        ],
        [SERVER_ERRORS]: [
          group(armId("checkout-api"), 60),
          group(armId("orders-api"), 0),
        ],
        [RESPONSE_TIME]: [group(armId("checkout-api"), 0.25)],
      },
    });

    const result: CloudAppPlatformSignalResult =
      await fetchCloudAppPlatformSignals({
        apps: [
          app(1),
          app(2, { platformCloudResourceId: ORDERS_SITE_ROW }),
          // Two apps of one site read it once.
          app(3),
        ],
        now: NOW,
      });

    expect(server.lists).toHaveLength(1);
    expect(server.lists[0]!.modelType.name).toBe("CloudResource");
    expect(
      ((server.lists[0]!.query["_id"] as Includes).values as Array<unknown>).map(
        (value: unknown): string => {
          return String(value);
        },
      ),
    ).toEqual([CHECKOUT_SITE_ROW, ORDERS_SITE_ROW]);
    expect(server.lists[0]!.query["cloudResourceKind"]).toBe(
      CloudResourceKind.Resource,
    );
    expect(server.lists[0]!.query["cloudResourceType"]).toBe(
      "Microsoft.Web/sites",
    );

    expect(server.aggregates).toHaveLength(3);
    for (const call of server.aggregates) {
      expect(call.modelType.name).toBe("Metric");
      expect(call.aggregateBy.aggregationInterval).toBe(
        AggregationInterval.Total,
      );
      expect(call.aggregateBy.groupByAttributeKeys).toEqual([
        "azuremonitor.resource_id",
      ]);
      expect(call.aggregateBy.query["projectId"]).toBe(PROJECT_ID);

      const window: InBetween<Date> = call.aggregateBy.query[
        "time"
      ] as InBetween<Date>;
      expect(window.endValue).toEqual(NOW);
      expect(NOW.getTime() - window.startValue.getTime()).toBe(
        CLOUD_APP_PLATFORM_SIGNAL_WINDOW_MINUTES * 60 * 1000,
      );

      // Scoped to the sites read: never every Azure resource's metrics.
      const scope: Includes = (
        call.aggregateBy.query["attributes"] as Record<string, Includes>
      )["azuremonitor.resource_id"]!;
      expect(scope.values).toEqual([
        armId("checkout-api"),
        armId("orders-api"),
      ]);
    }

    expect(Array.from(result.signals.entries())).toEqual([
      [
        "7c000000-0000-4000-8000-000000000001",
        {
          requests: 1200,
          serverErrors: 60,
          serverErrorRatePercent: 5,
          responseTimeMs: 250,
        },
      ],
      [
        "7c000000-0000-4000-8000-000000000002",
        {
          requests: 50,
          serverErrors: 0,
          serverErrorRatePercent: 0,
          responseTimeMs: null,
        },
      ],
      [
        "7c000000-0000-4000-8000-000000000003",
        {
          requests: 1200,
          serverErrors: 60,
          serverErrorRatePercent: 5,
          responseTimeMs: 250,
        },
      ],
    ]);
    expect(result.failed).toBe(false);
  });

  test("a site the reader may not read shows nothing, and its metrics are never asked for", async () => {
    const server: Server = serve({
      // The reader's labels give them the checkout site only.
      readable: [siteRow(CHECKOUT_SITE_ROW, "checkout-api")],
      groups: {
        [REQUESTS]: [
          group(armId("checkout-api"), 10),
          group(armId("secret-api"), 999),
        ],
      },
    });

    const result: CloudAppPlatformSignalResult =
      await fetchCloudAppPlatformSignals({
        apps: [app(1), app(2, { platformCloudResourceId: HIDDEN_SITE_ROW })],
        now: NOW,
      });

    expect(Array.from(result.signals.keys())).toEqual([
      "7c000000-0000-4000-8000-000000000001",
    ]);

    for (const call of server.aggregates) {
      const scope: Includes = (
        call.aggregateBy.query["attributes"] as Record<string, Includes>
      )["azuremonitor.resource_id"]!;
      expect(scope.values).toEqual([armId("checkout-api")]);
    }
  });

  test("no readable site: no metric read at all", async () => {
    const server: Server = serve({ readable: [] });

    const result: CloudAppPlatformSignalResult =
      await fetchCloudAppPlatformSignals({ apps: [app(1)], now: NOW });

    expect(result).toEqual({ signals: new Map(), failed: false });
    expect(server.aggregates).toEqual([]);
  });

  test("a read that fails says so, and shows no number", async () => {
    serve({ readable: [], failSites: true });

    expect(
      await fetchCloudAppPlatformSignals({ apps: [app(1)], now: NOW }),
    ).toEqual({ signals: new Map(), failed: true });

    jest.restoreAllMocks();
    serve({
      readable: [siteRow(CHECKOUT_SITE_ROW, "checkout-api")],
      failMetrics: true,
    });

    expect(
      await fetchCloudAppPlatformSignals({ apps: [app(1)], now: NOW }),
    ).toEqual({ signals: new Map(), failed: true });
  });

  test("outside a project, nothing is read", async () => {
    const server: Server = serve({ readable: [] });
    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);

    expect(
      await fetchCloudAppPlatformSignals({ apps: [app(1)], now: NOW }),
    ).toEqual({ signals: new Map(), failed: false });
    expect(server.lists).toEqual([]);
  });
});
