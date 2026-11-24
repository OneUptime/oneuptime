import { describe, expect, test } from "@jest/globals";
import AzureCloudConnector from "../../../../Server/Utils/CloudConnection/Azure/AzureCloudConnector";
import { storedAttributesOf } from "../../../../Server/Utils/CloudConnection/CloudMetricPayload";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudKnownResource,
  CloudReadResult,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  CloudMetricNotReadKind,
  CloudResourceMetricStatus,
} from "../../../../Types/Cloud/CloudResourceMetricCollection";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  BAD_REQUEST,
  FAKE_SUBSCRIPTION,
  FAKE_TENANT,
  FakeAzureMonitor,
  FakeAzureMonitorOptions,
  FakeMetricError,
  FakeMonitorCall,
  SERVER_BUSY,
  SERVER_BUSY_CALL,
  armIdOf,
  createFakeAzureMonitor,
  fakeDefinition,
  samplingTypeNotFound,
} from "./FakeAzureMonitor";

/*
 * THE ISSUE'S TENANT, READ THROUGH THE CONNECTION (#10291).
 *
 * Its App Service plans in South Central US, a Front Door profile and a
 * Cosmos DB account, against an Azure Monitor that answers as Azure does:
 * each metric is served with the aggregations its definition lists and
 * fails on its own when a call names another ("Sampling type is not found",
 * "Bad request"), and a busy Azure answers ServerBusy. Read after read, with
 * the state each read hands the next: what is not served is said once and
 * not asked for a day, what Azure was busy for is asked again, and what was
 * not read of a resource is kept for its pages.
 */

const NOW: Date = new Date("2026-10-21T12:07:00Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;
const PLAN_TYPE: string = "Microsoft.Web/serverFarms";
const FRONT_DOOR_TYPE: string = "Microsoft.Cdn/profiles";
const COSMOS_TYPE: string = "Microsoft.DocumentDB/databaseAccounts";

const connector: AzureCloudConnector = new AzureCloudConnector();

function settings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.Azure,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.AzureClientSecret,
      tenantId: FAKE_TENANT,
      clientId: "00001111-aaaa-2222-bbbb-3333cccc4444",
      cloud: "public",
    },
    secrets: { clientSecret: "client-secret~value" },
  };
}

const AVERAGE_LEVEL: Array<string> = ["Average", "Minimum", "Maximum"];
const BYTES: Array<string> = ["Total", "Average", "Minimum", "Maximum"];

// Each type's metrics as its definitions list them.
const DEFINITIONS: Record<string, Array<JSONObject>> = {
  [PLAN_TYPE]: [
    fakeDefinition({
      name: "CpuPercentage",
      primary: "Average",
      served: AVERAGE_LEVEL,
    }),
    fakeDefinition({
      name: "MemoryPercentage",
      primary: "Average",
      served: AVERAGE_LEVEL,
    }),
    fakeDefinition({
      name: "HttpQueueLength",
      primary: "Average",
      served: AVERAGE_LEVEL,
    }),
    fakeDefinition({
      name: "DiskQueueLength",
      primary: "Average",
      served: AVERAGE_LEVEL,
    }),
    fakeDefinition({ name: "BytesReceived", primary: "Total", served: BYTES }),
    fakeDefinition({ name: "BytesSent", primary: "Total", served: BYTES }),
    fakeDefinition({
      name: "TcpEstablished",
      primary: "Average",
      served: AVERAGE_LEVEL,
    }),
  ],
  [FRONT_DOOR_TYPE]: [
    fakeDefinition({
      name: "RequestCount",
      primary: "Total",
      served: ["Total"],
    }),
    fakeDefinition({
      name: "Percentage5XX",
      primary: "Average",
      served: ["Average"],
    }),
    fakeDefinition({
      name: "TotalLatency",
      primary: "Average",
      served: AVERAGE_LEVEL,
    }),
    fakeDefinition({
      name: "Percentage4XX",
      primary: "Average",
      served: ["Average"],
    }),
    fakeDefinition({
      name: "OriginLatency",
      primary: "Average",
      served: AVERAGE_LEVEL,
    }),
    fakeDefinition({
      name: "OriginHealthPercentage",
      primary: "Average",
      served: ["Average"],
    }),
    fakeDefinition({
      name: "ByteHitRatio",
      primary: "Average",
      served: ["Average"],
    }),
    fakeDefinition({
      name: "OriginRequestCount",
      primary: "Total",
      served: ["Total"],
    }),
    fakeDefinition({
      name: "ResponseSize",
      primary: "Total",
      served: ["Total"],
    }),
  ],
  [COSMOS_TYPE]: [
    fakeDefinition({
      name: "TotalRequests",
      primary: "Count",
      served: ["Count"],
    }),
    fakeDefinition({
      name: "TotalRequestUnits",
      primary: "Total",
      served: ["Total"],
    }),
    fakeDefinition({
      name: "NormalizedRUConsumption",
      primary: "Maximum",
      served: ["Maximum", "Average"],
    }),
    fakeDefinition({
      name: "ServerSideLatencyDirect",
      primary: "Average",
      served: AVERAGE_LEVEL,
    }),
    fakeDefinition({
      name: "ServerSideLatencyGateway",
      primary: "Average",
      served: AVERAGE_LEVEL,
    }),
    fakeDefinition({
      name: "ThrottledRequestPercentage",
      primary: "Average",
      served: ["Average"],
    }),
  ],
};

