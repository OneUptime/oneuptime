import { beforeEach, describe, expect, test } from "@jest/globals";
import * as grpc from "@grpc/grpc-js";
import protobuf from "protobufjs";

/*
 * TelemetryIngestShedding on the OTLP/gRPC port (2026-11-27): a project far
 * ahead of the workers is answered RESOURCE_EXHAUSTED with a RetryInfo -
 * the one RESOURCE_EXHAUSTED the OTLP/gRPC specification has an exporter
 * retry - before its budget is asked or its export queued. Whom to refuse
 * is mocked here; TelemetryIngestShedding is tested on its own.
 */

jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      getPolicyFromSecretKey: jest.fn(),
      markUsed: (): Promise<void> => {
        return Promise.resolve();
      },
    },
  };
});
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {},
    QueueName: { Telemetry: "Telemetry" },
  };
});

const admit: jest.Mock = jest.fn();
jest.mock("Common/Server/Utils/Telemetry/TelemetryIngestionBudget", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Telemetry/TelemetryIngestionBudget",
  ) as Record<string, unknown>;

  return { __esModule: true, ...actual, default: { admit } };
});

const record: jest.Mock = jest.fn();
jest.mock(
  "Common/Server/Utils/Telemetry/TelemetryIngestRefusalRecorder",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "Common/Server/Utils/Telemetry/TelemetryIngestRefusalRecorder",
    ) as Record<string, unknown>;

    return { __esModule: true, ...actual, default: { record } };
  },
);

const getRefusal: jest.Mock = jest.fn();
jest.mock("Common/Server/Utils/Telemetry/TelemetryIngestShedding", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Telemetry/TelemetryIngestShedding",
  ) as Record<string, unknown>;

  return { __esModule: true, ...actual, default: { getRefusal } };
});

import {
  buildIngestionBudgetServiceError,
  handleExport,
} from "../../FeatureSet/Telemetry/GrpcServer";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { RETRY_INFO_TYPE_URL } from "Common/Server/Utils/Telemetry/GoogleRpcStatus";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import {
  TelemetryIngestionBudgetRefusal,
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import { TelemetryIngestRefusalReason } from "Common/Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";

const STATUS_ROOT: protobuf.Root = protobuf.Root.fromJSON({
  nested: {
    Status: {
      fields: {
        code: { type: "int32", id: 1 },
        message: { type: "string", id: 2 },
        details: { rule: "repeated", type: "Any", id: 3 },
      },
    },
    Any: {
      fields: {
        type_url: { type: "string", id: 1 },
        value: { type: "bytes", id: 2 },
      },
    },
    RetryInfo: { fields: { retry_delay: { type: "Duration", id: 1 } } },
    Duration: {
      fields: {
        seconds: { type: "int64", id: 1 },
        nanos: { type: "int32", id: 2 },
      },
    },
  },
});

const PROJECT_ID: string = "863451e2-ca8c-4511-9e8b-322596eea195";

const policy: TelemetryIngestionKeyPolicy = {
  ingestionKeyId: new ObjectID("11111111-1111-4111-8111-111111111171"),
  projectId: new ObjectID(PROJECT_ID),
  keyType: TelemetryIngestionKeyType.Server,
  allowedOrigins: [],
  pinnedServiceName: null,
  isEnabled: true,
  expiresAt: null,
  requestsPerMinuteLimit: null,
  ingestionBudgets: null,
};

const shed: TelemetryIngestionBudgetRefusal = {
  kind: TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
  scope: TelemetryIngestionBudgetScope.Project,
  signal: ProductType.Metrics,
  message:
    "OneUptime has not yet stored the metrics this project already sent: about 651,000 batches are waiting, and a project may have 10,000 waiting. Retry in 30 seconds.",
  retryAfterSeconds: 30,
  resetsAt: new Date("2026-11-27T22:00:30Z"),
};

const exportCall: (request: Record<string, unknown>) => {
  request: Record<string, unknown>;
  metadata: grpc.Metadata;
} = (
  request: Record<string, unknown>,
): { request: Record<string, unknown>; metadata: grpc.Metadata } => {
  const metadata: grpc.Metadata = new grpc.Metadata();
  metadata.set("x-oneuptime-token", "11111111-1111-4111-8111-111111111173");
  return { request: request, metadata: metadata };
};

const retryDelaySeconds: (error: grpc.ServiceError) => number = (
  error: grpc.ServiceError,
): number => {
  const detailsBin: Array<grpc.MetadataValue> = error.metadata.get(
    "grpc-status-details-bin",
  );
  expect(detailsBin).toHaveLength(1);

  const StatusType: protobuf.Type = STATUS_ROOT.lookupType("Status");
  const status: Record<string, unknown> = StatusType.toObject(
    StatusType.decode(detailsBin[0] as Buffer),
    { longs: Number },
  );
  expect(status["code"]).toBe(grpc.status.RESOURCE_EXHAUSTED);

  const details: Array<{ type_url: string; value: Uint8Array }> = status[
    "details"
  ] as Array<{ type_url: string; value: Uint8Array }>;
  expect(details[0]!.type_url).toBe(RETRY_INFO_TYPE_URL);

  const RetryInfoType: protobuf.Type = STATUS_ROOT.lookupType("RetryInfo");

  return (
    RetryInfoType.toObject(RetryInfoType.decode(details[0]!.value), {
      longs: Number,
    }) as { retry_delay: { seconds: number } }
  ).retry_delay.seconds;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
  (
    TelemetryIngestionKeyService.getPolicyFromSecretKey as jest.Mock
  ).mockResolvedValue(policy);
  admit.mockResolvedValue({ refusal: null, charge: null });
  getRefusal.mockReturnValue(null);
});

