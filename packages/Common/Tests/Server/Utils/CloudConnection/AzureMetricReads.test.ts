import { describe, expect, test } from "@jest/globals";
import AzureArm, {
  AzureArmError,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import {
  AZURE_METRIC_CALLS_PER_PLACE,
  AZURE_METRIC_CALL_TRIES,
  AZURE_METRIC_FIRST_RETRY_WAIT_MS,
  AZURE_METRIC_MAX_RETRY_WAIT_MS,
  AZURE_METRIC_ROUNDS,
  AzureMetricCallGroup,
  AzureMetricPlace,
  AzureMetricReadResult,
  AzureMetricReader,
  AzureMetricRequest,
  AzureMetricToRead,
  classifyAzureMetricFailure,
  getAzureMetricRetryWaitMs,
  interleaveAzureMetricCalls,
  isAzureMetricThrottle,
  isAzureUnsupportedMetricsRefusal,
  partitionAzureMetricCalls,
  readAzureRetryAfterMs,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureMetricReads";
import { readAzureRateLimit } from "../../../../Server/Utils/CloudConnection/Azure/AzureRateLimit";
import { CloudReadBudget } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudMetricNotReadKind } from "../../../../Types/Cloud/CloudResourceMetricCollection";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import {
  BAD_REQUEST,
  FAKE_SUBSCRIPTION,
  FAKE_WINDOW,
  FakeAzureMonitor,
  FakeAzureMonitorOptions,
  FakeMetricError,
  FakeMonitorCall,
  OTHER_SUBSCRIPTION,
  SERVER_BUSY,
  SERVER_BUSY_CALL,
  armIdOf,
  createFakeArm,
  createFakeAzureMonitor,
  samplingTypeNotFound,
} from "./FakeAzureMonitor";

/*
 * How an Azure read asks Azure Monitor for metrics (#10291), against a fake
 * Azure Monitor that answers as the issue's tenant saw it: a metric asked
 * with an aggregation it is not served with fails on its own ("Sampling
 * type is not found", "Bad request"), and a busy Azure answers "ServerBusy:
 * Too many queries are in flight" - for one metric inside an answer, or for
 * a whole call (529).
 */

interface Metric extends AzureMetricToRead {
  grain: string;
}

function metric(
  name: string,
  aggregation: string,
  supported?: Array<string> | undefined,
): Metric {
  return {
    name,
    aggregation,
    grain: "PT1M",
    ...(supported ? { supportedAggregations: supported } : {}),
  };
}

/*
 * Front Door's key metrics as their definitions name them: the shares and
 * ratios are served as an Average alone, the counts as a Total alone.
 */
const FRONT_DOOR: Array<Metric> = [
  metric("RequestCount", "Total", ["Total"]),
  metric("Percentage5XX", "Average", ["Average"]),
  metric("TotalLatency", "Average", ["Average", "Minimum", "Maximum"]),
  metric("Percentage4XX", "Average", ["Average"]),
  metric("OriginLatency", "Average", ["Average", "Minimum", "Maximum"]),
  metric("OriginHealthPercentage", "Average", ["Average"]),
  metric("ByteHitRatio", "Average", ["Average"]),
  metric("OriginRequestCount", "Total", ["Total"]),
  metric("ResponseSize", "Total", ["Total"]),
];

// Cosmos DB's: TotalRequests is a Count alone, ThrottledRequestPercentage an Average alone.
const COSMOS_DB: Array<Metric> = [
  metric("TotalRequests", "Count", ["Count"]),
  metric("TotalRequestUnits", "Total", ["Total"]),
  metric("NormalizedRUConsumption", "Maximum", ["Maximum", "Average"]),
  metric("ServerSideLatencyDirect", "Average", [
    "Average",
    "Minimum",
    "Maximum",
  ]),
  metric("ThrottledRequestPercentage", "Average", ["Average"]),
  metric("ReplicationLatency", "Average", ["Average", "Minimum", "Maximum"]),
];

// An App Service plan's: levels, and the bytes it moved.
const APP_SERVICE_PLAN: Array<Metric> = [
  metric("CpuPercentage", "Average", ["Average", "Minimum", "Maximum"]),
  metric("MemoryPercentage", "Average", ["Average", "Minimum", "Maximum"]),
  metric("HttpQueueLength", "Average", ["Average", "Minimum", "Maximum"]),
  metric("BytesReceived", "Total", ["Total", "Average", "Minimum", "Maximum"]),
];

// The aggregations a call names, each once, lower case.
function aggregationsOf(call: Array<AzureMetricToRead>): Array<string> {
  return Array.from(
    new Set(
      call.map((item: AzureMetricToRead): string => {
        return item.aggregation.toLowerCase();
      }),
    ),
  ).sort();
}

// Whether every metric of every call is served with every aggregation the call names.
function isServedWithItsCall(calls: Array<Array<Metric>>): boolean {
  return calls.every((call: Array<Metric>): boolean => {
    const named: Array<string> = aggregationsOf(call);

    return call.every((item: Metric): boolean => {
      const served: Array<string> = (
        item.supportedAggregations || [item.aggregation]
      ).map((aggregation: string): string => {
        return aggregation.toLowerCase();
      });

      return named.every((aggregation: string): boolean => {
        return (
          served.includes(aggregation) ||
          aggregation === item.aggregation.toLowerCase()
        );
      });
    });
  });
}

function namesOf(call: Array<AzureMetricToRead>): Array<string> {
  return call.map((item: AzureMetricToRead): string => {
    return item.name;
  });
}

describe("which metrics share a call", () => {
  test("Front Door's ByteHitRatio is never asked in a call that names a Total, the cause of 'Sampling type is not found'", () => {
    const calls: Array<Array<Metric>> = partitionAzureMetricCalls(FRONT_DOOR);

    expect(calls.map(namesOf)).toEqual([
      ["RequestCount", "OriginRequestCount", "ResponseSize"],
      [
        "Percentage5XX",
        "TotalLatency",
        "Percentage4XX",
        "OriginLatency",
        "OriginHealthPercentage",
        "ByteHitRatio",
      ],
    ]);
    expect(calls.map(aggregationsOf)).toEqual([["total"], ["average"]]);
    expect(isServedWithItsCall(calls)).toBe(true);
  });

  test("Cosmos DB's ThrottledRequestPercentage is never asked with TotalRequests' Count, the cause of its 'Bad request'", () => {
    const calls: Array<Array<Metric>> = partitionAzureMetricCalls(COSMOS_DB);

    expect(isServedWithItsCall(calls)).toBe(true);
    expect(
      calls.find((call: Array<Metric>): boolean => {
        return namesOf(call).includes("ThrottledRequestPercentage");
      })!,
    ).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ aggregation: "Count" }),
      ]),
    );
    // Each call in the order of its first metric: four, as few as their aggregations allow.
    expect(calls.map(aggregationsOf)).toEqual([
      ["count"],
      ["total"],
      ["maximum"],
      ["average"],
    ]);
    // Every metric once.
    expect(
      calls
        .flat()
        .map((item: Metric) => {
          return item.name;
        })
        .sort(),
    ).toEqual(namesOf(COSMOS_DB).sort());
  });

  test("metrics served with every aggregation share one call, whatever their own", () => {
    const every: Array<string> = [
      "Average",
      "Minimum",
      "Maximum",
      "Total",
      "Count",
    ];
    const calls: Array<Array<Metric>> = partitionAzureMetricCalls([
      metric("Percentage CPU", "Average", every),
      metric("Network In Total", "Total", every),
      metric("Disk Read Operations/Sec", "Average", every),
    ]);

    expect(calls).toHaveLength(1);
    expect(aggregationsOf(calls[0]!)).toEqual(["average", "total"]);
  });

  test("an App Service plan's levels and bytes share a call where every one is served with both", () => {
    const calls: Array<Array<Metric>> =
      partitionAzureMetricCalls(APP_SERVICE_PLAN);

    // CpuPercentage is not served as a Total: the bytes go apart.
    expect(calls.map(namesOf)).toEqual([
      ["CpuPercentage", "MemoryPercentage", "HttpQueueLength"],
      ["BytesReceived"],
    ]);
  });

  test("a metric whose served aggregations are unknown is asked with its own alone, and with others of its own", () => {
    const calls: Array<Array<Metric>> = partitionAzureMetricCalls([
      metric("Known", "Average", ["Average", "Total"]),
      metric("Unknown", "Total"),
      metric("Also Unknown", "Average"),
    ]);

    expect(calls.map(namesOf)).toEqual([
      ["Known", "Also Unknown"],
      ["Unknown"],
    ]);
    expect(calls.map(aggregationsOf)).toEqual([["average"], ["total"]]);
  });

  test("a metric named to be asked with its own aggregation alone is, whatever its definition says", () => {
    const every: Array<string> = ["Average", "Total"];
    const calls: Array<Array<Metric>> = partitionAzureMetricCalls(
      [
        metric("A", "Average", every),
        metric("B", "Total", every),
        metric("C", "Average", every),
      ],
      { ownAggregationOnly: new Set<string>(["b"]) },
    );

    expect(calls.map(namesOf)).toEqual([["A", "C"], ["B"]]);
  });

  test("20 metrics a call at most, each call in the metrics' order", () => {
    const many: Array<Metric> = Array.from(
      { length: 45 },
      (_: unknown, index: number): Metric => {
        return metric(`metric-${index}`, "Average", ["Average"]);
      },
    );
    const calls: Array<Array<Metric>> = partitionAzureMetricCalls(many);

    expect(
      calls.map((call: Array<Metric>): number => {
        return call.length;
      }),
    ).toEqual([20, 20, 5]);
    expect(calls.flat()).toEqual(many);
    expect(partitionAzureMetricCalls([])).toEqual([]);
  });

  test("whatever the metrics, every one is asked once, in a call of aggregations it is served with, 20 at most", () => {
    const random: SeededRandom = seededRandom(10291);
    const aggregations: Array<string> = [
      "Average",
      "Minimum",
      "Maximum",
      "Total",
      "Count",
    ];

    for (let round: number = 0; round < 300; round++) {
      const metrics: Array<Metric> = Array.from(
        { length: 1 + random(40) },
        (_: unknown, index: number): Metric => {
          const own: string = aggregations[random(aggregations.length)]!;
          const served: Array<string> = aggregations.filter(
            (aggregation: string): boolean => {
              return aggregation === own || random(2) === 1;
            },
          );

          return metric(
            `metric-${index}`,
            own,
            random(5) === 0 ? undefined : served,
          );
        },
      );
      const calls: Array<Array<Metric>> = partitionAzureMetricCalls(metrics);

      expect(isServedWithItsCall(calls)).toBe(true);
      expect(
        calls.every((call: Array<Metric>): boolean => {
          return call.length >= 1 && call.length <= 20;
        }),
      ).toBe(true);
      expect(
        calls
          .flat()
          .map((item: Metric): string => {
            return item.name;
          })
          .sort(),
      ).toEqual(namesOf(metrics).sort());
    }
  });
});