// Each metric's served aggregations, lower case, by its name.
const SERVED: Map<string, Array<string>> = new Map();

for (const definitions of Object.values(DEFINITIONS)) {
  for (const definition of definitions) {
    SERVED.set(
      String((definition["name"] as JSONObject)["value"]),
      (definition["supportedAggregationTypes"] as Array<string>).map(
        (aggregation: string): string => {
          return aggregation.toLowerCase();
        },
      ),
    );
  }
}

/*
 * What Azure Monitor answers a metric asked with an aggregation it is not
 * served with: Cosmos DB's ThrottledRequestPercentage, "Bad request";
 * any other, "Sampling type is not found", naming the first such
 * aggregation as Azure names it (a Total is its "Sum").
 */
function unservedError(data: {
  metric: string;
  aggregations: Array<string>;
}): FakeMetricError | null {
  const served: Array<string> = SERVED.get(data.metric) || [];
  const unserved: string | undefined = data.aggregations.find(
    (aggregation: string): boolean => {
      return !served.includes(aggregation.toLowerCase());
    },
  );

  if (!unserved) {
    return null;
  }

  return data.metric === "ThrottledRequestPercentage"
    ? BAD_REQUEST
    : samplingTypeNotFound(
        data.metric,
        unserved.toLowerCase() === "total" ? "Sum" : unserved,
      );
}

const PLANS: Array<string> = ["plan-web", "plan-api", "plan-jobs"].map(
  (name: string): string => {
    return armIdOf({ type: PLAN_TYPE, name });
  },
);
const FRONT_DOOR: string = armIdOf({ type: FRONT_DOOR_TYPE, name: "fd-prod" });
const COSMOS: string = armIdOf({ type: COSMOS_TYPE, name: "cosmos-orders" });

function known(armId: string, region: string): CloudKnownResource {
  const parts: Array<string> = armId.split("/");

  return {
    providerResourceId: armId,
    resourceType: `${parts[6]}/${parts[7]}`,
    name: parts[8]!,
    region,
    accountId: FAKE_SUBSCRIPTION,
    resourceGroup: parts[4]!,
  };
}

const KNOWN: Array<CloudKnownResource> = [
  ...PLANS.map((armId: string): CloudKnownResource => {
    return known(armId, "southcentralus");
  }),
  known(FRONT_DOOR, "global"),
  known(COSMOS, "southcentralus"),
];

function fakeAzure(options: FakeAzureMonitorOptions = {}): FakeAzureMonitor {
  return createFakeAzureMonitor({
    definitions: (resourceId: string): Array<JSONObject> => {
      const type: string = resourceId.split("/").slice(6, 8).join("/");

      return DEFINITIONS[type] || [];
    },
    ...options,
    metricError: (data: {
      resourceId: string;
      metric: string;
      aggregations: Array<string>;
      attempt: number;
    }): FakeMetricError | null => {
      return options.metricError?.(data) || unservedError(data);
    },
  });
}

