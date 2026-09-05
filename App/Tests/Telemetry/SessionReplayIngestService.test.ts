import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import {
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  SESSION_REPLAY_MAX_USER_REF_LENGTH,
  SESSION_REPLAY_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION,
  SessionReplayChunkEnvelope,
  SessionReplayChunkMeta,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayIdentity from "Common/Server/Utils/SessionReplay/SessionReplayIdentity";
import zlib from "zlib";

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

/*
 * SESSION_REPLAY_ENABLED_BY_DEFAULT ships TRUE; setting it to false is how
 * an operator turns replay off instance-wide, and the gate then refuses
 * outright (the config endpoint already did). Everything in this file
 * exercises an instance that DOES offer replay; the off case has its own
 * file, SessionReplayInstanceSwitch.test.ts.
 */
jest.mock("../../FeatureSet/Telemetry/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Telemetry/Config",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    SESSION_REPLAY_INGEST_ENABLED: true,
    SESSION_REPLAY_ENABLED_BY_DEFAULT: true,
  };
});

/*
 * A CONNECTED Redis, so the "register the session with the finalizer only
 * after its rows landed" ordering is actually observable. The string half
 * is a real in-memory map because the session-start memo and the seal hint
 * are read back by the code under test.
 */
const zaddMock: ReturnType<typeof jest.fn> = jest.fn();
const expireMock: ReturnType<typeof jest.fn> = jest.fn();
const saddMock: ReturnType<typeof jest.fn> = jest.fn();
const decrbyMock: ReturnType<typeof jest.fn> = jest.fn();
const redisStrings: Map<string, string> = new Map<string, string>();
let redisConnected: boolean = true;

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        if (!redisConnected) {
          return null;
        }

        return {
          zadd: zaddMock,
          expire: expireMock,
          sadd: saddMock,
          decrby: decrbyMock,
          get: (key: string): Promise<string | null> => {
            return Promise.resolve(redisStrings.get(key) ?? null);
          },
          set: (
            key: string,
            value: string,
            _expiryToken?: string,
            _seconds?: number,
            nxToken?: string,
          ): Promise<"OK" | null> => {
            if (nxToken === "NX" && redisStrings.has(key)) {
              return Promise.resolve(null);
            }

            redisStrings.set(key, value);
            return Promise.resolve("OK");
          },
        };
      },
      isConnected: (): boolean => {
        return redisConnected;
      },
    },
  };
});

jest.mock("Common/Server/Services/RumApplicationService", () => {
  return {
    __esModule: true,
    default: {
      markSessionReplayChunkReceived: jest.fn(),
    },
  };
});

jest.mock(
  "Common/Server/Utils/SessionReplay/SessionReplayHealthCounters",
  () => {
    return {
      __esModule: true,
      default: {
        recordRefusal: jest.fn(),
        recordDrop: jest.fn(),
        readRefusalsLast24h: jest.fn(),
        readDropsLast24h: jest.fn(),
      },
    };
  },
);

jest.mock("Common/Server/Services/RumSessionService", () => {
  return {
    __esModule: true,
    default: { model: { tableName: "RumSessionV1" } },
  };
});

jest.mock("Common/Server/Services/RumSessionChunkService", () => {
  return {
    __esModule: true,
    default: { model: { tableName: "RumSessionChunkV1" } },
  };
});

/*
 * resolvePolicy is derived from getPolicy so every existing case that seeds
 * getPolicyMock keeps meaning what it meant; a null policy resolves as
 * "application-not-enabled" unless a test overrides resolvePolicy itself.
 */