describe("what kind of failure a metric's own error is", () => {
  test.each([
    {
      said: "ServerBusy, as an App Service plan's CpuPercentage was answered",
      failure: SERVER_BUSY,
      kind: CloudMetricNotReadKind.Throttled,
    },
    {
      said: "a code of Throttled alone",
      failure: { errorCode: "Throttled", errorMessage: "" },
      kind: CloudMetricNotReadKind.Throttled,
    },
    {
      said: "a sampling type it is not served with, as Front Door's ByteHitRatio was",
      failure: samplingTypeNotFound("ByteHitRatio", "Sum"),
      kind: CloudMetricNotReadKind.Unsupported,
    },
    {
      said: "Bad request, as Cosmos DB's ThrottledRequestPercentage was",
      failure: BAD_REQUEST,
      kind: CloudMetricNotReadKind.Unsupported,
    },
    {
      said: "a metric whose name holds 'Throttled' that Azure would not serve",
      failure: {
        errorCode: "BadRequest",
        errorMessage: "Metric ThrottledRequestPercentage: bad request.",
      },
      kind: CloudMetricNotReadKind.Unsupported,
    },
    {
      said: "a server's failure",
      failure: {
        errorCode: "InternalServerError",
        errorMessage: "Something failed on Azure's side.",
      },
      kind: CloudMetricNotReadKind.Failed,
    },
  ])(
    "$said",
    (data: {
      said: string;
      failure: FakeMetricError;
      kind: CloudMetricNotReadKind;
    }) => {
      expect(
        classifyAzureMetricFailure({
          code: data.failure.errorCode,
          message: data.failure.errorMessage,
        }),
      ).toBe(data.kind);
    },
  );
});