interface ReadOutcome {
  result: CloudReadResult;
  waits: Array<number>;
}

async function read(
  fake: FakeAzureMonitor,
  state: CloudConnectionPullState = {},
  at: Date = NOW,
): Promise<ReadOutcome> {
  const waits: Array<number> = [];
  const result: CloudReadResult = await connector.read(settings(), {
    transport: fake.transport,
    now: (): Date => {
      return at;
    },
    sleep: async (milliseconds: number): Promise<void> => {
      waits.push(milliseconds);
    },
    random: (): number => {
      return 0;
    },
    // Listed just now: this read reads the resources it holds.
    state: { ...state, inventoryAt: at.toISOString() },
    knownResources: KNOWN,
    serviceName: "Microsoft Azure",
    connectionId: "33333333-3333-4333-8333-333333333333",
    maxRequests: 3000,
    maxDurationMs: 6 * 60 * 1000,
  });

  return { result, waits };
}

// The metrics a read wrote, "<resource name> <stored name>".
function written(result: CloudReadResult): Array<string> {
  const found: Set<string> = new Set<string>();

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
            const stored: JSONObject = storedAttributesOf(
              resourceAttributes as never,
              (point as JSONObject)["attributes"] as never,
            ) as JSONObject;

            found.add(`${stored["name"]} ${(metric as JSONObject)["name"]}`);
          }
        }
      }
    }
  }

  return Array.from(found).sort();
}

function statusOf(
  result: CloudReadResult,
  armId: string,
): CloudResourceMetricStatus | undefined {
  return (
    result.nextState.azureMetricStatus as
      | Record<string, CloudResourceMetricStatus>
      | undefined
  )?.[armId.toLowerCase()];
}

function asked(fake: FakeAzureMonitor, metric: string): Array<FakeMonitorCall> {
  return fake.calls.filter((call: FakeMonitorCall): boolean => {
    return call.metrics.includes(metric);
  });
}

