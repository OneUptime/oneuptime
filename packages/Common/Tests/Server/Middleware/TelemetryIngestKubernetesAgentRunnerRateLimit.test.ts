import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import TelemetryIngest, {
  DEFAULT_KUBERNETES_AGENT_RUNNER_REQUESTS_PER_MINUTE,
  getEffectiveRequestsPerMinuteLimit,
  TelemetryRequest,
} from "../../../Server/Middleware/TelemetryIngest";
import TelemetryIngestionKeyService from "../../../Server/Services/TelemetryIngestionKeyService";
import Response from "../../../Server/Utils/Response";
import TelemetryIngestionKeyRateLimiter, {
  TelemetryIngestionKeyLimitDecision,
  TelemetryIngestionKeyLimitOutcome,
} from "../../../Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../../Types/ObjectID";
import TelemetryIngestionKeyPolicy, {
  DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE,
} from "../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";

/*
 * The Kubernetes agent Runner registration endpoint is reached with the
 * project's telemetry ingestion key - the same key every agent pod carries -
 * and it mints Runner identities rather than accepting telemetry. A server
 * key with no configured limit is unlimited on every OTLP surface (that is
 * the backwards-compatibility contract of the rate limit feature), so
 * without a surface-specific default a leaked key could register Runners as
 * fast as the API accepts requests.
 *
 * Pinned here:
 *   1. On the registration surface a server key with NO configured limit is
 *      held to the conservative shipped default, and the limiter IS
 *      consulted for it.
 *   2. An explicit per-key limit still wins there.
 *   3. Every other surface keeps the server-key contract exactly: no limit,
 *      no limiter call.
 *   4. A registration request over the default is refused 429 like any other
 *      rate-limited request, Retry-After included.
 *
 * Same module-boundary mocks as the browser key guard suite: no Postgres, no
 * Redis.
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

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
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

type MockFn = jest.Mock;

const PROJECT_ID: string = "5d3b0f1a-0000-4000-8000-000000000011";
const INGESTION_KEY_ID: string = "5d3b0f1a-0000-4000-8000-000000000012";
const SENTINEL_TOKEN: string = "sentinel-secret-ingestion-key-67890";

const ALL_SURFACES: Array<TelemetryIngestSurface> = Object.values(
  TelemetryIngestSurface,
) as Array<TelemetryIngestSurface>;

const NON_REGISTRATION_SURFACES: Array<TelemetryIngestSurface> =
  ALL_SURFACES.filter((surface: TelemetryIngestSurface): boolean => {
    return surface !== TelemetryIngestSurface.KubernetesAgentRunner;
  });

type BuildPolicyFunction = (
  overrides: Partial<TelemetryIngestionKeyPolicy>,
) => TelemetryIngestionKeyPolicy;

const buildServerPolicy: BuildPolicyFunction = (
  overrides: Partial<TelemetryIngestionKeyPolicy>,
): TelemetryIngestionKeyPolicy => {
  return {
    ingestionKeyId: new ObjectID(INGESTION_KEY_ID),
    projectId: new ObjectID(PROJECT_ID),
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ...overrides,
  };
};

type ResolveToFunction = (policy: TelemetryIngestionKeyPolicy | null) => void;

const resolveTo: ResolveToFunction = (
  policy: TelemetryIngestionKeyPolicy | null,
): void => {
  (
    TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn
  ).mockResolvedValue(policy as never);
};

interface RunResult {
  req: ExpressRequest;
  next: MockFn;
  setHeader: MockFn;
}

type RunFunction = (surface: TelemetryIngestSurface) => Promise<RunResult>;

const run: RunFunction = async (
  surface: TelemetryIngestSurface,
): Promise<RunResult> => {
  const req: ExpressRequest = {
    headers: { "x-oneuptime-token": SENTINEL_TOKEN },
    id: "test-request-id",
  } as unknown as ExpressRequest;

  const setHeader: MockFn = jest.fn();
  const res: ExpressResponse = {
    setHeader,
  } as unknown as ExpressResponse;
  const next: MockFn = jest.fn();

  await TelemetryIngest.forSurface(surface)(
    req,
    res,
    next as unknown as NextFunction,
  );

  return { req, next, setHeader };
};

type LimiterAnswersFunction = (
  outcome: TelemetryIngestionKeyLimitOutcome,
  extra?: Partial<TelemetryIngestionKeyLimitDecision>,
) => void;

const limiterAnswers: LimiterAnswersFunction = (
  outcome: TelemetryIngestionKeyLimitOutcome,
  extra?: Partial<TelemetryIngestionKeyLimitDecision>,
): void => {
  (TelemetryIngestionKeyRateLimiter.consume as MockFn).mockResolvedValue({
    outcome,
    ...(extra || {}),
  } as never);
};

type ConsumeArgsFunction = () => Record<string, unknown>;

const firstConsumeCallArgs: ConsumeArgsFunction = (): Record<
  string,
  unknown
> => {
  return (TelemetryIngestionKeyRateLimiter.consume as MockFn).mock
    .calls[0]?.[0] as Record<string, unknown>;
};

describe("TelemetryIngest Kubernetes agent Runner registration rate limit", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (TelemetryIngestionKeyService.markUsed as MockFn).mockResolvedValue(
      undefined as never,
    );

    limiterAnswers(TelemetryIngestionKeyLimitOutcome.Allowed);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getEffectiveRequestsPerMinuteLimit with a surface", () => {
    test("a server key with no configured limit gets the shipped registration default on the registration surface", () => {
      expect(
        getEffectiveRequestsPerMinuteLimit(
          buildServerPolicy({ requestsPerMinuteLimit: null }),
          TelemetryIngestSurface.KubernetesAgentRunner,
        ),
      ).toBe(DEFAULT_KUBERNETES_AGENT_RUNNER_REQUESTS_PER_MINUTE);

      /*
       * Registration is a handful of calls per pod lifetime; the number is
       * pinned so a "just bump it" change has to say so here.
       */
      expect(DEFAULT_KUBERNETES_AGENT_RUNNER_REQUESTS_PER_MINUTE).toBe(30);
      expect(DEFAULT_KUBERNETES_AGENT_RUNNER_REQUESTS_PER_MINUTE).toBeLessThan(
        DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE,
      );
    });

    test("an explicit per-key limit wins on the registration surface too", () => {
      expect(
        getEffectiveRequestsPerMinuteLimit(
          buildServerPolicy({ requestsPerMinuteLimit: 7 }),
          TelemetryIngestSurface.KubernetesAgentRunner,
        ),
      ).toBe(7);
    });

    test("a degenerate configured limit falls back to the registration default, never to unlimited", () => {
      const degenerateValues: Array<number> = [
        0,
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        "100" as unknown as number,
      ];

      for (const value of degenerateValues) {
        expect(
          getEffectiveRequestsPerMinuteLimit(
            buildServerPolicy({ requestsPerMinuteLimit: value }),
            TelemetryIngestSurface.KubernetesAgentRunner,
          ),
        ).toBe(DEFAULT_KUBERNETES_AGENT_RUNNER_REQUESTS_PER_MINUTE);
      }
    });

    test("a server key with no configured limit stays unlimited on every other surface, with or without a surface named", () => {
      const policy: TelemetryIngestionKeyPolicy = buildServerPolicy({
        requestsPerMinuteLimit: null,
      });

      expect(getEffectiveRequestsPerMinuteLimit(policy)).toBeNull();
      expect(getEffectiveRequestsPerMinuteLimit(policy, null)).toBeNull();
      expect(getEffectiveRequestsPerMinuteLimit(policy, undefined)).toBeNull();

      for (const surface of NON_REGISTRATION_SURFACES) {
        expect(getEffectiveRequestsPerMinuteLimit(policy, surface)).toBeNull();
      }
    });

    test("a browser key keeps the browser default regardless of surface", () => {
      const policy: TelemetryIngestionKeyPolicy = buildServerPolicy({
        keyType: TelemetryIngestionKeyType.Browser,
        requestsPerMinuteLimit: null,
      });

      for (const surface of ALL_SURFACES) {
        expect(getEffectiveRequestsPerMinuteLimit(policy, surface)).toBe(
          DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE,
        );
      }
    });
  });

  describe("through the middleware", () => {
    test("a server key with no configured limit IS rate limited on the registration surface at the shipped default", async () => {
      resolveTo(buildServerPolicy({ requestsPerMinuteLimit: null }));

      const result: RunResult = await run(
        TelemetryIngestSurface.KubernetesAgentRunner,
      );

      expect(
        TelemetryIngestionKeyRateLimiter.consume as MockFn,
      ).toHaveBeenCalledTimes(1);
      expect(firstConsumeCallArgs()["limitPerMinute"]).toBe(
        DEFAULT_KUBERNETES_AGENT_RUNNER_REQUESTS_PER_MINUTE,
      );
      expect(firstConsumeCallArgs()["ingestionKeyId"]?.toString()).toBe(
        INGESTION_KEY_ID,
      );

      // Under the limit the registration proceeds as before.
      expect(Response.sendErrorResponse as MockFn).not.toHaveBeenCalled();
      expect(result.next).toHaveBeenCalledTimes(1);
      expect((result.req as TelemetryRequest).projectId.toString()).toBe(
        PROJECT_ID,
      );
    });

    test("an explicitly configured limit is what the limiter is asked to enforce there", async () => {
      resolveTo(buildServerPolicy({ requestsPerMinuteLimit: 5 }));

      await run(TelemetryIngestSurface.KubernetesAgentRunner);

      expect(firstConsumeCallArgs()["limitPerMinute"]).toBe(5);
    });

    test("a registration over the default is refused 429 with Retry-After", async () => {
      resolveTo(buildServerPolicy({ requestsPerMinuteLimit: null }));
      limiterAnswers(TelemetryIngestionKeyLimitOutcome.RateLimited, {
        retryAfterSeconds: 41,
        isFirstRejectionInWindow: true,
      });

      const result: RunResult = await run(
        TelemetryIngestSurface.KubernetesAgentRunner,
      );

      expect(result.next).not.toHaveBeenCalled();

      const sendErrorResponse: MockFn = Response.sendErrorResponse as MockFn;
      expect(sendErrorResponse).toHaveBeenCalledTimes(1);

      const error: Error = sendErrorResponse.mock.calls[0]?.[2] as Error;
      expect(error).toBeInstanceOf(TooManyRequestsException);
      expect(error.message).not.toContain(SENTINEL_TOKEN);
      expect(result.setHeader).toHaveBeenCalledWith("Retry-After", "41");
      expect((result.req as TelemetryRequest).projectId).toBeUndefined();
    });

    test("a server key with no configured limit never touches the limiter on any other surface", async () => {
      for (const surface of NON_REGISTRATION_SURFACES) {
        jest.clearAllMocks();
        (TelemetryIngestionKeyService.markUsed as MockFn).mockResolvedValue(
          undefined as never,
        );
        limiterAnswers(TelemetryIngestionKeyLimitOutcome.Allowed);
        resolveTo(buildServerPolicy({ requestsPerMinuteLimit: null }));

        const result: RunResult = await run(surface);

        /*
         * The whole backwards-compatibility contract of the rate limit
         * feature: an existing server key on an OTLP surface pays no Redis
         * round trip. The registration default must not have leaked here.
         */
        expect(
          TelemetryIngestionKeyRateLimiter.consume as MockFn,
        ).not.toHaveBeenCalled();
        expect(Response.sendErrorResponse as MockFn).not.toHaveBeenCalled();
        expect(result.next).toHaveBeenCalledTimes(1);
      }
    });
  });
});
