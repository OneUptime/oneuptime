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
 * are counted against their own budgets, never another's.
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
});

describe("CompatibleIngestService.enqueue", () => {
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
