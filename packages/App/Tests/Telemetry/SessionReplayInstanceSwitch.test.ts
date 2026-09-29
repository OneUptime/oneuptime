import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";

/*
 * The deployment-level switch, on its own file because the flag is read from
 * the environment once at module load.
 *
 * SESSION_REPLAY_ENABLED_BY_DEFAULT=false already makes the config endpoint
 * answer "disabled". If the ingest path did not agree, an operator who set it
 * to false would believe replay was off instance-wide while the chunk
 * endpoint kept accepting, scrubbing and writing recordings for any
 * application whose per-app flag happened to be on - and for a self-hosted
 * install, where plan gating enforces nothing, this env var is the only
 * protection that ClickHouse capacity has.
 */
jest.mock("../../FeatureSet/Telemetry/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Telemetry/Config",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    SESSION_REPLAY_INGEST_ENABLED: true,
    SESSION_REPLAY_ENABLED_BY_DEFAULT: false,
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

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

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

jest.mock("Common/Server/Utils/SessionReplay/SessionReplayGateCache", () => {
  return {
    __esModule: true,
    default: {
      getPolicy: jest.fn(),
      resolvePolicy: jest.fn(async (): Promise<unknown> => {
        return { policy: null, refusal: "application-not-enabled" };
      }),
      isOriginAllowed: jest.fn().mockReturnValue(true),
      markProjectDisabled: jest.fn(),
      clearCache: jest.fn(),
    },
    /*
     * The gate reads this enum when it decides WHICH counter bucket a
     * refusal belongs in, so a mock that omits it makes the module throw
     * rather than answer - the mock has to carry the module's whole
     * surface, not just the part this file drives.
     */
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
    pushObservedAck: (
      pendingAcks: Array<Promise<void>>,
      flushed: Promise<void>,
    ): void => {
      pendingAcks.push(flushed);
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

import SessionReplayGateCache from "Common/Server/Utils/SessionReplay/SessionReplayGateCache";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import SessionReplayRateLimiter from "../../FeatureSet/Telemetry/Utils/SessionReplayRateLimiter";
import SessionReplayIngestService, {
  SessionReplayGateDecision,
  SessionReplayGateOutcome,
} from "../../FeatureSet/Telemetry/Services/SessionReplayIngestService";

type MockedFn = ReturnType<typeof jest.fn>;

const getPolicyMock: MockedFn =
  SessionReplayGateCache.getPolicy as unknown as MockedFn;
const submitMock: MockedFn = TelemetryFanInWriter.submit as unknown as MockedFn;
const consumeChunkAllowanceMock: MockedFn =
  SessionReplayRateLimiter.consumeChunkAllowance as unknown as MockedFn;

const PROJECT_ID: ObjectID = ObjectID.generate();

describe("session replay is off when the instance does not offer it", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("gateChunkRequest stops before any policy or counter lookup", async () => {
    const decision: SessionReplayGateDecision =
      await SessionReplayIngestService.gateChunkRequest({
        projectId: PROJECT_ID,
        appIdentifier: "checkout-web",
        origin: "https://shop.example.com",
        sessionIds: ["a".repeat(32)],
        maxChunkIndex: 0,
        chunkCount: 1,
        payloadBytes: 7000,
      });

    expect(decision.outcome).toBe(SessionReplayGateOutcome.Stop);
    expect(decision.directive).toBe("stop");
    expect(decision.reason).toBe("instance-not-offering-replay");

    /* Cheapest-first ordering: nothing downstream is even consulted. */
    expect(getPolicyMock).not.toHaveBeenCalled();
    expect(consumeChunkAllowanceMock).not.toHaveBeenCalled();
  });

  test("a job already on the queue is dropped rather than written", async () => {
    await SessionReplayIngestService.processFromQueue({
      projectId: PROJECT_ID.toString(),
      appIdentifier: "checkout-web",
      inlineBodyBase64: Buffer.from("irrelevant").toString("base64"),
      serverReceiveUnixMs: 1_800_000_020_000,
      samplePercentageAtCapture: 100,
      countryCode: "GB",
    });

    expect(submitMock).not.toHaveBeenCalled();
    expect(getPolicyMock).not.toHaveBeenCalled();
  });
});