function armError(data: {
  status: number;
  body: string;
  headers?: Record<string, string> | undefined;
}): AzureArmError {
  return new AzureArmError(
    new LlmProviderError({
      message: `Azure metrics request failed with HTTP ${data.status}: ${data.body}`,
      kind: LlmProviderError.kindFromStatus(data.status),
      statusCode: data.status,
      responseBody: data.body,
    }),
    readAzureRateLimit(data.headers || {}, Date.parse("2026-10-21T12:07:00Z")),
  );
}

describe("whether a call's failure is Azure too busy to answer it", () => {
  test("429, 529, 502, 503, 504, and Azure's words for it, are", () => {
    for (const status of [429, 529, 502, 503, 504]) {
      expect(isAzureMetricThrottle(armError({ status, body: "{}" }))).toBe(
        true,
      );
    }

    // Azure's words for it, whatever the status a gateway gave it.
    expect(
      isAzureMetricThrottle(
        armError({ status: 500, body: String(SERVER_BUSY_CALL.body) }),
      ),
    ).toBe(true);
  });

  test("a refusal is not, even one that lists ThrottledRequestPercentage among the valid metrics", () => {
    const refusal: AzureArmError = armError({
      status: 400,
      body: JSON.stringify({
        code: "BadRequest",
        message:
          "Failed to find metric configuration for provider: Microsoft.DocumentDB, resource Type: databaseAccounts, metric: Gone, Valid metrics: TotalRequests,ThrottledRequestPercentage",
      }),
    });

    expect(isAzureMetricThrottle(refusal)).toBe(false);
    expect(isAzureUnsupportedMetricsRefusal(refusal)).toBe(true);
    expect(isAzureMetricThrottle(armError({ status: 403, body: "{}" }))).toBe(
      false,
    );
    expect(isAzureMetricThrottle(new Error("socket hang up"))).toBe(false);
  });
});

describe("how long a busy call waits before it is asked again", () => {
  test("from two seconds, doubling, half of each wait drawn at random", () => {
    const waits: (fraction: number) => Array<number> = (
      fraction: number,
    ): Array<number> => {
      return [0, 1, 2, 3].map((attempt: number): number => {
        return getAzureMetricRetryWaitMs({
          attempt,
          random: (): number => {
            return fraction;
          },
        });
      });
    };

    expect(AZURE_METRIC_FIRST_RETRY_WAIT_MS).toBe(2000);
    expect(waits(0)).toEqual([1000, 2000, 4000, 8000]);
    expect(waits(1)).toEqual([2000, 4000, 8000, 16000]);
    expect(waits(0.5)).toEqual([1500, 3000, 6000, 12000]);
  });

  test("never longer than its longest wait - but for Azure's own", () => {
    expect(
      getAzureMetricRetryWaitMs({
        attempt: 20,
        random: (): number => {
          return 1;
        },
      }),
    ).toBe(AZURE_METRIC_MAX_RETRY_WAIT_MS);
    expect(
      getAzureMetricRetryWaitMs({
        attempt: 0,
        retryAfterMs: 45000,
        random: (): number => {
          return 0.5;
        },
      }),
    ).toBe(45500);
  });

  test("Azure's wait when it is the longer, and up to a second more", () => {
    expect(
      getAzureMetricRetryWaitMs({
        attempt: 0,
        retryAfterMs: 17000,
        random: (): number => {
          return 0;
        },
      }),
    ).toBe(17000);
    expect(
      getAzureMetricRetryWaitMs({
        attempt: 0,
        retryAfterMs: 17000,
        random: (): number => {
          return 1;
        },
      }),
    ).toBe(18000);
    // Shorter than the backoff: the backoff.
    expect(
      getAzureMetricRetryWaitMs({
        attempt: 3,
        retryAfterMs: 1000,
        random: (): number => {
          return 0;
        },
      }),
    ).toBe(8000);
  });

  test.each([
    {
      said: "Retry-After in seconds",
      headers: { "retry-after": "17" },
      waitMs: 17000,
    },
    {
      said: "Retry-After as a date",
      headers: { "retry-after": "Wed, 21 Oct 2026 12:07:30 GMT" },
      waitMs: 30000,
    },
    {
      said: "an x-ms-ratelimit retry-after header",
      headers: {
        "x-ms-ratelimit-microsoft.insights-retry-after": "9",
        "x-ms-ratelimit-remaining-subscription-reads": "0",
      },
      waitMs: 9000,
    },
    {
      said: "the longest of several",
      headers: {
        "retry-after": "3",
        "x-ms-ratelimit-microsoft.insights-retry-after": "12",
      },
      waitMs: 12000,
    },
    { said: "no wait at all", headers: {}, waitMs: undefined },
  ])(
    "a 429's $said",
    (data: {
      said: string;
      headers: Record<string, string>;
      waitMs: number | undefined;
    }) => {
      expect(
        readAzureRetryAfterMs(
          armError({ status: 429, body: "{}", headers: data.headers }),
        ),
      ).toBe(data.waitMs);
    },
  );
});