describe("the issue's tenant, read through the connection", () => {
  test("every metric of every resource is read, none asked with an aggregation it is not served with, the plans in batches", async () => {
    const fake: FakeAzureMonitor = fakeAzure();
    const { result } = await read(fake);

    // Not one metric answered with an error of its own: nothing to say.
    expect(result.warnings).toEqual([]);
    expect(result.nextState.azureMetricStatus).toEqual({});

    for (const call of fake.calls) {
      for (const metric of call.metrics) {
        expect(
          call.aggregations.every((aggregation: string): boolean => {
            return (SERVED.get(metric) || []).includes(
              aggregation.toLowerCase(),
            );
          }),
        ).toBe(true);
      }
    }

    const minute: Array<string> = written(result);

    for (const name of ["plan-web", "plan-api", "plan-jobs"]) {
      expect(minute).toEqual(
        expect.arrayContaining([
          `${name} azure_cpupercentage_average`,
          `${name} azure_memorypercentage_average`,
          `${name} azure_bytesreceived_total`,
        ]),
      );
    }

    expect(minute).toEqual(
      expect.arrayContaining([
        "fd-prod azure_bytehitratio_average",
        "fd-prod azure_requestcount_total",
        "cosmos-orders azure_throttledrequestpercentage_average",
        "cosmos-orders azure_totalrequests_count",
      ]),
    );

    // The three plans in batches of their own Region's data plane.
    const planCalls: Array<FakeMonitorCall> = asked(fake, "CpuPercentage");

    expect(planCalls).toHaveLength(1);
    expect(planCalls[0]!.isBatch).toBe(true);
    expect(planCalls[0]!.host).toBe("southcentralus.metrics.monitor.azure.com");
    expect(planCalls[0]!.resourceIds).toEqual(PLANS);
    // Front Door is global: a call of its own on Resource Manager.
    expect(asked(fake, "ByteHitRatio")[0]!.host).toBe("management.azure.com");
    expect(asked(fake, "ByteHitRatio")[0]!.aggregations).toEqual(["Average"]);
  });

  test("ServerBusy for CpuPercentage and a 529 for a call are asked again, after a wait, and everything is written", async () => {
    let busyCalls: number = 0;
    const fake: FakeAzureMonitor = fakeAzure({
      metricError: (data: { metric: string; attempt: number }) => {
        return data.metric === "CpuPercentage" && data.attempt === 0
          ? SERVER_BUSY
          : null;
      },
      callAnswer: (data: { call: FakeMonitorCall }) => {
        if (data.call.metrics.includes("BytesReceived") && busyCalls < 1) {
          busyCalls++;
          return SERVER_BUSY_CALL;
        }

        return null;
      },
    });
    const { result, waits } = await read(fake);

    expect(result.warnings).toEqual([]);
    expect(waits.length).toBeGreaterThanOrEqual(2);
    expect(written(result)).toEqual(
      expect.arrayContaining(
        ["plan-web", "plan-api", "plan-jobs"].flatMap((name: string) => {
          return [
            `${name} azure_cpupercentage_average`,
            `${name} azure_bytesreceived_total`,
          ];
        }),
      ),
    );
  });

  test("busy in every round, it is said as busy, kept on each resource since then, and asked again - and cleared - at the next read", async () => {
    let isBusy: boolean = true;
    const fake: FakeAzureMonitor = fakeAzure({
      metricError: (data: { metric: string }) => {
        return isBusy && data.metric === "CpuPercentage" ? SERVER_BUSY : null;
      },
    });
    const first: ReadOutcome = await read(fake);

    expect(first.result.warnings).toEqual([
      `Azure Monitor could not read CpuPercentage of 3 resources: it was busy (${SERVER_BUSY.errorMessage}). The next read asks again.`,
    ]);
    expect(statusOf(first.result, PLANS[0]!)).toEqual({
      metrics: {
        cpupercentage: {
          name: "CpuPercentage",
          kind: CloudMetricNotReadKind.Throttled,
          error: SERVER_BUSY.errorMessage,
          since: NOW.toISOString(),
          at: NOW.toISOString(),
        },
      },
    });
    // The rest of each plan was written.
    expect(written(first.result)).toContain(
      "plan-web azure_memorypercentage_average",
    );
    expect(written(first.result)).not.toContain(
      "plan-web azure_cpupercentage_average",
    );

    isBusy = false;

    const later: Date = new Date(NOW.getTime() + 5 * 60 * 1000);
    const second: ReadOutcome = await read(fake, first.result.nextState, later);

    expect(written(second.result)).toContain(
      "plan-web azure_cpupercentage_average",
    );
    expect(statusOf(second.result, PLANS[0]!)).toBeUndefined();
    expect(second.result.warnings).toEqual([]);
  });

  test("a metric Azure does not serve, even asked alone, is said once, kept, and not asked again until a day has passed", async () => {
    const fake: FakeAzureMonitor = fakeAzure({
      metricError: (data: { metric: string }) => {
        return data.metric === "ThrottledRequestPercentage"
          ? BAD_REQUEST
          : null;
      },
    });
    const first: ReadOutcome = await read(fake);

    expect(first.result.warnings).toEqual([
      "Azure Monitor could not read ThrottledRequestPercentage of 1 resource: it does not serve it for it (Bad request). It is not asked for again until 2026-10-22.",
    ]);
    expect(statusOf(first.result, COSMOS)?.metrics).toEqual({
      throttledrequestpercentage: {
        name: "ThrottledRequestPercentage",
        kind: CloudMetricNotReadKind.Unsupported,
        error: "Bad request",
        since: NOW.toISOString(),
        at: NOW.toISOString(),
        until: new Date(NOW.getTime() + DAY_MS).toISOString(),
      },
    });
    expect(asked(fake, "ThrottledRequestPercentage")).toHaveLength(1);

    // Five minutes on: not asked, nothing said, still kept.
    const soon: Date = new Date(NOW.getTime() + 5 * 60 * 1000);
    const second: ReadOutcome = await read(fake, first.result.nextState, soon);

    expect(asked(fake, "ThrottledRequestPercentage")).toHaveLength(1);
    expect(second.result.warnings).toEqual([]);
    expect(
      statusOf(second.result, COSMOS)?.metrics?.["throttledrequestpercentage"]
        ?.kind,
    ).toBe(CloudMetricNotReadKind.Unsupported);
    // The account's other metrics read as ever.
    expect(written(second.result)).toContain(
      "cosmos-orders azure_totalrequests_count",
    );

    // A day on: asked again.
    const tomorrow: Date = new Date(NOW.getTime() + DAY_MS + 5 * 60 * 1000);

    await read(fake, second.result.nextState, tomorrow);

    expect(asked(fake, "ThrottledRequestPercentage")).toHaveLength(2);
  });

  test("a resource no call of which is answered is kept as not read, since then, with Azure's words; the others are written", async () => {
    const fake: FakeAzureMonitor = fakeAzure({
      callAnswer: (data: { call: FakeMonitorCall }) => {
        return data.call.resourceIds.includes(COSMOS) ? SERVER_BUSY_CALL : null;
      },
    });
    const { result } = await read(fake);
    const status: CloudResourceMetricStatus | undefined = statusOf(
      result,
      COSMOS,
    );

    expect(status?.failed?.since).toBe(NOW.toISOString());
    expect(status?.failed?.error).toContain("Too many queries are in flight");
    expect(result.warnings).toEqual([
      expect.stringMatching(
        /^Could not read the metrics of 1 resource this time: Azure Monitor was busy \(Azure metrics request failed with HTTP 529: .*Too many queries are in flight.*\)\. The next read asks again\.$/,
      ),
    ]);
    expect(written(result)).toContain("plan-web azure_cpupercentage_average");
  });

  test("a batch Azure refuses for the subscription is read a resource at a time, said once, and not asked for a day", async () => {
    const fake: FakeAzureMonitor = fakeAzure({
      callAnswer: (data: { call: FakeMonitorCall }) => {
        return data.call.isBatch
          ? {
              status: 403,
              body: '{"error":{"code":"AuthorizationFailed","message":"The client does not have authorization to perform action Microsoft.Insights/Metrics/Read."}}',
            }
          : null;
      },
    });
    const first: ReadOutcome = await read(fake);

    expect(first.result.warnings).toEqual([
      expect.stringMatching(
        /^Azure Monitor refused to read the metrics of subscription d0cfe6b2-9ac0-4464-9919-dccaee2e48c0 in batches: .*They are read a resource at a time until 2026-10-22\.$/,
      ),
    ]);
    expect(first.result.nextState.azureMetricBatchesOff).toEqual({
      [FAKE_SUBSCRIPTION]: new Date(NOW.getTime() + DAY_MS).toISOString(),
    });
    // Each plan read on its own.
    expect(written(first.result)).toContain(
      "plan-jobs azure_cpupercentage_average",
    );

    const batchesBefore: number = fake.calls.filter(
      (call: FakeMonitorCall): boolean => {
        return call.isBatch;
      },
    ).length;
    const soon: Date = new Date(NOW.getTime() + 5 * 60 * 1000);
    const second: ReadOutcome = await read(fake, first.result.nextState, soon);

    expect(
      fake.calls.filter((call: FakeMonitorCall): boolean => {
        return call.isBatch;
      }).length,
    ).toBe(batchesBefore);
    expect(second.result.warnings).toEqual([]);
    expect(second.result.nextState.azureMetricBatchesOff).toEqual(
      first.result.nextState.azureMetricBatchesOff,
    );

    const tomorrow: Date = new Date(NOW.getTime() + DAY_MS + 60 * 1000);
    const third: ReadOutcome = await read(
      fake,
      second.result.nextState,
      tomorrow,
    );

    // Asked again a day on - and refused again, said again.
    expect(
      fake.calls.filter((call: FakeMonitorCall): boolean => {
        return call.isBatch;
      }).length,
    ).toBeGreaterThan(batchesBefore);
    expect(third.result.warnings).toHaveLength(1);
  });
});
