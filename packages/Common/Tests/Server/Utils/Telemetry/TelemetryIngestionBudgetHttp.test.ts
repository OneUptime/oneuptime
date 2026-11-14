import { describe, expect, jest, test } from "@jest/globals";
import protobuf from "protobufjs";
import zlib from "zlib";
import {
  encodeGoogleRpcStatus,
  encodeRetryInfo,
  GRPC_RESOURCE_EXHAUSTED_CODE,
  RETRY_INFO_TYPE_URL,
} from "../../../../Server/Utils/Telemetry/GoogleRpcStatus";
import {
  DEFERRED_BODY_SURFACES,
  getTelemetryIngestionBudgetHttpStatus,
  getTelemetryIngestionBudgetSignalForSurface,
  measureTelemetryIngestRequest,
  OTLP_HTTP_SURFACES,
  RAW_BODY_SURFACES,
  sendTelemetryIngestionBudgetRefusal,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetHttp";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import {
  TelemetryIngestionBudgetRefusal,
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
} from "../../../../Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestSurface from "../../../../Types/Telemetry/TelemetryIngestSurface";

/*
 * What an ingestion budget refusal looks like on the wire over HTTP (issue
 * #5917), and which surfaces are budgeted at all.
 *
 * The OTLP/HTTP specification retries only 429, 502, 503 and 504, and asks
 * every error body to be a google.rpc.Status (protobuf for a protobuf
 * request). So a rate refusal is a 429 with Retry-After, a used-up daily
 * budget is a 403 an exporter will not retry, and both carry a Status whose
 * message a collector prints. The Status is decoded here with protobufjs
 * from google.rpc's own field definitions, not with the encoder's mirror.
 */

const STATUS_ROOT: protobuf.Root = protobuf.Root.fromJSON({
  nested: {
    google: {
      nested: {
        rpc: {
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
            RetryInfo: {
              fields: { retry_delay: { type: "Duration", id: 1 } },
            },
            Duration: {
              fields: {
                seconds: { type: "int64", id: 1 },
                nanos: { type: "int32", id: 2 },
              },
            },
          },
        },
      },
    },
  },
});

const StatusType: protobuf.Type = STATUS_ROOT.lookupType("google.rpc.Status");
const RetryInfoType: protobuf.Type = STATUS_ROOT.lookupType(
  "google.rpc.RetryInfo",
);

interface DecodedStatus {
  code: number;
  message: string;
  details?: Array<{ type_url: string; value: Uint8Array }>;
}

const decodeStatus: (bytes: Buffer) => DecodedStatus = (
  bytes: Buffer,
): DecodedStatus => {
  return StatusType.toObject(StatusType.decode(bytes), {
    longs: Number,
    defaults: false,
  }) as unknown as DecodedStatus;
};

interface FakeResponse {
  statusCode: number | null;
  headers: Record<string, string>;
  body: unknown;
  headersSent: boolean;
}

const fakeResponse: (headersSent?: boolean) => {
  res: ExpressResponse;
  state: FakeResponse;
} = (
  headersSent: boolean = false,
): { res: ExpressResponse; state: FakeResponse } => {
  const state: FakeResponse = {
    statusCode: null,
    headers: {},
    body: undefined,
    headersSent: headersSent,
  };

  const res: Record<string, unknown> = {
    headersSent: headersSent,
    setHeader: (name: string, value: string): void => {
      state.headers[name] = value;
    },
    status: (code: number): Record<string, unknown> => {
      state.statusCode = code;
      return res;
    },
    send: (body: unknown): Record<string, unknown> => {
      state.body = body;
      return res;
    },
    json: (body: unknown): Record<string, unknown> => {
      state.body = body;
      return res;
    },
  };

  return { res: res as unknown as ExpressResponse, state: state };
};

const request: (
  headers?: Record<string, string>,
  body?: unknown,
  rawBody?: string,
) => ExpressRequest = (
  headers: Record<string, string> = {},
  body?: unknown,
  rawBody?: string,
): ExpressRequest => {
  return {
    headers: headers,
    body: body,
    rawBody: rawBody,
  } as unknown as ExpressRequest;
};