describe("calls of several places", () => {
  test("are taken in turn, so one place's calls never hold every worker", () => {
    expect(
      interleaveAzureMetricCalls([
        { placeKey: "a", id: 1 },
        { placeKey: "a", id: 2 },
        { placeKey: "a", id: 3 },
        { placeKey: "b", id: 4 },
        { placeKey: "c", id: 5 },
        { placeKey: "b", id: 6 },
      ]).map((call: { placeKey: string; id: number }): number => {
        return call.id;
      }),
    ).toEqual([1, 4, 5, 2, 6, 3]);
  });
});

/*
 * ---- The reader, against the fake --------------------------------------
 */

const PLAN_TYPE: string = "Microsoft.Web/serverFarms";

function place(data: {
  name: string;
  type?: string | undefined;
  region?: string | undefined;
  subscriptionId?: string | undefined;
}): AzureMetricPlace {
  return {
    armId: armIdOf({
      subscriptionId: data.subscriptionId,
      type: data.type || PLAN_TYPE,
      name: data.name,
    }),
    subscriptionId: data.subscriptionId || FAKE_SUBSCRIPTION,
    region: data.region || "southcentralus",
    type: data.type || PLAN_TYPE,
  };
}

function requestOf(
  at: AzureMetricPlace,
  metrics: Array<Metric> = APP_SERVICE_PLAN,
  extra: Partial<AzureMetricCallGroup<Metric>> = {},
): AzureMetricRequest<Metric> {
  return {
    place: at,
    groups: [
      {
        groupKey: "PT1M",
        grain: "PT1M",
        window: { periodSeconds: 60, ...FAKE_WINDOW },
        metrics,
        ...extra,
      },
    ],
  };
}

interface Harness {
  fake: FakeAzureMonitor;
  reader: AzureMetricReader;
  waits: Array<number>;
  budget: CloudReadBudget;
}

function harness(
  options: FakeAzureMonitorOptions = {},
  extra: {
    maxRequests?: number | undefined;
    maxDurationMs?: number | undefined;
    cloud?: "public" | "usgov" | undefined;
    canBatch?: ((at: AzureMetricPlace) => boolean) | undefined;
  } = {},
): Harness {
  const fake: FakeAzureMonitor = createFakeAzureMonitor(options);
  const budget: CloudReadBudget = new CloudReadBudget({
    maxRequests: extra.maxRequests ?? 3000,
    maxDurationMs: extra.maxDurationMs ?? 6 * 60 * 1000,
  });
  const arm: AzureArm = createFakeArm({ fake, budget, cloud: extra.cloud });
  const waits: Array<number> = [];

  return {
    fake,
    budget,
    waits,
    reader: new AzureMetricReader({
      arm,
      budget,
      sleep: async (milliseconds: number): Promise<void> => {
        waits.push(milliseconds);
      },
      random: (): number => {
        return 0;
      },
      canBatch: extra.canBatch,
    }),
  };
}

function plans(count: number, region?: string): Array<AzureMetricPlace> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return place({ name: `plan-${index}`, region });
  });
}

function readNames(result: AzureMetricReadResult<Metric>): Array<string> {
  return result.reads.map(
    (read: AzureMetricReadResult<Metric>["reads"][number]) => {
      return namesOf(read.read).sort().join(",");
    },
  );
}

