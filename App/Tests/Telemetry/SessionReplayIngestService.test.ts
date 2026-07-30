import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import {
  SESSION_REPLAY_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION,
  SessionReplayChunkEnvelope,
} from "Common/Types/Rum/SessionReplay";
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
      isOriginAllowed: jest.fn().mockReturnValue(true),
      markProjectDisabled: jest.fn(),
      clearCache: jest.fn(),
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

import SessionReplayGateCache, {
  SessionReplayGatePolicy,
} from "Common/Server/Utils/SessionReplay/SessionReplayGateCache";
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

type MockedFn = jest.Mock;

const getPolicyMock: MockedFn =
  SessionReplayGateCache.getPolicy as unknown as MockedFn;
const isOriginAllowedMock: MockedFn =
  SessionReplayGateCache.isOriginAllowed as unknown as MockedFn;
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
    getPolicyMock.mockResolvedValue(buildPolicy() as never);
    isOriginAllowedMock.mockReturnValue(true);
    consumeChunkAllowanceMock.mockResolvedValue({
      outcome: SessionReplayLimitOutcome.Allowed,
    } as never);
    consumeByteBudgetMock.mockResolvedValue({
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
});

describe("SessionReplayIngestService.processFromQueue", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPolicyMock.mockResolvedValue(buildPolicy() as never);
    loadRulesMock.mockResolvedValue([] as never);
    scrubEventsMock.mockResolvedValue({
      isComplete: true,
      nodesVisited: 3,
      stringsScrubbed: 0,
      skippedOversizedStrings: 0,
      truncatedAtDepth: false,
    } as never);
    submitMock.mockResolvedValue({ flushed: Promise.resolve() } as never);
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

  test("no header row is written for a non-zero chunk index", async () => {
    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 4 }])),
    );

    expect(getSubmittedRows("RumSessionChunkV1")).toHaveLength(1);
    expect(getSubmittedRows("RumSessionV1")).toHaveLength(0);
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
    expect(chunk["payloadEncoding"]).toBe("gzip");

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

  test("never stores an identified user key on the ingest path", async () => {
    await SessionReplayIngestService.processFromQueue(
      buildJobData(buildBody([{ chunkIndex: 0 }])),
    );

    const header: JSONObject = getSubmittedRows("RumSessionV1")[0]!;

    expect(header["identifiedUserKey"]).toBe("");
    expect(header["identifiedUserLabel"]).toBe("");
  });
});
