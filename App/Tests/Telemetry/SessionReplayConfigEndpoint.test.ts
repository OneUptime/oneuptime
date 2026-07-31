import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import {
  SESSION_REPLAY_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_USER_REF_HEADER,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";

/*
 * GET /session-replay/v1/config - the Wave 4 surface: the response must
 * carry the correlation/performance policy verbatim, and the targeted-
 * capture handshake must consume its one-shot Redis key with the right
 * cache semantics. The route module is imported against a mocked router,
 * exactly like SessionReplayIngestAPI.test.ts.
 */

const registeredGetHandlers: Record<string, Array<unknown>> = {};

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return {
          post: (): void => {
            // Chunk-path registration is irrelevant to this suite.
          },
          get: (uri: string, ...handlers: Array<unknown>) => {
            registeredGetHandlers[uri] = handlers;
          },
        };
      },
    },
    headerValueToString: (value: unknown): string | undefined => {
      if (typeof value === "string") {
        return value;
      }
      if (Array.isArray(value)) {
        return value[0] as string | undefined;
      }
      return undefined;
    },
  };
});

jest.mock("Common/Server/Middleware/TelemetryIngest", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/TelemetryIngestionDisabled", () => {
  return {
    __esModule: true,
    default: {
      middleware: jest.fn(),
      isDisabled: jest.fn().mockReturnValue(false),
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn(),
  };
});

jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (): void => {
        // No-op decorator: the real one needs a live tracer provider.
      };
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  const counter: { add: unknown } = { add: jest.fn() };
  const histogram: { record: unknown } = { record: jest.fn() };

  return {
    __esModule: true,
    default: {
      getIngestCounter: () => {
        return counter;
      },
      getIngestDuration: () => {
        return histogram;
      },
      getIngestPayloadBytes: () => {
        return histogram;
      },
    },
  };
});

jest.mock("Common/Server/Utils/SessionReplay/SessionReplayGateCache", () => {
  return {
    __esModule: true,
    default: {
      getPolicy: jest.fn(),
      isOriginAllowed: jest.fn().mockReturnValue(true),
    },
  };
});

jest.mock("Common/Server/Utils/SessionReplay/SessionReplayTargeting", () => {
  return {
    __esModule: true,
    default: {
      consumeTarget: jest.fn(),
      isUsableUserRef: (userRef: unknown): boolean => {
        return (
          typeof userRef === "string" &&
          userRef.trim().length > 0 &&
          userRef.length <= 512
        );
      },
    },
  };
});

jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      getProjectIdFromSecretKey: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/RumApplicationService", () => {
  return {
    __esModule: true,
    default: {
      markSessionReplayChunkReceived: jest.fn(),
      markSessionReplayBudgetExceeded: jest.fn(),
    },
  };
});

jest.mock(
  "../../FeatureSet/Telemetry/Services/SessionReplayIngestService",
  () => {
    return {
      __esModule: true,
      default: {
        gateChunkRequest: jest.fn(),
        getInlineStagingMaxBytes: () => {
          return 65536;
        },
        isUnprocessableParseError: (): boolean => {
          return false;
        },
      },
      SessionReplayGateOutcome: {
        Accepted: "accepted",
        Stop: "stop",
        OriginRefused: "origin-refused",
        RateLimited: "rate-limited",
        StorageUnavailable: "storage-unavailable",
      },
    };
  },
);

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addSessionReplayIngestJob: jest.fn(),
      },
    };
  },
);

jest.mock("../../FeatureSet/Telemetry/Config", () => {
  return {
    __esModule: true,
    SESSION_REPLAY_ENABLED_BY_DEFAULT: true,
    SESSION_REPLAY_INGEST_ENABLED: true,
    SESSION_REPLAY_TRUSTED_GEO_HEADER: "",
  };
});

/*
 * A pinned artifact version, so the endpoint takes the LIVE path instead
 * of reporting itself disabled for want of a build.
 */
