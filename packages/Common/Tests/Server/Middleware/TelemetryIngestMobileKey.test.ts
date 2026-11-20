import { beforeEach, describe, expect, test } from "@jest/globals";
import { EventEmitter } from "events";
import TelemetryIngest, {
  getEffectiveRequestsPerMinuteLimit,
  getMobileKeyRefusalMessage,
} from "../../../Server/Middleware/TelemetryIngest";
import TelemetryIngestionKeyService from "../../../Server/Services/TelemetryIngestionKeyService";
import Response from "../../../Server/Utils/Response";
import TelemetryIngestionKeyRateLimiter, {
  TelemetryIngestionKeyLimitOutcome,
} from "../../../Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
import TelemetryIngestRefusalRecorder from "../../../Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import TelemetryIngestionKeyGuard, {
  TelemetryIngestionKeyRefusal,
  TelemetryIngestionKeyRefusalReason,
  TELEMETRY_INGEST_REFUSAL_REASON_FOR_KEY_REFUSAL,
} from "../../../Server/Utils/Telemetry/TelemetryIngestionKeyGuard";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../../Types/ObjectID";
import {
  SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_RECORDER_KIND_HEADER,
} from "../../../Types/Rum/SessionReplay";
import TelemetryIngestionKeyPolicy, {
  DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE,
  DEFAULT_MOBILE_KEY_REQUESTS_PER_MINUTE,
} from "../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType, {
  PUBLIC_INGESTION_KEY_TYPES,
  readTelemetryIngestionKeyType,
} from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import { TelemetryIngestRefusalReason } from "../../../Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface, {
  BROWSER_ALLOWED_INGEST_SURFACES,
  IDENTITY_REGISTRATION_SURFACES,
  MOBILE_ALLOWED_INGEST_SURFACES,
} from "../../../Types/Telemetry/TelemetryIngestSurface";