describe("reading in batches", () => {
  test("an App Service plan's of one subscription and Region share metrics:getBatch calls, signed in for Azure Monitor's data plane", async () => {
    const run: Harness = harness();
    const result: AzureMetricReadResult<Metric> = await run.reader.read(
      plans(3).map((at: AzureMetricPlace) => {
        return requestOf(at);
      }),
    );

    // A batch per aggregation group, for the three plans together.
    expect(run.fake.calls).toHaveLength(2);
    expect(
      run.fake.calls.every((call: FakeMonitorCall): boolean => {
        return (
          call.isBatch &&
          call.host === "southcentralus.metrics.monitor.azure.com" &&
          call.resourceIds.length === 3 &&
          call.namespace === PLAN_TYPE
        );
      }),
    ).toBe(true);
    expect(run.fake.scopes).toContain(
      "https://metrics.monitor.azure.com/.default",
    );
    expect(result.batchCalls).toBe(2);
    expect(result.calls).toBe(2);
    expect(readNames(result)).toEqual([
      "BytesReceived,CpuPercentage,HttpQueueLength,MemoryPercentage",
      "BytesReceived,CpuPercentage,HttpQueueLength,MemoryPercentage",
      "BytesReceived,CpuPercentage,HttpQueueLength,MemoryPercentage",
    ]);
    // Each resource's series, each of its own resource's answer.
    expect(
      result.reads.every(
        (read: AzureMetricReadResult<Metric>["reads"][number]): boolean => {
          return read.series.length === 4 && read.answeredCalls === 2;
        },
      ),
    ).toBe(true);
    expect(result.groupsRead).toEqual(new Set<string>(["PT1M"]));
  });

  test("50 resources a batch at most", async () => {
    const run: Harness = harness();

    await run.reader.read(
      plans(120).map((at: AzureMetricPlace) => {
        return requestOf(at, [APP_SERVICE_PLAN[0]!]);
      }),
    );

    expect(
      run.fake.calls.map((call: FakeMonitorCall): number => {
        return call.resourceIds.length;
      }),
    ).toEqual([50, 50, 20]);
  });

  test("resources of other subscriptions, Regions or types are batched apart", async () => {
    const run: Harness = harness();

    await run.reader.read(
      [
        requestOf(place({ name: "a" })),
        requestOf(place({ name: "b" })),
        requestOf(place({ name: "c", region: "northcentralus" })),
        requestOf(place({ name: "d", region: "northcentralus" })),
        requestOf(place({ name: "e", subscriptionId: OTHER_SUBSCRIPTION })),
        requestOf(place({ name: "f", subscriptionId: OTHER_SUBSCRIPTION })),
      ].map((request: AzureMetricRequest<Metric>) => {
        return {
          ...request,
          groups: request.groups.map((group: AzureMetricCallGroup<Metric>) => {
            return { ...group, metrics: [APP_SERVICE_PLAN[0]!] };
          }),
        };
      }),
    );

    expect(
      run.fake.calls
        .map((call: FakeMonitorCall): string => {
          return `${call.subscriptionId.slice(0, 4)} ${call.host.split(".")[0]} ${call.resourceIds.length}`;
        })
        .sort(),
    ).toEqual([
      "7c4a southcentralus 2",
      "d0cf northcentralus 2",
      "d0cf southcentralus 2",
    ]);
  });

  test("a resource alone, a split read, a global resource and Azure Government's are asked one at a time", async () => {
    const run: Harness = harness();
    const frontDoors: Array<AzureMetricPlace> = [
      place({ name: "fd-1", type: "Microsoft.Cdn/profiles", region: "global" }),
      place({ name: "fd-2", type: "Microsoft.Cdn/profiles", region: "global" }),
    ];
    const namespaces: Array<AzureMetricPlace> = [
      place({ name: "sb-1", type: "Microsoft.ServiceBus/namespaces" }),
      place({ name: "sb-2", type: "Microsoft.ServiceBus/namespaces" }),
    ];

    await run.reader.read([
      requestOf(place({ name: "alone" }), [APP_SERVICE_PLAN[0]!]),
      ...frontDoors.map((at: AzureMetricPlace) => {
        return requestOf(at, [FRONT_DOOR[6]!]);
      }),
      ...namespaces.map((at: AzureMetricPlace) => {
        return requestOf(at, [metric("IncomingMessages", "Total", ["Total"])], {
          splitBy: "EntityName",
          top: 1000,
        });
      }),
    ]);

    expect(run.fake.calls).toHaveLength(5);
    expect(
      run.fake.calls.every((call: FakeMonitorCall): boolean => {
        return !call.isBatch && call.host === "management.azure.com";
      }),
    ).toBe(true);
    expect(
      run.fake.calls
        .filter((call: FakeMonitorCall): boolean => {
          return call.splitBy === "EntityName";
        })
        .map((call: FakeMonitorCall): number => {
          return call.resourceIds.length;
        }),
    ).toEqual([1, 1]);

    const budget: CloudReadBudget = new CloudReadBudget({
      maxRequests: 10,
      maxDurationMs: 60000,
    });
    const publicArm: AzureArm = createFakeArm({ fake: run.fake, budget });
    const usgovArm: AzureArm = createFakeArm({
      fake: run.fake,
      budget,
      cloud: "usgov",
    });

    expect(publicArm.canBatchMetrics("southcentralus")).toBe(true);
    expect(publicArm.canBatchMetrics("SouthCentralUS")).toBe(true);
    expect(publicArm.canBatchMetrics("global")).toBe(false);
    // Not a Region's name as Resource Manager writes one: never a host.
    expect(publicArm.canBatchMetrics("South Central US")).toBe(false);
    expect(publicArm.canBatchMetrics("evil.example.com/x")).toBe(false);
    expect(publicArm.canBatchMetrics("")).toBe(false);
    expect(usgovArm.canBatchMetrics("usgovvirginia")).toBe(false);
  });

  test("a place its caller says not to batch is asked one at a time", async () => {
    const run: Harness = harness(
      {},
      {
        canBatch: (): boolean => {
          return false;
        },
      },
    );

    await run.reader.read(
      plans(3).map((at: AzureMetricPlace) => {
        return requestOf(at, [APP_SERVICE_PLAN[0]!]);
      }),
    );

    expect(run.fake.calls).toHaveLength(3);
    expect(run.fake.scopes).not.toContain(
      "https://metrics.monitor.azure.com/.default",
    );
  });

  test("a batch Azure refuses (401: Monitoring Reader on the resources, not the subscription) is asked a resource at a time, and the refusal handed back", async () => {
    const run: Harness = harness({
      callAnswer: (data: { call: FakeMonitorCall }) => {
        return data.call.isBatch
          ? {
              status: 401,
              body: JSON.stringify({
                error: {
                  code: "AuthorizationFailed",
                  message:
                    "The client does not have authorization to perform action 'Microsoft.Insights/Metrics/Read' over scope '/subscriptions/d0cfe6b2-9ac0-4464-9919-dccaee2e48c0'.",
                },
              }),
            }
          : null;
      },
    });
    const result: AzureMetricReadResult<Metric> = await run.reader.read(
      plans(3).map((at: AzureMetricPlace) => {
        return requestOf(at, [APP_SERVICE_PLAN[0]!]);
      }),
    );

    expect(
      run.fake.calls.map((call: FakeMonitorCall): boolean => {
        return call.isBatch;
      }),
    ).toEqual([true, false, false, false]);
    expect(result.batchRefusals).toHaveLength(1);
    expect(result.batchRefusals[0]!.place.subscriptionId).toBe(
      FAKE_SUBSCRIPTION,
    );
    expect(readNames(result)).toEqual([
      "CpuPercentage",
      "CpuPercentage",
      "CpuPercentage",
    ]);
    // No wait: a refusal is not Azure being busy.
    expect(run.waits).toEqual([]);
  });

  test("a resource a batch's answer leaves out is asked on its own", async () => {
    const left: AzureMetricPlace = place({ name: "plan-1" });
    const run: Harness = harness({ leftOut: [left.armId] });
    const result: AzureMetricReadResult<Metric> = await run.reader.read(
      plans(3).map((at: AzureMetricPlace) => {
        return requestOf(at, [APP_SERVICE_PLAN[0]!]);
      }),
    );

    expect(run.fake.calls).toHaveLength(2);
    expect(run.fake.calls[1]!.resourceIds).toEqual([left.armId]);
    expect(run.fake.calls[1]!.isBatch).toBe(false);
    expect(readNames(result)).toEqual([
      "CpuPercentage",
      "CpuPercentage",
      "CpuPercentage",
    ]);
  });

  test("the data plane's sign-in refused: every batch is asked a resource at a time, and the failure handed back", async () => {
    const run: Harness = harness({
      dataPlaneTokenError: {
        status: 400,
        body: '{"error":"invalid_scope","error_description":"AADSTS70011: The provided value for the input parameter scope is not valid."}',
      },
    });
    const result: AzureMetricReadResult<Metric> = await run.reader.read(
      plans(2).map((at: AzureMetricPlace) => {
        return requestOf(at, [APP_SERVICE_PLAN[0]!]);
      }),
    );

    expect(result.batchSignInFailure).toBeInstanceOf(LlmProviderError);
    expect((result.batchSignInFailure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Authentication,
    );
    expect(
      run.fake.calls.map((call: FakeMonitorCall): boolean => {
        return call.isBatch;
      }),
    ).toEqual([false, false]);
    expect(readNames(result)).toEqual(["CpuPercentage", "CpuPercentage"]);
  });
});

describe("the metrics:getBatch request", () => {
  test("is what Microsoft's reference says: its Region's host, starttime and endtime, the namespace, resourceids in lower case, and a token for the data plane alone", async () => {
    const run: Harness = harness();
    const at: Array<AzureMetricPlace> = plans(2);

    await run.reader.read(
      at.map((each: AzureMetricPlace) => {
        return requestOf(each, [APP_SERVICE_PLAN[0]!, APP_SERVICE_PLAN[1]!]);
      }),
    );

    const batch: DataSourceHttpRequest = run.fake.requests.find(
      (request: DataSourceHttpRequest): boolean => {
        return request.url.includes("metrics:getBatch");
      },
    )!;
    const url: URL = new URL(batch.url);

    expect(batch.method).toBe("POST");
    expect(url.host).toBe("southcentralus.metrics.monitor.azure.com");
    expect(url.pathname).toBe(
      `/subscriptions/${FAKE_SUBSCRIPTION}/metrics:getBatch`,
    );
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({
      starttime: FAKE_WINDOW.start.toISOString(),
      endtime: FAKE_WINDOW.end.toISOString(),
      interval: "PT1M",
      metricnamespace: PLAN_TYPE,
      metricnames: "CpuPercentage,MemoryPercentage",
      aggregation: "Average",
      "api-version": "2023-10-01",
    });
    expect(JSON.parse(String(batch.body))).toEqual({
      resourceids: [at[0]!.armId, at[1]!.armId],
    });
    expect(batch.headers?.["Authorization"]).toBe(
      "Bearer token-for-https://metrics.monitor.azure.com/.default",
    );
  });

  test("a call of its own goes to Resource Manager with Resource Manager's token, asked once", async () => {
    const run: Harness = harness();

    await run.reader.read([
      requestOf(place({ name: "alone" }), [APP_SERVICE_PLAN[0]!]),
    ]);

    const call: DataSourceHttpRequest = run.fake.requests.find(
      (request: DataSourceHttpRequest): boolean => {
        return request.url.includes("/providers/Microsoft.Insights/metrics");
      },
    )!;

    expect(new URL(call.url).host).toBe("management.azure.com");
    expect(new URL(call.url).searchParams.get("aggregation")).toBe("Average");
    expect(call.headers?.["Authorization"]).toBe(
      "Bearer token-for-https://management.azure.com/.default",
    );
    expect(run.fake.scopes).toEqual(["https://management.azure.com/.default"]);
  });
});

describe("Azure too busy to answer", () => {
  test("a call answered 529 ServerBusy is asked again after a wait, with fewer of its place's calls at once from then", async () => {
    const run: Harness = harness({
      callAnswer: (data: { index: number }) => {
        return data.index < 2 ? SERVER_BUSY_CALL : null;
      },
    });
    const at: AzureMetricPlace = place({ name: "plan-0" });
    const result: AzureMetricReadResult<Metric> = await run.reader.read([
      requestOf(at, [APP_SERVICE_PLAN[0]!]),
    ]);

    expect(run.fake.calls).toHaveLength(3);
    expect(run.waits).toEqual([1000, 2000]);
    expect(readNames(result)).toEqual(["CpuPercentage"]);
    expect(run.reader.getCallsPerPlace(at)).toBe(
      AZURE_METRIC_CALLS_PER_PLACE / 4,
    );
  });

  test("a 429 is asked again after its Retry-After, not the backoff", async () => {
    const run: Harness = harness({
      callAnswer: (data: { index: number }) => {
        return data.index === 0
          ? {
              status: 429,
              headers: {
                "retry-after": "17",
                "x-ms-ratelimit-remaining-subscription-reads": "0",
              },
              body: '{"code":"TooManyRequests","message":"Rate limit is exceeded. Try again in 17 seconds."}',
            }
          : null;
      },
    });
    const result: AzureMetricReadResult<Metric> = await run.reader.read([
      requestOf(place({ name: "plan-0" }), [APP_SERVICE_PLAN[0]!]),
    ]);

    expect(run.waits).toEqual([17000]);
    expect(readNames(result)).toEqual(["CpuPercentage"]);
  });

  test("busy past every try, the call's metrics are not read, as busy, and the read goes on", async () => {
    const busy: AzureMetricPlace = place({ name: "busy", region: "eastus" });
    const run: Harness = harness({
      callAnswer: (data: { call: FakeMonitorCall }) => {
        return data.call.resourceIds.includes(busy.armId)
          ? SERVER_BUSY_CALL
          : null;
      },
    });
    const result: AzureMetricReadResult<Metric> = await run.reader.read([
      requestOf(busy, [APP_SERVICE_PLAN[0]!]),
      requestOf(place({ name: "fine" }), [APP_SERVICE_PLAN[0]!]),
    ]);

    expect(
      run.fake.calls.filter((call: FakeMonitorCall): boolean => {
        return call.resourceIds.includes(busy.armId);
      }),
    ).toHaveLength(AZURE_METRIC_CALL_TRIES);
    expect(result.reads[0]!.answeredCalls).toBe(0);
    expect(result.reads[0]!.failure).toBeInstanceOf(LlmProviderError);
    expect(result.reads[0]!.notRead).toEqual([
      expect.objectContaining({
        kind: CloudMetricNotReadKind.Throttled,
        code: "529",
      }),
    ]);
    expect(readNames(result)).toEqual(["", "CpuPercentage"]);
  });

  test("a metric answered ServerBusy inside an answer is asked again in a later round, with the others that were, after a wait - the rest are read once", async () => {
    const run: Harness = harness({
      metricError: (data: { metric: string; attempt: number }) => {
        return ["CpuPercentage", "MemoryPercentage"].includes(data.metric) &&
          data.attempt === 0
          ? SERVER_BUSY
          : null;
      },
    });
    const result: AzureMetricReadResult<Metric> = await run.reader.read(
      plans(2).map((at: AzureMetricPlace) => {
        return requestOf(at);
      }),
    );

    expect(
      run.fake.calls.map((call: FakeMonitorCall): string => {
        return `${call.isBatch ? "batch" : "one"}:${call.metrics.join(",")}`;
      }),
    ).toEqual([
      "batch:CpuPercentage,MemoryPercentage,HttpQueueLength",
      "batch:BytesReceived",
      "batch:CpuPercentage,MemoryPercentage",
    ]);
    expect(run.waits).toEqual([1000]);
    expect(readNames(result)).toEqual([
      "BytesReceived,CpuPercentage,HttpQueueLength,MemoryPercentage",
      "BytesReceived,CpuPercentage,HttpQueueLength,MemoryPercentage",
    ]);
    expect(
      result.reads.every(
        (read: AzureMetricReadResult<Metric>["reads"][number]): boolean => {
          return read.notRead.length === 0;
        },
      ),
    ).toBe(true);
  });

  test("a metric busy in every round is not read, as busy, in Azure's words", async () => {
    const run: Harness = harness({
      metricError: (data: { metric: string }) => {
        return data.metric === "CpuPercentage" ? SERVER_BUSY : null;
      },
    });
    const result: AzureMetricReadResult<Metric> = await run.reader.read([
      requestOf(place({ name: "plan-0" })),
    ]);

    expect(
      run.fake.calls.filter((call: FakeMonitorCall): boolean => {
        return call.metrics.includes("CpuPercentage");
      }),
    ).toHaveLength(AZURE_METRIC_ROUNDS);
    expect(result.reads[0]!.notRead).toEqual([
      {
        metric: APP_SERVICE_PLAN[0],
        kind: CloudMetricNotReadKind.Throttled,
        code: SERVER_BUSY.errorCode,
        message: SERVER_BUSY.errorMessage,
      },
    ]);
    expect(readNames(result)).toEqual([
      "BytesReceived,HttpQueueLength,MemoryPercentage",
    ]);
  });

  test("no more than its share of a place's calls at once, while other places go on at theirs", async () => {
    let release: () => void = (): void => {};
    const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });
    const run: Harness = harness(
      {
        hold: async (): Promise<void> => {
          await gate;
        },
      },
      {
        canBatch: (): boolean => {
          return false;
        },
      },
    );
    const south: Array<AzureMetricPlace> = plans(6);
    const east: Array<AzureMetricPlace> = [
      place({ name: "east-0", region: "eastus" }),
      place({ name: "east-1", region: "eastus" }),
    ];
    const reading: Promise<AzureMetricReadResult<Metric>> = run.reader.read(
      [...south, ...east].map((at: AzureMetricPlace) => {
        return requestOf(at, [APP_SERVICE_PLAN[0]!]);
      }),
    );

    // Long enough for every call to reach Azure that would start without a limit.
    for (
      let tick: number = 0;
      tick < 50 && run.fake.calls.length < south.length + east.length;
      tick++
    ) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }

    const started: Array<string> = run.fake.calls.map(
      (call: FakeMonitorCall): string => {
        return call.resourceIds[0]!.includes("east-") ? "east" : "south";
      },
    );

    // Eight workers, but four of a place at once: two of the south's wait.
    expect(
      started.filter((at: string): boolean => {
        return at === "south";
      }),
    ).toHaveLength(AZURE_METRIC_CALLS_PER_PLACE);
    expect(
      started.filter((at: string): boolean => {
        return at === "east";
      }),
    ).toHaveLength(2);

    release();

    const result: AzureMetricReadResult<Metric> = await reading;

    expect(run.fake.calls).toHaveLength(8);
    expect(
      readNames(result).every((names: string): boolean => {
        return names === "CpuPercentage";
      }),
    ).toBe(true);
  });
});

