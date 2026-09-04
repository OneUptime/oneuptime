import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import ObjectID from "Common/Types/ObjectID";
import StatusCode from "Common/Types/API/StatusCode";
import { JSONObject } from "Common/Types/JSON";
import {
  MAX_SESSION_REPLAY_CHUNK_BYTES,
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  SESSION_REPLAY_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_WIRE_VERSION,
  SessionReplayChunkEnvelope,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import zlib from "zlib";

/*
 * Capture every handler registered per route so the middleware ORDER can be
 * asserted, not just the terminal handler. The order matters: the byte cap
 * has to run before auth (so an oversized unauthenticated body is still
 * bounded) and auth has to run before the gate (which needs req.projectId).
 */
const registeredPostHandlers: Record<string, Array<unknown>> = {};
const registeredGetHandlers: Record<string, Array<unknown>> = {};

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return {
          post: (uri: string, ...handlers: Array<unknown>) => {
            registeredPostHandlers[uri] = handlers;
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

const authMiddleware: unknown = jest.fn();

/*
 * forSurface returns the SAME sentinel the route table used to get from
 * isAuthorizedServiceMiddleware, so the ordering assertions further down keep
 * measuring what they always measured. Which surface each route names is
 * pinned separately, by TelemetryIngestSurfaceWiring.test.ts.
 */
jest.mock("Common/Server/Middleware/TelemetryIngest", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: authMiddleware,
      forSurface: jest.fn(() => {
        return authMiddleware;
      }),
    },
  };
});

const ingestionDisabledMiddleware: unknown = jest.fn();