describe("buildIngestionBudgetServiceError for a project far ahead of the workers", () => {
  test("RESOURCE_EXHAUSTED with a RetryInfo of the refusal's delay, which an exporter retries after", () => {
    const error: grpc.ServiceError = buildIngestionBudgetServiceError(shed);

    expect(error.code).toBe(grpc.status.RESOURCE_EXHAUSTED);
    expect(error.details).toContain("Retry in 30 seconds");
    expect(retryDelaySeconds(error)).toBe(30);
  });
});

describe("handleExport", () => {
  test("refuses the project's metrics with a RetryInfo, before asking its budget or queueing the export", async () => {
    getRefusal.mockReturnValue(shed);
    const queueFn: jest.Mock = jest.fn().mockResolvedValue(undefined);
    const callback: jest.Mock = jest.fn();

    await handleExport(
      exportCall({ resourceMetrics: [] }),
      callback,
      ProductType.Metrics,
      queueFn,
    );

    expect(queueFn).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();

    const asked: Record<string, unknown> = getRefusal.mock
      .calls[0]![0] as Record<string, unknown>;
    expect((asked["projectId"] as ObjectID).toString()).toBe(PROJECT_ID);
    expect(asked["signal"]).toBe(ProductType.Metrics);

    const error: grpc.ServiceError = callback.mock.calls[0]![0];
    expect(error.code).toBe(grpc.status.RESOURCE_EXHAUSTED);
    expect(retryDelaySeconds(error)).toBe(30);

    /*
     * Counted against the key (#11440) under the signal's own surface:
     * this one port carries every signal, and the project's pages tell
     * the refusals by signal.
     */
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      projectId: policy.projectId,
      ingestionKeyId: policy.ingestionKeyId,
      reason: TelemetryIngestRefusalReason.QueueBacklogged,
      surface: TelemetryIngestSurface.OtelMetrics,
    });
  });

  test.each([
    [ProductType.Logs, TelemetryIngestSurface.OtelLogs],
    [ProductType.Traces, TelemetryIngestSurface.OtelTraces],
    [ProductType.Profiles, TelemetryIngestSurface.OtelProfiles],
  ])(
    "a refused %s export is counted under %s, not the gRPC port",
    async (signal: ProductType, surface: TelemetryIngestSurface) => {
      getRefusal.mockReturnValue({
        ...shed,
        kind: TelemetryIngestionBudgetRefusalKind.QueueFull,
        signal: signal,
      });

      await handleExport(exportCall({}), jest.fn(), signal as never, jest.fn());

      expect(record).toHaveBeenCalledWith({
        projectId: policy.projectId,
        ingestionKeyId: policy.ingestionKeyId,
        reason: TelemetryIngestRefusalReason.QueueFull,
        surface: surface,
      });
      expect(
        (record.mock.calls[0]![0] as Record<string, unknown>)["surface"],
      ).not.toBe(TelemetryIngestSurface.Grpc);
    },
  );

  test("a project that is not refused goes on to its budget and the queue", async () => {
    const queueFn: jest.Mock = jest.fn().mockResolvedValue(undefined);
    const callback: jest.Mock = jest.fn();

    await handleExport(
      exportCall({ resourceSpans: [] }),
      callback,
      ProductType.Traces,
      queueFn,
    );

    expect(getRefusal).toHaveBeenCalledTimes(1);
    expect(admit).toHaveBeenCalledTimes(1);
    expect(queueFn).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(null, {});
    expect(record).not.toHaveBeenCalled();
  });

  test("never asks about a credential it refuses", async () => {
    (
      TelemetryIngestionKeyService.getPolicyFromSecretKey as jest.Mock
    ).mockResolvedValue(null);
    const callback: jest.Mock = jest.fn();

    await handleExport(
      exportCall({ resourceLogs: [] }),
      callback,
      ProductType.Logs,
      jest.fn(),
    );

    expect(getRefusal).not.toHaveBeenCalled();
  });
});