describe("a metric Azure does not serve", () => {
  test("asked beside other aggregations, it is asked again with its own alone before it is said to be unsupported", async () => {
    // A definition that said more than Azure serves.
    const lying: Array<Metric> = [
      metric("RequestCount", "Total", ["Total", "Average"]),
      metric("ByteHitRatio", "Average", ["Average", "Total"]),
    ];
    const run: Harness = harness({
      metricError: (data: { metric: string; aggregations: Array<string> }) => {
        return data.metric === "ByteHitRatio" &&
          data.aggregations.some((aggregation: string): boolean => {
            return aggregation.toLowerCase() !== "average";
          })
          ? samplingTypeNotFound("ByteHitRatio", "Sum")
          : null;
      },
    });
    const result: AzureMetricReadResult<Metric> = await run.reader.read([
      requestOf(
        place({ name: "fd", type: "Microsoft.Cdn/profiles", region: "global" }),
        lying,
      ),
    ]);

    expect(
      run.fake.calls.map((call: FakeMonitorCall): string => {
        return `${call.metrics.join(",")}:${call.aggregations.join(",")}`;
      }),
    ).toEqual([
      "RequestCount,ByteHitRatio:Total,Average",
      "ByteHitRatio:Average",
    ]);
    // No wait: Azure was not busy.
    expect(run.waits).toEqual([]);
    expect(readNames(result)).toEqual(["ByteHitRatio,RequestCount"]);
    expect(result.reads[0]!.notRead).toEqual([]);
  });

  test("asked with its own aggregation alone, it is unsupported at once, in Azure's words", async () => {
    const run: Harness = harness({
      metricError: (data: { metric: string }) => {
        return data.metric === "ThrottledRequestPercentage"
          ? BAD_REQUEST
          : null;
      },
    });
    const result: AzureMetricReadResult<Metric> = await run.reader.read([
      requestOf(
        place({
          name: "cosmos",
          type: "Microsoft.DocumentDB/databaseAccounts",
        }),
        COSMOS_DB,
      ),
    ]);

    expect(
      run.fake.calls.filter((call: FakeMonitorCall): boolean => {
        return call.metrics.includes("ThrottledRequestPercentage");
      }),
    ).toHaveLength(1);
    expect(result.reads[0]!.notRead).toEqual([
      expect.objectContaining({
        metric: expect.objectContaining({
          name: "ThrottledRequestPercentage",
        }),
        kind: CloudMetricNotReadKind.Unsupported,
        message: "Bad request",
      }),
    ]);
    // Its call's others read; the others' calls read.
    expect(result.reads[0]!.read).toHaveLength(COSMOS_DB.length - 1);
  });

  test("with every metric asked only with aggregations it is served with, the issue's answers do not come", async () => {
    // Azure answers each metric as its definition says it is served.
    const servedBy: Map<string, Array<string>> = new Map(
      [...FRONT_DOOR, ...COSMOS_DB].map((item: Metric) => {
        return [
          item.name,
          (item.supportedAggregations || []).map((aggregation: string) => {
            return aggregation.toLowerCase();
          }),
        ];
      }),
    );
    const run: Harness = harness({
      metricError: (data: { metric: string; aggregations: Array<string> }) => {
        const served: Array<string> = servedBy.get(data.metric) || [];
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
      },
    });
    const result: AzureMetricReadResult<Metric> = await run.reader.read([
      requestOf(
        place({ name: "fd", type: "Microsoft.Cdn/profiles", region: "global" }),
        FRONT_DOOR,
      ),
      requestOf(
        place({
          name: "cosmos-1",
          type: "Microsoft.DocumentDB/databaseAccounts",
        }),
        COSMOS_DB,
      ),
      requestOf(
        place({
          name: "cosmos-2",
          type: "Microsoft.DocumentDB/databaseAccounts",
        }),
        COSMOS_DB,
      ),
    ]);

    expect(
      result.reads.flatMap(
        (read: AzureMetricReadResult<Metric>["reads"][number]) => {
          return read.notRead;
        },
      ),
    ).toEqual([]);
    expect(result.reads[0]!.read).toHaveLength(FRONT_DOOR.length);
    expect(result.reads[1]!.read).toHaveLength(COSMOS_DB.length);
  });
});

