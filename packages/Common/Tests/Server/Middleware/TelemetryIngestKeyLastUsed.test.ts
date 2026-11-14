import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE HTTP INGEST MIDDLEWARE STAMPS THE KEY THAT SENT AN ADMITTED REQUEST AS
 * USED, THROUGH THE HELPER THE OTLP gRPC SERVER SHARES, AND NEVER A KEY IT
 * REFUSED (issue #7887).
 *
 * "Last Used At" and the telemetry guides' first-data wait read the stamp. A
 * refused key - switched off, expired, a browser key where it may not write,
 * over a limit or a budget, a project that cannot pay - is not "used", and
 * stamping it would tell a customer a dead key is still live. So each branch
 * of the guard is driven here, and what it stamped is asserted beside how it
 * answered the sender. GrpcServerKeyLastUsed.test.ts does the same for the
 * gRPC server, through the same TelemetryIngestionKeyLastUsed.stamp.
 *
 * The key lookup, the limiter and the budget are mocked at the module
 * boundary, as in the guard's other suites; the helper itself runs, so the
 * key service's markUsed is what it reaches.
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
import TelemetryIngestionKeyLastUsed from "../../../Server/Utils/Telemetry/TelemetryIngestionKeyLastUsed";
import TelemetryIngestionKeyRateLimiter, {
  TelemetryIngestionKeyLimitOutcome,
} from "../../../Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
import TelemetryIngestRefusalRecorder from "../../../Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import BadDataException from "../../../Types/Exception/BadDataException";
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
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";

type MockFn = jest.Mock;

const PROJECT_ID: string = "7887b000-0000-4000-8000-000000000001";
const KEY_ID: string = "7887b000-0000-4000-8000-000000000002";
const TOKEN: string = "7887b000-0000-4000-8000-000000000003";
const ALLOWED_ORIGIN: string = "https://shop.example.com";

let stamp: jest.SpiedFunction<typeof TelemetryIngestionKeyLastUsed.stamp>;

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

function browserKey(
  overrides: Partial<TelemetryIngestionKeyPolicy> = {},
): TelemetryIngestionKeyPolicy {
  return buildPolicy({
    keyType: TelemetryIngestionKeyType.Browser,
    allowedOrigins: [ALLOWED_ORIGIN],
    ...overrides,
  });
}

function resolveTo(policy: TelemetryIngestionKeyPolicy | null): void {
  (
    TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn
  ).mockResolvedValue(policy as never);
}

function rejectWith(err: Error): void {
  (
    TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn
  ).mockRejectedValue(err as never);
}

function markUsed(): MockFn {
  return TelemetryIngestionKeyService.markUsed as unknown as MockFn;
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
    resetsAt: new Date("2026-11-15T00:00:00Z"),
  };
}

function refuseOnBudget(refusal: TelemetryIngestionBudgetRefusal): void {
  (TelemetryIngestionBudget.admit as unknown as MockFn).mockResolvedValue({
    refusal,
    charge: null,
  } as never);
}

/*
 * How the middleware answered: the exception it answered with, the status a
 * budget refusal set, what it handed to next(), or "next()" for an admitted
 * request.
 */