const daily: TelemetryIngestionBudgetRefusal = {
  kind: TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted,
  scope: TelemetryIngestionBudgetScope.Project,
  signal: ProductType.Logs,
  message:
    "This project's daily logs ingestion budget of 10 GB is used up, so OneUptime is not storing logs from this project until the budget resets at 2026-11-10 00:00 UTC.",
  retryAfterSeconds: null,
  resetsAt: new Date("2026-11-10T00:00:00Z"),
};

const rate: TelemetryIngestionBudgetRefusal = {
  kind: TelemetryIngestionBudgetRefusalKind.RateLimited,
  scope: TelemetryIngestionBudgetScope.IngestionKey,
  signal: ProductType.Traces,
  message:
    "This ingestion key is sending traces faster than its ingestion rate limit of 5 MB per second. Retry in 4 seconds.",
  retryAfterSeconds: 4,
  resetsAt: new Date("2026-11-10T00:00:00Z"),
};

describe("which surfaces are budgeted", () => {
  test("every surface that carries a budgeted signal maps to it", () => {
    expect(
      getTelemetryIngestionBudgetSignalForSurface(
        TelemetryIngestSurface.OtelTraces,
      ),
    ).toBe(ProductType.Traces);
    expect(
      getTelemetryIngestionBudgetSignalForSurface(
        TelemetryIngestSurface.OtelLogs,
      ),
    ).toBe(ProductType.Logs);
    expect(
      getTelemetryIngestionBudgetSignalForSurface(
        TelemetryIngestSurface.OtelMetrics,
      ),
    ).toBe(ProductType.Metrics);
    expect(
      getTelemetryIngestionBudgetSignalForSurface(
        TelemetryIngestSurface.OtelProfiles,
      ),
    ).toBe(ProductType.Profiles);

    for (const surface of [
      TelemetryIngestSurface.Fluent,
      TelemetryIngestSurface.Syslog,
      TelemetryIngestSurface.VercelLogDrain,
    ]) {
      expect(getTelemetryIngestionBudgetSignalForSurface(surface)).toBe(
        ProductType.Logs,
      );
    }

    expect(
      getTelemetryIngestionBudgetSignalForSurface(
        TelemetryIngestSurface.Pyroscope,
      ),
    ).toBe(ProductType.Profiles);
    expect(
      getTelemetryIngestionBudgetSignalForSurface(
        TelemetryIngestSurface.SecurityEvents,
      ),
    ).toBe(ProductType.SecurityEvents);

    // The compatible endpoints that only ever carry one signal.
    expect(
      getTelemetryIngestionBudgetSignalForSurface(
        TelemetryIngestSurface.PrometheusRemoteWrite,
      ),
    ).toBe(ProductType.Metrics);
    expect(
      getTelemetryIngestionBudgetSignalForSurface(TelemetryIngestSurface.Loki),
    ).toBe(ProductType.Logs);
  });

  test("a compatible endpoint whose requests carry several signals is budgeted per signal as it is queued, not at the door", () => {
    for (const surface of [
      TelemetryIngestSurface.SplunkHec,
      TelemetryIngestSurface.Datadog,
      TelemetryIngestSurface.Sentry,
    ]) {
      expect(getTelemetryIngestionBudgetSignalForSurface(surface)).toBe(null);
    }
  });

  test("surfaces that are not telemetry signals - or have budgets of their own - are not budgeted", () => {
    for (const surface of [
      TelemetryIngestSurface.SessionReplay,
      TelemetryIngestSurface.SourceMap,
      TelemetryIngestSurface.KubernetesCost,
      TelemetryIngestSurface.ChangeEvents,
      TelemetryIngestSurface.OpenLineage,
      TelemetryIngestSurface.DbtArtifacts,
      TelemetryIngestSurface.SyncWebhooks,
      TelemetryIngestSurface.KubernetesAgentRunner,
      TelemetryIngestSurface.KubernetesAiAgent,
      TelemetryIngestSurface.ResourceAiAgent,
      TelemetryIngestSurface.HostCollectorManagement,
    ]) {
      expect(getTelemetryIngestionBudgetSignalForSurface(surface)).toBe(null);
    }

    expect(getTelemetryIngestionBudgetSignalForSurface(null)).toBe(null);
  });

  test("names the OTLP routes, the raw-body surfaces and the one sized later", () => {
    expect(Array.from(OTLP_HTTP_SURFACES).sort()).toEqual(
      [
        TelemetryIngestSurface.OtelLogs,
        TelemetryIngestSurface.OtelMetrics,
        TelemetryIngestSurface.OtelProfiles,
        TelemetryIngestSurface.OtelTraces,
      ].sort(),
    );
    expect(RAW_BODY_SURFACES.has(TelemetryIngestSurface.VercelLogDrain)).toBe(
      true,
    );
    expect(RAW_BODY_SURFACES.has(TelemetryIngestSurface.Fluent)).toBe(false);
    expect(Array.from(DEFERRED_BODY_SURFACES)).toEqual([
      TelemetryIngestSurface.Pyroscope,
      // Snappy bodies, read after the key check: sized as they are queued.
      TelemetryIngestSurface.PrometheusRemoteWrite,
      TelemetryIngestSurface.Loki,
    ]);
    expect(
      RAW_BODY_SURFACES.has(TelemetryIngestSurface.PrometheusRemoteWrite),
    ).toBe(false);
  });
});

