import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import TelemetryIngest, {
  getEffectiveRequestsPerMinuteLimit,
  TelemetryRequest,
} from "../../../Server/Middleware/TelemetryIngest";
import TelemetryIngestionKeyService from "../../../Server/Services/TelemetryIngestionKeyService";
import Response from "../../../Server/Utils/Response";
import logger from "../../../Server/Utils/Logger";
import TelemetryIngestionKeyRateLimiter, {
  TelemetryIngestionKeyLimitDecision,
  TelemetryIngestionKeyLimitOutcome,
} from "../../../Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../../Types/ObjectID";
import TelemetryIngestionKeyPolicy, {
  DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE,
} from "../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestSurface, {
  BROWSER_ALLOWED_INGEST_SURFACES,
  getIngestSurfaceReadableName,
} from "../../../Types/Telemetry/TelemetryIngestSurface";

/*
 * The ingest guard is the ONLY thing standing between a telemetry ingestion
 * key that is deliberately published in a customer's page source and the write
 * side of their project. Everything else about browser keys - the origin
 * allowlist column, the surface enum, the expiry, the kill switch - is inert
 * configuration until this middleware reads it, so every constraint the
 * feature claims has to be pinned HERE or it is not enforced anywhere.
 *
 * Four properties, in order of how expensive they are to get wrong:
 *
 *   1. A BROWSER KEY FAILS CLOSED ON EVERY AXIS. Wrong surface, wrong origin,
 *      missing Origin header and - the one that matters most - an EMPTY
 *      allowlist are all refusals. Empty-means-any-origin is the reading
 *      SessionReplayGateCache deliberately takes for its own column, and
 *      taking it here would recreate exactly the unbounded public write
 *      credential this feature exists to delete. The legacy unnamed-surface
 *      alias refuses browser keys too, so a route someone forgets to migrate
 *      is a support ticket rather than a hole.
 *
 *   2. A SERVER KEY BEHAVES EXACTLY AS IT DID BEFORE THIS SHIPPED. Every key
 *      that predates the feature resolves as Server, enabled, no expiry, no
 *      limit, and it must reach every surface, ignore the Origin header
 *      entirely, and - asserted explicitly - never touch the rate limiter,
 *      because that path fronts every OTLP payload the product accepts and is
 *      not allowed to grow a Redis round trip.
 *
 *   3. THE LIMITER FAILS OPEN. CounterUnavailable admits the request. That is
 *      a deliberate trade - a Redis blip must not become permanent,
 *      unreplayable customer data loss with their incident dashboards dark -
 *      and a future "hardening" pass would otherwise flip it silently.
 *
 *   4. THE TOKEN NEVER LEAKS. Ingestion keys are secrets; a refusal that
 *      echoes the presented value into a log line or a response body is a
 *      credential disclosure. Asserted across every refusal branch at once.
 *
 * Nothing here touches Postgres or Redis: the key resolver, the limiter and
 * the responder are all mocked at the module boundary.
 */

/*
 * The token resolver is mocked so every key shape - disabled, expired,
 * browser, server - can be forced without a database.
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

/*
 * Only the default export (the class with consume()) is replaced. The real
 * outcome enum is kept, because the middleware compares against it by value
 * and a hand-rolled copy in the mock would let a renamed member pass this
 * suite while breaking production.
 */
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

const PROJECT_ID: string = "5d3b0f1a-0000-4000-8000-000000000001";
const INGESTION_KEY_ID: string = "5d3b0f1a-0000-4000-8000-000000000002";

/*
 * Shaped like a real (mistyped) ingestion key so the substring checks in the
 * hygiene suite are meaningful.
 */
const SENTINEL_TOKEN: string = "sentinel-secret-ingestion-key-12345";

const ALLOWED_ORIGIN: string = "https://app.example.com";

const ALL_SURFACES: Array<TelemetryIngestSurface> = Object.values(
  TelemetryIngestSurface,
) as Array<TelemetryIngestSurface>;

const BROWSER_DISALLOWED_SURFACES: Array<TelemetryIngestSurface> =
  ALL_SURFACES.filter((surface: TelemetryIngestSurface): boolean => {
    return !BROWSER_ALLOWED_INGEST_SURFACES.has(surface);
  });

type BuildPolicyFunction = (
  overrides: Partial<TelemetryIngestionKeyPolicy>,
) => TelemetryIngestionKeyPolicy;