jest.mock("Common/Server/Middleware/TelemetryIngestionDisabled", () => {
  return {
    __esModule: true,
    default: {
      middleware: ingestionDisabledMiddleware,
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
      markProjectDisabled: jest.fn(),
      clearCache: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      getPolicyFromSecretKey: jest.fn(),
      getProjectIdFromSecretKey: jest.fn(),
      markUsed: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/RumApplicationService", () => {
  return {
    __esModule: true,
    default: {
      markSessionReplayChunkReceived: jest.fn(),
      updateLastSeen: jest.fn(),
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
        isUnprocessableParseError: (error: string): boolean => {
          return error === "snapshot-too-large";
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

import Response from "Common/Server/Utils/Response";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import SessionReplayIngestService, {
  SessionReplayGateOutcome,
} from "../../FeatureSet/Telemetry/Services/SessionReplayIngestService";
import TelemetryQueueService from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import SessionReplayRequestMiddleware from "../../FeatureSet/Telemetry/Middleware/SessionReplayRequestMiddleware";
// Importing the router module registers the routes on the mocked router.
import "../../FeatureSet/Telemetry/API/SessionReplayIngest";

type MockedFn = ReturnType<typeof jest.fn>;

const gateMock: MockedFn =
  SessionReplayIngestService.gateChunkRequest as unknown as MockedFn;
const addJobMock: MockedFn =
  TelemetryQueueService.addSessionReplayIngestJob as unknown as MockedFn;
const sendJsonMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;
const markChunkReceivedMock: MockedFn =
  RumApplicationService.markSessionReplayChunkReceived as unknown as MockedFn;
const markBudgetExceededMock: MockedFn =
  RumApplicationService.markSessionReplayBudgetExceeded as unknown as MockedFn;
const updateLastSeenMock: MockedFn =
  RumApplicationService.updateLastSeen as unknown as MockedFn;

const PROJECT_ID: ObjectID = ObjectID.generate();
const RUM_APPLICATION_ID: ObjectID = ObjectID.generate();
const APP_IDENTIFIER: string = "checkout-web";

const CHUNK_ROUTE: string = "/session-replay/v1/chunk";

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  ended: boolean;
  body: unknown;
  /* Express guarantees res.locals; the route stashes the gate reason on it. */
  locals: Record<string, unknown>;
  setHeader: (name: string, value: string) => void;
  status: (code: number) => FakeResponse;
  end: () => void;
  json: (body: unknown) => void;
  on: (event: string, listener: () => void) => void;
  headersSent: boolean;
}

function buildResponse(): FakeResponse {
  const res: FakeResponse = {
    statusCode: 0,
    headers: {},
    ended: false,
    body: undefined,
    locals: {},
    headersSent: false,
    setHeader: (name: string, value: string): void => {
      res.headers[name] = value;
    },
    status: (code: number): FakeResponse => {
      res.statusCode = code;
      return res;
    },
    end: (): void => {
      res.ended = true;
      res.headersSent = true;
    },
    json: (body: unknown): void => {
      res.body = body;
      res.headersSent = true;
    },
    on: (): void => {
      // Metric listeners are not exercised here.
    },
  };

  return res;
}

function buildEnvelope(
  overrides?: Partial<SessionReplayChunkEnvelope>,
): SessionReplayChunkEnvelope {
  return {
    v: SESSION_REPLAY_WIRE_VERSION,
    appIdentifier: APP_IDENTIFIER,
    sessionId: "a".repeat(32),
    tabId: "b".repeat(16),
    chunkIndex: 0,
    sessionStartUnixMs: 1_800_000_000_000,
    clientSendUnixMs: 1_800_000_015_000,
    chunkStartOffsetMs: 0,
    chunkEndOffsetMs: 15_000,
    eventCount: 4,
    hasFullSnapshot: true,
    isFinal: false,
    recorderKind: "dom",
    schemaVersion: 1,
    rrwebVersion: "2.1.0",
    recorderVersion: "1.0.0",
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    consentState: "Granted",
    triggerReason: SessionReplayTriggerReason.Error,
    payloadEncoding: "gzip",
    payloadBytes: 0,
    url: "https://shop.example.com/checkout",
    signals: {
      errorCount: 0,
      rageClickCount: 0,
      deadClickCount: 0,
      errorClickCount: 0,
      refreshRageCount: 0,
      routeCount: 0,
    },
    fidelityNotices: [],
    droppedEvents: 0,
    flushFailures: 0,
    ...overrides,
  };
}

function buildBody(overrides?: Partial<SessionReplayChunkEnvelope>): Buffer {
  const payload: Buffer = zlib.gzipSync(
    new Uint8Array(Buffer.from(JSON.stringify([{ type: 2, data: {} }]))),
  );

  const envelope: SessionReplayChunkEnvelope = buildEnvelope({
    ...overrides,
    payloadBytes: payload.length,
  });

  return Buffer.concat([
    new Uint8Array(Buffer.from(`${JSON.stringify(envelope)}\n`)),
    new Uint8Array(payload),
  ]);
}

async function invokeChunkRoute(data: {
  body: unknown;
  headers?: Record<string, string>;
}): Promise<{ res: FakeResponse; nextError: Error | undefined }> {
  const handlers: Array<unknown> = registeredPostHandlers[CHUNK_ROUTE]!;

  const handler: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void> = handlers[handlers.length - 1] as (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void>;

  const res: FakeResponse = buildResponse();

  let nextError: Error | undefined = undefined;

  const next: NextFunction = ((err?: Error): void => {
    nextError = err;
  }) as NextFunction;

  await handler(
    {
      body: data.body,
      projectId: PROJECT_ID,
      headers: {
        [SESSION_REPLAY_APP_IDENTIFIER_HEADER]: APP_IDENTIFIER,
        origin: "https://shop.example.com",
        ...(data.headers || {}),
      },
      query: {},
    } as unknown as ExpressRequest,
    res as unknown as ExpressResponse,
    next,
  );

  return { res, nextError };
}

/* Status code as observed through either response path. */
function getStatus(res: FakeResponse): number {
  if (res.statusCode) {
    return res.statusCode;
  }

  const call: Array<unknown> | undefined = sendJsonMock.mock.calls[
    sendJsonMock.mock.calls.length - 1
  ] as Array<unknown> | undefined;

  if (!call) {
    return 0;
  }

  const options: { statusCode?: StatusCode } | undefined = call[3] as
    | { statusCode?: StatusCode }
    | undefined;

  return options?.statusCode ? options.statusCode.toNumber() : 200;
}

describe("POST /session-replay/v1/chunk", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    addJobMock.mockResolvedValue(undefined as never);
    markChunkReceivedMock.mockResolvedValue(undefined as never);
    markBudgetExceededMock.mockResolvedValue(undefined as never);
    updateLastSeenMock.mockResolvedValue(undefined as never);
    gateMock.mockResolvedValue({
      outcome: SessionReplayGateOutcome.Accepted,
      directive: "continue",
      configEpoch: 99,
      reason: "accepted",
      policy: { samplePercentage: 100, rumApplicationId: RUM_APPLICATION_ID },
    } as never);
  });

  test("registers the chunk route behind the shared auth middleware, verbatim", () => {
    const handlers: Array<unknown> = registeredPostHandlers[CHUNK_ROUTE]!;

    expect(handlers).toBeDefined();
    /*
     * The auth middleware must be the shared one, not a hand-rolled key
     * lookup: it is what reads the token from headers only and resolves it
     * behind the bounded positive/negative cache.
     */
    expect(handlers).toContain(authMiddleware);
    expect(handlers).toContain(ingestionDisabledMiddleware);
    expect(handlers).toContain(SessionReplayRequestMiddleware.parseBody);

    /* Byte cap before auth; auth before the terminal gate handler. */
    expect(
      handlers.indexOf(SessionReplayRequestMiddleware.parseBody),
    ).toBeLessThan(handlers.indexOf(authMiddleware));
    expect(handlers.indexOf(authMiddleware)).toBe(handlers.length - 2);
  });

  test("answers 202 only AFTER the enqueue succeeds", async () => {
    let enqueuedBeforeResponse: boolean = false;

    addJobMock.mockImplementation(async (): Promise<void> => {
      enqueuedBeforeResponse = sendJsonMock.mock.calls.length === 0;
    });

    const { res } = await invokeChunkRoute({ body: buildBody() });

    expect(addJobMock).toHaveBeenCalledTimes(1);
    expect(enqueuedBeforeResponse).toBe(true);
    expect(getStatus(res)).toBe(202);
  });

  test("answers 503 and never 202 when staging fails", async () => {
    addJobMock.mockRejectedValue(new Error("redis down") as never);

    const { res, nextError } = await invokeChunkRoute({ body: buildBody() });

    expect(getStatus(res)).toBe(503);
    expect(nextError).toBeUndefined();

    const payload: JSONObject = sendJsonMock.mock
      .calls[0]![2] as unknown as JSONObject;

    expect(payload["directive"]).toBe("throttle");
    expect(payload["retryAfterSeconds"]).toBeDefined();
    expect(payload["reason"]).toBe("staging-failed");
  });

  test("answers 204 with a stop directive when the gate says stop", async () => {
    gateMock.mockResolvedValue({
      outcome: SessionReplayGateOutcome.Stop,
      directive: "stop",
      configEpoch: 7,
      reason: "not-enabled",
    } as never);

    const { res } = await invokeChunkRoute({ body: buildBody() });

    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    /* 204 carries no body, so the directive rides in a header. */
    expect(res.headers["x-oneuptime-replay-directive"]).toBe("stop");
    expect(res.headers["x-oneuptime-replay-config-epoch"]).toBe("7");
    /*
     * The WHY rides alongside the directive. Without it, "stop" is
     * indistinguishable silence: a customer cannot tell a disabled app from
     * an exhausted budget from an unsampled session.
     */
    expect(res.headers["x-oneuptime-replay-reason"]).toBe("not-enabled");
    expect(addJobMock).not.toHaveBeenCalled();
  });

  test("records recording health on an accepted chunk, after the enqueue", async () => {
    const { res } = await invokeChunkRoute({ body: buildBody() });

    expect(getStatus(res)).toBe(202);
    expect(markChunkReceivedMock).toHaveBeenCalledTimes(1);
    expect(markChunkReceivedMock).toHaveBeenCalledWith(RUM_APPLICATION_ID);
    expect(markBudgetExceededMock).not.toHaveBeenCalled();
  });

  /*
   * REGRESSION: github.com/OneUptime/oneuptime/issues/3527.
   *
   * updateLastSeen used to be reachable only from the OTel ingest path, so an
   * application instrumented with the replay snippet alone was flipped to
   * "disconnected" by markDisconnectedApplications fifteen minutes after
   * whatever OTel batch last touched it - while its recorders were posting
   * chunks to this very route. The Dashboard showed "Disconnected" and a Last
   * Seen days old, which is what somebody reads before concluding their
   * install is broken.
   */
  test("an accepted chunk keeps the RUM application connected", async () => {
    const { res } = await invokeChunkRoute({ body: buildBody() });

    expect(getStatus(res)).toBe(202);
    expect(updateLastSeenMock).toHaveBeenCalledTimes(1);
    expect(updateLastSeenMock).toHaveBeenCalledWith(RUM_APPLICATION_ID);
  });

  /*
   * Liveness is written AFTER the enqueue, for the same reason recording
   * health is: a chunk that could not be staged did not land, and a 503 that
   * still refreshed lastSeenAt would report a storage outage as health.
   */
  test("does not refresh liveness when staging failed", async () => {
    addJobMock.mockRejectedValue(new Error("redis down") as never);

    const { res } = await invokeChunkRoute({ body: buildBody() });

    expect(getStatus(res)).toBe(503);
    expect(updateLastSeenMock).not.toHaveBeenCalled();
  });

  test("a refused chunk does not refresh liveness", async () => {
    gateMock.mockResolvedValue({
      outcome: SessionReplayGateOutcome.Stop,
      directive: "stop",
      configEpoch: 7,
      reason: "not-sampled",
      policy: { samplePercentage: 0, rumApplicationId: RUM_APPLICATION_ID },
    } as never);

    const { res } = await invokeChunkRoute({ body: buildBody() });

    expect(res.statusCode).toBe(204);
    expect(updateLastSeenMock).not.toHaveBeenCalled();
  });

  /*
   * A liveness write that throws must never reach the response. It is
   * bookkeeping; the chunk has already been staged.
   */
  test("a failed liveness write still answers 202", async () => {
    updateLastSeenMock.mockRejectedValue(new Error("postgres down") as never);

    const { res } = await invokeChunkRoute({ body: buildBody() });

    expect(getStatus(res)).toBe(202);
  });

  test("records budget exhaustion on the application so the Dashboard can explain the silence", async () => {
    gateMock.mockResolvedValue({
      outcome: SessionReplayGateOutcome.Stop,
      directive: "stop",
      configEpoch: 7,
      reason: "app-monthly-budget-exhausted",
      policy: { samplePercentage: 100, rumApplicationId: RUM_APPLICATION_ID },
    } as never);

    const { res } = await invokeChunkRoute({ body: buildBody() });

    expect(res.statusCode).toBe(204);
    expect(res.headers["x-oneuptime-replay-reason"]).toBe(
      "app-monthly-budget-exhausted",
    );
    expect(markBudgetExceededMock).toHaveBeenCalledWith(RUM_APPLICATION_ID);
    /* A refused chunk is not a received recording. */
    expect(markChunkReceivedMock).not.toHaveBeenCalled();
  });

  /*
   * Running past the per-session chunk cap is a normal end-of-session
   * condition for a long-lived tab. The envelope parser rejects the index
   * before the gate ever sees it, so without this mapping the recorder gets a
   * hard 400 "malformed frame" with no directive and no way to stand down -
   * and the gate's own session-chunk-cap branch is unreachable from the
   * route, so it cannot supply the 204 either.
   */
  test("answers 204 with a stop directive at the per-session chunk cap", async () => {
    const { res } = await invokeChunkRoute({
      body: buildBody({ chunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION }),
    });

    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    expect(res.headers["x-oneuptime-replay-directive"]).toBe("stop");
    /* Not a 400, and specifically not a bare parse error with no directive. */
    expect(sendJsonMock).not.toHaveBeenCalled();
    expect(addJobMock).not.toHaveBeenCalled();
    /* The gate is never even reached - the parser rejected first. */
    expect(gateMock).not.toHaveBeenCalled();
  });

  test("answers 403 for an origin that is not on the allowlist", async () => {
    gateMock.mockResolvedValue({
      outcome: SessionReplayGateOutcome.OriginRefused,
      directive: "stop",
      configEpoch: 7,
      reason: "origin-not-allowed",
    } as never);

    const { res } = await invokeChunkRoute({ body: buildBody() });

    expect(getStatus(res)).toBe(403);
    /* The WHY rides on every bodied refusal, not only the 204 header. */
    const forbiddenPayload: JSONObject = sendJsonMock.mock
      .calls[0]![2] as unknown as JSONObject;
    expect(forbiddenPayload["reason"]).toBe("origin-not-allowed");
    expect(addJobMock).not.toHaveBeenCalled();
  });

  test("answers 429 with Retry-After past the rate limit", async () => {
    gateMock.mockResolvedValue({
      outcome: SessionReplayGateOutcome.RateLimited,
      directive: "throttle",
      configEpoch: 7,
      retryAfterSeconds: 23,
      reason: "rate-limited",
    } as never);

    const { res } = await invokeChunkRoute({ body: buildBody() });

    expect(getStatus(res)).toBe(429);
    expect(res.headers["Retry-After"]).toBe("23");
    const throttledPayload: JSONObject = sendJsonMock.mock
      .calls[0]![2] as unknown as JSONObject;
    expect(throttledPayload["reason"]).toBe("rate-limited");
    expect(addJobMock).not.toHaveBeenCalled();
  });

  test("rejects a request with no app identifier header", async () => {
    const { res } = await invokeChunkRoute({
      body: buildBody(),
      headers: { [SESSION_REPLAY_APP_IDENTIFIER_HEADER]: "" },
    });

    expect(getStatus(res)).toBe(400);
    expect(gateMock).not.toHaveBeenCalled();
  });

  test("rejects a frame whose appIdentifier disagrees with the header", async () => {
    /*
     * Otherwise a client could pass the gate for a permissive application
     * and write rows attributed to a different one.
     */
    const { res } = await invokeChunkRoute({
      body: buildBody({ appIdentifier: "some-other-app" }),
    });

    expect(getStatus(res)).toBe(400);
    expect(gateMock).not.toHaveBeenCalled();
  });

  test("a parsed (non-Buffer) body is refused rather than silently accepted", async () => {
    /*
     * This is what an accidental StartServer bypass regression looks like
     * from in here: the global JSON parser turns a binary body into {}.
     */
    const { res } = await invokeChunkRoute({ body: {} });

    expect(getStatus(res)).toBe(400);
    expect(addJobMock).not.toHaveBeenCalled();
  });

  test("an oversized indivisible snapshot answers 422, not 413", async () => {
    const envelope: SessionReplayChunkEnvelope = buildEnvelope({
      payloadBytes: MAX_SESSION_REPLAY_CHUNK_BYTES + 1,
    });

    const body: Buffer = Buffer.from(`${JSON.stringify(envelope)}\n`);

    const { res } = await invokeChunkRoute({ body });

    /*
     * 422 keeps the session alive with a fidelity notice instead of making
     * the whole recording vanish behind a size error.
     */
    expect(getStatus(res)).toBe(422);
  });

  test("stages the raw request body, unchanged", async () => {
    const body: Buffer = buildBody();

    await invokeChunkRoute({ body });

    const args: JSONObject = addJobMock.mock.calls[0]![0] as JSONObject;

    expect(args["projectId"]).toBe(PROJECT_ID);
    expect(args["appIdentifier"]).toBe(APP_IDENTIFIER);
    expect((args["body"] as Buffer).toString("base64")).toBe(
      body.toString("base64"),
    );
    expect(args["serverReceiveUnixMs"]).toBeGreaterThan(0);
  });

  /*
   * Geo headers are client-controlled unless the ingress overwrites them, and
   * nothing in the Nginx config strips cf-ipcountry / x-vercel-ip-country.
   * SESSION_REPLAY_TRUSTED_GEO_HEADER is unset in this test environment, so
   * nothing may be believed.
   */
  test("a client-supplied country header is not believed by default", async () => {
    await invokeChunkRoute({
      body: buildBody(),
      headers: {
        "cf-ipcountry": "KP",
        "x-vercel-ip-country": "KP",
        "x-country-code": "KP",
      },
    });

    const args: JSONObject = addJobMock.mock.calls[0]![0] as JSONObject;

    expect(args["countryCode"]).toBe("");
  });
});

describe("GET /session-replay/v1/config and /validate", () => {
  test("both routes are registered", () => {
    expect(registeredGetHandlers["/session-replay/v1/config"]).toBeDefined();
    expect(registeredGetHandlers["/session-replay/v1/validate"]).toBeDefined();
  });

  test("the config route is authenticated and the validate route is not", () => {
    /*
     * validate deliberately runs without the auth middleware: its entire
     * job is to answer "is this token accepted?", which a 401 from the auth
     * middleware could not express as a body.
     */
    expect(registeredGetHandlers["/session-replay/v1/config"]).toContain(
      authMiddleware,
    );
    expect(registeredGetHandlers["/session-replay/v1/validate"]).not.toContain(
      authMiddleware,
    );
  });
});

describe("recorder artifact delivery", () => {
  /*
   * Regression guard for a shipped-but-unreachable feature: the build
   * produced public/dist/{recorder.js,loader.js} and the config endpoint
   * advertised a version, but NOTHING in the repo served the files, so no
   * browser could ever load the recorder. Nothing else in the test suite
   * would have noticed - every unit test passed.
   */
  test("both artifact routes are registered", () => {
    expect(
      registeredGetHandlers["/session-replay/v1/recorder.js"],
    ).toBeDefined();
    expect(
      registeredGetHandlers["/session-replay/v:version/recorder.js"],
    ).toBeDefined();
  });

  test("artifact routes are public, because a customer page loads them with a plain script tag", () => {
    /*
     * These carry no secrets and no project data. Requiring the ingestion
     * key here would mean putting it in a URL on a third-party page, which
     * is strictly worse than serving a public static script.
     */
    expect(
      registeredGetHandlers["/session-replay/v1/recorder.js"],
    ).not.toContain(authMiddleware);
    expect(
      registeredGetHandlers["/session-replay/v:version/recorder.js"],
    ).not.toContain(authMiddleware);
  });

  test("the loader route is declared WITHOUT the /telemetry prefix", () => {
    /*
     * The router is mounted at both "/" and "/telemetry", so declaring
     * "/telemetry/session-replay/..." here would actually serve
     * "/telemetry/telemetry/session-replay/...". The public URL customers
     * paste is /telemetry/session-replay/v1/recorder.js, and it is the
     * mount that supplies that prefix.
     */
    for (const path of Object.keys(registeredGetHandlers)) {
      expect(path.startsWith("/telemetry/")).toBe(false);
    }
  });

  test("a malformed version is 404ed rather than reaching the filesystem", async () => {
    const handlers: Array<unknown> | undefined =
      registeredGetHandlers["/session-replay/v:version/recorder.js"];

    const handler: (
      req: ExpressRequest,
      res: ExpressResponse,
    ) => void | Promise<void> = handlers![handlers!.length - 1] as (
      req: ExpressRequest,
      res: ExpressResponse,
    ) => void | Promise<void>;

    /*
     * Traversal and junk both go down the same path: the version is matched
     * against the semver pattern before the manifest is consulted, so the
     * segment is never joined onto a directory.
     */
    for (const badVersion of [
      "../../../../etc/passwd",
      "1.0",
      "latest",
      "",
      "1.0.0/../../secret",
    ]) {
      const res: FakeResponse = buildResponse();

      await handler(
        {
          params: { version: badVersion },
          headers: {},
        } as unknown as ExpressRequest,
        res as unknown as ExpressResponse,
      );

      expect(res.statusCode).toBe(404);
      expect(res.ended).toBe(true);
    }
  });
});

describe("SessionReplayRequestMiddleware.parseBody", () => {
  interface FakeRequest extends EventEmitter {
    body?: unknown;
    headers: Record<string, string>;
    destroy: () => void;
    resume: () => void;
    destroyed: boolean;
    resumed: boolean;
  }

  function buildRequest(headers?: Record<string, string>): FakeRequest {
    const req: FakeRequest = new EventEmitter() as FakeRequest;

    req.headers = headers || {};
    req.destroyed = false;
    req.resumed = false;
    req.destroy = (): void => {
      req.destroyed = true;
    };
    req.resume = (): void => {
      req.resumed = true;
    };

    return req;
  }

  test("reads a well-sized body into a Buffer and continues", async () => {
    const req: FakeRequest = buildRequest();
    const res: FakeResponse = buildResponse();

    let called: boolean = false;

    const promise: Promise<void> = SessionReplayRequestMiddleware.parseBody(
      req as unknown as ExpressRequest,
      res as unknown as ExpressResponse,
      ((): void => {
        called = true;
      }) as NextFunction,
    );

    req.emit("data", Buffer.from("hello"));
    req.emit("end");

    await promise;

    expect(called).toBe(true);
    expect(Buffer.isBuffer(req.body)).toBe(true);
    expect((req.body as Buffer).toString()).toBe("hello");
  });

  test("rejects an over-cap Content-Length before reading a byte", async () => {
    const req: FakeRequest = buildRequest({
      "content-length": String(MAX_SESSION_REPLAY_CHUNK_BYTES + 1),
    });
    const res: FakeResponse = buildResponse();

    let called: boolean = false;

    await SessionReplayRequestMiddleware.parseBody(
      req as unknown as ExpressRequest,
      res as unknown as ExpressResponse,
      ((): void => {
        called = true;
      }) as NextFunction,
    );

    expect(res.statusCode).toBe(413);
    expect(called).toBe(false);
  });

  test("sends 413 BEFORE it stops consuming, and never destroys the socket", async () => {
    const req: FakeRequest = buildRequest();
    const res: FakeResponse = buildResponse();

    let called: boolean = false;

    const promise: Promise<void> = SessionReplayRequestMiddleware.parseBody(
      req as unknown as ExpressRequest,
      res as unknown as ExpressResponse,
      ((): void => {
        called = true;
      }) as NextFunction,
    );

    /* Two chunks that together exceed the cap. */
    const half: Buffer = Buffer.alloc(
      Math.ceil(MAX_SESSION_REPLAY_CHUNK_BYTES / 2) + 1,
    );

    req.emit("data", half);
    req.emit("data", half);

    await promise;

    expect(res.statusCode).toBe(413);
    /*
     * req.destroy() would tear down the socket, so the recorder would see a
     * network error instead of a status code - and it classifies network
     * errors as retryable, so it would retry the same oversized chunk
     * forever while never learning what was wrong.
     */
    expect(req.destroyed).toBe(false);
    /* The remainder is drained so the keep-alive connection stays usable. */
    expect(req.resumed).toBe(true);
    expect(called).toBe(false);
  });

  test("an already-parsed body short-circuits rather than double-reading", async () => {
    const req: FakeRequest = buildRequest();
    req.body = { alreadyParsed: true };

    const res: FakeResponse = buildResponse();

    let called: boolean = false;

    await SessionReplayRequestMiddleware.parseBody(
      req as unknown as ExpressRequest,
      res as unknown as ExpressResponse,
      ((): void => {
        called = true;
      }) as NextFunction,
    );

    expect(called).toBe(true);
    expect(res.statusCode).toBe(0);
  });
});

/*
 * Source-level assertions on StartServer's body-parser bypass.
 *
 * A jest test cannot exercise the real Express stack here, and the failure
 * this guards against is silent: if the predicate were `startsWith`, the
 * /telemetry-prefixed path would fall into the global gzip fast-path, which
 * has no size limit and hands the router an already-decompressed body -
 * defeating the byte cap entirely, with no visible symptom.
 */
describe("StartServer body-parser bypass covers session replay", () => {
  const startServerSource: string = fs.readFileSync(
    path.join(__dirname, "../../../Common/Server/Utils/StartServer.ts"),
    "utf-8",
  );

  test("both bypass predicates use .includes with the session-replay path", () => {
    const matches: Array<string> =
      startServerSource.match(
        /req\.path\.includes\("\/session-replay\/v1\/"\)/g,
      ) || [];

    /* One in the json/gzip predicate, one in its urlencoded twin. */
    expect(matches).toHaveLength(2);
  });

  test("the session-replay bypass is never written as startsWith", () => {
    expect(startServerSource).not.toContain(
      'req.path.startsWith("/session-replay',
    );
  });

  test("the app-identifier header is listed on Access-Control-Allow-Headers", () => {
    /*
     * A source assertion only because setDefaultHeaders writes this one on
     * simple responses. The values that govern the PREFLIGHT (Max-Age) and
     * cross-origin readability (Expose-Headers) are asserted for real, by
     * driving the cors middleware, in
     * Common/Tests/Server/Utils/CorsOptions.test.ts - @types/cors is not
     * resolvable from App. This one is pinned to the header LINE rather than
     * the whole file, so the explanatory comment above it cannot satisfy it
     * on its own the way the previous version of this test could.
     */
    const allowHeadersLine: string =
      startServerSource.split("\n").find((line: string): boolean => {
        return line.includes("X-Requested-With, X-HTTP-Method-Override");
      }) || "";

    expect(allowHeadersLine).toContain("x-oneuptime-token");
    expect(allowHeadersLine).toContain(SESSION_REPLAY_APP_IDENTIFIER_HEADER);
  });
});

/*
 * The replay router is mounted on TELEMETRY_PREFIXES, so
 * /telemetry/session-replay/v1/chunk is as live as /session-replay/v1/chunk -
 * that is the whole reason StartServer's bypass predicates use .includes.
 * nginx sets no global client_max_body_size, so a location without one gets
 * the 1M default and answers a bare 413 with no directive, giving the app no
 * chance to reply.
 */
describe("Nginx body size covers every path the replay router is mounted on", () => {
  const nginxSource: string = fs.readFileSync(
    path.join(__dirname, "../../../Nginx/default.conf.template"),
    "utf-8",
  );

  function locationBlock(name: string): string {
    const marker: string = `location ${name} {`;
    const start: number = nginxSource.indexOf(marker);

    if (start === -1) {
      return "";
    }

    const end: number = nginxSource.indexOf("\n    }", start);

    return nginxSource.substring(start, end === -1 ? undefined : end);
  }

  test("the /session-replay location raises the body limit", () => {
    expect(locationBlock("/session-replay")).toContain(
      "client_max_body_size 4M;",
    );
  });

  test("the /telemetry location raises it too", () => {
    expect(locationBlock("/telemetry")).toContain("client_max_body_size 4M;");
  });
});