jest.mock("../../FeatureSet/BrowserRecorder/Manifest", () => {
  return {
    __esModule: true,
    ARTIFACT_CONTENT_TYPE: "application/javascript",
    LOADER_CACHE_CONTROL: "public, max-age=300",
    RECORDER_CACHE_CONTROL: "public, max-age=31536000, immutable",
    RECORDER_VERSION_PATTERN: /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/,
    getArtifactFilePath: jest.fn(),
    getPinnedRecorderPath: jest.fn(),
    getRecorderVersion: (): string => {
      return "11.7.3";
    },
    getRecorderIntegrity: (): string | null => {
      return null;
    },
  };
});

import Response from "Common/Server/Utils/Response";
import SessionReplayGateCache from "Common/Server/Utils/SessionReplay/SessionReplayGateCache";
import SessionReplayTargeting from "Common/Server/Utils/SessionReplay/SessionReplayTargeting";
// Importing the router module registers the routes on the mocked router.
import "../../FeatureSet/Telemetry/API/SessionReplayIngest";

type MockedFn = ReturnType<typeof jest.fn>;

const getPolicyMock: MockedFn =
  SessionReplayGateCache.getPolicy as unknown as MockedFn;
const consumeTargetMock: MockedFn =
  SessionReplayTargeting.consumeTarget as unknown as MockedFn;
const sendJsonMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;

const PROJECT_ID: ObjectID = ObjectID.generate();
const RUM_APPLICATION_ID: ObjectID = ObjectID.generate();
const APP_IDENTIFIER: string = "checkout-web";
const CONFIG_ROUTE: string = "/session-replay/v1/config";

function buildPolicy(overrides?: Record<string, unknown>): unknown {
  return {
    projectId: PROJECT_ID,
    rumApplicationId: RUM_APPLICATION_ID,
    isProjectAllowed: true,
    isAppEnabled: true,
    allowedOrigins: ["https://shop.example.com"],
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    consentMode: SessionReplayConsentMode.NotRequired,
    captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
    samplePercentage: 100,
    maskSelectors: [],
    blockSelectors: [],
    recordCanvas: false,
    captureUserIdentity: false,
    captureGeo: false,
    retentionInDays: 7,
    monthlyBudgetInGB: null,
    ignoreErrorPatterns: [],
    tracePropagationOrigins: ["https://api.example.com"],
    lcpBudgetMs: 4000,
    longTaskBudgetMs: 200,
    slowRequestBudgetMs: 5000,
    configEpoch: 77,
    ...overrides,
  };
}

interface FakeResponse {
  headers: Record<string, string>;
  setHeader: (name: string, value: string) => void;
}

function buildResponse(): FakeResponse {
  const res: FakeResponse = {
    headers: {},
    setHeader: (name: string, value: string): void => {
      res.headers[name] = value;
    },
  };

  return res;
}

function buildRequest(headers?: Record<string, string>): unknown {
  return {
    projectId: PROJECT_ID,
    headers: {
      [SESSION_REPLAY_APP_IDENTIFIER_HEADER]: APP_IDENTIFIER,
      ...headers,
    },
  };
}

