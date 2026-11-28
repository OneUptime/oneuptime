import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * TelemetryIngestShedding at the enqueue (2026-11-27). Every bulk batch is
 * queued through TelemetryQueueService.addTelemetryIngestJob, whichever
 * producer made it - the HTTP and gRPC ingest refuse a flooding project
 * before it gets here, MQTT, the cloud streams, the compatible endpoints and
 * OneUptime's own collectors do not - so a batch of a project far ahead of
 * the workers is refused here too, before its body is stored or its job
 * queued: a TooManyRequests its producer answers as it answers a queue that
 * cannot take it (the ingest routes: a retryable 503).
 *
 * And the sampler that decides it reads each queued job's project and
 * signal from the job's id, so the ids this service writes, and the signal
 * each type of job is counted under, are pinned to what it reads.
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn().mockResolvedValue(undefined),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
      MarketingEvent: "MarketingEvent",
    },
  };
});

const storeBody: jest.Mock = jest.fn().mockResolvedValue("telemetry:body:k");
jest.mock("../../FeatureSet/Telemetry/Utils/TelemetryBodyStore", () => {
  return {
    __esModule: true,
    default: { storeBody, readBody: jest.fn(), deleteBody: jest.fn() },
  };
});

const getRefusal: jest.Mock = jest.fn();
jest.mock("Common/Server/Utils/Telemetry/TelemetryIngestShedding", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Telemetry/TelemetryIngestShedding",
  ) as Record<string, unknown>;

  return { __esModule: true, ...actual, default: { getRefusal } };
});

const loggerError: jest.Mock = jest.fn();
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: loggerError,
    },
    getLogAttributesFromRequest: jest.fn(),
  };
});

import TelemetryQueueService, {
  getTelemetryIngestionBudgetSignalForTelemetryType,
  isBulkTelemetryType,
  TelemetryType,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import Queue from "Common/Server/Infrastructure/Queue";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  getTelemetryIngestSheddingSignalForJobType,
  parseQueuedTelemetryJobId,
  TelemetryIngestShedError,
} from "Common/Server/Utils/Telemetry/TelemetryIngestShedding";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import {
  TelemetryIngestionBudgetRefusal,
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";

const PROJECT_ID: string = "863451e2-ca8c-4511-9e8b-322596eea195";

const shed: TelemetryIngestionBudgetRefusal = {
  kind: TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
  scope: TelemetryIngestionBudgetScope.Project,
  signal: ProductType.Metrics,
  message: "refused for a test",
  retryAfterSeconds: 30,
  resetsAt: new Date("2026-11-27T22:00:30Z"),
};

const metricsRequest: () => TelemetryRequest = (): TelemetryRequest => {
  return {
    projectId: new ObjectID(PROJECT_ID),
    body: { resourceMetrics: [] },
    headers: {},
    productType: ProductType.Metrics,
    // As a gate that counted nothing leaves it: the budget is decided.
    telemetryIngestionBudgetCharge: null,
  } as unknown as TelemetryRequest;
};

const addJob: jest.Mock = Queue.addJob as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  getRefusal.mockReturnValue(null);
});

describe("a batch of a project far ahead of the workers", () => {
  test("is refused before its body is stored or its job queued, with the refusal it was given", async () => {
    getRefusal.mockReturnValue(shed);

    const enqueued: Promise<void> =
      TelemetryQueueService.addMetricIngestJob(metricsRequest());

    await expect(enqueued).rejects.toBeInstanceOf(TelemetryIngestShedError);
    await expect(enqueued).rejects.toMatchObject({ refusal: shed });

    expect(storeBody).not.toHaveBeenCalled();
    expect(addJob).not.toHaveBeenCalled();

    const asked: Record<string, unknown> = getRefusal.mock
      .calls[0]![0] as Record<string, unknown>;
    expect((asked["projectId"] as ObjectID).toString()).toBe(PROJECT_ID);
    expect(asked["signal"]).toBe(ProductType.Metrics);
  });

  test("is not an error in the log: the project's flood is logged once where it is decided", async () => {
    getRefusal.mockReturnValue(shed);

    await expect(
      TelemetryQueueService.addMetricIngestJob(metricsRequest()),
    ).rejects.toThrow("refused for a test");

    expect(loggerError).not.toHaveBeenCalled();
  });
});

describe("a batch of any other project", () => {
  test("is queued under an id the sampler reads its project and signal from", async () => {
    await TelemetryQueueService.addMetricIngestJob(metricsRequest());

    expect(addJob).toHaveBeenCalledTimes(1);
    const jobId: string = addJob.mock.calls[0]![1] as string;

    expect(parseQueuedTelemetryJobId(jobId)).toEqual({
      projectId: PROJECT_ID,
      signal: ProductType.Metrics,
    });
  });
});

describe("monitoring work", () => {
  test("a probe's check result is never asked about", async () => {
    await TelemetryQueueService.addProbeIngestJob({
      probeId: ObjectID.generate(),
      probeMonitorResponse: {},
      jobType: "probe-response",
    });

    expect(getRefusal).not.toHaveBeenCalled();
    expect(addJob).toHaveBeenCalledTimes(1);
  });
});

describe("what the sampler reads off a job id", () => {
  /*
   * Only bulk telemetry waits in the set the sampler reads; monitoring work
   * waits outside it, under ids that do not start with its type.
   */
  test.each(Object.values(TelemetryType).filter(isBulkTelemetryType))(
    "a %s job is counted under the signal its budget is",
    (type: TelemetryType) => {
      expect(getTelemetryIngestSheddingSignalForJobType(type)).toBe(
        getTelemetryIngestionBudgetSignalForTelemetryType(type),
      );
    },
  );
});
