import { beforeEach, describe, expect, test } from "@jest/globals";
import * as grpc from "@grpc/grpc-js";
import protobuf from "protobufjs";

/*
 * Telemetry ingestion budgets on the OTLP/gRPC port (issue #5917).
 *
 * The OTLP/gRPC specification makes RESOURCE_EXHAUSTED retryable only when
 * the status details carry a RetryInfo. So a rate refusal carries one, with
 * the delay to come back after, and the exporter retries then; a used-up
 * daily budget carries none, and the exporter drops the batch and logs the
 * message rather than retrying until the reset.
 *
 * An export is counted at its protobuf size - grpc-js has already undone its
 * grpc-encoding when the deserializer runs - so the same telemetry costs the
 * same over gRPC as over OTLP/HTTP protobuf.
 */

jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      getPolicyFromSecretKey: jest.fn(),
      // An accepted export stamps its key as used (issue #7887).
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

import {
  buildIngestionBudgetServiceError,
  getExportMessageSize,
  handleExport,
  recordMessageSizes,
} from "../../FeatureSet/Telemetry/GrpcServer";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  TelemetryIngestionBudgetAdmissionMode,
  TelemetryIngestionBudgetCharge,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionBudget";
import { TelemetryIngestBodySize } from "Common/Server/Utils/Telemetry/TelemetryIngestBodySize";
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

const policy: TelemetryIngestionKeyPolicy = {
  ingestionKeyId: new ObjectID("11111111-1111-4111-8111-111111111161"),
  projectId: new ObjectID("11111111-1111-4111-8111-111111111162"),
  keyType: TelemetryIngestionKeyType.Server,
  allowedOrigins: [],
  pinnedServiceName: null,
  isEnabled: true,
  expiresAt: null,
  requestsPerMinuteLimit: null,
  ingestionBudgets: null,
};

const refusal: (
  kind: TelemetryIngestionBudgetRefusalKind,
) => TelemetryIngestionBudgetRefusal = (
  kind: TelemetryIngestionBudgetRefusalKind,
): TelemetryIngestionBudgetRefusal => {
  return {
    kind: kind,
    scope: TelemetryIngestionBudgetScope.Project,
    signal: ProductType.Traces,
    message:
      kind === TelemetryIngestionBudgetRefusalKind.RateLimited
        ? "This project is sending traces faster than its ingestion rate limit of 5 MB per second. Retry in 4 seconds."
        : "This project's daily traces ingestion budget of 10 GB is used up, so OneUptime is not storing traces from this project until the budget resets at 2026-11-10 00:00 UTC.",
    retryAfterSeconds:
      kind === TelemetryIngestionBudgetRefusalKind.RateLimited ? 4 : null,
    resetsAt: new Date("2026-11-10T00:00:00Z"),
  };
};

const exportCall: (request: Record<string, unknown>) => {
  request: Record<string, unknown>;
  metadata: grpc.Metadata;
} = (
  request: Record<string, unknown>,
): { request: Record<string, unknown>; metadata: grpc.Metadata } => {
  const metadata: grpc.Metadata = new grpc.Metadata();
  metadata.set("x-oneuptime-token", "11111111-1111-4111-8111-111111111163");
  return { request: request, metadata: metadata };
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
  (
    TelemetryIngestionKeyService.getPolicyFromSecretKey as jest.Mock
  ).mockResolvedValue(policy);
  admit.mockResolvedValue({ refusal: null, charge: null });
});

describe("recordMessageSizes", () => {
  test("remembers each decoded request's size on the wire, decompressed, without touching the request", () => {
    const definition: grpc.ServiceDefinition = recordMessageSizes({
      Export: {
        path: "/opentelemetry.proto.collector.trace.v1.TraceService/Export",
        requestStream: false,
        responseStream: false,
        requestSerialize: (value: unknown): Buffer => {
          return Buffer.from(JSON.stringify(value));
        },
        requestDeserialize: (): unknown => {
          return { resourceSpans: [] };
        },
        responseSerialize: (): Buffer => {
          return Buffer.alloc(0);
        },
        responseDeserialize: (): unknown => {
          return {};
        },
      },
    } as unknown as grpc.ServiceDefinition);

    const decoded: unknown = definition["Export"]!.requestDeserialize(
      Buffer.alloc(4321),
    );

    expect(getExportMessageSize(decoded)).toBe(4321);
    expect(Object.keys(decoded as Record<string, unknown>)).toEqual([
      "resourceSpans",
    ]);
    expect(getExportMessageSize({})).toBe(undefined);
    expect(getExportMessageSize(null)).toBe(undefined);
  });
});

describe("buildIngestionBudgetServiceError", () => {
  test("over the rate: RESOURCE_EXHAUSTED with a RetryInfo, which an exporter retries after", () => {
    const error: grpc.ServiceError = buildIngestionBudgetServiceError(
      refusal(TelemetryIngestionBudgetRefusalKind.RateLimited),
    );

    expect(error.code).toBe(grpc.status.RESOURCE_EXHAUSTED);
    expect(error.details).toContain("Retry in 4 seconds");

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

    expect(
      (
        RetryInfoType.toObject(RetryInfoType.decode(details[0]!.value), {
          longs: Number,
        }) as { retry_delay: { seconds: number } }
      ).retry_delay.seconds,
    ).toBe(4);
  });

  test("a used-up daily budget: RESOURCE_EXHAUSTED with no RetryInfo, which an exporter does not retry", () => {
    const error: grpc.ServiceError = buildIngestionBudgetServiceError(
      refusal(TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted),
    );

    expect(error.code).toBe(grpc.status.RESOURCE_EXHAUSTED);
    expect(error.details).toContain("is used up");
    expect(error.metadata.get("grpc-status-details-bin")).toEqual([]);
  });
});