describe("the read's limits", () => {
  test("a spent budget cuts the calls not made yet short", async () => {
    const run: Harness = harness({}, { maxRequests: 1 });
    const result: AzureMetricReadResult<Metric> = await run.reader.read([
      requestOf(place({ name: "a", region: "eastus" }), [APP_SERVICE_PLAN[0]!]),
      requestOf(place({ name: "b", region: "westus" }), [APP_SERVICE_PLAN[0]!]),
    ]);

    expect(run.fake.calls).toHaveLength(1);
    expect(
      result.reads.map(
        (read: AzureMetricReadResult<Metric>["reads"][number]) => {
          return [read.answeredCalls, read.isCutShort];
        },
      ),
    ).toEqual([
      [1, false],
      [0, true],
    ]);
  });

  test("with no time left to wait for Azure, what it was busy for is given up as busy, and nothing waits", async () => {
    const run: Harness = harness(
      {
        metricError: (data: { metric: string }) => {
          return data.metric === "CpuPercentage" ? SERVER_BUSY : null;
        },
      },
      // Less than a retry's margin: no wait fits.
      { maxDurationMs: 5000 },
    );
    const result: AzureMetricReadResult<Metric> = await run.reader.read([
      requestOf(place({ name: "plan-0" })),
    ]);

    expect(run.waits).toEqual([]);
    expect(run.fake.calls).toHaveLength(2);
    expect(result.reads[0]!.notRead).toEqual([
      expect.objectContaining({
        kind: CloudMetricNotReadKind.Throttled,
        message: SERVER_BUSY.errorMessage,
      }),
    ]);
  });

  test("a single call Azure refuses for a metric the resource does not publish is handed back, for its own definitions", async () => {
    const refusal: string = JSON.stringify({
      code: "BadRequest",
      message:
        "Failed to find metric configuration for provider: Microsoft.Web, resource Type: serverFarms, metric: HttpQueueLength, Valid metrics: CpuPercentage,MemoryPercentage,BytesReceived",
    });
    const run: Harness = harness({
      callAnswer: (data: { call: FakeMonitorCall }) => {
        return data.call.metrics.includes("HttpQueueLength")
          ? { status: 400, body: refusal }
          : null;
      },
    });
    const result: AzureMetricReadResult<Metric> = await run.reader.read([
      requestOf(place({ name: "basic-plan" })),
    ]);

    expect(isAzureUnsupportedMetricsRefusal(result.reads[0]!.refusal)).toBe(
      true,
    );
    // The refused call's metrics are none of the read's: the caller reads them again.
    expect(result.reads[0]!.notRead).toEqual([]);
    expect(result.reads[0]!.failure).toBeUndefined();
  });

  test("a single call refused for the app's credentials fails the read", async () => {
    const run: Harness = harness({
      callAnswer: () => {
        return {
          status: 401,
          body: '{"error":{"code":"InvalidAuthenticationToken","message":"The access token is invalid."}}',
        };
      },
    });

    await expect(
      run.reader.read([requestOf(place({ name: "plan-0" }))]),
    ).rejects.toThrow("401");
  });
});