async function run(
  surface: TelemetryIngestSurface | null,
  headers: Record<string, string> = { "x-oneuptime-token": TOKEN },
): Promise<string> {
  let status: number | null = null;
  const req: ExpressRequest = {
    headers,
    body: Buffer.alloc(10),
    id: "test-request-id",
  } as unknown as ExpressRequest;
  const res: Record<string, unknown> = {
    headersSent: false,
    setHeader: jest.fn(),
    status: (code: number): Record<string, unknown> => {
      status = code;
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

  const sent: unknown = (Response.sendErrorResponse as MockFn).mock
    .calls[0]?.[2];

  if (sent instanceof Error) {
    return sent.constructor.name;
  }

  if (status !== null) {
    return `HTTP ${status}`;
  }

  if (next.mock.calls.length !== 1) {
    return `next() called ${next.mock.calls.length} times`;
  }

  const handedOn: unknown = next.mock.calls[0]![0];

  return handedOn instanceof Error
    ? `next(${handedOn.constructor.name})`
    : "next()";
}

beforeEach(() => {
  jest.clearAllMocks();
  // Refusals are counted against the key; that count has its own suites.
  jest
    .spyOn(TelemetryIngestRefusalRecorder, "record")
    .mockImplementation(() => {});
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
  markUsed().mockResolvedValue(undefined as never);
  (TelemetryIngestionKeyRateLimiter.consume as MockFn).mockResolvedValue({
    outcome: TelemetryIngestionKeyLimitOutcome.Allowed,
  } as never);
  (TelemetryIngestionBudget.admit as unknown as MockFn).mockResolvedValue({
    refusal: null,
    charge: null,
  } as never);
  resolveTo(buildPolicy());
  // Calls through, so the key service's markUsed is still reached.
  stamp = jest.spyOn(TelemetryIngestionKeyLastUsed, "stamp");
});

afterEach(() => {
  jest.restoreAllMocks();
});

interface AdmittedCase {
  label: string;
  surface: TelemetryIngestSurface | null;
  headers?: Record<string, string>;
  policy: () => TelemetryIngestionKeyPolicy;
  arrange?: () => void;
}

const ADMITTED_CASES: Array<AdmittedCase> = [
  {
    label: "a Server key on an OTLP endpoint",
    surface: TelemetryIngestSurface.OtelTraces,
    policy: (): TelemetryIngestionKeyPolicy => {
      return buildPolicy();
    },
  },
  {
    label: "a Server key on the legacy guard, which names no endpoint",
    surface: null,
    policy: (): TelemetryIngestionKeyPolicy => {
      return buildPolicy();
    },
  },
  {
    label: "a Browser key from a listed origin, on an endpoint it may use",
    surface: TelemetryIngestSurface.OtelLogs,
    headers: { "x-oneuptime-token": TOKEN, origin: ALLOWED_ORIGIN },
    policy: (): TelemetryIngestionKeyPolicy => {
      return browserKey();
    },
  },
  {
    label: "a key under its own requests-per-minute limit",
    surface: TelemetryIngestSurface.OtelMetrics,
    policy: (): TelemetryIngestionKeyPolicy => {
      return buildPolicy({ requestsPerMinuteLimit: 10 });
    },
  },
  {
    label: "a key the limiter cannot count, admitted unthrottled",
    surface: TelemetryIngestSurface.OtelMetrics,
    policy: (): TelemetryIngestionKeyPolicy => {
      return buildPolicy({ requestsPerMinuteLimit: 10 });
    },
    arrange: (): void => {
      (TelemetryIngestionKeyRateLimiter.consume as MockFn).mockResolvedValue({
        outcome: TelemetryIngestionKeyLimitOutcome.CounterUnavailable,
      } as never);
    },
  },
  {
    label: "a key pinned to one service, on a telemetry endpoint",
    surface: TelemetryIngestSurface.Fluent,
    policy: (): TelemetryIngestionKeyPolicy => {
      return buildPolicy({ pinnedServiceName: "checkout" });
    },
  },
  {
    label: "a key that expires in an hour",
    surface: TelemetryIngestSurface.OtelProfiles,
    policy: (): TelemetryIngestionKeyPolicy => {
      return buildPolicy({ expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
    },
  },
];

describe("an admitted request stamps the key that sent it, through the shared helper", () => {
  test.each(ADMITTED_CASES)("$label", async (admitted: AdmittedCase) => {
    const policy: TelemetryIngestionKeyPolicy = admitted.policy();
    resolveTo(policy);
    admitted.arrange?.();

    expect(await run(admitted.surface, admitted.headers)).toBe("next()");

    expect(stamp).toHaveBeenCalledTimes(1);
    expect(stamp).toHaveBeenCalledWith(policy);
    expect(markUsed()).toHaveBeenCalledTimes(1);
    expect(String(markUsed().mock.calls[0]![0])).toBe(KEY_ID);
  });
});

interface RefusedCase {
  label: string;
  surface: TelemetryIngestSurface | null;
  headers?: Record<string, string>;
  arrange: () => void;
  // How the sender is answered (see run()).
  answer: string;
}

const REFUSED_CASES: Array<RefusedCase> = [
  {
    label: "no token",
    surface: TelemetryIngestSurface.OtelTraces,
    headers: {},
    arrange: (): void => {},
    answer: "NotAuthenticatedException",
  },
  {
    label: "a token no key has",
    surface: TelemetryIngestSurface.OtelTraces,
    arrange: (): void => {
      resolveTo(null);
    },
    answer: "NotAuthenticatedException",
  },
  {
    label: "a key that is switched off",
    surface: TelemetryIngestSurface.OtelTraces,
    arrange: (): void => {
      resolveTo(buildPolicy({ isEnabled: false }));
    },
    answer: "NotAuthorizedException",
  },
  {
    label: "a key past its expiry date",
    surface: TelemetryIngestSurface.OtelLogs,
    arrange: (): void => {
      resolveTo(buildPolicy({ expiresAt: new Date(Date.now() - 60 * 1000) }));
    },
    answer: "NotAuthenticatedException",
  },
  {
    label: "a Browser key on an endpoint only Server keys may use",
    surface: TelemetryIngestSurface.Syslog,
    headers: { "x-oneuptime-token": TOKEN, origin: ALLOWED_ORIGIN },
    arrange: (): void => {
      resolveTo(browserKey());
    },
    answer: "NotAuthorizedException",
  },
  {
    label: "a Browser key on the legacy guard, which is Server-only",
    surface: null,
    headers: { "x-oneuptime-token": TOKEN, origin: ALLOWED_ORIGIN },
    arrange: (): void => {
      resolveTo(browserKey());
    },
    answer: "NotAuthorizedException",
  },
  {
    label: "a Browser key from an origin it does not list",
    surface: TelemetryIngestSurface.OtelTraces,
    headers: {
      "x-oneuptime-token": TOKEN,
      origin: "https://elsewhere.example.org",
    },
    arrange: (): void => {
      resolveTo(browserKey());
    },
    answer: "NotAuthorizedException",
  },
  {
    label: "a Browser key with no Origin header",
    surface: TelemetryIngestSurface.OtelTraces,
    arrange: (): void => {
      resolveTo(browserKey());
    },
    answer: "NotAuthorizedException",
  },
  {
    label: "a key pinned to one service, registering a Kubernetes agent",
    surface: TelemetryIngestSurface.KubernetesAgentRunner,
    arrange: (): void => {
      resolveTo(buildPolicy({ pinnedServiceName: "checkout" }));
    },
    answer: "NotAuthorizedException",
  },
  {
    label: "a key over its own requests-per-minute limit",
    surface: TelemetryIngestSurface.OtelLogs,
    arrange: (): void => {
      resolveTo(buildPolicy({ requestsPerMinuteLimit: 10 }));
      (TelemetryIngestionKeyRateLimiter.consume as MockFn).mockResolvedValue({
        outcome: TelemetryIngestionKeyLimitOutcome.RateLimited,
        retryAfterSeconds: 30,
        isFirstRejectionInWindow: false,
      } as never);
    },
    answer: "TooManyRequestsException",
  },
  {
    label: "a request over the project's daily ingestion budget",
    surface: TelemetryIngestSurface.OtelLogs,
    arrange: (): void => {
      refuseOnBudget(
        budgetRefusal(
          TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted,
          TelemetryIngestionBudgetScope.Project,
        ),
      );
    },
    answer: "HTTP 403",
  },
  {
    label: "a request over the key's own ingestion rate",
    surface: TelemetryIngestSurface.OtelLogs,
    arrange: (): void => {
      refuseOnBudget(
        budgetRefusal(
          TelemetryIngestionBudgetRefusalKind.RateLimited,
          TelemetryIngestionBudgetScope.IngestionKey,
        ),
      );
    },
    answer: "HTTP 429",
  },
  {
    label: "a key of a project with no way to pay",
    surface: TelemetryIngestSurface.OtelTraces,
    arrange: (): void => {
      rejectWith(new PaymentRequiredException("Payment required"));
    },
    answer: "next(PaymentRequiredException)",
  },
  {
    label: "a key of a project an administrator blocked",
    surface: TelemetryIngestSurface.OtelTraces,
    arrange: (): void => {
      rejectWith(new ProjectBlockedException());
    },
    answer: "next(ProjectBlockedException)",
  },
  {
    label: "a key whose lookup fails",
    surface: TelemetryIngestSurface.OtelTraces,
    arrange: (): void => {
      rejectWith(new BadDataException("database unavailable"));
    },
    answer: "next(BadDataException)",
  },
];

describe("a refused or failed request stamps nothing", () => {
  test.each(REFUSED_CASES)("$label", async (refused: RefusedCase) => {
    refused.arrange();

    expect(await run(refused.surface, refused.headers)).toBe(refused.answer);

    expect(stamp).not.toHaveBeenCalled();
    expect(markUsed()).not.toHaveBeenCalled();
  });
});
