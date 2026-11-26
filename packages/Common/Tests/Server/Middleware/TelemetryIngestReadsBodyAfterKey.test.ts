import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE BODY, READ ONCE THE KEY IS RIGHT, BEFORE THE BUDGET (#10702, #10703).
 *
 * A route whose body StartServer leaves unread hands its reader to the
 * ingest guard (TelemetryIngest.forSurface's second argument). The guard
 * runs it after every check of the key - known, on, unexpired, the right
 * kind for the surface, within its rate - and before the ingestion budget,
 * which measures the body in Refuse mode. A request refused before then has
 * nothing of its body read, and a missing or unknown key is logged at
 * debug, never at error, and counted by surface.
 *
 * The key lookup, the rate limiter and the budget decision are mocked; the
 * reader is a stand-in that says when it ran and what it read.
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

jest.mock(
  "../../../Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter",
  () => {
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
  },
);

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

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
    },
  };
});

import TelemetryIngest from "../../../Server/Middleware/TelemetryIngest";
import TelemetryIngestionKeyService from "../../../Server/Services/TelemetryIngestionKeyService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
  RequestHandler,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import Response from "../../../Server/Utils/Response";
import TelemetryIngestionBudget, {
  TelemetryIngestionBudgetAdmissionMode,
} from "../../../Server/Utils/Telemetry/TelemetryIngestionBudget";
import { TelemetryIngestBodySize } from "../../../Server/Utils/Telemetry/TelemetryIngestBodySize";
import TelemetryIngestionKeyRateLimiter, {
  TelemetryIngestionKeyLimitOutcome,
} from "../../../Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
import TelemetryIngestUnknownKeyRefusals from "../../../Server/Utils/Telemetry/TelemetryIngestUnknownKeyRefusals";
import ObjectID from "../../../Types/ObjectID";
import TelemetryIngestionKeyPolicy from "../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";
import { EventEmitter } from "events";

type MockFn = jest.Mock;

const TOKEN: string = "10702000-0000-4000-8000-0000000000a1";
const BATCH: string = JSON.stringify([{ message: "order placed" }]);

const admit: MockFn = TelemetryIngestionBudget.admit as unknown as MockFn;
const lookUp: MockFn =
  TelemetryIngestionKeyService.getPolicyFromSecretKey as unknown as MockFn;
const consumeRate: MockFn =
  TelemetryIngestionKeyRateLimiter.consume as unknown as MockFn;

const policyOf: (
  overrides?: Partial<TelemetryIngestionKeyPolicy>,
) => TelemetryIngestionKeyPolicy = (
  overrides?: Partial<TelemetryIngestionKeyPolicy>,
): TelemetryIngestionKeyPolicy => {
  return {
    ingestionKeyId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ingestionBudgets: null,
    ...(overrides || {}),
  };
};

// What happened, in order: the key's lookup, its rate, the read, the budget.
let steps: Array<string> = [];
// What the budget measured of the body, when it measured it.
let measured: Array<TelemetryIngestBodySize> = [];

// A reader that reads a JSON body as StartServer would: parsed, rawBody kept.
const reader: RequestHandler = (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  steps.push("read");
  (req as { body?: unknown }).body = JSON.parse(BATCH);
  (req as OneUptimeRequest).rawBody = BATCH;
  next();
};

interface Run {
  req: ExpressRequest;
  next: MockFn;
  // The exception the request was refused with, by its kind.
  refusedWith: string | null;
  // How it was answered: as a refusal of what the client sent (#10703).
  refusedAs: unknown;
}

