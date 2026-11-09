import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * EVERY REFUSAL THE INGEST GUARD MAKES IS COUNTED AGAINST THE KEY THAT SENT
 * IT, UNDER ITS OWN REASON AND SURFACE - AND NOTHING IS COUNTED FOR A TOKEN
 * THAT NAMES NO KEY (issue #6378).
 *
 * The counts are what the RUM setup check, its empty charts and the key's
 * own page read to say "refused, and why". A refusal branch that answers the
 * sender but forgets to count leaves those pages saying "nothing arrived"
 * about a sender that is being turned away - the confusion the issue is
 * about. So each branch is driven here, and what it counted is asserted
 * beside what it answered.
 *
 * The recorder is spied on (its batching has its own suite,
 * TelemetryIngestRefusalRecorder.test.ts); the key lookup, the limiter and
 * the budget are mocked at the module boundary, as in the guard's own
 * suites. Nothing touches Postgres or Redis.
 */

jest.mock("../../../Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      getPolicyFromSecretKey: jest.fn(),
      getProjectIdFromSecretKey: jest.fn(),
      markUsed: jest.fn(),
    },
  };
});

jest.mock(
  "../../../Server/Services/TelemetryIngestionKeyRefusalService",
  () => {
    return {
      __esModule: true,
      default: {
        addRefusals: jest.fn(),
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

import TelemetryIngest from "../../../Server/Middleware/TelemetryIngest";
import TelemetryIngestionKeyService from "../../../Server/Services/TelemetryIngestionKeyService";
import Response from "../../../Server/Utils/Response";
import logger from "../../../Server/Utils/Logger";
import TelemetryIngestionBudget from "../../../Server/Utils/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionKeyRateLimiter, {
  TelemetryIngestionKeyLimitOutcome,
} from "../../../Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
import TelemetryIngestRefusalRecorder, {
  TelemetryIngestRefusalRecord,
  noteTelemetryIngestRefusalKey,
} from "../../../Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ProjectBlockedException from "../../../Types/Exception/ProjectBlockedException";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import {
  TelemetryIngestionBudgetRefusal,
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionKeyPolicy from "../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import {
  ALL_TELEMETRY_INGEST_REFUSAL_REASONS,
  TelemetryIngestRefusalReason,
} from "../../../Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";

type MockFn = jest.Mock;

const PROJECT_ID: string = "9e2a0000-0000-4000-8000-000000000001";
const KEY_ID: string = "9e2a0000-0000-4000-8000-000000000002";
const TOKEN: string = "9e2a0000-0000-4000-8000-000000000003";
const ALLOWED_ORIGIN: string = "https://shop.example.com";

let record: jest.SpiedFunction<typeof TelemetryIngestRefusalRecorder.record>;

// Every reason a branch below counted under, to check none is left out.
const reasonsCounted: Set<TelemetryIngestRefusalReason> = new Set();

function buildPolicy(
  overrides: Partial<TelemetryIngestionKeyPolicy> = {},
): TelemetryIngestionKeyPolicy {
  return {
    ingestionKeyId: new ObjectID(KEY_ID),
    projectId: new ObjectID(PROJECT_ID),
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ingestionBudgets: null,
    ...overrides,
  };
}

function resolveTo(policy: TelemetryIngestionKeyPolicy | null): void {
  (
    TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn
  ).mockResolvedValue(policy as never);
}

interface RunResult {
  next: MockFn;
}

// `surface === null` runs the legacy guard, which names no surface.
async function run(
  surface: TelemetryIngestSurface | null,
  headers: Record<string, string> = { "x-oneuptime-token": TOKEN },
): Promise<RunResult> {
  const req: ExpressRequest = {
    headers,
    body: Buffer.alloc(10),
    id: "test-request-id",
  } as unknown as ExpressRequest;
  const res: Record<string, unknown> = {
    headersSent: false,
    setHeader: jest.fn(),
    status: (): Record<string, unknown> => {
      return res;
    },
    send: (): Record<string, unknown> => {
      return res;
    },
    json: (): Record<string, unknown> => {
      return res;
    },
  };
  const next: MockFn = jest.fn() as unknown as MockFn;

  if (surface === null) {
    await TelemetryIngest.isAuthorizedServiceMiddleware(
      req,
      res as unknown as ExpressResponse,
      next as unknown as NextFunction,
    );
  } else {
    await TelemetryIngest.forSurface(surface)(
      req,
      res as unknown as ExpressResponse,
      next as unknown as NextFunction,
    );
  }

  return { next };
}

// What the recorder was handed, as plain values.
function counted(): Array<Record<string, unknown>> {
  return record.mock.calls.map(
    (call: [TelemetryIngestRefusalRecord]): Record<string, unknown> => {
      const data: TelemetryIngestRefusalRecord = call[0];

      reasonsCounted.add(data.reason);

      return {
        project: data.projectId.toString(),
        key: data.ingestionKeyId.toString(),
        reason: data.reason,
        surface: data.surface,
      };
    },
  );
}

function one(
  reason: TelemetryIngestRefusalReason,
  surface: TelemetryIngestSurface | null,
): Array<Record<string, unknown>> {
  return [{ project: PROJECT_ID, key: KEY_ID, reason, surface }];
}

function budgetRefusal(
  kind: TelemetryIngestionBudgetRefusalKind,
  scope: TelemetryIngestionBudgetScope,
): TelemetryIngestionBudgetRefusal {
  return {
    kind,
    scope,
    signal: ProductType.Logs,
    message: "refused for a test",
    retryAfterSeconds:
      kind === TelemetryIngestionBudgetRefusalKind.RateLimited ? 6 : null,
    resetsAt: new Date("2026-11-10T00:00:00Z"),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  record = jest
    .spyOn(TelemetryIngestRefusalRecorder, "record")
    .mockImplementation(() => {});
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
  (TelemetryIngestionKeyService.markUsed as MockFn).mockResolvedValue(
    undefined as never,
  );
  (TelemetryIngestionKeyRateLimiter.consume as MockFn).mockResolvedValue({
    outcome: TelemetryIngestionKeyLimitOutcome.Allowed,
  } as never);
  (TelemetryIngestionBudget.admit as unknown as MockFn).mockResolvedValue({
    refusal: null,
    charge: null,
  } as never);
  resolveTo(buildPolicy());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a token that names no key counts nothing, in any project", () => {
  test("no token at all", async () => {
    const result: RunResult = await run(TelemetryIngestSurface.OtelTraces, {});

    expect(
      (Response.sendErrorResponse as MockFn).mock.calls[0]![2],
    ).toBeInstanceOf(NotAuthenticatedException);
    expect(result.next).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  test("a token no key has: answered 401, counted nowhere", async () => {
    resolveTo(null);

    const result: RunResult = await run(TelemetryIngestSurface.OtelLogs);

    expect(
      (Response.sendErrorResponse as MockFn).mock.calls[0]![2],
    ).toBeInstanceOf(NotAuthenticatedException);
    expect(result.next).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(TelemetryIngestionKeyRefusalServiceWrites()).toBe(0);
  });

  test("on the legacy guard too", async () => {
    resolveTo(null);

    await run(null);

    expect(record).not.toHaveBeenCalled();
  });
});

describe("each refusal of a known key is counted against it, with its reason and surface", () => {
  test("a key that is switched off", async () => {
    resolveTo(buildPolicy({ isEnabled: false }));

    const result: RunResult = await run(TelemetryIngestSurface.OtelTraces);

    expect(result.next).not.toHaveBeenCalled();
    expect(counted()).toEqual(
      one(
        TelemetryIngestRefusalReason.KeyDisabled,
        TelemetryIngestSurface.OtelTraces,
      ),
    );
  });

  test("a key past its expiry date", async () => {
    resolveTo(buildPolicy({ expiresAt: new Date(Date.now() - 60_000) }));

    await run(TelemetryIngestSurface.OtelMetrics);

    expect(counted()).toEqual(
      one(
        TelemetryIngestRefusalReason.KeyExpired,
        TelemetryIngestSurface.OtelMetrics,
      ),
    );
  });

  test("a Browser key on a surface only Server keys may use", async () => {
    resolveTo(
      buildPolicy({
        keyType: TelemetryIngestionKeyType.Browser,
        allowedOrigins: [ALLOWED_ORIGIN],
      }),
    );

    await run(TelemetryIngestSurface.OtelProfiles, {
      "x-oneuptime-token": TOKEN,
      origin: ALLOWED_ORIGIN,
    });

    expect(counted()).toEqual(
      one(
        TelemetryIngestRefusalReason.BrowserKeyNotAllowedHere,
        TelemetryIngestSurface.OtelProfiles,
      ),
    );
  });

  test("a Browser key from an origin it does not list", async () => {
    resolveTo(
      buildPolicy({
        keyType: TelemetryIngestionKeyType.Browser,
        allowedOrigins: [ALLOWED_ORIGIN],
      }),
    );

    await run(TelemetryIngestSurface.OtelTraces, {
      "x-oneuptime-token": TOKEN,
      origin: "https://elsewhere.example.org",
    });

    expect(counted()).toEqual(
      one(
        TelemetryIngestRefusalReason.OriginNotAllowed,
        TelemetryIngestSurface.OtelTraces,
      ),
    );
  });

  test("a Browser key with no Origin header at all", async () => {
    resolveTo(
      buildPolicy({
        keyType: TelemetryIngestionKeyType.Browser,
        allowedOrigins: [ALLOWED_ORIGIN],
      }),
    );

    await run(TelemetryIngestSurface.OtelLogs);

    expect(counted()).toEqual(
      one(
        TelemetryIngestRefusalReason.OriginNotAllowed,
        TelemetryIngestSurface.OtelLogs,
      ),
    );
  });

  test("a key pinned to one service, on an identity registration surface", async () => {
    resolveTo(buildPolicy({ pinnedServiceName: "checkout" }));

    await run(TelemetryIngestSurface.KubernetesAgentRunner);

    expect(counted()).toEqual(
      one(
        TelemetryIngestRefusalReason.PinnedKeyNotAllowedHere,
        TelemetryIngestSurface.KubernetesAgentRunner,
      ),
    );
  });

  test("a key over its own requests-per-minute limit", async () => {
    resolveTo(buildPolicy({ requestsPerMinuteLimit: 10 }));
    (TelemetryIngestionKeyRateLimiter.consume as MockFn).mockResolvedValue({
      outcome: TelemetryIngestionKeyLimitOutcome.RateLimited,
      retryAfterSeconds: 30,
      isFirstRejectionInWindow: false,
    } as never);

    await run(TelemetryIngestSurface.OtelLogs);

    expect(counted()).toEqual(
      one(
        TelemetryIngestRefusalReason.KeyRequestsPerMinute,
        TelemetryIngestSurface.OtelLogs,
      ),
    );
  });

  test("a limiter that cannot count admits, and counts nothing", async () => {
    resolveTo(buildPolicy({ requestsPerMinuteLimit: 10 }));
    (TelemetryIngestionKeyRateLimiter.consume as MockFn).mockResolvedValue({
      outcome: TelemetryIngestionKeyLimitOutcome.CounterUnavailable,
    } as never);

    const result: RunResult = await run(TelemetryIngestSurface.OtelLogs);

    expect(result.next).toHaveBeenCalledWith();
    expect(record).not.toHaveBeenCalled();
  });

  test.each([
    [
      TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted,
      TelemetryIngestionBudgetScope.Project,
      TelemetryIngestRefusalReason.ProjectDailyBudget,
    ],
    [
      TelemetryIngestionBudgetRefusalKind.RateLimited,
      TelemetryIngestionBudgetScope.Project,
      TelemetryIngestRefusalReason.ProjectIngestionRate,
    ],
    [
      TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted,
      TelemetryIngestionBudgetScope.IngestionKey,
      TelemetryIngestRefusalReason.KeyDailyBudget,
    ],
    [
      TelemetryIngestionBudgetRefusalKind.RateLimited,
      TelemetryIngestionBudgetScope.IngestionKey,
      TelemetryIngestRefusalReason.KeyIngestionRate,
    ],
  ])(
    "an ingestion budget refusal (%s, %s) is counted as %s",
    async (
      kind: TelemetryIngestionBudgetRefusalKind,
      scope: TelemetryIngestionBudgetScope,
      reason: TelemetryIngestRefusalReason,
    ) => {
      (TelemetryIngestionBudget.admit as unknown as MockFn).mockResolvedValue({
        refusal: budgetRefusal(kind, scope),
        charge: null,
      } as never);

      const result: RunResult = await run(TelemetryIngestSurface.OtelLogs);

      expect(result.next).not.toHaveBeenCalled();
      expect(counted()).toEqual(one(reason, TelemetryIngestSurface.OtelLogs));
    },
  );

  test.each([
    [
      "a project with no way to pay",
      (): Error => {
        return new PaymentRequiredException("Payment required");
      },
      TelemetryIngestRefusalReason.PaymentRequired,
    ],
    [
      "a project an administrator blocked",
      (): Error => {
        return new ProjectBlockedException();
      },
      TelemetryIngestRefusalReason.ProjectBlocked,
    ],
  ])(
    "%s: the key service noted the key on the exception, and the guard counts it",
    async (
      _label: string,
      makeError: () => Error,
      reason: TelemetryIngestRefusalReason,
    ) => {
      const err: Error = makeError();
      noteTelemetryIngestRefusalKey(err, {
        projectId: new ObjectID(PROJECT_ID),
        ingestionKeyId: new ObjectID(KEY_ID),
      });
      (
        TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn
      ).mockRejectedValue(err as never);

      const result: RunResult = await run(TelemetryIngestSurface.OtelTraces);

      // The sender is answered as before: the exception goes on to next().
      expect(result.next).toHaveBeenCalledWith(err);
      expect(counted()).toEqual(one(reason, TelemetryIngestSurface.OtelTraces));
    },
  );

  test("a refusal on the legacy guard, which names no surface, is counted with none", async () => {
    resolveTo(buildPolicy({ isEnabled: false }));

    await run(null);

    expect(counted()).toEqual(
      one(TelemetryIngestRefusalReason.KeyDisabled, null),
    );
  });

  test("every reason there is, is counted by some branch above", () => {
    expect(Array.from(reasonsCounted).sort()).toEqual(
      [...ALL_TELEMETRY_INGEST_REFUSAL_REASONS].sort(),
    );
  });
});

describe("what is not a refusal of a key counts nothing", () => {
  test("an admitted request", async () => {
    const result: RunResult = await run(TelemetryIngestSurface.OtelTraces);

    expect(result.next).toHaveBeenCalledWith();
    expect(record).not.toHaveBeenCalled();
  });

  test("a billing exception nobody noted a key on", async () => {
    (
      TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn
    ).mockRejectedValue(
      new PaymentRequiredException("Payment required") as never,
    );

    const result: RunResult = await run(TelemetryIngestSurface.OtelTraces);

    expect(result.next).toHaveBeenCalledTimes(1);
    expect(record).not.toHaveBeenCalled();
  });

  test("another error while the key resolves, even one noted with a key", async () => {
    const err: BadDataException = new BadDataException("database unavailable");
    noteTelemetryIngestRefusalKey(err, {
      projectId: new ObjectID(PROJECT_ID),
      ingestionKeyId: new ObjectID(KEY_ID),
    });
    (
      TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn
    ).mockRejectedValue(err as never);

    const result: RunResult = await run(TelemetryIngestSurface.OtelTraces);

    expect(result.next).toHaveBeenCalledWith(err);
    expect(record).not.toHaveBeenCalled();
  });

  test("a Browser key from a listed origin, on a surface it may use", async () => {
    resolveTo(
      buildPolicy({
        keyType: TelemetryIngestionKeyType.Browser,
        allowedOrigins: [ALLOWED_ORIGIN],
      }),
    );

    const result: RunResult = await run(TelemetryIngestSurface.OtelTraces, {
      "x-oneuptime-token": TOKEN,
      origin: ALLOWED_ORIGIN,
    });

    expect(result.next).toHaveBeenCalledWith();
    expect(record).not.toHaveBeenCalled();
  });
});

// Nothing in this suite may reach the database writer: the recorder is a spy.
function TelemetryIngestionKeyRefusalServiceWrites(): number {
  return (
    jest.requireMock(
      "../../../Server/Services/TelemetryIngestionKeyRefusalService",
    ) as { default: { addRefusals: MockFn } }
  ).default.addRefusals.mock.calls.length;
}