jest.mock("Common/Server/Utils/SessionReplay/SessionReplayGateCache", () => {
  const getPolicy: ReturnType<typeof jest.fn> = jest.fn();

  return {
    __esModule: true,
    default: {
      getPolicy: getPolicy,
      resolvePolicy: jest.fn(async (data: unknown): Promise<unknown> => {
        const policy: unknown = await getPolicy(data);

        return {
          policy: policy,
          refusal: policy ? null : "application-not-enabled",
        };
      }),
      isOriginAllowed: jest.fn().mockReturnValue(true),
      markProjectDisabled: jest.fn(),
      clearCache: jest.fn(),
    },
    SessionReplayPolicyRefusal: {
      ProjectNotAllowed: "project-not-allowed",
      ApplicationNotEnabled: "application-not-enabled",
      ApplicationUnknown: "application-unknown",
      ProjectKilled: "project-killed",
      IdentifierMissing: "app-identifier-missing",
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/TelemetryFanInWriter", () => {
  return {
    __esModule: true,
    default: {
      submit: jest.fn(),
    },
    /*
     * The REAL pushObservedAck semantics, not a bare push. The ack-after-
     * flush contract (a rejected flush fails the job so BullMQ re-processes
     * it, wrapped in SessionReplayStorageFlushError) is load-bearing, and a
     * mock that drops the wrapError callback would never exercise it.
     */
    pushObservedAck: (
      pendingAcks: Array<Promise<void>>,
      flushed: Promise<void>,
      wrapError: (err: Error) => Error,
    ): void => {
      const ack: Promise<void> = flushed.catch((error: Error) => {
        throw wrapError(error);
      });

      ack.catch((): void => {
        /* Pre-observed; delivered for real at the job's await point. */
      });

      pendingAcks.push(ack);
    },
  };
});

jest.mock(
  "../../FeatureSet/Telemetry/Services/SessionReplayScrubService",
  () => {
    return {
      __esModule: true,
      default: {
        loadRules: jest.fn(),
        scrubEvents: jest.fn(),
      },
    };
  },
);

jest.mock("../../FeatureSet/Telemetry/Utils/SessionReplayChunkStore", () => {
  return {
    __esModule: true,
    default: {
      storeBody: jest.fn(),
      readBody: jest.fn(),
      deleteBody: jest.fn(),
    },
  };
});

jest.mock("../../FeatureSet/Telemetry/Utils/SessionReplayRateLimiter", () => {
  return {
    __esModule: true,
    default: {
      consumeChunkAllowance: jest.fn(),
      consumeByteBudget: jest.fn(),
      consumeApplicationMonthlyBudget: jest.fn(),
      getBytesUsedToday: jest.fn(),
    },
    SessionReplayLimitOutcome: {
      Allowed: "allowed",
      RateLimited: "rate-limited",
      BudgetExhausted: "budget-exhausted",
      CounterUnavailable: "counter-unavailable",
    },
  };
});

/*
 * The erasure tombstone is a real Redis round trip on the ingest hot path.
 * Default it to "not erased" so the existing cases exercise the normal
 * route, and let individual tests override it.
 */
jest.mock(
  "Common/Server/Utils/SessionReplay/SessionReplayErasureTombstone",
  () => {
    class FakeErasureTombstoneUnavailableError extends Error {}

    return {
      __esModule: true,
      isSessionErased: jest.fn(),
      ErasureTombstoneUnavailableError: FakeErasureTombstoneUnavailableError,
    };
  },
);

import {
  ErasureTombstoneUnavailableError,
  isSessionErased,
} from "Common/Server/Utils/SessionReplay/SessionReplayErasureTombstone";
import SessionReplayGateCache, {
  SessionReplayGatePolicy,
} from "Common/Server/Utils/SessionReplay/SessionReplayGateCache";
import SessionReplayHealthCounters from "Common/Server/Utils/SessionReplay/SessionReplayHealthCounters";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import SessionReplayUsage from "Common/Server/Utils/SessionReplay/SessionReplayUsage";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import SessionReplayScrubService from "../../FeatureSet/Telemetry/Services/SessionReplayScrubService";
import SessionReplayChunkStore from "../../FeatureSet/Telemetry/Utils/SessionReplayChunkStore";
import SessionReplayRateLimiter, {
  SessionReplayLimitOutcome,
} from "../../FeatureSet/Telemetry/Utils/SessionReplayRateLimiter";
import SessionReplayIngestService, {
  SessionReplayGateDecision,
  SessionReplayGateOutcome,
} from "../../FeatureSet/Telemetry/Services/SessionReplayIngestService";
import { SessionReplayIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";

type MockedFn = ReturnType<typeof jest.fn>;

const getPolicyMock: MockedFn =
  SessionReplayGateCache.getPolicy as unknown as MockedFn;
const resolvePolicyMock: MockedFn =
  SessionReplayGateCache.resolvePolicy as unknown as MockedFn;
const isOriginAllowedMock: MockedFn =
  SessionReplayGateCache.isOriginAllowed as unknown as MockedFn;
const recordRefusalMock: MockedFn =
  SessionReplayHealthCounters.recordRefusal as unknown as MockedFn;
const recordDropMock: MockedFn =
  SessionReplayHealthCounters.recordDrop as unknown as MockedFn;
const markChunkReceivedMock: MockedFn =
  RumApplicationService.markSessionReplayChunkReceived as unknown as MockedFn;
const submitMock: MockedFn = TelemetryFanInWriter.submit as unknown as MockedFn;
const loadRulesMock: MockedFn =
  SessionReplayScrubService.loadRules as unknown as MockedFn;
const scrubEventsMock: MockedFn =
  SessionReplayScrubService.scrubEvents as unknown as MockedFn;
const readBodyMock: MockedFn =
  SessionReplayChunkStore.readBody as unknown as MockedFn;
const consumeChunkAllowanceMock: MockedFn =
  SessionReplayRateLimiter.consumeChunkAllowance as unknown as MockedFn;
const consumeByteBudgetMock: MockedFn =
  SessionReplayRateLimiter.consumeByteBudget as unknown as MockedFn;
const consumeApplicationMonthlyBudgetMock: MockedFn =
  SessionReplayRateLimiter.consumeApplicationMonthlyBudget as unknown as MockedFn;

const PROJECT_ID: ObjectID = ObjectID.generate();
const RUM_APPLICATION_ID: ObjectID = ObjectID.generate();

const APP_IDENTIFIER: string = "checkout-web";

function buildPolicy(
  overrides?: Partial<SessionReplayGatePolicy>,
): SessionReplayGatePolicy {
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
    captureGeo: true,
    retentionInDays: 7,
    monthlyBudgetInGB: null,
    ignoreErrorPatterns: [],
    tracePropagationOrigins: [],
    lcpBudgetMs: 0,
    longTaskBudgetMs: 0,
    slowRequestBudgetMs: 0,
    configEpoch: 1234,
    ...overrides,
  };
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
    eventCount: 42,
    hasFullSnapshot: true,
    isFinal: false,
    recorderKind: "dom",
    schemaVersion: SESSION_REPLAY_SCHEMA_VERSION,
    rrwebVersion: "2.1.0",
    recorderVersion: "1.0.0",
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    consentState: "Granted",
    triggerReason: SessionReplayTriggerReason.Error,
    payloadEncoding: "gzip",
    payloadBytes: 0,
    url: "https://shop.example.com/checkout",
    signals: {
      errorCount: 2,
      rageClickCount: 1,
      deadClickCount: 0,
      errorClickCount: 1,
      refreshRageCount: 0,
      routeCount: 3,
    },
    fidelityNotices: [],
    droppedEvents: 0,
    flushFailures: 0,
    meta: {
      entryUrl: "https://shop.example.com/",
      browserName: "Chrome",
      browserVersion: "141",
      osName: "macOS",
      deviceType: "desktop",
      viewportWidth: 1440,
      viewportHeight: 900,
    },
    ...overrides,
  };
}

/* Build a real wire body so the parser is exercised, not stubbed. */
function buildBody(
  envelopes: Array<Partial<SessionReplayChunkEnvelope>>,
  events: Array<unknown> = [{ type: 2, timestamp: 1, data: {} }],
): Buffer {
  const parts: Array<Buffer> = [];

  for (const overrides of envelopes) {
    const payload: Buffer = zlib.gzipSync(
      new Uint8Array(Buffer.from(JSON.stringify(events))),
    );

    const envelope: SessionReplayChunkEnvelope = buildEnvelope({
      ...overrides,
      payloadBytes: payload.length,
    });

    parts.push(Buffer.from(`${JSON.stringify(envelope)}\n`));
    parts.push(payload);
  }

  return Buffer.concat(
    parts.map((p: Buffer): Uint8Array => {
      return new Uint8Array(p);
    }),
  );
}

function buildJobData(
  body: Buffer,
  overrides?: Partial<SessionReplayIngestJobData>,
): SessionReplayIngestJobData {
  return {
    projectId: PROJECT_ID.toString(),
    appIdentifier: APP_IDENTIFIER,
    inlineBodyBase64: body.toString("base64"),
    serverReceiveUnixMs: 1_800_000_020_000,
    samplePercentageAtCapture: 100,
    countryCode: "GB",
    ...overrides,
  };
}

function getSubmittedRows(tableName: string): Array<JSONObject> {
  for (const call of submitMock.mock.calls) {
    const target: { model: { tableName: string } } = call[0] as {
      model: { tableName: string };
    };

    if (target.model.tableName === tableName) {
      return call[1] as Array<JSONObject>;
    }
  }

  return [];
}

describe("SessionReplayIngestService.gateChunkRequest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisStrings.clear();
    redisConnected = true;
    recordRefusalMock.mockResolvedValue(undefined as never);
    recordDropMock.mockResolvedValue(undefined as never);
    getPolicyMock.mockResolvedValue(buildPolicy() as never);
    isOriginAllowedMock.mockReturnValue(true);
    consumeChunkAllowanceMock.mockResolvedValue({
      outcome: SessionReplayLimitOutcome.Allowed,
    } as never);
    consumeByteBudgetMock.mockResolvedValue({
      outcome: SessionReplayLimitOutcome.Allowed,
    } as never);
    consumeApplicationMonthlyBudgetMock.mockResolvedValue({
      outcome: SessionReplayLimitOutcome.Allowed,
    } as never);
  });

  const baseGateInput: {
    projectId: ObjectID;
    appIdentifier: string;
    origin: string;
    sessionIds: Array<string>;
    maxChunkIndex: number;
    chunkCount: number;
    payloadBytes: number;
  } = {
    projectId: PROJECT_ID,
    appIdentifier: APP_IDENTIFIER,
    origin: "https://shop.example.com",
    sessionIds: ["a".repeat(32)],
    maxChunkIndex: 0,
    chunkCount: 1,
    payloadBytes: 7000,
  };

  test("accepts a fully-configured application", async () => {
    const decision: SessionReplayGateDecision =
      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

    expect(decision.outcome).toBe(SessionReplayGateOutcome.Accepted);
    expect(decision.directive).toBe("continue");
    expect(decision.policy).toBeDefined();
  });

  test("stops when the policy resolves to null (project or app disabled)", async () => {
    getPolicyMock.mockResolvedValue(null as never);

    const decision: SessionReplayGateDecision =
      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

    expect(decision.outcome).toBe(SessionReplayGateOutcome.Stop);
    expect(decision.directive).toBe("stop");
    expect(decision.reason).toBe("not-enabled");
    /* Nothing may be counted or staged once the gate says no. */
    expect(consumeChunkAllowanceMock).not.toHaveBeenCalled();
  });

  test("a failed policy lookup is retryable, never a silent accept", async () => {
    getPolicyMock.mockRejectedValue(new Error("postgres down") as never);

    const decision: SessionReplayGateDecision =
      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

    expect(decision.outcome).toBe(SessionReplayGateOutcome.StorageUnavailable);
    expect(decision.reason).toBe("policy-unavailable");
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("refuses an origin that is not on the allowlist", async () => {
    isOriginAllowedMock.mockReturnValue(false);

    const decision: SessionReplayGateDecision =
      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

    expect(decision.outcome).toBe(SessionReplayGateOutcome.OriginRefused);
    expect(decision.directive).toBe("stop");
  });

  /*
   * Defence in depth only. The route can no longer produce this input: the
   * envelope parser rejects chunkIndex >= MAX_SESSION_REPLAY_CHUNKS_PER_SESSION
   * first, and SessionReplayIngest maps that to the same 204 + directive
   * "stop" (see SessionReplayIngestAPI.test.ts). This pins the gate's own
   * branch so relaxing the parser later cannot silently remove the cap.
   */
  test("stops at the per-session chunk cap", async () => {
    const decision: SessionReplayGateDecision =
      await SessionReplayIngestService.gateChunkRequest({
        ...baseGateInput,
        maxChunkIndex: 480,
      });

    expect(decision.outcome).toBe(SessionReplayGateOutcome.Stop);
    expect(decision.reason).toBe("session-chunk-cap");
  });

  test("stops an unsampled session", async () => {
    getPolicyMock.mockResolvedValue(
      buildPolicy({ samplePercentage: 0 }) as never,
    );

    const decision: SessionReplayGateDecision =
      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

    expect(decision.outcome).toBe(SessionReplayGateOutcome.Stop);
    expect(decision.reason).toBe("not-sampled");
  });

  /*
   * The configuration that ONCE shipped as the default and recorded nothing
   * at all: captureTrigger OnErrorOrFrustration with samplePercentage 0
   * made isSampled() false for every session, so every chunk came back 204.
   * The defaults are now Always at 100%, but any project that dialled
   * sampling down still relies on this rule. Sampling is meant to be
   * ADDITIONAL to the trigger: a frame uploaded because something actually
   * went wrong has already earned its place, and re-deciding it by dice
   * roll discards exactly the sessions the feature exists to keep.
   */
  for (const reason of [
    SessionReplayTriggerReason.Error,
    SessionReplayTriggerReason.Frustration,
    SessionReplayTriggerReason.Manual,
  ]) {
    test(`accepts a "${reason}"-triggered chunk at samplePercentage 0`, async () => {
      getPolicyMock.mockResolvedValue(
        buildPolicy({ samplePercentage: 0 }) as never,
      );

      const decision: SessionReplayGateDecision =
        await SessionReplayIngestService.gateChunkRequest({
          ...baseGateInput,
          triggerReasons: [reason],
        });

      expect(decision.outcome).toBe(SessionReplayGateOutcome.Accepted);
      expect(decision.directive).toBe("continue");
    });
  }

  /*
   * "sampled" is the one reason that must still face the check: it is the
   * recorder saying it uploaded on the dice roll alone, so re-rolling it
   * server-side is what catches a stale recorder still uploading after the
   * rate was turned down.
   */
  test('re-rolls a "sampled"-triggered chunk and stops it when out of sample', async () => {
    getPolicyMock.mockResolvedValue(
      buildPolicy({ samplePercentage: 0 }) as never,
    );

    const decision: SessionReplayGateDecision =
      await SessionReplayIngestService.gateChunkRequest({
        ...baseGateInput,
        triggerReasons: [SessionReplayTriggerReason.Sampled],
      });

    expect(decision.outcome).toBe(SessionReplayGateOutcome.Stop);
    expect(decision.reason).toBe("not-sampled");
  });

  /*
   * A catch-up post can carry both. One real trigger in the batch is enough:
   * splitting the batch to refuse only the sampled frames would cost a second
   * round trip to save writing frames we already have in hand.
   */
  test("a mixed batch is accepted when any frame fired a real trigger", async () => {
    getPolicyMock.mockResolvedValue(
      buildPolicy({ samplePercentage: 0 }) as never,
    );

    const decision: SessionReplayGateDecision =
      await SessionReplayIngestService.gateChunkRequest({
        ...baseGateInput,
        triggerReasons: [
          SessionReplayTriggerReason.Sampled,
          SessionReplayTriggerReason.Error,
        ],
      });

    expect(decision.outcome).toBe(SessionReplayGateOutcome.Accepted);
  });

  test("rate limiting is retryable and carries Retry-After", async () => {
    consumeChunkAllowanceMock.mockResolvedValue({
      outcome: SessionReplayLimitOutcome.RateLimited,
      retryAfterSeconds: 17,
    } as never);

    const decision: SessionReplayGateDecision =
      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

    expect(decision.outcome).toBe(SessionReplayGateOutcome.RateLimited);
    expect(decision.retryAfterSeconds).toBe(17);
    expect(decision.directive).toBe("throttle");
    /* The byte budget is not consumed for a request we are refusing. */
    expect(consumeByteBudgetMock).not.toHaveBeenCalled();
  });

  test("an exhausted byte budget stops the recorder rather than throttling it", async () => {
    consumeByteBudgetMock.mockResolvedValue({
      outcome: SessionReplayLimitOutcome.BudgetExhausted,
    } as never);

    const decision: SessionReplayGateDecision =
      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

    expect(decision.outcome).toBe(SessionReplayGateOutcome.Stop);
    expect(decision.directive).toBe("stop");
    expect(decision.reason).toBe("budget-exhausted");
  });

  test("unavailable counters fail closed as retryable, not open", async () => {
    consumeChunkAllowanceMock.mockResolvedValue({
      outcome: SessionReplayLimitOutcome.CounterUnavailable,
    } as never);

    const decision: SessionReplayGateDecision =
      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

    expect(decision.outcome).toBe(SessionReplayGateOutcome.StorageUnavailable);
  });

  /*
   * The application's customer-configured monthly budget, distinct from the
   * operator's instance-wide daily cap. A budget field that is stored and
   * displayed but never consulted promises a protection that does not
   * exist, so these pin that it is actually enforced.
   */
  test("does not consult the monthly budget when none is configured", async () => {
    const decision: SessionReplayGateDecision =
      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

    expect(decision.outcome).toBe(SessionReplayGateOutcome.Accepted);
    expect(consumeApplicationMonthlyBudgetMock).not.toHaveBeenCalled();
  });

  test("charges the monthly budget with the configured ceiling in bytes", async () => {
    getPolicyMock.mockResolvedValue(
      buildPolicy({ monthlyBudgetInGB: 2 }) as never,
    );

    const decision: SessionReplayGateDecision =
      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

    expect(decision.outcome).toBe(SessionReplayGateOutcome.Accepted);
    expect(consumeApplicationMonthlyBudgetMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      rumApplicationId: RUM_APPLICATION_ID,
      bytes: baseGateInput.payloadBytes,
      budgetBytes: 2 * 1024 * 1024 * 1024,
    });
  });

  test("an exhausted monthly budget stops the recorder with its own reason", async () => {
    getPolicyMock.mockResolvedValue(
      buildPolicy({ monthlyBudgetInGB: 1 }) as never,
    );
    consumeApplicationMonthlyBudgetMock.mockResolvedValue({
      outcome: SessionReplayLimitOutcome.BudgetExhausted,
    } as never);

    const decision: SessionReplayGateDecision =
      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

    expect(decision.outcome).toBe(SessionReplayGateOutcome.Stop);
    expect(decision.directive).toBe("stop");
    /*
     * A distinct reason from the instance-wide "budget-exhausted": the
     * customer's remediation differs (raise your own budget vs contact the
     * operator), so the two must be tellable apart in the response and on
     * the refusal metric.
     */
    expect(decision.reason).toBe("app-monthly-budget-exhausted");
  });

  test("an unreachable monthly budget counter fails closed as retryable", async () => {
    getPolicyMock.mockResolvedValue(
      buildPolicy({ monthlyBudgetInGB: 1 }) as never,
    );
    consumeApplicationMonthlyBudgetMock.mockResolvedValue({
      outcome: SessionReplayLimitOutcome.CounterUnavailable,
    } as never);

    const decision: SessionReplayGateDecision =
      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

    expect(decision.outcome).toBe(SessionReplayGateOutcome.StorageUnavailable);
    expect(decision.reason).toBe("budget-counter-unavailable");
  });
  /*
   * Audit finding ingest-9: the wire reason keeps the closed vocabulary the
   * recorder and the health surface know, and the decision carries WHICH
   * switch was off for the metrics label.
   */
  test("a null policy names which switch is off", async () => {
    resolvePolicyMock.mockResolvedValueOnce({
      policy: null,
      refusal: "project-not-allowed",
    } as never);

    const decision: SessionReplayGateDecision =
      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

    expect(decision.reason).toBe("not-enabled");
    expect(decision.policyRefusal).toBe("project-not-allowed");
  });

  describe("refusal counters", () => {
    test("every non-accepted decision is counted exactly once, under the application", async () => {
      isOriginAllowedMock.mockReturnValue(false);

      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

      expect(recordRefusalMock).toHaveBeenCalledTimes(1);
      expect(recordRefusalMock).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        appIdentifier: APP_IDENTIFIER,
        reason: "origin-not-allowed",
      });
    });

    test("a clean accept is not a refusal", async () => {
      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

      expect(recordRefusalMock).not.toHaveBeenCalled();
    });

    test("deployment-level and policy refusals are counted too", async () => {
      getPolicyMock.mockResolvedValue(null as never);

      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

      expect(recordRefusalMock).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "not-enabled" }),
      );

      recordRefusalMock.mockClear();
      getPolicyMock.mockResolvedValue(buildPolicy() as never);
      consumeChunkAllowanceMock.mockResolvedValue({
        outcome: SessionReplayLimitOutcome.RateLimited,
        retryAfterSeconds: 7,
      } as never);

      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

      expect(recordRefusalMock).toHaveBeenCalledTimes(1);
      expect(recordRefusalMock).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "rate-limited" }),
      );
    });
  });

  /*
   * Audit finding ingest-5. A request whose every frame asserts consent
   * Unknown against a RequireExplicit policy used to be accepted (202) and
   * dropped in the worker, where the recorder could never learn it.
   */
  describe("consent at the gate", () => {
    test("is refused with a reason, and WITHOUT a stop", async () => {
      getPolicyMock.mockResolvedValue(
        buildPolicy({
          consentMode: SessionReplayConsentMode.RequireExplicit,
        }) as never,
      );

      const decision: SessionReplayGateDecision =
        await SessionReplayIngestService.gateChunkRequest({
          ...baseGateInput,
          consentStates: ["Unknown", "Unknown"],
        });

      expect(decision.outcome).toBe(SessionReplayGateOutcome.Refused);
      expect(decision.directive).toBe("continue");
      expect(decision.reason).toBe("consent-required");
      /* Refused before any counter is charged. */
      expect(consumeChunkAllowanceMock).not.toHaveBeenCalled();
      expect(recordRefusalMock).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "consent-required" }),
      );
    });

    test("a mixed batch passes the gate; the worker drops the Unknown frames", async () => {
      getPolicyMock.mockResolvedValue(
        buildPolicy({
          consentMode: SessionReplayConsentMode.RequireExplicit,
        }) as never,
      );

      const decision: SessionReplayGateDecision =
        await SessionReplayIngestService.gateChunkRequest({
          ...baseGateInput,
          consentStates: ["Unknown", "Granted"],
        });

      expect(decision.outcome).toBe(SessionReplayGateOutcome.Accepted);
    });

    test("Unknown consent is fine when the policy does not require it", async () => {
      const decision: SessionReplayGateDecision =
        await SessionReplayIngestService.gateChunkRequest({
          ...baseGateInput,
          consentStates: ["Unknown"],
        });

      expect(decision.outcome).toBe(SessionReplayGateOutcome.Accepted);
    });
  });

  /*
   * Audit finding ingest-4: a catch-up post straddling the per-session cap
   * keeps the frames under it and tells the recorder to stand down.
   */
  test("frames set aside for the cap turn an accept into a 202-with-stop, counted as a refusal", async () => {
    const decision: SessionReplayGateDecision =
      await SessionReplayIngestService.gateChunkRequest({
        ...baseGateInput,
        maxChunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1,
        chunkCount: 2,
        overCapChunkCount: 1,
      });

    expect(decision.outcome).toBe(SessionReplayGateOutcome.Accepted);
    expect(decision.directive).toBe("stop");
    expect(decision.reason).toBe("session-chunk-cap");
    expect(recordRefusalMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "session-chunk-cap" }),
    );
  });

  /*
   * Audit finding ingest-7: the daily counter was charged before the
   * monthly ceiling said no, and kept growing after its own exhaustion.
   */
  describe("daily byte counter refunds", () => {
    test("a monthly refusal gives the daily bytes back", async () => {
      getPolicyMock.mockResolvedValue(
        buildPolicy({ monthlyBudgetInGB: 1 }) as never,
      );
      consumeApplicationMonthlyBudgetMock.mockResolvedValue({
        outcome: SessionReplayLimitOutcome.BudgetExhausted,
      } as never);

      const decision: SessionReplayGateDecision =
        await SessionReplayIngestService.gateChunkRequest(baseGateInput);

      expect(decision.reason).toBe("app-monthly-budget-exhausted");
      expect(decrbyMock).toHaveBeenCalledWith(
        SessionReplayUsage.getDailyProjectByteKey(PROJECT_ID),
        baseGateInput.payloadBytes,
      );
    });

    test("an exhausted daily counter stops growing on later refusals", async () => {
      consumeByteBudgetMock.mockResolvedValue({
        outcome: SessionReplayLimitOutcome.BudgetExhausted,
      } as never);

      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

      expect(decrbyMock).toHaveBeenCalledWith(
        SessionReplayUsage.getDailyProjectByteKey(PROJECT_ID),
        baseGateInput.payloadBytes,
      );
    });

    test("an accepted request is never refunded", async () => {
      await SessionReplayIngestService.gateChunkRequest(baseGateInput);

      expect(decrbyMock).not.toHaveBeenCalled();
    });
  });

  /*
   * Audit finding workers-lifecycle-7: the finalizer cannot see a byte
   * budget in chunk rows, so the gate leaves it a hint per session.
   */
  test("a budget refusal leaves a seal hint the finalizer can read", async () => {
    consumeByteBudgetMock.mockResolvedValue({
      outcome: SessionReplayLimitOutcome.BudgetExhausted,
    } as never);

    await SessionReplayIngestService.gateChunkRequest({
      ...baseGateInput,
      sessionIds: ["a".repeat(32), "c".repeat(32)],
    });

    expect(
      redisStrings.get(
        `replay:seal:${PROJECT_ID.toString()}:${"a".repeat(32)}`,
      ),
    ).toBe("budget");
    expect(
      redisStrings.get(
        `replay:seal:${PROJECT_ID.toString()}:${"c".repeat(32)}`,
      ),
    ).toBe("budget");
  });

  test("a sampling refusal leaves no seal hint", async () => {
    getPolicyMock.mockResolvedValue(
      buildPolicy({ samplePercentage: 0 }) as never,
    );

    await SessionReplayIngestService.gateChunkRequest({
      ...baseGateInput,
      triggerReasons: [SessionReplayTriggerReason.Sampled],
    });

    expect(redisStrings.size).toBe(0);
  });
});

