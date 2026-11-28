import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The ingest middleware's half of TelemetryIngestShedding (2026-11-27): a
 * project far ahead of the workers is answered 429 on its own, before its
 * body is read - the OTLP routes with the google.rpc.Status the
 * specification asks for, the others with JSON - while every other request
 * goes on to its budget and its route. Whom to refuse is mocked here
 * (TelemetryIngestShedding is tested on its own); what is under test is the
 * middleware around it.
 */

jest.mock("../../../Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      getPolicyFromSecretKey: jest.fn(),
      markUsed: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Telemetry/TelemetryIngestionBudget", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Telemetry/TelemetryIngestionBudget",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: {
      admit: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Telemetry/TelemetryIngestShedding", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Telemetry/TelemetryIngestShedding",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: {
      getRefusal: jest.fn(),
    },
  };
});

jest.mock(
  "../../../Server/Utils/Telemetry/TelemetryIngestRefusalRecorder",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../Server/Utils/Telemetry/TelemetryIngestRefusalRecorder",
    ) as Record<string, unknown>;

    return {
      __esModule: true,
      ...actual,
      default: {
        record: jest.fn(),
      },
    };
  },
);

import TelemetryIngest from "../../../Server/Middleware/TelemetryIngest";
import TelemetryIngestionKeyService from "../../../Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionBudget from "../../../Server/Utils/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestShedding from "../../../Server/Utils/Telemetry/TelemetryIngestShedding";
import TelemetryIngestRefusalRecorder from "../../../Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  RequestHandler,
} from "../../../Server/Utils/Express";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import {
  TelemetryIngestionBudgetRefusal,
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionKeyPolicy from "../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";

type MockFn = jest.Mock;

const PROJECT_ID: string = "863451e2-ca8c-4511-9e8b-322596eea195";
const KEY_ID: string = "5d3b0f1a-0000-4000-8000-000000000082";
const TOKEN: string = "5d3b0f1a-0000-4000-8000-000000000083";

const getRefusal: MockFn =
  TelemetryIngestShedding.getRefusal as unknown as MockFn;
const admit: MockFn = TelemetryIngestionBudget.admit as unknown as MockFn;

const policy: TelemetryIngestionKeyPolicy = {
  ingestionKeyId: new ObjectID(KEY_ID),
  projectId: new ObjectID(PROJECT_ID),
  keyType: TelemetryIngestionKeyType.Server,
  allowedOrigins: [],
  pinnedServiceName: null,
  isEnabled: true,
  expiresAt: null,
  requestsPerMinuteLimit: null,
  ingestionBudgets: null,
};

const shed: (signal: ProductType) => TelemetryIngestionBudgetRefusal = (
  signal: ProductType,
): TelemetryIngestionBudgetRefusal => {
  return {
    kind: TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
    scope: TelemetryIngestionBudgetScope.Project,
    signal: signal as never,
    message:
      "OneUptime has not yet stored the metrics this project already sent: about 651,000 batches are waiting, and a project may have 10,000 waiting. Retry in 30 seconds.",
    retryAfterSeconds: 30,
    resetsAt: new Date("2026-11-27T22:00:30Z"),
  };
};

interface Sent {
  status: number | null;
  headers: Record<string, string>;
  body: unknown;
}

interface RunResult {
  next: MockFn;
  readBody: MockFn;
  sent: Sent;
}

const run: (
  surface: TelemetryIngestSurface,
  data?: { headers?: Record<string, string>; body?: unknown },
) => Promise<RunResult> = async (
  surface: TelemetryIngestSurface,
  data?: { headers?: Record<string, string>; body?: unknown },
): Promise<RunResult> => {
  const req: ExpressRequest = {
    headers: { "x-oneuptime-token": TOKEN, ...(data?.headers || {}) },
    body: data?.body,
    id: "test-request-id",
  } as unknown as ExpressRequest;

  const sent: Sent = { status: null, headers: {}, body: undefined };
  const res: Record<string, unknown> = {
    headersSent: false,
    setHeader: (name: string, value: string): void => {
      sent.headers[name] = value;
    },
    status: (code: number): Record<string, unknown> => {
      sent.status = code;
      return res;
    },
    send: (body: unknown): Record<string, unknown> => {
      sent.body = body;
      return res;
    },
    json: (body: unknown): Record<string, unknown> => {
      sent.body = body;
      return res;
    },
  };
  const next: MockFn = jest.fn() as unknown as MockFn;
  const readBody: MockFn = jest.fn(
    (_req: unknown, _res: unknown, done: (err?: unknown) => void): void => {
      done();
    },
  ) as unknown as MockFn;

  await TelemetryIngest.forSurface(
    surface,
    readBody as unknown as RequestHandler,
  )(req, res as unknown as ExpressResponse, next as unknown as NextFunction);

  return { next: next, readBody: readBody, sent: sent };
};

beforeEach(() => {
  jest.clearAllMocks();
  (
    TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn
  ).mockResolvedValue(policy as never);
  (TelemetryIngestionKeyService.markUsed as MockFn).mockResolvedValue(
    undefined as never,
  );
  admit.mockResolvedValue({ refusal: null, charge: null } as never);
  getRefusal.mockReturnValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a project far ahead of the workers", () => {
  test("OTLP metrics over protobuf: 429 with Retry-After and a google.rpc.Status, its body never read", async () => {
    getRefusal.mockReturnValue(shed(ProductType.Metrics));

    const result: RunResult = await run(TelemetryIngestSurface.OtelMetrics, {
      headers: { "content-type": "application/x-protobuf" },
    });

    expect(result.next).not.toHaveBeenCalled();
    expect(result.readBody).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();

    expect(result.sent.status).toBe(429);
    expect(result.sent.headers["Retry-After"]).toBe("30");
    expect(result.sent.headers["Content-Type"]).toBe("application/x-protobuf");
    expect(Buffer.isBuffer(result.sent.body)).toBe(true);
    expect((result.sent.body as Buffer).toString("utf8")).toContain(
      "about 651,000 batches are waiting",
    );

    // Asked for the key's project and the surface's signal.
    expect(getRefusal).toHaveBeenCalledTimes(1);
    const asked: Record<string, unknown> = getRefusal.mock
      .calls[0]![0] as Record<string, unknown>;
    expect((asked["projectId"] as ObjectID).toString()).toBe(PROJECT_ID);
    expect(asked["signal"]).toBe(ProductType.Metrics);

    // Not a refusal of the key: nothing to put right on its page.
    expect(TelemetryIngestRefusalRecorder.record).not.toHaveBeenCalled();
    expect(TelemetryIngestionKeyService.markUsed).not.toHaveBeenCalled();
  });

  test("OTLP over JSON: 429 with the Status as JSON", async () => {
    getRefusal.mockReturnValue(shed(ProductType.Logs));

    const result: RunResult = await run(TelemetryIngestSurface.OtelLogs, {
      headers: { "content-type": "application/json" },
    });

    expect(result.sent.status).toBe(429);
    expect(result.sent.headers["Retry-After"]).toBe("30");
    expect(result.sent.body).toEqual({
      code: 8,
      message: shed(ProductType.Logs).message,
    });
  });

  test("Fluent: 429 with the JSON its other refusals use", async () => {
    getRefusal.mockReturnValue(shed(ProductType.Logs));

    const result: RunResult = await run(TelemetryIngestSurface.Fluent);

    expect(result.next).not.toHaveBeenCalled();
    expect(result.sent.status).toBe(429);
    expect(result.sent.headers["Retry-After"]).toBe("30");
    expect(result.sent.body).toEqual({
      error: "queue-backlogged",
      message: shed(ProductType.Logs).message,
      resetsAt: "2026-11-27T22:00:30.000Z",
      retryAfterSeconds: 30,
    });
  });

  test.each([
    [TelemetryIngestSurface.OtelTraces, ProductType.Traces],
    [TelemetryIngestSurface.OtelLogs, ProductType.Logs],
    [TelemetryIngestSurface.OtelMetrics, ProductType.Metrics],
    [TelemetryIngestSurface.OtelProfiles, ProductType.Profiles],
    [TelemetryIngestSurface.Syslog, ProductType.Logs],
    [TelemetryIngestSurface.VercelLogDrain, ProductType.Logs],
    [TelemetryIngestSurface.Pyroscope, ProductType.Profiles],
    [TelemetryIngestSurface.SecurityEvents, ProductType.SecurityEvents],
    [TelemetryIngestSurface.PrometheusRemoteWrite, ProductType.Metrics],
    [TelemetryIngestSurface.Loki, ProductType.Logs],
  ])(
    "%s is asked about its %s",
    async (surface: TelemetryIngestSurface, signal: ProductType) => {
      await run(surface);

      expect(
        (getRefusal.mock.calls[0]![0] as Record<string, unknown>)["signal"],
      ).toBe(signal);
    },
  );
});

describe("everyone else", () => {
  test("a project that is not refused goes on to its budget, its body and its route", async () => {
    const result: RunResult = await run(TelemetryIngestSurface.OtelMetrics, {
      body: Buffer.alloc(1),
    });

    expect(getRefusal).toHaveBeenCalledTimes(1);
    expect(result.readBody).toHaveBeenCalledTimes(1);
    expect(admit).toHaveBeenCalledTimes(1);
    expect(result.next).toHaveBeenCalledWith();
    expect(result.sent.status).toBeNull();
  });

  test.each([
    TelemetryIngestSurface.SessionReplay,
    TelemetryIngestSurface.SourceMap,
    TelemetryIngestSurface.KubernetesCost,
    TelemetryIngestSurface.ChangeEvents,
  ])(
    "%s carries no signal of the queue's and is never asked",
    async (surface: TelemetryIngestSurface) => {
      const result: RunResult = await run(surface);

      expect(getRefusal).not.toHaveBeenCalled();
      expect(result.next).toHaveBeenCalledWith();
    },
  );
});