const run: (data: {
  surface: TelemetryIngestSurface;
  headers?: Record<string, string>;
  readBody?: RequestHandler | undefined;
}) => Promise<Run> = async (data: {
  surface: TelemetryIngestSurface;
  headers?: Record<string, string>;
  readBody?: RequestHandler | undefined;
}): Promise<Run> => {
  const req: ExpressRequest = {
    headers: data.headers ?? { "x-oneuptime-token": TOKEN },
    id: "reads-body-after-key",
  } as unknown as ExpressRequest;
  const res: Record<string, unknown> = {
    headersSent: false,
    setHeader: (): void => {},
    on: (): void => {},
    once: (): void => {},
  };
  const next: MockFn = jest.fn() as unknown as MockFn;
  const sendErrorResponse: MockFn =
    Response.sendErrorResponse as unknown as MockFn;
  const refusalsBefore: number = sendErrorResponse.mock.calls.length;

  await TelemetryIngest.forSurface(data.surface, data.readBody)(
    req,
    res as unknown as ExpressResponse,
    next as unknown as NextFunction,
  );

  const call: Array<unknown> | null =
    sendErrorResponse.mock.calls.length > refusalsBefore
      ? (sendErrorResponse.mock.calls[
          sendErrorResponse.mock.calls.length - 1
        ] as Array<unknown>)
      : null;

  return {
    req,
    next,
    refusedWith: call ? (call[2] as Error).constructor.name : null,
    refusedAs: call ? call[3] : null,
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  steps = [];
  measured = [];
  TelemetryIngestUnknownKeyRefusals.clear();

  for (const level of ["error", "warn", "info", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {});
  }

  lookUp.mockImplementation(async (token: unknown) => {
    steps.push("key");
    return token === TOKEN ? policyOf() : null;
  });
  consumeRate.mockImplementation(async () => {
    steps.push("rate");
    return { outcome: TelemetryIngestionKeyLimitOutcome.Allowed };
  });
  admit.mockImplementation(
    async (data: {
      mode: TelemetryIngestionBudgetAdmissionMode;
      measure: () => TelemetryIngestBodySize;
    }) => {
      steps.push(`budget:${data.mode}`);

      if (data.mode !== TelemetryIngestionBudgetAdmissionMode.Check) {
        measured.push(data.measure());
      }

      return { refusal: null, charge: null };
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a route that reads its body once the key is right", () => {
  test.each([
    TelemetryIngestSurface.Fluent,
    TelemetryIngestSurface.Syslog,
    // #10795: its batches were read by StartServer, before the key.
    TelemetryIngestSurface.SecurityEvents,
  ])(
    "%s: the key, then the body, then the budget in Refuse mode - which measures the body read, exactly",
    async (surface: TelemetryIngestSurface) => {
      const result: Run = await run({ surface, readBody: reader });

      expect(steps).toEqual([
        "key",
        "read",
        `budget:${TelemetryIngestionBudgetAdmissionMode.Refuse}`,
      ]);
      expect(measured).toEqual([
        { bytes: Buffer.byteLength(BATCH), isExact: true },
      ]);
      expect(result.next).toHaveBeenCalledWith();
      expect(result.req.body).toEqual(JSON.parse(BATCH));
    },
  );

  test("Pyroscope's push: the key, then the body, then the budget's check - its size is counted at the enqueue", async () => {
    const result: Run = await run({
      surface: TelemetryIngestSurface.Pyroscope,
      readBody: reader,
    });

    expect(steps).toEqual([
      "key",
      "read",
      `budget:${TelemetryIngestionBudgetAdmissionMode.Check}`,
    ]);
    expect(result.next).toHaveBeenCalledWith();
  });

  test.each([
    TelemetryIngestSurface.KubernetesCost,
    TelemetryIngestSurface.ChangeEvents,
    TelemetryIngestSurface.OpenLineage,
    TelemetryIngestSurface.DbtArtifacts,
    TelemetryIngestSurface.SyncWebhooks,
    TelemetryIngestSurface.HostCollectorManagement,
    TelemetryIngestSurface.AndroidAgentLogSessions,
  ])(
    "%s, which has no budget: the key, then the body",
    async (surface: TelemetryIngestSurface) => {
      const result: Run = await run({ surface, readBody: reader });

      expect(steps).toEqual(["key", "read"]);
      expect(result.next).toHaveBeenCalledWith();
    },
  );

  test("a key with a rate of its own is held to it before the body is read", async () => {
    lookUp.mockImplementation(async () => {
      steps.push("key");
      return policyOf({ requestsPerMinuteLimit: 60 });
    });

    await run({ surface: TelemetryIngestSurface.Fluent, readBody: reader });

    expect(steps).toEqual([
      "key",
      "rate",
      "read",
      `budget:${TelemetryIngestionBudgetAdmissionMode.Refuse}`,
    ]);
  });

  test("a reader's refusal is passed on to the error handler, and no budget is asked", async () => {
    const refusal: Error = Object.assign(new Error("too large"), {
      status: 413,
    });
    const refusing: RequestHandler = (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ): void => {
      steps.push("read");
      next(refusal);
    };

    const result: Run = await run({
      surface: TelemetryIngestSurface.Fluent,
      readBody: refusing,
    });

    expect(steps).toEqual(["key", "read"]);
    expect(result.next).toHaveBeenCalledTimes(1);
    expect(result.next).toHaveBeenCalledWith(refusal);
    expect(admit).not.toHaveBeenCalled();
  });

  test("a reader that throws is refused with what it threw", async () => {
    const thrown: Error = new Error("the reader broke");

    const result: Run = await run({
      surface: TelemetryIngestSurface.Syslog,
      readBody: (): void => {
        throw thrown;
      },
    });

    expect(result.next).toHaveBeenCalledWith(thrown);
    expect(admit).not.toHaveBeenCalled();
  });
});

/*
 * #10814: OTLP's parseBody answers a body over its cap (413) and a coding
 * the worker cannot undo (415) itself, and the Vercel drain's signature
 * check a delivery Vercel did not sign (403), and none goes on: a reader's
 * own answer, or a connection that closes while it reads, ends the request.
 * Nothing waits for a next() that never comes.
 */
describe("a reader that answers the request itself", () => {
  // A response that tells when it is sent, as Node's does.
  const answerable: () => EventEmitter = (): EventEmitter => {
    return Object.assign(new EventEmitter(), {
      headersSent: false,
      setHeader: (): void => {},
    });
  };

  const runWith: (data: {
    surface: TelemetryIngestSurface;
    readBody: RequestHandler;
    res: EventEmitter;
  }) => Promise<MockFn> = async (data: {
    surface: TelemetryIngestSurface;
    readBody: RequestHandler;
    res: EventEmitter;
  }): Promise<MockFn> => {
    const next: MockFn = jest.fn() as unknown as MockFn;

    await TelemetryIngest.forSurface(data.surface, data.readBody)(
      {
        headers: { "x-oneuptime-token": TOKEN },
        id: "answered-by-its-reader",
      } as unknown as ExpressRequest,
      data.res as unknown as ExpressResponse,
      next as unknown as NextFunction,
    );

    return next;
  };

  test.each([
    ["OTLP's 413 or 415", TelemetryIngestSurface.OtelLogs, "finish"],
    ["the Vercel drain's 403", TelemetryIngestSurface.VercelLogDrain, "finish"],
    [
      "a connection closed while the body is read",
      TelemetryIngestSurface.OtelTraces,
      "close",
    ],
  ])(
    "%s: the request ends there - nothing passed on, no budget asked",
    async (_what: string, surface: TelemetryIngestSurface, event: string) => {
      const res: EventEmitter = answerable();
      const answering: RequestHandler = (): void => {
        steps.push("read");
        // As the reader answers: later, and it never goes on.
        void Promise.resolve().then((): void => {
          res.emit(event);
        });
      };

      const next: MockFn = await runWith({
        surface,
        readBody: answering,
        res,
      });

      expect(steps).toEqual(["key", "read"]);
      expect(admit).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    },
  );

  test("once the reader went on, its answer later is the route's: the request is passed on once, to the budget", async () => {
    const res: EventEmitter = answerable();

    const next: MockFn = await runWith({
      surface: TelemetryIngestSurface.OtelLogs,
      readBody: (
        req: ExpressRequest,
        _res: ExpressResponse,
        goOn: NextFunction,
      ): void => {
        steps.push("read");
        (req as { body?: unknown }).body = Buffer.from(BATCH);
        goOn();
      },
      res,
    });

    // The route answers, as it does once it took the export.
    res.emit("finish");
    res.emit("close");

    expect(steps).toEqual([
      "key",
      "read",
      `budget:${TelemetryIngestionBudgetAdmissionMode.Refuse}`,
    ]);
    expect(measured).toEqual([
      { bytes: Buffer.byteLength(BATCH), isExact: true },
    ]);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  test("a reader that refuses the body with an error still passes it to the error handler", async () => {
    const res: EventEmitter = answerable();
    const refusal: Error = Object.assign(new Error("not a body"), {
      status: 400,
    });

    const next: MockFn = await runWith({
      surface: TelemetryIngestSurface.VercelLogDrain,
      readBody: (
        _req: ExpressRequest,
        _res: ExpressResponse,
        goOn: NextFunction,
      ): void => {
        steps.push("read");
        goOn(refusal);
      },
      res,
    });

    // The error handler's answer, after: it changes nothing here.
    res.emit("finish");

    expect(steps).toEqual(["key", "read"]);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(refusal);
    expect(admit).not.toHaveBeenCalled();
  });
});

describe("a request refused for its key has nothing of its body read", () => {
  test.each([
    ["no key", {}, "NotAuthenticatedException"],
    [
      "a key no key has",
      { "x-oneuptime-token": "not-a-key" },
      "NotAuthenticatedException",
    ],
  ] as Array<[string, Record<string, string>, string]>)(
    "%s: refused, the body never read, no budget asked",
    async (_what: string, headers: Record<string, string>, refusal: string) => {
      const result: Run = await run({
        surface: TelemetryIngestSurface.Fluent,
        headers,
        readBody: reader,
      });

      expect(result.refusedWith).toBe(refusal);
      expect(result.refusedAs).toEqual({ isClientRefusal: true });
      expect(steps).not.toContain("read");
      expect(admit).not.toHaveBeenCalled();
      expect(result.next).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["switched off", { isEnabled: false }, "NotAuthorizedException"],
    [
      "expired",
      { expiresAt: new Date(Date.now() - 60_000) },
      "NotAuthenticatedException",
    ],
    [
      "a browser key, on a surface no page sends to",
      {
        keyType: TelemetryIngestionKeyType.Browser,
        allowedOrigins: ["https://shop.example.com"],
      },
      "NotAuthorizedException",
    ],
    [
      "a mobile key, on a surface no app sends to",
      { keyType: TelemetryIngestionKeyType.Mobile },
      "NotAuthorizedException",
    ],
  ] as Array<[string, Partial<TelemetryIngestionKeyPolicy>, string]>)(
    "a key %s: refused, the body never read",
    async (
      _what: string,
      overrides: Partial<TelemetryIngestionKeyPolicy>,
      refusal: string,
    ) => {
      lookUp.mockImplementation(async () => {
        steps.push("key");
        return policyOf(overrides);
      });

      const result: Run = await run({
        surface: TelemetryIngestSurface.Fluent,
        readBody: reader,
      });

      expect(result.refusedWith).toBe(refusal);
      expect(result.refusedAs).toEqual({ isClientRefusal: true });
      expect(steps).toEqual(["key"]);
      expect(result.next).not.toHaveBeenCalled();
    },
  );

  test("a key over its rate: refused 429, the body never read", async () => {
    lookUp.mockImplementation(async () => {
      steps.push("key");
      return policyOf({ requestsPerMinuteLimit: 1 });
    });
    consumeRate.mockImplementation(async () => {
      steps.push("rate");
      return {
        outcome: TelemetryIngestionKeyLimitOutcome.RateLimited,
        retryAfterSeconds: 30,
        isFirstRejectionInWindow: false,
      };
    });

    const result: Run = await run({
      surface: TelemetryIngestSurface.Syslog,
      readBody: reader,
    });

    expect(result.refusedWith).toBe("TooManyRequestsException");
    // Logged at debug: the limiter logs the window's first rejection itself.
    expect(result.refusedAs).toEqual({ isClientRefusal: true });
    expect(steps).toEqual(["key", "rate"]);
  });
});

/*
 * OTLP/HTTP's raw bytes are read by its own middleware before the guard
 * (OtelRequestMiddleware), so it is given no reader. Security Events was
 * given none too, while StartServer read its batches (#10795).
 */
describe("a route whose body was read before the guard (OTLP/HTTP)", () => {
  test("is measured by the budget as it arrived: no reader is given", async () => {
    const req: Record<string, unknown> = {
      headers: { "x-oneuptime-token": TOKEN },
      id: "otlp-logs",
      body: Buffer.from(BATCH),
    };
    const next: MockFn = jest.fn() as unknown as MockFn;

    await TelemetryIngest.forSurface(TelemetryIngestSurface.OtelLogs)(
      req as unknown as ExpressRequest,
      {
        headersSent: false,
        setHeader: (): void => {},
        on: (): void => {},
        once: (): void => {},
      } as unknown as ExpressResponse,
      next as unknown as NextFunction,
    );

    expect(steps).toEqual([
      "key",
      `budget:${TelemetryIngestionBudgetAdmissionMode.Refuse}`,
    ]);
    expect(measured).toEqual([
      { bytes: Buffer.byteLength(BATCH), isExact: true },
    ]);
    expect(next).toHaveBeenCalledWith();
  });
});

/*
 * #10703: these come from anyone, before anyone is known. Each was an
 * error-level line; now a debug line, and a count by surface, logged at warn
 * at most once a minute.
 */
describe("a missing or unknown key is logged at debug, and counted", () => {
  test("no line at error or warn but the minute's first; a debug line each; the token never", async () => {
    for (let index: number = 0; index < 5; index++) {
      await run({ surface: TelemetryIngestSurface.Fluent, headers: {} });
      await run({
        surface: TelemetryIngestSurface.Syslog,
        headers: { "x-oneuptime-token": `secret-${index}` },
      });
    }

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect((logger.warn as unknown as MockFn).mock.calls[0]![0]).toBe(
      "TelemetryIngest: refused 1 request with no ingestion key (fluent: 1). Each is logged at debug; these counts at most once a minute.",
    );

    const debugLines: Array<unknown> = (
      logger.debug as unknown as MockFn
    ).mock.calls.map((call: Array<unknown>): unknown => {
      return call[0];
    });

    expect(
      debugLines.filter((line: unknown): boolean => {
        return line === "Missing header: x-oneuptime-token";
      }),
    ).toHaveLength(5);
    expect(
      debugLines.filter((line: unknown): boolean => {
        return line === "Invalid service token.";
      }),
    ).toHaveLength(5);

    expect(
      Object.fromEntries(TelemetryIngestUnknownKeyRefusals.getCounts()),
    ).toEqual({
      "missing|fluent": 4,
      "unknown|syslog": 5,
    });

    for (const level of ["error", "warn", "info", "debug"] as const) {
      expect(
        JSON.stringify((logger[level] as unknown as MockFn).mock.calls),
      ).not.toContain("secret-");
    }
  });

  test("the legacy guard, which names no surface, is counted as unnamed", async () => {
    const next: MockFn = jest.fn() as unknown as MockFn;

    await TelemetryIngest.isAuthorizedServiceMiddleware(
      { headers: {}, id: "legacy" } as unknown as ExpressRequest,
      { headersSent: false } as unknown as ExpressResponse,
      next as unknown as NextFunction,
    );

    expect((logger.warn as unknown as MockFn).mock.calls[0]![0]).toBe(
      "TelemetryIngest: refused 1 request with no ingestion key (unnamed: 1). Each is logged at debug; these counts at most once a minute.",
    );
  });
});