describe("SessionReplayIngestService.processFromQueue", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisStrings.clear();
    redisConnected = true;
    recordRefusalMock.mockResolvedValue(undefined as never);
    recordDropMock.mockResolvedValue(undefined as never);
    markChunkReceivedMock.mockResolvedValue(undefined as never);
    getPolicyMock.mockResolvedValue(buildPolicy() as never);
    loadRulesMock.mockResolvedValue([] as never);
    scrubEventsMock.mockResolvedValue({
      isComplete: true,
      nodesVisited: 3,
      stringsScrubbed: 0,
      skippedOversizedStrings: 0,
      skippedStructuralStrings: 0,
      truncatedAtDepth: false,
    } as never);
    submitMock.mockResolvedValue({ flushed: Promise.resolve() } as never);
    (isSessionErased as jest.Mock).mockResolvedValue(false as never);
  });

  /*
   * REGRESSION: github.com/OneUptime/oneuptime/issues/3527.
   *
   * Recorders up to 12.0.x cut an oversized FullSnapshot into raw slices of
   * the array text and posted each slice as its own chunk index, tagged
   * snapshotPart {index, total}. Nothing here ever concatenated them, so every
   * slice fell through decodePayload's JSON.parse and was dropped as
   * "payload-undecodable" - a label that described the parse and hid the
   * cause. The recorder no longer produces fragments at all (Chunker
   * .emitOversizedEvent); these tests pin what happens to the ones still in
   * flight from a cached bundle.
   */
  describe("legacy split-snapshot fragments", () => {
    test("refuses a fragment rather than storing an unparseable slice", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([{ chunkIndex: 3, snapshotPart: { index: 0, total: 2 } }]),
        ),
      );

      expect(getSubmittedRows("RumSessionChunkV1")).toHaveLength(0);
    });

    /*
     * Only a MULTI-part tag means a fragment. total 1 is a whole event that a
     * recorder happened to label, and refusing it would throw away a chunk
     * that decodes perfectly well.
     */
    test("accepts a single-part chunk, which is not a fragment", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([{ chunkIndex: 0, snapshotPart: { index: 0, total: 1 } }]),
        ),
      );

      expect(getSubmittedRows("RumSessionChunkV1")).toHaveLength(1);
    });

    test("refuses the fragment WITHOUT losing the whole chunks beside it", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([
            { chunkIndex: 0 },
            { chunkIndex: 1, snapshotPart: { index: 0, total: 2 } },
            { chunkIndex: 2, snapshotPart: { index: 1, total: 2 } },
            { chunkIndex: 3 },
          ]),
        ),
      );

      const rows: Array<JSONObject> = getSubmittedRows("RumSessionChunkV1");

      expect(
        rows.map((row: JSONObject): unknown => {
          return row["chunkIndex"];
        }),
      ).toEqual([0, 3]);
    });
  });

  describe("erasure tombstone", () => {
    /*
     * A chunk can be staged in Redis, or sitting in the queue, at the moment
     * an erasure request completes. Without a check here the worker writes it
     * afterwards and the erased session partially reappears - a failed
     * right-to-erasure obligation that nothing else would ever notice.
     */
    test("drops a chunk whose session has been erased, and writes nothing", async () => {
      (isSessionErased as jest.Mock).mockResolvedValue(true as never);

      await SessionReplayIngestService.processFromQueue(
        buildJobData(buildBody([{ chunkIndex: 0 }])),
      );

      expect(getSubmittedRows("RumSessionChunkV1")).toHaveLength(0);
      expect(getSubmittedRows("RumSessionV1")).toHaveLength(0);
    });

    test("checks the tombstone BEFORE decoding, so an erased session costs no gunzip", async () => {
      (isSessionErased as jest.Mock).mockResolvedValue(true as never);

      await SessionReplayIngestService.processFromQueue(
        buildJobData(buildBody([{ chunkIndex: 0 }])),
      );

      /*
       * The scrub service sits downstream of the decode. If it was never
       * called, neither was the decompression it follows.
       */
      expect(scrubEventsMock).not.toHaveBeenCalled();
    });

    test("propagates an unavailable tombstone so the job retries instead of writing", async () => {
      /*
       * Fail CLOSED. If we cannot prove a session was not erased, writing it
       * is the unrecoverable direction; throwing costs only latency once
       * Redis is back.
       */
      (isSessionErased as jest.Mock).mockRejectedValue(
        new ErasureTombstoneUnavailableError("redis down") as never,
      );

      await expect(
        SessionReplayIngestService.processFromQueue(
          buildJobData(buildBody([{ chunkIndex: 0 }])),
        ),
      ).rejects.toThrow(ErasureTombstoneUnavailableError);

      expect(getSubmittedRows("RumSessionChunkV1")).toHaveLength(0);
    });

    test("looks the tombstone up once per session, not once per frame", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([{ chunkIndex: 0 }, { chunkIndex: 1 }, { chunkIndex: 2 }]),
        ),
      );

      expect(isSessionErased).toHaveBeenCalledTimes(1);
    });
  });

  test("writes one chunk row and a provisional header for chunk 0", async () => {
    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 0 }])),
    );

    const chunkRows: Array<JSONObject> = getSubmittedRows("RumSessionChunkV1");
    const headerRows: Array<JSONObject> = getSubmittedRows("RumSessionV1");

    expect(chunkRows).toHaveLength(1);
    expect(headerRows).toHaveLength(1);

    const chunk: JSONObject = chunkRows[0]!;

    expect(chunk["sessionId"]).toBe("a".repeat(32));
    expect(chunk["tabId"]).toBe("b".repeat(16));
    expect(chunk["chunkIndex"]).toBe(0);
    expect(chunk["rumApplicationId"]).toBe(RUM_APPLICATION_ID.toString());
    expect(chunk["primaryEntityId"]).toBe(RUM_APPLICATION_ID.toString());
    expect(chunk["primaryEntityType"]).toBe("RealUserMonitor");
    /* Per-chunk counters come off the envelope, never from the payload. */
    expect(chunk["errorCount"]).toBe(2);
    expect(chunk["routeCount"]).toBe(3);
  });

  /*
   * Wave 4's new trigger label must survive the parser's closed-set
   * normalisation, and anything outside the set must still fall back to
   * "sampled" rather than storing attacker-chosen strings.
   */
  test("the performance trigger reason round-trips; unknown reasons normalise to sampled", async () => {
    await SessionReplayIngestService.processFromQueue(
      buildJobData(
        buildBody([
          {
            chunkIndex: 0,
            triggerReason: SessionReplayTriggerReason.Performance,
          },
        ]),
      ),
    );

    expect(getSubmittedRows("RumSessionV1")[0]?.["triggerReason"]).toBe(
      "performance",
    );

    submitMock.mockClear();

    await SessionReplayIngestService.processFromQueue(
      buildJobData(
        buildBody([
          {
            chunkIndex: 0,
            triggerReason: "totally-made-up" as SessionReplayTriggerReason,
          },
        ]),
      ),
    );

    expect(getSubmittedRows("RumSessionV1")[0]?.["triggerReason"]).toBe(
      "sampled",
    );
  });

  test("no header row is written for a non-zero chunk index that carries nothing new", async () => {
    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 4 }])),
    );

    expect(getSubmittedRows("RumSessionChunkV1")).toHaveLength(1);
    expect(getSubmittedRows("RumSessionV1")).toHaveLength(0);
  });

  /*
   * Tags set after chunk 0, traits from a late identify(), and the terminal
   * chunk's "recording ended" all reach the header through a NEWER header
   * version; the finalizer reads the newest, so this is how "tags from the
   * highest-version meta" works.
   */
  test("a later chunk whose meta carries tags, traits or the terminal flag writes a header version", async () => {
    await SessionReplayIngestService.processFromQueue(
      buildJobData(
        buildBody([
          {
            chunkIndex: 7,
            meta: {
              ...buildEnvelope().meta!,
              tags: { experiment: "b" },
            },
          },
        ]),
      ),
    );

    expect(getSubmittedRows("RumSessionV1")).toHaveLength(1);
    expect(getSubmittedRows("RumSessionV1")[0]!["tags"]).toEqual({
      experiment: "b",
    });

    submitMock.mockClear();

    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 9, isFinal: true }])),
    );

    const finalHeader: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

    expect(finalHeader["sealedReason"]).toBe("final-chunk");
    expect(finalHeader["isFinalized"]).toBe(false);
  });

  test("the header carries no accumulated aggregates - the finalizer owns those", async () => {
    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 0 }])),
    );

    const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

    expect(header["isFinalized"]).toBe(false);
    expect(header["chunkCount"]).toBe(0);
    expect(header["maxChunkIndex"]).toBe(0);
    expect(header["eventCount"]).toBe("0");
    expect(header["payloadBytes"]).toBe("0");
    expect(header["fullSnapshotChunkIndexes"]).toEqual([]);
  });

  test("version is unix millis, which stays inside Number.MAX_SAFE_INTEGER", async () => {
    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 0 }])),
    );

    const version: number = Number(
      getSubmittedRows("RumSessionChunkV1")[0]!["version"],
    );

    expect(Number.isSafeInteger(version)).toBe(true);
    /* Nanos would be ~1.75e18 and would silently lose precision. */
    expect(version).toBeLessThan(1e15);
  });

  test("clamps a client clock set in the future and records the skew", async () => {
    const serverReceiveUnixMs: number = 1_800_000_020_000;

    /* Device clock a year ahead. */
    const clientStart: number = serverReceiveUnixMs + 365 * 24 * 3600 * 1000;

    await SessionReplayIngestService.processFromQueue(
      buildJobData(
        buildBody([
          {
            chunkIndex: 0,
            sessionStartUnixMs: clientStart,
            clientSendUnixMs: clientStart + 15_000,
          },
        ]),
        { serverReceiveUnixMs },
      ),
    );

    const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

    const startTime: string = String(header["startTime"]);
    const clientReported: string = String(header["clientReportedStartTime"]);

    /*
     * Unclamped, the future timestamp would land in the partition key and
     * the TTL expression, creating a partition that never expires.
     */
    expect(startTime).toBe(
      OneUptimeDate.toClickhouseDateTime64(new Date(serverReceiveUnixMs)),
    );
    expect(clientReported).not.toBe(startTime);
    /* Skew is recorded rather than silently swallowed. */
    expect(Number(header["clockSkewMs"])).toBeGreaterThan(0);
  });

  test("retentionDate is derived from the clamped session start, not the ingest date", async () => {
    /*
     * A chunk from a session that began two hours ago and is only being
     * flushed now. Deriving retention from the ingest date would give it a
     * full 7 days from arrival, so this session's chunks would expire on
     * different days from each other and from the header - TTL-dropping
     * mid-session and leaving an unplayable fragment.
     *
     * Two hours rather than two days because clampSessionStart's backward
     * window is the 4-hour max session length; anything older is pulled
     * forward to that boundary, which is a separate behaviour.
     */
    const serverReceiveUnixMs: number = 1_800_000_020_000;
    const sessionStartUnixMs: number = serverReceiveUnixMs - 2 * 3600 * 1000;

    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 0, sessionStartUnixMs }]), {
        serverReceiveUnixMs,
      }),
    );

    const chunk: JSONObject = getSubmittedRows("RumSessionChunkV1")[0]!;
    const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

    const expected: string = OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(new Date(sessionStartUnixMs), 7),
    );

    expect(chunk["retentionDate"]).toBe(expected);
    /*
     * Header and chunk MUST match: reads silently get
     * `AND retentionDate >= now()` appended, so a mismatch produces a
     * listable-but-unplayable or playable-but-invisible session.
     */
    expect(header["retentionDate"]).toBe(expected);
    /* Explicitly NOT seven days from arrival. */
    expect(chunk["retentionDate"]).not.toBe(
      OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDays(new Date(serverReceiveUnixMs), 7),
      ),
    );
  });

  test("a session start older than the clamp window is pulled to the window edge", async () => {
    /*
     * The clamp is what stops a device clock set to 2015 from producing a
     * row that is deleted on arrival. Two days back is well outside the
     * 4-hour backward window, so the start - and therefore the retention
     * date - lands on the boundary rather than on the client's claim.
     */
    const serverReceiveUnixMs: number = 1_800_000_020_000;
    const fourHoursMs: number = 4 * 3600 * 1000;

    await SessionReplayIngestService.processFromQueue(
      buildJobData(
        buildBody([
          {
            chunkIndex: 0,
            sessionStartUnixMs: serverReceiveUnixMs - 2 * 24 * 3600 * 1000,
          },
        ]),
        { serverReceiveUnixMs },
      ),
    );

    const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

    expect(header["startTime"]).toBe(
      OneUptimeDate.toClickhouseDateTime64(
        new Date(serverReceiveUnixMs - fourHoursMs),
      ),
    );
  });

  test("payloadBytes stores the wire size, and the payload is stored decompressed", async () => {
    const events: Array<unknown> = [{ type: 2, timestamp: 1, data: {} }];

    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 0 }], events)),
    );

    const chunk: JSONObject = getSubmittedRows("RumSessionChunkV1")[0]!;

    expect(chunk["payload"]).toBe(JSON.stringify(events));

    /*
     * "identity", even though the frame arrived gzipped: the column describes
     * the bytes in the column, and those were gunzipped, scrubbed and
     * re-serialised on the way in. It used to be copied straight off the
     * envelope, so almost every stored row claimed an encoding it did not
     * have.
     */
    expect(chunk["payloadEncoding"]).toBe("identity");

    const wireBytes: number = zlib.gzipSync(
      new Uint8Array(Buffer.from(JSON.stringify(events))),
    ).length;

    expect(chunk["payloadBytes"]).toBe(String(wireBytes));
  });

  test("FAILS CLOSED: a policy that resolves to null drops without writing", async () => {
    getPolicyMock.mockResolvedValue(null as never);

    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 0 }])),
    );

    expect(submitMock).not.toHaveBeenCalled();
    expect(loadRulesMock).not.toHaveBeenCalled();
  });

  test("FAILS CLOSED: a policy lookup error throws so the job retries", async () => {
    getPolicyMock.mockRejectedValue(new Error("postgres down") as never);

    await expect(
      SessionReplayIngestService.processFromQueue(
        buildJobData(buildBody([{ chunkIndex: 0 }])),
      ),
    ).rejects.toThrow("postgres down");

    expect(submitMock).not.toHaveBeenCalled();
  });

  test("FAILS CLOSED: a scrub-rule load failure never falls back to empty rules", async () => {
    loadRulesMock.mockRejectedValue(
      new Error("scrub rules unavailable") as never,
    );

    await expect(
      SessionReplayIngestService.processFromQueue(
        buildJobData(buildBody([{ chunkIndex: 0 }])),
      ),
    ).rejects.toThrow("scrub rules unavailable");

    /* The log and trace scrubbers would have continued here. Replay does not. */
    expect(submitMock).not.toHaveBeenCalled();
  });

  test("FAILS CLOSED: an incomplete scrub drops the chunk", async () => {
    scrubEventsMock.mockResolvedValue({
      isComplete: false,
      nodesVisited: 250_001,
      stringsScrubbed: 0,
      skippedOversizedStrings: 0,
      truncatedAtDepth: true,
    } as never);

    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 0 }])),
    );

    expect(submitMock).not.toHaveBeenCalled();
  });

  test("FAILS CLOSED: an Unknown consent state is dropped when consent is required", async () => {
    getPolicyMock.mockResolvedValue(
      buildPolicy({
        consentMode: SessionReplayConsentMode.RequireExplicit,
      }) as never,
    );

    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 0, consentState: "Unknown" }])),
    );

    expect(submitMock).not.toHaveBeenCalled();
  });

  test("an Unknown consent state is accepted when the app does not require consent", async () => {
    getPolicyMock.mockResolvedValue(
      buildPolicy({
        consentMode: SessionReplayConsentMode.NotRequired,
      }) as never,
    );

    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 0, consentState: "Unknown" }])),
    );

    expect(getSubmittedRows("RumSessionChunkV1")).toHaveLength(1);
  });

  test("reads an out-of-band staged body through the replay chunk store", async () => {
    const body: Buffer = buildBody([{ chunkIndex: 2 }]);

    readBodyMock.mockResolvedValue(body as never);

    const jobData: SessionReplayIngestJobData = buildJobData(body);
    delete jobData.inlineBodyBase64;

    await SessionReplayIngestService.processFromQueue(
      jobData,
      "replay:chunk:abc",
    );

    expect(readBodyMock).toHaveBeenCalledWith("replay:chunk:abc");
    expect(getSubmittedRows("RumSessionChunkV1")).toHaveLength(1);
  });

  test("a staged body that has expired drops rather than failing forever", async () => {
    readBodyMock.mockResolvedValue(null as never);

    const jobData: SessionReplayIngestJobData = buildJobData(
      buildBody([{ chunkIndex: 2 }]),
    );
    delete jobData.inlineBodyBase64;

    await SessionReplayIngestService.processFromQueue(
      jobData,
      "replay:chunk:gone",
    );

    expect(submitMock).not.toHaveBeenCalled();
  });

  test("a job carrying neither an inline body nor a bodyKey is a producer bug and throws", async () => {
    const jobData: SessionReplayIngestJobData = buildJobData(
      buildBody([{ chunkIndex: 0 }]),
    );
    delete jobData.inlineBodyBase64;

    await expect(
      SessionReplayIngestService.processFromQueue(jobData),
    ).rejects.toThrow(/inline body nor a bodyKey/);
  });

  test("writes every frame of a multi-frame catch-up request", async () => {
    await SessionReplayIngestService.processFromQueue(
      buildJobData(
        buildBody([{ chunkIndex: 0 }, { chunkIndex: 1 }, { chunkIndex: 2 }]),
      ),
    );

    expect(getSubmittedRows("RumSessionChunkV1")).toHaveLength(3);
    /* Still exactly one header: only chunk 0 mints one. */
    expect(getSubmittedRows("RumSessionV1")).toHaveLength(1);
  });

  test("country is stored only when the application enabled geo capture", async () => {
    getPolicyMock.mockResolvedValue(
      buildPolicy({ captureGeo: false }) as never,
    );

    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 0 }])),
    );

    expect(getSubmittedRows("RumSessionV1")[0]!["countryCode"]).toBe("");
  });

  /*
   * End-user identity.
   *
   * The recorder has always put meta.identifiedUserRef on the wire when the
   * application had identity capture on, and the envelope parser has always
   * accepted it - but the ingest wrote both columns as "" unconditionally,
   * so the session list said "Anonymous" for every recording, the User key
   * filter could never match anything, and a ByIdentifiedUserKey erasure
   * request resolved zero sessions while the settings page said "Captures
   * end-user identity: Yes".
   */
  describe("end-user identity on the session header", () => {
    const USER_REF: string = "user-42@acme.test";

    function metaWithUserRef(userRef: string): SessionReplayChunkMeta {
      return {
        entryUrl: "https://shop.example.com/",
        browserName: "Chrome",
        browserVersion: "141",
        osName: "macOS",
        deviceType: "desktop",
        viewportWidth: 1440,
        viewportHeight: 900,
        identifiedUserRef: userRef,
      };
    }

    test("stores an HMAC key and the raw label when capture is on", async () => {
      getPolicyMock.mockResolvedValue(
        buildPolicy({ captureUserIdentity: true }) as never,
      );

      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([{ chunkIndex: 0, meta: metaWithUserRef(USER_REF) }]),
        ),
      );

      const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

      /* SHA-256 hex: the column has to be a fixed-width opaque token. */
      expect(header["identifiedUserKey"]).toMatch(/^[0-9a-f]{64}$/);
      expect(header["identifiedUserLabel"]).toBe(USER_REF);

      /* The key must not be the reference in disguise. */
      expect(header["identifiedUserKey"]).not.toContain("acme");
    });

    /*
     * The ACL-critical assertion. The recorder is supposed to withhold the
     * reference entirely when capture is off, but the recorder's copy of the
     * policy can be a config-cache TTL stale and a hand-crafted POST is not
     * bound by it at all - so the server must refuse it too.
     */
    test("stores nothing when the application has capture switched off", async () => {
      getPolicyMock.mockResolvedValue(
        buildPolicy({ captureUserIdentity: false }) as never,
      );

      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([{ chunkIndex: 0, meta: metaWithUserRef(USER_REF) }]),
        ),
      );

      const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

      expect(header["identifiedUserKey"]).toBe("");
      expect(header["identifiedUserLabel"]).toBe("");
      expect(JSON.stringify(header)).not.toContain("acme.test");
    });

    test("a page that supplies no reference stays anonymous", async () => {
      getPolicyMock.mockResolvedValue(
        buildPolicy({ captureUserIdentity: true }) as never,
      );

      await SessionReplayIngestService.processFromQueue(
        buildJobData(buildBody([{ chunkIndex: 0 }])),
      );

      const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

      expect(header["identifiedUserKey"]).toBe("");
      expect(header["identifiedUserLabel"]).toBe("");
    });

    /*
     * Determinism is what makes erasure work: a request naming a person has
     * to resolve to the same digest their sessions were filed under, months
     * later and from a different process.
     */
    test("the same reference in the same project yields the same key", async () => {
      getPolicyMock.mockResolvedValue(
        buildPolicy({ captureUserIdentity: true }) as never,
      );

      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([{ chunkIndex: 0, meta: metaWithUserRef(USER_REF) }]),
        ),
      );

      const first: string = getSubmittedRows("RumSessionV1")[0]![
        "identifiedUserKey"
      ] as string;

      submitMock.mockClear();

      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([
            {
              chunkIndex: 0,
              sessionId: "c".repeat(32),
              meta: metaWithUserRef(USER_REF),
            },
          ]),
        ),
      );

      const second: string = getSubmittedRows("RumSessionV1")[0]![
        "identifiedUserKey"
      ] as string;

      expect(second).toBe(first);
    });

    /*
     * Scoped by project, so one customer's digest can never be used to probe
     * another's - and so a project-wide erasure reaches every application in
     * that project, which is exactly what ProcessSessionErasureRequests
     * filters on.
     */
    test("the same reference in a different project yields a different key", async () => {
      getPolicyMock.mockResolvedValue(
        buildPolicy({ captureUserIdentity: true }) as never,
      );

      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([{ chunkIndex: 0, meta: metaWithUserRef(USER_REF) }]),
        ),
      );

      const first: string = getSubmittedRows("RumSessionV1")[0]![
        "identifiedUserKey"
      ] as string;

      const otherProjectId: ObjectID = ObjectID.generate();

      getPolicyMock.mockResolvedValue(
        buildPolicy({
          captureUserIdentity: true,
          projectId: otherProjectId,
        }) as never,
      );

      submitMock.mockClear();

      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([{ chunkIndex: 0, meta: metaWithUserRef(USER_REF) }]),
          { projectId: otherProjectId.toString() },
        ),
      );

      const second: string = getSubmittedRows("RumSessionV1")[0]![
        "identifiedUserKey"
      ] as string;

      expect(second).not.toBe(first);
      expect(second).toMatch(/^[0-9a-f]{64}$/);
    });

    /*
     * The server's cap has to be the SAME cap the recorder slices to.
     *
     * The recorder sends userRef.slice(0, SESSION_REPLAY_MAX_USER_REF_LENGTH)
     * and the targeting handshake hashes it at that length. The envelope
     * parser used to fold it into the 128-byte cap it shares with
     * browserName and osName, so any reference longer than 128 characters -
     * a namespaced customer id, a signed token, a long email - was hashed
     * from a DIFFERENT string than the one a dashboard lookup or an erasure
     * request would hash. Nothing errored; the recordings were simply filed
     * under a key no one could ever resolve.
     */
    test("a long reference is stored whole, not folded into the device-string cap", async () => {
      getPolicyMock.mockResolvedValue(
        buildPolicy({ captureUserIdentity: true }) as never,
      );

      /* Comfortably past the 128-byte meta cap, inside the 512 user-ref cap. */
      const longRef: string = `acme-tenant-${"z".repeat(200)}@customers.example.com`;

      expect(longRef.length).toBeGreaterThan(128);
      expect(longRef.length).toBeLessThanOrEqual(
        SESSION_REPLAY_MAX_USER_REF_LENGTH,
      );

      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([{ chunkIndex: 0, meta: metaWithUserRef(longRef) }]),
        ),
      );

      const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

      expect(header["identifiedUserLabel"]).toBe(longRef);
      expect(header["identifiedUserKey"]).toBe(
        SessionReplayIdentity.buildUserKey({
          projectId: PROJECT_ID,
          userRef: longRef,
        }),
      );
    });

    /*
     * Past the shared cap both sides slice to, the server sees exactly what
     * a recorder would have sent - the 512-character prefix - so the key is
     * the same either way. What must NOT happen is the two sides disagreeing
     * about where to cut.
     */
    test("a reference past the shared cap hashes the same prefix the recorder would send", async () => {
      getPolicyMock.mockResolvedValue(
        buildPolicy({ captureUserIdentity: true }) as never,
      );

      const overLong: string = "z".repeat(
        SESSION_REPLAY_MAX_USER_REF_LENGTH + 200,
      );

      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([{ chunkIndex: 0, meta: metaWithUserRef(overLong) }]),
        ),
      );

      const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

      expect((header["identifiedUserLabel"] as string).length).toBe(
        SESSION_REPLAY_MAX_USER_REF_LENGTH,
      );
      expect(header["identifiedUserKey"]).toBe(
        SessionReplayIdentity.buildUserKey({
          projectId: PROJECT_ID,
          userRef: overLong.slice(0, SESSION_REPLAY_MAX_USER_REF_LENGTH),
        }),
      );
    });
  });

  /*
   * The provisional header's signal counters.
   *
   * They used to be hardcoded to 0 while `hasError` in the same object
   * literal was derived from envelope.signals.errorCount - so for the 10-15
   * minutes before the finalizer runs, the "With errors" tab returned rows
   * whose Signals cell read "Clean", and the "With frustration" tab excluded
   * the very session that was captured BECAUSE of a rage click. Both tabs
   * are read during an incident, which is exactly that window.
   */
  describe("provisional signal counters", () => {
    test("chunk 0's signals seed the header instead of being zeroed", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([
            {
              chunkIndex: 0,
              signals: {
                errorCount: 2,
                rageClickCount: 1,
                deadClickCount: 3,
                errorClickCount: 1,
                refreshRageCount: 0,
                routeCount: 4,
              },
            },
          ]),
        ),
      );

      const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

      expect(header["errorCount"]).toBe(2);
      expect(header["rageClickCount"]).toBe(1);
      expect(header["deadClickCount"]).toBe(3);
      expect(header["errorClickCount"]).toBe(1);
      expect(header["pageCount"]).toBe(4);
    });

    /*
     * The invariant that made the list self-contradictory: hasError said
     * "yes" while the counter it is derived from said zero.
     */
    test("hasError and errorCount can no longer disagree", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([
            {
              chunkIndex: 0,
              signals: {
                errorCount: 1,
                rageClickCount: 0,
                deadClickCount: 0,
                errorClickCount: 0,
                refreshRageCount: 0,
                routeCount: 0,
              },
            },
          ]),
        ),
      );

      const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

      expect(header["hasError"]).toBe(true);
      expect(header["errorCount"]).toBeGreaterThan(0);
    });

    test("a clean chunk 0 still reports zeroes", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([
            {
              chunkIndex: 0,
              signals: {
                errorCount: 0,
                rageClickCount: 0,
                deadClickCount: 0,
                errorClickCount: 0,
                refreshRageCount: 0,
                routeCount: 0,
              },
            },
          ]),
        ),
      );

      const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

      expect(header["hasError"]).toBe(false);
      expect(header["errorCount"]).toBe(0);
      expect(header["rageClickCount"]).toBe(0);
    });
  });

  /*
   * WHERE the user went, per chunk.
   *
   * The chunk table used to carry routeCount but not the routes themselves,
   * so the session header's exitUrl / routes[] could only ever be whatever
   * chunk 0 knew - the landing page, for the life of a single-page app. The
   * finalizer now derives all three from these columns.
   */
  describe("per-chunk url and routes", () => {
    test("every chunk records the url it was flushed from", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([
            { chunkIndex: 0, url: "https://shop.example.com/" },
            { chunkIndex: 1, url: "https://shop.example.com/cart" },
            { chunkIndex: 2, url: "https://shop.example.com/checkout" },
          ]),
        ),
      );

      const chunks: Array<JSONObject> = getSubmittedRows("RumSessionChunkV1");

      expect(
        chunks.map((c: JSONObject): unknown => {
          return c["url"];
        }),
      ).toEqual([
        "https://shop.example.com/",
        "https://shop.example.com/cart",
        "https://shop.example.com/checkout",
      ]);
    });

    test("the envelope's route list is stored, in order, with the flush url appended", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([
            {
              chunkIndex: 0,
              url: "https://shop.example.com/checkout",
              routes: [
                "https://shop.example.com/",
                "https://shop.example.com/cart",
              ],
            },
          ]),
        ),
      );

      const chunk: JSONObject = getSubmittedRows("RumSessionChunkV1")[0]!;

      expect(chunk["routes"]).toEqual([
        "https://shop.example.com/",
        "https://shop.example.com/cart",
        "https://shop.example.com/checkout",
      ]);
    });

    /*
     * An older recorder posting to a newer server sends no routes at all.
     * It must still contribute its page to the session's route list rather
     * than contributing nothing.
     */
    test("a recorder that sends no route list still contributes its own url", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([
            { chunkIndex: 0, url: "https://shop.example.com/legacy" },
          ]),
        ),
      );

      const chunk: JSONObject = getSubmittedRows("RumSessionChunkV1")[0]!;

      expect(chunk["routes"]).toEqual(["https://shop.example.com/legacy"]);
    });

    test("a route repeated across the chunk is stored once", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([
            {
              chunkIndex: 0,
              url: "https://shop.example.com/cart",
              routes: [
                "https://shop.example.com/cart",
                "https://shop.example.com/",
                "https://shop.example.com/cart",
              ],
            },
          ]),
        ),
      );

      const chunk: JSONObject = getSubmittedRows("RumSessionChunkV1")[0]!;

      expect(chunk["routes"]).toEqual([
        "https://shop.example.com/cart",
        "https://shop.example.com/",
      ]);
    });

    /*
     * The columns render under the WIDER session-metadata ACL, so an
     * unscrubbed reset token here reaches more readers than the payload
     * does. Client-side scrubbing is not a control the server may assume.
     */
    test("routes are re-scrubbed server side, not trusted from the wire", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([
            {
              chunkIndex: 0,
              url: "https://shop.example.com/account?session=s3cr3t-a",
              routes: [
                "https://shop.example.com/reset-password?token=s3cr3t-b",
                "https://shop.example.com/users/550e8400-e29b-41d4-a716-446655440000",
              ],
            },
          ]),
        ),
      );

      const chunk: JSONObject = getSubmittedRows("RumSessionChunkV1")[0]!;
      const stored: string = JSON.stringify([chunk["url"], chunk["routes"]]);

      expect(stored).not.toContain("s3cr3t");
      expect(stored).not.toContain("token");
      expect(stored).not.toContain("550e8400");
      expect(chunk["url"]).toBe("https://shop.example.com/account");
    });
  });

  /*
   * URL scrubbing is applied in the browser, but the server may not ASSUME
   * it happened: a stale bundle, a self-hosted recorder or a hand-crafted
   * POST with a scraped ingestion key all put whatever URL they like on the
   * wire, and entryUrl / exitUrl / routes sit in the wider metadata ACL and
   * render in the session list.
   */
  describe("server-side URL scrubbing on the session header", () => {
    test("a hand-crafted envelope carrying a reset-password token is scrubbed", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([
            {
              chunkIndex: 0,
              url: "https://shop.example.com/reset-password?token=s3cr3t-reset-token-value&email=victim@example.com",
              meta: {
                entryUrl:
                  "https://shop.example.com/magic-link?token=another-s3cr3t",
                browserName: "Chrome",
                browserVersion: "141",
                osName: "macOS",
                deviceType: "desktop",
                viewportWidth: 1440,
                viewportHeight: 900,
              },
            },
          ]),
        ),
      );

      const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

      const urlFields: string = JSON.stringify([
        header["entryUrl"],
        header["exitUrl"],
        header["routes"],
      ]);

      expect(urlFields).not.toContain("token");
      expect(urlFields).not.toContain("s3cr3t");
      expect(urlFields).not.toContain("email");
      expect(urlFields).not.toContain("victim@example.com");

      /* Route structure survives - that is the whole point of scrubbing. */
      expect(header["exitUrl"]).toBe("https://shop.example.com/reset-password");
      expect(header["entryUrl"]).toBe("https://shop.example.com/magic-link");
      /* With no route list on the envelope, routes is the chunk's own url. */
      expect(header["routes"]).toEqual([
        "https://shop.example.com/reset-password",
      ]);
    });

    /*
     * The provisional header carries chunk 0's REAL route list.
     *
     * It is not rewritten until the finalizer runs, so a one-entry list made
     * the "Page URL visited (exact)" filter miss a page the user
     * demonstrably reached for the whole 10-15 minute provisional window -
     * on a row that simultaneously reported pageCount 2.
     */
    test("the provisional header carries chunk 0's whole route list", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([
            {
              chunkIndex: 0,
              url: "https://shop.example.com/checkout",
              routes: [
                "https://shop.example.com/",
                "https://shop.example.com/cart",
              ],
              signals: {
                errorCount: 0,
                rageClickCount: 0,
                deadClickCount: 0,
                errorClickCount: 0,
                refreshRageCount: 0,
                routeCount: 2,
              },
            },
          ]),
        ),
      );

      const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

      expect(header["routes"]).toEqual([
        "https://shop.example.com/",
        "https://shop.example.com/cart",
        "https://shop.example.com/checkout",
      ]);

      /* The count and the list can no longer disagree on the same row. */
      expect((header["routes"] as Array<string>).length).toBe(
        (header["pageCount"] as number) + 1,
      );
    });

    test("the provisional route list is scrubbed like the rest", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([
            {
              chunkIndex: 0,
              url: "https://shop.example.com/checkout",
              routes: [
                "https://shop.example.com/reset-password?token=s3cr3t-header",
              ],
            },
          ]),
        ),
      );

      const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

      expect(JSON.stringify(header["routes"])).not.toContain("s3cr3t");
      expect(JSON.stringify(header["routes"])).not.toContain("token");
    });

    test("identifier-shaped path segments are redacted, not just the query", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([
            {
              chunkIndex: 0,
              url: "https://shop.example.com/users/550e8400-e29b-41d4-a716-446655440000/orders",
            },
          ]),
        ),
      );

      const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

      expect(header["exitUrl"]).toBe(
        "https://shop.example.com/users/[redacted]/orders",
      );
    });

    test("entryUrl falls back to the chunk url, scrubbed, when meta carries none", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([
            {
              chunkIndex: 0,
              url: "https://shop.example.com/checkout?cart=abc",
              meta: {
                /* The parser always materialises entryUrl, empty when absent. */
                entryUrl: "",
                browserName: "Chrome",
                browserVersion: "141",
                osName: "macOS",
                deviceType: "desktop",
                viewportWidth: 1440,
                viewportHeight: 900,
              },
            },
          ]),
        ),
      );

      const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

      expect(header["entryUrl"]).toBe("https://shop.example.com/checkout");
      expect(header["exitUrl"]).toBe("https://shop.example.com/checkout");
    });
  });

  /*
   * The decompression budget is what actually bounds the worker. A per-frame
   * cap alone multiplies by MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST and again by
   * SESSION_REPLAY_WORKER_CONCURRENCY, because every decoded frame stays
   * resident until the submit at the end of the job - low gigabytes from one
   * authenticated client posting highly compressible padding.
   */
  describe("decompression budget", () => {
    test("a frame that inflates past the per-frame cap is dropped, not decoded", async () => {
      /* 9 MiB of repetitive text: a tiny gzip, past the 8 MiB frame cap. */
      const oversized: Array<unknown> = ["x".repeat(9 * 1024 * 1024)];

      await SessionReplayIngestService.processFromQueue(
        buildJobData(buildBody([{ chunkIndex: 0 }], oversized)),
      );

      expect(submitMock).not.toHaveBeenCalled();
    });

    test("the budget is per JOB, so later frames of a fat request are dropped", async () => {
      const fat: Array<unknown> = ["y".repeat(7 * 1024 * 1024)];

      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody(
            [
              { chunkIndex: 0 },
              { chunkIndex: 1 },
              { chunkIndex: 2 },
              { chunkIndex: 3 },
              { chunkIndex: 4 },
            ],
            fat,
          ),
        ),
      );

      /*
       * A 32 MiB job allowance at ~7 MiB a frame admits four; the fifth
       * inflate is capped at what is left and aborts. Under a per-frame-only
       * bound all five would have been held in memory at once.
       */
      expect(getSubmittedRows("RumSessionChunkV1")).toHaveLength(4);
    });
  });

  describe("ack-after-flush", () => {
    /*
     * The rejection is pre-observed here so Node does not report an
     * unhandled rejection between this promise being created and
     * pushObservedAck attaching its own handler several awaits later. It
     * stays a genuine rejection for the code under test.
     */
    function rejectedFlush(): Promise<void> {
      const flushed: Promise<void> = Promise.reject(
        new Error("clickhouse refused the insert"),
      );

      flushed.catch((): void => {
        /* Pre-observed only. */
      });

      return flushed;
    }

    test("a rejected flush fails the job so BullMQ re-processes it", async () => {
      submitMock.mockResolvedValue({
        flushed: rejectedFlush(),
      } as never);

      await expect(
        SessionReplayIngestService.processFromQueue(
          buildJobData(buildBody([{ chunkIndex: 0 }])),
        ),
      ).rejects.toThrow(/failed to flush rows to storage/);
    });

    test("the session is registered with the finalizer only after the acks land", async () => {
      submitMock.mockResolvedValue({
        flushed: rejectedFlush(),
      } as never);

      await expect(
        SessionReplayIngestService.processFromQueue(
          buildJobData(buildBody([{ chunkIndex: 0 }])),
        ),
      ).rejects.toThrow();

      /*
       * A ZADD here would leave the finalizer aggregating a session with no
       * rows behind it.
       */
      expect(zaddMock).not.toHaveBeenCalled();
    });

    test("a successful flush does register the session", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(buildBody([{ chunkIndex: 0 }])),
      );

      expect(zaddMock).toHaveBeenCalledTimes(1);
      expect(expireMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe("SessionReplayIngestService.processFromQueue - engagement, tags, traits and capabilities", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisStrings.clear();
    redisConnected = true;
    recordDropMock.mockResolvedValue(undefined as never);
    markChunkReceivedMock.mockResolvedValue(undefined as never);
    getPolicyMock.mockResolvedValue(buildPolicy() as never);
    loadRulesMock.mockResolvedValue([] as never);
    scrubEventsMock.mockResolvedValue({
      isComplete: true,
      nodesVisited: 3,
      stringsScrubbed: 0,
      skippedOversizedStrings: 0,
      skippedStructuralStrings: 0,
      truncatedAtDepth: false,
    } as never);
    submitMock.mockResolvedValue({ flushed: Promise.resolve() } as never);
    (isSessionErased as jest.Mock).mockResolvedValue(false as never);
  });

  test("the chunk row carries clickCount / customEventCount, 0 when the recorder sent none", async () => {
    await SessionReplayIngestService.processFromQueue(
      buildJobData(
        buildBody([
          {
            chunkIndex: 0,
            signals: {
              ...buildEnvelope().signals,
              clickCount: 41,
              customEventCount: 3,
            },
          },
          { chunkIndex: 1 },
        ]),
      ),
    );

    const rows: Array<JSONObject> = getSubmittedRows("RumSessionChunkV1");

    expect(rows[0]!["clickCount"]).toBe(41);
    expect(rows[0]!["customEventCount"]).toBe(3);
    expect(rows[1]!["clickCount"]).toBe(0);
    expect(rows[1]!["customEventCount"]).toBe(0);
  });

  test("the header's engagement aggregates are zero - the finalizer owns them", async () => {
    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 0 }])),
    );

    const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

    expect(header["clickCount"]).toBe(0);
    expect(header["customEventCount"]).toBe(0);
    expect(header["firstErrorOffsetMs"]).toBe("0");
    expect(header["activeMs"]).toBe("0");
  });

  test("tags are written under the session ACL regardless of identity capture", async () => {
    getPolicyMock.mockResolvedValue(
      buildPolicy({ captureUserIdentity: false }) as never,
    );

    await SessionReplayIngestService.processFromQueue(
      buildJobData(
        buildBody([
          {
            chunkIndex: 0,
            meta: {
              ...buildEnvelope().meta!,
              tags: { build: "abc", tier: 1 } as unknown as Record<
                string,
                string
              >,
            },
          },
        ]),
      ),
    );

    expect(getSubmittedRows("RumSessionV1")[0]!["tags"]).toEqual({
      build: "abc",
      tier: "1",
    });
  });

  test("traits are stored ONLY when the application captures user identity", async () => {
    const meta: SessionReplayChunkMeta = {
      ...buildEnvelope().meta!,
      identifiedUserRef: "user-42",
      identifiedUserTraits: { plan: "pro", seats: "12" },
    };

    getPolicyMock.mockResolvedValue(
      buildPolicy({ captureUserIdentity: false }) as never,
    );

    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 0, meta: meta }])),
    );

    const withoutCapture: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

    expect(withoutCapture["identifiedUserTraits"]).toEqual({});
    expect(JSON.stringify(withoutCapture)).not.toContain('"plan"');

    submitMock.mockClear();
    getPolicyMock.mockResolvedValue(
      buildPolicy({ captureUserIdentity: true }) as never,
    );

    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 0, meta: meta }])),
    );

    expect(
      getSubmittedRows("RumSessionV1")[0]!["identifiedUserTraits"],
    ).toEqual({ plan: "pro", seats: "12" });
  });

  test("recorder capabilities land in attributes as recorder.capabilities, with the key indexed", async () => {
    await SessionReplayIngestService.processFromQueue(
      buildJobData(
        buildBody([
          {
            chunkIndex: 0,
            capabilities: ["click-events", "web-vitals", "bogus"],
          },
        ]),
      ),
    );

    const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

    expect(header["attributes"]).toEqual({
      "recorder.capabilities": "click-events,web-vitals",
    });
    expect(header["attributeKeys"]).toEqual(["recorder.capabilities"]);

    submitMock.mockClear();

    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 0 }])),
    );

    /* An older recorder writes no attribute rather than an empty one. */
    expect(getSubmittedRows("RumSessionV1")[0]!["attributes"]).toEqual({});
    expect(getSubmittedRows("RumSessionV1")[0]!["attributeKeys"]).toEqual([]);
  });

  test("a frame at the per-session cap is dropped in the worker as defence in depth", async () => {
    await SessionReplayIngestService.processFromQueue(
      buildJobData(
        buildBody([
          { chunkIndex: 3 },
          { chunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION },
        ]),
      ),
    );

    expect(getSubmittedRows("RumSessionChunkV1")).toHaveLength(1);
    expect(recordDropMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        appIdentifier: APP_IDENTIFIER,
        reason: "session-chunk-cap",
      }),
    );
  });

  /*
   * Audit finding ingest-5: a drop after the 202 is invisible to the
   * recorder, so it is counted under the application for the health
   * surface.
   */
  test("worker drops are counted under the application", async () => {
    scrubEventsMock.mockResolvedValue({
      isComplete: false,
      nodesVisited: 1,
      stringsScrubbed: 0,
      skippedOversizedStrings: 0,
      skippedStructuralStrings: 0,
      truncatedAtDepth: true,
    } as never);

    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 0 }])),
    );

    expect(recordDropMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      appIdentifier: APP_IDENTIFIER,
      reason: "scrub-incomplete",
    });
  });

  describe("recording health is stamped after the flush ack", () => {
    test("a durable write stamps last-chunk-received", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(buildBody([{ chunkIndex: 0 }])),
      );

      expect(markChunkReceivedMock).toHaveBeenCalledTimes(1);
      expect(markChunkReceivedMock).toHaveBeenCalledWith(RUM_APPLICATION_ID);
    });

    test("a rejected flush does not", async () => {
      const flushed: Promise<void> = Promise.reject(
        new Error("clickhouse refused the insert"),
      );
      flushed.catch((): void => {
        /* Pre-observed only. */
      });
      submitMock.mockResolvedValue({ flushed: flushed } as never);

      await expect(
        SessionReplayIngestService.processFromQueue(
          buildJobData(buildBody([{ chunkIndex: 0 }])),
        ),
      ).rejects.toThrow();

      expect(markChunkReceivedMock).not.toHaveBeenCalled();
    });

    test("a job whose every frame was dropped stamps nothing", async () => {
      getPolicyMock.mockResolvedValue(
        buildPolicy({
          consentMode: SessionReplayConsentMode.RequireExplicit,
        }) as never,
      );

      await SessionReplayIngestService.processFromQueue(
        buildJobData(buildBody([{ chunkIndex: 0, consentState: "Unknown" }])),
      );

      expect(markChunkReceivedMock).not.toHaveBeenCalled();
      expect(recordDropMock).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "consent-unknown" }),
      );
    });

    test("a failed stamp never fails the job", async () => {
      markChunkReceivedMock.mockRejectedValue(
        new Error("postgres down") as never,
      );

      await expect(
        SessionReplayIngestService.processFromQueue(
          buildJobData(buildBody([{ chunkIndex: 0 }])),
        ),
      ).resolves.toBeUndefined();
    });
  });

  /* Audit finding ingest-15. */
  test("registers the project in the finalizer's index alongside the session", async () => {
    await SessionReplayIngestService.processFromQueue(
      buildJobData(
        buildBody([
          { chunkIndex: 0, tabId: "tab-1" },
          { chunkIndex: 0, tabId: "tab-2" },
        ]),
      ),
    );

    /* One multi-member ZADD for both tabs, then one SADD of the project. */
    expect(zaddMock).toHaveBeenCalledTimes(1);
    expect(zaddMock.mock.calls[0]!.slice(1)).toHaveLength(4);
    expect(saddMock).toHaveBeenCalledWith(
      "replay:active:projects",
      PROJECT_ID.toString(),
    );
  });

  /*
   * Audit finding ingest-6: every chunk of a session must agree on the
   * clamped start and the retention date, or reads that append
   * `retentionDate >= now()` show a session whose tail is missing.
   */
  describe("one session start per session", () => {
    const CLIENT_START: number = 1_800_000_000_000;

    test("a late chunk of a long session reuses chunk 0's start and retention", async () => {
      /* Chunk 0 processed promptly. */
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([{ chunkIndex: 0, sessionStartUnixMs: CLIENT_START }]),
          { serverReceiveUnixMs: CLIENT_START + 20_000 },
        ),
      );

      const first: JSONObject = getSubmittedRows("RumSessionChunkV1")[0]!;
      submitMock.mockClear();

      /*
       * Chunk 900 arrives 5h later (3h50m into the session, plus a retry
       * queue): without the memo the 4h clamp drags its start to now-4h.
       */
      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([
            {
              chunkIndex: 460,
              sessionStartUnixMs: CLIENT_START,
              chunkStartOffsetMs: 3 * 60 * 60 * 1000 + 50 * 60 * 1000,
              chunkEndOffsetMs: 3 * 60 * 60 * 1000 + 50 * 60 * 1000 + 15_000,
            },
          ]),
          { serverReceiveUnixMs: CLIENT_START + 5 * 60 * 60 * 1000 },
        ),
      );

      const late: JSONObject = getSubmittedRows("RumSessionChunkV1")[0]!;

      expect(late["sessionStartTime"]).toBe(first["sessionStartTime"]);
      expect(late["retentionDate"]).toBe(first["retentionDate"]);
    });

    test("a retention change mid-session does not split the session across expiry days", async () => {
      await SessionReplayIngestService.processFromQueue(
        buildJobData(buildBody([{ chunkIndex: 0 }])),
      );

      const first: JSONObject = getSubmittedRows("RumSessionChunkV1")[0]!;
      submitMock.mockClear();

      getPolicyMock.mockResolvedValue(
        buildPolicy({ retentionInDays: 30 }) as never,
      );

      await SessionReplayIngestService.processFromQueue(
        buildJobData(buildBody([{ chunkIndex: 1 }])),
      );

      expect(getSubmittedRows("RumSessionChunkV1")[0]!["retentionDate"]).toBe(
        first["retentionDate"],
      );
    });

    test("without Redis the fallback clamp is offset-aware", async () => {
      redisConnected = false;

      const chunkStartOffsetMs: number = 3 * 60 * 60 * 1000 + 50 * 60 * 1000;

      await SessionReplayIngestService.processFromQueue(
        buildJobData(
          buildBody([
            {
              chunkIndex: 460,
              sessionStartUnixMs: CLIENT_START,
              chunkStartOffsetMs: chunkStartOffsetMs,
              chunkEndOffsetMs: chunkStartOffsetMs + 15_000,
            },
          ]),
          { serverReceiveUnixMs: CLIENT_START + 5 * 60 * 60 * 1000 },
        ),
      );

      const row: JSONObject = getSubmittedRows("RumSessionChunkV1")[0]!;

      /*
       * The honest start is the client's own: 3h50m before a chunk received
       * 5h in is inside the 4h window once the offset is accounted for.
       */
      expect(row["sessionStartTime"]).toBe(
        OneUptimeDate.toClickhouseDateTime64(new Date(CLIENT_START)),
      );
    });
  });
});
