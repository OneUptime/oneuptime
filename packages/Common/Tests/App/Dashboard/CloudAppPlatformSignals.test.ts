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
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";
import {
  CLOUD_APP_PLATFORM_SIGNAL_WINDOW_MINUTES,
  CloudAppPlatformGroupRead,
  CloudAppPlatformGroupValue,
  CloudAppPlatformSignalResult,
  CloudAppPlatformSignalSource,
  CloudAppPlatformSignals,
  fetchCloudAppPlatformSignals,
  getCloudAppPlatformMetricReads,
  getCloudAppPlatformSiteIds,
  getPlatformResourceFilters,
  readPlatformMetricGroups,
  showsCloudAppPlatformSignals,
  summarizePlatformSite,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppPlatformSignals";
import {
  APP_ENGINE_ERROR_LABEL,
  CLOUD_RUN_ERROR_LABEL,
  CloudAppPlatformFigure,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppPlatformMetrics";
import {
  AppServiceMetric,
  getAppServiceStoredMetricName,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppPlatformResource";

/*
 * AN APP'S PLATFORM NUMBERS IN A LIST OF APPS (#10406, #6793, #6794).
 *
 * All Apps, an environment's Apps and its Overview's Apps card said "No
 * traces" for an app that sends none, though its provider's monitoring
 * counts the requests of the resource it runs as whatever the app sends.
 * The list reads the resource the server keeps on the app (#10407) - with
 * the reader's own permissions, so one they may not read shows nothing -
 * and its requests, 5xx answers and latency over the last hour, in a few
 * grouped reads for the whole page. These tests pin:
 *
 *   - which apps show their resource's numbers: tied to one, no trace ever,
 *     of a platform a list reads numbers of - an App Service site or slot,
 *     a Container App, a Cloud Run, App Engine or App Runner service; never
 *     an ECS service, whose requests are its load balancer's;
 *   - each resource is read by the attributes its own row names - Azure's
 *     ARM id, a Cloud Monitoring type's labels, a CloudWatch namespace's
 *     dimensions, account and Region - never unscoped;
 *   - one read per metric, stored name and set of those attributes, each a
 *     total of the last hour, grouped by them;
 *   - Cloud Run's and App Engine's 5xx are read with their requests,
 *     grouped by the label their response code is on (response_code_class,
 *     response_code), never guessed;
 *   - nothing measured is never 0: a metric a resource did not report is
 *     unknown, a Container App's 5xx share too, and a read that fails says
 *     so.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000001",
);
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const SUBSCRIPTION: string = "d6252cc9-f01c-428b-924d-9896199f9a13";
const PROJECT: string = "shop-prod";
const ACCOUNT: string = "123456789012";

function armId(name: string): string {
  return `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-web/providers/Microsoft.Web/sites/${name}`;
}

const AZURE_ID: string = "azuremonitor.resource_id";

const CHECKOUT_SITE_ROW: string = "7c000000-0000-4000-8000-000000000101";
const ORDERS_SITE_ROW: string = "7c000000-0000-4000-8000-000000000102";
const HIDDEN_SITE_ROW: string = "7c000000-0000-4000-8000-000000000103";
const STAGING_SLOT_ROW: string = "7c000000-0000-4000-8000-000000000104";
const RUN_ROW: string = "7c000000-0000-4000-8000-000000000105";
const APP_RUNNER_ROW: string = "7c000000-0000-4000-8000-000000000106";
const CONTAINER_APP_ROW: string = "7c000000-0000-4000-8000-000000000107";
const GAE_ROW: string = "7c000000-0000-4000-8000-000000000108";

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
    cloudResourceType: "Microsoft.Web/sites",
    telemetryAttributes: { [AZURE_ID]: armId(name) },
    cloudReadings: {},
    ...fields,
  });
}

function slotRow(id: string, site: string, slot: string): CloudResource {
  return siteRow(id, site, {
    cloudResourceType: "Microsoft.Web/sites/slots",
    telemetryAttributes: { [AZURE_ID]: `${armId(site)}/slots/${slot}` },
  });
}

function containerAppRow(id: string, name: string): CloudResource {
  return siteRow(id, name, {
    cloudResourceType: "Microsoft.App/containerApps",
    telemetryAttributes: {
      [AZURE_ID]: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-apps/providers/Microsoft.App/containerApps/${name}`,
    },
  });
}

// A Cloud Run service's row, as Cloud Monitoring's labels name it.
function runAttributes(service: string): Record<string, string> {
  return {
    "resource.gcp.resource_type": "cloud_run_revision",
    "resource.location": "us-central1",
    "resource.project_id": PROJECT,
    "resource.service_name": service,
  };
}

function runRow(id: string, service: string): CloudResource {
  return siteRow(id, service, {
    cloudResourceType: "cloud_run_revision",
    telemetryAttributes: runAttributes(service),
  });
}

function gaeAttributes(service: string): Record<string, string> {
  return {
    "resource.gcp.resource_type": "gae_app",
    "resource.module_id": service,
    "resource.project_id": PROJECT,
  };
}

function gaeRow(id: string, service: string): CloudResource {
  return siteRow(id, service, {
    cloudResourceType: "gae_app",
    telemetryAttributes: gaeAttributes(service),
  });
}

// An App Runner service's row, as CloudWatch's dimensions name it.
function appRunnerAttributes(service: string): Record<string, string> {
  return {
    Namespace: "AWS/AppRunner",
    "Dimensions.ServiceName": service,
    "resource.cloud.account.id": ACCOUNT,
    "resource.cloud.region": "us-east-1",
  };
}

function appRunnerRow(id: string, service: string): CloudResource {
  return siteRow(id, service, {
    cloudResourceType: "AWS::AppRunner::Service",
    telemetryAttributes: appRunnerAttributes(service),
  });
}

function group(
  attributes: Record<string, string>,
  value: number,
): AggregatedModel {
  return { timestamp: NOW, value, attributes } as unknown as AggregatedModel;
}

function azureGroup(resourceId: string, value: number): AggregatedModel {
  return group({ [AZURE_ID]: resourceId }, value);
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
const RUN_REQUESTS: string = "run.googleapis.com/request_count";
const RUN_LATENCY: string = "run.googleapis.com/request_latencies";
const GAE_REQUESTS: string =
  "appengine.googleapis.com/http/server/response_count";

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

// Each read by what it reads: figure, stored name and grouping attributes.
function describeReads(
  reads: Array<CloudAppPlatformGroupRead>,
): Array<[string, string, AggregationType, number, Array<string>, string]> {
  return reads.map(
    (
      read: CloudAppPlatformGroupRead,
    ): [string, string, AggregationType, number, Array<string>, string] => {
      return [
        read.figure,
        read.storedName,
        read.aggregationType,
        read.scale,
        read.keys,
        read.errorLabel ? read.errorLabel.attribute : "",
      ];
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which apps show their resource's numbers", () => {
  test("an App Service app tied to its site, that never sent a trace", () => {
    expect(showsCloudAppPlatformSignals(app(1))).toBe(true);
  });

  test("never one that sends traces: its own traced requests are its numbers", () => {
    expect(
      showsCloudAppPlatformSignals(app(1, { tracesLastReceivedAt: NOW })),
    ).toBe(false);
  });

  test("never one with no resource kept", () => {
    expect(
      showsCloudAppPlatformSignals(app(1, { platformCloudResourceId: null })),
    ).toBe(false);
    expect(
      showsCloudAppPlatformSignals(app(1, { platformCloudResourceId: " " })),
    ).toBe(false);
  });

  test("an app of a deployment slot shows its slot's (#6793)", () => {
    expect(showsCloudAppPlatformSignals(app(1, { groupName: "staging" }))).toBe(
      true,
    );
  });

  test("an app of every platform a list reads requests of, and never an ECS one, nor one with none (#6794)", () => {
    for (const [platform, shows] of [
      ["azure_container_apps", true],
      ["gcp_cloud_run", true],
      ["gcp_app_engine", true],
      ["aws_app_runner", true],
      // ECS publishes no requests of its own: its list says what its traces say.
      ["aws_ecs", false],
      ["aws_elastic_beanstalk", false],
      ["azure_container_instances", false],
    ] as Array<[string, boolean]>) {
      expect({
        platform,
        shows: showsCloudAppPlatformSignals(
          app(1, { cloudPlatform: platform, groupName: "prod" }),
        ),
      }).toEqual({ platform, shows });
    }
  });

  test("each such app's kept resource, by app id", () => {
    expect(
      Array.from(
        getCloudAppPlatformSiteIds([
          app(1),
          app(2, { platformCloudResourceId: ORDERS_SITE_ROW }),
          app(3, { tracesLastReceivedAt: NOW }),
          app(4, { platformCloudResourceId: undefined }),
          app(5, { cloudPlatform: "gcp_cloud_run", platformCloudResourceId: RUN_ROW }),
          app(6, { cloudPlatform: "aws_ecs", groupName: "prod" }),
        ]).entries(),
      ),
    ).toEqual([
      ["7c000000-0000-4000-8000-000000000001", CHECKOUT_SITE_ROW],
      ["7c000000-0000-4000-8000-000000000002", ORDERS_SITE_ROW],
      ["7c000000-0000-4000-8000-000000000005", RUN_ROW],
    ]);
  });
});

describe("how a resource's metrics are named", () => {
  test("an Azure resource's by its azuremonitor.resource_id", () => {
    expect(
      getPlatformResourceFilters(siteRow(CHECKOUT_SITE_ROW, "checkout-api")),
    ).toEqual({ [AZURE_ID]: armId("checkout-api") });
  });

  test("a Cloud Monitoring or CloudWatch resource's by every attribute its row names", () => {
    expect(getPlatformResourceFilters(runRow(RUN_ROW, "checkout"))).toEqual(
      runAttributes("checkout"),
    );
    expect(
      getPlatformResourceFilters(appRunnerRow(APP_RUNNER_ROW, "checkout")),
    ).toEqual(appRunnerAttributes("checkout"));
  });

  test("never an environment, or a row with no attribute: never read unscoped", () => {
    expect(
      getPlatformResourceFilters(
        siteRow(CHECKOUT_SITE_ROW, "checkout-api", {
          cloudResourceKind: CloudResourceKind.Environment,
        }),
      ),
    ).toBeNull();
    expect(
      getPlatformResourceFilters(
        siteRow(CHECKOUT_SITE_ROW, "checkout-api", { telemetryAttributes: {} }),
      ),
    ).toBeNull();
    expect(getPlatformResourceFilters(null)).toBeNull();
  });
});

describe("the reads a page takes", () => {
  test("App Service sites and slots: one per metric, under the name they keep it, grouped by their ARM id", () => {
    const reads: Array<CloudAppPlatformGroupRead> =
      getCloudAppPlatformMetricReads([
        siteRow(CHECKOUT_SITE_ROW, "checkout-api"),
        siteRow(ORDERS_SITE_ROW, "orders-api"),
        slotRow(STAGING_SLOT_ROW, "checkout-api", "staging"),
      ]);

    expect(describeReads(reads)).toEqual([
      [
        CloudAppPlatformFigure.Requests,
        REQUESTS,
        AggregationType.Sum,
        1,
        [AZURE_ID],
        "",
      ],
      [
        CloudAppPlatformFigure.ServerErrors,
        SERVER_ERRORS,
        AggregationType.Sum,
        1,
        [AZURE_ID],
        "",
      ],
      // Azure Monitor reports HttpResponseTime in seconds.
      [
        CloudAppPlatformFigure.ResponseTime,
        RESPONSE_TIME,
        AggregationType.Avg,
        1000,
        [AZURE_ID],
        "",
      ],
    ]);

    for (const read of reads) {
      expect(read.resources).toEqual([
        [armId("checkout-api")],
        [armId("orders-api")],
        [`${armId("checkout-api")}/slots/staging`],
      ]);
    }
  });

  test("a site whose reading names another stored name is read under it", () => {
    const reads: Array<CloudAppPlatformGroupRead> =
      getCloudAppPlatformMetricReads([
        siteRow(CHECKOUT_SITE_ROW, "checkout-api"),
        siteRow(ORDERS_SITE_ROW, "orders-api", {
          cloudReadings: {
            requests: {
              value: 3,
              time: NOW.toISOString(),
              metric: "azure_requests_count",
            },
          },
        }),
      ]);

    expect(
      reads
        .filter((read: CloudAppPlatformGroupRead): boolean => {
          return read.figure === CloudAppPlatformFigure.Requests;
        })
        .map((read: CloudAppPlatformGroupRead) => {
          return [read.storedName, read.resources];
        }),
    ).toEqual([
      [REQUESTS, [[armId("checkout-api")]]],
      ["azure_requests_count", [[armId("orders-api")]]],
    ]);
  });

  test("Cloud Run: its request count once, by response_code_class, each minute's rate times 60, and its p95", () => {
    expect(
      describeReads(getCloudAppPlatformMetricReads([runRow(RUN_ROW, "checkout")])),
    ).toEqual([
      [
        CloudAppPlatformFigure.Requests,
        RUN_REQUESTS,
        AggregationType.Sum,
        60,
        Object.keys(runAttributes("checkout")).sort(),
        "response_code_class",
      ],
      [
        CloudAppPlatformFigure.Latency,
        RUN_LATENCY,
        AggregationType.Avg,
        1,
        Object.keys(runAttributes("checkout")).sort(),
        "",
      ],
    ]);
  });

  test("App Engine: its response count by response_code", () => {
    const reads: Array<CloudAppPlatformGroupRead> =
      getCloudAppPlatformMetricReads([gaeRow(GAE_ROW, "default")]);

    expect(reads[0]!.storedName).toBe(GAE_REQUESTS);
    expect(reads[0]!.errorLabel?.attribute).toBe("response_code");
    expect(reads[0]!.scale).toBe(60);
    expect(reads.map((read: CloudAppPlatformGroupRead) => {
      return read.figure;
    })).toEqual([CloudAppPlatformFigure.Requests, CloudAppPlatformFigure.Latency]);
  });

  test("App Runner: its Requests, 5xxStatusResponses and mean RequestLatency, by its dimensions, account and Region", () => {
    expect(
      describeReads(
        getCloudAppPlatformMetricReads([appRunnerRow(APP_RUNNER_ROW, "checkout")]),
      ).map((read: [string, string, AggregationType, number, Array<string>, string]) => {
        return [read[0], read[1], read[2], read[4]];
      }),
    ).toEqual([
      [
        CloudAppPlatformFigure.Requests,
        "amazonaws.com/AWS/AppRunner/Requests",
        AggregationType.Sum,
        Object.keys(appRunnerAttributes("checkout")).sort(),
      ],
      [
        CloudAppPlatformFigure.ServerErrors,
        "amazonaws.com/AWS/AppRunner/5xxStatusResponses",
        AggregationType.Sum,
        Object.keys(appRunnerAttributes("checkout")).sort(),
      ],
      [
        CloudAppPlatformFigure.ResponseTime,
        "amazonaws.com/AWS/AppRunner/RequestLatency",
        AggregationType.Avg,
        Object.keys(appRunnerAttributes("checkout")).sort(),
      ],
    ]);
  });

  test("a Container App: its Requests and ResponseTime, and no 5xx read - its Requests are read whole", () => {
    expect(
      getCloudAppPlatformMetricReads([
        containerAppRow(CONTAINER_APP_ROW, "checkout"),
      ]).map((read: CloudAppPlatformGroupRead) => {
        return [read.figure, read.storedName];
      }),
    ).toEqual([
      [CloudAppPlatformFigure.Requests, "azure_requests_total"],
      [CloudAppPlatformFigure.ResponseTime, "azure_responsetime_average"],
    ]);
  });

  test("an ECS service, a type with no numbers, and a row named by nothing take no read", () => {
    expect(
      getCloudAppPlatformMetricReads([
        siteRow("7c000000-0000-4000-8000-000000000201", "x", {
          cloudResourceType: "AWS::ECS::Service",
          telemetryAttributes: {
            Namespace: "AWS/ECS",
            "Dimensions.ClusterName": "prod",
            "Dimensions.ServiceName": "checkout",
          },
        }),
        siteRow("7c000000-0000-4000-8000-000000000202", "y", {
          cloudResourceType: "Microsoft.Web/serverfarms",
        }),
        siteRow(ORDERS_SITE_ROW, "orders-api", { telemetryAttributes: {} }),
      ]),
    ).toEqual([]);
  });

  test("a resource read once, however many apps keep it, and resources of two sets of attributes read apart", () => {
    const reads: Array<CloudAppPlatformGroupRead> =
      getCloudAppPlatformMetricReads([
        siteRow(CHECKOUT_SITE_ROW, "checkout-api"),
        siteRow(CHECKOUT_SITE_ROW, "checkout-api"),
        runRow(RUN_ROW, "checkout"),
        runRow("7c000000-0000-4000-8000-000000000301", "orders"),
      ]);

    const requests: Array<CloudAppPlatformGroupRead> = reads.filter(
      (read: CloudAppPlatformGroupRead): boolean => {
        return read.figure === CloudAppPlatformFigure.Requests;
      },
    );

    expect(
      requests.map((read: CloudAppPlatformGroupRead) => {
        return read.resources.length;
      }),
    ).toEqual([1, 2]);
  });
});

describe("a resource's hour, from the reads' groups", () => {
  test("the groups are read by every attribute that names the resource; a split answer adds up; a group missing one is passed over", () => {
    const keys: Array<string> = Object.keys(runAttributes("checkout")).sort();

    expect(
      Array.from(
        readPlatformMetricGroups({
          rows: [
            group(runAttributes("checkout"), 2),
            group(runAttributes("checkout"), 3),
            group(runAttributes("orders"), 1),
            group({ "resource.service_name": "checkout" }, 99),
            { value: 9 } as unknown as AggregatedModel,
            group(runAttributes("broken"), Number.NaN),
          ],
          keys,
          scale: 60,
        }).entries(),
      ),
    ).toEqual([
      [
        keys
          .map((key: string): string => {
            return runAttributes("checkout")[key]!;
          })
          .join("\n"),
        { value: 300 },
      ],
      [
        keys
          .map((key: string): string => {
            return runAttributes("orders")[key]!;
          })
          .join("\n"),
        { value: 60 },
      ],
    ]);
  });

  test("a request count read by its response code: its 5xx groups are its server errors", () => {
    const keys: Array<string> = Object.keys(runAttributes("checkout")).sort();
    const values: Map<string, CloudAppPlatformGroupValue> =
      readPlatformMetricGroups({
        rows: [
          group({ ...runAttributes("checkout"), response_code_class: "2xx" }, 9),
          group({ ...runAttributes("checkout"), response_code_class: "4xx" }, 2),
          group({ ...runAttributes("checkout"), response_code_class: "5xx" }, 1),
          group({ ...runAttributes("orders"), response_code_class: "2xx" }, 5),
        ],
        keys,
        scale: 60,
        errorLabel: CLOUD_RUN_ERROR_LABEL,
      });

    expect(Array.from(values.values())).toEqual([
      { value: 720, serverErrors: 60 },
      // Requests and no 5xx group: none was answered with one.
      { value: 300, serverErrors: 0 },
    ]);
  });

  test("App Engine's 5xx are its response codes from 500 to 599, never a 404, a 499 or a 600", () => {
    const keys: Array<string> = Object.keys(gaeAttributes("default")).sort();
    const values: Map<string, CloudAppPlatformGroupValue> =
      readPlatformMetricGroups({
        rows: ["200", "404", "499", "500", "503", "599", "600", "5xx", ""].map(
          (code: string): AggregatedModel => {
            return group({ ...gaeAttributes("default"), response_code: code }, 1);
          },
        ),
        keys,
        scale: 60,
        errorLabel: APP_ENGINE_ERROR_LABEL,
      });

    expect(Array.from(values.values())).toEqual([
      { value: 9 * 60, serverErrors: 3 * 60 },
    ]);
  });

  function appServiceSummary(values: {
    requests?: number;
    serverErrors?: number;
    responseTime?: number;
  }): CloudAppPlatformSignals {
    const site: CloudResource = siteRow(CHECKOUT_SITE_ROW, "checkout-api");
    const valuesByRead: Map<string, Map<string, CloudAppPlatformGroupValue>> =
      new Map();
    const put: (figure: CloudAppPlatformFigure, name: string, value?: number) => void = (
      figure: CloudAppPlatformFigure,
      name: string,
      value?: number,
    ): void => {
      valuesByRead.set(
        [figure, name, AZURE_ID].join("|"),
        new Map(
          value === undefined ? [] : [[armId("checkout-api"), { value }]],
        ),
      );
    };

    put(CloudAppPlatformFigure.Requests, REQUESTS, values.requests);
    put(CloudAppPlatformFigure.ServerErrors, SERVER_ERRORS, values.serverErrors);
    put(
      CloudAppPlatformFigure.ResponseTime,
      RESPONSE_TIME,
      values.responseTime === undefined ? undefined : values.responseTime * 1000,
    );

    return summarizePlatformSite({ site, values: valuesByRead })!;
  }

  const APP_SERVICE: Pick<
    CloudAppPlatformSignals,
    "latency" | "service" | "isAppService"
  > = { latency: "average", service: "Azure Monitor", isAppService: true };

  test("a site's requests, 5xx answers and their share, and its mean response time in milliseconds", () => {
    expect(
      appServiceSummary({ requests: 1200, serverErrors: 6, responseTime: 0.18 }),
    ).toEqual({
      requests: 1200,
      serverErrors: 6,
      serverErrorRatePercent: 0.5,
      responseTimeMs: 180,
      ...APP_SERVICE,
    });
  });

  test("a metric the site did not report is unknown, never 0", () => {
    expect(appServiceSummary({ requests: 1200 })).toEqual({
      requests: 1200,
      serverErrors: null,
      // No 5xx point at all was read: its share is unknown, not 0%.
      serverErrorRatePercent: null,
      responseTimeMs: null,
      ...APP_SERVICE,
    });
    expect(appServiceSummary({})).toEqual({
      requests: null,
      serverErrors: null,
      serverErrorRatePercent: null,
      responseTimeMs: null,
      ...APP_SERVICE,
    });
  });

  test("a site that answered nothing: 0 requests, measured, and no share", () => {
    expect(appServiceSummary({ requests: 0, serverErrors: 0 })).toEqual({
      requests: 0,
      serverErrors: 0,
      serverErrorRatePercent: null,
      responseTimeMs: null,
      ...APP_SERVICE,
    });
  });

  test("a site's id in another case is still its own", () => {
    const valuesByRead: Map<string, Map<string, CloudAppPlatformGroupValue>> =
      new Map([
        [
          [CloudAppPlatformFigure.Requests, REQUESTS, AZURE_ID].join("|"),
          new Map([[armId("checkout-api").toLowerCase(), { value: 40 }]]),
        ],
      ]);

    expect(
      summarizePlatformSite({
        site: siteRow(CHECKOUT_SITE_ROW, "checkout-api"),
        values: valuesByRead,
      })!.requests,
    ).toBe(40);
  });

  test("a Cloud Run service: its 5xx from its own request read, its p95, as Google Cloud Monitoring's", () => {
    const keys: Array<string> = Object.keys(runAttributes("checkout")).sort();
    const signature: string = keys
      .map((key: string): string => {
        return runAttributes("checkout")[key]!;
      })
      .join("\n");

    expect(
      summarizePlatformSite({
        site: runRow(RUN_ROW, "checkout"),
        values: new Map([
          [
            [CloudAppPlatformFigure.Requests, RUN_REQUESTS, ...keys].join("|"),
            new Map([[signature, { value: 2000, serverErrors: 0 }]]),
          ],
          [
            [CloudAppPlatformFigure.Latency, RUN_LATENCY, ...keys].join("|"),
            new Map([[signature, { value: 84 }]]),
          ],
        ]),
      }),
    ).toEqual({
      requests: 2000,
      serverErrors: 0,
      // Read with its requests: none answered with a 5xx is 0%, not unknown.
      serverErrorRatePercent: 0,
      responseTimeMs: 84,
      latency: "p95",
      service: "Google Cloud Monitoring",
      isAppService: false,
    });
  });

  test("a Container App: its requests and mean response time, and its 5xx share unknown, never 0", () => {
    const keys: Array<string> = [AZURE_ID];
    const row: CloudResource = containerAppRow(CONTAINER_APP_ROW, "checkout");
    const id: string = getPlatformResourceFilters(row)![AZURE_ID]!;

    expect(
      summarizePlatformSite({
        site: row,
        values: new Map([
          [
            [CloudAppPlatformFigure.Requests, "azure_requests_total", ...keys].join(
              "|",
            ),
            new Map([[id, { value: 500 }]]),
          ],
          [
            [
              CloudAppPlatformFigure.ResponseTime,
              "azure_responsetime_average",
              ...keys,
            ].join("|"),
            new Map([[id, { value: 42 }]]),
          ],
        ]),
      }),
    ).toEqual({
      requests: 500,
      serverErrors: null,
      serverErrorRatePercent: null,
      responseTimeMs: 42,
      latency: "average",
      service: "Azure Monitor",
      isAppService: false,
    });
  });

  test("a type a list reads nothing of has no numbers at all", () => {
    expect(
      summarizePlatformSite({
        site: siteRow(CHECKOUT_SITE_ROW, "x", {
          cloudResourceType: "AWS::ECS::Service",
        }),
        values: new Map(),
      }),
    ).toBeNull();
  });

  test("a seeded sweep: however a service's requests split by response code, its totals add up and its share is its 5xx over all", () => {
    const random: SeededRandom = seededRandom(6794);
    const keys: Array<string> = Object.keys(runAttributes("checkout")).sort();

    for (let draw: number = 0; draw < 200; draw++) {
      const rows: Array<AggregatedModel> = [];
      let total: number = 0;
      let errors: number = 0;

      for (const codeClass of ["2xx", "3xx", "4xx", "5xx"]) {
        // Each class in a few buckets, each a rate of a minute.
        for (let bucket: number = 0; bucket < random(4); bucket++) {
          const rate: number = random(1000) / 10;
          total += rate * 60;
          errors += codeClass === "5xx" ? rate * 60 : 0;
          rows.push(
            group(
              { ...runAttributes("checkout"), response_code_class: codeClass },
              rate,
            ),
          );
        }
      }

      const values: Map<string, CloudAppPlatformGroupValue> =
        readPlatformMetricGroups({
          rows: shuffled(rows, random),
          keys,
          scale: 60,
          errorLabel: CLOUD_RUN_ERROR_LABEL,
        });
      const value: CloudAppPlatformGroupValue | undefined = Array.from(
        values.values(),
      )[0];

      if (rows.length === 0) {
        expect(value).toBeUndefined();
        continue;
      }

      expect(value!.value).toBeCloseTo(total, 6);
      expect(value!.serverErrors).toBeCloseTo(errors, 6);
    }
  });
});

describe("fetchCloudAppPlatformSignals: as the reader may read", () => {
  interface Server {
    lists: Array<ListCall>;
    aggregates: Array<AggregateCall>;
  }

  function serve(data: {
    // The resources the reader may read, of those asked for.
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
          data:
            (data.groups || {})[String(request.aggregateBy.query["name"])] ||
            [],
        };
      },
    );

    return server;
  }

  test("nothing is read when no app shows its resource's numbers", async () => {
    const server: Server = serve({ readable: [] });

    const result: CloudAppPlatformSignalResult =
      await fetchCloudAppPlatformSignals({
        apps: [
          app(1, { tracesLastReceivedAt: NOW }),
          app(2, { cloudPlatform: "aws_ecs", groupName: "prod" }),
        ],
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
          azureGroup(armId("checkout-api"), 1200),
          azureGroup(armId("orders-api"), 50),
        ],
        [SERVER_ERRORS]: [
          azureGroup(armId("checkout-api"), 60),
          azureGroup(armId("orders-api"), 0),
        ],
        [RESPONSE_TIME]: [azureGroup(armId("checkout-api"), 0.25)],
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
      (
        (server.lists[0]!.query["_id"] as Includes).values as Array<unknown>
      ).map((value: unknown): string => {
        return String(value);
      }),
    ).toEqual([CHECKOUT_SITE_ROW, ORDERS_SITE_ROW]);
    expect(server.lists[0]!.query["cloudResourceKind"]).toBe(
      CloudResourceKind.Resource,
    );
    // Its type is read, so a row of another type than the app runs as shows nothing.
    expect(server.lists[0]!.select["cloudResourceType"]).toBe(true);

    expect(server.aggregates).toHaveLength(3);
    for (const call of server.aggregates) {
      expect(call.modelType.name).toBe("Metric");
      expect(call.aggregateBy.aggregationInterval).toBe(
        AggregationInterval.Total,
      );
      expect(call.aggregateBy.groupByAttributeKeys).toEqual([AZURE_ID]);
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
      )[AZURE_ID]!;
      expect(scope.values).toEqual([
        armId("checkout-api"),
        armId("orders-api"),
      ]);
    }

    const checkout: CloudAppPlatformSignals = {
      requests: 1200,
      serverErrors: 60,
      serverErrorRatePercent: 5,
      responseTimeMs: 250,
      latency: "average",
      service: "Azure Monitor",
      isAppService: true,
    };

    expect(Array.from(result.signals.entries())).toEqual([
      ["7c000000-0000-4000-8000-000000000001", checkout],
      [
        "7c000000-0000-4000-8000-000000000002",
        {
          requests: 50,
          serverErrors: 0,
          serverErrorRatePercent: 0,
          responseTimeMs: null,
          latency: "average",
          service: "Azure Monitor",
          isAppService: true,
        },
      ],
      ["7c000000-0000-4000-8000-000000000003", checkout],
    ]);
    expect(result.failed).toBe(false);
  });

  test("a slot app shows its slot's numbers, and a kept row of another type than the app runs as shows nothing (#6793)", async () => {
    serve({
      readable: [
        slotRow(STAGING_SLOT_ROW, "checkout-api", "staging"),
        siteRow(CHECKOUT_SITE_ROW, "checkout-api"),
      ],
      groups: {
        [REQUESTS]: [
          azureGroup(`${armId("checkout-api")}/slots/staging`, 30),
          azureGroup(armId("checkout-api"), 9000),
        ],
      },
    });

    const result: CloudAppPlatformSignalResult =
      await fetchCloudAppPlatformSignals({
        apps: [
          app(1, {
            groupName: "staging",
            platformCloudResourceId: STAGING_SLOT_ROW,
          }),
          // A slot app still tied to its site: never the site's numbers.
          app(2, { groupName: "staging" }),
        ],
        now: NOW,
      });

    expect(Array.from(result.signals.keys())).toEqual([
      "7c000000-0000-4000-8000-000000000001",
    ]);
    expect(
      result.signals.get("7c000000-0000-4000-8000-000000000001")!.requests,
    ).toBe(30);
  });

  test("a page of several platforms: each resource read by its own attributes, each app its own service's numbers (#6794)", async () => {
    const server: Server = serve({
      readable: [
        siteRow(CHECKOUT_SITE_ROW, "checkout-api"),
        runRow(RUN_ROW, "checkout"),
        appRunnerRow(APP_RUNNER_ROW, "checkout"),
      ],
      groups: {
        [REQUESTS]: [azureGroup(armId("checkout-api"), 100)],
        [RUN_REQUESTS]: [
          group({ ...runAttributes("checkout"), response_code_class: "2xx" }, 4),
          group({ ...runAttributes("checkout"), response_code_class: "5xx" }, 1),
        ],
        [RUN_LATENCY]: [group(runAttributes("checkout"), 120)],
        "amazonaws.com/AWS/AppRunner/Requests": [
          group(appRunnerAttributes("checkout"), 800),
        ],
        "amazonaws.com/AWS/AppRunner/5xxStatusResponses": [
          group(appRunnerAttributes("checkout"), 8),
        ],
        "amazonaws.com/AWS/AppRunner/RequestLatency": [
          group(appRunnerAttributes("checkout"), 35),
        ],
      },
    });

    const result: CloudAppPlatformSignalResult =
      await fetchCloudAppPlatformSignals({
        apps: [
          app(1),
          app(2, {
            cloudPlatform: "gcp_cloud_run",
            name: "checkout",
            platformCloudResourceId: RUN_ROW,
          }),
          app(3, {
            cloudPlatform: "aws_app_runner",
            name: "checkout",
            platformCloudResourceId: APP_RUNNER_ROW,
          }),
        ],
        now: NOW,
      });

    // Three for the site, two for the Cloud Run service, three for App Runner.
    expect(server.aggregates).toHaveLength(8);

    const runRead: AggregateCall = server.aggregates.find(
      (call: AggregateCall): boolean => {
        return call.aggregateBy.query["name"] === RUN_REQUESTS;
      },
    )!;
    expect(runRead.aggregateBy.groupByAttributeKeys).toEqual([
      ...Object.keys(runAttributes("checkout")).sort(),
      "response_code_class",
    ]);
    expect(
      Object.keys(
        runRead.aggregateBy.query["attributes"] as Record<string, Includes>,
      ).sort(),
    ).toEqual(Object.keys(runAttributes("checkout")).sort());

    expect(result.signals.get("7c000000-0000-4000-8000-000000000002")).toEqual({
      requests: 300,
      serverErrors: 60,
      serverErrorRatePercent: 20,
      responseTimeMs: 120,
      latency: "p95",
      service: "Google Cloud Monitoring",
      isAppService: false,
    });
    expect(result.signals.get("7c000000-0000-4000-8000-000000000003")).toEqual({
      requests: 800,
      serverErrors: 8,
      serverErrorRatePercent: 1,
      responseTimeMs: 35,
      latency: "average",
      service: "Amazon CloudWatch",
      isAppService: false,
    });
    expect(
      result.signals.get("7c000000-0000-4000-8000-000000000001")!.requests,
    ).toBe(100);
  });

  test("a resource the reader may not read shows nothing, and its metrics are never asked for", async () => {
    const server: Server = serve({
      // The reader's labels give them the checkout site only.
      readable: [siteRow(CHECKOUT_SITE_ROW, "checkout-api")],
      groups: {
        [REQUESTS]: [
          azureGroup(armId("checkout-api"), 10),
          azureGroup(armId("secret-api"), 999),
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
      )[AZURE_ID]!;
      expect(scope.values).toEqual([armId("checkout-api")]);
    }
  });

  test("no readable resource: no metric read at all", async () => {
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
