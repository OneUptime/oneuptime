import { beforeEach, describe, expect, test } from "@jest/globals";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import CompatibleIngestService from "../../../FeatureSet/Telemetry/Services/CompatibleIngestService";
import TelemetryQueueService from "../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import { CompatibleQueueUnavailableError } from "../../../FeatureSet/Telemetry/Utils/Compatible/CompatibleIngestFailure";
import { QueuedJob, recordJob } from "./CompatibleIngestRouteHarness";

/*
 * What a compatible endpoint's translation is queued as: one OTLP JSON job
 * per signal it holds, each with its own product type, the body's coding
 * gone - and the door's budget charge only on the job of the signal the
 * door checked, so a HEC batch's metric events or a Sentry envelope's logs
 * are counted against their own budgets, never another's. Each job is
 * counted at its share of the request's body decompressed, so a request is
 * counted once in all, at its own size.
 */

jest.mock(
  "../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addLogIngestJob: jest.fn(),
        addMetricIngestJob: jest.fn(),
        addTraceIngestJob: jest.fn(),
        addProfileIngestJob: jest.fn(),
      },
    };
  },
);

const queue: Record<string, jest.Mock> =
  TelemetryQueueService as unknown as Record<string, jest.Mock>;

let jobs: Array<QueuedJob> = [];

const LOGS: JSONObject = {
  resourceLogs: [{ resource: { attributes: [] }, scopeLogs: [] }],
};
const METRICS: JSONObject = {
  resourceMetrics: [{ resource: { attributes: [] }, scopeMetrics: [] }],
};
const TRACES: JSONObject = {
  resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [] }],
};
const PROFILES: JSONObject = {
  resourceProfiles: [
    {
      resource: { attributes: [] },
      scopeProfiles: [{ scope: { name: "sentry" }, profiles: [{}, {}] }],
    },
  ],
};

// An export request of `count` records of its signal.
const logsOf: (count: number) => JSONObject = (count: number): JSONObject => {
  return {
    resourceLogs: [
      {
        resource: { attributes: [] },
        scopeLogs: [
          {
            logRecords: Array.from({ length: count }, (): JSONObject => {
              return { body: { stringValue: "line" } };
            }),
          },
        ],
      },
    ],
  };
};

const metricsOf: (count: number) => JSONObject = (
  count: number,
): JSONObject => {
  return {
    resourceMetrics: [
      {
        resource: { attributes: [] },
        scopeMetrics: [
          {
            metrics: [
              {
                name: "up",
                gauge: {
                  dataPoints: Array.from({ length: count }, (): JSONObject => {
                    return { asDouble: 1 };
                  }),
                },
              },
            ],
          },
        ],
      },
    ],
  };
};

const tracesOf: (count: number) => JSONObject = (count: number): JSONObject => {
  return {
    resourceSpans: [
      {
        resource: { attributes: [] },
        scopeSpans: [
          {
            spans: Array.from({ length: count }, (): JSONObject => {
              return { name: "span" };
            }),
          },
        ],
      },
    ],
  };
};

const request: (charge?: unknown) => TelemetryRequest = (
  charge?: unknown,
): TelemetryRequest => {
  const req: Record<string, unknown> = {
    projectId: new ObjectID("5d3b0f1a-0000-4000-8000-000000000001"),
    headers: {
      "content-type": "application/x-protobuf",
      "content-encoding": "snappy",
      "x-oneuptime-token": "secret",
    },
    body: Buffer.from("raw"),
  };

  if (charge !== undefined) {
    req["telemetryIngestionBudgetCharge"] = charge;
  }

  return req as unknown as TelemetryRequest;
};

beforeEach(() => {
  jobs = [];
  queue["addLogIngestJob"]!.mockReset().mockImplementation(
    async (req: unknown) => {
      recordJob(jobs, "logs", req as TelemetryRequest);
    },
  );
  queue["addMetricIngestJob"]!.mockReset().mockImplementation(
    async (req: unknown) => {
      recordJob(jobs, "metrics", req as TelemetryRequest);
    },
  );
  queue["addTraceIngestJob"]!.mockReset().mockImplementation(
    async (req: unknown) => {
      recordJob(jobs, "traces", req as TelemetryRequest);
    },
  );
  queue["addProfileIngestJob"]!.mockReset().mockImplementation(
    async (req: unknown) => {
      recordJob(jobs, "profiles", req as TelemetryRequest);
    },
  );
});