const buildPolicy: BuildPolicyFunction = (
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

const buildBrowserPolicy: BuildPolicyFunction = (
  overrides: Partial<TelemetryIngestionKeyPolicy>,
): TelemetryIngestionKeyPolicy => {
  return buildPolicy({
    keyType: TelemetryIngestionKeyType.Browser,
    allowedOrigins: [ALLOWED_ORIGIN],
    ...overrides,
  });
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
  res: ExpressResponse;
  next: MockFn;
  setHeader: MockFn;
}

type RunFunction = (
  surface: TelemetryIngestSurface | null,
  headers: Record<string, string>,
) => Promise<RunResult>;

/*
 * `surface === null` runs the legacy isAuthorizedServiceMiddleware alias,
 * which is the un-migrated-route case rather than a separate code path.
 */
const run: RunFunction = async (
  surface: TelemetryIngestSurface | null,
  headers: Record<string, string>,
): Promise<RunResult> => {
  const req: ExpressRequest = {
    headers,
    id: "test-request-id",
  } as unknown as ExpressRequest;

  const setHeader: MockFn = jest.fn();
  const res: ExpressResponse = {
    setHeader,
  } as unknown as ExpressResponse;
  const next: MockFn = jest.fn();

  if (surface === null) {
    await TelemetryIngest.isAuthorizedServiceMiddleware(
      req,
      res,
      next as unknown as NextFunction,
    );
  } else {
    await TelemetryIngest.forSurface(surface)(
      req,
      res,
      next as unknown as NextFunction,
    );
  }

  return { req, res, next, setHeader };
};

type TokenHeadersFunction = (
  extra?: Record<string, string>,
) => Record<string, string>;

const tokenHeaders: TokenHeadersFunction = (
  extra?: Record<string, string>,
): Record<string, string> => {
  return {
    "x-oneuptime-token": SENTINEL_TOKEN,
    ...(extra || {}),
  };
};

type RefusalFunction = () => Error;

/*
 * The exception handed to Response.sendErrorResponse IS the status code:
 * NotAuthenticatedException is 401, NotAuthorizedException 403,
 * TooManyRequestsException 429. Asserting on the class is asserting on what
 * the caller receives.
 */
const refusal: RefusalFunction = (): Error => {
  const sendErrorResponse: MockFn = Response.sendErrorResponse as MockFn;

  expect(sendErrorResponse).toHaveBeenCalledTimes(1);

  return sendErrorResponse.mock.calls[0]?.[2] as Error;
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

type ArrangeDefaultsFunction = () => void;

const arrangeDefaults: ArrangeDefaultsFunction = (): void => {
  /*
   * markUsed is fire-and-forget with a .catch() attached, so it has to return
   * a promise or the success path throws before it ever reaches next().
   */
  (TelemetryIngestionKeyService.markUsed as MockFn).mockResolvedValue(
    undefined as never,
  );

  limiterAnswers(TelemetryIngestionKeyLimitOutcome.Allowed);
};

describe("TelemetryIngest browser ingestion key guard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    arrangeDefaults();
  });

  describe("token resolution", () => {
    test("a request with no ingestion token is refused 401 without consulting the resolver", async () => {
      const result: RunResult = await run(
        TelemetryIngestSurface.OtelTraces,
        {},
      );

      expect(
        TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn,
      ).not.toHaveBeenCalled();
      expect(result.next).not.toHaveBeenCalled();

      const error: Error = refusal();
      expect(error).toBeInstanceOf(NotAuthenticatedException);
      expect(error.message).toBe(
        "Missing ingestion token. Send your OneUptime telemetry ingestion key in the x-oneuptime-token header.",
      );
    });

    test("a token that resolves to no key is refused 401 with the unchanged invalid-token message", async () => {
      resolveTo(null);

      const result: RunResult = await run(
        TelemetryIngestSurface.OtelTraces,
        tokenHeaders(),
      );

      expect(result.next).not.toHaveBeenCalled();

      const error: Error = refusal();
      expect(error).toBeInstanceOf(NotAuthenticatedException);
      expect(error.message).toBe(
        "Invalid ingestion token. Send a valid OneUptime telemetry ingestion key in the x-oneuptime-token header.",
      );
    });

    test("all three accepted header names still carry the ingestion token", async () => {
      for (const headerName of [
        "x-oneuptime-token",
        "x-oneuptime-service-token",
        "x-oneuptime-ingestion-key",
      ]) {
        jest.clearAllMocks();
        arrangeDefaults();
        resolveTo(buildPolicy({}));

        const result: RunResult = await run(TelemetryIngestSurface.OtelTraces, {
          [headerName]: SENTINEL_TOKEN,
        });

        expect(
          TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn,
        ).toHaveBeenCalledWith(SENTINEL_TOKEN);
        expect(Response.sendErrorResponse as MockFn).not.toHaveBeenCalled();
        expect(result.next).toHaveBeenCalledTimes(1);
      }
    });
  });

  /*
   * Everything in this block is behaviour that existed before browser keys
   * did. A failure here is a regression for every installation on upgrade day,
   * not a gap in a new feature.
   */
  describe("server key backwards compatibility", () => {
    test("an enabled server key is admitted on every ingest surface, with the project and policy put on the request", async () => {
      for (const surface of ALL_SURFACES) {
        jest.clearAllMocks();
        arrangeDefaults();

        const policy: TelemetryIngestionKeyPolicy = buildPolicy({});
        resolveTo(policy);

        const result: RunResult = await run(surface, tokenHeaders());

        expect(Response.sendErrorResponse as MockFn).not.toHaveBeenCalled();
        expect(result.next).toHaveBeenCalledTimes(1);
        expect((result.req as TelemetryRequest).projectId.toString()).toBe(
          PROJECT_ID,
        );
        expect((result.req as TelemetryRequest).ingestionKeyPolicy).toBe(
          policy,
        );
      }
    });

    test("a server key with no configured limit never reaches the rate limiter at all", async () => {
      resolveTo(buildPolicy({ requestsPerMinuteLimit: null }));

      const result: RunResult = await run(
        TelemetryIngestSurface.OtelTraces,
        tokenHeaders(),
      );

      /*
       * Not "is allowed" - never CALLED. The overwhelmingly common request in
       * production is exactly this shape, and a Redis round trip added to it
       * is latency on every OTLP payload the product accepts.
       */
      expect(
        TelemetryIngestionKeyRateLimiter.consume as MockFn,
      ).not.toHaveBeenCalled();
      expect(result.next).toHaveBeenCalledTimes(1);
    });

    test("a server key is admitted when the request sends no Origin header", async () => {
      resolveTo(buildPolicy({ allowedOrigins: [ALLOWED_ORIGIN] }));

      const result: RunResult = await run(
        TelemetryIngestSurface.OtelTraces,
        tokenHeaders(),
      );

      expect(Response.sendErrorResponse as MockFn).not.toHaveBeenCalled();
      expect(result.next).toHaveBeenCalledTimes(1);
    });

    test("a server key is admitted even when the request carries an Origin outside its allowlist", async () => {
      resolveTo(buildPolicy({ allowedOrigins: [ALLOWED_ORIGIN] }));

      const result: RunResult = await run(
        TelemetryIngestSurface.OtelTraces,
        tokenHeaders({ origin: "https://not-on-the-list.example.com" }),
      );

      /*
       * A server key is never published, so an Origin header on a request
       * carrying one says nothing about who is calling. Enforcing it would
       * break every proxy and browser-adjacent server client that sends one.
       */
      expect(Response.sendErrorResponse as MockFn).not.toHaveBeenCalled();
      expect(result.next).toHaveBeenCalledTimes(1);
    });

    test("a policy whose key type is absent is treated as a server key, not as a browser key", async () => {
      /*
       * Every key that predates this feature reads back with keyType NULL.
       * TelemetryIngestionKeyService resolves that to Server, but the guard
       * carries its own copy of the rule (`keyType === Browser`), and that is
       * the one that decides. Pinned here because getting it backwards - a
       * missing type treated as Browser - would refuse every existing
       * customer's server ingest the moment they upgraded: wrong surface,
       * missing Origin header, closed allowlist, all at once.
       */
      resolveTo(
        buildPolicy({
          keyType: null as unknown as TelemetryIngestionKeyType,
        }),
      );

      const result: RunResult = await run(
        TelemetryIngestSurface.Syslog,
        tokenHeaders(),
      );

      expect(Response.sendErrorResponse as MockFn).not.toHaveBeenCalled();
      expect(result.next).toHaveBeenCalledTimes(1);
      expect(
        TelemetryIngestionKeyRateLimiter.consume as MockFn,
      ).not.toHaveBeenCalled();
    });

    test("a server key with an explicitly configured limit is rate limited like any other key", async () => {
      resolveTo(buildPolicy({ requestsPerMinuteLimit: 120 }));

      const result: RunResult = await run(
        TelemetryIngestSurface.OtelTraces,
        tokenHeaders(),
      );

      expect(
        TelemetryIngestionKeyRateLimiter.consume as MockFn,
      ).toHaveBeenCalledTimes(1);

      const call: Record<string, unknown> = firstConsumeCallArgs();
      expect(call["limitPerMinute"]).toBe(120);
      expect(String(call["ingestionKeyId"])).toBe(INGESTION_KEY_ID);
      expect(result.next).toHaveBeenCalledTimes(1);
    });
  });

  describe("kill switch and expiry", () => {
    test("a disabled key is refused 403 whatever its type", async () => {
      for (const keyType of [
        TelemetryIngestionKeyType.Server,
        TelemetryIngestionKeyType.Browser,
      ]) {
        jest.clearAllMocks();
        arrangeDefaults();
        resolveTo(
          buildPolicy({
            keyType,
            isEnabled: false,
            allowedOrigins: [ALLOWED_ORIGIN],
          }),
        );

        const result: RunResult = await run(
          TelemetryIngestSurface.OtelTraces,
          tokenHeaders({ origin: ALLOWED_ORIGIN }),
        );

        expect(result.next).not.toHaveBeenCalled();

        const error: Error = refusal();
        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect(error.message).toBe(
          "This telemetry ingestion key has been disabled.",
        );
      }
    });

    test("the kill switch is checked before the surface and origin rules, so disabling a leaked key always reports as disabled", async () => {
      resolveTo(
        buildBrowserPolicy({
          isEnabled: false,
          allowedOrigins: ["https://only-this.example.com"],
        }),
      );

      /*
       * Disallowed surface AND a disallowed origin AND disabled. Whichever
       * refusal wins is what a customer sees while working out whether their
       * kill switch actually took effect, so it has to be the disable.
       */
      await run(
        TelemetryIngestSurface.Syslog,
        tokenHeaders({ origin: "https://somewhere-else.example.com" }),
      );

      const error: Error = refusal();
      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error.message).toBe(
        "This telemetry ingestion key has been disabled.",
      );
    });

    test("a key whose expiry is in the past is refused 401", async () => {
      resolveTo(buildPolicy({ expiresAt: new Date(Date.now() - 60 * 1000) }));

      const result: RunResult = await run(
        TelemetryIngestSurface.OtelTraces,
        tokenHeaders(),
      );

      expect(result.next).not.toHaveBeenCalled();

      const error: Error = refusal();
      expect(error).toBeInstanceOf(NotAuthenticatedException);
      expect(error.message).toBe("This telemetry ingestion key expired.");
    });

    test("a key whose expiry is exactly now is refused rather than admitted on the boundary", async () => {
      const frozenNow: number = new Date("2026-01-01T00:00:00.000Z").getTime();
      const nowSpy: { mockRestore: () => void } = jest
        .spyOn(Date, "now")
        .mockReturnValue(frozenNow) as unknown as { mockRestore: () => void };

      try {
        resolveTo(buildPolicy({ expiresAt: new Date(frozenNow) }));

        const result: RunResult = await run(
          TelemetryIngestSurface.OtelTraces,
          tokenHeaders(),
        );

        expect(result.next).not.toHaveBeenCalled();
        expect(refusal()).toBeInstanceOf(NotAuthenticatedException);
      } finally {
        nowSpy.mockRestore();
      }
    });

    test("a key whose expiry is in the future is admitted", async () => {
      resolveTo(
        buildPolicy({ expiresAt: new Date(Date.now() + 60 * 60 * 1000) }),
      );

      const result: RunResult = await run(
        TelemetryIngestSurface.OtelTraces,
        tokenHeaders(),
      );

      expect(Response.sendErrorResponse as MockFn).not.toHaveBeenCalled();
      expect(result.next).toHaveBeenCalledTimes(1);
    });

    test("a key with no expiry set never expires", async () => {
      resolveTo(buildPolicy({ expiresAt: null }));

      const result: RunResult = await run(
        TelemetryIngestSurface.OtelTraces,
        tokenHeaders(),
      );

      expect(Response.sendErrorResponse as MockFn).not.toHaveBeenCalled();
      expect(result.next).toHaveBeenCalledTimes(1);
    });

    test("the expired-key refusal does not disclose when the key expired", async () => {
      const expiredAt: Date = new Date("2021-03-04T05:06:07.000Z");
      resolveTo(buildPolicy({ expiresAt: expiredAt }));

      await run(TelemetryIngestSurface.OtelTraces, tokenHeaders());

      const message: string = refusal().message;

      /*
       * Whoever is holding a dead key is not entitled to details of the
       * project's credentials; the owner reads the expiry in the dashboard.
       */
      expect(message).not.toContain(expiredAt.toISOString());
      expect(message).not.toContain(String(expiredAt.getTime()));
      expect(message).not.toContain("2021");
    });
  });

  describe("browser key surface allowlist", () => {
    test("a browser key is admitted on exactly the four surfaces a real browser agent emits", async () => {
      expect(Array.from(BROWSER_ALLOWED_INGEST_SURFACES).sort()).toEqual(
        [
          TelemetryIngestSurface.OtelLogs,
          TelemetryIngestSurface.OtelMetrics,
          TelemetryIngestSurface.OtelTraces,
          TelemetryIngestSurface.SessionReplay,
        ].sort(),
      );

      for (const surface of Array.from(BROWSER_ALLOWED_INGEST_SURFACES)) {
        jest.clearAllMocks();
        arrangeDefaults();
        resolveTo(buildBrowserPolicy({}));

        const result: RunResult = await run(
          surface,
          tokenHeaders({ origin: ALLOWED_ORIGIN }),
        );

        expect(Response.sendErrorResponse as MockFn).not.toHaveBeenCalled();
        expect(result.next).toHaveBeenCalledTimes(1);
      }
    });

    test("a browser key is refused 403 on every other surface, naming the surface and pointing at a server key", async () => {
      expect(BROWSER_DISALLOWED_SURFACES.length).toBe(10);

      for (const surface of BROWSER_DISALLOWED_SURFACES) {
        jest.clearAllMocks();
        arrangeDefaults();
        resolveTo(buildBrowserPolicy({}));

        const result: RunResult = await run(
          surface,
          tokenHeaders({ origin: ALLOWED_ORIGIN }),
        );

        expect(result.next).not.toHaveBeenCalled();

        const error: Error = refusal();
        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect(error.message).toBe(
          `A browser ingestion key cannot be used for ${getIngestSurfaceReadableName(
            surface,
          )}. Use a server ingestion key.`,
        );
      }
    });
  });

  describe("browser key origin allowlist", () => {
    test("a browser key is admitted from an origin on its allowlist", async () => {
      resolveTo(buildBrowserPolicy({ allowedOrigins: [ALLOWED_ORIGIN] }));

      const result: RunResult = await run(
        TelemetryIngestSurface.OtelTraces,
        tokenHeaders({ origin: ALLOWED_ORIGIN }),
      );

      expect(Response.sendErrorResponse as MockFn).not.toHaveBeenCalled();
      expect(result.next).toHaveBeenCalledTimes(1);
    });

    test("a browser key is admitted from a subdomain covered by a wildcard entry", async () => {
      resolveTo(
        buildBrowserPolicy({ allowedOrigins: ["https://*.example.com"] }),
      );

      const result: RunResult = await run(
        TelemetryIngestSurface.OtelTraces,
        tokenHeaders({ origin: "https://tenant-42.example.com" }),
      );

      expect(Response.sendErrorResponse as MockFn).not.toHaveBeenCalled();
      expect(result.next).toHaveBeenCalledTimes(1);
    });

    test("a browser key is refused 403 from an origin outside its allowlist, and the refusal echoes the offending origin", async () => {
      const offendingOrigin: string = "https://attacker.example.net";
      resolveTo(buildBrowserPolicy({ allowedOrigins: [ALLOWED_ORIGIN] }));

      const result: RunResult = await run(
        TelemetryIngestSurface.OtelTraces,
        tokenHeaders({ origin: offendingOrigin }),
      );

      expect(result.next).not.toHaveBeenCalled();

      const error: Error = refusal();
      expect(error).toBeInstanceOf(NotAuthorizedException);
      /*
       * The origin is the caller's own value and never a secret, and a
       * scheme / port / trailing-slash mismatch stays invisible until the two
       * strings are put side by side.
       */
      expect(error.message).toContain(offendingOrigin);
    });

    test("a browser key request with no Origin header is refused 403 and told the header was missing", async () => {
      resolveTo(buildBrowserPolicy({ allowedOrigins: [ALLOWED_ORIGIN] }));

      const result: RunResult = await run(
        TelemetryIngestSurface.OtelTraces,
        tokenHeaders(),
      );

      expect(result.next).not.toHaveBeenCalled();

      const error: Error = refusal();
      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error.message).toContain("did not send an Origin header");
      // "Origin  is not allowed" reads like a bug and helps nobody.
      expect(error.message).not.toContain("Origin  is not allowed");
    });

    test("a browser key with an EMPTY allowlist is refused - empty fails closed, it does not mean any origin", async () => {
      resolveTo(buildBrowserPolicy({ allowedOrigins: [] }));

      const result: RunResult = await run(
        TelemetryIngestSurface.OtelTraces,
        tokenHeaders({ origin: ALLOWED_ORIGIN }),
      );

      /*
       * THE most important assertion in this file. SessionReplayGateCache
       * reads an empty allowlist as "any origin" because that feature shipped
       * that way; reading it the same way here would make a key published in
       * a page usable from anywhere on the internet, which is precisely the
       * credential this feature exists to remove.
       */
      expect(result.next).not.toHaveBeenCalled();

      const error: Error = refusal();
      expect(error).toBeInstanceOf(NotAuthorizedException);
    });
  });

  describe("per-key rate limit", () => {
    test("a browser key with no configured limit is held to the shipped browser default", async () => {
      resolveTo(buildBrowserPolicy({ requestsPerMinuteLimit: null }));

      await run(
        TelemetryIngestSurface.OtelTraces,
        tokenHeaders({ origin: ALLOWED_ORIGIN }),
      );

      expect(
        TelemetryIngestionKeyRateLimiter.consume as MockFn,
      ).toHaveBeenCalledTimes(1);
      expect(firstConsumeCallArgs()["limitPerMinute"]).toBe(
        DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE,
      );
      expect(DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE).toBe(6000);
    });

    test("an explicitly configured limit wins for both key types", async () => {
      for (const keyType of [
        TelemetryIngestionKeyType.Server,
        TelemetryIngestionKeyType.Browser,
      ]) {
        jest.clearAllMocks();
        arrangeDefaults();
        resolveTo(
          buildPolicy({
            keyType,
            allowedOrigins: [ALLOWED_ORIGIN],
            requestsPerMinuteLimit: 42,
          }),
        );

        await run(
          TelemetryIngestSurface.OtelTraces,
          tokenHeaders({ origin: ALLOWED_ORIGIN }),
        );

        expect(firstConsumeCallArgs()["limitPerMinute"]).toBe(42);
      }
    });

    test("a key over its limit is refused 429 and told when to come back", async () => {
      resolveTo(buildBrowserPolicy({ requestsPerMinuteLimit: 10 }));
      limiterAnswers(TelemetryIngestionKeyLimitOutcome.RateLimited, {
        retryAfterSeconds: 37,
        isFirstRejectionInWindow: true,
      });

      const result: RunResult = await run(
        TelemetryIngestSurface.OtelTraces,
        tokenHeaders({ origin: ALLOWED_ORIGIN }),
      );

      expect(result.next).not.toHaveBeenCalled();

      const error: Error = refusal();
      expect(error).toBeInstanceOf(TooManyRequestsException);
      expect(error.message).toBe(
        "Too many telemetry requests for this ingestion key. Please retry later.",
      );

      /*
       * Without Retry-After every refused client backs off by whatever
       * constant it picked, in lockstep, and re-collides on the next window.
       */
      expect(result.setHeader).toHaveBeenCalledWith("Retry-After", "37");
    });

    test("an unavailable rate limit counter FAILS OPEN and the telemetry is still accepted", async () => {
      resolveTo(buildBrowserPolicy({ requestsPerMinuteLimit: 10 }));
      limiterAnswers(TelemetryIngestionKeyLimitOutcome.CounterUnavailable);

      const result: RunResult = await run(
        TelemetryIngestSurface.OtelTraces,
        tokenHeaders({ origin: ALLOWED_ORIGIN }),
      );

      /*
       * Deliberate and documented: a Redis blip must not become permanent,
       * unreplayable customer data loss with their incident dashboards dark
       * at exactly the wrong moment. A future "hardening" change that flips
       * this to a refusal has to fail here first, loudly, rather than in a
       * customer's outage.
       */
      expect(Response.sendErrorResponse as MockFn).not.toHaveBeenCalled();
      expect(result.next).toHaveBeenCalledTimes(1);
      expect((result.req as TelemetryRequest).projectId.toString()).toBe(
        PROJECT_ID,
      );
    });
  });

  /*
   * The limit resolution is exported so its branches can be pinned without an
   * Express request, a mocked service and a fake Redis standing between the
   * test and an arithmetic decision.
   */
  describe("getEffectiveRequestsPerMinuteLimit", () => {
    test("a server key with no configured limit is unlimited", () => {
      expect(
        getEffectiveRequestsPerMinuteLimit(
          buildPolicy({ requestsPerMinuteLimit: null }),
        ),
      ).toBeNull();
    });

    test("a server key with a configured limit gets the limit it asked for", () => {
      expect(
        getEffectiveRequestsPerMinuteLimit(
          buildPolicy({ requestsPerMinuteLimit: 250 }),
        ),
      ).toBe(250);
    });

    test("a browser key with no configured limit falls back to the shipped default rather than to unlimited", () => {
      expect(
        getEffectiveRequestsPerMinuteLimit(
          buildBrowserPolicy({ requestsPerMinuteLimit: null }),
        ),
      ).toBe(DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE);
    });

    test("a browser key with a configured limit gets the limit it asked for", () => {
      expect(
        getEffectiveRequestsPerMinuteLimit(
          buildBrowserPolicy({ requestsPerMinuteLimit: 3 }),
        ),
      ).toBe(3);
    });

    test("a zero, negative, infinite, NaN or non-numeric limit falls back to the key type's default instead of blocking the key", () => {
      const degenerateValues: Array<number> = [
        0,
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        "100" as unknown as number,
      ];

      for (const value of degenerateValues) {
        /*
         * A bad row must not be read as "block everything": that would black
         * out a customer's ingest on a data problem. A Server key falls back
         * to unlimited (its historical behaviour), a Browser key to the
         * shipped ceiling - never to unlimited.
         */
        expect(
          getEffectiveRequestsPerMinuteLimit(
            buildPolicy({ requestsPerMinuteLimit: value }),
          ),
        ).toBeNull();

        expect(
          getEffectiveRequestsPerMinuteLimit(
            buildBrowserPolicy({ requestsPerMinuteLimit: value }),
          ),
        ).toBe(DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE);
      }
    });
  });

  describe("legacy unnamed-surface alias", () => {
    test("a route that has not been migrated to forSurface refuses a browser key", async () => {
      resolveTo(buildBrowserPolicy({}));

      const result: RunResult = await run(
        null,
        tokenHeaders({ origin: ALLOWED_ORIGIN }),
      );

      /*
       * Fail closed on the default. A missed browser-capable route is a
       * public credential reaching an endpoint nobody decided it should
       * reach; a missed server-only route is a support ticket.
       */
      expect(result.next).not.toHaveBeenCalled();

      const error: Error = refusal();
      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error.message).toBe(
        "A browser ingestion key cannot be used for this ingest endpoint. Use a server ingestion key.",
      );
    });

    test("a route that has not been migrated still works with a server key", async () => {
      resolveTo(buildPolicy({}));

      const result: RunResult = await run(null, tokenHeaders());

      expect(Response.sendErrorResponse as MockFn).not.toHaveBeenCalled();
      expect(result.next).toHaveBeenCalledTimes(1);
      expect((result.req as TelemetryRequest).projectId.toString()).toBe(
        PROJECT_ID,
      );
    });
  });

  /*
   * An ingestion key is a secret. Every branch below refuses a request that
   * PRESENTED one, and none of them may write it to a log line (which also
   * lands in the in-process recentLogs ring buffer surfaced on the admin
   * health pages) or echo it back in a response body.
   */
  describe("token hygiene across every refusal branch", () => {
    interface RefusalBranch {
      name: string;
      arrange: () => void;
      surface: TelemetryIngestSurface | null;
      headers: Record<string, string>;
    }

    const branches: Array<RefusalBranch> = [
      {
        name: "unknown token",
        arrange: (): void => {
          resolveTo(null);
        },
        surface: TelemetryIngestSurface.OtelTraces,
        headers: tokenHeaders(),
      },
      {
        name: "disabled key",
        arrange: (): void => {
          resolveTo(buildPolicy({ isEnabled: false }));
        },
        surface: TelemetryIngestSurface.OtelTraces,
        headers: tokenHeaders(),
      },
      {
        name: "expired key",
        arrange: (): void => {
          resolveTo(
            buildPolicy({ expiresAt: new Date(Date.now() - 60 * 1000) }),
          );
        },
        surface: TelemetryIngestSurface.OtelTraces,
        headers: tokenHeaders(),
      },
      {
        name: "browser key on a disallowed surface",
        arrange: (): void => {
          resolveTo(buildBrowserPolicy({}));
        },
        surface: TelemetryIngestSurface.Syslog,
        headers: tokenHeaders({ origin: ALLOWED_ORIGIN }),
      },
      {
        name: "browser key from a disallowed origin",
        arrange: (): void => {
          resolveTo(buildBrowserPolicy({}));
        },
        surface: TelemetryIngestSurface.OtelTraces,
        headers: tokenHeaders({ origin: "https://attacker.example.net" }),
      },
      {
        name: "browser key with no Origin header",
        arrange: (): void => {
          resolveTo(buildBrowserPolicy({}));
        },
        surface: TelemetryIngestSurface.OtelTraces,
        headers: tokenHeaders(),
      },
      {
        name: "browser key with an empty allowlist",
        arrange: (): void => {
          resolveTo(buildBrowserPolicy({ allowedOrigins: [] }));
        },
        surface: TelemetryIngestSurface.OtelTraces,
        headers: tokenHeaders({ origin: ALLOWED_ORIGIN }),
      },
      {
        name: "rate limited key",
        arrange: (): void => {
          resolveTo(buildBrowserPolicy({ requestsPerMinuteLimit: 1 }));
          limiterAnswers(TelemetryIngestionKeyLimitOutcome.RateLimited, {
            retryAfterSeconds: 12,
            isFirstRejectionInWindow: true,
          });
        },
        surface: TelemetryIngestSurface.OtelTraces,
        headers: tokenHeaders({ origin: ALLOWED_ORIGIN }),
      },
      {
        name: "browser key on the legacy unnamed-surface alias",
        arrange: (): void => {
          resolveTo(buildBrowserPolicy({}));
        },
        surface: null,
        headers: tokenHeaders({ origin: ALLOWED_ORIGIN }),
      },
    ];

    let loggedArgs: Array<Array<unknown>>;
    let spies: Array<{ mockRestore: () => void }>;

    beforeEach(() => {
      loggedArgs = [];
      spies = ["error", "warn", "info", "debug", "trace"].map(
        (level: string): { mockRestore: () => void } => {
          return jest
            .spyOn(logger, level as "error")
            .mockImplementation((...args: Array<unknown>) => {
              loggedArgs.push(args);
              return undefined as never;
            }) as unknown as { mockRestore: () => void };
        },
      );
    });

    afterEach(() => {
      for (const spy of spies) {
        spy.mockRestore();
      }
    });

    test("no refusal branch writes the presented ingestion key to a log line or a response message", async () => {
      for (const branch of branches) {
        jest.clearAllMocks();
        arrangeDefaults();
        loggedArgs = [];
        branch.arrange();

        const result: RunResult = await run(branch.surface, branch.headers);

        // Every branch listed here must actually refuse.
        expect(result.next).not.toHaveBeenCalled();

        const error: Error = refusal();
        expect(error.message).not.toContain(SENTINEL_TOKEN);

        for (const args of loggedArgs) {
          expect(JSON.stringify(args)).not.toContain(SENTINEL_TOKEN);
        }
      }
    });
  });

  describe("last-used bookkeeping", () => {
    test("markUsed is recorded for the admitting key on success", async () => {
      resolveTo(buildPolicy({}));

      await run(TelemetryIngestSurface.OtelTraces, tokenHeaders());

      expect(
        TelemetryIngestionKeyService.markUsed as MockFn,
      ).toHaveBeenCalledTimes(1);
      expect(
        String(
          (TelemetryIngestionKeyService.markUsed as MockFn).mock.calls[0]?.[0],
        ),
      ).toBe(INGESTION_KEY_ID);
    });

    test("the request is not held up waiting for markUsed to finish", async () => {
      resolveTo(buildPolicy({}));

      /*
       * A promise that never settles. If the middleware awaited the
       * bookkeeping write, next() would never be called and every ingested
       * payload would carry a database round trip for a column nobody reads
       * in real time.
       */
      (TelemetryIngestionKeyService.markUsed as MockFn).mockReturnValue(
        new Promise<void>((): void => {}) as never,
      );

      const result: RunResult = await run(
        TelemetryIngestSurface.OtelTraces,
        tokenHeaders(),
      );

      expect(result.next).toHaveBeenCalledTimes(1);
    });

    test("a failed markUsed write does not fail the ingest request", async () => {
      resolveTo(buildPolicy({}));
      (TelemetryIngestionKeyService.markUsed as MockFn).mockRejectedValue(
        new Error("database is having a bad day") as never,
      );

      const warnSpy: { mockRestore: () => void } = jest
        .spyOn(logger, "warn")
        .mockImplementation(() => {
          return undefined as never;
        }) as unknown as { mockRestore: () => void };

      try {
        const result: RunResult = await run(
          TelemetryIngestSurface.OtelTraces,
          tokenHeaders(),
        );

        expect(Response.sendErrorResponse as MockFn).not.toHaveBeenCalled();
        expect(result.next).toHaveBeenCalledTimes(1);
        // next() with no arguments - an argument would be an Express error.
        expect(result.next.mock.calls[0]?.length || 0).toBe(0);

        // Let the swallowed rejection settle so it cannot surface elsewhere.
        await Promise.resolve();
        await Promise.resolve();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
