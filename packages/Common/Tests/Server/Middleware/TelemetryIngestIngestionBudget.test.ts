import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import zlib from "zlib";

/*
 * The ingestion budget gate in the ingest middleware (issue #5917): which
 * surfaces it runs on, what it is handed, what a refused sender is answered,
 * and what it leaves on the request for the queue - so a request is counted
 * once whoever enqueues it.
 *
 * The budget decision itself is mocked here (TelemetryIngestionBudget.admit
 * is tested on its own, and against a real Valkey); what is under test is
 * the middleware around it.
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

jest.mock("../../../Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: {
      consume: jest.fn(),
    },
  };
});

import TelemetryIngest, {
  TelemetryRequest,
} from "../../../Server/Middleware/TelemetryIngest";
import TelemetryIngestionKeyService from "../../../Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionBudget, {
  TelemetryIngestionBudgetAdmissionMode,
  TelemetryIngestionBudgetCharge,
} from "../../../Server/Utils/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionKeyRateLimiter, {
  TelemetryIngestionKeyLimitOutcome,
} from "../../../Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
import { TelemetryIngestBodySize } from "../../../Server/Utils/Telemetry/TelemetryIngestBodySize";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
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

const PROJECT_ID: string = "5d3b0f1a-0000-4000-8000-000000000071";
const KEY_ID: string = "5d3b0f1a-0000-4000-8000-000000000072";
const TOKEN: string = "5d3b0f1a-0000-4000-8000-000000000073";

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

const charge: TelemetryIngestionBudgetCharge = {
  projectId: PROJECT_ID,
  signal: ProductType.Logs,
  dayId: "20261109T0000Z",
  dayTtlSeconds: 1000,
  countedBytes: 100,
  isExact: true,
  isPending: false,
  scopes: [],
};

interface Sent {
  status: number | null;
  headers: Record<string, string>;
  body: unknown;
}

interface RunResult {
  req: ExpressRequest;
  next: MockFn;
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
  const next: MockFn = jest.fn();

  await TelemetryIngest.forSurface(surface)(
    req,
    res as unknown as ExpressResponse,
    next as unknown as NextFunction,
  );

  return { req: req, next: next, sent: sent };
};

const refusal: (
  kind: TelemetryIngestionBudgetRefusalKind,
) => TelemetryIngestionBudgetRefusal = (
  kind: TelemetryIngestionBudgetRefusalKind,
): TelemetryIngestionBudgetRefusal => {
  return {
    kind: kind,
    scope: TelemetryIngestionBudgetScope.Project,
    signal: ProductType.Logs,
    message: "refused for a test",
    retryAfterSeconds:
      kind === TelemetryIngestionBudgetRefusalKind.RateLimited ? 6 : null,
    resetsAt: new Date("2026-11-10T00:00:00Z"),
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  (TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn).mockResolvedValue(
    policy as never,
  );
  (TelemetryIngestionKeyService.markUsed as MockFn).mockResolvedValue(
    undefined as never,
  );
  (TelemetryIngestionKeyRateLimiter.consume as MockFn).mockResolvedValue({
    outcome: TelemetryIngestionKeyLimitOutcome.Allowed,
  } as never);
  admit.mockResolvedValue({ refusal: null, charge: charge } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which surfaces the budget gate runs on", () => {
  const budgeted: Array<[TelemetryIngestSurface, ProductType]> = [
    [TelemetryIngestSurface.OtelTraces, ProductType.Traces],
    [TelemetryIngestSurface.OtelLogs, ProductType.Logs],
    [TelemetryIngestSurface.OtelMetrics, ProductType.Metrics],
    [TelemetryIngestSurface.OtelProfiles, ProductType.Profiles],
    [TelemetryIngestSurface.Fluent, ProductType.Logs],
    [TelemetryIngestSurface.Syslog, ProductType.Logs],
    [TelemetryIngestSurface.VercelLogDrain, ProductType.Logs],
    [TelemetryIngestSurface.SecurityEvents, ProductType.SecurityEvents],
  ];

  test.each(budgeted)(
    "%s is counted against its project's and key's %s budget, refusing over it",
    async (surface: TelemetryIngestSurface, signal: ProductType) => {
      const result: RunResult = await run(surface, { body: Buffer.alloc(10) });

      expect(admit).toHaveBeenCalledTimes(1);

      const call: Record<string, unknown> = admit.mock.calls[0]![0] as Record<
        string,
        unknown
      >;

      expect(call["signal"]).toBe(signal);
      expect((call["projectId"] as ObjectID).toString()).toBe(PROJECT_ID);
      expect(call["ingestionKeyPolicy"]).toBe(policy);
      expect(call["mode"]).toBe(TelemetryIngestionBudgetAdmissionMode.Refuse);
      expect(result.next).toHaveBeenCalledWith();
    },
  );

  test("Pyroscope reads its upload after the key check, so it is checked now and counted at the enqueue", async () => {
    await run(TelemetryIngestSurface.Pyroscope);

    expect(
      (admit.mock.calls[0]![0] as Record<string, unknown>)["mode"],
    ).toBe(TelemetryIngestionBudgetAdmissionMode.Check);
  });

  test.each([
    TelemetryIngestSurface.SessionReplay,
    TelemetryIngestSurface.SourceMap,
    TelemetryIngestSurface.KubernetesCost,
    TelemetryIngestSurface.ChangeEvents,
    TelemetryIngestSurface.OpenLineage,
    TelemetryIngestSurface.DbtArtifacts,
    TelemetryIngestSurface.SyncWebhooks,
    TelemetryIngestSurface.HostCollectorManagement,
  ])("%s is not budgeted: it is not a telemetry signal, or has budgets of its own", async (
    surface: TelemetryIngestSurface,
  ) => {
    const result: RunResult = await run(surface);

    expect(admit).not.toHaveBeenCalled();
    expect(result.next).toHaveBeenCalledWith();
    expect(
      (result.req as TelemetryRequest).telemetryIngestionBudgetCharge,
    ).toBeUndefined();
  });

  test("the legacy unnamed surface is not budgeted either", async () => {
    const req: ExpressRequest = {
      headers: { "x-oneuptime-token": TOKEN },
    } as unknown as ExpressRequest;
    const next: MockFn = jest.fn();

    await TelemetryIngest.isAuthorizedServiceMiddleware(
      req,
      { setHeader: jest.fn() } as unknown as ExpressResponse,
      next as unknown as NextFunction,
    );

    expect(admit).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });
});

describe("what the gate is handed and leaves behind", () => {
  test("sizes a gzip OTLP body from its trailer, without inflating it", async () => {
    const plain: Buffer = Buffer.from("x".repeat(5000));

    await run(TelemetryIngestSurface.OtelLogs, {
      headers: { "content-encoding": "gzip" },
      body: zlib.gzipSync(plain),
    });

    const measure: () => TelemetryIngestBodySize = (
      admit.mock.calls[0]![0] as Record<string, unknown>
    )["measure"] as () => TelemetryIngestBodySize;

    expect(measure()).toEqual({ bytes: 5000, isExact: false });
  });

  test("leaves the charge on the request, so the queue does not count it again", async () => {
    const result: RunResult = await run(TelemetryIngestSurface.OtelTraces, {
      body: Buffer.alloc(1),
    });

    expect(
      (result.req as TelemetryRequest).telemetryIngestionBudgetCharge,
    ).toBe(charge);
  });

  test("leaves null when nothing was counted, so the queue knows it was decided", async () => {
    admit.mockResolvedValue({ refusal: null, charge: null } as never);

    const result: RunResult = await run(TelemetryIngestSurface.OtelTraces, {
      body: Buffer.alloc(1),
    });

    expect(
      (result.req as TelemetryRequest).telemetryIngestionBudgetCharge,
    ).toBe(null);
    expect(result.next).toHaveBeenCalledWith();
  });

  test("never reaches the budget for a request the key's own rate limit refused", async () => {
    (TelemetryIngestionKeyRateLimiter.consume as MockFn).mockResolvedValue({
      outcome: TelemetryIngestionKeyLimitOutcome.RateLimited,
      retryAfterSeconds: 9,
    } as never);
    (TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn).mockResolvedValue(
      { ...policy, requestsPerMinuteLimit: 1 } as never,
    );

    await run(TelemetryIngestSurface.OtelLogs, { body: Buffer.alloc(1) });

    expect(admit).not.toHaveBeenCalled();
  });
});

describe("what a refused sender is answered", () => {
  test("a used-up budget on an OTLP route: 403 with a protobuf Status, and the handler never runs", async () => {
    admit.mockResolvedValue({
      refusal: refusal(TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted),
      charge: null,
    } as never);

    const result: RunResult = await run(TelemetryIngestSurface.OtelLogs, {
      headers: { "content-type": "application/x-protobuf" },
      body: Buffer.alloc(1),
    });

    expect(result.next).not.toHaveBeenCalled();
    expect(result.sent.status).toBe(403);
    expect(result.sent.headers["Content-Type"]).toBe("application/x-protobuf");
    expect(Buffer.isBuffer(result.sent.body)).toBe(true);
    expect((result.sent.body as Buffer).toString("utf8")).toContain(
      "refused for a test",
    );
    expect(result.sent.headers["Retry-After"]).toBeUndefined();
    expect(TelemetryIngestionKeyService.markUsed).not.toHaveBeenCalled();
  });

  test("over the rate on a Fluent route: 429 with Retry-After and a JSON body", async () => {
    admit.mockResolvedValue({
      refusal: refusal(TelemetryIngestionBudgetRefusalKind.RateLimited),
      charge: null,
    } as never);

    const result: RunResult = await run(TelemetryIngestSurface.Fluent, {
      body: { entries: [] },
    });

    expect(result.next).not.toHaveBeenCalled();
    expect(result.sent.status).toBe(429);
    expect(result.sent.headers["Retry-After"]).toBe("6");
    expect(result.sent.body).toEqual({
      error: "rate-limited",
      message: "refused for a test",
      resetsAt: "2026-11-10T00:00:00.000Z",
      retryAfterSeconds: 6,
    });
  });
});