describe("CompatibleIngestService.enqueue", () => {
  test("a batch's profiles (a Sentry envelope's) are a Profiles job of their own, counted at their own bytes", async () => {
    const result: Awaited<ReturnType<typeof CompatibleIngestService.enqueue>> =
      await CompatibleIngestService.enqueue({
        req: request(),
        surface: TelemetryIngestSurface.Sentry,
        batch: { traces: TRACES, profiles: PROFILES },
        ingestBytes: { traces: 300, profiles: 4000 },
      });

    expect(result).toEqual({
      queuedLogs: false,
      queuedMetrics: false,
      queuedTraces: true,
      queuedProfiles: true,
    });
    expect(
      jobs.map((job: QueuedJob) => {
        return [job.signal, job.productType, job.ingestBytes];
      }),
    ).toEqual([
      ["traces", "Traces", 300],
      ["profiles", "Profiles", 4000],
    ]);
    expect(jobs[1]!.body).toEqual(PROFILES);
    expect(jobs[1]!.contentType).toBe("application/json");
    expect(jobs[1]!.budgetCharge).toBe("absent");
  });

  test("a request's size is shared with a profiles job by its profiles", async () => {
    await CompatibleIngestService.enqueue({
      req: request(),
      surface: TelemetryIngestSurface.Sentry,
      batch: { traces: tracesOf(2), profiles: PROFILES },
      ingestBytes: 1000,
    });

    expect(
      jobs.map((job: QueuedJob) => {
        return job.ingestBytes;
      }),
    ).toEqual([500, 500]);
    expect(
      CompatibleIngestService.recordCount(PROFILES, "resourceProfiles"),
    ).toBe(2);
  });

  test("an empty profiles export is no job", async () => {
    await CompatibleIngestService.enqueue({
      req: request(),
      surface: TelemetryIngestSurface.Sentry,
      batch: { profiles: { resourceProfiles: [] } },
    });

    expect(jobs).toHaveLength(0);
  });

  test("queues each signal the batch holds as its own OTLP JSON job", async () => {
    const result: Awaited<ReturnType<typeof CompatibleIngestService.enqueue>> =
      await CompatibleIngestService.enqueue({
        req: request(),
        surface: TelemetryIngestSurface.Sentry,
        batch: { logs: LOGS, metrics: METRICS, traces: TRACES },
      });

    expect(result).toEqual({
      queuedLogs: true,
      queuedMetrics: true,
      queuedTraces: true,
      queuedProfiles: false,
    });
    expect(
      jobs.map((job: QueuedJob) => {
        return [job.signal, job.productType];
      }),
    ).toEqual([
      ["logs", "Logs"],
      ["metrics", "Metrics"],
      ["traces", "Traces"],
    ]);

    for (const job of jobs) {
      expect(job.contentType).toBe("application/json");
      expect(job.contentEncoding).toBeUndefined();
    }

    expect(jobs[0]!.body).toEqual(LOGS);
    expect(jobs[2]!.body).toEqual(TRACES);
  });

  test("an empty or missing signal is not queued", async () => {
    await CompatibleIngestService.enqueue({
      req: request(),
      surface: TelemetryIngestSurface.SplunkHec,
      batch: { logs: { resourceLogs: [] }, metrics: null, traces: undefined },
    });

    expect(jobs).toHaveLength(0);
  });

  test("a single-signal surface's job carries the door's pending charge", async () => {
    const charge: JSONObject = { isPending: true, isExact: false };

    await CompatibleIngestService.enqueue({
      req: request(charge),
      surface: TelemetryIngestSurface.Loki,
      batch: { logs: LOGS },
    });

    expect(jobs[0]!.budgetCharge).toEqual(charge);
  });

  test("a null door charge (no budget in force) stays null on its signal's job", async () => {
    await CompatibleIngestService.enqueue({
      req: request(null),
      surface: TelemetryIngestSurface.PrometheusRemoteWrite,
      batch: { metrics: METRICS },
    });

    expect(jobs[0]!.budgetCharge).toBeNull();
  });

  test("a job of another signal than the door checked never takes its charge", async () => {
    const charge: JSONObject = { isPending: true, isExact: false };

    // Loki's door checks logs; a metrics job (were there one) is counted on its own.
    await CompatibleIngestService.enqueue({
      req: request(charge),
      surface: TelemetryIngestSurface.Loki,
      batch: { metrics: METRICS, logs: LOGS },
    });

    expect(
      jobs.find((job: QueuedJob) => {
        return job.signal === "logs";
      })!.budgetCharge,
    ).toEqual(charge);
    expect(
      jobs.find((job: QueuedJob) => {
        return job.signal === "metrics";
      })!.budgetCharge,
    ).toBe("absent");
  });

  test("a multi-signal surface's jobs are each counted at the queue", async () => {
    await CompatibleIngestService.enqueue({
      req: request(),
      surface: TelemetryIngestSurface.Datadog,
      batch: { logs: LOGS, metrics: METRICS },
    });

    for (const job of jobs) {
      expect(job.budgetCharge).toBe("absent");
    }
  });

  test("the queue failing is CompatibleQueueUnavailableError, for a 503", async () => {
    queue["addMetricIngestJob"]!.mockRejectedValue(
      new Error("redis down") as never,
    );

    await expect(
      CompatibleIngestService.enqueue({
        req: request(),
        surface: TelemetryIngestSurface.PrometheusRemoteWrite,
        batch: { metrics: METRICS },
      }),
    ).rejects.toBeInstanceOf(CompatibleQueueUnavailableError);
  });

  test("the job of the door's signal is counted at the body's decompressed size it is handed", async () => {
    await CompatibleIngestService.enqueue({
      req: request({ isPending: true, isExact: false }),
      surface: TelemetryIngestSurface.PrometheusRemoteWrite,
      batch: { metrics: METRICS },
      ingestBytes: 1234,
    });

    expect(jobs[0]!.ingestBytes).toBe(1234);
  });

  test("a job of another signal than the door's takes its share of the size, not the door's charge: the request is counted once", async () => {
    await CompatibleIngestService.enqueue({
      req: request({ isPending: true, isExact: false }),
      surface: TelemetryIngestSurface.Loki,
      batch: { metrics: metricsOf(1), logs: logsOf(3) },
      ingestBytes: 1234,
    });

    const logs: QueuedJob = jobs.find((job: QueuedJob) => {
      return job.signal === "logs";
    })!;
    const metrics: QueuedJob = jobs.find((job: QueuedJob) => {
      return job.signal === "metrics";
    })!;

    // Three log records to one datapoint.
    expect(logs.ingestBytes).toBe(926);
    expect(metrics.ingestBytes).toBe(308);
    expect(logs.ingestBytes! + metrics.ingestBytes!).toBe(1234);
    expect(metrics.budgetCharge).toBe("absent");
  });

  test("a multi-signal surface's jobs share the request's size by the records each became, and add up to it", async () => {
    await CompatibleIngestService.enqueue({
      req: request(),
      surface: TelemetryIngestSurface.SplunkHec,
      batch: { logs: logsOf(2), metrics: metricsOf(2) },
      ingestBytes: 1001,
    });

    expect(
      jobs.map((job: QueuedJob) => {
        return [job.signal, job.ingestBytes, job.budgetCharge];
      }),
    ).toEqual([
      ["logs", 501, "absent"],
      ["metrics", 500, "absent"],
    ]);
  });

  test("a multi-signal surface's request of one signal is counted at all of its size", async () => {
    await CompatibleIngestService.enqueue({
      req: request(),
      surface: TelemetryIngestSurface.Datadog,
      batch: { metrics: metricsOf(40) },
      ingestBytes: 5000,
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.ingestBytes).toBe(5000);
  });

  test("each signal's own size, when the endpoint knows it, is what its job is counted at", async () => {
    await CompatibleIngestService.enqueue({
      req: request(),
      surface: TelemetryIngestSurface.Sentry,
      batch: { traces: tracesOf(1), logs: logsOf(10) },
      ingestBytes: { traces: 9000, logs: 120 },
    });

    expect(
      jobs.map((job: QueuedJob) => {
        return [job.signal, job.ingestBytes];
      }),
    ).toEqual([
      ["logs", 120],
      ["traces", 9000],
    ]);
  });

  test("a signal the endpoint gave no size of is counted at its OTLP JSON", async () => {
    await CompatibleIngestService.enqueue({
      req: request(),
      surface: TelemetryIngestSurface.Sentry,
      batch: { traces: tracesOf(1), logs: logsOf(1) },
      ingestBytes: { traces: 700 },
    });

    expect(
      jobs.map((job: QueuedJob) => {
        return [job.signal, job.ingestBytes];
      }),
    ).toEqual([
      ["logs", undefined],
      ["traces", 700],
    ]);
  });

  test("without a size, a job is counted at the OTLP JSON it is queued as", async () => {
    const req: TelemetryRequest = request({ isPending: true, isExact: false });

    await CompatibleIngestService.enqueue({
      req: req,
      surface: TelemetryIngestSurface.PrometheusRemoteWrite,
      batch: { metrics: METRICS },
    });

    expect(jobs[0]!.ingestBytes).toBeUndefined();
    expect(req.telemetryIngestBytes).toBeUndefined();
  });

  test("the request's raw body is let go once it is queued", async () => {
    const req: TelemetryRequest = request();

    await CompatibleIngestService.enqueue({
      req: req,
      surface: TelemetryIngestSurface.Loki,
      batch: { logs: LOGS },
    });

    expect(req.body).toBeNull();
  });
});

describe("CompatibleIngestService.recordCount", () => {
  test("counts log records across resources and scopes", () => {
    const logs: JSONObject = logsOf(2);
    (logs["resourceLogs"] as Array<JSONObject>).push(
      (logsOf(3)["resourceLogs"] as Array<JSONObject>)[0]!,
    );

    expect(CompatibleIngestService.recordCount(logs, "resourceLogs")).toBe(5);
  });

  test("counts the datapoints of every metric shape", () => {
    const point: JSONObject = { asDouble: 1 };
    const metrics: JSONObject = {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                { name: "a", gauge: { dataPoints: [point] } },
                { name: "b", sum: { dataPoints: [point, point] } },
                { name: "c", histogram: { dataPoints: [point] } },
                {
                  name: "d",
                  exponentialHistogram: { dataPoints: [point, point] },
                },
                { name: "e", summary: { dataPoints: [point] } },
                { name: "f" },
              ],
            },
          ],
        },
      ],
    };

    expect(
      CompatibleIngestService.recordCount(metrics, "resourceMetrics"),
    ).toBe(7);
  });

  test("counts spans", () => {
    expect(
      CompatibleIngestService.recordCount(tracesOf(4), "resourceSpans"),
    ).toBe(4);
  });

  test("reads nothing it does not expect as records", () => {
    expect(
      CompatibleIngestService.recordCount(
        {
          resourceLogs: [null, 3, { scopeLogs: "x" }],
        } as unknown as JSONObject,
        "resourceLogs",
      ),
    ).toBe(0);
  });
});