describe("measureTelemetryIngestRequest", () => {
  test("sizes a raw OTLP body from its content coding", () => {
    const plain: Buffer = Buffer.from("x".repeat(10_000));

    expect(
      measureTelemetryIngestRequest({
        req: request({ "content-encoding": "gzip" }, zlib.gzipSync(plain)),
        surface: TelemetryIngestSurface.OtelLogs,
      }),
    ).toEqual({ bytes: 10_000, isExact: false });

    expect(
      measureTelemetryIngestRequest({
        req: request({}, plain),
        surface: TelemetryIngestSurface.OtelTraces,
      }),
    ).toEqual({ bytes: 10_000, isExact: true });
  });

  test("sizes a body the global parsers read from its raw text", () => {
    const rawBody: string = JSON.stringify([{ log: "hello" }]);

    expect(
      measureTelemetryIngestRequest({
        req: request(
          { "content-encoding": "gzip" },
          JSON.parse(rawBody),
          rawBody,
        ),
        surface: TelemetryIngestSurface.Fluent,
      }),
    ).toEqual({ bytes: rawBody.length, isExact: true });
  });

  test("sizes an already-decompressed Fluent buffer as it is, whatever the header says", () => {
    expect(
      measureTelemetryIngestRequest({
        req: request({ "content-encoding": "gzip" }, Buffer.alloc(5000)),
        surface: TelemetryIngestSurface.Syslog,
      }),
    ).toEqual({ bytes: 5000, isExact: true });
  });
});