async function callConfigRoute(
  req: unknown,
  res: FakeResponse,
): Promise<JSONObject> {
  const handlers: Array<unknown> = registeredGetHandlers[CONFIG_ROUTE] || [];
  const terminal: unknown = handlers[handlers.length - 1];

  expect(typeof terminal).toBe("function");

  await (
    terminal as (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => Promise<void>
  )(
    req as ExpressRequest,
    res as unknown as ExpressResponse,
    jest.fn() as unknown as NextFunction,
  );

  expect(sendJsonMock).toHaveBeenCalledTimes(1);

  return sendJsonMock.mock.calls[0]?.[2] as JSONObject;
}

describe("GET /session-replay/v1/config (wave 4 fields)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    consumeTargetMock.mockResolvedValue(false as never);
  });

  test("the live config mirrors the correlation and performance policy verbatim", async () => {
    getPolicyMock.mockResolvedValue(buildPolicy() as never);

    const res: FakeResponse = buildResponse();
    const body: JSONObject = await callConfigRoute(buildRequest(), res);

    expect(body["enabled"]).toBe(true);
    expect(body["tracePropagationOrigins"]).toEqual([
      "https://api.example.com",
    ]);
    expect(body["lcpBudgetMs"]).toBe(4000);
    expect(body["longTaskBudgetMs"]).toBe(200);
    expect(body["slowRequestBudgetMs"]).toBe(5000);
    expect(body["isTargeted"]).toBe(false);

    /* Anonymous (no user ref) responses stay browser-cacheable. */
    expect(res.headers["Cache-Control"]).toBe("private, max-age=300");

    /* And Vary keeps a shared cache from reusing them for identified fetches. */
    expect(res.headers["Vary"]).toBe(SESSION_REPLAY_USER_REF_HEADER);

    /* No user-ref header arrived, so Redis was never consulted. */
    expect(consumeTargetMock).not.toHaveBeenCalled();
  });

  /*
   * The disabled response is a complete config a recorder can parse, so
   * it must carry the new fields too - with the refusing defaults.
   */
  test("the disabled response carries the new fields with feature-off values", async () => {
    getPolicyMock.mockResolvedValue(null as never);

    /*
     * The user-ref header IS sent here, deliberately: without it the
     * consumeTarget assertion below is vacuous (the endpoint could never
     * reach Redis), and a refactor that consumes the one-shot target
     * while the application is disabled would slip through.
     */
    const body: JSONObject = await callConfigRoute(
      buildRequest({ [SESSION_REPLAY_USER_REF_HEADER]: "user-42" }),
      buildResponse(),
    );

    expect(body["enabled"]).toBe(false);
    expect(body["tracePropagationOrigins"]).toEqual([]);
    expect(body["lcpBudgetMs"]).toBe(0);
    expect(body["longTaskBudgetMs"]).toBe(0);
    expect(body["slowRequestBudgetMs"]).toBe(0);
    expect(body["isTargeted"]).toBe(false);

    /*
     * And the one-shot target is NOT consumed by a disabled application -
     * it should still be waiting when the application is switched on.
     */
    expect(consumeTargetMock).not.toHaveBeenCalled();
  });

  test("a matching target flips isTargeted and makes the response uncacheable", async () => {
    getPolicyMock.mockResolvedValue(buildPolicy() as never);
    consumeTargetMock.mockResolvedValue(true as never);

    const res: FakeResponse = buildResponse();
    const body: JSONObject = await callConfigRoute(
      buildRequest({
        [SESSION_REPLAY_USER_REF_HEADER]:
          encodeURIComponent("jane@example.com"),
      }),
      res,
    );

    expect(body["isTargeted"]).toBe(true);

    /*
     * A cached isTargeted:true would re-arm capture on every reload for
     * five minutes, turning "the next session" into "every session".
     */
    expect(res.headers["Cache-Control"]).toBe("no-store");

    /* The recorder encodes; the server must match on the DECODED value. */
    expect(consumeTargetMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      appIdentifier: APP_IDENTIFIER,
      userRef: "jane@example.com",
    });
  });

  test("an identified fetch is uncacheable even when untargeted", async () => {
    getPolicyMock.mockResolvedValue(buildPolicy() as never);
    consumeTargetMock.mockResolvedValue(false as never);

    const res: FakeResponse = buildResponse();
    const body: JSONObject = await callConfigRoute(
      buildRequest({ [SESSION_REPLAY_USER_REF_HEADER]: "user-42" }),
      res,
    );

    expect(body["isTargeted"]).toBe(false);

    /*
     * no-store even though nothing matched: the support flow is "arm the
     * target, ask the user to reload", and a cached isTargeted:false
     * would swallow that reload for up to max-age seconds.
     */
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(consumeTargetMock).toHaveBeenCalledTimes(1);
  });

  test("malformed percent-encoding matches the literal header value instead of erroring", async () => {
    getPolicyMock.mockResolvedValue(buildPolicy() as never);

    await callConfigRoute(
      /* "%E0%A4%A" is a truncated escape: decodeURIComponent throws. */
      buildRequest({ [SESSION_REPLAY_USER_REF_HEADER]: "user-%E0%A4%A" }),
      buildResponse(),
    );

    expect(consumeTargetMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      appIdentifier: APP_IDENTIFIER,
      userRef: "user-%E0%A4%A",
    });
  });
});