describe("CompatibleIngestService.shareIngestBytes", () => {
  test("shares a size by records, the remainder to the largest fractions, adding up exactly", () => {
    const shares: Array<number | undefined> =
      CompatibleIngestService.shareIngestBytes(
        [
          { signal: "logs", records: 1 },
          { signal: "metrics", records: 1 },
          { signal: "traces", records: 1 },
        ],
        100,
      );

    expect(shares).toEqual([34, 33, 33]);
  });

  test("a job of no records still takes a share: none is counted at nothing", () => {
    expect(
      CompatibleIngestService.shareIngestBytes(
        [
          { signal: "logs", records: 0 },
          { signal: "metrics", records: 9 },
        ],
        1000,
      ),
    ).toEqual([100, 900]);
  });

  test("a fractional size is counted in whole bytes", () => {
    expect(
      CompatibleIngestService.shareIngestBytes(
        [{ signal: "logs", records: 3 }],
        99.9,
      ),
    ).toEqual([99]);
  });

  test("over many shapes, the shares always add up to the size", () => {
    for (let total: number = 0; total < 200; total += 7) {
      for (const records of [
        [1, 1],
        [3, 7],
        [0, 0, 5],
        [1000, 1, 1],
      ]) {
        const shares: Array<number | undefined> =
          CompatibleIngestService.shareIngestBytes(
            records.map((count: number, index: number) => {
              return {
                signal: (["logs", "metrics", "traces"] as const)[index]!,
                records: count,
              };
            }),
            total,
          );

        expect(
          shares.reduce((sum: number, share: number | undefined) => {
            return sum + (share ?? 0);
          }, 0),
        ).toBe(total);
      }
    }
  });

  test("each signal's own size is taken as it is, and a missing one is left to the queue", () => {
    expect(
      CompatibleIngestService.shareIngestBytes(
        [
          { signal: "logs", records: 5 },
          { signal: "traces", records: 1 },
        ],
        { traces: 42.7 },
      ),
    ).toEqual([undefined, 42]);
  });

  test("no size, or one that is no size, leaves every job to the queue", () => {
    for (const size of [undefined, Number.NaN, -1, Infinity]) {
      expect(
        CompatibleIngestService.shareIngestBytes(
          [{ signal: "logs", records: 1 }],
          size,
        ),
      ).toEqual([undefined]);
    }
  });
});