describe("sendTelemetryIngestionBudgetRefusal", () => {
  test("answers a used-up budget 403, with a protobuf Status a collector prints", () => {
    const { res, state } = fakeResponse();

    sendTelemetryIngestionBudgetRefusal({
      req: request({ "content-type": "application/x-protobuf" }),
      res: res,
      refusal: daily,
      surface: TelemetryIngestSurface.OtelLogs,
    });

    expect(state.statusCode).toBe(403);
    expect(state.headers["Content-Type"]).toBe("application/x-protobuf");
    expect(state.headers["Retry-After"]).toBeUndefined();

    const status: DecodedStatus = decodeStatus(state.body as Buffer);

    expect(status.code).toBe(GRPC_RESOURCE_EXHAUSTED_CODE);
    expect(status.message).toBe(daily.message);
    expect(status.details ?? []).toEqual([]);
  });

  test("answers a protobuf request with no content type as protobuf, as OTLP does", () => {
    const { res, state } = fakeResponse();

    sendTelemetryIngestionBudgetRefusal({
      req: request({}),
      res: res,
      refusal: daily,
      surface: TelemetryIngestSurface.OtelTraces,
    });

    expect(decodeStatus(state.body as Buffer).message).toBe(daily.message);
  });

  test("answers an OTLP/JSON request with a JSON Status", () => {
    const { res, state } = fakeResponse();

    sendTelemetryIngestionBudgetRefusal({
      req: request({ "content-type": "application/json" }),
      res: res,
      refusal: daily,
      surface: TelemetryIngestSurface.OtelMetrics,
    });

    expect(state.statusCode).toBe(403);
    expect(state.body).toEqual({
      code: GRPC_RESOURCE_EXHAUSTED_CODE,
      message: daily.message,
    });
  });

  test("answers an over-rate request 429 with Retry-After, which exporters honour and retry", () => {
    const { res, state } = fakeResponse();

    sendTelemetryIngestionBudgetRefusal({
      req: request({ "content-type": "application/x-protobuf" }),
      res: res,
      refusal: rate,
      surface: TelemetryIngestSurface.OtelTraces,
    });

    expect(state.statusCode).toBe(429);
    expect(state.headers["Retry-After"]).toBe("4");
    expect(decodeStatus(state.body as Buffer).message).toBe(rate.message);
  });

  test("answers every other surface with the JSON its other refusals use", () => {
    const { res, state } = fakeResponse();

    sendTelemetryIngestionBudgetRefusal({
      req: request({ "content-type": "application/json" }),
      res: res,
      refusal: rate,
      surface: TelemetryIngestSurface.Fluent,
    });

    expect(state.statusCode).toBe(429);
    expect(state.headers["Retry-After"]).toBe("4");
    expect(state.body).toEqual({
      error: "rate-limited",
      message: rate.message,
      resetsAt: "2026-11-10T00:00:00.000Z",
      retryAfterSeconds: 4,
    });

    const daily403: { res: ExpressResponse; state: FakeResponse } =
      fakeResponse();

    sendTelemetryIngestionBudgetRefusal({
      req: request({}),
      res: daily403.res,
      refusal: daily,
      surface: TelemetryIngestSurface.SecurityEvents,
    });

    expect(daily403.state.statusCode).toBe(403);
    expect(daily403.state.body).toEqual({
      error: "daily-budget-exhausted",
      message: daily.message,
      resetsAt: "2026-11-10T00:00:00.000Z",
    });
  });

  test("writes nothing to a response already sent", () => {
    const { res, state } = fakeResponse(true);

    sendTelemetryIngestionBudgetRefusal({
      req: request({}),
      res: res,
      refusal: daily,
      surface: TelemetryIngestSurface.OtelLogs,
    });

    expect(state.statusCode).toBe(null);
  });

  test("does not throw on a response with no setHeader, as unit tests hand the middleware", () => {
    const res: Record<string, unknown> = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    expect(() => {
      sendTelemetryIngestionBudgetRefusal({
        req: request({}),
        res: res as unknown as ExpressResponse,
        refusal: rate,
        surface: TelemetryIngestSurface.Syslog,
      });
    }).not.toThrow();
    expect(res["status"]).toHaveBeenCalledWith(429);
  });

  test("maps the refusal kinds to their statuses", () => {
    expect(getTelemetryIngestionBudgetHttpStatus(daily)).toBe(403);
    expect(getTelemetryIngestionBudgetHttpStatus(rate)).toBe(429);
  });
});

describe("google.rpc.Status encoding", () => {
  test("carries a RetryInfo when asked, which the gRPC status details hold", () => {
    const status: DecodedStatus = decodeStatus(
      encodeGoogleRpcStatus({
        code: 8,
        message: "slow down",
        retryDelaySeconds: 7,
      }),
    );

    expect(status.code).toBe(8);
    expect(status.message).toBe("slow down");
    expect(status.details).toHaveLength(1);
    expect(status.details![0]!.type_url).toBe(RETRY_INFO_TYPE_URL);

    const retryInfo: { retry_delay: { seconds: number } } =
      RetryInfoType.toObject(RetryInfoType.decode(status.details![0]!.value), {
        longs: Number,
      }) as unknown as { retry_delay: { seconds: number } };

    expect(retryInfo.retry_delay.seconds).toBe(7);
  });

  test("encodes long and non-ASCII messages, and large delays", () => {
    const message: string = `Budget ☕ ${"x".repeat(5000)}`;
    const status: DecodedStatus = decodeStatus(
      encodeGoogleRpcStatus({ code: 8, message: message }),
    );

    expect(status.message).toBe(message);

    const retryInfo: { retry_delay: { seconds: number } } =
      RetryInfoType.toObject(RetryInfoType.decode(encodeRetryInfo(86_400)), {
        longs: Number,
      }) as unknown as { retry_delay: { seconds: number } };

    expect(retryInfo.retry_delay.seconds).toBe(86_400);
  });
});