/*
 * A MOBILE KEY WRITES A MOBILE APP'S OTLP TRACES, LOGS AND METRICS OVER
 * HTTP, AND NOTHING ELSE (issue #6457).
 *
 * A Mobile ingestion key is compiled into an app, so anyone who has the app
 * can pull it out. The guard is what makes that copy worth little: it may
 * reach the three OTLP/HTTP signal surfaces and no other (no profiles, no
 * source maps or dSYMs, no syslog, no security events, no agent or collector
 * registration, no gRPC or MQTT, no session replay, no Sentry), never from
 * a web page (a request with an Origin header), and always under the
 * Browser key's default rate limit unless its owner set one. Its kill
 * switch and expiry stop it like any key's.
 *
 * Each branch is pinned by driving the real middleware, with the key
 * lookup, the limiter, the responder and the refusal recorder mocked at the
 * module boundary. Nothing touches Postgres or Redis.
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

const PROJECT_ID: string = "6457a000-0000-4000-8000-000000000001";
const KEY_ID: string = "6457a000-0000-4000-8000-000000000002";
const TOKEN: string = "mobile-sentinel-ingestion-key-6457";
const APP_NAME: string = "storefront-mobile";

const ALL_SURFACES: Array<TelemetryIngestSurface> = Object.values(
  TelemetryIngestSurface,
) as Array<TelemetryIngestSurface>;

const MOBILE_DISALLOWED_SURFACES: Array<TelemetryIngestSurface> =
  ALL_SURFACES.filter((surface: TelemetryIngestSurface): boolean => {
    return !MOBILE_ALLOWED_INGEST_SURFACES.has(surface);
  });

function buildMobilePolicy(
  overrides: Partial<TelemetryIngestionKeyPolicy> = {},
): TelemetryIngestionKeyPolicy {
  return {
    ingestionKeyId: new ObjectID(KEY_ID),
    projectId: new ObjectID(PROJECT_ID),
    keyType: TelemetryIngestionKeyType.Mobile,
    allowedOrigins: [],
    pinnedServiceName: APP_NAME,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ...overrides,
  };
}

function resolveTo(policy: TelemetryIngestionKeyPolicy | null): void {
  (
    TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn
  ).mockResolvedValue(policy as never);
}

interface RunResult {
  req: ExpressRequest;
  next: MockFn;
}

async function run(
  surface: TelemetryIngestSurface | null,
  headers: Record<string, string> = { "x-oneuptime-token": TOKEN },
): Promise<RunResult> {
  const req: ExpressRequest = {
    headers,
    id: "test-request-id",
  } as unknown as ExpressRequest;
  const res: ExpressResponse = Object.assign(new EventEmitter(), {
    setHeader: jest.fn(),
    statusCode: 200,
  }) as unknown as ExpressResponse;
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

  return { req, next };
}

function refusalSent(): Error {
  const sendErrorResponse: MockFn = Response.sendErrorResponse as MockFn;

  expect(sendErrorResponse).toHaveBeenCalledTimes(1);

  return sendErrorResponse.mock.calls[0]?.[2] as Error;
}

let record: jest.SpiedFunction<typeof TelemetryIngestRefusalRecorder.record>;

function reasonsRecorded(): Array<TelemetryIngestRefusalReason> {
  return record.mock.calls.map(
    (call: Parameters<typeof TelemetryIngestRefusalRecorder.record>) => {
      return call[0].reason;
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  record = jest
    .spyOn(TelemetryIngestRefusalRecorder, "record")
    .mockImplementation(() => {});
  (TelemetryIngestionKeyService.markUsed as MockFn).mockResolvedValue(
    undefined as never,
  );
  (TelemetryIngestionKeyRateLimiter.consume as MockFn).mockResolvedValue({
    outcome: TelemetryIngestionKeyLimitOutcome.Allowed,
  } as never);
  resolveTo(buildMobilePolicy());
});

describe("the key type", () => {
  test("is stored as Mobile, and read back as Mobile, never relaxed to Server", () => {
    expect(TelemetryIngestionKeyType.Mobile).toBe("Mobile");
    expect(readTelemetryIngestionKeyType("Mobile")).toBe(
      TelemetryIngestionKeyType.Mobile,
    );
    expect(readTelemetryIngestionKeyType("Browser")).toBe(
      TelemetryIngestionKeyType.Browser,
    );
    // A row from before the column, or a value nothing writes: Server, as ever.
    expect(readTelemetryIngestionKeyType(null)).toBe(
      TelemetryIngestionKeyType.Server,
    );
    expect(readTelemetryIngestionKeyType(undefined)).toBe(
      TelemetryIngestionKeyType.Server,
    );
    expect(readTelemetryIngestionKeyType("Server")).toBe(
      TelemetryIngestionKeyType.Server,
    );
  });

  test("is a public key, as a Browser key is, and a Server key is not", () => {
    expect(
      PUBLIC_INGESTION_KEY_TYPES.has(TelemetryIngestionKeyType.Mobile),
    ).toBe(true);
    expect(
      PUBLIC_INGESTION_KEY_TYPES.has(TelemetryIngestionKeyType.Browser),
    ).toBe(true);
    expect(
      PUBLIC_INGESTION_KEY_TYPES.has(TelemetryIngestionKeyType.Server),
    ).toBe(false);
  });
});

describe("what a Mobile key may write", () => {
  test("is a mobile app's OTLP traces, logs and metrics, and nothing else", () => {
    // Change this list, and the docs, the guide and the key picker must say the same.
    expect(Array.from(MOBILE_ALLOWED_INGEST_SURFACES).sort()).toEqual(
      [
        TelemetryIngestSurface.OtelTraces,
        TelemetryIngestSurface.OtelLogs,
        TelemetryIngestSurface.OtelMetrics,
      ].sort(),
    );
  });

  test("is narrower than a Browser key's: no session replay, no Sentry", () => {
    for (const surface of MOBILE_ALLOWED_INGEST_SURFACES) {
      expect(BROWSER_ALLOWED_INGEST_SURFACES.has(surface)).toBe(true);
    }

    expect(
      MOBILE_ALLOWED_INGEST_SURFACES.has(TelemetryIngestSurface.SessionReplay),
    ).toBe(false);
    expect(
      MOBILE_ALLOWED_INGEST_SURFACES.has(TelemetryIngestSurface.Sentry),
    ).toBe(false);
  });

  test("never an identity registration surface, gRPC or MQTT", () => {
    for (const surface of IDENTITY_REGISTRATION_SURFACES) {
      expect(MOBILE_ALLOWED_INGEST_SURFACES.has(surface)).toBe(false);
    }

    expect(
      MOBILE_ALLOWED_INGEST_SURFACES.has(TelemetryIngestSurface.Grpc),
    ).toBe(false);
    expect(
      MOBILE_ALLOWED_INGEST_SURFACES.has(TelemetryIngestSurface.Mqtt),
    ).toBe(false);
  });
});

describe("the HTTP guard", () => {
  test.each(Array.from(MOBILE_ALLOWED_INGEST_SURFACES))(
    "admits a Mobile key on %s from an app, with no Origin header",
    async (surface: TelemetryIngestSurface) => {
      const result: RunResult = await run(surface);

      expect(Response.sendErrorResponse).not.toHaveBeenCalled();
      expect(result.next).toHaveBeenCalledWith();
      expect(record).not.toHaveBeenCalled();

      // Downstream pins the app's name from the policy the guard attached.
      expect(
        (
          result.req as unknown as {
            ingestionKeyPolicy: TelemetryIngestionKeyPolicy;
          }
        ).ingestionKeyPolicy.pinnedServiceName,
      ).toBe(APP_NAME);
    },
  );

  test.each(MOBILE_DISALLOWED_SURFACES)(
    "refuses a Mobile key on %s with 422, and counts it",
    async (surface: TelemetryIngestSurface) => {
      const result: RunResult = await run(surface);

      const error: Error = refusalSent();

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error.message).toContain(
        "A mobile ingestion key cannot be used for",
      );
      expect(result.next).not.toHaveBeenCalled();
      expect(reasonsRecorded()).toEqual([
        TelemetryIngestRefusalReason.MobileKeyNotAllowedHere,
      ]);
    },
  );

  test("refuses a Mobile key on the legacy guard, which is server-only", async () => {
    const result: RunResult = await run(null);

    expect(refusalSent()).toBeInstanceOf(NotAuthorizedException);
    expect(result.next).not.toHaveBeenCalled();
    expect(reasonsRecorded()).toEqual([
      TelemetryIngestRefusalReason.MobileKeyNotAllowedHere,
    ]);
  });

  test("refuses a Mobile key sent from a web page, and says to use a Browser key there", async () => {
    const result: RunResult = await run(TelemetryIngestSurface.OtelTraces, {
      "x-oneuptime-token": TOKEN,
      origin: "https://shop.example.com",
    });

    const error: Error = refusalSent();

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toBe(
      "A mobile ingestion key cannot be used from a web page: this request sent an Origin header, which only a browser sends. Use a browser ingestion key in a web page.",
    );
    expect(result.next).not.toHaveBeenCalled();
    expect(reasonsRecorded()).toEqual([
      TelemetryIngestRefusalReason.MobileKeyNotAllowedHere,
    ]);
  });

  test("refuses an opaque origin too: a sandboxed page sends Origin: null", async () => {
    await run(TelemetryIngestSurface.OtelLogs, {
      "x-oneuptime-token": TOKEN,
      origin: "null",
    });

    expect(refusalSent()).toBeInstanceOf(NotAuthorizedException);
  });

  test("an empty Origin header is no web page: admitted", async () => {
    const result: RunResult = await run(TelemetryIngestSurface.OtelLogs, {
      "x-oneuptime-token": TOKEN,
      origin: "  ",
    });

    expect(result.next).toHaveBeenCalledWith();
  });

  test("gets no app:// identity from the replay headers: that path is a Browser key's", async () => {
    const result: RunResult = await run(TelemetryIngestSurface.SessionReplay, {
      "x-oneuptime-token": TOKEN,
      [SESSION_REPLAY_RECORDER_KIND_HEADER]: "rn-view-tree",
      [SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER]: "com.example.storefront",
    });

    const error: Error = refusalSent();

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toContain(
      "browser ingestion key that lists the app as app://",
    );
    expect(result.next).not.toHaveBeenCalled();
    expect(
      (result.req as unknown as { resolvedClientOrigin?: string })
        .resolvedClientOrigin,
    ).toBeUndefined();
  });

  test("a turned-off Mobile key is refused before anything else, as every key is", async () => {
    resolveTo(buildMobilePolicy({ isEnabled: false }));

    await run(TelemetryIngestSurface.SourceMap, {
      "x-oneuptime-token": TOKEN,
      origin: "https://shop.example.com",
    });

    expect(refusalSent().message).toBe(
      "This telemetry ingestion key has been disabled.",
    );
    expect(reasonsRecorded()).toEqual([
      TelemetryIngestRefusalReason.KeyDisabled,
    ]);
  });

  test("an expired Mobile key is refused 401, as every key is", async () => {
    resolveTo(buildMobilePolicy({ expiresAt: new Date(Date.now() - 1000) }));

    await run(TelemetryIngestSurface.OtelTraces);

    expect(refusalSent()).toBeInstanceOf(NotAuthenticatedException);
    expect(reasonsRecorded()).toEqual([
      TelemetryIngestRefusalReason.KeyExpired,
    ]);
  });

  test("a refused surface spends none of the key's requests", async () => {
    await run(TelemetryIngestSurface.Syslog);

    expect(TelemetryIngestionKeyRateLimiter.consume).not.toHaveBeenCalled();
  });

  test("the token is never echoed in a refusal", async () => {
    for (const surface of MOBILE_DISALLOWED_SURFACES) {
      jest.clearAllMocks();
      await run(surface);
      expect(refusalSent().message).not.toContain(TOKEN);
    }
  });
});

describe("the rate limit", () => {
  test("a Mobile key with no limit of its own gets the Browser key's default, never unlimited", () => {
    expect(DEFAULT_MOBILE_KEY_REQUESTS_PER_MINUTE).toBe(
      DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE,
    );
    expect(getEffectiveRequestsPerMinuteLimit(buildMobilePolicy())).toBe(
      DEFAULT_MOBILE_KEY_REQUESTS_PER_MINUTE,
    );
    expect(
      getEffectiveRequestsPerMinuteLimit(
        buildMobilePolicy(),
        TelemetryIngestSurface.OtelMetrics,
      ),
    ).toBe(DEFAULT_MOBILE_KEY_REQUESTS_PER_MINUTE);
  });

  test("its owner's own limit wins", () => {
    expect(
      getEffectiveRequestsPerMinuteLimit(
        buildMobilePolicy({ requestsPerMinuteLimit: 120 }),
      ),
    ).toBe(120);
  });

  test("an admitted request is counted against the key's limit", async () => {
    await run(TelemetryIngestSurface.OtelTraces);

    expect(TelemetryIngestionKeyRateLimiter.consume).toHaveBeenCalledTimes(1);
    expect(
      (TelemetryIngestionKeyRateLimiter.consume as MockFn).mock.calls[0]?.[0],
    ).toEqual({
      ingestionKeyId: new ObjectID(KEY_ID),
      limitPerMinute: DEFAULT_MOBILE_KEY_REQUESTS_PER_MINUTE,
    });
  });

  test("over the limit: 429, counted, and the request goes no further", async () => {
    (TelemetryIngestionKeyRateLimiter.consume as MockFn).mockResolvedValue({
      outcome: TelemetryIngestionKeyLimitOutcome.RateLimited,
      retryAfterSeconds: 12,
      isFirstRejectionInWindow: false,
    } as never);

    const result: RunResult = await run(TelemetryIngestSurface.OtelLogs);

    expect(refusalSent()).toBeInstanceOf(TooManyRequestsException);
    expect(result.next).not.toHaveBeenCalled();
    expect(reasonsRecorded()).toEqual([
      TelemetryIngestRefusalReason.KeyRequestsPerMinute,
    ]);
  });
});

describe("getMobileKeyRefusalMessage", () => {
  const request: (headers: Record<string, string>) => ExpressRequest = (
    headers: Record<string, string>,
  ): ExpressRequest => {
    return { headers } as unknown as ExpressRequest;
  };

  test("null for an app's export on its three surfaces", () => {
    for (const surface of MOBILE_ALLOWED_INGEST_SURFACES) {
      expect(getMobileKeyRefusalMessage({ req: request({}), surface })).toBe(
        null,
      );
    }
  });

  test("names the surface, what the key sends and which key to use", () => {
    expect(
      getMobileKeyRefusalMessage({
        req: request({}),
        surface: TelemetryIngestSurface.OtelProfiles,
      }),
    ).toBe(
      "A mobile ingestion key cannot be used for OTLP profile ingest: it sends only a mobile app's OTLP traces, logs and metrics over HTTP. Use a server ingestion key here.",
    );
  });

  test("the surface is refused before the Origin header is read", () => {
    expect(
      getMobileKeyRefusalMessage({
        req: request({ origin: "https://shop.example.com" }),
        surface: TelemetryIngestSurface.Dsym,
      }),
    ).toContain("cannot be used for dSYM upload");
  });
});

describe("the guard gRPC, MQTT and the probes share", () => {
  test.each([
    TelemetryIngestSurface.Grpc,
    TelemetryIngestSurface.Mqtt,
    TelemetryIngestSurface.SessionReplay,
  ])(
    "refuses a Mobile key on %s, counted as the HTTP guard counts it",
    (surface: TelemetryIngestSurface) => {
      const refusal: TelemetryIngestionKeyRefusal | null =
        TelemetryIngestionKeyGuard.getRefusal({
          policy: buildMobilePolicy(),
          surface,
        });

      expect(refusal?.reason).toBe(
        TelemetryIngestionKeyRefusalReason.SurfaceNotAllowedForMobileKey,
      );
      expect(
        TELEMETRY_INGEST_REFUSAL_REASON_FOR_KEY_REFUSAL[refusal!.reason],
      ).toBe(TelemetryIngestRefusalReason.MobileKeyNotAllowedHere);
      // The same sentence the HTTP guard sends on that surface.
      expect(refusal?.message).toBe(
        getMobileKeyRefusalMessage({
          req: { headers: {} } as unknown as ExpressRequest,
          surface,
        }),
      );
    },
  );

  test("admits a Mobile key on the OTLP signal surfaces", () => {
    for (const surface of MOBILE_ALLOWED_INGEST_SURFACES) {
      expect(
        TelemetryIngestionKeyGuard.getRefusal({
          policy: buildMobilePolicy(),
          surface,
        }),
      ).toBeNull();
    }
  });

  test("the kill switch still comes first", () => {
    expect(
      TelemetryIngestionKeyGuard.getRefusal({
        policy: buildMobilePolicy({ isEnabled: false }),
        surface: TelemetryIngestSurface.Grpc,
      })?.reason,
    ).toBe(TelemetryIngestionKeyRefusalReason.Disabled);
  });

  test("a Server key keeps every surface, as before", () => {
    for (const surface of ALL_SURFACES) {
      expect(
        TelemetryIngestionKeyGuard.getRefusal({
          policy: buildMobilePolicy({
            keyType: TelemetryIngestionKeyType.Server,
            pinnedServiceName: null,
          }),
          surface,
        }),
      ).toBeNull();
    }
  });
});