describe("handleExport with ingestion budgets", () => {
  test("counts the export against the key's project and the key, at its protobuf size", async () => {
    const definition: grpc.ServiceDefinition = recordMessageSizes({
      Export: {
        requestDeserialize: (): unknown => {
          return { resourceSpans: [{ big: true }] };
        },
      },
    } as unknown as grpc.ServiceDefinition);
    const request: Record<string, unknown> = definition[
      "Export"
    ]!.requestDeserialize(Buffer.alloc(777)) as Record<string, unknown>;
    const queueFn: jest.Mock = jest.fn().mockResolvedValue(undefined);
    const callback: jest.Mock = jest.fn();

    await handleExport(
      exportCall(request),
      callback,
      ProductType.Traces,
      queueFn,
    );

    expect(admit).toHaveBeenCalledTimes(1);
    const call: Record<string, unknown> = admit.mock.calls[0]![0];
    expect(call["signal"]).toBe(ProductType.Traces);
    expect(call["ingestionKeyPolicy"]).toBe(policy);
    expect(call["mode"]).toBe(TelemetryIngestionBudgetAdmissionMode.Refuse);
    expect((call["measure"] as () => TelemetryIngestBodySize)()).toEqual({
      bytes: 777,
      isExact: true,
    });
    expect(callback).toHaveBeenCalledWith(null, {});
  });

  test("falls back to the JSON size for an export it did not see decoded", async () => {
    const request: Record<string, unknown> = { resourceLogs: [] };
    const callback: jest.Mock = jest.fn();

    await handleExport(
      exportCall(request),
      callback,
      ProductType.Logs,
      jest.fn().mockResolvedValue(undefined) as never,
    );

    expect(
      (admit.mock.calls[0]![0]["measure"] as () => TelemetryIngestBodySize)(),
    ).toEqual({ bytes: JSON.stringify(request).length, isExact: true });
  });

  test("hands the charge to the queue, so it is not counted twice", async () => {
    const charge: TelemetryIngestionBudgetCharge = {
      projectId: policy.projectId.toString(),
      signal: ProductType.Metrics,
      dayId: "20261109T0000Z",
      dayTtlSeconds: 100,
      countedBytes: 10,
      isExact: true,
      isPending: false,
      scopes: [],
    };
    admit.mockResolvedValue({ refusal: null, charge: charge });
    const queueFn: jest.Mock = jest.fn().mockResolvedValue(undefined);

    await handleExport(
      exportCall({ resourceMetrics: [] }),
      jest.fn(),
      ProductType.Metrics,
      queueFn,
    );

    const queued: TelemetryRequest = queueFn.mock.calls[0]![0];
    expect(queued.telemetryIngestionBudgetCharge).toBe(charge);
    // The policy is not attached: this port has never pinned service.name.
    expect(queued.ingestionKeyPolicy).toBeUndefined();
  });

  test("refuses a used-up budget without queueing the export", async () => {
    admit.mockResolvedValue({
      refusal: refusal(
        TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted,
      ),
      charge: null,
    });
    const queueFn: jest.Mock = jest.fn().mockResolvedValue(undefined);
    const callback: jest.Mock = jest.fn();

    await handleExport(
      exportCall({ resourceSpans: [] }),
      callback,
      ProductType.Traces,
      queueFn,
    );

    expect(queueFn).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledTimes(1);
    expect((callback.mock.calls[0]![0] as grpc.ServiceError).code).toBe(
      grpc.status.RESOURCE_EXHAUSTED,
    );
  });

  test("refuses over the rate with a RetryInfo, without queueing the export", async () => {
    admit.mockResolvedValue({
      refusal: refusal(TelemetryIngestionBudgetRefusalKind.RateLimited),
      charge: null,
    });
    const queueFn: jest.Mock = jest.fn().mockResolvedValue(undefined);
    const callback: jest.Mock = jest.fn();

    await handleExport(
      exportCall({ resourceSpans: [] }),
      callback,
      ProductType.Traces,
      queueFn,
    );

    expect(queueFn).not.toHaveBeenCalled();
    const error: grpc.ServiceError = callback.mock.calls[0]![0];
    expect(error.metadata.get("grpc-status-details-bin")).toHaveLength(1);
  });

  test("never asks the budget about a credential it refuses", async () => {
    (
      TelemetryIngestionKeyService.getPolicyFromSecretKey as jest.Mock
    ).mockResolvedValue(null);
    const callback: jest.Mock = jest.fn();

    await handleExport(
      exportCall({}),
      callback,
      ProductType.Logs,
      jest.fn() as never,
    );

    expect(admit).not.toHaveBeenCalled();
    expect((callback.mock.calls[0]![0] as grpc.ServiceError).code).toBe(
      grpc.status.UNAUTHENTICATED,
    );
  });
});
